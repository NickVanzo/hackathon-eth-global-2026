// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {VaultHarness}  from "./helpers/VaultHarness.sol";
import {MockAgentManager} from "./mocks/MockAgentManager.sol";

/// @notice Tests for Vault constructor validation, access modifiers, and ERC20 metadata.
contract VaultAccessTest is VaultTestBase {

    // =========================================================================
    // Constructor — zero-address checks
    // =========================================================================

    function test_constructor_revertsOnZeroAgentManager() public {
        vm.expectRevert("Vault: zero agentManager");
        new VaultHarness(
            address(0), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, treasury, COMMISSION_RATE, messenger
        );
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert("Vault: zero treasury");
        new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, address(0), COMMISSION_RATE, messenger
        );
    }

    function test_constructor_revertsOnZeroMessenger() public {
        vm.expectRevert("Vault: zero messenger");
        new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, treasury, COMMISSION_RATE, address(0)
        );
    }

    function test_constructor_revertsOnZeroEpochLength() public {
        vm.expectRevert("Vault: zero epochLength");
        new VaultHarness(
            address(agentMgr), 0, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, treasury, COMMISSION_RATE, messenger
        );
    }

    // =========================================================================
    // Constructor — rate overflow checks
    // =========================================================================

    function test_constructor_revertsOnProtocolFeeRateOver100Pct() public {
        vm.expectRevert("Vault: protocolFeeRate > 100%");
        new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            10_001, treasury, COMMISSION_RATE, messenger
        );
    }

    function test_constructor_revertsOnCommissionRateOver100Pct() public {
        vm.expectRevert("Vault: commissionRate > 100%");
        new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, treasury, 10_001, messenger
        );
    }

    function test_constructor_revertsOnMaxExposureRatioOver100Pct() public {
        vm.expectRevert("Vault: maxExposureRatio > 100%");
        new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, 10_001,
            PROTOCOL_FEE_RATE, treasury, COMMISSION_RATE, messenger
        );
    }

    // =========================================================================
    // Constructor — boundary rates accepted (exactly 10 000)
    // =========================================================================

    function test_constructor_acceptsMaxRates() public {
        VaultHarness v = new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, 10_000,
            10_000, treasury, 10_000, messenger
        );
        assertEq(v.maxExposureRatio(), 10_000);
        assertEq(v.protocolFeeRate(),  10_000);
        assertEq(v.commissionRate(),   10_000);
    }

    // =========================================================================
    // Constructor — immutables stored correctly
    // =========================================================================

    function test_constructor_storesImmutables() public {
        assertEq(vault.agentManager(),     address(agentMgr));
        assertEq(vault.messenger(),         messenger);
        assertEq(vault.protocolTreasury(),  treasury);
        assertEq(vault.epochLength(),       EPOCH_LENGTH);
        assertEq(vault.protocolFeeRate(),   PROTOCOL_FEE_RATE);
        assertEq(vault.commissionRate(),    COMMISSION_RATE);
        assertEq(vault.maxExposureRatio(),  MAX_EXPOSURE_RATIO);
    }

    function test_constructor_setsLastEpochBlockToCurrentBlock() public {
        uint256 deployBlock = block.number;
        VaultHarness v = new VaultHarness(
            address(agentMgr), EPOCH_LENGTH, MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE, treasury, COMMISSION_RATE, messenger
        );
        assertEq(v.lastEpochBlock(), deployBlock);
    }

    function test_constructor_setsCurrentEpochToZero() public {
        assertEq(vault.currentEpoch(), 0);
    }

    function test_constructor_initialTotalAssetsZero() public {
        assertEq(vault.totalAssets(), 0);
    }

    function test_constructor_initialIdleBalanceZero() public {
        assertEq(vault.idleBalance(), 0);
    }

    function test_constructor_initialTotalSupplyZero() public {
        assertEq(vault.totalSupply(), 0);
    }

    function test_constructor_initialSharePriceOneBillion() public {
        // share price = 1e18 when supply == 0
        assertEq(vault.sharePrice(), 1e18);
    }

    // =========================================================================
    // ERC20 metadata
    // =========================================================================

    function test_erc20_name() public {
        assertEq(vault.name(), "Agent Arena Shares");
    }

    function test_erc20_symbol() public {
        assertEq(vault.symbol(), "AAS");
    }

    // =========================================================================
    // Access control — onlyMessenger
    // =========================================================================

    function test_recordDeposit_revertsForNonMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Vault: not messenger");
        vault.recordDeposit(alice, ONE_USDC);
    }

    function test_processWithdraw_revertsForNonMessenger() public {
        vault.mintShares(alice, 100);
        vault.setTrackedTotalAssets(100);

        vm.prank(alice);
        vm.expectRevert("Vault: not messenger");
        vault.processWithdraw(alice, 100);
    }

    // =========================================================================
    // Access control — onlyAgentManager
    // =========================================================================

    function test_approveCommissionRelease_revertsForNonAgentManager() public {
        vault.setCommissionsOwed(1, 1_000);

        vm.prank(alice);
        vm.expectRevert("Vault: not agentManager");
        vault.approveCommissionRelease(1, alice, 500);
    }

    function test_triggerSettleEpoch_revertsForNonAgentManager() public {
        vm.prank(alice);
        vm.expectRevert("Vault: not agentManager");
        vault.triggerSettleEpoch();
    }

    function test_triggerSettleEpoch_revertsForMessenger() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: not agentManager");
        vault.triggerSettleEpoch();
    }
}
