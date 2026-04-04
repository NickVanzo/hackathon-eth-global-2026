# AgentManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `AgentManager.sol` on 0G testnet with external AgenticID (ERC-7857) integration, agent registry, intent submission, token bucket, Sharpe scoring, and full Forge test coverage.

**Architecture:** AgentManager is the agent lifecycle contract. It calls the pre-deployed AgenticID at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` for iNFT minting/ownership. Vault calls `settleAgents()` for epoch settlement. Agents call `submitIntent()` directly.

**Tech Stack:** Solidity 0.8.24, Forge, OpenZeppelin Math, 0G testnet (evmVersion: cancun)

**Spec:** `docs/superpowers/specs/2026-04-04-agent-manager-design.md`

**Existing patterns to follow:** `packages/contracts/test/helpers/VaultTestBase.sol` for test base pattern, `packages/contracts/test/mocks/MockAgentManager.sol` for mock pattern.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/AgentManager.sol` | **CREATE** — main contract, all agent lifecycle logic |
| `packages/contracts/src/interfaces/IAgenticID.sol` | **CREATE** — minimal interface for external AgenticID calls |
| `packages/contracts/test/mocks/MockAgenticID.sol` | **CREATE** — mock that implements IAgenticID for testing |
| `packages/contracts/test/mocks/MockVault.sol` | **CREATE** — mock vault with `totalAssets()` and `approveCommissionRelease()` |
| `packages/contracts/test/helpers/AgentManagerTestBase.sol` | **CREATE** — shared test setup (deploys AM + mocks, registers default agent) |
| `packages/contracts/test/AgentManager.Registry.t.sol` | **CREATE** — Task 1 tests |
| `packages/contracts/test/AgentManager.Intent.t.sol` | **CREATE** — Task 2 tests |
| `packages/contracts/test/AgentManager.Scoring.t.sol` | **CREATE** — Task 3 tests |
| `packages/contracts/test/AgentManager.Admin.t.sol` | **CREATE** — Task 4 tests |

---

## Task 1: Test Infrastructure + Agent Registry + iNFT Minting

**Files:**
- Create: `packages/contracts/src/interfaces/IAgenticID.sol`
- Create: `packages/contracts/src/AgentManager.sol` (partial — constructor + registry + iNFT)
- Create: `packages/contracts/test/mocks/MockAgenticID.sol`
- Create: `packages/contracts/test/mocks/MockVault.sol`
- Create: `packages/contracts/test/helpers/AgentManagerTestBase.sol`
- Create: `packages/contracts/test/AgentManager.Registry.t.sol`

### Step 1: Create the IAgenticID interface

- [ ] Create `packages/contracts/src/interfaces/IAgenticID.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface for the pre-deployed AgenticID (ERC-7857) contract.
///         Only the functions AgentManager needs to call.
interface IAgenticID {
    struct IntelligentData {
        string dataDescription;
        bytes32 dataHash;
    }

    /// @notice Mint an iNFT with intelligent data attached.
    function iMint(address to, IntelligentData[] calldata datas) external payable returns (uint256);

    /// @notice Returns the current owner of a token.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Returns the current mint fee.
    function mintFee() external view returns (uint256);
}
```

### Step 2: Create the MockAgenticID

- [ ] Create `packages/contracts/test/mocks/MockAgenticID.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgenticID} from "../../src/interfaces/IAgenticID.sol";

/// @dev Mock AgenticID for testing. Tracks mints, owners, returns sequential tokenIds.
contract MockAgenticID {
    uint256 public nextTokenId = 1;
    uint256 public mintFee = 0; // free for tests

    mapping(uint256 => address) public owners;
    mapping(uint256 => IAgenticID.IntelligentData[]) public tokenData;
    uint256 public mintCount;

    function iMint(address to, IAgenticID.IntelligentData[] calldata datas)
        external
        payable
        returns (uint256)
    {
        uint256 tokenId = nextTokenId++;
        owners[tokenId] = to;
        for (uint256 i = 0; i < datas.length; i++) {
            tokenData[tokenId].push(datas[i]);
        }
        mintCount++;
        return tokenId;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = owners[tokenId];
        require(owner != address(0), "token does not exist");
        return owner;
    }

    /// @dev Test helper: transfer ownership (simulates ERC-721 transfer for ownership tests).
    function transferOwnership(uint256 tokenId, address newOwner) external {
        owners[tokenId] = newOwner;
    }
}
```

### Step 3: Create the MockVault

- [ ] Create `packages/contracts/test/mocks/MockVault.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock vault for AgentManager tests.
contract MockVault {
    uint256 private _totalAssets;
    bool public approveCommissionReleaseCalled;
    uint256 public lastCommissionAgentId;

    function setTotalAssets(uint256 amount) external {
        _totalAssets = amount;
    }

    function totalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function trackedTotalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function approveCommissionRelease(uint256 agentId) external {
        approveCommissionReleaseCalled = true;
        lastCommissionAgentId = agentId;
    }
}
```

### Step 4: Create AgentManager.sol — constructor + registry + iNFT minting

- [ ] Create `packages/contracts/src/AgentManager.sol` with the registry portion:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./interfaces/IShared.sol";
import {IAgenticID} from "./interfaces/IAgenticID.sol";

/// @title AgentManager
/// @notice Agent lifecycle contract on 0G testnet. Handles registration, intent
///         submission, token bucket allocation, Sharpe scoring, promotion/eviction,
///         and iNFT ownership via external AgenticID (ERC-7857).
contract AgentManager {
    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    struct Agent {
        address agentAddress;
        IShared.AgentPhase phase;
        uint256 provingBalance;
        uint256 provingDeployed;
        uint256 epochsCompleted;
        uint256 zeroSharpeStreak;
        bool paused;
        bool registered;
    }

    struct Bucket {
        uint256 credits;
        uint256 maxCredits;
        uint256 refillRate;
        uint256 lastActionBlock;
    }

    struct Scores {
        uint256 emaReturn;
        uint256 emaReturnSq;
        uint256 positionValue;
        uint256 feesCollected;
        uint256 lastReportedBlock;
    }

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    IAgenticID public immutable agenticId;
    address public immutable messenger;
    uint256 public immutable alpha;
    uint256 public immutable maxAgents;
    uint256 public immutable totalRefillBudget;
    uint256 public immutable provingEpochsRequired;
    uint256 public immutable minPromotionSharpe;
    uint256 public immutable minActionInterval;
    uint256 public immutable maxPromotionShare;
    uint256 public immutable rampEpochs;
    uint256 public immutable evictionEpochs;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address public vault;
    uint256 public totalDeployedVault;
    uint256 public agentCount;
    uint256[] public activeAgentIds;

    mapping(uint256 => Agent) public agents;
    mapping(uint256 => uint256) public agentToTokenId;
    mapping(address => uint256) public addressToAgentId;
    mapping(uint256 => Bucket) public buckets;
    mapping(uint256 => Scores) public scores;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event IntentQueued(
        uint256 indexed agentId,
        IShared.ActionType actionType,
        bytes params,
        uint256 blockNumber
    );
    event ValuesReported(uint256 indexed agentId, uint256 positionValue, uint256 feesCollected);
    event AgentPromoted(uint256 indexed agentId);
    event AgentEvicted(uint256 indexed agentId, bool fullEviction);
    event ForceCloseRequested(uint256 indexed agentId, IShared.ForceCloseSource source);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyMessenger() {
        require(msg.sender == messenger, "AM: only messenger");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "AM: only vault");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address _agenticId,
        address _messenger,
        uint256 _alpha,
        uint256 _maxAgents,
        uint256 _totalRefillBudget,
        uint256 _provingEpochsRequired,
        uint256 _minPromotionSharpe,
        uint256 _minActionInterval,
        uint256 _maxPromotionShare,
        uint256 _rampEpochs,
        uint256 _evictionEpochs
    ) {
        agenticId = IAgenticID(_agenticId);
        messenger = _messenger;
        alpha = _alpha;
        maxAgents = _maxAgents;
        totalRefillBudget = _totalRefillBudget;
        provingEpochsRequired = _provingEpochsRequired;
        minPromotionSharpe = _minPromotionSharpe;
        minActionInterval = _minActionInterval;
        maxPromotionShare = _maxPromotionShare;
        rampEpochs = _rampEpochs;
        evictionEpochs = _evictionEpochs;
    }

    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------

    /// @notice Register a new agent and mint an iNFT to the deployer.
    function recordRegistration(
        uint256 agentId,
        address agentAddress,
        address deployer,
        uint256 provingAmount
    ) external onlyMessenger {
        require(!agents[agentId].registered, "AM: already registered");

        agents[agentId] = Agent({
            agentAddress: agentAddress,
            phase: IShared.AgentPhase.PROVING,
            provingBalance: provingAmount,
            provingDeployed: 0,
            epochsCompleted: 0,
            zeroSharpeStreak: 0,
            paused: false,
            registered: true
        });

        addressToAgentId[agentAddress] = agentId;
        activeAgentIds.push(agentId);
        agentCount++;

        // Build intelligent data for the iNFT
        IAgenticID.IntelligentData[] memory datas = new IAgenticID.IntelligentData[](3);
        datas[0] = IAgenticID.IntelligentData("Strategy Name", keccak256(abi.encode(agentId)));
        datas[1] = IAgenticID.IntelligentData("Model", keccak256("qwen/qwen-2.5-7b-instruct"));
        datas[2] = IAgenticID.IntelligentData("Agent Address", keccak256(abi.encode(agentAddress)));

        // Mint iNFT to deployer via pre-deployed AgenticID
        uint256 fee = agenticId.mintFee();
        uint256 tokenId = agenticId.iMint{value: fee}(deployer, datas);
        agentToTokenId[agentId] = tokenId;
    }

    // -------------------------------------------------------------------------
    // Ownership helper
    // -------------------------------------------------------------------------

    /// @dev Require caller is the iNFT owner for the given agent.
    function _requireOwner(uint256 agentId, address caller) internal view {
        uint256 tokenId = agentToTokenId[agentId];
        require(tokenId != 0, "AM: no iNFT");
        require(agenticId.ownerOf(tokenId) == caller, "AM: not iNFT owner");
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    function agentAddress(uint256 agentId) external view returns (address) {
        return agents[agentId].agentAddress;
    }

    function agentPhase(uint256 agentId) external view returns (IShared.AgentPhase) {
        return agents[agentId].phase;
    }

    function isPaused(uint256 agentId) external view returns (bool) {
        return agents[agentId].paused;
    }

    function provingBalance(uint256 agentId) external view returns (uint256) {
        return agents[agentId].provingBalance;
    }

    function provingDeployed(uint256 agentId) external view returns (uint256) {
        return agents[agentId].provingDeployed;
    }

    function getActiveAgentIds() external view returns (uint256[] memory) {
        return activeAgentIds;
    }

    // -------------------------------------------------------------------------
    // Receive — needed to hold 0G tokens for mintFee payments
    // -------------------------------------------------------------------------

    receive() external payable {}
}
```

### Step 5: Create AgentManagerTestBase

- [ ] Create `packages/contracts/test/helpers/AgentManagerTestBase.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentManager} from "../../src/AgentManager.sol";
import {MockAgenticID} from "../mocks/MockAgenticID.sol";
import {MockVault} from "../mocks/MockVault.sol";
import {IShared} from "../../src/interfaces/IShared.sol";

/// @dev Shared state and helpers for all AgentManager test suites.
abstract contract AgentManagerTestBase is Test {
    AgentManager internal am;
    MockAgenticID internal agenticId;
    MockVault internal mockVault;

    address internal messenger = makeAddr("messenger");
    address internal deployer = makeAddr("deployer");

    address internal agentAlpha = 0xCf5a0E19ed62654e404A48577c4f1EB2A194B510;
    address internal agentBeta  = 0xA58383E7Fde3710f21b11fD1824254A4e5aF1074;
    address internal agentGamma = 0x27d95F3Bbd5334915c710C703FC56603CD861f8D;

    uint256 internal constant ALPHA = 3000;
    uint256 internal constant MAX_AGENTS = 10;
    uint256 internal constant TOTAL_REFILL_BUDGET = 10_000e6;
    uint256 internal constant PROVING_EPOCHS_REQUIRED = 3;
    uint256 internal constant MIN_PROMOTION_SHARPE = 5000;
    uint256 internal constant MIN_ACTION_INTERVAL = 10;
    uint256 internal constant MAX_PROMOTION_SHARE = 1000;
    uint256 internal constant RAMP_EPOCHS = 3;
    uint256 internal constant EVICTION_EPOCHS = 3;

    uint256 internal constant PROVING_AMOUNT = 5000e6; // 5000 USDC

    function setUp() public virtual {
        agenticId = new MockAgenticID();
        mockVault = new MockVault();

        am = new AgentManager(
            address(agenticId),
            messenger,
            ALPHA,
            MAX_AGENTS,
            TOTAL_REFILL_BUDGET,
            PROVING_EPOCHS_REQUIRED,
            MIN_PROMOTION_SHARPE,
            MIN_ACTION_INTERVAL,
            MAX_PROMOTION_SHARE,
            RAMP_EPOCHS,
            EVICTION_EPOCHS
        );

        // Link vault
        am.setVault(address(mockVault));

        // Fund AgentManager for mintFee (even though mock fee is 0)
        vm.deal(address(am), 1 ether);

        vm.label(address(am), "AgentManager");
        vm.label(address(agenticId), "AgenticID");
        vm.label(address(mockVault), "MockVault");
        vm.label(messenger, "messenger");
        vm.label(deployer, "deployer");
        vm.label(agentAlpha, "agent-alpha");
        vm.label(agentBeta, "agent-beta");
        vm.label(agentGamma, "agent-gamma");
    }

    /// @dev Register an agent via the messenger.
    function _registerAgent(uint256 agentId, address agentAddr) internal {
        vm.prank(messenger);
        am.recordRegistration(agentId, agentAddr, deployer, PROVING_AMOUNT);
    }

    /// @dev Register agent-alpha as agentId=1.
    function _registerAlpha() internal {
        _registerAgent(1, agentAlpha);
    }

    /// @dev Register all three agents (ids 1, 2, 3).
    function _registerAllAgents() internal {
        _registerAgent(1, agentAlpha);
        _registerAgent(2, agentBeta);
        _registerAgent(3, agentGamma);
    }
}
```

### Step 6: Write registry tests

- [ ] Create `packages/contracts/test/AgentManager.Registry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerRegistryTest is AgentManagerTestBase {
    function test_recordRegistration_storesAgentState() public {
        _registerAlpha();

        assertEq(am.agentAddress(1), agentAlpha);
        assertEq(uint8(am.agentPhase(1)), uint8(IShared.AgentPhase.PROVING));
        assertEq(am.provingBalance(1), PROVING_AMOUNT);
        assertEq(am.provingDeployed(1), 0);
        assertFalse(am.isPaused(1));
    }

    function test_recordRegistration_mintsINFT() public {
        _registerAlpha();

        // MockAgenticID should have minted one token to deployer
        assertEq(agenticId.mintCount(), 1);
        assertEq(agenticId.ownerOf(1), deployer);
    }

    function test_recordRegistration_storesTokenIdMapping() public {
        _registerAlpha();

        uint256 tokenId = am.agentToTokenId(1);
        assertEq(tokenId, 1); // first mint returns tokenId=1
    }

    function test_recordRegistration_storesAddressMapping() public {
        _registerAlpha();

        assertEq(am.addressToAgentId(agentAlpha), 1);
    }

    function test_recordRegistration_incrementsAgentCount() public {
        _registerAlpha();
        assertEq(am.agentCount(), 1);

        _registerAgent(2, agentBeta);
        assertEq(am.agentCount(), 2);
    }

    function test_recordRegistration_addsToActiveList() public {
        _registerAllAgents();

        uint256[] memory ids = am.getActiveAgentIds();
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
    }

    function test_recordRegistration_revertsIfAlreadyRegistered() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AM: already registered");
        am.recordRegistration(1, agentAlpha, deployer, PROVING_AMOUNT);
    }

    function test_recordRegistration_revertsIfNotMessenger() public {
        vm.prank(deployer);
        vm.expectRevert("AM: only messenger");
        am.recordRegistration(1, agentAlpha, deployer, PROVING_AMOUNT);
    }

    function test_requireOwner_passesForOwner() public {
        _registerAlpha();

        // processPause uses _requireOwner internally — test via that path
        vm.prank(messenger);
        am.processPause(1, deployer, true);
        assertTrue(am.isPaused(1));
    }

    function test_requireOwner_revertsForNonOwner() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AM: not iNFT owner");
        am.processPause(1, address(0xdead), true);
    }
}
```

### Step 7: Compile and run tests

- [ ] Run:

```bash
cd packages/contracts && forge build
```

Expected: compiles with no errors.

- [ ] Run:

```bash
cd packages/contracts && forge test --match-contract AgentManagerRegistryTest -v
```

Expected: all 9 tests pass.

### Step 8: Commit

- [ ] Run:

```bash
git add packages/contracts/src/interfaces/IAgenticID.sol \
       packages/contracts/src/AgentManager.sol \
       packages/contracts/test/mocks/MockAgenticID.sol \
       packages/contracts/test/mocks/MockVault.sol \
       packages/contracts/test/helpers/AgentManagerTestBase.sol \
       packages/contracts/test/AgentManager.Registry.t.sol
git commit -m "feat(agent-manager): task 1 — agent registry + iNFT minting via AgenticID"
```

---

## Task 2: Intent Submission + Token Bucket

**Files:**
- Modify: `packages/contracts/src/AgentManager.sol` (add submitIntent, recordClosure)
- Create: `packages/contracts/test/AgentManager.Intent.t.sol`

### Step 1: Add `setVault()` and `submitIntent()` to AgentManager.sol

- [ ] Add to `AgentManager.sol` after the registration section:

```solidity
    // -------------------------------------------------------------------------
    // Vault linkage
    // -------------------------------------------------------------------------

    function setVault(address _vault) external {
        require(vault == address(0), "AM: vault already set");
        vault = _vault;
    }

    // -------------------------------------------------------------------------
    // Intent submission
    // -------------------------------------------------------------------------

    function submitIntent(
        uint256 agentId,
        IShared.ActionType actionType,
        bytes calldata params
    ) external {
        Agent storage agent = agents[agentId];
        require(agent.registered, "AM: not registered");
        require(agent.agentAddress == msg.sender, "AM: not agent EOA");
        require(!agent.paused, "AM: agent paused");

        Bucket storage bucket = buckets[agentId];
        require(
            block.number >= bucket.lastActionBlock + minActionInterval,
            "AM: cooldown active"
        );

        if (agent.phase == IShared.AgentPhase.PROVING) {
            if (actionType != IShared.ActionType.CLOSE_POSITION) {
                IShared.IntentParams memory ip = abi.decode(params, (IShared.IntentParams));
                require(
                    ip.amountUSDC <= agent.provingBalance - agent.provingDeployed,
                    "AM: exceeds proving balance"
                );
                agent.provingDeployed += ip.amountUSDC;
            }
        } else {
            // VAULT phase — token bucket
            // Refill credits
            uint256 elapsed = block.number - bucket.lastActionBlock;
            uint256 refilled = bucket.credits + elapsed * bucket.refillRate;
            bucket.credits = refilled > bucket.maxCredits ? bucket.maxCredits : refilled;

            if (actionType != IShared.ActionType.CLOSE_POSITION) {
                IShared.IntentParams memory ip = abi.decode(params, (IShared.IntentParams));
                require(bucket.credits >= ip.amountUSDC, "AM: insufficient credits");

                // Read vault totalAssets to check idle balance
                (bool ok, bytes memory data) = vault.staticcall(
                    abi.encodeWithSignature("trackedTotalAssets()")
                );
                require(ok, "AM: vault read failed");
                uint256 vaultTotal = abi.decode(data, (uint256));
                require(
                    ip.amountUSDC <= vaultTotal - totalDeployedVault,
                    "AM: insufficient vault liquidity"
                );

                bucket.credits -= ip.amountUSDC;
                totalDeployedVault += ip.amountUSDC;
            }
        }

        bucket.lastActionBlock = block.number;

        emit IntentQueued(agentId, actionType, params, block.number);
    }

    // -------------------------------------------------------------------------
    // Position closure (called by relayer after satellite settles)
    // -------------------------------------------------------------------------

    /// @param source 0=VAULT, 1=PROVING (from relayer's position cache)
    function recordClosure(
        uint256 agentId,
        uint256 recoveredAmount,
        uint8 source
    ) external onlyMessenger {
        if (source == 0) {
            // VAULT source
            totalDeployedVault -= recoveredAmount;
            if (agents[agentId].registered) {
                buckets[agentId].credits += recoveredAmount;
                if (buckets[agentId].credits > buckets[agentId].maxCredits) {
                    buckets[agentId].credits = buckets[agentId].maxCredits;
                }
            }
        } else if (source == 1) {
            // PROVING source
            if (agents[agentId].registered) {
                agents[agentId].provingDeployed -= recoveredAmount;
            }
        }
        // If agent is deregistered, skip per-agent bookkeeping silently
    }
```

### Step 2: Write intent tests

- [ ] Create `packages/contracts/test/AgentManager.Intent.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerIntentTest is AgentManagerTestBase {
    function _encodeOpenParams(uint256 amount, int24 lower, int24 upper)
        internal pure returns (bytes memory)
    {
        return abi.encode(IShared.IntentParams(amount, lower, upper));
    }

    // ── Proving agent tests ──────────────────────────────────────────────

    function test_submitIntent_provingAgent_open() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.prank(agentAlpha);
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);

        assertEq(am.provingDeployed(1), 1000e6);
    }

    function test_submitIntent_provingAgent_revertsExceedsBalance() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(PROVING_AMOUNT + 1, -887220, 887220);

        vm.prank(agentAlpha);
        vm.expectRevert("AM: exceeds proving balance");
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_emitsIntentQueued() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.prank(agentAlpha);
        vm.expectEmit(true, false, false, true);
        emit IShared.ActionType.OPEN_POSITION; // we check via the event below
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsIfPaused() public {
        _registerAlpha();

        // Pause agent
        vm.prank(messenger);
        am.processPause(1, deployer, true);

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.prank(agentAlpha);
        vm.expectRevert("AM: agent paused");
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsCooldown() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(500e6, -887220, 887220);

        vm.prank(agentAlpha);
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);

        // Try again same block — should fail cooldown
        vm.prank(agentAlpha);
        vm.expectRevert("AM: cooldown active");
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsNotAgentEOA() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.prank(deployer); // wrong caller
        vm.expectRevert("AM: not agent EOA");
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_close_noAmountCheck() public {
        _registerAlpha();

        // Open first
        bytes memory openParams = _encodeOpenParams(1000e6, -887220, 887220);
        vm.prank(agentAlpha);
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, openParams);

        // Advance past cooldown
        vm.roll(block.number + MIN_ACTION_INTERVAL + 1);

        // Close — no params decode needed
        vm.prank(agentAlpha);
        am.submitIntent(1, IShared.ActionType.CLOSE_POSITION, "");
    }

    // ── Vault agent tests ────────────────────────────────────────────────
    // (these require an agent in VAULT phase — we'll need a helper to promote)

    // Skipping vault-phase submit tests for now — they depend on settleAgents
    // promotion logic from Task 3. Will be added after promotion is implemented.

    // ── recordClosure tests ──────────────────────────────────────────────

    function test_recordClosure_vaultSource_decrementsDeployed() public {
        _registerAlpha();
        // Simulate vault deployment
        am = _withTotalDeployedVault(1000e6);

        vm.prank(messenger);
        am.recordClosure(1, 500e6, 0); // source=0 = VAULT

        assertEq(am.totalDeployedVault(), 500e6);
    }

    function test_recordClosure_provingSource_decrementsProvingDeployed() public {
        _registerAlpha();

        // First deploy some proving capital
        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);
        vm.prank(agentAlpha);
        am.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
        assertEq(am.provingDeployed(1), 1000e6);

        // Close it
        vm.prank(messenger);
        am.recordClosure(1, 1000e6, 1); // source=1 = PROVING

        assertEq(am.provingDeployed(1), 0);
    }

    function test_recordClosure_deregisteredAgent_skips() public {
        // Just call with a non-existent agentId — should not revert
        vm.prank(messenger);
        am.recordClosure(999, 1000e6, 1);
    }

    // ── Helper ───────────────────────────────────────────────────────────

    /// @dev Hack to set totalDeployedVault for testing (normally set by submitIntent).
    ///      We re-deploy with a direct storage write.
    function _withTotalDeployedVault(uint256 amount) internal returns (AgentManager) {
        // Use vm.store to set totalDeployedVault slot
        // totalDeployedVault is after vault (slot varies) — easier to use the actual flow
        // Instead: just submit an intent to build up totalDeployedVault
        // This test needs vault-phase agent. For now, skip full vault test.
        // TODO: implement after Task 3 adds promotion
        return am;
    }
}
```

Note: some vault-phase tests need promotion (Task 3). The subagent should implement what's possible now and leave vault-phase submit tests with a clear TODO that gets resolved in Task 3.

### Step 3: Compile and run tests

- [ ] Run:

```bash
cd packages/contracts && forge build
```

- [ ] Run:

```bash
cd packages/contracts && forge test --match-contract AgentManagerIntentTest -v
```

Expected: all proving-path tests pass. Vault-phase tests are TODO.

### Step 4: Commit

- [ ] Run:

```bash
git add packages/contracts/src/AgentManager.sol \
       packages/contracts/test/AgentManager.Intent.t.sol
git commit -m "feat(agent-manager): task 2 — intent submission + token bucket + recordClosure"
```

---

## Task 3: Scoring + Settlement

**Files:**
- Modify: `packages/contracts/src/AgentManager.sol` (add reportValues, settleAgents)
- Create: `packages/contracts/test/AgentManager.Scoring.t.sol`

### Step 1: Add reportValues and settleAgents to AgentManager.sol

- [ ] Add to `AgentManager.sol`:

```solidity
    // -------------------------------------------------------------------------
    // Constants for Sharpe computation
    // -------------------------------------------------------------------------

    uint256 private constant SCALE = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant MIN_VARIANCE = 1e12; // prevents division by near-zero

    // -------------------------------------------------------------------------
    // Value reporting
    // -------------------------------------------------------------------------

    function reportValues(
        uint256 agentId,
        uint256 positionValue,
        uint256 feesCollected
    ) external onlyMessenger {
        require(agents[agentId].registered, "AM: not registered");
        Scores storage s = scores[agentId];
        s.positionValue = positionValue;
        s.feesCollected = feesCollected;
        s.lastReportedBlock = block.number;
        emit ValuesReported(agentId, positionValue, feesCollected);
    }

    // -------------------------------------------------------------------------
    // Epoch settlement
    // -------------------------------------------------------------------------

    function settleAgents(uint256 _totalAssets, uint256 _maxExposureRatio)
        external
        onlyVault
        returns (IShared.AgentSettlementData[] memory agentData, uint256 aggregateVaultPositionValue)
    {
        uint256 len = activeAgentIds.length;
        agentData = new IShared.AgentSettlementData[](len);
        uint256 totalSharpe;

        for (uint256 i = 0; i < len; i++) {
            uint256 aid = activeAgentIds[i];
            Agent storage agent = agents[aid];
            Scores storage s = scores[aid];

            // --- Compute epoch return ---
            uint256 allocated = agent.phase == IShared.AgentPhase.VAULT
                ? buckets[aid].maxCredits
                : agent.provingBalance;
            if (allocated == 0) allocated = 1; // avoid div by zero

            // epochReturn = (positionValue - prev + feesCollected) / allocated
            // Using simplified: just use feesCollected as return proxy for hackathon
            uint256 epochReturn = (s.feesCollected * SCALE) / allocated;

            // --- Update EMAs ---
            s.emaReturn = (alpha * epochReturn + (BPS - alpha) * s.emaReturn) / BPS;
            s.emaReturnSq = (alpha * (epochReturn * epochReturn / SCALE) + (BPS - alpha) * s.emaReturnSq) / BPS;

            // --- Sharpe computation ---
            uint256 variance = s.emaReturnSq > (s.emaReturn * s.emaReturn / SCALE)
                ? s.emaReturnSq - (s.emaReturn * s.emaReturn / SCALE)
                : 0;
            if (variance < MIN_VARIANCE) variance = MIN_VARIANCE;
            uint256 sharpe = s.emaReturn * SCALE / _sqrt(variance * SCALE);

            // Clamp negative to 0 (emaReturn is unsigned, so this is already handled)
            // Track for eviction
            agent.epochsCompleted++;

            bool evicted = false;
            bool promoted = false;
            bool forceClose = false;

            // --- Eviction check ---
            if (sharpe == 0) {
                agent.zeroSharpeStreak++;
                if (agent.zeroSharpeStreak >= evictionEpochs) {
                    evicted = true;
                    forceClose = true;
                    if (agent.phase == IShared.AgentPhase.VAULT) {
                        // Drop to proving
                        agent.phase = IShared.AgentPhase.PROVING;
                        delete buckets[aid];
                        s.emaReturn = 0;
                        s.emaReturnSq = 0;
                        agent.zeroSharpeStreak = 0;
                        emit ForceCloseRequested(aid, IShared.ForceCloseSource.VAULT);
                    } else {
                        // Proving ejection — full deregister
                        emit ForceCloseRequested(aid, IShared.ForceCloseSource.PROVING);
                        _deregisterAgent(aid);
                    }
                    emit AgentEvicted(aid, agent.phase == IShared.AgentPhase.PROVING);
                }
            } else {
                agent.zeroSharpeStreak = 0;
            }

            // --- Promotion check ---
            if (!evicted
                && agent.phase == IShared.AgentPhase.PROVING
                && agent.epochsCompleted >= provingEpochsRequired
                && sharpe >= minPromotionSharpe
            ) {
                agent.phase = IShared.AgentPhase.VAULT;
                agent.zeroSharpeStreak = 0;
                // Initialize bucket with promotion ramp
                uint256 maxCredit = (_totalAssets * _maxExposureRatio / BPS) * maxPromotionShare / BPS;
                buckets[aid] = Bucket({
                    credits: maxCredit,
                    maxCredits: maxCredit,
                    refillRate: maxCredit / 100, // simple initial rate
                    lastActionBlock: block.number
                });
                promoted = true;
                emit AgentPromoted(aid);
            }

            // --- Aggregate vault position value ---
            if (agent.phase == IShared.AgentPhase.VAULT) {
                aggregateVaultPositionValue += s.positionValue;
                totalSharpe += sharpe;
            }

            agentData[i] = IShared.AgentSettlementData({
                agentId: aid,
                positionValue: s.positionValue,
                feesCollected: s.feesCollected,
                evicted: evicted,
                promoted: promoted,
                forceClose: forceClose
            });

            // Reset fees for next epoch
            s.feesCollected = 0;
        }

        // --- Rebalance buckets proportional to Sharpe ---
        if (totalSharpe > 0) {
            uint256 maxExposure = _totalAssets * _maxExposureRatio / BPS;
            for (uint256 i = 0; i < len; i++) {
                uint256 aid = activeAgentIds[i];
                if (agents[aid].phase == IShared.AgentPhase.VAULT) {
                    Scores storage s = scores[aid];
                    uint256 variance = s.emaReturnSq > (s.emaReturn * s.emaReturn / SCALE)
                        ? s.emaReturnSq - (s.emaReturn * s.emaReturn / SCALE)
                        : 0;
                    if (variance < MIN_VARIANCE) variance = MIN_VARIANCE;
                    uint256 sharpe = s.emaReturn * SCALE / _sqrt(variance * SCALE);

                    uint256 share = sharpe * BPS / totalSharpe;
                    uint256 newMax = maxExposure * share / BPS;

                    // Apply promotion ramp
                    if (agents[aid].epochsCompleted <= rampEpochs) {
                        uint256 rampCap = maxExposure * maxPromotionShare / BPS;
                        if (newMax > rampCap) newMax = rampCap;
                    }

                    buckets[aid].maxCredits = newMax;
                    buckets[aid].refillRate = newMax / 100;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _deregisterAgent(uint256 agentId) internal {
        delete agents[agentId];
        delete buckets[agentId];
        delete scores[agentId];

        // Remove from activeAgentIds
        uint256 len = activeAgentIds.length;
        for (uint256 i = 0; i < len; i++) {
            if (activeAgentIds[i] == agentId) {
                activeAgentIds[i] = activeAgentIds[len - 1];
                activeAgentIds.pop();
                break;
            }
        }
        agentCount--;
    }

    /// @dev Integer square root (Babylonian method).
    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
```

### Step 2: Write scoring tests

- [ ] Create `packages/contracts/test/AgentManager.Scoring.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerScoringTest is AgentManagerTestBase {

    function test_reportValues_storesValues() public {
        _registerAlpha();

        vm.prank(messenger);
        am.reportValues(1, 5000e6, 100e6);

        (,,uint256 pv, uint256 fc, uint256 lb) = am.scores(1);
        assertEq(pv, 5000e6);
        assertEq(fc, 100e6);
        assertEq(lb, block.number);
    }

    function test_reportValues_revertsIfNotRegistered() public {
        vm.prank(messenger);
        vm.expectRevert("AM: not registered");
        am.reportValues(999, 5000e6, 100e6);
    }

    function test_reportValues_revertsIfNotMessenger() public {
        _registerAlpha();

        vm.prank(deployer);
        vm.expectRevert("AM: only messenger");
        am.reportValues(1, 5000e6, 100e6);
    }

    function test_settleAgents_updatesEpochsCompleted() public {
        _registerAlpha();

        // Report values so settlement has data
        vm.prank(messenger);
        am.reportValues(1, 5000e6, 100e6);

        // Settle
        mockVault.setTotalAssets(100_000e6);
        vm.prank(address(mockVault));
        am.settleAgents(100_000e6, 8000);

        (,,,,,uint256 epochs,,) = am.agents(1);
        assertEq(epochs, 1);
    }

    function test_settleAgents_promotesEligibleAgent() public {
        _registerAlpha();

        // Run through provingEpochsRequired epochs with good fees
        for (uint256 i = 0; i < PROVING_EPOCHS_REQUIRED; i++) {
            vm.prank(messenger);
            am.reportValues(1, 5000e6, 500e6); // healthy fees

            mockVault.setTotalAssets(100_000e6);
            vm.prank(address(mockVault));
            am.settleAgents(100_000e6, 8000);
        }

        assertEq(uint8(am.agentPhase(1)), uint8(IShared.AgentPhase.VAULT));
    }

    function test_settleAgents_evictsVaultAgent() public {
        _registerAlpha();

        // First: promote the agent (need provingEpochsRequired epochs with good Sharpe)
        for (uint256 i = 0; i < PROVING_EPOCHS_REQUIRED; i++) {
            vm.prank(messenger);
            am.reportValues(1, 5000e6, 500e6);
            mockVault.setTotalAssets(100_000e6);
            vm.prank(address(mockVault));
            am.settleAgents(100_000e6, 8000);
        }
        assertEq(uint8(am.agentPhase(1)), uint8(IShared.AgentPhase.VAULT));

        // Now: evictionEpochs with zero fees (Sharpe → 0)
        for (uint256 i = 0; i < EVICTION_EPOCHS; i++) {
            vm.prank(messenger);
            am.reportValues(1, 0, 0); // zero performance
            mockVault.setTotalAssets(100_000e6);
            vm.prank(address(mockVault));
            am.settleAgents(100_000e6, 8000);
        }

        // Should have dropped back to PROVING
        assertEq(uint8(am.agentPhase(1)), uint8(IShared.AgentPhase.PROVING));
    }

    function test_settleAgents_ejectsProvingAgent() public {
        _registerAlpha();

        // evictionEpochs with zero fees — proving agent gets fully ejected
        for (uint256 i = 0; i < EVICTION_EPOCHS; i++) {
            vm.prank(messenger);
            am.reportValues(1, 0, 0);
            mockVault.setTotalAssets(100_000e6);
            vm.prank(address(mockVault));
            am.settleAgents(100_000e6, 8000);
        }

        // Agent should be deregistered
        assertEq(am.agentAddress(1), address(0));
        assertEq(am.agentCount(), 0);
    }

    function test_settleAgents_revertsIfNotVault() public {
        vm.prank(deployer);
        vm.expectRevert("AM: only vault");
        am.settleAgents(100_000e6, 8000);
    }
}
```

### Step 3: Compile and run tests

- [ ] Run:

```bash
cd packages/contracts && forge build && forge test --match-contract AgentManagerScoringTest -v
```

Expected: all tests pass. The subagent may need to adjust Sharpe threshold math if promotion doesn't trigger — debug and fix as needed.

### Step 4: Commit

- [ ] Run:

```bash
git add packages/contracts/src/AgentManager.sol \
       packages/contracts/test/AgentManager.Scoring.t.sol
git commit -m "feat(agent-manager): task 3 — scoring (EMA + Sharpe), promotion, eviction"
```

---

## Task 4: Admin + Auxiliary Functions

**Files:**
- Modify: `packages/contracts/src/AgentManager.sol` (add processPause, processCommissionClaim, processWithdrawFromArena)
- Create: `packages/contracts/test/AgentManager.Admin.t.sol`

### Step 1: Add admin functions to AgentManager.sol

- [ ] Add to `AgentManager.sol`:

```solidity
    // -------------------------------------------------------------------------
    // Admin functions (messenger-only, triggered by satellite events)
    // -------------------------------------------------------------------------

    function processPause(uint256 agentId, address caller, bool paused) external onlyMessenger {
        require(agents[agentId].registered, "AM: not registered");
        _requireOwner(agentId, caller);
        agents[agentId].paused = paused;
    }

    function processCommissionClaim(uint256 agentId, address caller) external onlyMessenger {
        require(agents[agentId].registered, "AM: not registered");
        _requireOwner(agentId, caller);
        // Vault reads its own commissionsOwed[agentId] — no amount param needed
        (bool ok,) = vault.call(abi.encodeWithSignature("approveCommissionRelease(uint256)", agentId));
        require(ok, "AM: commission release failed");
    }

    function processWithdrawFromArena(uint256 agentId, address caller) external onlyMessenger {
        require(agents[agentId].registered, "AM: not registered");
        _requireOwner(agentId, caller);
        emit ForceCloseRequested(agentId, IShared.ForceCloseSource.ALL);
        _deregisterAgent(agentId);
    }
```

Note: `processPause` was already added in Task 1 for the ownership test. The subagent should verify it exists and only add `processCommissionClaim` and `processWithdrawFromArena` if they're missing.

### Step 2: Write admin tests

- [ ] Create `packages/contracts/test/AgentManager.Admin.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerAdminTest is AgentManagerTestBase {
    function test_processPause_setsFlag() public {
        _registerAlpha();

        vm.prank(messenger);
        am.processPause(1, deployer, true);
        assertTrue(am.isPaused(1));

        vm.prank(messenger);
        am.processPause(1, deployer, false);
        assertFalse(am.isPaused(1));
    }

    function test_processPause_revertsNonOwner() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AM: not iNFT owner");
        am.processPause(1, address(0xdead), true);
    }

    function test_processPause_revertsNotMessenger() public {
        _registerAlpha();

        vm.prank(deployer);
        vm.expectRevert("AM: only messenger");
        am.processPause(1, deployer, true);
    }

    function test_processCommissionClaim_callsVault() public {
        _registerAlpha();

        vm.prank(messenger);
        am.processCommissionClaim(1, deployer);

        assertTrue(mockVault.approveCommissionReleaseCalled());
        assertEq(mockVault.lastCommissionAgentId(), 1);
    }

    function test_processCommissionClaim_revertsNonOwner() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AM: not iNFT owner");
        am.processCommissionClaim(1, address(0xdead));
    }

    function test_processWithdrawFromArena_deregisters() public {
        _registerAlpha();

        vm.prank(messenger);
        am.processWithdrawFromArena(1, deployer);

        // Agent should be fully deregistered
        assertEq(am.agentAddress(1), address(0));
        assertEq(am.agentCount(), 0);
        assertEq(am.getActiveAgentIds().length, 0);
    }

    function test_processWithdrawFromArena_emitsForceClose() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectEmit(true, false, false, true);
        // The event has ForceCloseSource.ALL = 2
        // We just check it's emitted for the right agentId
        am.processWithdrawFromArena(1, deployer);
    }

    function test_processWithdrawFromArena_revertsNonOwner() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AM: not iNFT owner");
        am.processWithdrawFromArena(1, address(0xdead));
    }

    function test_setVault_setsOnce() public {
        // setUp already called setVault — verify it's set
        assertEq(am.vault(), address(mockVault));
    }

    function test_setVault_revertsIfAlreadySet() public {
        vm.expectRevert("AM: vault already set");
        am.setVault(address(0x1234));
    }
}
```

### Step 3: Compile and run ALL tests

- [ ] Run:

```bash
cd packages/contracts && forge build && forge test --match-contract AgentManager -v
```

Expected: all tests across all 4 test files pass.

### Step 4: Commit

- [ ] Run:

```bash
git add packages/contracts/src/AgentManager.sol \
       packages/contracts/test/AgentManager.Admin.t.sol
git commit -m "feat(agent-manager): task 4 — admin functions (pause, commission, withdraw-from-arena)"
```

---

## Final Verification

After all 4 tasks, run the full test suite:

```bash
cd packages/contracts && forge test -v
```

This should pass ALL tests — both the existing Vault/Satellite tests AND the new AgentManager tests. If any existing tests break, debug and fix before committing.
