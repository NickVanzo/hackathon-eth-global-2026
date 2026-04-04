// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault} from "../../src/Vault.sol";

/// @dev Test harness that exposes Vault's internal state and helpers.
contract VaultHarness is Vault {

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
    ) Vault(
        _agentManager,
        _epochLength,
        _maxExposureRatio,
        _protocolFeeRate,
        _protocolTreasury,
        _commissionRate,
        _depositToken,
        _pool,
        _messenger
    ) {}

    // ── State readers ─────────────────────────────────────────────────────────

    function trackedTotalAssets() external view returns (uint256) {
        return _trackedTotalAssets;
    }

    function trackedIdleBalance() external view returns (uint256) {
        return _idleBalance();
    }

    function pendingShareLocks(address user) external view returns (uint256) {
        return _pendingShareLocks[user];
    }

    function pendingEpochs(address user) external view returns (uint256) {
        return _pendingEpochs[user];
    }

    function internalPendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }

    function pendingUsersLength() external view returns (uint256) {
        return _pendingUsers.length;
    }

    function pendingUserAt(uint256 i) external view returns (address) {
        return _pendingUsers[i];
    }

    function inPendingQueue(address user) external view returns (bool) {
        return _inPendingQueue[user];
    }

    // ── State setters (test-only) ─────────────────────────────────────────────

    function setTrackedTotalAssets(uint256 amount) external {
        _trackedTotalAssets = amount;
    }

    /// @dev Add a pending share lock for a user (test-only, for Tier-2 queue setup).
    function setPendingShareLocks(address user, uint256 shares) external {
        _pendingShareLocks[user] = shares;
    }

    function setCommissionsOwed(uint256 agentId, uint256 amount) external {
        commissionsOwed[agentId] = amount;
    }

    // ── Direct ERC20 minting (bypasses recordDeposit for state setup) ─────────

    function mintShares(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ── Pending queue helpers (test-only) ────────────────────────────────────

    /// @dev Add a user + amount to the Tier-2 pending queue directly,
    ///      bypassing processWithdraw (avoids share-lock side effects).
    ///      Also locks `shares` from the vault's own balance to mirror real Tier-2 flow.
    function addPendingUser(address user, uint256 amount, uint256 shares) external {
        _pendingWithdrawals[user] += amount;
        _pendingShareLocks[user]  += shares;
        _pendingEpochs[user]       = currentEpoch;
        if (!_inPendingQueue[user]) {
            _pendingUsers.push(user);
            _inPendingQueue[user] = true;
        }
    }

    // ── Direct epoch settlement (bypasses epochCheck for targeted tests) ──────

    function forceSettleEpoch() external {
        _settleEpoch();
    }
}
