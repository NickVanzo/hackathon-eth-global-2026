// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVault} from "./interfaces/IVault.sol";
import {IAgentManager} from "./interfaces/IAgentManager.sol";
import {IShared} from "./interfaces/IShared.sol";

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

/// @title Vault
/// @notice Accounting-only contract on 0G testnet.
///
///   Holds shares (ERC20), tracks totalAssets via reported position values,
///   orchestrates epoch settlement, and manages the fee waterfall.
///   NEVER holds tokens — all USDC.e lives on the Satellite (Sepolia).
///
/// Section 3.1 — ERC20 shares + access control + constructor
/// Section 3.2 — Deposit accounting: recordDeposit, totalAssets, sharePrice, idleBalance
/// Section 3.3 — Withdrawal system: processWithdraw (Tier-1/2), approveCommissionRelease
/// Section 3.4 — Epoch settlement: epochCheck, triggerSettleEpoch, _settleEpoch, fee waterfall
contract Vault is IVault, ERC20, ReentrancyGuard {

    // =========================================================================
    // 3.1 — ERC20 SHARES + ACCESS CONTROL + CONSTRUCTOR
    // =========================================================================

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------

    /// @notice Relayer EOA (hackathon) or permissionless relayer contract (production).
    address public immutable messenger;

    /// @notice AgentManager contract on 0G — called during epoch settlement.
    address public immutable agentManager;

    /// @notice Address that receives protocol fee notifications (on Sepolia via relayer).
    address public immutable protocolTreasury;

    /// @notice Epoch length in blocks. Settlement triggers lazily on first action after expiry.
    uint256 public immutable epochLength;

    /// @notice Protocol's share of collected fees, in basis points (e.g. 500 = 5 %).
    uint256 public immutable protocolFeeRate;

    /// @notice Agent iNFT owner's share of remaining fees, in basis points (e.g. 1000 = 10 %).
    uint256 public immutable commissionRate;

    /// @notice Maximum fraction of totalAssets that may be deployed across all agents,
    ///         in basis points (e.g. 8000 = 80 %).
    uint256 public immutable maxExposureRatio;

    /// @notice Deposit token address (stored for dashboard reads; Vault never calls it).
    address public immutable depositToken;

    /// @notice Pool address (stored for dashboard reads; Vault never calls it).
    address public immutable pool;

    // -------------------------------------------------------------------------
    // State: accounting
    // -------------------------------------------------------------------------

    /// @notice Total USDC.e value owned by depositors (principal + depositor fees - withdrawals).
    ///         Does NOT include protocol fees or commissions — those are reserved on Satellite.
    uint256 internal _trackedTotalAssets;

    /// @notice Shares locked per user for Tier-2 withdrawals (held by vault until fulfillment).
    mapping(address user => uint256 shares) internal _pendingShareLocks;

    /// @notice Epoch number when a user's Tier-2 withdrawal was queued.
    mapping(address user => uint256 epoch) internal _pendingEpochs;

    // -------------------------------------------------------------------------
    // State: epoch
    // -------------------------------------------------------------------------

    /// @notice Block number at which the last epoch settled.
    uint256 public lastEpochBlock;

    /// @notice Monotonically increasing epoch counter (starts at 0).
    uint256 public currentEpoch;

    /// @dev Guards against re-entrant epoch settlement triggered by external calls.
    bool private _settling;

    // -------------------------------------------------------------------------
    // State: fee accrual
    // -------------------------------------------------------------------------

    /// @notice Cumulative protocol fees accrued (informational; satellite holds the USDC.e).
    uint256 public protocolFeesAccrued;

    /// @notice Commission owed to each agent's iNFT owner (claimable via satellite).
    ///         Public mapping — auto-getter satisfies IVault.commissionsOwed().
    mapping(uint256 agentId => uint256 amount) public commissionsOwed;

    // -------------------------------------------------------------------------
    // State: withdrawal queue (Tier-2)
    // -------------------------------------------------------------------------

    /// @notice Queued Tier-2 withdrawal amounts per user.
    mapping(address user => uint256 tokenAmount) internal _pendingWithdrawals;

    /// @notice Ordered list of users with pending Tier-2 withdrawals.
    address[] internal _pendingUsers;

    /// @notice Whether a user is already tracked in _pendingUsers (prevents duplicates).
    mapping(address user => bool) internal _inPendingQueue;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyMessenger() {
        require(msg.sender == messenger, "Vault: not messenger");
        _;
    }

    modifier onlyAgentManager() {
        require(msg.sender == agentManager, "Vault: not agentManager");
        _;
    }

    /// @dev Lazily triggers epoch settlement when the epoch window has elapsed.
    ///      Guarded by _settling to prevent re-entrancy from AgentManager callbacks.
    modifier epochCheck() {
        if (!_settling && block.number >= lastEpochBlock + epochLength) {
            _settleEpoch();
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _agentManager       AgentManager address on 0G.
    /// @param _epochLength        Settlement cadence in blocks (e.g. 7200 ≈ 1 day).
    /// @param _maxExposureRatio   Max deployable fraction of assets (bps, e.g. 8000 = 80 %).
    /// @param _protocolFeeRate    Protocol cut of collected fees (bps, e.g. 500 = 5 %).
    /// @param _protocolTreasury   Address that receives protocol fee signals on Sepolia.
    /// @param _commissionRate     Agent iNFT owner cut of remaining fees (bps, e.g. 1000 = 10 %).
    /// @param _depositToken       USDC.e address (stored for dashboard reads; Vault never calls it).
    /// @param _pool               Uniswap pool address (stored for dashboard reads only).
    /// @param _messenger          Trusted relayer address.
    constructor(
        address _agentManager,
        uint256 _epochLength,
        uint256 _maxExposureRatio,
        uint256 _protocolFeeRate,
        address _protocolTreasury,
        uint256 _commissionRate,
        address _depositToken,
        address _pool,
        address _messenger
    ) ERC20("Agent Arena Shares", "AAS") {
        require(_agentManager     != address(0), "Vault: zero agentManager");
        require(_protocolTreasury != address(0), "Vault: zero treasury");
        require(_messenger        != address(0), "Vault: zero messenger");
        require(_depositToken     != address(0), "Vault: zero depositToken");
        require(_pool             != address(0), "Vault: zero pool");
        require(_epochLength      >  0,          "Vault: zero epochLength");
        require(_protocolFeeRate  <= 10_000,     "Vault: protocolFeeRate > 100%");
        require(_commissionRate   <= 10_000,     "Vault: commissionRate > 100%");
        require(_maxExposureRatio <= 10_000,     "Vault: maxExposureRatio > 100%");

        agentManager     = _agentManager;
        epochLength      = _epochLength;
        maxExposureRatio = _maxExposureRatio;
        protocolFeeRate  = _protocolFeeRate;
        protocolTreasury = _protocolTreasury;
        commissionRate   = _commissionRate;
        depositToken     = _depositToken;
        pool             = _pool;
        messenger        = _messenger;

        lastEpochBlock = block.number;
    }

    // -------------------------------------------------------------------------
    // ERC20 overrides — resolve IVault ↔ ERC20 diamond conflict
    // -------------------------------------------------------------------------

    function balanceOf(address user)
        public view override(IVault, ERC20) returns (uint256)
    { return super.balanceOf(user); }

    function totalSupply()
        public view override(IVault, ERC20) returns (uint256)
    { return super.totalSupply(); }

    // =========================================================================
    // Stubs — filled in by subsequent commits
    // =========================================================================

    // =========================================================================
    // 3.2 — DEPOSIT ACCOUNTING
    // =========================================================================

    /// @notice Record a user deposit relayed from Satellite.
    ///         Mints shares proportional to the current share price so existing
    ///         holders are not diluted.  Triggers lazy epoch settlement first.
    ///
    ///         Share minting formula:
    ///           shares = amount × totalSupply / totalAssets   (if supply > 0)
    ///           shares = amount                               (bootstrap: 1:1)
    function recordDeposit(address user, uint256 amount)
        external
        onlyMessenger
        epochCheck
    {
        require(user   != address(0), "Vault: zero user");
        require(amount >  0,          "Vault: zero amount");

        uint256 shares = _tokensToShares(amount);

        _trackedTotalAssets += amount;

        _mint(user, shares);
    }

    // =========================================================================
    // 3.3 — WITHDRAWAL SYSTEM
    // =========================================================================

    /// @notice Process a withdrawal request relayed from Satellite.
    ///         The relayer converts tokenAmount → shares using cachedSharePrice
    ///         before calling this function.
    ///
    ///   Tier-1 (instant): tokenAmount ≤ idle (totalAssets - totalDeployedVault)
    ///     → burn shares, decrement totalAssets, emit WithdrawApproved immediately.
    ///       Relayer calls satellite.release(user, tokenAmount) on Sepolia.
    ///
    ///   Tier-2 (queued): tokenAmount > idle
    ///     → lock shares (transfer to vault), queue tokenAmount + epoch number.
    ///       WithdrawApproved fires at the next epoch once idle is freed.
    ///       Locked shares are burned when the withdrawal is fulfilled.
    function processWithdraw(address user, uint256 shares)
        external
        onlyMessenger
        nonReentrant
        epochCheck
    {
        require(user   != address(0),      "Vault: zero user");
        require(shares >  0,               "Vault: zero shares");
        require(balanceOf(user) >= shares, "Vault: insufficient shares");

        uint256 tokenAmount = _sharesToTokens(shares);
        require(tokenAmount > 0, "Vault: zero tokenAmount");

        uint256 idle = _idleBalance();

        if (tokenAmount <= idle) {
            // ── Tier-1: instant release ──────────────────────────────────────
            _burn(user, shares);
            _trackedTotalAssets -= tokenAmount;
            emit WithdrawApproved(user, tokenAmount);
        } else {
            // ── Tier-2: lock shares, queue for next epoch ────────────────────
            // Shares are transferred to the vault (locked) — totalSupply and
            // totalAssets both stay unchanged, so sharePrice is unaffected.
            // Shares are burned and totalAssets decremented when fulfilled.
            _transfer(user, address(this), shares);
            _pendingWithdrawals[user] += tokenAmount;
            _pendingShareLocks[user]  += shares;
            _pendingEpochs[user]       = currentEpoch;
            if (!_inPendingQueue[user]) {
                _pendingUsers.push(user);
                _inPendingQueue[user] = true;
            }
        }
    }

    /// @notice Called by relayer after satellite emits ClaimWithdrawRequested.
    ///         Marks the Tier-2 queued withdrawal as processed and emits WithdrawReleased
    ///         so the off-chain system has a confirmation event for audit.
    ///         The internal _pendingWithdrawals entry was already cleared by
    ///         _processPendingWithdrawals() at epoch settlement time.
    function claimWithdraw(address user, uint256 tokenAmount)
        external
        onlyMessenger
    {
        require(user        != address(0), "Vault: zero user");
        require(tokenAmount >  0,          "Vault: zero amount");
        emit WithdrawReleased(user, tokenAmount);
    }

    /// @notice Called by relayer after a force-close settles on Sepolia.
    ///         Does NOT update totalAssets — the next epoch's settleAgents() reconciliation
    ///         handles that via reported position values.
    ///         Records the recovery event for audit.
    function recordRecovery(uint256 agentId, uint256 recoveredAmount)
        external
        onlyMessenger
    {
        require(recoveredAmount > 0, "Vault: zero amount");
        emit RecoveryRecorded(agentId, recoveredAmount);
    }

    /// @notice Called by AgentManager after verifying iNFT ownership on-chain.
    ///         Reads commissionsOwed[agentId] from its own state, zeroes it,
    ///         and emits CommissionApproved so the relayer can call
    ///         satellite.releaseCommission(caller, amount).
    function approveCommissionRelease(uint256 agentId, address caller)
        external
        onlyAgentManager
    {
        require(caller != address(0), "Vault: zero caller");
        uint256 amount = commissionsOwed[agentId];
        require(amount > 0, "Vault: no commission owed");

        commissionsOwed[agentId] = 0;
        emit CommissionApproved(agentId, caller, amount);
    }

    // =========================================================================
    // 3.4 — EPOCH SETTLEMENT
    // =========================================================================

    /// @notice Trigger epoch settlement when due.
    ///         Called by the relayer once per epoch in its main loop, or by anyone.
    ///         Also fires lazily via epochCheck on recordDeposit / processWithdraw.
    ///         No-op if the epoch boundary has not elapsed or settlement is in progress.
    function triggerSettleEpoch() external {
        if (!_settling && block.number >= lastEpochBlock + epochLength) {
            _settleEpoch();
        }
    }

    function totalAssets() external view returns (uint256) { return _trackedTotalAssets; }
    function sharePrice()  external view returns (uint256) { return _sharePrice(); }
    function idleBalance() external view returns (uint256) { return _idleBalance(); }
    function pendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }

    function _idleBalance() internal view returns (uint256) {
        uint256 deployed = IAgentManager(agentManager).totalDeployedVault();
        return _trackedTotalAssets > deployed ? _trackedTotalAssets - deployed : 0;
    }

    function _sharePrice() internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (_trackedTotalAssets * 1e18) / supply;
    }

    function _tokensToShares(uint256 tokenAmount) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || _trackedTotalAssets == 0) return tokenAmount;
        return (tokenAmount * supply) / _trackedTotalAssets;
    }

    function _sharesToTokens(uint256 shares) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * _trackedTotalAssets) / supply;
    }

    // -------------------------------------------------------------------------
    // Internal: settlement orchestration
    // -------------------------------------------------------------------------

    /// @dev Full epoch settlement — called by epochCheck modifier or triggerSettleEpoch().
    ///
    ///   Order of operations:
    ///     1. settleAgents()         — EMA, Sharpe, promotion, eviction
    ///     2. totalAssets reconciliation + fee waterfall
    ///     3. Tier-2 queue           — process pending withdrawals, force-close if needed
    ///     4. EpochSettled event     — relayer syncs satellite share price
    ///     5. advance epoch counter
    function _settleEpoch() internal {
        _settling = true;

        // ── Step 1: settle agents ─────────────────────────────────────────────
        // AgentManager updates EMAs, Sharpe scores, promotion ramp, evictions,
        // and returns per-agent settlement data (Sharpe-sorted, lowest first)
        // plus aggregate vault-agent position value for totalAssets reconciliation.
        (IShared.AgentSettlementData[] memory data, uint256 aggregateVaultPositionValue) =
            IAgentManager(agentManager).settleAgents(_trackedTotalAssets, maxExposureRatio);

        // ── Step 2: fee waterfall + totalAssets reconciliation ─────────────────
        // For each agent with collected fees:
        //   protocolFee     = feesCollected × protocolFeeRate / 10000
        //   agentCommission = (feesCollected − protocolFee) × commissionRate / 10000
        //   depositorReturn = feesCollected − protocolFee − agentCommission
        //
        // protocolFee + agentCommission are reserved on the Satellite when the
        // relayer processes ProtocolFeeAccrued / CommissionAccrued events.
        // depositorReturn stays in _trackedTotalAssets — it increases share value.
        uint256 totalProtocolFee;
        uint256 totalDepositorReturn;

        for (uint256 i = 0; i < data.length; i++) {
            IShared.AgentSettlementData memory d = data[i];
            if (d.feesCollected == 0) continue;

            uint256 protocolFee     = (d.feesCollected * protocolFeeRate) / 10_000;
            uint256 remaining       = d.feesCollected - protocolFee;
            uint256 commission      = (remaining * commissionRate) / 10_000;
            uint256 depositorReturn = remaining - commission;

            if (protocolFee > 0) {
                protocolFeesAccrued += protocolFee;
                totalProtocolFee    += protocolFee;
            }

            if (commission > 0) {
                commissionsOwed[d.agentId] += commission;
                emit CommissionAccrued(d.agentId, commission);
            }

            totalDepositorReturn += depositorReturn;
        }

        // Single ProtocolFeeAccrued per epoch — relayer batches the satellite call.
        if (totalProtocolFee > 0) {
            emit ProtocolFeeAccrued(totalProtocolFee);
        }

        // Reconcile totalAssets: position values from settleAgents + idle + depositor fees.
        // idle = totalAssets - totalDeployedVault (nominal deployed amount from AgentManager).
        // Reconciliation formula: totalAssets = aggregateVaultPositionValue + idle + depositorReturn
        // This correctly accounts for impermanent loss: if positions lost value,
        // totalAssets decreases by (totalDeployedVault - aggregateVaultPositionValue).
        uint256 idle = _idleBalance();
        _trackedTotalAssets = aggregateVaultPositionValue + idle + totalDepositorReturn;

        // ── Step 3: process Tier-2 withdrawal queue ───────────────────────────
        // If idle is insufficient, emit ForceCloseRequested for lowest-Sharpe
        // vault agents (data is already sorted lowest-first by AgentManager).
        _processPendingWithdrawals(data);

        // ── Step 4: emit EpochSettled ─────────────────────────────────────────
        // Relayer calls satellite.updateSharePrice(sharePrice) on Sepolia so
        // requestWithdraw() can convert tokenAmount → shares accurately.
        emit EpochSettled(_sharePrice(), totalSupply(), _trackedTotalAssets);

        // ── Step 5: advance epoch ─────────────────────────────────────────────
        lastEpochBlock = block.number;
        currentEpoch++;

        _settling = false;
    }

    /// @dev FIFO processing of queued Tier-2 withdrawals.
    ///      Iterates _pendingUsers, fulfils any entry that fits within current
    ///      idle balance, and compacts the queue for the next epoch.
    ///      If idle is insufficient after processing, emits ForceCloseRequested
    ///      for lowest-Sharpe vault agents (data is Sharpe-sorted, lowest first).
    ///
    ///      Gas bound: O(n) over _pendingUsers length + O(m) over agents for
    ///      force-close targeting. Safe for demo scale.
    function _processPendingWithdrawals(IShared.AgentSettlementData[] memory data) internal {
        uint256 len = _pendingUsers.length;
        if (len == 0) return;

        // Read idle once; track locally as we decrement totalAssets per fulfilment.
        uint256 currentIdle = _idleBalance();

        address[] memory remaining = new address[](len);
        uint256 remainingCount;
        uint256 unfulfilledTotal;

        for (uint256 i = 0; i < len; i++) {
            address user   = _pendingUsers[i];
            uint256 amount = _pendingWithdrawals[user];

            if (amount == 0) {
                // Already cleared (e.g., user re-deposited and zeroed their entry)
                _inPendingQueue[user]     = false;
                _pendingShareLocks[user]  = 0;
                _pendingEpochs[user]      = 0;
                continue;
            }

            if (currentIdle >= amount) {
                // Fulfil: burn the locked shares held by the vault, decrement totalAssets.
                uint256 lockedShares = _pendingShareLocks[user];
                _burn(address(this), lockedShares);
                _trackedTotalAssets       -= amount;
                currentIdle               -= amount;
                _pendingWithdrawals[user]  = 0;
                _pendingShareLocks[user]   = 0;
                _pendingEpochs[user]       = 0;
                _inPendingQueue[user]      = false;
                emit WithdrawApproved(user, amount);
            } else {
                // Insufficient idle — carry over to next epoch
                remaining[remainingCount++] = user;
                unfulfilledTotal += amount;
            }
        }

        // Rebuild queue with only unresolved entries
        delete _pendingUsers;
        for (uint256 i = 0; i < remainingCount; i++) {
            _pendingUsers.push(remaining[i]);
        }

        // If withdrawals remain unfulfilled, emit ForceCloseRequested for
        // lowest-Sharpe vault agents until projected recovery covers the shortfall.
        // data is Sharpe-sorted lowest-first by AgentManager.
        if (unfulfilledTotal > 0) {
            uint256 projectedRecovery;
            for (uint256 i = 0; i < data.length && projectedRecovery < unfulfilledTotal; i++) {
                IShared.AgentSettlementData memory d = data[i];
                // Only target vault agents with open positions
                if (d.positionValue == 0) continue;
                emit ForceCloseRequested(d.agentId, IShared.ForceCloseSource.VAULT);
                projectedRecovery += d.positionValue;
            }
        }
    }
}
