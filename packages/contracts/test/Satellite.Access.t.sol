// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SatelliteTestBase} from "./helpers/SatelliteTestBase.sol";
import {SatelliteHarness}  from "./helpers/SatelliteHarness.sol";
import {IShared} from "../src/interfaces/IShared.sol";

/// @notice Access-control and constructor validation tests.
///
/// Covers:
///   - All onlyMessenger functions reject non-messenger callers
///   - Constructor zero-address guards
///   - Constructor correctly initialises all immutables and storage
contract SatelliteAccessTest is SatelliteTestBase {

    // =========================================================================
    // onlyMessenger — all restricted functions
    // =========================================================================

    function test_release_onlyMessenger() public {
        _fundSatellite(1_000e6);
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.release(alice, 1_000e6);
    }

    function test_releaseQueuedWithdraw_onlyMessenger() public {
        _fundSatellite(1_000e6);
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.releaseQueuedWithdraw(alice, 1_000e6);
    }

    function test_updateSharePrice_onlyMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.updateSharePrice(2e18);
    }

    function test_reserveFees_onlyMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.reserveFees(100e6, 0, 0);
    }

    function test_releaseCommission_onlyMessenger() public {
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.releaseCommission(alice, 100e6);
    }

    function test_executeBatch_onlyMessenger() public {
        IShared.Intent[] memory intents = new IShared.Intent[](0);

        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.executeBatch(intents);
    }

    function test_forceClose_onlyMessenger() public {
        uint256[] memory posIds = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert("Satellite: not messenger");
        satellite.forceClose(1, posIds, IShared.ForceCloseSource.VAULT);
    }

    // =========================================================================
    // onlyMessenger — confirmed that messenger CAN call
    // =========================================================================

    function test_release_messengerCanCall() public {
        _fundSatellite(1_000e6);
        vm.prank(messenger);
        satellite.release(alice, 1_000e6); // should not revert
    }

    function test_releaseQueuedWithdraw_messengerCanCall() public {
        _fundSatellite(1_000e6);
        vm.prank(messenger);
        satellite.releaseQueuedWithdraw(alice, 1_000e6); // should not revert
    }

    function test_updateSharePrice_messengerCanCall() public {
        vm.prank(messenger);
        satellite.updateSharePrice(1.5e18); // should not revert
    }

    function test_reserveFees_messengerCanCall() public {
        vm.prank(messenger);
        satellite.reserveFees(0, 0, 0); // should not revert (no-op)
    }

    function test_releaseCommission_messengerCanCall_withReserves() public {
        _fundSatellite(500e6);
        _reserveFees(0, 0, 500e6);

        vm.prank(messenger);
        satellite.releaseCommission(alice, 500e6); // should not revert
    }

    /// @dev executeBatch always reverts with "not yet implemented" — but only AFTER the
    ///      messenger check. The messenger should get the "not yet implemented" revert.
    function test_executeBatch_messengerReachesImplementationRevert() public {
        IShared.Intent[] memory intents = new IShared.Intent[](0);

        vm.prank(messenger);
        vm.expectRevert("Satellite: executeBatch not yet implemented");
        satellite.executeBatch(intents);
    }

    function test_forceClose_messengerReachesImplementationRevert() public {
        uint256[] memory posIds = new uint256[](0);
        vm.prank(messenger);
        vm.expectRevert("Satellite: forceClose not yet implemented");
        satellite.forceClose(1, posIds, IShared.ForceCloseSource.VAULT);
    }

    // =========================================================================
    // Constructor — zero-address guards
    // =========================================================================

    function _deploy(
        address _pool,
        address _depositToken,
        address _posMgr,
        address _router,
        address _msngr,
        address _treasury
    ) internal returns (SatelliteHarness) {
        return new SatelliteHarness(
            _pool, _depositToken, _posMgr, _router, _msngr, _treasury, IDLE_RESERVE_RATIO
        );
    }

    function test_constructor_revertsOnZeroPool() public {
        vm.expectRevert("zero pool");
        _deploy(address(0), address(usdc), positionMgr, universalRouter, messenger, treasury);
    }

    function test_constructor_revertsOnZeroDepositToken() public {
        vm.expectRevert("zero depositToken");
        _deploy(address(pool), address(0), positionMgr, universalRouter, messenger, treasury);
    }

    function test_constructor_revertsOnZeroPositionManager() public {
        vm.expectRevert("zero positionManager");
        _deploy(address(pool), address(usdc), address(0), universalRouter, messenger, treasury);
    }

    function test_constructor_revertsOnZeroUniversalRouter() public {
        vm.expectRevert("zero universalRouter");
        _deploy(address(pool), address(usdc), positionMgr, address(0), messenger, treasury);
    }

    function test_constructor_revertsOnZeroMessenger() public {
        vm.expectRevert("zero messenger");
        _deploy(address(pool), address(usdc), positionMgr, universalRouter, address(0), treasury);
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert("zero treasury");
        _deploy(address(pool), address(usdc), positionMgr, universalRouter, messenger, address(0));
    }

    function test_constructor_revertsWhenIdleReserveRatioOver100Pct() public {
        vm.expectRevert("idleReserveRatio > 100%");
        new SatelliteHarness(
            address(pool), address(usdc), positionMgr,
            universalRouter, messenger, treasury, 10_001
        );
    }

    // =========================================================================
    // Constructor — immutable initialisation
    // =========================================================================

    function test_constructor_setsPoolImmutable() public {
        assertEq(satellite.pool(), address(pool));
    }

    function test_constructor_setsDepositTokenImmutable() public {
        assertEq(satellite.depositToken(), address(usdc));
    }

    function test_constructor_setsPositionManagerImmutable() public {
        assertEq(satellite.positionManager(), positionMgr);
    }

    function test_constructor_setsUniversalRouterImmutable() public {
        assertEq(satellite.universalRouter(), universalRouter);
    }

    function test_constructor_setsMessengerImmutable() public {
        assertEq(satellite.messenger(), messenger);
    }

    function test_constructor_setsTreasuryImmutable() public {
        assertEq(satellite.protocolTreasury(), treasury);
    }

    function test_constructor_setsIdleReserveRatioImmutable() public {
        assertEq(satellite.idleReserveRatio(), IDLE_RESERVE_RATIO);
    }

    function test_constructor_setsToken0FromPool() public {
        assertEq(satellite.token0(), pool.token0());
    }

    function test_constructor_setsToken1FromPool() public {
        assertEq(satellite.token1(), pool.token1());
    }

    function test_constructor_setsPoolFeeFromPool() public {
        assertEq(satellite.poolFee(), pool.fee());
    }

    function test_constructor_initialSharePriceIsOneToOne() public {
        assertEq(satellite.cachedSharePrice(), 1e18);
    }

    function test_constructor_agentCounterStartsAtOne() public {
        assertEq(satellite.nextAgentId(), 1);
    }

    function test_constructor_initialIdleBalanceIsZero() public {
        assertEq(satellite.idleBalance(), 0);
    }

    function test_constructor_initialProtocolReserveIsZero() public {
        assertEq(satellite.protocolReserve(), 0);
    }
}
