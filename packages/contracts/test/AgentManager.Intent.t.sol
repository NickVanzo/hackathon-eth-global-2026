// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IAgentManager} from "../src/interfaces/IAgentManager.sol";
import {IShared} from "../src/interfaces/IShared.sol";

/// @title AgentManagerIntentTest
/// @notice Tests for submitIntent and recordClosure (Task 2).
contract AgentManagerIntentTest is AgentManagerTestBase {

    // -------------------------------------------------------------------------
    // setUp override: roll past minActionInterval so first intent is never blocked
    // -------------------------------------------------------------------------

    function setUp() public override {
        super.setUp();
        // Bucket.lastActionBlock defaults to 0; roll past minActionInterval
        // so that block.number >= 0 + MIN_ACTION_INTERVAL is satisfied.
        vm.roll(MIN_ACTION_INTERVAL + 1);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _encodeOpenParams(uint256 amount, int24 lower, int24 upper)
        internal pure returns (bytes memory)
    {
        return abi.encode(IShared.IntentParams(amount, lower, upper));
    }

    /// @dev Roll forward past the cooldown so a subsequent submitIntent can succeed.
    function _rollPastCooldown() internal {
        vm.roll(block.number + MIN_ACTION_INTERVAL);
    }

    // -------------------------------------------------------------------------
    // Proving-phase tests
    // -------------------------------------------------------------------------

    function test_submitIntent_provingAgent_open() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);

        assertEq(agentMgr.provingDeployed(1), 1000e6);
    }

    function test_submitIntent_provingAgent_revertsExceedsBalance() public {
        _registerAlpha();

        // PROVING_AMOUNT = 5000e6, try to deploy 6000e6
        bytes memory params = _encodeOpenParams(6000e6, -887220, 887220);

        vm.expectRevert("AgentManager: exceeds proving balance");
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_provingAgent_close() public {
        _registerAlpha();

        // CLOSE with empty params should not revert
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.CLOSE_POSITION, "");
    }

    function test_submitIntent_revertsIfPaused() public {
        _registerAlpha();

        // Pause the agent via messenger
        vm.prank(messenger);
        agentMgr.processPause(1, deployer, true);

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.expectRevert("AgentManager: paused");
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsCooldown() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(500e6, -887220, 887220);

        // First intent succeeds (block.number > MIN_ACTION_INTERVAL)
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);

        // Second intent in the same block — lastActionBlock == block.number, cooldown not met
        vm.expectRevert("AgentManager: cooldown");
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsNotAgentEOA() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.expectRevert("AgentManager: not agent");
        vm.prank(agentBeta); // wrong address
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_revertsNotRegistered() public {
        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        vm.expectRevert("AgentManager: not registered");
        vm.prank(agentAlpha);
        agentMgr.submitIntent(999, IShared.ActionType.OPEN_POSITION, params);
    }

    function test_submitIntent_emitsIntentQueued() public {
        _registerAlpha();

        bytes memory params = _encodeOpenParams(1000e6, -887220, 887220);

        // topic1 (agentId indexed), no topic2/3, check data
        vm.expectEmit(true, false, false, true, address(agentMgr));
        emit IAgentManager.IntentQueued(1, IShared.ActionType.OPEN_POSITION, params, block.number);

        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);
    }

    // -------------------------------------------------------------------------
    // recordClosure tests
    // -------------------------------------------------------------------------

    function test_recordClosure_provingSource() public {
        _registerAlpha();

        // Deploy 2000e6 first
        bytes memory params = _encodeOpenParams(2000e6, -887220, 887220);
        vm.prank(agentAlpha);
        agentMgr.submitIntent(1, IShared.ActionType.OPEN_POSITION, params);

        assertEq(agentMgr.provingDeployed(1), 2000e6);

        // Record closure: source=1 (PROVING), recovered 2000e6
        vm.prank(messenger);
        agentMgr.recordClosure(1, 2000e6, 1);

        assertEq(agentMgr.provingDeployed(1), 0);
    }

    function test_recordClosure_deregisteredAgent_skips() public {
        // agentId=999 is not registered — should not revert
        vm.prank(messenger);
        agentMgr.recordClosure(999, 1000e6, 1);
    }
}
