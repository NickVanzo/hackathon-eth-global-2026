// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerAdminTest is AgentManagerTestBase {

    // -------------------------------------------------------------------------
    // processPause — sets flag
    // -------------------------------------------------------------------------

    function test_processPause_setsFlag() public {
        _registerAlpha();

        // Pause
        vm.prank(messenger);
        agentMgr.processPause(1, deployer, true);
        assertTrue(agentMgr.isPaused(1));

        // Unpause
        vm.prank(messenger);
        agentMgr.processPause(1, deployer, false);
        assertFalse(agentMgr.isPaused(1));
    }

    // -------------------------------------------------------------------------
    // processPause — reverts for non-owner caller
    // -------------------------------------------------------------------------

    function test_processPause_revertsNonOwner() public {
        _registerAlpha();

        address nonOwner = makeAddr("nonOwner");

        vm.prank(messenger);
        vm.expectRevert("AgentManager: not iNFT owner");
        agentMgr.processPause(1, nonOwner, true);
    }

    // -------------------------------------------------------------------------
    // processPause — reverts if not messenger
    // -------------------------------------------------------------------------

    function test_processPause_revertsNotMessenger() public {
        _registerAlpha();

        vm.expectRevert("AgentManager: not messenger");
        agentMgr.processPause(1, deployer, true);
    }

    // -------------------------------------------------------------------------
    // processCommissionClaim — calls vault with correct agentId
    // -------------------------------------------------------------------------

    function test_processCommissionClaim_callsVault() public {
        _registerAlpha();

        vm.prank(messenger);
        agentMgr.processCommissionClaim(1, deployer);

        assertTrue(mockVault.approveCommissionReleaseCalled());
        assertEq(mockVault.lastApprovedCommissionAgentId(), 1);
    }

    // -------------------------------------------------------------------------
    // processCommissionClaim — reverts for non-owner caller
    // -------------------------------------------------------------------------

    function test_processCommissionClaim_revertsNonOwner() public {
        _registerAlpha();

        address nonOwner = makeAddr("nonOwner");

        vm.prank(messenger);
        vm.expectRevert("AgentManager: not iNFT owner");
        agentMgr.processCommissionClaim(1, nonOwner);
    }

    // -------------------------------------------------------------------------
    // processWithdrawFromArena — deregisters agent
    // -------------------------------------------------------------------------

    function test_processWithdrawFromArena_deregisters() public {
        _registerAlpha();

        assertEq(agentMgr.agentCount(), 1);

        vm.prank(messenger);
        agentMgr.processWithdrawFromArena(1, deployer);

        // Agent should be fully removed
        assertEq(agentMgr.agentAddress(1), address(0));
        assertEq(agentMgr.agentCount(), 0);
        assertEq(agentMgr.getActiveAgentIds().length, 0);
    }

    // -------------------------------------------------------------------------
    // processWithdrawFromArena — reverts for non-owner caller
    // -------------------------------------------------------------------------

    function test_processWithdrawFromArena_revertsNonOwner() public {
        _registerAlpha();

        address nonOwner = makeAddr("nonOwner");

        vm.prank(messenger);
        vm.expectRevert("AgentManager: not iNFT owner");
        agentMgr.processWithdrawFromArena(1, nonOwner);
    }

    // -------------------------------------------------------------------------
    // setVault — already set in setUp
    // -------------------------------------------------------------------------

    function test_setVault_setsOnce() public {
        // vault was set in setUp via AgentManagerTestBase
        assertEq(agentMgr.vault(), address(mockVault));
    }

    // -------------------------------------------------------------------------
    // setVault — reverts if called again
    // -------------------------------------------------------------------------

    function test_setVault_revertsIfAlreadySet() public {
        address anotherVault = makeAddr("anotherVault");

        vm.expectRevert("AgentManager: vault already set");
        agentMgr.setVault(anotherVault);
    }
}
