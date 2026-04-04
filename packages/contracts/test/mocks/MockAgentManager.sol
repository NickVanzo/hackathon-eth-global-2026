// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IShared} from "../../src/interfaces/IShared.sol";

/// @dev Configurable AgentManager mock.
///      Tests push settlement data via setSettlementData(); the vault pulls it
///      via settleAgents().  All other IAgentManager functions are stubs.
contract MockAgentManager {
    // -------------------------------------------------------------------------
    // Configurable settlement data
    // -------------------------------------------------------------------------

    IShared.AgentSettlementData[] private _nextSettlement;

    bool    public settleAgentsCalled;
    uint256 public settleAgentsCallCount;

    function setSettlementData(IShared.AgentSettlementData[] calldata data) external {
        delete _nextSettlement;
        for (uint256 i = 0; i < data.length; i++) {
            _nextSettlement.push(data[i]);
        }
    }

    function settleAgents() external returns (IShared.AgentSettlementData[] memory) {
        settleAgentsCalled = true;
        settleAgentsCallCount++;
        return _nextSettlement;
    }

    // -------------------------------------------------------------------------
    // Stubs
    // -------------------------------------------------------------------------

    function setVault(address) external {}

    function recordRegistration(uint256, address, address, uint256) external {}

    function reportValues(uint256, uint256, uint256) external {}

    function processPause(uint256, address, bool) external {}

    function processCommissionClaim(uint256, address) external {}

    function submitIntent(uint256, IShared.ActionType, bytes calldata) external {}

    function agentAddress(uint256) external pure returns (address) { return address(0); }

    function agentPhase(uint256) external pure returns (IShared.AgentPhase) {
        return IShared.AgentPhase.PROVING;
    }

    function isPaused(uint256) external pure returns (bool) { return false; }

    function credits(uint256) external pure returns (uint256) { return 0; }

    function sharpeScore(uint256) external pure returns (uint256) { return 0; }

    function provingBalance(uint256) external pure returns (uint256) { return 0; }

    function provingDeployed(uint256) external pure returns (uint256) { return 0; }
}

// ---------------------------------------------------------------------------
// ReentrantAgentManager
// ---------------------------------------------------------------------------

/// @dev Calls vault.triggerSettleEpoch() from inside settleAgents() to verify
///      the _settling re-entrancy guard prevents a double settlement.
contract ReentrantAgentManager {
    address public vaultAddr;
    uint256 public settleAgentsCallCount;

    function setVaultAddr(address v) external { vaultAddr = v; }

    function settleAgents() external returns (IShared.AgentSettlementData[] memory) {
        settleAgentsCallCount++;
        // Attempt re-entry — should be silently blocked by _settling flag
        (bool ok,) = vaultAddr.call(abi.encodeWithSignature("triggerSettleEpoch()"));
        // Ignore return value; we only care that vault didn't settle twice
        ok; // suppress unused-var warning
        return new IShared.AgentSettlementData[](0);
    }

    function setVault(address) external {}
    function recordRegistration(uint256, address, address, uint256) external {}
    function reportValues(uint256, uint256, uint256) external {}
    function processPause(uint256, address, bool) external {}
    function processCommissionClaim(uint256, address) external {}
    function submitIntent(uint256, IShared.ActionType, bytes calldata) external {}
    function agentAddress(uint256) external pure returns (address) { return address(0); }
    function agentPhase(uint256) external pure returns (IShared.AgentPhase) {
        return IShared.AgentPhase.PROVING;
    }
    function isPaused(uint256) external pure returns (bool) { return false; }
    function credits(uint256) external pure returns (uint256) { return 0; }
    function sharpeScore(uint256) external pure returns (uint256) { return 0; }
    function provingBalance(uint256) external pure returns (uint256) { return 0; }
    function provingDeployed(uint256) external pure returns (uint256) { return 0; }
}
