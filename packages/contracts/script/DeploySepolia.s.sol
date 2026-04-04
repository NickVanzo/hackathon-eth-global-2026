// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

// TODO: uncomment as contracts are implemented
// import {Satellite} from "../src/Satellite.sol";

/// @notice Deploys Satellite to Ethereum Sepolia (chain ID 11155111).
/// @dev Run with:
///   forge script script/DeploySepolia.s.sol --rpc-url sepolia --broadcast --verify
///
/// Required env vars (see .env.example):
///   PRIVATE_KEY_DEPLOYER, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY
///   UNISWAP_V3_POOL_ADDRESS, USDC_E_ADDRESS
///   UNISWAP_POSITION_MANAGER, UNISWAP_SWAP_ROUTER
contract DeploySepolia is Script {
    function run() external {
        address messenger        = vm.envAddress("ADDRESS_RELAYER");
        address pool             = vm.envAddress("UNISWAP_V3_POOL_ADDRESS");
        address usdce            = vm.envAddress("USDC_E_ADDRESS");
        address positionManager  = vm.envAddress("UNISWAP_POSITION_MANAGER");
        address swapRouter       = vm.envAddress("UNISWAP_SWAP_ROUTER");
        address treasury         = vm.envAddress("ADDRESS_DEPLOYER"); // protocol treasury

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        // Deploy Satellite
        // Satellite satellite = new Satellite(
        //     pool,
        //     usdce,
        //     positionManager,
        //     swapRouter,
        //     messenger,
        //     treasury
        // );
        // console.log("Satellite deployed:", address(satellite));

        vm.stopBroadcast();

        // console.log("\n--- Copy into .env ---");
        // console.log("SATELLITE_ADDRESS=", address(satellite));
    }
}
