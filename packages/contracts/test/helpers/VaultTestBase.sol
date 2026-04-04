// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VaultHarness} from "./VaultHarness.sol";
import {MockAgentManager} from "../mocks/MockAgentManager.sol";
import {IShared} from "../../src/interfaces/IShared.sol";
import {IVault} from "../../src/interfaces/IVault.sol";

/// @dev Shared state and helpers for all Vault test suites.
abstract contract VaultTestBase is Test {

    // -------------------------------------------------------------------------
    // Deployed contracts
    // -------------------------------------------------------------------------

    VaultHarness     internal vault;
    MockAgentManager internal agentMgr;

    // -------------------------------------------------------------------------
    // Named actors
    // -------------------------------------------------------------------------

    address internal messenger = makeAddr("messenger");
    address internal treasury  = makeAddr("treasury");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal charlie   = makeAddr("charlie");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant EPOCH_LENGTH       = 100;
    uint256 internal constant MAX_EXPOSURE_RATIO = 8_000;  // 80 %
    uint256 internal constant PROTOCOL_FEE_RATE  = 500;    // 5 %
    uint256 internal constant COMMISSION_RATE    = 1_000;  // 10 %

    uint256 internal constant ONE_USDC   = 1e6;
    uint256 internal constant TEN_K_USDC = 10_000e6;

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------

    address internal depositToken = makeAddr("depositToken");
    address internal pool_        = makeAddr("pool");

    function setUp() public virtual {
        agentMgr = new MockAgentManager();

        vault = new VaultHarness(
            address(agentMgr),
            EPOCH_LENGTH,
            MAX_EXPOSURE_RATIO,
            PROTOCOL_FEE_RATE,
            treasury,
            COMMISSION_RATE,
            depositToken,
            pool_,
            messenger
        );

        vm.label(address(vault),    "Vault");
        vm.label(address(agentMgr), "AgentManager");
        vm.label(messenger,         "messenger");
        vm.label(treasury,          "treasury");
        vm.label(alice,             "alice");
        vm.label(bob,               "bob");
        vm.label(charlie,           "charlie");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Record a deposit as the messenger.
    function _recordDeposit(address user, uint256 amount) internal {
        vm.prank(messenger);
        vault.recordDeposit(user, amount);
    }

    /// @dev Process a withdrawal as the messenger.
    function _processWithdraw(address user, uint256 shares) internal {
        vm.prank(messenger);
        vault.processWithdraw(user, shares);
    }

    /// @dev Advance blocks past the epoch boundary.
    function _rollPastEpoch() internal {
        vm.roll(block.number + EPOCH_LENGTH + 1);
    }

    /// @dev Configure settlement data and directly trigger epoch settlement
    ///      via the harness (bypasses epochCheck; no side-effect deposits).
    function _forceSettle(IShared.AgentSettlementData[] memory data) internal {
        agentMgr.setSettlementData(data);
        vault.forceSettleEpoch();
    }

    /// @dev Trigger epoch settlement through the epochCheck path by rolling
    ///      blocks and submitting a 1-unit messenger deposit.
    function _triggerSettlementViaDeposit(IShared.AgentSettlementData[] memory data) internal {
        agentMgr.setSettlementData(data);
        _rollPastEpoch();
        vm.prank(messenger);
        vault.recordDeposit(alice, 1);
    }

    /// @dev Empty settlement data (no agents, no fees).
    function _emptySettlement() internal pure returns (IShared.AgentSettlementData[] memory) {
        return new IShared.AgentSettlementData[](0);
    }

    /// @dev Single-agent settlement with given fees and optional position value.
    function _singleAgentData(uint256 agentId, uint256 fees)
        internal pure returns (IShared.AgentSettlementData[] memory data)
    {
        data = new IShared.AgentSettlementData[](1);
        data[0] = IShared.AgentSettlementData({
            agentId:       agentId,
            positionValue: 0,
            feesCollected: fees,
            evicted:       false,
            promoted:      false,
            forceClose:    false
        });
    }

    /// @dev Single-agent settlement with fees and position value.
    function _singleAgentDataWithPosition(uint256 agentId, uint256 fees, uint256 posValue)
        internal pure returns (IShared.AgentSettlementData[] memory data)
    {
        data = new IShared.AgentSettlementData[](1);
        data[0] = IShared.AgentSettlementData({
            agentId:       agentId,
            positionValue: posValue,
            feesCollected: fees,
            evicted:       false,
            promoted:      false,
            forceClose:    false
        });
    }

    /// @dev Convenience: deposit `amount` to `user` via the harness setters
    ///      (sets totalAssets and mints shares) without going through messenger.
    ///      With totalDeployedVault defaulting to 0 on the mock, idle = totalAssets.
    function _seedVault(address user, uint256 amount) internal {
        vault.setTrackedTotalAssets(vault.trackedTotalAssets() + amount);
        vault.mintShares(user, amount);
    }

    /// @dev Set the idle balance by adjusting totalDeployedVault on the mock.
    ///      idle = totalAssets - totalDeployedVault.
    function _setIdle(uint256 idle) internal {
        uint256 total = vault.trackedTotalAssets();
        uint256 deployed = total > idle ? total - idle : 0;
        agentMgr.setTotalDeployedVault(deployed);
    }
}
