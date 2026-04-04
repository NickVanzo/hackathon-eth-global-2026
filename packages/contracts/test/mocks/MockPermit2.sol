// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal mock of Permit2's AllowanceTransfer.approve() for testing.
///      Only implements the approve function the Satellite constructor calls.
contract MockPermit2 {
    function approve(address, address, uint160, uint48) external {
        // no-op for tests
    }
}
