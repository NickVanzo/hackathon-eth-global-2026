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

    // -------------------------------------------------------------------------
    // State: accounting
    // -------------------------------------------------------------------------

    /// @notice Total USDC.e value owned by depositors (principal + depositor fees - withdrawals).
    ///         Does NOT include protocol fees or commissions — those are reserved on Satellite.
    uint256 internal _trackedTotalAssets;

    /// @notice Portion of total assets currently idle on Satellite (not deployed in LP positions).
    ///         Used by AgentManager to cap vault-agent intent sizes.
    uint256 internal _trackedIdleBalance;

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
    /// @param _messenger          Trusted relayer address.
    constructor(
        address _agentManager,
        uint256 _epochLength,
        uint256 _maxExposureRatio,
        uint256 _protocolFeeRate,
        address _protocolTreasury,
        uint256 _commissionRate,
        address _messenger
    ) ERC20("Agent Arena Shares", "AAS") {
        require(_agentManager     != address(0), "Vault: zero agentManager");
        require(_protocolTreasury != address(0), "Vault: zero treasury");
        require(_messenger        != address(0), "Vault: zero messenger");
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
        _trackedIdleBalance += amount;

        _mint(user, shares);
    }

    // =========================================================================
    // 3.3 — WITHDRAWAL SYSTEM
    // =========================================================================

    /// @notice Process a withdrawal request relayed from Satellite.
    ///         The relayer converts tokenAmount → shares using cachedSharePrice
    ///         before calling this function.
    ///
    ///   Tier-1 (instant): tokenAmount ≤ _trackedIdleBalance
    ///     → burn shares, decrement idle, emit WithdrawApproved immediately.
    ///       Relayer calls satellite.release(user, tokenAmount) on Sepolia.
    ///
    ///   Tier-2 (queued): tokenAmount > _trackedIdleBalance
    ///     → burn shares, record tokenAmount in _pendingWithdrawals.
    ///       WithdrawApproved fires at the next epoch once idle is freed.
    ///
    ///   Shares are burned immediately in both tiers so share supply stays
    ///   consistent.  _trackedTotalAssets is only decremented when tokens
    ///   actually leave (Tier-1 now, Tier-2 at epoch processing).
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

        _burn(user, shares);

        if (tokenAmount <= _trackedIdleBalance) {
            // ── Tier-1: instant release ──────────────────────────────────────
            _trackedIdleBalance -= tokenAmount;
            _trackedTotalAssets -= tokenAmount;
            emit WithdrawApproved(user, tokenAmount);
        } else {
            // ── Tier-2: queue for next epoch ─────────────────────────────────
            // _trackedTotalAssets stays unchanged — these tokens are still owed
            // to the user; they will be decremented when WithdrawApproved fires.
            _pendingWithdrawals[user] += tokenAmount;
            if (!_inPendingQueue[user]) {
                _pendingUsers.push(user);
                _inPendingQueue[user] = true;
            }
        }
    }

    /// @notice Called by AgentManager after verifying iNFT ownership on-chain.
    ///         Decrements commissionsOwed and emits CommissionApproved so the
    ///         relayer can call satellite.releaseCommission(caller, amount).
    function approveCommissionRelease(uint256 agentId, address caller, uint256 amount)
        external
        onlyAgentManager
    {
        require(amount > 0,                         "Vault: zero amount");
        require(caller != address(0),               "Vault: zero caller");
        require(commissionsOwed[agentId] >= amount, "Vault: exceeds owed");

        commissionsOwed[agentId] -= amount;
        emit CommissionApproved(agentId, caller, amount);
    }

    function triggerSettleEpoch() external onlyAgentManager {
        revert("Vault: triggerSettleEpoch not implemented");
    }

    function totalAssets() external view returns (uint256) { return _trackedTotalAssets; }
    function sharePrice()  external view returns (uint256) { return _sharePrice(); }
    function idleBalance() external view returns (uint256) { return _trackedIdleBalance; }
    function pendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
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

    function _settleEpoch() internal virtual { }
    function _processPendingWithdrawals() internal virtual { }
}
