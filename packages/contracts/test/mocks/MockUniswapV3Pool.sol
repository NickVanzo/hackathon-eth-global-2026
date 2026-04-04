// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal Uniswap v3 pool mock.
///      Satellite only calls token0(), token1(), and fee() in its constructor,
///      so that is all we need to implement.
contract MockUniswapV3Pool {
    address public token0;
    address public token1;
    uint24  public fee;

    constructor(address _token0, address _token1, uint24 _fee) {
        token0 = _token0;
        token1 = _token1;
        fee    = _fee;
    }

    /// @dev slot0 stub — not used by Satellite but included for interface completeness.
    function slot0()
        external
        pure
        returns (
            uint160 sqrtPriceX96,
            int24   tick,
            uint16  observationIndex,
            uint16  observationCardinality,
            uint16  observationCardinalityNext,
            uint8   feeProtocol,
            bool    unlocked
        )
    {
        return (79_228_162_514_264_337_593_543_950_336, 0, 0, 1, 1, 0, true);
    }
}
