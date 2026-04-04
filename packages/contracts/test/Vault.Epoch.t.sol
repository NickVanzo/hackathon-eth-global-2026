// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {Vm} from "forge-std/Vm.sol";
import {VaultHarness} from "./helpers/VaultHarness.sol";
import {MockAgentManager, ReentrantAgentManager} from "./mocks/MockAgentManager.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IShared} from "../src/interfaces/IShared.sol";

/// @notice Tests for epoch settlement: epochCheck, fee waterfall, Tier-2 queue
///         processing, event emission, and re-entrancy protection.
contract VaultEpochTest is VaultTestBase {

    // =========================================================================
    // Helper: expected fee waterfall arithmetic
    // =========================================================================

    function _expectedFees(uint256 feesCollected)
        internal pure returns (uint256 protocolFee, uint256 commission, uint256 depositorReturn)
    {
        protocolFee     = feesCollected * PROTOCOL_FEE_RATE / 10_000;
        uint256 remaining = feesCollected - protocolFee;
        commission      = remaining * COMMISSION_RATE / 10_000;
        depositorReturn = remaining - commission;
    }

    // =========================================================================
    // epochCheck — auto-trigger behavior
    // =========================================================================

    function test_epochCheck_doesNotSettleBeforeEpochElapsed() public {
        uint256 epochBefore = vault.currentEpoch();

        // Roll just short of the epoch boundary
        vm.roll(block.number + EPOCH_LENGTH - 1);
        _recordDeposit(alice, ONE_USDC);

        assertEq(vault.currentEpoch(), epochBefore, "epoch NOT advanced");
    }

    function test_epochCheck_settlesAtExactBoundary() public {
        uint256 epochBefore = vault.currentEpoch();

        // Advance to exactly lastEpochBlock + epochLength
        vm.roll(vault.lastEpochBlock() + EPOCH_LENGTH);
        agentMgr.setSettlementData(_emptySettlement());
        _recordDeposit(alice, ONE_USDC);

        assertEq(vault.currentEpoch(), epochBefore + 1, "epoch advanced at boundary");
    }

    function test_epochCheck_settlesWhenOverdue() public {
        uint256 epochBefore = vault.currentEpoch();

        _rollPastEpoch();
        agentMgr.setSettlementData(_emptySettlement());
        _recordDeposit(alice, ONE_USDC);

        assertEq(vault.currentEpoch(), epochBefore + 1, "epoch advanced");
    }

    function test_epochCheck_onlySettlesOncePerTrigger() public {
        _rollPastEpoch();
        agentMgr.setSettlementData(_emptySettlement());

        // First deposit triggers settlement
        _recordDeposit(alice, ONE_USDC);
        assertEq(agentMgr.settleAgentsCallCount(), 1, "settled once");

        // Second deposit in the same epoch should NOT settle again
        _recordDeposit(bob, ONE_USDC);
        assertEq(agentMgr.settleAgentsCallCount(), 1, "not settled twice");
    }

    // =========================================================================
    // triggerSettleEpoch — explicit path
    // =========================================================================

    function test_triggerSettleEpoch_noopBeforeEpochElapsed() public {
        uint256 epochBefore = vault.currentEpoch();

        // Callable by anyone — messenger used here as the typical relayer caller
        vm.prank(messenger);
        vault.triggerSettleEpoch();

        assertEq(vault.currentEpoch(), epochBefore, "epoch unchanged");
    }

    function test_triggerSettleEpoch_settlesWhenDue() public {
        uint256 epochBefore = vault.currentEpoch();
        agentMgr.setSettlementData(_emptySettlement());

        _rollPastEpoch();
        vm.prank(messenger);
        vault.triggerSettleEpoch();

        assertEq(vault.currentEpoch(), epochBefore + 1, "epoch advanced");
    }

    function test_triggerSettleEpoch_callsSettleAgents() public {
        agentMgr.setSettlementData(_emptySettlement());
        _rollPastEpoch();

        vm.prank(messenger);
        vault.triggerSettleEpoch();

        assertTrue(agentMgr.settleAgentsCalled(), "settleAgents called");
    }

    // =========================================================================
    // Epoch counter and lastEpochBlock
    // =========================================================================

    function test_settleEpoch_incrementsEpochCounter() public {
        assertEq(vault.currentEpoch(), 0);
        _forceSettle(_emptySettlement());
        assertEq(vault.currentEpoch(), 1);
        _forceSettle(_emptySettlement());
        assertEq(vault.currentEpoch(), 2);
    }

    function test_settleEpoch_updatesLastEpochBlockToCurrentBlock() public {
        uint256 rollTo = 12345;
        vm.roll(rollTo);

        _forceSettle(_emptySettlement());

        assertEq(vault.lastEpochBlock(), rollTo, "lastEpochBlock = current block");
    }

    // =========================================================================
    // Fee waterfall — zero fees (no events)
    // =========================================================================

    function test_settleEpoch_zeroFees_noFeeEvents() public {
        _seedVault(alice, TEN_K_USDC);

        vm.recordLogs();
        _forceSettle(_emptySettlement());

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 protocolFeeSig = keccak256("ProtocolFeeAccrued(uint256)");
        bytes32 commissionSig  = keccak256("CommissionAccrued(uint256,uint256)");

        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != protocolFeeSig, "no ProtocolFeeAccrued");
            assertTrue(logs[i].topics[0] != commissionSig,  "no CommissionAccrued");
        }
    }

    function test_settleEpoch_zeroFees_totalAssetsUnchanged() public {
        _seedVault(alice, TEN_K_USDC);
        uint256 totalBefore = vault.trackedTotalAssets();

        _forceSettle(_emptySettlement());

        assertEq(vault.trackedTotalAssets(), totalBefore, "totalAssets unchanged");
    }

    // =========================================================================
    // Fee waterfall — arithmetic
    // =========================================================================

    function test_settleEpoch_feeWaterfall_protocolFeeCalculation() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 fees = 10_000e6;
        (uint256 expectedProtocol,,) = _expectedFees(fees);

        _forceSettle(_singleAgentData(1, fees));

        assertEq(vault.protocolFeesAccrued(), expectedProtocol, "protocol fee");
    }

    function test_settleEpoch_feeWaterfall_commissionCalculation() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 fees = 10_000e6;
        (, uint256 expectedCommission,) = _expectedFees(fees);

        _forceSettle(_singleAgentData(1, fees));

        assertEq(vault.commissionsOwed(1), expectedCommission, "commission");
    }

    function test_settleEpoch_feeWaterfall_depositorReturnAddsToTotalAssets() public {
        _seedVault(alice, TEN_K_USDC);
        uint256 totalBefore = vault.trackedTotalAssets();

        uint256 fees = 10_000e6;
        (,, uint256 expectedDepositorReturn) = _expectedFees(fees);

        _forceSettle(_singleAgentData(1, fees));

        assertEq(
            vault.trackedTotalAssets(),
            totalBefore + expectedDepositorReturn,
            "totalAssets increased by depositorReturn"
        );
    }

    function test_settleEpoch_feeWaterfall_depositorReturnAddsToIdleBalance() public {
        _seedVault(alice, TEN_K_USDC);
        uint256 idleBefore = vault.trackedIdleBalance();

        uint256 fees = 10_000e6;
        (,, uint256 expectedDepositorReturn) = _expectedFees(fees);

        _forceSettle(_singleAgentData(1, fees));

        assertEq(
            vault.trackedIdleBalance(),
            idleBefore + expectedDepositorReturn,
            "idleBalance increased by depositorReturn"
        );
    }

    function test_settleEpoch_feeWaterfall_exactNumbers() public {
        // fees = 10_000e6
        // protocolFee (5%)   = 500e6
        // remaining          = 9_500e6
        // commission (10%)   = 950e6
        // depositorReturn    = 8_550e6
        _seedVault(alice, TEN_K_USDC);

        _forceSettle(_singleAgentData(1, 10_000e6));

        assertEq(vault.protocolFeesAccrued(),  500e6,    "protocolFee 5%");
        assertEq(vault.commissionsOwed(1),     950e6,    "commission 10% of 95%");
        assertEq(
            vault.trackedTotalAssets(),
            TEN_K_USDC + 8_550e6,
            "totalAssets += depositorReturn"
        );
    }

    // =========================================================================
    // Fee waterfall — events
    // =========================================================================

    function test_settleEpoch_emitsProtocolFeeAccrued() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 fees = 10_000e6;
        (uint256 expectedProtocol,,) = _expectedFees(fees);

        // setSettlementData BEFORE expectEmit so the agentMgr call doesn't consume the chk
        agentMgr.setSettlementData(_singleAgentData(1, fees));

        // CommissionAccrued fires first; expect it so Foundry advances past it
        (, uint256 expectedCommission,) = _expectedFees(fees);
        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.CommissionAccrued(1, expectedCommission);

        vm.expectEmit(false, false, false, true, address(vault));
        emit IVault.ProtocolFeeAccrued(expectedProtocol);

        vault.forceSettleEpoch();
    }

    function test_settleEpoch_emitsCommissionAccrued() public {
        _seedVault(alice, TEN_K_USDC);

        uint256 fees = 10_000e6;
        (, uint256 expectedCommission,) = _expectedFees(fees);

        agentMgr.setSettlementData(_singleAgentData(1, fees));

        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.CommissionAccrued(1, expectedCommission);

        vault.forceSettleEpoch();
    }

    function test_settleEpoch_emitsEpochSettled() public {
        _seedVault(alice, TEN_K_USDC);

        agentMgr.setSettlementData(_emptySettlement());

        // sharePrice = totalAssets * 1e18 / totalSupply = 1e18
        vm.expectEmit(false, false, false, true, address(vault));
        emit IVault.EpochSettled(1e18, TEN_K_USDC, TEN_K_USDC);

        vault.forceSettleEpoch();
    }

    function test_settleEpoch_emitsEpochSettled_afterFeeWaterfall() public {
        _seedVault(alice, TEN_K_USDC);
        uint256 fees = 10_000e6;
        (,, uint256 depositorReturn) = _expectedFees(fees);

        uint256 newTotal = TEN_K_USDC + depositorReturn;
        uint256 supply   = TEN_K_USDC;
        uint256 newPrice = (newTotal * 1e18) / supply;

        agentMgr.setSettlementData(_singleAgentData(1, fees));

        vm.expectEmit(false, false, false, true, address(vault));
        emit IVault.EpochSettled(newPrice, supply, newTotal);

        vault.forceSettleEpoch();
    }

    // =========================================================================
    // Fee waterfall — multiple agents
    // =========================================================================

    function test_settleEpoch_multipleAgents_feesAccumulatedCorrectly() public {
        _seedVault(alice, TEN_K_USDC);

        IShared.AgentSettlementData[] memory data = new IShared.AgentSettlementData[](3);
        data[0] = IShared.AgentSettlementData({agentId: 1, positionValue: 0, feesCollected: 1_000e6, evicted: false, promoted: false, forceClose: false});
        data[1] = IShared.AgentSettlementData({agentId: 2, positionValue: 0, feesCollected: 2_000e6, evicted: false, promoted: false, forceClose: false});
        data[2] = IShared.AgentSettlementData({agentId: 3, positionValue: 0, feesCollected: 0,       evicted: false, promoted: false, forceClose: false});

        agentMgr.setSettlementData(data);
        vault.forceSettleEpoch();

        (uint256 pf1, uint256 c1,) = _expectedFees(1_000e6);
        (uint256 pf2, uint256 c2,) = _expectedFees(2_000e6);

        assertEq(vault.protocolFeesAccrued(),  pf1 + pf2, "combined protocol fees");
        assertEq(vault.commissionsOwed(1),     c1,        "agent 1 commission");
        assertEq(vault.commissionsOwed(2),     c2,        "agent 2 commission");
        assertEq(vault.commissionsOwed(3),     0,         "agent 3 zero fees => no commission");
    }

    function test_settleEpoch_multipleAgents_protocolFeeAccruedEmittedOnce() public {
        _seedVault(alice, TEN_K_USDC);

        IShared.AgentSettlementData[] memory data = new IShared.AgentSettlementData[](2);
        data[0] = IShared.AgentSettlementData({agentId: 1, positionValue: 0, feesCollected: 1_000e6, evicted: false, promoted: false, forceClose: false});
        data[1] = IShared.AgentSettlementData({agentId: 2, positionValue: 0, feesCollected: 2_000e6, evicted: false, promoted: false, forceClose: false});

        agentMgr.setSettlementData(data);

        (uint256 pf1,,) = _expectedFees(1_000e6);
        (uint256 pf2,,) = _expectedFees(2_000e6);

        // Only one ProtocolFeeAccrued with the total
        vm.expectEmit(false, false, false, true, address(vault));
        emit IVault.ProtocolFeeAccrued(pf1 + pf2);

        vault.forceSettleEpoch();
    }

    // =========================================================================
    // Tier-2 queue processing during settlement
    // =========================================================================

    function test_settleEpoch_processesTier2WhenIdleFreed() public {
        // Deposit 1000, set idle to 0 (simulating all deployed)
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        // Alice queues a Tier-2 withdrawal for TEN_K_USDC / 2
        vault.setTrackedIdleBalance(0);
        _processWithdraw(alice, TEN_K_USDC / 2);

        assertEq(vault.pendingUsersLength(), 1, "alice queued");

        // Settlement returns fees that bring idle above alice's pending amount
        uint256 fees = 20_000e6;
        (,, uint256 depositorReturn) = _expectedFees(fees);
        // depositorReturn will be added to idle, which is currently 0

        IShared.AgentSettlementData[] memory data = _singleAgentData(1, fees);
        agentMgr.setSettlementData(data);

        // Expect WithdrawApproved to fire for alice
        vm.expectEmit(true, false, false, true, address(vault));
        emit IVault.WithdrawApproved(alice, TEN_K_USDC / 2);

        vault.forceSettleEpoch();

        assertEq(vault.pendingUsersLength(), 0, "queue cleared");
        assertFalse(vault.inPendingQueue(alice), "alice removed");
        assertEq(vault.internalPendingWithdrawal(alice), 0, "pending zeroed");
    }

    function test_settleEpoch_partialTier2ProcessingCarriesOver() public {
        _seedVault(alice, 3 * TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        // Queue alice for 3 × TEN_K_USDC
        _processWithdraw(alice, 3 * TEN_K_USDC);

        // Simulate most capital deployed in positions: aggregateVaultPositionValue
        // accounts for 2 × TEN_K_USDC, leaving idle = totalAssets - deployed = TEN_K_USDC.
        // That's insufficient for alice's 3 × TEN_K_USDC pending → carries over.
        agentMgr.setAggregateVaultPositionValue(2 * TEN_K_USDC);
        _forceSettle(_emptySettlement());

        // alice's withdrawal was NOT fulfilled (idle < pending)
        assertEq(vault.pendingUsersLength(), 1, "alice still queued");
        assertTrue(vault.inPendingQueue(alice), "alice still in queue");
    }

    function test_settleEpoch_tier2MultipleFulfilled() public {
        // Use addPendingUser to inject exact pending amounts without the share-burn
        // arithmetic that would otherwise inflate tokenAmounts across users.
        vault.setTrackedTotalAssets(2 * TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        vault.addPendingUser(alice, TEN_K_USDC);
        vault.addPendingUser(bob,   TEN_K_USDC);

        assertEq(vault.pendingUsersLength(), 2, "two users queued");

        // Free enough idle to satisfy both
        vault.setTrackedIdleBalance(2 * TEN_K_USDC);
        _forceSettle(_emptySettlement());

        assertEq(vault.pendingUsersLength(), 0, "both cleared");
        assertFalse(vault.inPendingQueue(alice), "alice removed");
        assertFalse(vault.inPendingQueue(bob),   "bob removed");
    }

    function test_settleEpoch_tier2_totalAssetsDecrementedOnFulfilment() public {
        _seedVault(alice, TEN_K_USDC);
        vault.setTrackedIdleBalance(0);

        _processWithdraw(alice, TEN_K_USDC);

        uint256 totalBefore = vault.trackedTotalAssets();

        vault.setTrackedIdleBalance(TEN_K_USDC);
        _forceSettle(_emptySettlement());

        assertEq(vault.trackedTotalAssets(), totalBefore - TEN_K_USDC, "totalAssets decremented");
    }

    // =========================================================================
    // Re-entrancy protection (_settling flag)
    // =========================================================================

    function test_settleEpoch_reentrantTriggerIsBlocked() public {
        // Deploy a vault that uses the ReentrantAgentManager
        ReentrantAgentManager reentrantMgr = new ReentrantAgentManager();

        VaultHarness reentrantVault = new VaultHarness(
            address(reentrantMgr),
            EPOCH_LENGTH,
            MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE,
            treasury,
            COMMISSION_RATE,
            depositToken,
            pool_,
            messenger
        );

        reentrantMgr.setVaultAddr(address(reentrantVault));

        // Roll past epoch so triggerSettleEpoch would settle if called
        vm.roll(block.number + EPOCH_LENGTH + 1);

        // The re-entrant manager tries to call triggerSettleEpoch inside settleAgents()
        // but the _settling guard should prevent a double settlement
        reentrantVault.forceSettleEpoch();

        // settleAgents was called exactly once despite the re-entry attempt
        assertEq(reentrantMgr.settleAgentsCallCount(), 1, "settle called once, not twice");
        // epoch advanced by exactly 1
        assertEq(reentrantVault.currentEpoch(), 1, "epoch = 1");
    }

    // =========================================================================
    // Fuzz — fee waterfall
    // =========================================================================

    function testFuzz_settleEpoch_feeWaterfall(uint128 fees) public {
        vm.assume(fees > 0);

        _seedVault(alice, TEN_K_USDC);

        (uint256 expectedProtocol, uint256 expectedCommission, uint256 expectedDepositorReturn)
            = _expectedFees(uint256(fees));

        uint256 totalBefore = vault.trackedTotalAssets();
        _forceSettle(_singleAgentData(1, uint256(fees)));

        assertEq(vault.protocolFeesAccrued(),  expectedProtocol,           "protocol fee");
        assertEq(vault.commissionsOwed(1),     expectedCommission,         "commission");
        assertEq(
            vault.trackedTotalAssets(),
            totalBefore + expectedDepositorReturn,
            "depositorReturn added"
        );
    }
}
