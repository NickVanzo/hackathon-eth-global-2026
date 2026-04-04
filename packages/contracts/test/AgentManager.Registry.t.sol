// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

contract AgentManagerRegistryTest is AgentManagerTestBase {

    // -------------------------------------------------------------------------
    // recordRegistration — agent state
    // -------------------------------------------------------------------------

    function test_recordRegistration_storesAgentState() public {
        _registerAlpha();

        assertEq(agentMgr.agentAddress(1),          agentAlpha);
        assertEq(uint256(agentMgr.agentPhase(1)),   uint256(IShared.AgentPhase.PROVING));
        assertEq(agentMgr.provingBalance(1),         PROVING_AMOUNT);
        assertEq(agentMgr.provingDeployed(1),        0);
        assertFalse(agentMgr.isPaused(1));
    }

    // -------------------------------------------------------------------------
    // recordRegistration — iNFT minting
    // -------------------------------------------------------------------------

    function test_recordRegistration_mintsINFT() public {
        _registerAlpha();

        assertEq(agenticId.mintCount(), 1);
        uint256 tokenId = agentMgr.agentToTokenId(1);
        assertEq(agenticId.ownerOf(tokenId), deployer);
    }

    // -------------------------------------------------------------------------
    // recordRegistration — tokenId mapping
    // -------------------------------------------------------------------------

    function test_recordRegistration_storesTokenIdMapping() public {
        _registerAlpha();

        uint256 tokenId = agentMgr.agentToTokenId(1);
        assertEq(tokenId, 1); // first mint => tokenId == 1
    }

    // -------------------------------------------------------------------------
    // recordRegistration — address mapping
    // -------------------------------------------------------------------------

    function test_recordRegistration_storesAddressMapping() public {
        _registerAlpha();

        assertEq(agentMgr.addressToAgentId(agentAlpha), 1);
    }

    // -------------------------------------------------------------------------
    // recordRegistration — agentCount
    // -------------------------------------------------------------------------

    function test_recordRegistration_incrementsAgentCount() public {
        assertEq(agentMgr.agentCount(), 0);
        _registerAlpha();
        assertEq(agentMgr.agentCount(), 1);

        _registerAgent(2, agentBeta);
        assertEq(agentMgr.agentCount(), 2);
    }

    // -------------------------------------------------------------------------
    // recordRegistration — activeAgentIds list
    // -------------------------------------------------------------------------

    function test_recordRegistration_addsToActiveList() public {
        _registerAllAgents();

        uint256[] memory ids = agentMgr.getActiveAgentIds();
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
    }

    // -------------------------------------------------------------------------
    // recordRegistration — reverts on duplicate
    // -------------------------------------------------------------------------

    function test_recordRegistration_revertsIfAlreadyRegistered() public {
        _registerAlpha();

        vm.prank(messenger);
        vm.expectRevert("AgentManager: already registered");
        agentMgr.recordRegistration(1, agentAlpha, deployer, PROVING_AMOUNT);
    }

    // -------------------------------------------------------------------------
    // recordRegistration — reverts if not messenger
    // -------------------------------------------------------------------------

    function test_recordRegistration_revertsIfNotMessenger() public {
        vm.expectRevert("AgentManager: not messenger");
        agentMgr.recordRegistration(1, agentAlpha, deployer, PROVING_AMOUNT);
    }

    // -------------------------------------------------------------------------
    // _requireOwner — passes for iNFT owner (via processPause)
    // -------------------------------------------------------------------------

    function test_requireOwner_passesForOwner() public {
        _registerAlpha();

        // deployer is the iNFT owner — processPause should succeed
        vm.prank(messenger);
        agentMgr.processPause(1, deployer, true);

        assertTrue(agentMgr.isPaused(1));
    }

    // -------------------------------------------------------------------------
    // _requireOwner — reverts for non-owner (via processPause)
    // -------------------------------------------------------------------------

    function test_requireOwner_revertsForNonOwner() public {
        _registerAlpha();

        address nonOwner = makeAddr("nonOwner");

        vm.prank(messenger);
        vm.expectRevert("AgentManager: not iNFT owner");
        agentMgr.processPause(1, nonOwner, true);
    }
}
