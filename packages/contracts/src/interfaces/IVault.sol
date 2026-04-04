// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./IShared.sol";

/// @title IVault
/// @notice Accounting-only contract on 0G testnet.
///         Holds shares (ERC20), tracks totalAssets via reported values,
///         and orchestrates epoch settlement. Never holds tokens.
///
/// Callers:
///   messenger (relayer) — recordDeposit, processWithdraw, claimWithdraw,
///                         recordRecovery
///   AgentManager        — approveCommissionRelease
///   Anyone              — triggerSettleEpoch, view functions
interface IVault {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted when a Tier-1 or Tier-2 withdrawal is approved.
    ///         For Tier-1: relayer calls satellite.release(user, tokenAmount).
    ///         For Tier-2 (epoch-approved): relayer calls satellite.release(user, tokenAmount).
    event WithdrawApproved(address indexed user, uint256 tokenAmount);

    /// @notice Emitted when a Tier-2 withdrawal has been claimed and processed.
    ///         Relayer calls this after satellite.claimWithdraw() emits ClaimWithdrawRequested.
    event WithdrawReleased(address indexed user, uint256 tokenAmount);

    /// @notice Emitted once per epoch when settlement completes.
    ///         Relayer calls satellite.updateSharePrice(sharePrice) on Sepolia.
    event EpochSettled(uint256 sharePrice, uint256 totalShares, uint256 totalAssets);

    /// @notice Emitted when iNFT owner's commission claim is approved.
    ///         Relayer calls satellite.releaseCommission(caller, amount) on Sepolia.
    event CommissionApproved(uint256 indexed agentId, address indexed caller, uint256 amount);

    /// @notice Emitted at epoch settlement — protocol's cut of collected fees.
    ///         Relayer calls satellite.reserveProtocolFees(amount) on Sepolia.
    event ProtocolFeeAccrued(uint256 amount);

    /// @notice Emitted at epoch settlement — agent commission accrued.
    ///         Relayer calls satellite.reserveCommission(agentId, amount) on Sepolia.
    event CommissionAccrued(uint256 indexed agentId, uint256 amount);

    /// @notice Emitted after a force-close position recovery is recorded.
    ///         Does not change totalAssets — next epoch reconciliation handles it.
    event RecoveryRecorded(uint256 indexed agentId, uint256 recoveredAmount);

    /// @notice Emitted when Vault requests a force-close of an agent's positions.
    ///         Relayer looks up its positionIds cache and calls satellite.forceClose().
    ///         Source = VAULT for withdrawal-driven closures (lowest-Sharpe agents first).
    ///         Also emitted by AgentManager for eviction and withdraw-from-arena closures.
    event ForceCloseRequested(uint256 indexed agentId, IShared.ForceCloseSource source);

    // -------------------------------------------------------------------------
    // Messenger-only functions (called by relayer)
    // -------------------------------------------------------------------------

    /// @notice Records a deposit from Sepolia; mints shares to user on 0G.
    ///         Triggered by satellite's Deposited event.
    function recordDeposit(address user, uint256 amount) external;

    /// @notice Burns shares and emits WithdrawApproved so relayer can release tokens.
    ///         Triggered by satellite's WithdrawRequested event.
    function processWithdraw(address user, uint256 shares) external;

    /// @notice Called by relayer after satellite emits ClaimWithdrawRequested.
    ///         Marks the Tier-2 queued withdrawal as processed; emits WithdrawReleased.
    ///         Relayer then calls satellite.releaseQueuedWithdraw(user, tokenAmount).
    function claimWithdraw(address user, uint256 tokenAmount) external;

    /// @notice Records a force-close recovery relayed from Satellite.
    ///         Does NOT update totalAssets — next epoch's settleAgents() reconciliation handles it.
    ///         Emits RecoveryRecorded for audit.
    function recordRecovery(uint256 agentId, uint256 recoveredAmount) external;

    // -------------------------------------------------------------------------
    // AgentManager-only functions
    // -------------------------------------------------------------------------

    /// @notice Called by AgentManager after verifying iNFT ownership.
    ///         Reads commissionsOwed[agentId] from its own state, zeroes it,
    ///         and emits CommissionApproved. No amount param — Vault owns the data.
    /// @param agentId  The agent whose commission is being released.
    /// @param caller   The iNFT owner who initiated the claim (for the event).
    function approveCommissionRelease(uint256 agentId, address caller) external;

    // -------------------------------------------------------------------------
    // Public functions (callable by anyone, including relayer)
    // -------------------------------------------------------------------------

    /// @notice Trigger epoch settlement when due.
    ///         Called by the relayer once per epoch in its main loop.
    ///         Also triggered lazily by epochCheck on recordDeposit / processWithdraw.
    ///         No-op if called before the epoch boundary or while settling.
    function triggerSettleEpoch() external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Total assets under management (sum of reported position values + idle).
    function totalAssets() external view returns (uint256);

    /// @notice Current share price = totalAssets * 1e18 / totalSupply.
    function sharePrice() external view returns (uint256);

    /// @notice Vault's tracked idle balance (totalAssets minus deployed capital estimate).
    function idleBalance() external view returns (uint256);

    /// @notice ERC20 share balance of a user.
    function balanceOf(address user) external view returns (uint256 shares);

    /// @notice Total shares in circulation.
    function totalSupply() external view returns (uint256);

    /// @notice Pending withdrawal amount queued for a user (Tier 2).
    function pendingWithdrawal(address user) external view returns (uint256 tokenAmount);

    /// @notice Commissions owed to an agent's iNFT owner (claimable on Sepolia).
    function commissionsOwed(uint256 agentId) external view returns (uint256);

    /// @notice Deposit token address (stored for dashboard reads; Vault never calls it).
    function depositToken() external view returns (address);

    /// @notice Pool address (stored for dashboard reads; Vault never calls it).
    function pool() external view returns (address);
}
