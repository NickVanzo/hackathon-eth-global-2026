// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for requestWithdraw(), claimWithdraw(), release(), and updateSharePrice()
contract SatelliteWithdrawTest is SatelliteTestBase {

    // =========================================================================
    // requestWithdraw()
    // =========================================================================

    function test_requestWithdraw_emitsEvent() public {
        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.WithdrawRequested(alice, 1_000e6);

        vm.prank(alice);
        satellite.requestWithdraw(1_000e6);
    }

    function test_requestWithdraw_noStateChange() public {
        // requestWithdraw only emits; it changes no on-chain state
        uint256 satBalanceBefore   = usdc.balanceOf(address(satellite));
        uint256 sharePriceBefore   = satellite.cachedSharePrice();
        uint256 idleBalanceBefore  = satellite.idleBalance();

        vm.prank(alice);
        satellite.requestWithdraw(1_000e6);

        assertEq(usdc.balanceOf(address(satellite)), satBalanceBefore);
        assertEq(satellite.cachedSharePrice(),       sharePriceBefore);
        assertEq(satellite.idleBalance(),            idleBalanceBefore);
    }

    function test_requestWithdraw_anyCallerCanEmit() public {
        address randUser = makeAddr("rand");
        vm.prank(randUser);
        satellite.requestWithdraw(500e6); // should not revert
    }

    function test_requestWithdraw_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: zero amount");
        satellite.requestWithdraw(0);
    }

    function testFuzz_requestWithdraw_emitsCorrectAmount(uint256 amount) public {
        amount = bound(amount, 1, type(uint256).max);

        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.WithdrawRequested(alice, amount);

        vm.prank(alice);
        satellite.requestWithdraw(amount);
    }

    // =========================================================================
    // release() — Tier-1 instant withdrawal, messenger only
    // =========================================================================

    function test_release_transfersTokensToUser() public {
        _fundSatellite(10_000e6);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(messenger);
        satellite.release(alice, 1_000e6);

        assertEq(usdc.balanceOf(alice),             aliceBefore + 1_000e6);
        assertEq(usdc.balanceOf(address(satellite)), 9_000e6);
    }

    function test_release_emitsWithdrawalCompletedEvent() public {
        _fundSatellite(5_000e6);

        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.WithdrawalCompleted(alice, 2_000e6);

        vm.prank(messenger);
        satellite.release(alice, 2_000e6);
    }

    function test_release_exactlyIdleBalance_succeeds() public {
        _fundSatellite(1_000e6);

        vm.prank(messenger);
        satellite.release(alice, 1_000e6); // should not revert

        assertEq(usdc.balanceOf(address(satellite)), 0);
    }

    function test_release_reducesIdleBalance() public {
        _fundSatellite(10_000e6);
        uint256 idleBefore = satellite.idleBalance();

        vm.prank(messenger);
        satellite.release(alice, 3_000e6);

        assertEq(satellite.idleBalance(), idleBefore - 3_000e6);
    }

    function test_release_revertsWhenNotMessenger() public {
        _fundSatellite(10_000e6);

        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.release(alice, 1_000e6);
    }

    function test_release_revertsOnZeroUser() public {
        _fundSatellite(10_000e6);

        vm.prank(messenger);
        vm.expectRevert("Satellite: zero user");
        satellite.release(address(0), 1_000e6);
    }

    function test_release_revertsOnZeroAmount() public {
        _fundSatellite(10_000e6);

        vm.prank(messenger);
        vm.expectRevert("Satellite: zero amount");
        satellite.release(alice, 0);
    }

    function test_release_revertsWhenExceedsIdleBalance() public {
        _fundSatellite(1_000e6);

        vm.prank(messenger);
        vm.expectRevert("Satellite: insufficient idle balance");
        satellite.release(alice, 1_001e6);
    }

    function test_release_revertsWhenIdleBalanceIsZero() public {
        // No tokens in satellite at all
        vm.prank(messenger);
        vm.expectRevert("Satellite: insufficient idle balance");
        satellite.release(alice, 1);
    }

    function test_release_idleBalanceExcludedByProvingCapital() public {
        // Register an agent — this commits 5000 USDC.e as proving capital
        _fundSatellite(10_000e6);
        uint256 provingAmt = 5_000e6;
        usdc.mint(alice, provingAmt);
        _registerAgent(alice, agentEOA, provingAmt);

        // Satellite total = 15_000 but 5000 is proving capital → idle = 10_000
        assertEq(satellite.idleBalance(), 10_000e6);

        // Release exactly the idle amount should succeed
        vm.prank(messenger);
        satellite.release(bob, 10_000e6);

        assertEq(satellite.idleBalance(), 0);

        // Trying to release 1 more should fail (no idle left)
        vm.prank(messenger);
        vm.expectRevert("Satellite: insufficient idle balance");
        satellite.release(bob, 1);
    }

    // =========================================================================
    // claimWithdraw() — Tier-2 queued withdrawal
    // =========================================================================

    function test_claimWithdraw_transfersPendingToUser() public {
        _fundSatellite(5_000e6);
        satellite.setPendingWithdrawal(alice, 2_000e6);

        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        satellite.claimWithdraw();

        assertEq(usdc.balanceOf(alice),             aliceBefore + 2_000e6);
        assertEq(usdc.balanceOf(address(satellite)), 3_000e6);
    }

    function test_claimWithdraw_clearsPendingAfterClaim() public {
        _fundSatellite(1_000e6);
        satellite.setPendingWithdrawal(alice, 1_000e6);

        vm.prank(alice);
        satellite.claimWithdraw();

        assertEq(satellite.pendingWithdrawal(alice), 0);
    }

    function test_claimWithdraw_emitsWithdrawalCompletedEvent() public {
        _fundSatellite(3_000e6);
        satellite.setPendingWithdrawal(alice, 1_500e6);

        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.WithdrawalCompleted(alice, 1_500e6);

        vm.prank(alice);
        satellite.claimWithdraw();
    }

    function test_claimWithdraw_revertsWhenNoPendingAmount() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: nothing to claim");
        satellite.claimWithdraw();
    }

    function test_claimWithdraw_revertsOnDoubleClaim() public {
        _fundSatellite(1_000e6);
        satellite.setPendingWithdrawal(alice, 500e6);

        vm.prank(alice);
        satellite.claimWithdraw();

        vm.prank(alice);
        vm.expectRevert("Satellite: nothing to claim");
        satellite.claimWithdraw();
    }

    function test_claimWithdraw_twoUsersClaim_independently() public {
        _fundSatellite(3_000e6);
        satellite.setPendingWithdrawal(alice, 1_000e6);
        satellite.setPendingWithdrawal(bob,   2_000e6);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.prank(alice);
        satellite.claimWithdraw();

        vm.prank(bob);
        satellite.claimWithdraw();

        assertEq(usdc.balanceOf(alice), aliceBefore + 1_000e6);
        assertEq(usdc.balanceOf(bob),   bobBefore   + 2_000e6);
        assertEq(satellite.pendingWithdrawal(alice), 0);
        assertEq(satellite.pendingWithdrawal(bob),   0);
    }

    // =========================================================================
    // updateSharePrice() — messenger only
    // =========================================================================

    function test_updateSharePrice_updatesStoredValue() public {
        vm.prank(messenger);
        satellite.updateSharePrice(1.5e18);

        assertEq(satellite.cachedSharePrice(), 1.5e18);
    }

    function test_updateSharePrice_initialValueIsOneToOne() public {
        assertEq(satellite.cachedSharePrice(), 1e18);
    }

    function test_updateSharePrice_canUpdateMultipleTimes() public {
        vm.prank(messenger);
        satellite.updateSharePrice(1.2e18);

        vm.prank(messenger);
        satellite.updateSharePrice(0.9e18);

        assertEq(satellite.cachedSharePrice(), 0.9e18);
    }

    function test_updateSharePrice_revertsWhenNotMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.updateSharePrice(1.5e18);
    }

    function test_updateSharePrice_revertsOnZeroPrice() public {
        vm.prank(messenger);
        vm.expectRevert("Satellite: zero sharePrice");
        satellite.updateSharePrice(0);
    }

    function testFuzz_updateSharePrice_storesArbitraryPositivePrice(uint256 price) public {
        price = bound(price, 1, type(uint256).max);

        vm.prank(messenger);
        satellite.updateSharePrice(price);

        assertEq(satellite.cachedSharePrice(), price);
    }
}
