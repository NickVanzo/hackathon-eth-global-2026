// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "./IShared.sol";

/// @title IVault
/// @notice Accounting-only contract on 0G testnet.
///         Holds shares (ERC20), tracks totalAssets via reported values,
///         and orchestrates epoch settlement. Never holds tokens.
///
/// Callers:
///   messenger (relayer) — recordDeposit, processWithdraw, approveCommissionRelease
///   AgentManager        — idleBalance, triggerSettleEpoch (via epochCheck)
///   Anyone              — view functions
interface IVault {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted after relayer confirms satellite released tokens to user.
    event WithdrawApproved(address indexed user, uint256 tokenAmount);

    /// @notice Emitted once per epoch when settlement completes.
    ///         Relayer calls satellite.updateSharePrice(sharePrice) on Sepolia.
    event EpochSettled(uint256 sharePrice, uint256 totalShares, uint256 totalAssets);

    /// @notice Emitted when iNFT owner's commission claim is approved.
    ///         Relayer calls satellite.releaseCommission(caller, amount) on Sepolia.
    event CommissionApproved(uint256 indexed agentId, address indexed caller, uint256 amount);

    /// @notice Emitted at epoch settlement — protocol's cut of collected fees.
    ///         Relayer calls satellite.reserveFees(protocolFeeAmount, agentId, 0) on Sepolia.
    event ProtocolFeeAccrued(uint256 amount);

    /// @notice Emitted at epoch settlement — agent commission accrued.
    ///         Relayer calls satellite.reserveFees(0, agentId, commissionAmount) on Sepolia.
    event CommissionAccrued(uint256 indexed agentId, uint256 amount);

    // -------------------------------------------------------------------------
    // Messenger-only functions (called by relayer)
    // -------------------------------------------------------------------------

    /// @notice Records a deposit from Sepolia; mints shares to user on 0G.
    ///         Triggered by satellite's Deposited event.
    function recordDeposit(address user, uint256 amount) external;

    /// @notice Burns shares and emits WithdrawApproved so relayer can release tokens.
    ///         Triggered by satellite's WithdrawRequested event.
    function processWithdraw(address user, uint256 shares) external;

    /// @notice Called by AgentManager after verifying iNFT ownership.
    ///         Zeroes commissionsOwed and emits CommissionApproved.
    /// @param agentId  The agent whose commission is being released.
    /// @param caller   The iNFT owner who initiated the claim (for the event).
    /// @param amount   Token amount to release.
    function approveCommissionRelease(uint256 agentId, address caller, uint256 amount) external;

    // -------------------------------------------------------------------------
    // AgentManager-only functions
    // -------------------------------------------------------------------------

    /// @notice Returns vault's idle token balance (tracked via reported values).
    ///         AgentManager calls this to validate vault-agent intents.
    function idleBalance() external view returns (uint256);

    /// @notice Called by AgentManager's epochCheck modifier to trigger settlement.
    ///         Calls AgentManager.settleAgents(), applies fee waterfall,
    ///         handles pending withdrawals, emits EpochSettled.
    function triggerSettleEpoch() external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Total assets under management (sum of reported position values + idle).
    function totalAssets() external view returns (uint256);

    /// @notice Current share price = totalAssets * 1e18 / totalSupply.
    function sharePrice() external view returns (uint256);

    /// @notice ERC20 share balance of a user.
    function balanceOf(address user) external view returns (uint256 shares);

    /// @notice Total shares in circulation.
    function totalSupply() external view returns (uint256);

    /// @notice Pending withdrawal amount queued for a user (Tier 2).
    function pendingWithdrawal(address user) external view returns (uint256 tokenAmount);

    /// @notice Commissions owed to an agent's iNFT owner (claimable on Sepolia).
    function commissionsOwed(uint256 agentId) external view returns (uint256);
}
