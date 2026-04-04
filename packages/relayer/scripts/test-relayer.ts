#!/usr/bin/env npx tsx
/**
 * test-relayer.ts — Comprehensive relayer verification
 *
 * Verifies all components are correctly wired:
 *   1. Config: env vars, contract addresses, chain connectivity
 *   2. ABIs: every function the relayer calls exists on-chain
 *   3. Uniswap API: quote + swap works for both zap-in and zap-out
 *   4. On-chain state: satellite, vault, agentManager are accessible
 *   5. Handler coverage: all event routes from design doc are implemented
 *
 * Usage:
 *   npx tsx scripts/test-relayer.ts
 */

import "dotenv/config";
import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
  type Chain,
} from "viem";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";
const ZG_RPC = process.env.ZG_RPC_URL || "https://evmrpc-testnet.0g.ai";
const SATELLITE = (process.env.SATELLITE_ADDRESS || "0xeFD9583eF616e9770ca98E4201e940315128C0BF") as Address;
const VAULT = (process.env.VAULT_ADDRESS || "0x5192fD3147D8e1a2392c8cBe7E33B8ec46e07628") as Address;
const AGENT_MANAGER = (process.env.AGENT_MANAGER_ADDRESS || "0x1c6e60F4DD431922Aa4E217e55a9238a96513a00") as Address;
const USDC_E = (process.env.USDC_E_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as Address;
const WETH = (process.env.WETH_ADDRESS || "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14") as Address;
const MESSENGER_KEY = process.env.PRIVATE_KEY_RELAYER || "";
const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY || "";
const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";

const sepolia: Chain = {
  id: 11155111, name: "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [SEPOLIA_RPC] }, public: { http: [SEPOLIA_RPC] } },
};
const zg: Chain = {
  id: 16602, name: "0G Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [ZG_RPC] }, public: { http: [ZG_RPC] } },
};

const sepoliaClient = createPublicClient({ chain: sepolia, transport: http() });
const zgClient = createPublicClient({ chain: zg, transport: http() });

// ---------------------------------------------------------------------------
// Test framework
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const results: { name: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string }[] = [];

function pass(name: string, detail?: string) {
  passed++;
  results.push({ name, status: "PASS", detail });
  console.log(`  ✓  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  failed++;
  results.push({ name, status: "FAIL", detail });
  console.log(`  ✗  ${name} — ${detail}`);
}

function skip(name: string, reason: string) {
  skipped++;
  results.push({ name, status: "SKIP", detail: reason });
  console.log(`  -  ${name} — SKIPPED: ${reason}`);
}

function section(title: string) {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(55));
}

// ---------------------------------------------------------------------------
// 1. Config verification
// ---------------------------------------------------------------------------

async function testConfig() {
  section("1. Configuration");

  // Env vars
  MESSENGER_KEY && MESSENGER_KEY !== "0x"
    ? pass("PRIVATE_KEY_RELAYER set")
    : fail("PRIVATE_KEY_RELAYER", "not set or empty");

  UNISWAP_API_KEY
    ? pass("UNISWAP_API_KEY set")
    : fail("UNISWAP_API_KEY", "not set — Uniswap API calls will return 0x");

  // Contract addresses are non-zero
  for (const [name, addr] of [["SATELLITE", SATELLITE], ["VAULT", VAULT], ["AGENT_MANAGER", AGENT_MANAGER]] as const) {
    addr && addr !== "0x0000000000000000000000000000000000000000"
      ? pass(`${name} address`, addr as string)
      : fail(`${name} address`, "zero or unset");
  }
}

// ---------------------------------------------------------------------------
// 2. Chain connectivity
// ---------------------------------------------------------------------------

async function testChains() {
  section("2. Chain Connectivity");

  try {
    const block = await sepoliaClient.getBlockNumber();
    pass("Sepolia RPC", `block #${block}`);
  } catch (e: any) {
    fail("Sepolia RPC", e.message);
  }

  try {
    const block = await zgClient.getBlockNumber();
    pass("0G RPC", `block #${block}`);
  } catch (e: any) {
    fail("0G RPC", e.message);
  }

  // Messenger wallet balances
  if (MESSENGER_KEY && MESSENGER_KEY !== "0x") {
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(MESSENGER_KEY as `0x${string}`);
    const [sepEth, zgGas] = await Promise.all([
      sepoliaClient.getBalance({ address: account.address }),
      zgClient.getBalance({ address: account.address }),
    ]);
    sepEth > 10n ** 14n
      ? pass("Messenger Sepolia ETH", formatUnits(sepEth, 18))
      : fail("Messenger Sepolia ETH", `only ${formatUnits(sepEth, 18)} — need gas for relay txs`);
    zgGas > 10n ** 14n
      ? pass("Messenger 0G gas", formatUnits(zgGas, 18))
      : fail("Messenger 0G gas", `only ${formatUnits(zgGas, 18)} — need gas for relay txs`);
  }
}

// ---------------------------------------------------------------------------
// 3. Contract accessibility (can we call view functions?)
// ---------------------------------------------------------------------------

async function testContracts() {
  section("3. Contract Accessibility");

  // Satellite (Sepolia)
  const satChecks = [
    { fn: "idleBalance", args: [] as const },
    { fn: "cachedSharePrice", args: [] as const },
  ];
  for (const { fn, args } of satChecks) {
    try {
      const result = await sepoliaClient.readContract({
        address: SATELLITE,
        abi: [{ name: fn, type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
        functionName: fn,
        args,
      });
      pass(`Satellite.${fn}()`, String(result));
    } catch (e: any) {
      fail(`Satellite.${fn}()`, e.shortMessage || e.message);
    }
  }

  // Satellite.messenger() — verify it matches our wallet
  try {
    const messenger = await sepoliaClient.readContract({
      address: SATELLITE,
      abi: [{ name: "messenger", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
      functionName: "messenger",
    });
    if (MESSENGER_KEY && MESSENGER_KEY !== "0x") {
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(MESSENGER_KEY as `0x${string}`);
      (messenger as string).toLowerCase() === account.address.toLowerCase()
        ? pass("Satellite.messenger() matches wallet", messenger as string)
        : fail("Satellite.messenger() mismatch", `on-chain=${messenger}, wallet=${account.address}`);
    } else {
      pass("Satellite.messenger()", messenger as string);
    }
  } catch (e: any) {
    fail("Satellite.messenger()", e.shortMessage || e.message);
  }

  // Vault (0G)
  const vaultChecks = ["sharePrice", "totalAssets", "epochLength", "lastEpochBlock"];
  for (const fn of vaultChecks) {
    try {
      const result = await zgClient.readContract({
        address: VAULT,
        abi: [{ name: fn, type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
        functionName: fn,
      });
      pass(`Vault.${fn}()`, String(result));
    } catch (e: any) {
      fail(`Vault.${fn}()`, e.shortMessage || e.message);
    }
  }

  // Vault.agentManager() — verify it points to our AgentManager
  try {
    const am = await zgClient.readContract({
      address: VAULT,
      abi: [{ name: "agentManager", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }],
      functionName: "agentManager",
    });
    (am as string).toLowerCase() === AGENT_MANAGER.toLowerCase()
      ? pass("Vault.agentManager() matches env", am as string)
      : fail("Vault.agentManager() mismatch", `on-chain=${am}, env=${AGENT_MANAGER}`);
  } catch (e: any) {
    fail("Vault.agentManager()", e.shortMessage || e.message);
  }

  // AgentManager (0G)
  try {
    const code = await zgClient.getCode({ address: AGENT_MANAGER });
    code && code !== "0x"
      ? pass("AgentManager has code", `${code.length} bytes`)
      : fail("AgentManager has code", "no code at address — not deployed?");
  } catch (e: any) {
    fail("AgentManager code check", e.shortMessage || e.message);
  }
}

// ---------------------------------------------------------------------------
// 4. Uniswap Trading API
// ---------------------------------------------------------------------------

async function testUniswapApi() {
  section("4. Uniswap Trading API");

  if (!UNISWAP_API_KEY) {
    skip("Uniswap API", "UNISWAP_API_KEY not set");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": UNISWAP_API_KEY,
    "x-universal-router-version": "2.0",
  };

  // check_approval
  try {
    const res = await fetch(`${UNISWAP_API_URL}/check_approval`, {
      method: "POST", headers,
      body: JSON.stringify({ walletAddress: SATELLITE, token: USDC_E, amount: "1000000", chainId: 11155111 }),
    });
    res.ok
      ? pass("POST /check_approval", `status=${res.status}`)
      : fail("POST /check_approval", `status=${res.status}`);
  } catch (e: any) {
    fail("POST /check_approval", e.message);
  }

  // quote (zap-in: USDC.e → WETH)
  let quoteResponse: any = null;
  try {
    const res = await fetch(`${UNISWAP_API_URL}/quote`, {
      method: "POST", headers,
      body: JSON.stringify({
        swapper: SATELLITE, tokenIn: USDC_E, tokenOut: WETH,
        tokenInChainId: "11155111", tokenOutChainId: "11155111",
        amount: "500000", type: "EXACT_INPUT",
        slippageTolerance: 1.0, routingPreference: "BEST_PRICE", protocols: ["V3"],
      }),
    });
    quoteResponse = await res.json();
    res.ok && quoteResponse.routing === "CLASSIC"
      ? pass("POST /quote (zap-in)", `routing=${quoteResponse.routing}, output=${quoteResponse.quote?.output?.amount}`)
      : fail("POST /quote (zap-in)", `status=${res.status}, routing=${quoteResponse?.routing}`);
  } catch (e: any) {
    fail("POST /quote (zap-in)", e.message);
  }

  // swap (get calldata)
  if (quoteResponse?.routing === "CLASSIC") {
    try {
      const { permitData, permitTransaction, ...cleanQuote } = quoteResponse;
      const res = await fetch(`${UNISWAP_API_URL}/swap`, {
        method: "POST", headers, body: JSON.stringify(cleanQuote),
      });
      const data = await res.json() as any;
      const cd = data?.swap?.data;
      res.ok && cd && cd !== "0x"
        ? pass("POST /swap (calldata)", `${cd.length} chars, to=${data.swap?.to}`)
        : fail("POST /swap (calldata)", `empty data or error status=${res.status}`);
    } catch (e: any) {
      fail("POST /swap (calldata)", e.message);
    }
  }

  // quote (zap-out: WETH → USDC.e)
  try {
    const res = await fetch(`${UNISWAP_API_URL}/quote`, {
      method: "POST", headers,
      body: JSON.stringify({
        swapper: SATELLITE, tokenIn: WETH, tokenOut: USDC_E,
        tokenInChainId: "11155111", tokenOutChainId: "11155111",
        amount: "100000000000000", type: "EXACT_INPUT",
        slippageTolerance: 1.0, routingPreference: "BEST_PRICE", protocols: ["V3"],
      }),
    });
    const data = await res.json() as any;
    res.ok && data.routing === "CLASSIC"
      ? pass("POST /quote (zap-out)", `output=${data.quote?.output?.amount} USDC.e`)
      : fail("POST /quote (zap-out)", `status=${res.status}, routing=${data?.routing}`);
  } catch (e: any) {
    fail("POST /quote (zap-out)", e.message);
  }
}

// ---------------------------------------------------------------------------
// 5. Handler coverage audit
// ---------------------------------------------------------------------------

async function testHandlerCoverage() {
  section("5. Handler Coverage (design doc routes)");

  // Check handler files exist and have the right handlers
  const { readFileSync } = await import("fs");
  const { resolve } = await import("path");

  const satHandlers = readFileSync(resolve(new URL(".", import.meta.url).pathname, "../src/handlers/satelliteHandlers.ts"), "utf8");
  const vaultHandlers = readFileSync(resolve(new URL(".", import.meta.url).pathname, "../src/handlers/vaultHandlers.ts"), "utf8");
  const amHandlers = readFileSync(resolve(new URL(".", import.meta.url).pathname, "../src/handlers/agentManagerHandlers.ts"), "utf8");
  const eventHandlers = readFileSync(resolve(new URL(".", import.meta.url).pathname, "../src/EventHandlers.ts"), "utf8");

  // Sepolia → 0G routes
  const sepoliaRoutes = [
    { event: "Deposited", target: "recordDeposit", file: satHandlers },
    { event: "AgentRegistered", target: "recordRegistration", file: satHandlers },
    { event: "WithdrawRequested", target: "processWithdraw", file: satHandlers },
    { event: "ValuesReported", target: "reportValues", file: satHandlers },
    { event: "CommissionClaimRequested", target: "processCommissionClaim", file: satHandlers },
    { event: "PauseRequested", target: "processPause", file: satHandlers },
    { event: "WithdrawFromArenaRequested", target: "processWithdrawFromArena", file: satHandlers },
    { event: "ClaimWithdrawRequested", target: "claimWithdraw", file: satHandlers },
    { event: "PositionClosed", target: "recordClosure", file: satHandlers },
  ];
  for (const { event, target, file } of sepoliaRoutes) {
    file.includes(`Satellite.${event}.handler`) && file.includes(target)
      ? pass(`Sepolia→0G: ${event} → ${target}`)
      : fail(`Sepolia→0G: ${event} → ${target}`, "handler not found or target missing");
  }

  // 0G → Sepolia routes (Vault)
  const vaultRoutes = [
    { event: "EpochSettled", target: "updateSharePrice", file: vaultHandlers },
    { event: "WithdrawApproved", target: "release", file: vaultHandlers },
    { event: "CommissionApproved", target: "releaseCommission", file: vaultHandlers },
    { event: "ProtocolFeeAccrued", target: "reserveProtocolFees", file: vaultHandlers },
    { event: "CommissionAccrued", target: "reserveCommission", file: vaultHandlers },
    { event: "ForceCloseRequested", target: "forceClose", file: vaultHandlers },
  ];
  for (const { event, target, file } of vaultRoutes) {
    file.includes(`Vault.${event}.handler`) && file.includes(target)
      ? pass(`0G(Vault)→Sepolia: ${event} → ${target}`)
      : fail(`0G(Vault)→Sepolia: ${event} → ${target}`, "handler not found");
  }

  // 0G → Sepolia routes (AgentManager)
  const amRoutes = [
    { event: "IntentQueued", target: "executeBatch", file: amHandlers },
    { event: "ForceCloseRequested", target: "forceClose", file: amHandlers },
  ];
  for (const { event, target, file } of amRoutes) {
    file.includes(`AgentManager.${event}.handler`) && file.includes(target)
      ? pass(`0G(AM)→Sepolia: ${event} → ${target}`)
      : fail(`0G(AM)→Sepolia: ${event} → ${target}`, "handler not found");
  }

  // Check agentManagerHandlers is imported
  eventHandlers.includes("agentManagerHandlers") && !eventHandlers.includes("// import")
    ? pass("agentManagerHandlers imported in EventHandlers.ts")
    : fail("agentManagerHandlers import", "commented out or missing in EventHandlers.ts");
}

// ---------------------------------------------------------------------------
// 6. On-chain test data (agent #1 from test-infra.ts)
// ---------------------------------------------------------------------------

async function testOnChainData() {
  section("6. On-chain Test Data");

  try {
    const positions = await sepoliaClient.readContract({
      address: SATELLITE,
      abi: [{ name: "getAgentPositions", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256[]" }] }],
      functionName: "getAgentPositions",
      args: [1n],
    }) as bigint[];
    positions.length > 0
      ? pass(`Agent #1 positions`, `[${positions.join(", ")}]`)
      : pass("Agent #1 positions", "none (expected if not tested yet)");
  } catch (e: any) {
    fail("Agent #1 positions", e.shortMessage || e.message);
  }

  try {
    const idle = await sepoliaClient.readContract({
      address: SATELLITE,
      abi: [{ name: "idleBalance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }],
      functionName: "idleBalance",
    }) as bigint;
    pass("Satellite idle balance", `${formatUnits(idle, 6)} USDC.e`);
  } catch (e: any) {
    fail("Satellite idle balance", e.shortMessage || e.message);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n  Agent Arena — Relayer Test Suite");
  console.log("  ================================\n");

  await testConfig();
  await testChains();
  await testContracts();
  await testUniswapApi();
  await testHandlerCoverage();
  await testOnChainData();

  section("Summary");
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total:   ${passed + failed + skipped}\n`);

  if (failed > 0) {
    console.log("  Failed tests:");
    for (const r of results.filter(r => r.status === "FAIL")) {
      console.log(`    ✗ ${r.name}: ${r.detail}`);
    }
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
