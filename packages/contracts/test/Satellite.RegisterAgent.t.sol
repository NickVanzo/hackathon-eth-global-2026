// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for Satellite.registerAgent()
contract SatelliteRegisterAgentTest is SatelliteTestBase {

    address internal agent1 = makeAddr("agent1");
    address internal agent2 = makeAddr("agent2");
    address internal agent3 = makeAddr("agent3");

    uint256 internal constant PROVING = 5_000e6;

    // =========================================================================
    // Happy-path — agentId assignment
    // =========================================================================

    function test_registerAgent_firstIdIsOne() public {
        assertEq(satellite.nextAgentId(), 1, "counter starts at 1");

        vm.startPrank(alice);
        usdc.approve(address(satellite), PROVING);

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.AgentRegistered(1, agent1, alice, PROVING);

        satellite.registerAgent(agent1, PROVING);
        vm.stopPrank();

        assertEq(satellite.nextAgentId(), 2, "counter incremented");
    }

    function test_registerAgent_secondIdIsTwo() public {
        _registerAgent(alice, agent1, PROVING);
        _registerAgent(bob,   agent2, PROVING);

        assertEq(satellite.nextAgentId(), 3);
    }

    function test_registerAgent_idsAreStrictlySequential() public {
        uint256 id1 = _registerAgent(alice,   agent1, PROVING);
        uint256 id2 = _registerAgent(bob,     agent2, PROVING);
        uint256 id3 = _registerAgent(charlie, agent3, PROVING);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
    }

    // =========================================================================
    // Happy-path — token accounting
    // =========================================================================

    function test_registerAgent_transfersProvingCapitalFromDeployer() public {
        uint256 aliceBefore = usdc.balanceOf(alice);

        _registerAgent(alice, agent1, PROVING);

        assertEq(usdc.balanceOf(alice), aliceBefore - PROVING, "alice debited");
        assertEq(usdc.balanceOf(address(satellite)), PROVING,  "satellite credited");
    }

    function test_registerAgent_provingCapitalStoredPerAgent() public {
        uint256 id = _registerAgent(alice, agent1, PROVING);

        assertEq(satellite.provingCapital(id), PROVING);
    }

    function test_registerAgent_totalProvingCapitalAccumulates() public {
        _registerAgent(alice,   agent1, 1_000e6);
        _registerAgent(bob,     agent2, 2_000e6);
        _registerAgent(charlie, agent3, 3_000e6);

        assertEq(satellite.totalProvingCapital(), 6_000e6);
    }

    function test_registerAgent_differentDeployersHaveIndependentCapital() public {
        uint256 id1 = _registerAgent(alice,   agent1, 1_000e6);
        uint256 id2 = _registerAgent(bob,     agent2, 4_000e6);

        assertEq(satellite.provingCapital(id1), 1_000e6);
        assertEq(satellite.provingCapital(id2), 4_000e6);
    }

    // =========================================================================
    // Happy-path — deployer registry
    // =========================================================================

    function test_registerAgent_deployerStoredCorrectly() public {
        uint256 id = _registerAgent(alice, agent1, PROVING);

        assertEq(satellite.agentDeployer(id), alice);
    }

    function test_registerAgent_differentDeployersStoredIndependently() public {
        uint256 id1 = _registerAgent(alice, agent1, PROVING);
        uint256 id2 = _registerAgent(bob,   agent2, PROVING);

        assertEq(satellite.agentDeployer(id1), alice);
        assertEq(satellite.agentDeployer(id2), bob);
    }

    function test_registerAgent_sameDeployerCanRegisterMultipleAgents() public {
        // alice registers two agents with separate EOAs
        usdc.mint(alice, PROVING * 2);

        uint256 id1 = _registerAgent(alice, agent1, PROVING);
        uint256 id2 = _registerAgent(alice, agent2, PROVING);

        assertEq(satellite.agentDeployer(id1), alice);
        assertEq(satellite.agentDeployer(id2), alice);
        assertEq(id1, 1);
        assertEq(id2, 2);
    }

    // =========================================================================
    // Happy-path — event
    // =========================================================================

    function test_registerAgent_emitsCorrectEvent() public {
        vm.startPrank(alice);
        usdc.approve(address(satellite), PROVING);

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.AgentRegistered(1, agent1, alice, PROVING);

        satellite.registerAgent(agent1, PROVING);
        vm.stopPrank();
    }

    function test_registerAgent_consecutiveEventsHaveCorrectIds() public {
        vm.startPrank(alice);
        usdc.approve(address(satellite), PROVING * 2);

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.AgentRegistered(1, agent1, alice, PROVING);
        satellite.registerAgent(agent1, PROVING);

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.AgentRegistered(2, agent2, alice, PROVING);
        satellite.registerAgent(agent2, PROVING);

        vm.stopPrank();
    }

    // =========================================================================
    // Reverts
    // =========================================================================

    function test_registerAgent_revertsOnZeroAgentAddress() public {
        vm.startPrank(alice);
        usdc.approve(address(satellite), PROVING);
        vm.expectRevert("Satellite: zero agentAddress");
        satellite.registerAgent(address(0), PROVING);
        vm.stopPrank();
    }

    function test_registerAgent_revertsOnZeroProvingAmount() public {
        vm.startPrank(alice);
        vm.expectRevert("Satellite: zero provingAmount");
        satellite.registerAgent(agent1, 0);
        vm.stopPrank();
    }

    function test_registerAgent_revertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert();
        satellite.registerAgent(agent1, PROVING);
    }

    function test_registerAgent_revertsWhenInsufficientBalance() public {
        address broke = makeAddr("broke");
        vm.startPrank(broke);
        usdc.approve(address(satellite), PROVING);
        vm.expectRevert();
        satellite.registerAgent(agent1, PROVING);
        vm.stopPrank();
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_registerAgent_provingCapitalStoredCorrectly(uint256 amount) public {
        amount = bound(amount, 1, usdc.balanceOf(alice));

        vm.startPrank(alice);
        usdc.approve(address(satellite), amount);
        satellite.registerAgent(agent1, amount);
        vm.stopPrank();

        assertEq(satellite.provingCapital(1), amount);
        assertEq(satellite.totalProvingCapital(), amount);
        assertEq(satellite.agentDeployer(1), alice);
    }
}
