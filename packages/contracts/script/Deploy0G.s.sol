// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";

// Uncomment once AgentNFT + AgentManager are implemented (Hour 3:45)
// import {AgentNFT}     from "../src/AgentNFT.sol";
// import {AgentManager} from "../src/AgentManager.sol";

/// @notice Deploys iNFT + AgentManager + Vault to 0G testnet (chain ID 16602).
///
/// Usage (full stack, once AgentManager is ready):
///   forge script script/Deploy0G.s.sol --rpc-url og_testnet --broadcast --verify
///
/// Usage (Vault-only, relayer uses a mock AgentManager address for now):
///   AGENT_MANAGER_ADDRESS=0x000...  forge script script/Deploy0G.s.sol \
///     --sig "deployVaultOnly()" --rpc-url og_testnet --broadcast
///
/// Required env vars (see .env.example):
///   PRIVATE_KEY_DEPLOYER
///   ADDRESS_DEPLOYER, ADDRESS_RELAYER
///   EPOCH_LENGTH, MAX_EXPOSURE_RATIO, PROTOCOL_FEE_RATE, COMMISSION_RATE
///   AGENT_MANAGER_ADDRESS  (real addr once deployed, or placeholder for Vault-only run)
contract Deploy0G is Script {

    // -------------------------------------------------------------------------
    // AgentManager constructor constants — adjust for demo vs production
    // -------------------------------------------------------------------------

    /// @dev EMA decay factor: 3000 = 0.30 (30 % weight on the most recent epoch).
    uint256 constant ALPHA = 3000;

    /// @dev Maximum agents with live token buckets (3 for demo, ≤20 for prod).
    uint256 constant MAX_AGENTS = 3;

    /// @dev Total USDC.e-unit credits distributed per epoch across all vault agents.
    uint256 constant TOTAL_REFILL_BUDGET = 1_000_000e6; // 1 M units

    /// @dev Epochs a proving agent must complete before vault promotion eligibility.
    uint256 constant PROVING_EPOCHS_REQUIRED = 3;

    /// @dev Minimum Sharpe score (×10 000) for promotion (e.g. 500 = 0.05).
    uint256 constant MIN_PROMOTION_SHARPE = 500;

    /// @dev Minimum blocks between consecutive agent actions (anti-churn cooldown).
    uint256 constant MIN_ACTION_INTERVAL = 10;

    // -------------------------------------------------------------------------
    // Full-stack deploy (iNFT + AgentManager + Vault)
    // -------------------------------------------------------------------------

    function run() external {
        address deployer  = vm.envAddress("ADDRESS_DEPLOYER");
        address messenger = vm.envAddress("ADDRESS_RELAYER");
        address treasury  = deployer; // protocol treasury = deployer for hackathon

        uint256 epochLength      = vm.envUint("EPOCH_LENGTH");
        uint256 maxExposureRatio = vm.envUint("MAX_EXPOSURE_RATIO");
        uint256 protocolFeeRate  = vm.envUint("PROTOCOL_FEE_RATE");
        uint256 commissionRate   = vm.envUint("COMMISSION_RATE");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        // ── 1. Deploy iNFT ───────────────────────────────────────────────────
        // AgentNFT inft = new AgentNFT();
        // console.log("iNFT deployed:        ", address(inft));

        // ── 2. Deploy AgentManager ───────────────────────────────────────────
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

        // ── 3. Deploy Vault ───────────────────────────────────────────────────
        // Vault vault = new Vault(
        //     address(agentManager),
        //     epochLength,
        //     maxExposureRatio,
        //     protocolFeeRate,
        //     treasury,
        //     commissionRate,
        //     messenger
        // );
        // console.log("Vault deployed:       ", address(vault));

        // ── 4. Complete circular reference ────────────────────────────────────
        // agentManager.setVault(address(vault));
        // console.log("AgentManager.setVault() complete");

        vm.stopBroadcast();

        // ── 5. Print addresses to copy into .env ──────────────────────────────
        // console.log("\n--- Copy into .env ---");
        // console.log("INFT_ADDRESS=",          address(inft));
        // console.log("AGENT_MANAGER_ADDRESS=", address(agentManager));
        // console.log("VAULT_ADDRESS=",          address(vault));
    }

    // -------------------------------------------------------------------------
    // Vault-only deploy (Dev B can unblock before AgentManager is ready)
    // Pass a placeholder AGENT_MANAGER_ADDRESS in .env; call setVault() later.
    // -------------------------------------------------------------------------

    function deployVaultOnly() external {
        address deployer     = vm.envAddress("ADDRESS_DEPLOYER");
        address messenger    = vm.envAddress("ADDRESS_RELAYER");
        address agentManager = vm.envAddress("AGENT_MANAGER_ADDRESS");
        address treasury     = deployer;

        uint256 epochLength      = vm.envUint("EPOCH_LENGTH");
        uint256 maxExposureRatio = vm.envUint("MAX_EXPOSURE_RATIO");
        uint256 protocolFeeRate  = vm.envUint("PROTOCOL_FEE_RATE");
        uint256 commissionRate   = vm.envUint("COMMISSION_RATE");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        Vault vault = new Vault(
            agentManager,
            epochLength,
            maxExposureRatio,
            protocolFeeRate,
            treasury,
            commissionRate,
            messenger
        );

        vm.stopBroadcast();

        console.log("Vault deployed:       ", address(vault));
        console.log("agentManager param:   ", agentManager);
        console.log("epochLength:          ", epochLength);
        console.log("maxExposureRatio:     ", maxExposureRatio);
        console.log("protocolFeeRate:      ", protocolFeeRate);
        console.log("commissionRate:       ", commissionRate);
        console.log("messenger:            ", messenger);
        console.log("\nAdd to .env:");
        console.log("VAULT_ADDRESS=", address(vault));
    }
}
