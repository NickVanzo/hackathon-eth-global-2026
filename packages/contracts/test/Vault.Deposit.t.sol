// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {IVault} from "../src/interfaces/IVault.sol";

/// @notice Tests for Vault.recordDeposit() — share minting and accounting.
contract VaultDepositTest is VaultTestBase {

    // =========================================================================
    // Bootstrap deposit (supply == 0 → 1:1 shares)
    // =========================================================================

    function test_recordDeposit_bootstrapMintsOneToOne() public {
        _recordDeposit(alice, TEN_K_USDC);

        assertEq(vault.balanceOf(alice), TEN_K_USDC, "shares minted 1:1");
        assertEq(vault.totalSupply(),    TEN_K_USDC, "total supply");
    }

    function test_recordDeposit_bootstrap_trackedTotalAssetsUpdated() public {
        _recordDeposit(alice, TEN_K_USDC);
        assertEq(vault.trackedTotalAssets(), TEN_K_USDC);
    }

    function test_recordDeposit_bootstrap_trackedIdleBalanceUpdated() public {
        _recordDeposit(alice, TEN_K_USDC);
        assertEq(vault.trackedIdleBalance(), TEN_K_USDC);
    }

    function test_recordDeposit_bootstrap_totalAssetsPublicView() public {
        _recordDeposit(alice, TEN_K_USDC);
        assertEq(vault.totalAssets(), TEN_K_USDC);
    }

    function test_recordDeposit_bootstrap_idleBalancePublicView() public {
        _recordDeposit(alice, TEN_K_USDC);
        assertEq(vault.idleBalance(), TEN_K_USDC);
    }

    // =========================================================================
    // Share price invariant — deposit should not change sharePrice
    // =========================================================================

    function test_recordDeposit_sharePriceUnchangedAfterSecondDeposit() public {
        _recordDeposit(alice, TEN_K_USDC);
        uint256 priceBefore = vault.sharePrice();

        _recordDeposit(bob, TEN_K_USDC);
        uint256 priceAfter = vault.sharePrice();

        // Price may change by 1 wei due to rounding; allow ±1
        assertApproxEqAbs(priceAfter, priceBefore, 1, "share price stable");
    }

    // =========================================================================
    // Proportional share minting (supply > 0)
    // =========================================================================

    function test_recordDeposit_proportional_equalDepositsEqualShares() public {
        _recordDeposit(alice, TEN_K_USDC);
        _recordDeposit(bob,   TEN_K_USDC);

        assertEq(vault.balanceOf(alice), vault.balanceOf(bob), "equal shares");
    }

    function test_recordDeposit_proportional_doubleDepositDoubleShares() public {
        _recordDeposit(alice, TEN_K_USDC);
        uint256 sharesFirst = vault.balanceOf(alice);

        // Bob deposits 2× — should receive 2× the shares alice got
        _recordDeposit(bob, 2 * TEN_K_USDC);

        assertEq(vault.balanceOf(bob), 2 * sharesFirst, "double deposit => double shares");
    }

    function test_recordDeposit_proportional_accumulatesCorrectly() public {
        _recordDeposit(alice,   TEN_K_USDC);
        _recordDeposit(bob,     TEN_K_USDC);
        _recordDeposit(charlie, TEN_K_USDC);

        assertEq(vault.totalSupply(),    3 * TEN_K_USDC, "total supply");
        assertEq(vault.totalAssets(), 3 * TEN_K_USDC, "total assets");
        assertEq(vault.idleBalance(),    3 * TEN_K_USDC, "idle balance");
    }

    function test_recordDeposit_sameUser_multipleTimes() public {
        _recordDeposit(alice, TEN_K_USDC);
        _recordDeposit(alice, TEN_K_USDC);

        assertEq(vault.balanceOf(alice), 2 * TEN_K_USDC, "alice shares doubled");
        assertEq(vault.totalSupply(),    2 * TEN_K_USDC, "total supply doubled");
    }

    // =========================================================================
    // Share price formula cross-check
    // =========================================================================

    function test_recordDeposit_sharePrice_1e18_afterBootstrap() public {
        _recordDeposit(alice, TEN_K_USDC);
        // totalAssets = TEN_K_USDC, totalSupply = TEN_K_USDC
        // sharePrice = TEN_K_USDC * 1e18 / TEN_K_USDC = 1e18
        assertEq(vault.sharePrice(), 1e18);
    }

    function test_sharePrice_isOneBeforeAnyDeposit() public {
        assertEq(vault.sharePrice(), 1e18);
    }

    // =========================================================================
    // Reverts
    // =========================================================================

    function test_recordDeposit_revertsOnZeroUser() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: zero user");
        vault.recordDeposit(address(0), ONE_USDC);
    }

    function test_recordDeposit_revertsOnZeroAmount() public {
        vm.prank(messenger);
        vm.expectRevert("Vault: zero amount");
        vault.recordDeposit(alice, 0);
    }

    // =========================================================================
    // EpochCheck integration — deposit triggers lazy settlement when due
    // =========================================================================

    function test_recordDeposit_triggersSettlementWhenEpochElapsed() public {
        _recordDeposit(alice, TEN_K_USDC);

        uint256 epochBefore = vault.currentEpoch();

        agentMgr.setSettlementData(_emptySettlement());
        _rollPastEpoch();

        _recordDeposit(bob, TEN_K_USDC);

        assertEq(vault.currentEpoch(), epochBefore + 1, "epoch advanced");
    }

    function test_recordDeposit_noSettlementBeforeEpochElapsed() public {
        _recordDeposit(alice, TEN_K_USDC);

        uint256 epochBefore = vault.currentEpoch();

        // Only roll half-way — epoch not elapsed
        vm.roll(block.number + EPOCH_LENGTH / 2);
        _recordDeposit(bob, TEN_K_USDC);

        assertEq(vault.currentEpoch(), epochBefore, "epoch NOT advanced");
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_recordDeposit_bootstrap_1to1(uint128 amount) public {
        vm.assume(amount > 0);

        _recordDeposit(alice, uint256(amount));

        assertEq(vault.balanceOf(alice), uint256(amount));
        assertEq(vault.totalSupply(),    uint256(amount));
        assertEq(vault.totalAssets(),    uint256(amount));
    }

    function testFuzz_recordDeposit_proportional(uint128 first, uint128 second) public {
        vm.assume(first  > 0);
        vm.assume(second > 0);

        _recordDeposit(alice, uint256(first));
        _recordDeposit(bob,   uint256(second));

        // Verify totalAssets == sum of deposits
        assertEq(vault.totalAssets(), uint256(first) + uint256(second));
        // Verify totalSupply == sum of shares (by construction of the formula)
        assertEq(vault.totalSupply(), vault.balanceOf(alice) + vault.balanceOf(bob));
    }
}
