// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";

/// @notice Tests for idleBalance() and pendingWithdrawal() view functions.
///
/// idleBalance() formula:
///   total = IERC20(depositToken).balanceOf(address(this))
///   committed = protocolReserve + _totalCommissionReserves + _totalProvingCapital
///   idle = total > committed ? total - committed : 0
contract SatelliteIdleBalanceTest is SatelliteTestBase {

    // =========================================================================
    // idleBalance() — base cases
    // =========================================================================

    function test_idleBalance_zeroWhenNoTokens() public {
        assertEq(satellite.idleBalance(), 0);
    }

    function test_idleBalance_equalsFullBalanceWhenNoReserves() public {
        _fundSatellite(10_000e6);

        assertEq(satellite.idleBalance(), 10_000e6);
    }

    function test_idleBalance_equalsFullBalanceAfterDeposit() public {
        _deposit(alice, 5_000e6);

        assertEq(satellite.idleBalance(), 5_000e6);
    }

    // =========================================================================
    // idleBalance() — protocol reserve
    // =========================================================================

    function test_idleBalance_subtractsProtocolReserve() public {
        _fundSatellite(10_000e6);
        _reserveFees(2_000e6, 0, 0);

        assertEq(satellite.idleBalance(), 8_000e6);
    }

    function test_idleBalance_zeroWhenProtocolReserveEqualsBalance() public {
        _fundSatellite(1_000e6);
        _reserveFees(1_000e6, 0, 0);

        assertEq(satellite.idleBalance(), 0);
    }

    function test_idleBalance_zeroWhenProtocolReserveExceedsBalance() public {
        // Reserve > balance → should return 0, not underflow
        _fundSatellite(500e6);
        _reserveFees(1_000e6, 0, 0); // over-reserved (pathological state)

        assertEq(satellite.idleBalance(), 0);
    }

    // =========================================================================
    // idleBalance() — commission reserves
    // =========================================================================

    function test_idleBalance_subtractsTotalCommissionReserves() public {
        _fundSatellite(10_000e6);
        _reserveFees(0, 1, 3_000e6);

        assertEq(satellite.idleBalance(), 7_000e6);
    }

    function test_idleBalance_subtractsCommissionsForMultipleAgents() public {
        _fundSatellite(10_000e6);
        _reserveFees(0, 1, 1_000e6);
        _reserveFees(0, 2, 2_000e6);
        _reserveFees(0, 3, 3_000e6);

        // total commissions = 6000
        assertEq(satellite.idleBalance(), 4_000e6);
    }

    // =========================================================================
    // idleBalance() — proving capital
    // =========================================================================

    function test_idleBalance_subtractsProvingCapital() public {
        _fundSatellite(10_000e6);
        _registerAgent(alice, agentEOA, 2_000e6);

        // satellite balance = 10_000 (funded) + 2_000 (proving) = 12_000
        // committed = 2_000 (proving)
        // idle = 10_000
        assertEq(satellite.idleBalance(), 10_000e6);
    }

    function test_idleBalance_subtractsMultipleAgentsProvingCapital() public {
        _fundSatellite(10_000e6);
        _registerAgent(alice,   agentEOA,         1_000e6);
        _registerAgent(bob,     makeAddr("ag2"),  2_000e6);
        _registerAgent(charlie, makeAddr("ag3"),  3_000e6);

        // satellite = 10_000 + 1_000 + 2_000 + 3_000 = 16_000
        // proving   = 6_000
        // idle      = 10_000
        assertEq(satellite.idleBalance(), 10_000e6);
    }

    function test_idleBalance_provingCapitalDoesNotAffectDepositorsFunds() public {
        _deposit(alice, 5_000e6);
        _registerAgent(bob, agentEOA, 2_000e6);

        // satellite balance = 5_000 + 2_000 = 7_000
        // committed = 2_000 (proving)
        // idle = 5_000
        assertEq(satellite.idleBalance(), 5_000e6);
    }

    // =========================================================================
    // idleBalance() — all three reserves combined
    // =========================================================================

    function test_idleBalance_subtractsAllThreeReserves() public {
        _fundSatellite(20_000e6);

        // Protocol reserve: 2_000
        _reserveFees(2_000e6, 0, 0);

        // Commission reserve: 3_000 (two agents)
        _reserveFees(0, 1, 1_000e6);
        _reserveFees(0, 2, 2_000e6);

        // Proving capital: 5_000
        _registerAgent(alice, agentEOA, 5_000e6);

        // satellite = 20_000 + 5_000 = 25_000
        // committed = 2_000 + 3_000 + 5_000 = 10_000
        // idle = 15_000
        assertEq(satellite.idleBalance(), 15_000e6);
    }

    function test_idleBalance_zeroWhenAllBalanceIsCommitted() public {
        // 10_000 total: 4_000 protocol + 3_000 commission + 3_000 proving = 10_000
        _fundSatellite(7_000e6);          // extra liquidity to cover proving transfer
        _registerAgent(alice, agentEOA, 3_000e6); // proves 3_000 (satellite += 3_000, total = 10_000)
        _reserveFees(4_000e6, 0, 0);
        _reserveFees(0, 1, 3_000e6);

        assertEq(satellite.idleBalance(), 0);
    }

    // =========================================================================
    // idleBalance() — after release (tokens leave)
    // =========================================================================

    function test_idleBalance_decreasesAfterRelease() public {
        _fundSatellite(10_000e6);

        vm.prank(messenger);
        satellite.release(alice, 4_000e6);

        assertEq(satellite.idleBalance(), 6_000e6);
    }

    function test_idleBalance_zeroAfterFullRelease() public {
        _fundSatellite(10_000e6);

        vm.prank(messenger);
        satellite.release(alice, 10_000e6);

        assertEq(satellite.idleBalance(), 0);
    }

    // =========================================================================
    // pendingWithdrawal() view
    // =========================================================================

    function test_pendingWithdrawal_zeroByDefault() public {
        assertEq(satellite.pendingWithdrawal(alice), 0);
    }

    function test_pendingWithdrawal_returnsSetAmount() public {
        satellite.setPendingWithdrawal(alice, 1_500e6);

        assertEq(satellite.pendingWithdrawal(alice), 1_500e6);
    }

    function test_pendingWithdrawal_zeroPendingForOtherUsers() public {
        satellite.setPendingWithdrawal(alice, 1_000e6);

        assertEq(satellite.pendingWithdrawal(bob),  0, "bob unaffected");
        assertEq(satellite.pendingWithdrawal(alice), 1_000e6);
    }

    function test_pendingWithdrawal_clearedAfterClaim() public {
        _fundSatellite(1_000e6);
        satellite.setPendingWithdrawal(alice, 1_000e6);

        vm.prank(alice);
        satellite.claimWithdraw();

        assertEq(satellite.pendingWithdrawal(alice), 0);
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_idleBalance_isNeverNegative(
        uint256 funding,
        uint256 protocolFee,
        uint256 commission,
        uint256 provingAmt
    ) public {
        funding    = bound(funding,    0, 10_000_000e6);
        protocolFee = bound(protocolFee, 0, 1_000_000e6);
        commission  = bound(commission, 0, 1_000_000e6);
        provingAmt  = bound(provingAmt,  1, usdc.balanceOf(alice));

        _fundSatellite(funding);
        _reserveFees(protocolFee, 0, commission);

        // Register with alice's real tokens so the transfer succeeds
        _registerAgent(alice, agentEOA, provingAmt);

        // idleBalance() must never revert and must be >= 0
        uint256 idle = satellite.idleBalance();
        assertGe(idle, 0); // trivially true for uint — guards against revert
    }

    function testFuzz_idleBalance_depositIncreasesIdleOneToOne(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(alice));

        uint256 before = satellite.idleBalance();
        _deposit(alice, amount);

        assertEq(satellite.idleBalance(), before + amount);
    }
}
