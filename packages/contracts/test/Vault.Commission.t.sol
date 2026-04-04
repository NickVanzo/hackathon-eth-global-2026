// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultTestBase} from "./helpers/VaultTestBase.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {IShared} from "../src/interfaces/IShared.sol";

/// @notice Tests for Vault.approveCommissionRelease() — iNFT owner payouts.
///         The function now takes (agentId, caller) — no amount param.
///         Vault reads commissionsOwed[agentId] from its own state, zeroes it,
///         and emits CommissionApproved(agentId, caller, amount).
contract VaultCommissionTest is VaultTestBase {

    uint256 internal constant AGENT_ID   = 7;
    uint256 internal constant COMMISSION = 500e6; // 500 USDC

    // =========================================================================
    // Setup helper
    // =========================================================================

    function _setupCommission(uint256 agentId, uint256 amount) internal {
        vault.setCommissionsOwed(agentId, amount);
    }

    // =========================================================================
    // Happy-path — full claim
    // =========================================================================

    function test_approveCommissionRelease_zeroesCommissionsOwed() public {
        _setupCommission(AGENT_ID, COMMISSION);

        vm.prank(address(agentMgr));
        vault.approveCommissionRelease(AGENT_ID, alice);

        assertEq(vault.commissionsOwed(AGENT_ID), 0, "fully drained");
    }

    function test_approveCommissionRelease_emitsCommissionApproved() public {
        _setupCommission(AGENT_ID, COMMISSION);

        vm.expectEmit(true, true, false, true, address(vault));
        emit IVault.CommissionApproved(AGENT_ID, alice, COMMISSION);

        vm.prank(address(agentMgr));
        vault.approveCommissionRelease(AGENT_ID, alice);
    }

    // =========================================================================
    // Multiple agents
    // =========================================================================

    function test_approveCommissionRelease_differentAgentsIndependent() public {
        _setupCommission(1, COMMISSION);
        _setupCommission(2, COMMISSION * 2);

        vm.startPrank(address(agentMgr));
        vault.approveCommissionRelease(1, alice);
        vm.stopPrank();

        assertEq(vault.commissionsOwed(1), 0,            "agent 1 fully claimed");
        assertEq(vault.commissionsOwed(2), COMMISSION * 2, "agent 2 untouched");
    }

    // =========================================================================
    // commissionsOwed public view
    // =========================================================================

    function test_commissionsOwed_returnsZeroByDefault() public {
        assertEq(vault.commissionsOwed(AGENT_ID), 0);
    }

    function test_commissionsOwed_reflectsSettlement() public {
        // Accrue commission via epoch settlement
        _seedVault(alice, TEN_K_USDC);

        uint256 fees = 10_000e6;
        // protocolFee = 10000e6 * 500 / 10000 = 500e6
        // remaining   = 9500e6
        // commission  = 9500e6 * 1000 / 10000 = 950e6
        IShared.AgentSettlementData[] memory data = _singleAgentData(AGENT_ID, fees);
        _forceSettle(data);

        assertEq(vault.commissionsOwed(AGENT_ID), 950e6, "commission from settlement");
    }

    // =========================================================================
    // Reverts
    // =========================================================================

    function test_approveCommissionRelease_revertsWhenNothingOwed() public {
        // commissionsOwed[AGENT_ID] == 0 by default
        vm.prank(address(agentMgr));
        vm.expectRevert("Vault: no commission owed");
        vault.approveCommissionRelease(AGENT_ID, alice);
    }

    function test_approveCommissionRelease_revertsOnZeroCaller() public {
        _setupCommission(AGENT_ID, COMMISSION);

        vm.prank(address(agentMgr));
        vm.expectRevert("Vault: zero caller");
        vault.approveCommissionRelease(AGENT_ID, address(0));
    }

    function test_approveCommissionRelease_revertsOnDoubleClaim() public {
        _setupCommission(AGENT_ID, COMMISSION);

        vm.startPrank(address(agentMgr));
        vault.approveCommissionRelease(AGENT_ID, alice);

        vm.expectRevert("Vault: no commission owed");
        vault.approveCommissionRelease(AGENT_ID, alice);
        vm.stopPrank();
    }

    // =========================================================================
    // Fuzz
    // =========================================================================

    function testFuzz_approveCommissionRelease_claimsFullAmount(uint128 total) public {
        vm.assume(total > 0);

        _setupCommission(AGENT_ID, uint256(total));

        vm.prank(address(agentMgr));
        vault.approveCommissionRelease(AGENT_ID, alice);

        assertEq(vault.commissionsOwed(AGENT_ID), 0);
    }
}
