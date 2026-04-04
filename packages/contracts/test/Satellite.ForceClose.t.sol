// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteExecutionTestBase} from "./helpers/SatelliteExecutionTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for Satellite.forceClose() — source-filtered position closure.
///
/// Covers per project spec (Section 2.5):
///   - VAULT source closes only VAULT-tagged positions
///   - PROVING source closes only PROVING-tagged positions
///   - ALL source closes all positions (withdraw-from-arena)
///   - Proving capital returned to deployer
///   - VAULT capital stays in satellite as idle
///   - Position tracking cleaned up
///   - PositionClosed event emitted per position
///   - Length mismatch revert
contract SatelliteForceCloseTest is SatelliteExecutionTestBase {

    uint256 internal agentId;

    function setUp() public override {
        super.setUp();
        agentId = _registerAgent(deployer1, agentEOA, 10_000e6);
    }

    // =========================================================================
    // Source filtering
    // =========================================================================

    function test_forceClose_vaultSource_closesOnlyVaultPositions() public {
        uint256 provingPos = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);
        uint256 vaultPos   = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        assertEq(satellite.agentPositionCount(agentId), 2);

        uint256[] memory posIds = new uint256[](2);
        posIds[0] = provingPos;
        posIds[1] = vaultPos;
        bytes[] memory swapData = new bytes[](2);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.VAULT, swapData);

        // Only vault position closed; proving remains
        assertEq(satellite.agentPositionCount(agentId), 1);
        assertEq(satellite.positionAgent(provingPos), agentId); // still exists
        assertEq(satellite.positionAgent(vaultPos), 0);         // closed
    }

    function test_forceClose_provingSource_closesOnlyProvingPositions() public {
        uint256 provingPos = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);
        uint256 vaultPos   = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        uint256[] memory posIds = new uint256[](2);
        posIds[0] = provingPos;
        posIds[1] = vaultPos;
        bytes[] memory swapData = new bytes[](2);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.PROVING, swapData);

        // Only proving position closed; vault remains
        assertEq(satellite.agentPositionCount(agentId), 1);
        assertEq(satellite.positionAgent(provingPos), 0);       // closed
        assertEq(satellite.positionAgent(vaultPos), agentId);   // still exists
    }

    function test_forceClose_allSource_closesAllPositions() public {
        uint256 provingPos = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);
        uint256 vaultPos   = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        uint256[] memory posIds = new uint256[](2);
        posIds[0] = provingPos;
        posIds[1] = vaultPos;
        bytes[] memory swapData = new bytes[](2);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.ALL, swapData);

        assertEq(satellite.agentPositionCount(agentId), 0);
        assertEq(satellite.positionAgent(provingPos), 0);
        assertEq(satellite.positionAgent(vaultPos), 0);
    }

    // =========================================================================
    // Capital routing
    // =========================================================================

    function test_forceClose_provingCapitalReturnedToDeployer() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        uint256 deployerBefore = usdc.balanceOf(deployer1);

        uint256[] memory posIds = new uint256[](1);
        posIds[0] = tokenId;
        bytes[] memory swapData = new bytes[](1);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.PROVING, swapData);

        // Deployer received proving capital back
        uint256 deployerAfter = usdc.balanceOf(deployer1);
        assertGt(deployerAfter, deployerBefore);
    }

    function test_forceClose_provingCapitalTrackingDecremented() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        uint256 provingBefore = satellite.provingCapital(agentId);
        uint256 totalProvingBefore = satellite.totalProvingCapital();

        uint256[] memory posIds = new uint256[](1);
        posIds[0] = tokenId;
        bytes[] memory swapData = new bytes[](1);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.PROVING, swapData);

        // Proving capital tracking decremented
        assertLt(satellite.provingCapital(agentId), provingBefore);
        assertLt(satellite.totalProvingCapital(), totalProvingBefore);
    }

    function test_forceClose_vaultCapitalStaysInSatelliteAsIdle() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        uint256 deployerBefore = usdc.balanceOf(deployer1);

        uint256[] memory posIds = new uint256[](1);
        posIds[0] = tokenId;
        bytes[] memory swapData = new bytes[](1);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.VAULT, swapData);

        // Deployer balance unchanged — vault capital stays in satellite
        assertEq(usdc.balanceOf(deployer1), deployerBefore);
    }

    // =========================================================================
    // Events
    // =========================================================================

    function test_forceClose_emitsPositionClosedPerPosition() public {
        uint256 pos1 = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);
        uint256 pos2 = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        uint256[] memory posIds = new uint256[](2);
        posIds[0] = pos1;
        posIds[1] = pos2;
        bytes[] memory swapData = new bytes[](2);

        // Expect two PositionClosed events
        vm.expectEmit(true, true, false, false);
        emit ISatellite.PositionClosed(agentId, pos1, 0);
        vm.expectEmit(true, true, false, false);
        emit ISatellite.PositionClosed(agentId, pos2, 0);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.ALL, swapData);
    }

    // =========================================================================
    // Input validation
    // =========================================================================

    function test_forceClose_revertsOnLengthMismatch() public {
        uint256[] memory posIds = new uint256[](2);
        bytes[] memory swapData = new bytes[](1); // mismatch

        vm.prank(messenger);
        vm.expectRevert("Satellite: length mismatch");
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.ALL, swapData);
    }

    function test_forceClose_emptyArraysIsNoOp() public {
        uint256[] memory posIds = new uint256[](0);
        bytes[] memory swapData = new bytes[](0);

        vm.prank(messenger);
        satellite.forceClose(agentId, posIds, IShared.ForceCloseSource.ALL, swapData);
        // No revert
    }

    // =========================================================================
    // Mixed source with ALL
    // =========================================================================

    function test_forceClose_allSourceReturnsProvingToDeployerAndKeepsVault() public {
        _openSimplePosition(agentId, 500e6, IShared.ForceCloseSource.PROVING);
        _openSimplePosition(agentId, 500e6, IShared.ForceCloseSource.VAULT);

        uint256 deployerBefore = usdc.balanceOf(deployer1);
        uint256[] memory positions = satellite.getAgentPositions(agentId);
        bytes[] memory swapData = new bytes[](positions.length);

        vm.prank(messenger);
        satellite.forceClose(agentId, positions, IShared.ForceCloseSource.ALL, swapData);

        // All positions closed
        assertEq(satellite.agentPositionCount(agentId), 0);
        // Deployer got proving capital back
        assertGt(usdc.balanceOf(deployer1), deployerBefore);
    }

    function test_forceClose_noDeployerRevert_whenOnlyVaultPositions() public {
        _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);

        uint256[] memory positions = satellite.getAgentPositions(agentId);
        bytes[] memory swapData = new bytes[](positions.length);

        vm.prank(messenger);
        satellite.forceClose(agentId, positions, IShared.ForceCloseSource.VAULT, swapData);
        // No revert — totalRecoveredProving is 0, so deployer transfer is skipped
    }
}
