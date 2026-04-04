// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock vault for AgentManager tests.
contract MockVault {
    uint256 private _totalAssets;

    uint256 public lastApprovedCommissionAgentId;
    address public lastCommissionCaller;
    bool    public approveCommissionReleaseCalled;

    function setTotalAssets(uint256 amount) external {
        _totalAssets = amount;
    }

    function totalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function trackedTotalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function approveCommissionRelease(uint256 agentId, address caller) external {
        approveCommissionReleaseCalled = true;
        lastApprovedCommissionAgentId = agentId;
        lastCommissionCaller = caller;
    }
}
