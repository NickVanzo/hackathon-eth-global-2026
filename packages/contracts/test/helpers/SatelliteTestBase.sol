// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SatelliteHarness} from "./SatelliteHarness.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockUniswapV3Pool} from "../mocks/MockUniswapV3Pool.sol";
import {IShared} from "../../src/interfaces/IShared.sol";

/// @dev Shared test state and helpers inherited by all Satellite test suites.
abstract contract SatelliteTestBase is Test {
    // -------------------------------------------------------------------------
    // Deployed contracts
    // -------------------------------------------------------------------------

    MockERC20          internal usdc;
    MockERC20          internal weth;
    MockUniswapV3Pool  internal pool;
    SatelliteHarness   internal satellite;

    // -------------------------------------------------------------------------
    // Named actors
    // -------------------------------------------------------------------------

    address internal messenger       = makeAddr("messenger");
    address internal treasury        = makeAddr("treasury");
    address internal alice           = makeAddr("alice");
    address internal bob             = makeAddr("bob");
    address internal charlie         = makeAddr("charlie");
    address internal agentEOA        = makeAddr("agentEOA");
    address internal positionMgr     = makeAddr("positionManager");
    address internal universalRouter = makeAddr("universalRouter");

    // -------------------------------------------------------------------------
    // Convenient amounts (USDC.e has 6 decimals)
    // -------------------------------------------------------------------------

    uint256 internal constant ONE_USDC         = 1e6;
    uint256 internal constant TEN_K_USDC       = 10_000e6;
    uint256 internal constant IDLE_RESERVE_RATIO = 2_000; // 20 %

    // -------------------------------------------------------------------------
    // setUp
    // -------------------------------------------------------------------------

    function setUp() public virtual {
        usdc = new MockERC20("USD Coin Bridged", "USDC.e", 6);
        weth = new MockERC20("Wrapped Ether",    "WETH",   18);

        // Pool: USDC.e / WETH, 0.3 % tier
        pool = new MockUniswapV3Pool(address(usdc), address(weth), 3000);

        satellite = new SatelliteHarness(
            address(pool),
            address(usdc),
            positionMgr,
            universalRouter,
            messenger,
            treasury,
            IDLE_RESERVE_RATIO
        );

        // Fund test users generously
        usdc.mint(alice,   1_000_000e6);
        usdc.mint(bob,     1_000_000e6);
        usdc.mint(charlie, 1_000_000e6);

        // Labels for cleaner traces
        vm.label(address(satellite), "Satellite");
        vm.label(address(usdc),      "USDC.e");
        vm.label(address(weth),      "WETH");
        vm.label(address(pool),      "Pool");
        vm.label(messenger,          "messenger");
        vm.label(treasury,           "treasury");
        vm.label(alice,              "alice");
        vm.label(bob,                "bob");
        vm.label(charlie,            "charlie");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Approve and deposit as `user`.
    function _deposit(address user, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(satellite), amount);
        satellite.deposit(amount);
        vm.stopPrank();
    }

    /// @dev Approve and register an agent as `deployer`.
    ///      Returns the agentId that was assigned.
    function _registerAgent(address deployer, address agentAddr, uint256 proving) internal returns (uint256) {
        uint256 idBefore = satellite.nextAgentId();
        vm.startPrank(deployer);
        usdc.approve(address(satellite), proving);
        satellite.registerAgent(agentAddr, proving);
        vm.stopPrank();
        return idBefore; // the id that was just consumed (counter starts at 1)
    }

    /// @dev Mint tokens directly to the satellite (simulates protocol holding funds
    ///      without going through deposit()).  Useful for testing releases without
    ///      needing an entire deposit flow.
    function _fundSatellite(uint256 amount) internal {
        usdc.mint(address(satellite), amount);
    }

    /// @dev Reserve protocol fees via the messenger.
    function _reserveProtocolFees(uint256 amount) internal {
        vm.prank(messenger);
        satellite.reserveProtocolFees(amount);
    }

    /// @dev Reserve commission for an agent via the messenger.
    function _reserveCommission(uint256 agentId, uint256 amount) internal {
        vm.prank(messenger);
        satellite.reserveCommission(agentId, amount);
    }
}
