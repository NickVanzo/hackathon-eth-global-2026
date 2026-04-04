// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for reserveProtocolFees(), reserveCommission(), claimProtocolFees(),
///         claimCommissions(), and releaseCommission()
contract SatelliteFeesTest is SatelliteTestBase {

    // =========================================================================
    // reserveProtocolFees()
    // =========================================================================

    function test_reserveProtocolFees_updatesProtocolReserve() public {
        _reserveProtocolFees(1_000e6);

        assertEq(satellite.protocolReserve(), 1_000e6);
        assertEq(satellite.totalCommissionReserves(), 0);
    }

    function test_reserveProtocolFees_multipleCallsAccumulate() public {
        _reserveProtocolFees(100e6);
        _reserveProtocolFees(200e6);
        _reserveProtocolFees(300e6);

        assertEq(satellite.protocolReserve(), 600e6);
    }

    function test_reserveProtocolFees_revertsOnZeroAmount() public {
        vm.prank(messenger);
        vm.expectRevert("Satellite: zero amount");
        satellite.reserveProtocolFees(0);
    }

    function test_reserveProtocolFees_revertsWhenNotMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.reserveProtocolFees(100e6);
    }

    // =========================================================================
    // reserveCommission()
    // =========================================================================

    function test_reserveCommission_updatesCommissionReserveAndTotal() public {
        _registerAgent(alice, agentEOA, 1_000e6); // creates agentId = 1

        _reserveCommission(1, 500e6);

        assertEq(satellite.commissionReserve(1), 500e6,   "per-agent commission");
        assertEq(satellite.totalCommissionReserves(), 500e6, "total commissions");
        assertEq(satellite.protocolReserve(), 0,          "protocol reserve untouched");
    }

    function test_reserveCommission_accumulatesPerAgent() public {
        _registerAgent(alice, agentEOA, 1_000e6); // id = 1

        _reserveCommission(1, 100e6);
        _reserveCommission(1, 200e6);

        assertEq(satellite.commissionReserve(1), 300e6);
        assertEq(satellite.totalCommissionReserves(), 300e6);
    }

    function test_reserveCommission_forMultipleAgents() public {
        _registerAgent(alice, agentEOA,         1_000e6); // id = 1
        _registerAgent(bob,   makeAddr("ag2"),  1_000e6); // id = 2

        _reserveCommission(1, 100e6);
        _reserveCommission(2, 400e6);

        assertEq(satellite.commissionReserve(1), 100e6);
        assertEq(satellite.commissionReserve(2), 400e6);
        assertEq(satellite.totalCommissionReserves(), 500e6);
    }

    function test_reserveCommission_revertsOnZeroAmount() public {
        vm.prank(messenger);
        vm.expectRevert("Satellite: zero amount");
        satellite.reserveCommission(1, 0);
    }

    function test_reserveCommission_revertsWhenNotMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.reserveCommission(1, 100e6);
    }

    // =========================================================================
    // claimProtocolFees()
    // =========================================================================

    function test_claimProtocolFees_transfersToTreasury() public {
        _fundSatellite(1_000e6);
        _reserveProtocolFees(1_000e6);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(treasury);
        satellite.claimProtocolFees();

        assertEq(usdc.balanceOf(treasury),            treasuryBefore + 1_000e6);
        assertEq(usdc.balanceOf(address(satellite)),  0);
    }

    function test_claimProtocolFees_clearsProtocolReserve() public {
        _fundSatellite(500e6);
        _reserveProtocolFees(500e6);

        vm.prank(treasury);
        satellite.claimProtocolFees();

        assertEq(satellite.protocolReserve(), 0);
    }

    function test_claimProtocolFees_claimsEntireReserveAtOnce() public {
        _fundSatellite(3_000e6);
        _reserveProtocolFees(1_000e6);
        _reserveProtocolFees(2_000e6);

        vm.prank(treasury);
        satellite.claimProtocolFees();

        assertEq(usdc.balanceOf(treasury), 3_000e6);
        assertEq(satellite.protocolReserve(), 0);
    }

    function test_claimProtocolFees_revertsWhenCallerIsNotTreasury() public {
        _fundSatellite(1_000e6);
        _reserveProtocolFees(1_000e6);

        vm.prank(alice);
        vm.expectRevert("Satellite: not treasury");
        satellite.claimProtocolFees();
    }

    function test_claimProtocolFees_revertsWhenNoFeesAccrued() public {
        vm.prank(treasury);
        vm.expectRevert("Satellite: no fees");
        satellite.claimProtocolFees();
    }

    function test_claimProtocolFees_revertsOnDoubleClaim() public {
        _fundSatellite(500e6);
        _reserveProtocolFees(500e6);

        vm.prank(treasury);
        satellite.claimProtocolFees();

        vm.prank(treasury);
        vm.expectRevert("Satellite: no fees");
        satellite.claimProtocolFees();
    }

    // =========================================================================
    // claimCommissions() — intent-emission only, no state change
    // =========================================================================

    function test_claimCommissions_emitsCommissionClaimRequestedEvent() public {
        uint256 agentId = 7; // arbitrary — satellite doesn't validate it

        vm.expectEmit(true, true, false, false, address(satellite));
        emit ISatellite.CommissionClaimRequested(agentId, alice);

        vm.prank(alice);
        satellite.claimCommissions(agentId);
    }

    function test_claimCommissions_anyCallerCanEmit() public {
        // Permission check happens on 0G — the satellite just emits
        vm.prank(makeAddr("random"));
        satellite.claimCommissions(42); // should not revert
    }

    function test_claimCommissions_noStateChange() public {
        uint256 protocolBefore    = satellite.protocolReserve();
        uint256 commissionBefore  = satellite.commissionReserve(1);
        uint256 idleBefore        = satellite.idleBalance();

        vm.prank(alice);
        satellite.claimCommissions(1);

        assertEq(satellite.protocolReserve(),  protocolBefore);
        assertEq(satellite.commissionReserve(1), commissionBefore);
        assertEq(satellite.idleBalance(),        idleBefore);
    }

    // =========================================================================
    // releaseCommission()
    // =========================================================================

    function test_releaseCommission_transfersToCallerAddress() public {
        _fundSatellite(1_000e6);
        _registerAgent(alice, agentEOA, 1_000e6);
        _reserveCommission(1, 500e6);

        // Give satellite enough physical tokens (already done via _fundSatellite + registerAgent pulled in)
        // satellite holds 2000: 1000 from _fundSatellite + 1000 proving capital
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(messenger);
        satellite.releaseCommission(alice, 500e6);

        assertEq(usdc.balanceOf(alice), aliceBefore + 500e6);
    }

    function test_releaseCommission_decrementsTotal_CommissionReserves() public {
        _fundSatellite(1_000e6);
        _reserveCommission(0, 800e6);

        assertEq(satellite.totalCommissionReserves(), 800e6);

        vm.prank(messenger);
        satellite.releaseCommission(alice, 300e6);

        assertEq(satellite.totalCommissionReserves(), 500e6);
    }

    function test_releaseCommission_fullAmountCanBeReleased() public {
        _fundSatellite(1_000e6);
        _reserveCommission(0, 1_000e6);

        vm.prank(messenger);
        satellite.releaseCommission(alice, 1_000e6);

        assertEq(satellite.totalCommissionReserves(), 0);
    }

    function test_releaseCommission_revertsWhenNotMessenger() public {
        _fundSatellite(1_000e6);
        _reserveCommission(0, 500e6);

        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.releaseCommission(alice, 100e6);
    }

    function test_releaseCommission_revertsOnZeroAmount() public {
        vm.prank(messenger);
        vm.expectRevert("Satellite: zero amount");
        satellite.releaseCommission(alice, 0);
    }

    function test_releaseCommission_revertsOnZeroCaller() public {
        vm.prank(messenger);
        vm.expectRevert("Satellite: zero caller");
        satellite.releaseCommission(address(0), 100e6);
    }

    function test_releaseCommission_revertsWhenOverRelease_underflows() public {
        // _totalCommissionReserves = 0 → subtraction underflows in Solidity 0.8
        _fundSatellite(1_000e6);

        vm.prank(messenger);
        vm.expectRevert(); // arithmetic underflow
        satellite.releaseCommission(alice, 1);
    }

    function test_releaseCommission_revertsWhenAmountExceedsTotal() public {
        _fundSatellite(1_000e6);
        _reserveCommission(0, 500e6);

        vm.prank(messenger);
        vm.expectRevert(); // underflow: 500 - 600
        satellite.releaseCommission(alice, 600e6);
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_reserveFees_protocolAndCommissionAccumulate(
        uint256 protocolFee,
        uint256 commission
    ) public {
        protocolFee = bound(protocolFee, 1, 1_000_000e6);
        commission  = bound(commission, 1, 1_000_000e6);

        _reserveProtocolFees(protocolFee);
        _reserveCommission(99, commission);

        assertEq(satellite.protocolReserve(),         protocolFee);
        assertEq(satellite.commissionReserve(99),     commission);
        assertEq(satellite.totalCommissionReserves(), commission);
    }
}
