// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Satellite} from "../src/Satellite.sol";

/// @notice Deploys Satellite to Ethereum Sepolia (chain ID 11155111).
/// @dev Run with:
///   forge script script/DeploySepolia.s.sol --rpc-url sepolia --broadcast --verify
///
/// Required env vars (see .env):
///   PRIVATE_KEY_DEPLOYER, SEPOLIA_RPC_URL
///   UNISWAP_V3_POOL_ADDRESS, USDC_E_ADDRESS
///   UNISWAP_POSITION_MANAGER, UNISWAP_UNIVERSAL_ROUTER
///   ADDRESS_RELAYER, PROTOCOL_TREASURY, IDLE_RESERVE_RATIO
contract DeploySepolia is Script {
    function run() external {
        address messenger        = vm.envAddress("ADDRESS_RELAYER");
        address pool             = vm.envAddress("UNISWAP_V3_POOL_ADDRESS");
        address usdce            = vm.envAddress("USDC_E_ADDRESS");
        address positionManager  = vm.envAddress("UNISWAP_POSITION_MANAGER");
        address universalRouter  = vm.envAddress("UNISWAP_UNIVERSAL_ROUTER");
        address treasury         = vm.envAddress("PROTOCOL_TREASURY");
        uint256 idleReserveRatio = vm.envUint("IDLE_RESERVE_RATIO");

        console.log("Deploying Satellite to Sepolia...");
        console.log("  messenger:        ", messenger);
        console.log("  pool:             ", pool);
        console.log("  depositToken:     ", usdce);
        console.log("  positionManager:  ", positionManager);
        console.log("  universalRouter:  ", universalRouter);
        console.log("  treasury:         ", treasury);
        console.log("  idleReserveRatio: ", idleReserveRatio);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        Satellite satellite = new Satellite(
            pool,
            usdce,
            positionManager,
            universalRouter,
            messenger,
            treasury,
            idleReserveRatio
        );

        console.log("Satellite deployed at:", address(satellite));

        vm.stopBroadcast();

        console.log("\n--- Copy into .env ---");
        console.log("SATELLITE_ADDRESS=", address(satellite));
    }
}
