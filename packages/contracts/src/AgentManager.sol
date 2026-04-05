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
    // Constants
    // -------------------------------------------------------------------------

    uint256 private constant SCALE       = 1e18;
    uint256 private constant BPS         = 10_000;
    uint256 private constant MIN_VARIANCE = 1e12;

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
    // Messenger-only: reportValues
    // -------------------------------------------------------------------------

    function reportValues(uint256 agentId, uint256 positionValue, uint256 feesCollected)
        external
        onlyMessenger
    {
        require(agents[agentId].registered, "AgentManager: not registered");
        scores[agentId].positionValue     = positionValue;
        scores[agentId].feesCollected     = feesCollected;
        scores[agentId].lastReportedBlock = block.number;
        emit ValuesReported(agentId, positionValue, feesCollected);
    }

    // -------------------------------------------------------------------------
    // Messenger-only: processCommissionClaim
    // -------------------------------------------------------------------------

    function processCommissionClaim(uint256 agentId, address caller) external onlyMessenger {
        require(agents[agentId].registered, "AgentManager: not registered");
        _requireOwner(agentId, caller);
        (bool ok,) = vault.call(
            abi.encodeWithSignature("approveCommissionRelease(uint256,address)", agentId, caller)
        );
        require(ok, "AgentManager: vault call failed");
    }

    // -------------------------------------------------------------------------
    // Messenger-only: processWithdrawFromArena
    // -------------------------------------------------------------------------

    function processWithdrawFromArena(uint256 agentId, address caller) external onlyMessenger {
        require(agents[agentId].registered, "AgentManager: not registered");
        _requireOwner(agentId, caller);
        emit ForceCloseRequested(agentId, IShared.ForceCloseSource.ALL);
        _deregisterAgent(agentId);
    }

    // -------------------------------------------------------------------------
    // Agent-callable: submitIntent
    // -------------------------------------------------------------------------

    function submitIntent(
        uint256 agentId,
        IShared.ActionType actionType,
        bytes calldata params
    ) external {
        require(agents[agentId].registered, "AgentManager: not registered");
        require(agents[agentId].agentAddress == msg.sender, "AgentManager: not agent");
        require(!agents[agentId].paused, "AgentManager: paused");

        Bucket storage bucket = buckets[agentId];
        require(
            block.number >= bucket.lastActionBlock + minActionInterval,
            "AgentManager: cooldown"
        );

        Agent storage agent = agents[agentId];

        if (agent.phase == IShared.AgentPhase.PROVING) {
            // PROVING branch
            if (actionType == IShared.ActionType.OPEN_POSITION ||
                actionType == IShared.ActionType.MODIFY_POSITION) {
                IShared.IntentParams memory ip = abi.decode(params, (IShared.IntentParams));
                require(
                    ip.amountUSDC <= agent.provingBalance - agent.provingDeployed,
                    "AgentManager: exceeds proving balance"
                );
                agent.provingDeployed += ip.amountUSDC;
            }
            // CLOSE: skip amount check
        } else {
            // VAULT branch
            uint256 elapsed = block.number - bucket.lastActionBlock;
            uint256 refilled = elapsed * bucket.refillRate;
            uint256 newCredits = bucket.credits + refilled;
            if (newCredits > bucket.maxCredits) newCredits = bucket.maxCredits;
            bucket.credits = newCredits;

            if (actionType == IShared.ActionType.OPEN_POSITION ||
                actionType == IShared.ActionType.MODIFY_POSITION) {
                IShared.IntentParams memory ip = abi.decode(params, (IShared.IntentParams));
                require(bucket.credits >= ip.amountUSDC, "AgentManager: insufficient credits");

                (bool ok, bytes memory data) = vault.staticcall(
                    abi.encodeWithSignature("totalAssets()")
                );
                require(ok, "AM: vault read failed");
                uint256 vaultTotal = abi.decode(data, (uint256));
                require(
                    ip.amountUSDC <= vaultTotal - totalDeployedVault,
                    "AgentManager: exceeds vault capacity"
                );

                bucket.credits -= ip.amountUSDC;
                totalDeployedVault += ip.amountUSDC;
            }
            // CLOSE: skip amount check
        }

        bucket.lastActionBlock = block.number;
        emit IntentQueued(agentId, actionType, params, block.number);
    }

    // -------------------------------------------------------------------------
    // Messenger-only: recordClosure
    // -------------------------------------------------------------------------

    function recordClosure(
        uint256 agentId,
        uint256 recoveredAmount,
        uint8 source
    ) external onlyMessenger {
        if (source == 0) {
            // VAULT source
            if (recoveredAmount <= totalDeployedVault) {
                totalDeployedVault -= recoveredAmount;
            } else {
                totalDeployedVault = 0;
            }
            if (agents[agentId].registered) {
                Bucket storage bucket = buckets[agentId];
                uint256 newCredits = bucket.credits + recoveredAmount;
                if (newCredits > bucket.maxCredits) newCredits = bucket.maxCredits;
                bucket.credits = newCredits;
            }
        } else if (source == 1) {
            // PROVING source
            if (agents[agentId].registered) {
                Agent storage agent = agents[agentId];
                if (recoveredAmount <= agent.provingDeployed) {
                    agent.provingDeployed -= recoveredAmount;
                } else {
                    agent.provingDeployed = 0;
                }
            }
        }
        // If agent deregistered or unknown source: skip silently
    }

    // -------------------------------------------------------------------------
    // Vault-only: setVault
    // -------------------------------------------------------------------------

    function setVault(address vault_) external {
        require(vault == address(0), "AgentManager: vault already set");
        vault = vault_;
    }

    // -------------------------------------------------------------------------
    // Vault-only: settleAgents
    // -------------------------------------------------------------------------

    /// @dev Per-agent result from _settleOneAgent; avoids stack-too-deep in settleAgents.
    struct _AgentResult {
        uint256 aid;
        uint256 sharpe;
        uint256 positionValue;
        uint256 feesCollected;
        bool    evicted;
        bool    promoted;
        bool    isVaultAfter;   // true if agent is vault-phase after this epoch
        bool    deregistered;
    }

    function settleAgents(uint256 _totalAssets, uint256 _maxExposureRatio)
        external
        onlyVault
        returns (IShared.AgentSettlementData[] memory agentData, uint256 aggregateVaultPositionValue)
    {
        uint256 n = activeAgentIds.length;
        _AgentResult[] memory results = new _AgentResult[](n);

        // Pass 1: iterate backwards (so swap-and-pop doesn't skip entries)
        // Track vault count so promotion respects maxAgents cap
        uint256 vaultCount;
        for (uint256 k = 0; k < n; k++) {
            if (agents[activeAgentIds[k]].phase == IShared.AgentPhase.VAULT) vaultCount++;
        }

        uint256 i = n;
        uint256 outputIdx = 0;
        while (i > 0) {
            i--;
            _AgentResult memory res = _settleOneAgent(
                activeAgentIds[i], _totalAssets, _maxExposureRatio, vaultCount
            );
            if (res.promoted) vaultCount++; // newly promoted, increment for next iterations
            if (res.evicted && agents[res.aid].phase == IShared.AgentPhase.PROVING) {
                // vault agent demoted to proving — one slot freed
                if (vaultCount > 0) vaultCount--;
            }
            if (res.deregistered) continue; // agent gone, skip
            if (res.isVaultAfter && !res.evicted) {
                aggregateVaultPositionValue += res.positionValue;
            }
            results[outputIdx] = res;
            outputIdx++;
        }

        // Build return array
        agentData = new IShared.AgentSettlementData[](outputIdx);
        for (uint256 j = 0; j < outputIdx; j++) {
            agentData[j] = IShared.AgentSettlementData({
                agentId:       results[j].aid,
                positionValue: results[j].positionValue,
                feesCollected: results[j].feesCollected,
                evicted:       results[j].evicted,
                promoted:      results[j].promoted,
                forceClose:    results[j].evicted
            });
        }

        // Pass 2: rebalance vault bucket credits proportional to Sharpe
        uint256 totalSharpe = 0;
        for (uint256 j = 0; j < outputIdx; j++) {
            if (results[j].isVaultAfter && !results[j].evicted) {
                totalSharpe += results[j].sharpe;
            }
        }
        if (totalSharpe > 0) {
            uint256 maxCredit = (_totalAssets * _maxExposureRatio / BPS) * maxPromotionShare / BPS;
            for (uint256 j = 0; j < outputIdx; j++) {
                if (results[j].isVaultAfter && !results[j].evicted) {
                    uint256 aid   = results[j].aid;
                    uint256 share = (totalRefillBudget * results[j].sharpe) / totalSharpe;
                    buckets[aid].refillRate = share / 100;
                    buckets[aid].maxCredits = maxCredit;
                }
            }
        }
    }

    /// @dev Settle a single agent: update EMAs, compute Sharpe, handle eviction/promotion.
    ///      Returns a result struct (avoids stack-too-deep in settleAgents).
    function _settleOneAgent(
        uint256 aid,
        uint256 _totalAssets,
        uint256 _maxExposureRatio,
        uint256 _vaultCount
    ) internal returns (_AgentResult memory res) {
        res.aid = aid;
        Agent  storage agent  = agents[aid];
        Scores storage sc     = scores[aid];

        bool isVault = (agent.phase == IShared.AgentPhase.VAULT);

        // 1. EpochReturn
        uint256 allocated = isVault ? buckets[aid].maxCredits : agent.provingBalance;
        if (allocated == 0) allocated = 1;
        res.feesCollected = sc.feesCollected;
        uint256 epochReturn = (res.feesCollected * SCALE) / allocated;

        // 2. Update EMAs
        {
            int256 iER  = int256(epochReturn);
            int256 iER2 = int256((epochReturn * epochReturn) / SCALE);
            int256 ia   = int256(alpha);
            int256 ib   = int256(BPS);
            sc.emaReturn   = (ia * iER  + (ib - ia) * sc.emaReturn)   / ib;
            sc.emaReturnSq = (ia * iER2 + (ib - ia) * sc.emaReturnSq) / ib;
        }

        // 3. Sharpe
        res.sharpe = _computeSharpe(sc.emaReturn, sc.emaReturnSq);

        // 4. Epochs completed
        agent.epochsCompleted++;

        // 5. Streak + eviction (skip paused agents — they are deliberately idle)
        if (agent.paused) {
            // Paused agents don't accumulate eviction streak
        } else if (res.sharpe == 0) {
            agent.zeroSharpeStreak++;
        } else {
            agent.zeroSharpeStreak = 0;
        }

        if (agent.zeroSharpeStreak >= evictionEpochs) {
            res.evicted = true;
            if (isVault) {
                agent.phase = IShared.AgentPhase.PROVING;
                delete buckets[aid];
                sc.emaReturn       = 0;
                sc.emaReturnSq     = 0;
                agent.zeroSharpeStreak = 0;
                emit AgentEvicted(aid, false);
                emit ForceCloseRequested(aid, IShared.ForceCloseSource.VAULT);
            } else {
                emit AgentEvicted(aid, true);
                emit ForceCloseRequested(aid, IShared.ForceCloseSource.PROVING);
                _deregisterAgent(aid);
                res.deregistered = true;
                return res;
            }
        }

        // 6. Promotion (only if vault has capacity)
        if (!res.evicted && !isVault &&
            _vaultCount < maxAgents &&
            agent.epochsCompleted >= provingEpochsRequired &&
            res.sharpe >= minPromotionSharpe)
        {
            agent.phase            = IShared.AgentPhase.VAULT;
            agent.zeroSharpeStreak = 0;
            uint256 maxCredit = (_totalAssets * _maxExposureRatio / BPS) * maxPromotionShare / BPS;
            buckets[aid] = Bucket({
                credits:         maxCredit,
                maxCredits:      maxCredit,
                refillRate:      maxCredit / 100,
                lastActionBlock: block.number
            });
            res.promoted       = true;
            isVault            = true;
            // EMAs carry over from proving phase — no cold start per spec
            emit AgentPromoted(aid);
        }

        res.positionValue = sc.positionValue;
        res.isVaultAfter  = isVault;

        // 7. Reset fees for next epoch
        sc.feesCollected = 0;
    }

    /// @dev Compute Sharpe ratio from EMA return values.
    function _computeSharpe(int256 emaR, int256 emaR2) internal pure returns (uint256) {
        if (emaR <= 0) return 0;
        int256 emaRSq = (emaR * emaR) / int256(SCALE);
        int256 varSigned = emaR2 - emaRSq;
        uint256 variance = (varSigned > 0) ? uint256(varSigned) : 0;
        if (variance < MIN_VARIANCE) variance = MIN_VARIANCE;
        return (uint256(emaR) * SCALE) / _sqrt(variance * SCALE);
    }

    // -------------------------------------------------------------------------
    // Internal: _deregisterAgent
    // -------------------------------------------------------------------------

    function _deregisterAgent(uint256 agentId) internal {
        delete agents[agentId];
        delete buckets[agentId];
        delete scores[agentId];

        // Swap-and-pop from activeAgentIds
        uint256 len = activeAgentIds.length;
        for (uint256 k = 0; k < len; k++) {
            if (activeAgentIds[k] == agentId) {
                activeAgentIds[k] = activeAgentIds[len - 1];
                activeAgentIds.pop();
                break;
            }
        }

        if (agentCount > 0) agentCount--;
    }

    // -------------------------------------------------------------------------
    // Internal: _sqrt (Babylonian method)
    // -------------------------------------------------------------------------

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
