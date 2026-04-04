// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {Vm} from "forge-std/Vm.sol";

/// @notice Tests for Vault.processWithdraw() — Tier-1 (instant) and Tier-2 (queued).
contract VaultWithdrawTest is VaultTestBase {

    // =========================================================================
    // Tier-1 — instant release (tokenAmount ≤ idleBalance)
    // =========================================================================

    function test_processWithdraw_tier1_emitsWithdrawApproved() public {
        _seedVault(alice, TEN_K_USDC);

        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.WithdrawApproved(alice, TEN_K_USDC);

        _processWithdraw(alice, TEN_K_USDC);
    }

    function test_processWithdraw_tier1_burnsShares() public {
        _seedVault(alice, TEN_K_USDC);
        uint256 supplyBefore = vault.totalSupply();

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.balanceOf(alice), 0,                       "alice shares zero");
        assertEq(vault.totalSupply(),    supplyBefore - TEN_K_USDC, "supply decremented");
    }

    function test_processWithdraw_tier1_decrementsIdleBalance() public {
        _seedVault(alice, TEN_K_USDC);

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.trackedIdleBalance(), 0);
    }

    function test_processWithdraw_tier1_decrementsTotalAssets() public {
        _seedVault(alice, TEN_K_USDC);

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.trackedTotalAssets(), 0);
    }

    function test_processWithdraw_tier1_partialWithdraw() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 halfShares = TEN_K_USDC / 2;
        _processWithdraw(alice, halfShares);

        assertEq(vault.balanceOf(alice),         halfShares,  "remaining shares");
        assertEq(vault.trackedIdleBalance(),      halfShares,  "remaining idle");
        assertEq(vault.trackedTotalAssets(),      halfShares,  "remaining assets");
    }

    function test_processWithdraw_tier1_noPendingEntry() public {
        _seedVault(alice, TEN_K_USDC);

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.internalPendingWithdrawal(alice), 0, "no pending entry");
        assertFalse(vault.inPendingQueue(alice),             "not in queue");
        assertEq(vault.pendingUsersLength(),             0, "queue empty");
    }

    function test_processWithdraw_tier1_exactlyAtIdleBoundary() public {
        _seedVault(alice, TEN_K_USDC);
        // Reduce idle to exactly tokenAmount
        uint256 halfIdle = TEN_K_USDC / 2;
        vault.setTrackedIdleBalance(halfIdle);

        // Withdraw half the shares (tokenAmount = halfIdle = idle)
        // tokenAmount <= idle → Tier-1
        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.WithdrawApproved(alice, halfIdle);

        _processWithdraw(alice, halfIdle);
    }

    // =========================================================================
    // Tier-2 — queued release (tokenAmount > idleBalance)
    // =========================================================================

    function test_processWithdraw_tier2_queuesWhenInsufficientIdle() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0); // no idle

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.internalPendingWithdrawal(alice), TEN_K_USDC, "pending amount");
    }

    function test_processWithdraw_tier2_noImmediateWithdrawApproved() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        // No WithdrawApproved should fire
        vm.recordLogs();
        _processWithdraw(alice, TEN_K_USDC);

        // Check no WithdrawApproved was emitted
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topicSig = keccak256("WithdrawApproved(address,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != topicSig, "unexpected WithdrawApproved");
        }
    }

    function test_processWithdraw_tier2_burnsSharesImmediately() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.balanceOf(alice), 0,   "shares burned");
        assertEq(vault.totalSupply(),    0,   "supply zero");
    }

    function test_processWithdraw_tier2_doesNotDecrementTotalAssets() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice, TEN_K_USDC);

        // totalAssets stays; it will be decremented when WithdrawApproved fires at epoch
        assertEq(vault.trackedTotalAssets(), TEN_K_USDC, "totalAssets unchanged");
    }

    function test_processWithdraw_tier2_addsUserToPendingQueue() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice, TEN_K_USDC);

        assertTrue(vault.inPendingQueue(alice),  "alice in queue");
        assertEq(vault.pendingUsersLength(), 1,  "queue length 1");
        assertEq(vault.pendingUserAt(0), alice,  "alice at index 0");
    }

    function test_processWithdraw_tier2_doesNotDuplicateUser() public {
        _seedVault(alice, 2 * TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        // Two separate queued withdrawals — share price changes between calls
        // because burning shares without decrementing totalAssets inflates value.
        _processWithdraw(alice, TEN_K_USDC);
        _processWithdraw(alice, TEN_K_USDC);

        // Key assertion: alice is only in the queue once, even after two requests
        assertEq(vault.pendingUsersLength(), 1, "queue still 1");
        assertTrue(vault.inPendingQueue(alice),  "alice in queue");
        // Pending amount should be > 0 (exact value depends on share-price at each call)
        assertGt(vault.internalPendingWithdrawal(alice), 0, "has pending amount");
    }

    function test_processWithdraw_tier2_multipleUsersQueued() public {
        _seedVault(alice,   TEN_K_USDC);
        _seedVault(bob,     TEN_K_USDC);
        _seedVault(charlie, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice,   TEN_K_USDC);
        _processWithdraw(bob,     TEN_K_USDC);
        _processWithdraw(charlie, TEN_K_USDC);

        assertEq(vault.pendingUsersLength(), 3, "three users queued");
        assertTrue(vault.inPendingQueue(alice),   "alice queued");
        assertTrue(vault.inPendingQueue(bob),     "bob queued");
        assertTrue(vault.inPendingQueue(charlie), "charlie queued");
    }

    // =========================================================================
    // Reverts
    // =========================================================================

    function test_processWithdraw_revertsOnZeroUser() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: zero user");
        vault.processWithdraw(address(0), 100);
    }

    function test_processWithdraw_revertsOnZeroShares() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: zero shares");
        vault.processWithdraw(alice, 0);
    }

    function test_processWithdraw_revertsOnInsufficientShares() public {
        _seedVault(alice, TEN_K_USDC);

        vm.prank(messenger);
        vm.expectRevert("Vault: insufficient shares");
        vault.processWithdraw(alice, TEN_K_USDC + 1);
    }

    function test_processWithdraw_revertsWhenUserHasNoShares() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: insufficient shares");
        vault.processWithdraw(alice, 1);
    }

    // =========================================================================
    // pendingWithdrawal public view
    // =========================================================================

    function test_pendingWithdrawal_view_returnsZeroByDefault() public {
        assertEq(vault.pendingWithdrawal(alice), 0);
    }

    function test_pendingWithdrawal_view_reflectsTier2Entry() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.pendingWithdrawal(alice), TEN_K_USDC);
    }

    // =========================================================================
    // EpochCheck integration
    // =========================================================================

    function test_processWithdraw_triggersSettlementWhenEpochElapsed() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 epochBefore = vault.currentEpoch();
        agentMgr.setSettlementData(_emptySettlement());
        _rollPastEpoch();

        _processWithdraw(alice, TEN_K_USDC);

        assertEq(vault.currentEpoch(), epochBefore + 1, "epoch advanced");
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_processWithdraw_tier1_anyAmount(uint128 amount) public {
        vm.assume(amount > 0);

        _seedVault(alice, uint256(amount));

        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.WithdrawApproved(alice, uint256(amount));

        _processWithdraw(alice, uint256(amount));

        assertEq(vault.balanceOf(alice),         0, "shares zero");
        assertEq(vault.trackedIdleBalance(), 0, "idle zero");
        assertEq(vault.trackedTotalAssets(), 0, "assets zero");
    }

    function testFuzz_processWithdraw_tier2_anyAmount(uint128 amount) public {
        vm.assume(amount > 0);

        _seedVault(alice, uint256(amount));
        vault.setTrackedIdleBalance(0); // force Tier-2

        _processWithdraw(alice, uint256(amount));

        assertEq(vault.internalPendingWithdrawal(alice), uint256(amount));
        assertEq(vault.balanceOf(alice), 0, "shares burned");
    }
}
