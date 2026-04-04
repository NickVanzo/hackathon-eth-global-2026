// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {ISatellite} from "../src/interfaces/ISatellite.sol";

/// @notice Tests for pauseAgent(), unpauseAgent(), and withdrawFromArena()
///         These are intent-emission stubs: they emit an event and do nothing else.
///         Actual permission checks happen on 0G (iNFT ownership verification).
contract SatelliteAgentManagementTest is SatelliteTestBase {

    // =========================================================================
    // pauseAgent()
    // =========================================================================

    function test_pauseAgent_emitsPauseRequestedWithPausedTrue() public {
        uint256 agentId = 1;

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, alice, true);

        vm.prank(alice);
        satellite.pauseAgent(agentId);
    }

    function test_pauseAgent_anyCallerCanEmit() public {
        // Access control is enforced on 0G, not here
        address randUser = makeAddr("rand");
        vm.prank(randUser);
        satellite.pauseAgent(5); // should not revert
    }

    function test_pauseAgent_noStateChange() public {
        uint256 idleBefore   = satellite.idleBalance();
        uint256 shareBefore  = satellite.cachedSharePrice();

        vm.prank(alice);
        satellite.pauseAgent(1);

        assertEq(satellite.idleBalance(),       idleBefore);
        assertEq(satellite.cachedSharePrice(),  shareBefore);
    }

    function test_pauseAgent_multipleAgentIds() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.expectEmit(true, true, false, true, address(satellite));
            emit ISatellite.PauseRequested(i, alice, true);

            vm.prank(alice);
            satellite.pauseAgent(i);
        }
    }

    // =========================================================================
    // unpauseAgent()
    // =========================================================================

    function test_unpauseAgent_emitsPauseRequestedWithPausedFalse() public {
        uint256 agentId = 2;

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, bob, false);

        vm.prank(bob);
        satellite.unpauseAgent(agentId);
    }

    function test_unpauseAgent_anyCallerCanEmit() public {
        vm.prank(makeAddr("other"));
        satellite.unpauseAgent(99); // should not revert
    }

    function test_unpauseAgent_noStateChange() public {
        uint256 idleBefore = satellite.idleBalance();

        vm.prank(alice);
        satellite.unpauseAgent(1);

        assertEq(satellite.idleBalance(), idleBefore);
    }

    function test_pauseThenUnpause_emitsBothEvents() public {
        uint256 agentId = 3;

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, charlie, true);
        vm.prank(charlie);
        satellite.pauseAgent(agentId);

        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, charlie, false);
        vm.prank(charlie);
        satellite.unpauseAgent(agentId);
    }

    // =========================================================================
    // withdrawFromArena()
    // =========================================================================

    function test_withdrawFromArena_emitsWithdrawFromArenaRequested() public {
        uint256 agentId = 4;

        vm.expectEmit(true, true, false, false, address(satellite));
        emit ISatellite.WithdrawFromArenaRequested(agentId, alice);

        vm.prank(alice);
        satellite.withdrawFromArena(agentId);
    }

    function test_withdrawFromArena_anyCallerCanEmit() public {
        vm.prank(makeAddr("anyone"));
        satellite.withdrawFromArena(7); // should not revert
    }

    function test_withdrawFromArena_noStateChange() public {
        uint256 idleBefore  = satellite.idleBalance();
        uint256 shareBefore = satellite.cachedSharePrice();

        vm.prank(alice);
        satellite.withdrawFromArena(1);

        assertEq(satellite.idleBalance(),      idleBefore);
        assertEq(satellite.cachedSharePrice(), shareBefore);
    }

    function test_withdrawFromArena_callerIsCapturedInEvent() public {
        address owner = makeAddr("nftOwner");

        vm.expectEmit(true, true, false, false, address(satellite));
        emit ISatellite.WithdrawFromArenaRequested(1, owner);

        vm.prank(owner);
        satellite.withdrawFromArena(1);
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_pauseAgent_agentIdInEvent(uint256 agentId) public {
        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, alice, true);

        vm.prank(alice);
        satellite.pauseAgent(agentId);
    }

    function testFuzz_unpauseAgent_agentIdInEvent(uint256 agentId) public {
        vm.expectEmit(true, true, false, true, address(satellite));
        emit ISatellite.PauseRequested(agentId, alice, false);

        vm.prank(alice);
        satellite.unpauseAgent(agentId);
    }

    function testFuzz_withdrawFromArena_agentIdInEvent(uint256 agentId) public {
        vm.expectEmit(true, true, false, false, address(satellite));
        emit ISatellite.WithdrawFromArenaRequested(agentId, alice);

        vm.prank(alice);
        satellite.withdrawFromArena(agentId);
    }
}
