// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentManager} from "../../src/AgentManager.sol";
import {MockAgenticID} from "../mocks/MockAgenticID.sol";
import {MockVault} from "../mocks/MockVault.sol";
import {IShared} from "../../src/interfaces/IShared.sol";

/// @dev Shared state and helpers for all AgentManager test suites.
abstract contract AgentManagerTestBase is Test {

    // -------------------------------------------------------------------------
    // Deployed contracts
    // -------------------------------------------------------------------------

    AgentManager   internal agentMgr;
    MockAgenticID  internal agenticId;
    MockVault      internal mockVault;

    // -------------------------------------------------------------------------
    // Named actors
    // -------------------------------------------------------------------------

    address internal messenger = makeAddr("messenger");
    address internal deployer  = makeAddr("deployer");

    // Fixed addresses for reproducible tests
    address internal agentAlpha = address(0xCf5a0E19ed62654e404A48577c4f1EB2A194B510);
    address internal agentBeta  = address(0xA58383E7Fde3710f21b11fD1824254A4e5aF1074);
    address internal agentGamma = address(0x27d95F3Bbd5334915c710C703FC56603CD861f8D);

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant ALPHA                  = 3000;
    uint256 internal constant MAX_AGENTS             = 10;
    uint256 internal constant TOTAL_REFILL_BUDGET    = 10_000e6;
    uint256 internal constant PROVING_EPOCHS_REQUIRED = 3;
    uint256 internal constant MIN_PROMOTION_SHARPE   = 5000;
    uint256 internal constant MIN_ACTION_INTERVAL    = 10;
    uint256 internal constant MAX_PROMOTION_SHARE    = 1000;
    uint256 internal constant RAMP_EPOCHS            = 3;
    uint256 internal constant EVICTION_EPOCHS        = 3;
    uint256 internal constant PROVING_AMOUNT         = 5000e6;

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------

    function setUp() public virtual {
        agenticId = new MockAgenticID();
        mockVault = new MockVault();

        agentMgr = new AgentManager(
            address(agenticId),
            messenger,
            ALPHA,
            MAX_AGENTS,
            TOTAL_REFILL_BUDGET,
            PROVING_EPOCHS_REQUIRED,
            MIN_PROMOTION_SHARPE,
            MIN_ACTION_INTERVAL,
            MAX_PROMOTION_SHARE,
            RAMP_EPOCHS,
            EVICTION_EPOCHS
        );

        vm.prank(address(this));
        agentMgr.setVault(address(mockVault));

        // Fund AgentManager with 1 ether to cover mintFee payments
        vm.deal(address(agentMgr), 1 ether);

        vm.label(address(agentMgr),  "AgentManager");
        vm.label(address(agenticId), "MockAgenticID");
        vm.label(address(mockVault), "MockVault");
        vm.label(messenger,          "messenger");
        vm.label(deployer,           "deployer");
        vm.label(agentAlpha,         "agentAlpha");
        vm.label(agentBeta,          "agentBeta");
        vm.label(agentGamma,         "agentGamma");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _registerAgent(uint256 agentId, address agentAddr) internal {
        vm.prank(messenger);
        agentMgr.recordRegistration(agentId, agentAddr, deployer, PROVING_AMOUNT);
    }

    function _registerAlpha() internal {
        _registerAgent(1, agentAlpha);
    }

    function _registerAllAgents() internal {
        _registerAgent(1, agentAlpha);
        _registerAgent(2, agentBeta);
        _registerAgent(3, agentGamma);
    }
}
