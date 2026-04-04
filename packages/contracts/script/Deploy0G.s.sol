// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

// TODO: uncomment as contracts are implemented
// import {AgentNFT}     from "../src/AgentNFT.sol";
// import {AgentManager} from "../src/AgentManager.sol";
// import {Vault}        from "../src/Vault.sol";

/// @notice Deploys iNFT + AgentManager + Vault to 0G testnet (chain ID 16602).
/// @dev Run with:
///   forge script script/Deploy0G.s.sol --rpc-url og_testnet --broadcast --verify
///
/// Required env vars (see .env.example):
///   PRIVATE_KEY_DEPLOYER, OG_RPC_URL
///   SEPOLIA_RPC_URL (for satellite address reference)
///   UNISWAP_V3_POOL_ADDRESS, USDC_E_ADDRESS
///   EPOCH_LENGTH, MAX_EXPOSURE_RATIO, PROTOCOL_FEE_RATE, COMMISSION_RATE
///   SATELLITE_ADDRESS (fill after DeploySepolia runs)
contract Deploy0G is Script {
    // -------------------------------------------------------------------------
    // Constructor parameter values — adjust for demo vs production
    // -------------------------------------------------------------------------

    // EMA decay factor: 3000 = 0.30 (30% weight on most recent epoch)
    uint256 constant ALPHA = 3000;

    // Maximum agents with live token buckets (3 for demo, up to 20 for prod)
    uint256 constant MAX_AGENTS = 3;

    // Total credits distributed per epoch across all vault agents
    uint256 constant TOTAL_REFILL_BUDGET = 1_000_000e6; // 1M USDC units

    // Epochs an agent must trade its own capital before vault promotion
    uint256 constant PROVING_EPOCHS_REQUIRED = 3;

    // Minimum Sharpe score (scaled x10000) to be eligible for promotion
    uint256 constant MIN_PROMOTION_SHARPE = 500; // 0.05

    // Minimum blocks between consecutive agent actions (anti-churn)
    uint256 constant MIN_ACTION_INTERVAL = 10;

    // -------------------------------------------------------------------------
    // Script entry point
    // -------------------------------------------------------------------------
    function run() external {
        address deployer  = vm.envAddress("ADDRESS_DEPLOYER");
        address messenger = vm.envAddress("ADDRESS_RELAYER");
        address satellite = vm.envAddress("SATELLITE_ADDRESS");
        address pool      = vm.envAddress("UNISWAP_V3_POOL_ADDRESS");
        address treasury  = deployer; // protocol treasury = deployer for hackathon
        address usdce     = vm.envAddress("USDC_E_ADDRESS");

        uint256 epochLength      = vm.envUint("EPOCH_LENGTH");
        uint256 maxExposureRatio = vm.envUint("MAX_EXPOSURE_RATIO");
        uint256 protocolFeeRate  = vm.envUint("PROTOCOL_FEE_RATE");
        uint256 commissionRate   = vm.envUint("COMMISSION_RATE");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        // 1. Deploy iNFT
        // AgentNFT inft = new AgentNFT();
        // console.log("iNFT deployed:", address(inft));

        // 2. Deploy AgentManager
        // AgentManager agentManager = new AgentManager(
        //     ALPHA,
        //     MAX_AGENTS,
        //     TOTAL_REFILL_BUDGET,
        //     PROVING_EPOCHS_REQUIRED,
        //     MIN_PROMOTION_SHARPE,
        //     MIN_ACTION_INTERVAL,
        //     messenger,
        //     address(inft)
        // );
        // console.log("AgentManager deployed:", address(agentManager));

        // 3. Deploy Vault
        // Vault vault = new Vault(
        //     address(agentManager),
        //     epochLength,
        //     maxExposureRatio,
        //     protocolFeeRate,
        //     treasury,
        //     commissionRate,
        //     usdce,
        //     pool,
        //     messenger,
        //     satellite
        // );
        // console.log("Vault deployed:", address(vault));

        // 4. Complete circular reference
        // agentManager.setVault(address(vault));
        // console.log("AgentManager.setVault() complete");

        vm.stopBroadcast();

        // 5. Print env vars to copy into .env
        // console.log("\n--- Copy into .env ---");
        // console.log("INFT_ADDRESS=",           address(inft));
        // console.log("AGENT_MANAGER_ADDRESS=",  address(agentManager));
        // console.log("VAULT_ADDRESS=",           address(vault));
    }
}
