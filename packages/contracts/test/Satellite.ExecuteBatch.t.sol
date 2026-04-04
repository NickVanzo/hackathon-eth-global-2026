// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteExecutionTestBase} from "./helpers/SatelliteExecutionTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for Satellite.executeBatch() — OPEN, CLOSE, MODIFY position flows.
///
/// Covers per project spec (Section 2.2):
///   - OPEN_POSITION: zap-in via Universal Router + mint LP via NFPM
///   - CLOSE_POSITION: decrease liquidity + collect + zap-out + burn
///   - MODIFY_POSITION: close old + open new
///   - Position NFT tracking (positionSource, positionAgent, _agentPositions)
///   - Source tagging at mint time (PROVING / VAULT)
///   - PositionClosed event emission on close/modify
contract SatelliteExecuteBatchTest is SatelliteExecutionTestBase {

    uint256 internal agentId;

    function setUp() public override {
        super.setUp();
        agentId = _registerAgent(deployer1, agentEOA, 5_000e6);
    }

    // =========================================================================
    // OPEN_POSITION
    // =========================================================================

    function test_open_mintsPositionAndTracksIt() public {
        nfpm.setMintConsumption(1_000e6, 0);
        uint256 expectedTokenId = nfpm.nextTokenId();

        IShared.Intent memory intent = _openIntent(
            agentId, 1_000e6, -200, 200, bytes(""), IShared.ForceCloseSource.PROVING
        );
        _executeSingleIntent(intent);

        // Position tracked
        assertEq(satellite.positionAgent(expectedTokenId), agentId);
        assertEq(satellite.agentPositionCount(agentId), 1);

        uint256[] memory positions = satellite.getAgentPositions(agentId);
        assertEq(positions.length, 1);
        assertEq(positions[0], expectedTokenId);
    }

    function test_open_setsSourceTagProving() public {
        nfpm.setMintConsumption(1_000e6, 0);
        uint256 tokenId = nfpm.nextTokenId();

        _executeSingleIntent(
            _openIntent(agentId, 1_000e6, -100, 100, bytes(""), IShared.ForceCloseSource.PROVING)
        );

        assertEq(uint256(satellite.positionSource(tokenId)), uint256(IShared.ForceCloseSource.PROVING));
    }

    function test_open_setsSourceTagVault() public {
        nfpm.setMintConsumption(1_000e6, 0);
        uint256 tokenId = nfpm.nextTokenId();

        _executeSingleIntent(
            _openIntent(agentId, 1_000e6, -100, 100, bytes(""), IShared.ForceCloseSource.VAULT)
        );

        assertEq(uint256(satellite.positionSource(tokenId)), uint256(IShared.ForceCloseSource.VAULT));
    }

    function test_open_multiplePositionsSameAgent() public {
        nfpm.setMintConsumption(500e6, 0);

        _executeSingleIntent(
            _openIntent(agentId, 500e6, -100, 100, bytes(""), IShared.ForceCloseSource.PROVING)
        );
        _executeSingleIntent(
            _openIntent(agentId, 500e6, -200, 200, bytes(""), IShared.ForceCloseSource.VAULT)
        );

        assertEq(satellite.agentPositionCount(agentId), 2);
        uint256[] memory positions = satellite.getAgentPositions(agentId);
        assertEq(positions.length, 2);
    }

    function test_open_withZapInSwap() public {
        // Configure router: swap 500 USDC for 0.25 WETH
        router.setSwap(address(usdc), address(weth), 500e6, 0.25e18);
        // NFPM will consume the remaining USDC + swapped WETH
        nfpm.setMintConsumption(500e6, 0.25e18);

        uint256 tokenId = nfpm.nextTokenId();

        // Non-empty swapCalldata triggers the Universal Router call
        _executeSingleIntent(
            _openIntent(agentId, 1_000e6, -100, 100, hex"01", IShared.ForceCloseSource.VAULT)
        );

        assertEq(satellite.positionAgent(tokenId), agentId);
        assertEq(router.callCount(), 1);
    }

    function test_open_batchMultipleIntents() public {
        nfpm.setMintConsumption(100e6, 0);

        IShared.Intent[] memory batch = new IShared.Intent[](3);
        batch[0] = _openIntent(agentId, 100e6, -100, 100, bytes(""), IShared.ForceCloseSource.PROVING);
        batch[1] = _openIntent(agentId, 100e6, -200, 200, bytes(""), IShared.ForceCloseSource.PROVING);
        batch[2] = _openIntent(agentId, 100e6, -300, 300, bytes(""), IShared.ForceCloseSource.VAULT);

        vm.prank(messenger);
        satellite.executeBatch(batch);

        assertEq(satellite.agentPositionCount(agentId), 3);
    }

    // =========================================================================
    // CLOSE_POSITION
    // =========================================================================

    function test_close_removesPositionTracking() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        assertEq(satellite.agentPositionCount(agentId), 1);

        // Close it
        _executeSingleIntent(_closeIntent(agentId, tokenId, bytes("")));

        assertEq(satellite.agentPositionCount(agentId), 0);
        assertEq(satellite.positionAgent(tokenId), 0);
    }

    function test_close_emitsPositionClosedEvent() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        vm.expectEmit(true, true, false, false);
        emit ISatellite.PositionClosed(agentId, tokenId, 0); // recoveredAmount is mock-dependent

        _executeSingleIntent(_closeIntent(agentId, tokenId, bytes("")));
    }

    function test_close_clearsSourceMapping() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);
        assertEq(uint256(satellite.positionSource(tokenId)), uint256(IShared.ForceCloseSource.VAULT));

        _executeSingleIntent(_closeIntent(agentId, tokenId, bytes("")));

        // Source mapping cleared after close
        assertEq(uint256(satellite.positionSource(tokenId)), uint256(IShared.ForceCloseSource.PROVING));
        // PROVING is 0 which is the default/cleared value
    }

    function test_close_revertsIfNotAgentsPosition() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        // Register a second agent
        uint256 agent2 = _registerAgent(alice, makeAddr("agentEOA2"), 1_000e6);

        // Try to close agent1's position as agent2
        IShared.Intent[] memory batch = new IShared.Intent[](1);
        batch[0] = _closeIntent(agent2, tokenId, bytes(""));

        vm.prank(messenger);
        vm.expectRevert("Satellite: not agent's position");
        satellite.executeBatch(batch);
    }

    function test_close_withZapOutSwap() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        // Configure router for zap-out: swap WETH back to USDC
        router.setSwap(address(weth), address(usdc), 0, 500e6);

        _executeSingleIntent(_closeIntent(agentId, tokenId, hex"01"));

        assertEq(satellite.agentPositionCount(agentId), 0);
    }

    // =========================================================================
    // MODIFY_POSITION (close old + open new)
    // =========================================================================

    function test_modify_closesOldAndOpensNew() public {
        uint256 oldTokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);
        assertEq(satellite.agentPositionCount(agentId), 1);

        // Set up NFPM for the new mint after close
        nfpm.setMintConsumption(500e6, 0);
        uint256 newTokenId = nfpm.nextTokenId();

        _executeSingleIntent(
            _modifyIntent(agentId, oldTokenId, -300, 300, bytes(""), bytes(""), IShared.ForceCloseSource.VAULT)
        );

        // Old position gone, new one created
        assertEq(satellite.agentPositionCount(agentId), 1);
        assertEq(satellite.positionAgent(oldTokenId), 0);
        assertEq(satellite.positionAgent(newTokenId), agentId);
    }

    function test_modify_emitsPositionClosedForOldPosition() public {
        uint256 oldTokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.VAULT);
        nfpm.setMintConsumption(500e6, 0);

        vm.expectEmit(true, true, false, false);
        emit ISatellite.PositionClosed(agentId, oldTokenId, 0);

        _executeSingleIntent(
            _modifyIntent(agentId, oldTokenId, -300, 300, bytes(""), bytes(""), IShared.ForceCloseSource.VAULT)
        );
    }

    function test_modify_newPositionGetsCorrectSourceTag() public {
        uint256 oldTokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);
        nfpm.setMintConsumption(500e6, 0);
        uint256 newTokenId = nfpm.nextTokenId();

        // Modify: new position should be tagged VAULT even though old was PROVING
        _executeSingleIntent(
            _modifyIntent(agentId, oldTokenId, -300, 300, bytes(""), bytes(""), IShared.ForceCloseSource.VAULT)
        );

        assertEq(uint256(satellite.positionSource(newTokenId)), uint256(IShared.ForceCloseSource.VAULT));
    }

    function test_modify_revertsIfOldPositionNotAgents() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);
        uint256 agent2 = _registerAgent(alice, makeAddr("agentEOA2"), 1_000e6);

        IShared.Intent[] memory batch = new IShared.Intent[](1);
        batch[0] = _modifyIntent(agent2, tokenId, -300, 300, bytes(""), bytes(""), IShared.ForceCloseSource.VAULT);

        vm.prank(messenger);
        vm.expectRevert("Satellite: not agent's position");
        satellite.executeBatch(batch);
    }

    // =========================================================================
    // Edge cases
    // =========================================================================

    function test_executeBatch_emptyBatchIsNoOp() public {
        IShared.Intent[] memory batch = new IShared.Intent[](0);
        vm.prank(messenger);
        satellite.executeBatch(batch);
        // No revert, no state change
    }

    function test_open_zapInSwapFailureReverts() public {
        router.setShouldFail(true);

        IShared.Intent[] memory batch = new IShared.Intent[](1);
        batch[0] = _openIntent(agentId, 1_000e6, -100, 100, hex"01", IShared.ForceCloseSource.PROVING);

        vm.prank(messenger);
        vm.expectRevert("Satellite: zap-in swap failed");
        satellite.executeBatch(batch);
    }

    function test_close_zapOutSwapFailureReverts() public {
        uint256 tokenId = _openSimplePosition(agentId, 1_000e6, IShared.ForceCloseSource.PROVING);

        router.setShouldFail(true);

        IShared.Intent[] memory batch = new IShared.Intent[](1);
        batch[0] = _closeIntent(agentId, tokenId, hex"01");

        vm.prank(messenger);
        vm.expectRevert("Satellite: zap-out swap failed");
        satellite.executeBatch(batch);
    }
}
