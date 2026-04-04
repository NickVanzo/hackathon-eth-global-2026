// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Mock NonfungiblePositionManager for Satellite tests.
///      Simulates mint / decreaseLiquidity / collect / burn and tracks
///      position state so tests can assert on the full LP lifecycle.
contract MockNonfungiblePositionManager {
    // -------------------------------------------------------------------------
    // Position storage
    // -------------------------------------------------------------------------

    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        bool exists;
    }

    mapping(uint256 => Position) internal _positions;
    uint256 internal _nextTokenId = 1;

    /// @dev How many token0/token1 the mock "pulls" from the caller on mint.
    ///      Tests set these before calling executeBatch.
    uint256 public mintAmount0Consumed;
    uint256 public mintAmount1Consumed;

    /// @dev How many fees are pending on collect for the next call.
    uint256 public pendingFees0;
    uint256 public pendingFees1;

    // -------------------------------------------------------------------------
    // Mint
    // -------------------------------------------------------------------------

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = _nextTokenId++;

        // Consume tokens from the caller (Satellite)
        amount0 = mintAmount0Consumed > 0 ? mintAmount0Consumed : params.amount0Desired;
        amount1 = mintAmount1Consumed > 0 ? mintAmount1Consumed : params.amount1Desired;

        if (amount0 > 0) {
            IERC20(params.token0).transferFrom(msg.sender, address(this), amount0);
        }
        if (amount1 > 0) {
            IERC20(params.token1).transferFrom(msg.sender, address(this), amount1);
        }

        liquidity = uint128(amount0 + amount1); // simplified

        _positions[tokenId] = Position({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            tokensOwed0: 0,
            tokensOwed1: 0,
            exists: true
        });

        return (tokenId, liquidity, amount0, amount1);
    }

    // -------------------------------------------------------------------------
    // Decrease liquidity
    // -------------------------------------------------------------------------

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = _positions[params.tokenId];
        require(pos.exists, "MockNFPM: position does not exist");

        // For simplicity, return the liquidity value split evenly
        amount0 = uint256(params.liquidity) / 2;
        amount1 = uint256(params.liquidity) - amount0;

        pos.liquidity -= params.liquidity;
        pos.tokensOwed0 += uint128(amount0);
        pos.tokensOwed1 += uint128(amount1);

        return (amount0, amount1);
    }

    // -------------------------------------------------------------------------
    // Collect
    // -------------------------------------------------------------------------

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = _positions[params.tokenId];
        require(pos.exists, "MockNFPM: position does not exist");

        // Collect owed tokens + any pending fees
        amount0 = uint256(pos.tokensOwed0) + pendingFees0;
        amount1 = uint256(pos.tokensOwed1) + pendingFees1;

        // Cap to max
        if (amount0 > uint256(params.amount0Max)) amount0 = uint256(params.amount0Max);
        if (amount1 > uint256(params.amount1Max)) amount1 = uint256(params.amount1Max);

        // Clear owed
        pos.tokensOwed0 = 0;
        pos.tokensOwed1 = 0;

        // Transfer tokens to recipient
        if (amount0 > 0) {
            IERC20(pos.token0).transfer(params.recipient, amount0);
        }
        if (amount1 > 0) {
            IERC20(pos.token1).transfer(params.recipient, amount1);
        }

        // Reset pending fees after collection
        pendingFees0 = 0;
        pendingFees1 = 0;

        return (amount0, amount1);
    }

    // -------------------------------------------------------------------------
    // Burn
    // -------------------------------------------------------------------------

    function burn(uint256 tokenId) external {
        Position storage pos = _positions[tokenId];
        require(pos.exists, "MockNFPM: position does not exist");
        require(pos.liquidity == 0, "MockNFPM: liquidity not zero");
        delete _positions[tokenId];
    }

    // -------------------------------------------------------------------------
    // Positions view
    // -------------------------------------------------------------------------

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0_,
            address token1_,
            uint24 fee_,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position storage pos = _positions[tokenId];
        return (
            0,
            address(0),
            pos.token0,
            pos.token1,
            pos.fee,
            pos.tickLower,
            pos.tickUpper,
            pos.liquidity,
            0,
            0,
            pos.tokensOwed0,
            pos.tokensOwed1
        );
    }

    // -------------------------------------------------------------------------
    // Test helpers
    // -------------------------------------------------------------------------

    /// @dev Pre-configure how much the mock consumes on the next mint.
    function setMintConsumption(uint256 amount0, uint256 amount1) external {
        mintAmount0Consumed = amount0;
        mintAmount1Consumed = amount1;
    }

    /// @dev Pre-configure pending fees for the next collect call.
    function setPendingFees(uint256 fees0, uint256 fees1) external {
        pendingFees0 = fees0;
        pendingFees1 = fees1;
    }

    /// @dev Fund this mock with tokens so it can pay out on collect.
    function fundPosition(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    /// @dev Get the next tokenId that will be assigned.
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }
}
