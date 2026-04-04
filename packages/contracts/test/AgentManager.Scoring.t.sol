// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentManagerTestBase} from "./helpers/AgentManagerTestBase.sol";
import {IShared} from "../src/interfaces/IShared.sol";

/// @title AgentManagerScoringTest
/// @notice Tests for reportValues and settleAgents (Task 3).
contract AgentManagerScoringTest is AgentManagerTestBase {

    // =========================================================================
    // reportValues
    // =========================================================================

    function test_reportValues_storesValues() public {
        _registerAlpha();

        vm.prank(messenger);
        agentMgr.reportValues(1, 1_000e6, 50e6);

        (
            int256  emaReturn,
            int256  emaReturnSq,
            uint256 positionValue,
            uint256 feesCollected,
            uint256 lastReportedBlock
        ) = agentMgr.scores(1);

        assertEq(positionValue,   1_000e6);
        assertEq(feesCollected,   50e6);
        assertEq(lastReportedBlock, block.number);
        // EMAs are not updated by reportValues — they start at 0
        assertEq(emaReturn,   0);
        assertEq(emaReturnSq, 0);
    }

    function test_reportValues_revertsIfNotRegistered() public {
        vm.prank(messenger);
        vm.expectRevert("AgentManager: not registered");
        agentMgr.reportValues(999, 1_000e6, 50e6);
    }

    function test_reportValues_revertsIfNotMessenger() public {
        _registerAlpha();
        vm.expectRevert("AgentManager: not messenger");
        agentMgr.reportValues(1, 1_000e6, 50e6);
    }

    // =========================================================================
    // settleAgents — basic
    // =========================================================================

    function test_settleAgents_revertsIfNotVault() public {
        _registerAlpha();
        vm.expectRevert("AgentManager: not vault");
        agentMgr.settleAgents(100_000e6, 8000);
    }

    function test_settleAgents_updatesEpochsCompleted() public {
        _registerAlpha();

        // Report some values first
        vm.prank(messenger);
        agentMgr.reportValues(1, 500e6, 10e6);

        mockVault.setTotalAssets(100_000e6);
        vm.prank(address(mockVault));
        agentMgr.settleAgents(100_000e6, 8000);

        (
            ,         // agentAddress
            ,         // phase
            ,         // provingBalance
            ,         // provingDeployed
            uint256 epochsCompleted,
            ,         // zeroSharpeStreak
            ,         // paused
                      // registered
        ) = agentMgr.agents(1);

        assertEq(epochsCompleted, 1);
    }

    // =========================================================================
    // settleAgents — promotion
    // =========================================================================

    function test_settleAgents_promotesEligibleAgent() public {
        _registerAlpha();

        // Run PROVING_EPOCHS_REQUIRED settlement rounds with good fees
        // PROVING_AMOUNT = 5000e6, fees = 500e6 => 10% return per epoch
        // After several epochs the EMA Sharpe should exceed MIN_PROMOTION_SHARPE = 5000
        mockVault.setTotalAssets(100_000e6);

        for (uint256 epoch = 0; epoch < PROVING_EPOCHS_REQUIRED; epoch++) {
            vm.prank(messenger);
            agentMgr.reportValues(1, 5_000e6, 500e6);

            vm.prank(address(mockVault));
            agentMgr.settleAgents(100_000e6, 8000);
        }

        assertEq(
            uint256(agentMgr.agentPhase(1)),
            uint256(IShared.AgentPhase.VAULT),
            "agent should be promoted to VAULT"
        );
    }

    // =========================================================================
    // settleAgents — vault eviction (drop to PROVING)
    // =========================================================================

    function test_settleAgents_evictsVaultAgent() public {
        _registerAlpha();

        // First promote the agent
        mockVault.setTotalAssets(100_000e6);
        for (uint256 epoch = 0; epoch < PROVING_EPOCHS_REQUIRED; epoch++) {
            vm.prank(messenger);
            agentMgr.reportValues(1, 5_000e6, 500e6);

            vm.prank(address(mockVault));
            agentMgr.settleAgents(100_000e6, 8000);
        }

        // Confirm promoted
        assertEq(
            uint256(agentMgr.agentPhase(1)),
            uint256(IShared.AgentPhase.VAULT),
            "must be VAULT before eviction test"
        );

        // Now report 0 fees for EVICTION_EPOCHS epochs to produce zero Sharpe streak
        for (uint256 epoch = 0; epoch < EVICTION_EPOCHS; epoch++) {
            vm.prank(messenger);
            agentMgr.reportValues(1, 0, 0);

            vm.prank(address(mockVault));
            agentMgr.settleAgents(100_000e6, 8000);
        }

        // Vault agent should have been downgraded to PROVING
        assertEq(
            uint256(agentMgr.agentPhase(1)),
            uint256(IShared.AgentPhase.PROVING),
            "vault agent should drop to PROVING after eviction"
        );
    }

    // =========================================================================
    // settleAgents — proving eviction (full deregister)
    // =========================================================================

    function test_settleAgents_ejectsProvingAgent() public {
        _registerAlpha();

        mockVault.setTotalAssets(100_000e6);

        // Zero fees for EVICTION_EPOCHS => zero Sharpe streak => deregister
        for (uint256 epoch = 0; epoch < EVICTION_EPOCHS; epoch++) {
            vm.prank(messenger);
            agentMgr.reportValues(1, 0, 0);

            vm.prank(address(mockVault));
            agentMgr.settleAgents(100_000e6, 8000);
        }

        // Agent should be deregistered: agentAddress == address(0)
        assertEq(
            agentMgr.agentAddress(1),
            address(0),
            "proving agent should be fully deregistered"
        );
        assertEq(agentMgr.agentCount(), 0, "agentCount should be 0");
        assertEq(agentMgr.getActiveAgentIds().length, 0, "activeAgentIds should be empty");
    }
}
