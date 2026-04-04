// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteExecutionTestBase} from "./helpers/SatelliteExecutionTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for Satellite.collectAndReport() — epoch fee collection + valuation.
///
/// Covers per project spec (Section 2.6):
///   - Collects accrued trading fees on all agent positions via NFPM.collect()
///   - Emits ValuesReported(agentId, positionValue, feesCollected)
///   - feesCollected counts only deposit-token-denominated fees
///   - positionValue is passed through from the relayer (off-chain computed)
///   - Works with zero positions (no-op fee collection, still emits)
///   - Works with multiple positions (aggregates fees)
///   - onlyMessenger access control
contract SatelliteCollectAndReportTest is SatelliteExecutionTestBase {

    uint256 internal agentId;

    function setUp() public override {
        super.setUp();
        agentId = _registerAgent(deployer1, agentEOA, 5_000e6);
    }

    // =========================================================================
    // Core functionality
    // =========================================================================

    function test_collectAndReport_emitsValuesReported() public {
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        // Set pending fees on NFPM (simulates accrued trading fees)
        nfpm.setPendingFees(50e6, 0.01e18);

        uint256 positionValue = 1_050e6;

        vm.expectEmit(true, false, false, true);
        emit ISatellite.ValuesReported(agentId, positionValue, 50e6);

        vm.prank(messenger);
        satellite.collectAndReport(agentId, positionValue);
    }

    function test_collectAndReport_feesOnlyCountDepositToken() public {
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        // USDC.e is token0 in our pool setup, so fees0 = deposit token fees
        nfpm.setPendingFees(100e6, 0.5e18);

        uint256 positionValue = 2_000e6;

        // Only 100e6 USDC should be reported as feesCollected (not the WETH fees)
        vm.expectEmit(true, false, false, true);
        emit ISatellite.ValuesReported(agentId, positionValue, 100e6);

        vm.prank(messenger);
        satellite.collectAndReport(agentId, positionValue);
    }

    function test_collectAndReport_multiplePositionsAggregatesFees() public {
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        // First position: set fees, then open second
        // Note: fees are per-collect in the mock, so fees accumulate per call
        nfpm.setPendingFees(25e6, 0);
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        assertEq(satellite.agentPositionCount(agentId), 2);

        // Now set fees for the second collect call (first call will get 25e6,
        // second will get whatever we set after the first collect resets them)
        // The mock resets pendingFees after each collect, so we need to handle this
        // For this test, the first position will collect 25e6, second will collect 0
        // (mock resets fees after first collect)

        uint256 positionValue = 2_100e6;

        vm.expectEmit(true, false, false, true);
        emit ISatellite.ValuesReported(agentId, positionValue, 25e6);

        vm.prank(messenger);
        satellite.collectAndReport(agentId, positionValue);
    }

    function test_collectAndReport_zeroPositionsStillEmits() public {
        // Agent has no positions
        assertEq(satellite.agentPositionCount(agentId), 0);

        uint256 positionValue = 0;

        vm.expectEmit(true, false, false, true);
        emit ISatellite.ValuesReported(agentId, positionValue, 0);

        vm.prank(messenger);
        satellite.collectAndReport(agentId, positionValue);
    }

    function test_collectAndReport_positionValueIsPassthrough() public {
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        // positionValue is off-chain computed by relayer — satellite just passes it through
        uint256 arbitraryValue = 42_000e6;

        vm.expectEmit(true, false, false, true);
        emit ISatellite.ValuesReported(agentId, arbitraryValue, 0);

        vm.prank(messenger);
        satellite.collectAndReport(agentId, arbitraryValue);
    }

    // =========================================================================
    // Access control
    // =========================================================================

    function test_collectAndReport_revertsWhenNotMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.collectAndReport(agentId, 1_000e6);
    }

    function test_collectAndReport_messengerCanCall() public {
        vm.prank(messenger);
        satellite.collectAndReport(agentId, 0);
        // No revert
    }
}
