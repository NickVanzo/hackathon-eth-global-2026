// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./interfaces/IShared.sol";
import {IAgentManager} from "./interfaces/IAgentManager.sol";
import {IAgenticID} from "./interfaces/IAgenticID.sol";

/// @title AgentManager
/// @notice Agent lifecycle contract on 0G testnet.
///         Handles registration (with iNFT minting), intent submission,
///         token bucket allocation, Sharpe scoring, promotion, and eviction.
contract AgentManager is IAgentManager {
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
        bool    paused;
        bool    registered;
    }

    struct Bucket {
        uint256 credits;
        uint256 maxCredits;
        uint256 refillRate;
        uint256 lastActionBlock;
    }

    struct Scores {
        int256  emaReturn;
        int256  emaReturnSq;
        uint256 positionValue;
        uint256 feesCollected;
        uint256 lastReportedBlock;
    }

    // -------------------------------------------------------------------------
    // Additional events (not in IAgentManager)
    // -------------------------------------------------------------------------

    event ForceCloseRequested(uint256 indexed agentId, IShared.ForceCloseSource source);

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    IAgenticID public immutable agenticId;
    address    public immutable messenger;
    uint256    public immutable alpha;                  // EMA smoothing factor (scaled 1e4)
    uint256    public immutable maxAgents;
    uint256    public immutable totalRefillBudget;
    uint256    public immutable provingEpochsRequired;
    uint256    public immutable minPromotionSharpe;     // scaled 1e4
    uint256    public immutable minActionInterval;      // blocks
    uint256    public immutable maxPromotionShare;      // scaled 1e4 (e.g. 1000 = 10%)
    uint256    public immutable rampEpochs;
    uint256    public immutable evictionEpochs;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address public vault;
    uint256 public totalDeployedVault;
    uint256 public agentCount;

    uint256[] public activeAgentIds;

    // agentId => Agent
    mapping(uint256 => Agent) public agents;
    // agentId => tokenId (iNFT)
    mapping(uint256 => uint256) public agentToTokenId;
    // agentAddress => agentId
    mapping(address => uint256) public addressToAgentId;
    // agentId => Bucket
    mapping(uint256 => Bucket) public buckets;
    // agentId => Scores
    mapping(uint256 => Scores) public scores;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyMessenger() {
        require(msg.sender == messenger, "AgentManager: not messenger");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "AgentManager: not vault");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        address agenticId_,
        address messenger_,
        uint256 alpha_,
        uint256 maxAgents_,
        uint256 totalRefillBudget_,
        uint256 provingEpochsRequired_,
        uint256 minPromotionSharpe_,
        uint256 minActionInterval_,
        uint256 maxPromotionShare_,
        uint256 rampEpochs_,
        uint256 evictionEpochs_
    ) {
        agenticId            = IAgenticID(agenticId_);
        messenger            = messenger_;
        alpha                = alpha_;
        maxAgents            = maxAgents_;
        totalRefillBudget    = totalRefillBudget_;
        provingEpochsRequired = provingEpochsRequired_;
        minPromotionSharpe   = minPromotionSharpe_;
        minActionInterval    = minActionInterval_;
        maxPromotionShare    = maxPromotionShare_;
        rampEpochs           = rampEpochs_;
        evictionEpochs       = evictionEpochs_;
    }

    // -------------------------------------------------------------------------
    // receive — hold 0G tokens for mintFee
    // -------------------------------------------------------------------------

    receive() external payable {}

    // -------------------------------------------------------------------------
    // Messenger-only: recordRegistration
    // -------------------------------------------------------------------------

    /// @notice Registers a new agent and mints an iNFT to the deployer.
    function recordRegistration(
        uint256 agentId,
        address agentAddress_,
        address deployer,
        uint256 provingAmount
    ) external onlyMessenger {
        require(!agents[agentId].registered, "AgentManager: already registered");

        // Store agent state
        agents[agentId] = Agent({
            agentAddress:   agentAddress_,
            phase:          IShared.AgentPhase.PROVING,
            provingBalance: provingAmount,
            provingDeployed: 0,
            epochsCompleted: 0,
            zeroSharpeStreak: 0,
            paused:          false,
            registered:      true
        });

        addressToAgentId[agentAddress_] = agentId;
        activeAgentIds.push(agentId);
        agentCount++;

        // Build iNFT metadata
        IAgenticID.IntelligentData[] memory datas = new IAgenticID.IntelligentData[](3);
        datas[0] = IAgenticID.IntelligentData({
            dataDescription: "Strategy Name",
            dataHash:        keccak256(abi.encode(agentId))
        });
        datas[1] = IAgenticID.IntelligentData({
            dataDescription: "Model",
            dataHash:        keccak256(abi.encode("qwen/qwen-2.5-7b-instruct"))
        });
        datas[2] = IAgenticID.IntelligentData({
            dataDescription: "Agent Address",
            dataHash:        keccak256(abi.encode(agentAddress_))
        });

        uint256 mintFee = agenticId.mintFee();
        uint256 tokenId = agenticId.iMint{value: mintFee}(deployer, datas);
        agentToTokenId[agentId] = tokenId;
    }

    // -------------------------------------------------------------------------
    // Internal: ownership check
    // -------------------------------------------------------------------------

    function _requireOwner(uint256 agentId, address caller) internal view {
        uint256 tokenId = agentToTokenId[agentId];
        require(agenticId.ownerOf(tokenId) == caller, "AgentManager: not iNFT owner");
    }

    // -------------------------------------------------------------------------
    // Messenger-only: processPause
    // -------------------------------------------------------------------------

    function processPause(uint256 agentId, address caller, bool paused_) external onlyMessenger {
        _requireOwner(agentId, caller);
        agents[agentId].paused = paused_;
    }

    // -------------------------------------------------------------------------
    // Messenger-only: reportValues (stub for Task 1)
    // -------------------------------------------------------------------------

    function reportValues(uint256 agentId, uint256 positionValue, uint256 feesCollected)
        external
        onlyMessenger
    {
        scores[agentId].positionValue  = positionValue;
        scores[agentId].feesCollected  = feesCollected;
        scores[agentId].lastReportedBlock = block.number;
        emit ValuesReported(agentId, positionValue, feesCollected);
    }

    // -------------------------------------------------------------------------
    // Messenger-only: processCommissionClaim (stub for Task 1)
    // -------------------------------------------------------------------------

    function processCommissionClaim(uint256 agentId, address caller) external onlyMessenger {
        _requireOwner(agentId, caller);
        // vault.approveCommissionRelease(agentId) — implemented in later task
    }

    // -------------------------------------------------------------------------
    // Agent-callable: submitIntent (stub for Task 1)
    // -------------------------------------------------------------------------

    function submitIntent(
        uint256 agentId,
        IShared.ActionType actionType,
        bytes calldata params
    ) external {
        require(agents[agentId].registered, "AgentManager: not registered");
        require(agents[agentId].agentAddress == msg.sender, "AgentManager: not agent");
        require(!agents[agentId].paused, "AgentManager: paused");
        emit IntentQueued(agentId, actionType, params, block.number);
    }

    // -------------------------------------------------------------------------
    // Vault-only: setVault
    // -------------------------------------------------------------------------

    function setVault(address vault_) external {
        require(vault == address(0), "AgentManager: vault already set");
        vault = vault_;
    }

    // -------------------------------------------------------------------------
    // Vault-only: settleAgents (stub for Task 1)
    // -------------------------------------------------------------------------

    function settleAgents(uint256 /* totalAssets */, uint256 /* maxExposureRatio */)
        external
        onlyVault
        returns (IShared.AgentSettlementData[] memory agentData, uint256 aggregateVaultPositionValue)
    {
        agentData = new IShared.AgentSettlementData[](0);
        aggregateVaultPositionValue = 0;
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

    function credits(uint256 agentId) external view returns (uint256) {
        return buckets[agentId].credits;
    }

    function sharpeScore(uint256 /* agentId */) external pure returns (uint256) {
        return 0;
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
}
