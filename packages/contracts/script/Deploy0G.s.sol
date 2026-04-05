// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {AgentManager} from "../src/AgentManager.sol";

/// @notice Deploys AgentManager + Vault to 0G testnet (chain ID 16602).
///         Uses the pre-deployed AgenticID (ERC-7857) at 0x2700F6...
///
/// Usage (full stack):
///   forge script script/Deploy0G.s.sol --rpc-url og_testnet --broadcast --verify
///
/// Usage (AgentManager-only, when Vault is already deployed):
///   forge script script/Deploy0G.s.sol --sig "deployAgentManagerOnly()" \
///     --rpc-url og_testnet --broadcast
///
/// Usage (Vault-only, when AgentManager is already deployed):
///   forge script script/Deploy0G.s.sol --sig "deployVaultOnly()" \
///     --rpc-url og_testnet --broadcast
///
/// Required env vars (see .env.example):
///   PRIVATE_KEY_DEPLOYER, ADDRESS_DEPLOYER, ADDRESS_RELAYER
///   EPOCH_LENGTH, MAX_EXPOSURE_RATIO, PROTOCOL_FEE_RATE, COMMISSION_RATE
contract Deploy0G is Script {

    // -------------------------------------------------------------------------
    // Pre-deployed AgenticID (ERC-7857) on 0G Galileo testnet
    // -------------------------------------------------------------------------

    address constant AGENTIC_ID = 0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F;

    // -------------------------------------------------------------------------
    // AgentManager constructor constants — demo-tuned for hackathon
    // -------------------------------------------------------------------------

    uint256 constant ALPHA                  = 3000;       // 0.30 EMA decay
    uint256 constant MAX_AGENTS             = 2;          // max vault-phase agents (2 of 3 compete)
    uint256 constant TOTAL_REFILL_BUDGET    = 1_000_000e6;// 1M USDC credits per epoch
    uint256 constant PROVING_EPOCHS_REQUIRED = 2;         // epochs before promotion eligible
    uint256 constant MIN_PROMOTION_SHARPE   = 500;        // 0.05 Sharpe minimum (scaled x10000)
    uint256 constant MIN_ACTION_INTERVAL    = 10;         // blocks between actions
    uint256 constant MAX_PROMOTION_SHARE    = 1000;       // 10% max vault share for new promotee
    uint256 constant RAMP_EPOCHS            = 3;          // epochs to ramp to full allocation
    uint256 constant EVICTION_EPOCHS        = 3;          // consecutive zero-Sharpe epochs → evict

    // -------------------------------------------------------------------------
    // Full-stack deploy: AgentManager + Vault + link
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

        // ── 1. Deploy AgentManager ───────────────────────────────────────
        AgentManager agentManager = new AgentManager(
            AGENTIC_ID,
            messenger,
            ALPHA,
            MAX_AGENTS,
            TOTAL_REFILL_BUDGET,
            PROVING_EPOCHS_REQUIRED,
            MIN_PROMOTION_SHARPE,
            MIN_ACTION_INTERVAL,
            MAX_PROMOTION_SHARE,
            RAMP_EPOCHS,
            EVICTION_EPOCHS
        );
        console.log("AgentManager deployed:", address(agentManager));

        // ── 2. Deploy Vault ──────────────────────────────────────────────
        Vault vault = new Vault(
            address(agentManager),
            epochLength,
            maxExposureRatio,
            protocolFeeRate,
            treasury,
            commissionRate,
            vm.envAddress("USDC_E_ADDRESS"),
            vm.envAddress("UNISWAP_V3_POOL_ADDRESS"),
            messenger
        );
        console.log("Vault deployed:       ", address(vault));

        // ── 3. Link AgentManager → Vault ─────────────────────────────────
        agentManager.setVault(address(vault));
        console.log("AgentManager.setVault() complete");

        // ── 4. Fund AgentManager for iNFT mintFee ────────────────────────
        // Send a small amount of 0G tokens so AgentManager can pay mintFee
        // when minting iNFTs via AgenticID.iMint{value: mintFee}()
        (bool sent,) = address(agentManager).call{value: 0.1 ether}("");
        require(sent, "fund AgentManager failed");
        console.log("AgentManager funded with 0.1 0G for mintFee");

        vm.stopBroadcast();

        // ── 5. Summary ──────────────────────────────────────────────────
        console.log("\n=== Copy into .env ===");
        console.log("AGENT_MANAGER_ADDRESS=", address(agentManager));
        console.log("VAULT_ADDRESS=",         address(vault));
        console.log("INFT_ADDRESS=",          AGENTIC_ID);
    }

    // -------------------------------------------------------------------------
    // AgentManager-only deploy (Vault already exists)
    // -------------------------------------------------------------------------

    function deployAgentManagerOnly() external {
        address messenger = vm.envAddress("ADDRESS_RELAYER");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        AgentManager agentManager = new AgentManager(
            AGENTIC_ID,
            messenger,
            ALPHA,
            MAX_AGENTS,
            TOTAL_REFILL_BUDGET,
            PROVING_EPOCHS_REQUIRED,
            MIN_PROMOTION_SHARPE,
            MIN_ACTION_INTERVAL,
            MAX_PROMOTION_SHARE,
            RAMP_EPOCHS,
            EVICTION_EPOCHS
        );

        // Link to existing Vault
        address vaultAddr = vm.envAddress("VAULT_ADDRESS");
        agentManager.setVault(vaultAddr);

        // Fund for mintFee
        (bool sent,) = address(agentManager).call{value: 0.1 ether}("");
        require(sent, "fund failed");

        vm.stopBroadcast();

        console.log("AgentManager deployed:", address(agentManager));
        console.log("  linked to Vault:   ", vaultAddr);
        console.log("  agenticId:         ", AGENTIC_ID);
        console.log("\n=== Copy into .env ===");
        console.log("AGENT_MANAGER_ADDRESS=", address(agentManager));
    }

    // -------------------------------------------------------------------------
    // Vault-only deploy (AgentManager already exists)
    // -------------------------------------------------------------------------

    function deployVaultOnly() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY_DEPLOYER"));

        Vault vault = new Vault(
            vm.envAddress("AGENT_MANAGER_ADDRESS"),
            vm.envUint("EPOCH_LENGTH"),
            vm.envUint("MAX_EXPOSURE_RATIO"),
            vm.envUint("PROTOCOL_FEE_RATE"),
            vm.envAddress("ADDRESS_DEPLOYER"),
            vm.envUint("COMMISSION_RATE"),
            vm.envAddress("USDC_E_ADDRESS"),
            vm.envAddress("UNISWAP_V3_POOL_ADDRESS"),
            vm.envAddress("ADDRESS_RELAYER")
        );

        vm.stopBroadcast();

        console.log("Vault deployed:       ", address(vault));
        console.log("\n=== Copy into .env ===");
        console.log("VAULT_ADDRESS=", address(vault));
    }
}
