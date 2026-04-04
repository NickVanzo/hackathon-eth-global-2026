// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Satellite} from "../../src/Satellite.sol";

/// @dev Test harness that exposes private state from Satellite for white-box tests.
contract SatelliteHarness is Satellite {
    constructor(
        address _pool,
        address _depositToken,
        address _positionManager,
        address _universalRouter,
        address _messenger,
        address _protocolTreasury,
        uint256 _idleReserveRatio
    )
        Satellite(
            _pool,
            _depositToken,
            _positionManager,
            _universalRouter,
            _messenger,
            _protocolTreasury,
            _idleReserveRatio
        )
    {}

    // -------------------------------------------------------------------------
    // Expose private _pendingWithdrawals for claimWithdraw tests
    // -------------------------------------------------------------------------

    function setPendingWithdrawal(address user, uint256 amount) external {
        _pendingWithdrawals[user] = amount;
    }

    function getPendingWithdrawal(address user) external view returns (uint256) {
        return _pendingWithdrawals[user];
    }

    // -------------------------------------------------------------------------
    // Expose private counters for accounting assertions
    // -------------------------------------------------------------------------

    function nextAgentId() external view returns (uint256) {
        return _nextAgentId;
    }

    function totalProvingCapital() external view returns (uint256) {
        return _totalProvingCapital;
    }

    function totalCommissionReserves() external view returns (uint256) {
        return _totalCommissionReserves;
    }
}
