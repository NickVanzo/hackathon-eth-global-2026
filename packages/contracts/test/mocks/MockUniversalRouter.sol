// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Mock Universal Router for Satellite zap-in/zap-out swap tests.
///      When called with any calldata, it simulates a swap by:
///        - pulling `swapInputAmount` of `swapInputToken` from msg.sender
///        - sending `swapOutputAmount` of `swapOutputToken` to msg.sender
///      Tests pre-configure the swap parameters before calling executeBatch.
contract MockUniversalRouter {
    address public swapInputToken;
    address public swapOutputToken;
    uint256 public swapInputAmount;
    uint256 public swapOutputAmount;
    bool    public shouldFail;

    /// @dev Number of times the router was called (for assertions).
    uint256 public callCount;

    /// @dev Configure the next swap simulation.
    function setSwap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount
    ) external {
        swapInputToken  = inputToken;
        swapOutputToken = outputToken;
        swapInputAmount = inputAmount;
        swapOutputAmount = outputAmount;
    }

    /// @dev Make the next call revert.
    function setShouldFail(bool fail) external {
        shouldFail = fail;
    }

    /// @dev Catch-all: any call to this contract triggers the swap simulation.
    ///      In production the Universal Router pulls tokens via Permit2, not direct
    ///      ERC20.transferFrom. Our mock simulates the net effect: burn input from
    ///      the caller (via direct transfer that tests pre-approve or by simply
    ///      not pulling if input is 0) and send output to caller.
    ///      Since Satellite only approves via Permit2 (mocked as no-op), we use
    ///      a pull-from-self pattern: the test funds the router, and the router
    ///      just sends output tokens. Input "consumption" is simulated by the
    ///      Satellite's own balance-delta accounting in _mintPosition.
    fallback() external payable {
        if (shouldFail) {
            revert("MockRouter: forced failure");
        }

        callCount++;

        // Send output tokens to caller (simulates the swap output)
        if (swapOutputAmount > 0 && swapOutputToken != address(0)) {
            IERC20(swapOutputToken).transfer(msg.sender, swapOutputAmount);
        }
    }

    receive() external payable {}
}
