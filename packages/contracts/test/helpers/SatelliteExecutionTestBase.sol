// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SatelliteHarness} from "./SatelliteHarness.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockUniswapV3Pool} from "../mocks/MockUniswapV3Pool.sol";
import {MockPermit2} from "../mocks/MockPermit2.sol";
import {MockNonfungiblePositionManager} from "../mocks/MockNonfungiblePositionManager.sol";
import {MockUniversalRouter} from "../mocks/MockUniversalRouter.sol";
import {IShared} from "../../src/interfaces/IShared.sol";

/// @dev Extended test base that deploys REAL mock contracts for positionManager
///      and universalRouter, enabling full Uniswap execution tests
///      (executeBatch, forceClose, collectAndReport).
abstract contract SatelliteExecutionTestBase is Test {
    // -------------------------------------------------------------------------
    // Deployed contracts
    // -------------------------------------------------------------------------

    MockERC20                        internal usdc;
    MockERC20                        internal weth;
    MockUniswapV3Pool                internal pool;
    MockNonfungiblePositionManager   internal nfpm;
    MockUniversalRouter              internal router;
    SatelliteHarness                 internal satellite;

    // -------------------------------------------------------------------------
    // Named actors
    // -------------------------------------------------------------------------

    address internal messenger  = makeAddr("messenger");
    address internal treasury   = makeAddr("treasury");
    address internal alice      = makeAddr("alice");
    address internal bob        = makeAddr("bob");
    address internal deployer1  = makeAddr("deployer1");
    address internal agentEOA   = makeAddr("agentEOA");

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    uint256 internal constant ONE_USDC           = 1e6;
    uint256 internal constant TEN_K_USDC         = 10_000e6;
    uint256 internal constant IDLE_RESERVE_RATIO = 2_000; // 20%

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------

    function setUp() public virtual {
        usdc = new MockERC20("USD Coin Bridged", "USDC.e", 6);
        weth = new MockERC20("Wrapped Ether",    "WETH",   18);

        // Pool: USDC.e / WETH, 0.3% tier
        pool = new MockUniswapV3Pool(address(usdc), address(weth), 3000);

        // Deploy real mock contracts for Uniswap
        nfpm   = new MockNonfungiblePositionManager();
        router = new MockUniversalRouter();

        // Deploy mock Permit2 at canonical address
        address permit2Addr = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        vm.etch(permit2Addr, address(new MockPermit2()).code);

        satellite = new SatelliteHarness(
            address(pool),
            address(usdc),
            address(nfpm),
            address(router),
            messenger,
            treasury,
            IDLE_RESERVE_RATIO
        );

        // Fund satellite generously for LP operations
        usdc.mint(address(satellite), 1_000_000e6);
        weth.mint(address(satellite), 1_000e18);

        // Fund the NFPM so it can return tokens on collect
        usdc.mint(address(nfpm), 1_000_000e6);
        weth.mint(address(nfpm), 1_000e18);

        // Fund the router so it can send tokens on swap
        usdc.mint(address(router), 1_000_000e6);
        weth.mint(address(router), 1_000e18);

        // Fund test users
        usdc.mint(alice,     1_000_000e6);
        usdc.mint(deployer1, 1_000_000e6);

        // Labels
        vm.label(address(satellite), "Satellite");
        vm.label(address(usdc),      "USDC.e");
        vm.label(address(weth),      "WETH");
        vm.label(address(pool),      "Pool");
        vm.label(address(nfpm),      "NFPM");
        vm.label(address(router),    "Router");
        vm.label(messenger,          "messenger");
        vm.label(treasury,           "treasury");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Register an agent and return the assigned agentId.
    function _registerAgent(address dep, address agentAddr, uint256 proving) internal returns (uint256) {
        uint256 idBefore = satellite.nextAgentId();
        vm.startPrank(dep);
        usdc.approve(address(satellite), proving);
        satellite.registerAgent(agentAddr, proving);
        vm.stopPrank();
        return idBefore;
    }

    /// @dev Build a single OPEN_POSITION intent.
    function _openIntent(
        uint256 agentId,
        uint256 amountUSDC,
        int24 tickLower,
        int24 tickUpper,
        bytes memory swapCalldata,
        IShared.ForceCloseSource source
    ) internal pure returns (IShared.Intent memory) {
        return IShared.Intent({
            agentId: agentId,
            actionType: IShared.ActionType.OPEN_POSITION,
            params: abi.encode(amountUSDC, tickLower, tickUpper, swapCalldata, source),
            blockNumber: 1
        });
    }

    /// @dev Build a single CLOSE_POSITION intent.
    function _closeIntent(
        uint256 agentId,
        uint256 tokenId,
        bytes memory swapCalldata
    ) internal pure returns (IShared.Intent memory) {
        return IShared.Intent({
            agentId: agentId,
            actionType: IShared.ActionType.CLOSE_POSITION,
            params: abi.encode(tokenId, swapCalldata),
            blockNumber: 1
        });
    }

    /// @dev Build a single MODIFY_POSITION intent.
    function _modifyIntent(
        uint256 agentId,
        uint256 oldTokenId,
        int24 newTickLower,
        int24 newTickUpper,
        bytes memory closeSwapCalldata,
        bytes memory openSwapCalldata,
        IShared.ForceCloseSource source
    ) internal pure returns (IShared.Intent memory) {
        return IShared.Intent({
            agentId: agentId,
            actionType: IShared.ActionType.MODIFY_POSITION,
            params: abi.encode(oldTokenId, newTickLower, newTickUpper, closeSwapCalldata, openSwapCalldata, source),
            blockNumber: 1
        });
    }

    /// @dev Execute a single intent as messenger.
    function _executeSingleIntent(IShared.Intent memory intent) internal {
        IShared.Intent[] memory batch = new IShared.Intent[](1);
        batch[0] = intent;
        vm.prank(messenger);
        satellite.executeBatch(batch);
    }

    /// @dev Open a position with no swap (pure deposit-token LP). Returns tokenId.
    function _openSimplePosition(
        uint256 agentId,
        uint256 amountUSDC,
        IShared.ForceCloseSource source
    ) internal returns (uint256 tokenId) {
        // Configure NFPM to only consume USDC (no swap needed — token0=USDC)
        nfpm.setMintConsumption(amountUSDC, 0);
        tokenId = nfpm.nextTokenId();

        IShared.Intent memory intent = _openIntent(
            agentId, amountUSDC, -100, 100, bytes(""), source
        );
        _executeSingleIntent(intent);
    }
}
