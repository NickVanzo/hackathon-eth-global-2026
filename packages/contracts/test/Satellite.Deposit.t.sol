// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for Satellite.deposit()
contract SatelliteDepositTest is SatelliteTestBase {

    // =========================================================================
    // Happy-path
    // =========================================================================

    function test_deposit_transfersTokensToSatellite() public {
        uint256 amount = 500e6;
        uint256 satBefore = usdc.balanceOf(address(satellite));

        _deposit(alice, amount);

        assertEq(usdc.balanceOf(address(satellite)), satBefore + amount, "satellite balance");
        assertEq(usdc.balanceOf(alice), 1_000_000e6 - amount, "alice balance");
    }

    function test_deposit_emitsDepositedEvent() public {
        uint256 amount = 1_000e6;

        vm.startPrank(alice);
        usdc.approve(address(satellite), amount);

        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.Deposited(alice, amount);

        satellite.deposit(amount);
        vm.stopPrank();
    }

    function test_deposit_multipleUsersAccumulate() public {
        _deposit(alice,   1_000e6);
        _deposit(bob,     2_000e6);
        _deposit(charlie, 3_000e6);

        assertEq(usdc.balanceOf(address(satellite)), 6_000e6);
    }

    function test_deposit_sameUserMultipleTimes() public {
        _deposit(alice, 1_000e6);
        _deposit(alice, 2_000e6);

        assertEq(usdc.balanceOf(address(satellite)), 3_000e6);
    }

    function test_deposit_minimumAmountOne() public {
        _deposit(alice, 1);

        assertEq(usdc.balanceOf(address(satellite)), 1);
    }

    function test_deposit_largeAmount() public {
        uint256 large = 1_000_000e6;
        usdc.mint(alice, large); // top-up so alice has enough

        vm.startPrank(alice);
        usdc.approve(address(satellite), large);
        satellite.deposit(large);
        vm.stopPrank();

        assertGe(usdc.balanceOf(address(satellite)), large);
    }

    // =========================================================================
    // Reverts
    // =========================================================================

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: zero amount");
        satellite.deposit(0);
    }

    function test_deposit_revertsWithoutApproval() public {
        vm.prank(alice);
        // No approval → SafeERC20 will revert
        vm.expectRevert();
        satellite.deposit(1_000e6);
    }

    function test_deposit_revertsWhenInsufficientBalance() public {
        address poorUser = makeAddr("poor");
        // poorUser has 0 USDC.e and tries to deposit
        vm.startPrank(poorUser);
        usdc.approve(address(satellite), 1_000e6);
        vm.expectRevert();
        satellite.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_deposit_revertsWhenApprovalLowerThanAmount() public {
        vm.startPrank(alice);
        usdc.approve(address(satellite), 500e6); // approve 500
        vm.expectRevert();
        satellite.deposit(1_000e6); // try to deposit 1000
        vm.stopPrank();
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_deposit_anyPositiveAmount(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(alice));

        vm.startPrank(alice);
        usdc.approve(address(satellite), amount);

        vm.expectEmit(true, false, false, true, address(satellite));
        emit ISatellite.Deposited(alice, amount);

        satellite.deposit(amount);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(satellite)), amount);
    }
}
