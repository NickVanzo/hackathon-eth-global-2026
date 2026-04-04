# AgentManager Contract — Design Spec

**Date:** 2026-04-04
**Project:** ETHGlobal Cannes 2026 — Agent Arena
**Scope:** AgentManager.sol implementation on 0G testnet with external AgenticID (ERC-7857) integration

---

## Overview

AgentManager is the agent lifecycle contract on 0G testnet. It handles registration, intent submission, token bucket capital allocation, Sharpe scoring, promotion/eviction, and iNFT ownership checks. It is the largest contract in the system (~400-500 lines).

The iNFT is NOT a custom ERC-721. It uses the pre-deployed AgenticID contract (ERC-7857) at `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on 0G Galileo testnet.

---

## External Dependencies

- **AgenticID (ERC-7857):** `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` on 0G testnet
  - `iMint{value: mintFee}(address to, IntelligentData[] datas) → uint256 tokenId`
  - `ownerOf(uint256 tokenId) → address`
  - `mintFee() → uint256`
  - `IntelligentData { string dataDescription; bytes32 dataHash; }`
- **Vault:** circular reference, set via `setVault()` after deployment
  - `totalAssets() → uint256` (read-only, for idle balance check in submitIntent)
- **IShared:** shared types (ActionType, AgentPhase, Intent, IntentParams, AgentSettlementData)

---

## Storage

### Agent State

```solidity
struct Agent {
    address agentAddress;       // EOA that submits intents
    AgentPhase phase;           // PROVING or VAULT
    uint256 provingBalance;     // deposited at registration
    uint256 provingDeployed;    // currently deployed from proving funds
    uint256 epochsCompleted;    // epochs since registration
    uint256 zeroSharpeStreak;   // consecutive epochs with Sharpe clamped to 0
    bool paused;                // iNFT owner can pause
}

mapping(uint256 => Agent) public agents;                // agentId → state
mapping(uint256 => uint256) public agentToTokenId;      // agentId → AgenticID tokenId
mapping(address => uint256) public addressToAgentId;    // agent EOA → agentId (for submitIntent caller auth)
```

### Token Bucket (vault-phase agents only)

```solidity
struct Bucket {
    uint256 credits;
    uint256 maxCredits;
    uint256 refillRate;         // credits per block
    uint256 lastActionBlock;
}

mapping(uint256 => Bucket) public buckets;
```

### Scoring

```solidity
struct Scores {
    uint256 emaReturn;          // scaled x1e18
    uint256 emaReturnSq;        // scaled x1e18
    uint256 positionValue;      // last reported
    uint256 feesCollected;      // last reported
    uint256 lastReportedBlock;
}

mapping(uint256 => Scores) public scores;
```

### Globals

```solidity
IAgenticID public immutable agenticId;
IVault public vault;                        // set once via setVault()
address public immutable messenger;

uint256 public totalDeployedVault;          // running counter of vault capital deployed
uint256 public agentCount;                  // number of registered agents (for iteration)
uint256[] public activeAgentIds;            // list of registered agentIds

// Constructor params (immutable)
uint256 public immutable alpha;             // EMA decay (scaled, 3000 = 0.3)
uint256 public immutable maxAgents;         // max vault-phase agents
uint256 public immutable totalRefillBudget;
uint256 public immutable provingEpochsRequired;
uint256 public immutable minPromotionSharpe;
uint256 public immutable minActionInterval; // blocks between actions
uint256 public immutable maxPromotionShare; // max vault share for new promotee
uint256 public immutable rampEpochs;
uint256 public immutable evictionEpochs;
```

---

## Functions by Task

### Task 1: Agent Registry + iNFT Minting

**`constructor(...)`**
- Takes all immutable params + `messenger` + `agenticIdAddress`
- Stores immutables, sets `agenticId = IAgenticID(agenticIdAddress)`

**`recordRegistration(uint256 agentId, address agentAddress, address deployer, uint256 provingAmount)`**
- `onlyMessenger`
- Require agent not already registered
- Store Agent struct (phase=PROVING, provingBalance=provingAmount, rest zeroed)
- Store `addressToAgentId[agentAddress] = agentId`
- Push agentId to `activeAgentIds`
- Build IntelligentData[3]:
  - `("Strategy Name", keccak256(abi.encode(agentId)))`
  - `("Model", keccak256("qwen/qwen-2.5-7b-instruct"))`
  - `("Agent Address", keccak256(abi.encode(agentAddress)))`
- Call `agenticId.iMint{value: agenticId.mintFee()}(deployer, datas)`
- Store returned tokenId in `agentToTokenId[agentId]`
- Increment `agentCount`

**`_requireOwner(uint256 agentId, address caller)` (internal)**
- `require(agenticId.ownerOf(agentToTokenId[agentId]) == caller, "not iNFT owner")`

**View functions:** `agentAddress()`, `agentPhase()`, `isPaused()`, `provingBalance()`, `provingDeployed()`

### Task 2: Intent Submission + Token Bucket

**`submitIntent(uint256 agentId, ActionType actionType, bytes calldata params)`**
- Require `agents[agentId].agentAddress == msg.sender` (agent EOA auth)
- Require not paused
- Cooldown: `require(block.number >= bucket.lastActionBlock + minActionInterval)`
- **PROVING branch:**
  - Decode `IntentParams` from params for OPEN/MODIFY
  - `require(amount <= provingBalance - provingDeployed)`
  - `provingDeployed += amount`
- **VAULT branch:**
  - Refill credits: `credits = min(maxCredits, credits + (block.number - lastActionBlock) * refillRate)`
  - `require(credits >= amount)`
  - `require(amount <= vault.totalAssets() - totalDeployedVault)`
  - `credits -= amount`
  - `totalDeployedVault += amount`
- Set `lastActionBlock = block.number`
- Emit `IntentQueued(agentId, actionType, params, block.number)`

**`recordClosure(uint256 agentId, uint256 recoveredAmount, uint8 source)`** (source: 0=VAULT, 1=PROVING)
- `onlyMessenger`
- If source == VAULT: `totalDeployedVault -= recoveredAmount`, refund credits if agent exists
- If source == PROVING: `provingDeployed -= recoveredAmount`
- If agent deregistered: skip per-agent bookkeeping silently

### Task 3: Scoring + Settlement

**`reportValues(uint256 agentId, uint256 positionValue, uint256 feesCollected)`**
- `onlyMessenger`
- Store in `scores[agentId]`, set `lastReportedBlock = block.number`
- Emit `ValuesReported`

**`settleAgents() → AgentSettlementData[]`**
- `onlyVault`
- For each active agent:
  1. Compute `epochReturn = (positionValue - prevValue + feesCollected) / allocated`
  2. Update EMAs: `emaReturn = alpha * epochReturn + (1-alpha) * emaReturn` (same for emaReturnSq)
  3. Compute Sharpe: `variance = emaReturnSq - emaReturn²`, floor at MIN_VARIANCE, `sharpe = emaReturn / sqrt(variance)`, clamp negative to 0
  4. Increment `epochsCompleted`
  5. **Eviction check:** if Sharpe == 0 increment `zeroSharpeStreak`, else reset to 0. If streak >= `evictionEpochs`: vault agents drop to PROVING (clear bucket, reset EMAs), proving agents deregister entirely
  6. **Promotion check:** if PROVING + epochsCompleted >= provingEpochsRequired + sharpe >= minPromotionSharpe → promote to VAULT, initialize bucket with ramp
  7. **Bucket rebalance:** redistribute `totalRefillBudget` proportional to Sharpe scores
- Return `AgentSettlementData[]` to Vault

### Task 4: Admin + Auxiliary

**`processPause(uint256 agentId, address caller, bool paused)`**
- `onlyMessenger`
- `_requireOwner(agentId, caller)`
- Set `agents[agentId].paused = paused`

**`processCommissionClaim(uint256 agentId, address caller)`**
- `onlyMessenger`
- `_requireOwner(agentId, caller)`
- Call `vault.approveCommissionRelease(agentId)`

**`processWithdrawFromArena(uint256 agentId, address caller)`**
- `onlyMessenger`
- `_requireOwner(agentId, caller)`
- Emit `ForceCloseRequested(agentId, ALL)`
- Deregister: clear Agent struct, bucket, scores, remove from activeAgentIds

**`setVault(address _vault)`**
- Require vault not already set
- `vault = IVault(_vault)`

**Modifiers:**
- `onlyMessenger`: `require(msg.sender == messenger)`
- `onlyVault`: `require(msg.sender == address(vault))`

---

## AgenticID Interface (minimal, for import)

```solidity
interface IAgenticID {
    struct IntelligentData {
        string dataDescription;
        bytes32 dataHash;
    }
    function iMint(address to, IntelligentData[] calldata datas) external payable returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function mintFee() external view returns (uint256);
}
```

---

## Test Strategy (Forge)

Each task gets its own test file. Tests use a mock AgenticID that implements the minimal interface above.

### Test files:

**`test/AgentManager.Registry.t.sol`** (Task 1)
- `test_recordRegistration_storesAgentState`
- `test_recordRegistration_mintsINFT`
- `test_recordRegistration_storesTokenIdMapping`
- `test_recordRegistration_revertsIfAlreadyRegistered`
- `test_recordRegistration_revertsIfNotMessenger`
- `test_requireOwner_passesForOwner`
- `test_requireOwner_revertsForNonOwner`

**`test/AgentManager.Intent.t.sol`** (Task 2)
- `test_submitIntent_provingAgent_open`
- `test_submitIntent_provingAgent_revertsExceedsBalance`
- `test_submitIntent_vaultAgent_creditsDeducted`
- `test_submitIntent_vaultAgent_revertsInsufficientCredits`
- `test_submitIntent_revertsIfPaused`
- `test_submitIntent_revertsCooldown`
- `test_submitIntent_emitsIntentQueued`
- `test_recordClosure_vaultSource_decrementsDeployed`
- `test_recordClosure_provingSource_decrementsProvingDeployed`
- `test_recordClosure_deregisteredAgent_skips`

**`test/AgentManager.Scoring.t.sol`** (Task 3)
- `test_reportValues_storesValues`
- `test_settleAgents_updatesEMAs`
- `test_settleAgents_computesSharpe`
- `test_settleAgents_promotesEligibleAgent`
- `test_settleAgents_evictsVaultAgent`
- `test_settleAgents_ejectsProvingAgent`
- `test_settleAgents_rebalancesBuckets`

**`test/AgentManager.Admin.t.sol`** (Task 4)
- `test_processPause_setsFlag`
- `test_processPause_revertsNonOwner`
- `test_processCommissionClaim_callsVault`
- `test_processWithdrawFromArena_deregisters`
- `test_processWithdrawFromArena_emitsForceClose`
- `test_setVault_setsOnce`
- `test_setVault_revertsIfAlreadySet`

### Test helpers:

**`test/mocks/MockAgenticID.sol`** — minimal mock implementing `iMint`, `ownerOf`, `mintFee`. Tracks minted tokens and owners. Returns sequential tokenIds.

**`test/helpers/AgentManagerTestBase.sol`** — deploys AgentManager + MockAgenticID + MockVault, registers a default agent, provides helper functions.

---

## Constructor Parameters (hackathon defaults)

| Param | Value | Notes |
|---|---|---|
| `alpha` | 3000 | 0.3 decay — recent epochs weigh more |
| `maxAgents` | 10 | max vault-phase agents |
| `totalRefillBudget` | 10000e6 | 10,000 USDC worth of credits per epoch |
| `provingEpochsRequired` | 3 | 3 epochs before promotion eligible |
| `minPromotionSharpe` | 5000 | 0.5 Sharpe minimum (scaled x10000) |
| `minActionInterval` | 10 | 10 blocks between actions |
| `maxPromotionShare` | 1000 | 10% max vault share for new promotee |
| `rampEpochs` | 3 | 3 epochs to ramp from promotion cap to full allocation |
| `evictionEpochs` | 3 | 3 consecutive zero-Sharpe epochs → evicted |
| `messenger` | relayer EOA | |
| `agenticIdAddress` | `0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F` | pre-deployed on 0G testnet |

---

## Agent Wallet Addresses (0G Testnet)

These are the EOAs the OpenClaw agents use to submit intents:

| Agent | Address |
|---|---|
| agent-alpha | `0xCf5a0E19ed62654e404A48577c4f1EB2A194B510` |
| agent-beta | `0xA58383E7Fde3710f21b11fD1824254A4e5aF1074` |
| agent-gamma | `0x27d95F3Bbd5334915c710C703FC56603CD861f8D` |

These are passed as `agentAddress` in `recordRegistration()` and stored in `addressToAgentId` for `submitIntent()` caller auth.

---

## Deployment

1. Deploy AgentManager with constructor params (Forge script)
2. Deploy Vault with AgentManager address
3. Call `agentManager.setVault(vaultAddress)`
4. Fund AgentManager with 0G tokens for mintFee (relayer sends on first use)
5. Record AgentManager address in `.env`
