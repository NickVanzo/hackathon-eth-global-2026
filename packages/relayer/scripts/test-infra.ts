#!/usr/bin/env npx tsx
/**
 * test-infra.ts — End-to-end infrastructure test script
 *
 * Tests the relayer pipeline WITHOUT real AI agents by:
 *   1. Checking USDC.e balance + Satellite state
 *   2. Approving & depositing USDC.e on Satellite (triggers Deposited event)
 *   3. Registering a test agent on Satellite (triggers AgentRegistered event)
 *   4. Testing Uniswap Trading API (POST /quote + /swap) on Sepolia
 *   5. Optionally calling satellite.executeBatch() with a mock OPEN_POSITION intent
 *
 * Usage:
 *   npx tsx scripts/test-infra.ts                     # full test (deposit + register + intent)
 *   npx tsx scripts/test-infra.ts --skip-deposit       # skip deposit (already deposited)
 *   npx tsx scripts/test-infra.ts --skip-register      # skip registration (already registered)
 *   npx tsx scripts/test-infra.ts --only-uniswap       # only test Uniswap API
 *   npx tsx scripts/test-infra.ts --only-read          # only read on-chain state (no txs)
 *
 * Env vars (from .env):
 *   PRIVATE_KEY_RELAYER   — messenger key (for executeBatch, forceClose — must match satellite.messenger())
 *   PRIVATE_KEY_DEPLOYER  — deployer key (for deposit, registerAgent — any funded wallet)
 *                           Falls back to PRIVATE_KEY_RELAYER if not set.
 *   UNISWAP_API_KEY       — Uniswap Trading API key
 *   SATELLITE_ADDRESS      — deployed Satellite on Sepolia
 *   USDC_E_ADDRESS         — USDC.e on Sepolia
 *   WETH_ADDRESS           — WETH on Sepolia
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

// Deployer key — used for user-facing calls (deposit, registerAgent)
const DEPLOYER_KEY = (process.env.PRIVATE_KEY_DEPLOYER || process.env.PRIVATE_KEY_RELAYER) as `0x${string}`;
// Messenger key — used for messenger-only calls (executeBatch)
const MESSENGER_KEY = process.env.PRIVATE_KEY_RELAYER as `0x${string}`;

if ((!DEPLOYER_KEY || DEPLOYER_KEY === "0x") && (!MESSENGER_KEY || MESSENGER_KEY === "0x")) {
  console.error("Set PRIVATE_KEY_RELAYER (and optionally PRIVATE_KEY_DEPLOYER) in .env");
  process.exit(1);
}

const SATELLITE = (process.env.SATELLITE_ADDRESS || "0xeFD9583eF616e9770ca98E4201e940315128C0BF") as Address;
const USDC_E = (process.env.USDC_E_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as Address;
const WETH = (process.env.WETH_ADDRESS || "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14") as Address;
const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY || "";
const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";
const CHAIN_ID = 11155111;

// Test parameters (small amounts for Sepolia)
const DEPOSIT_AMOUNT = 1_000_000n; // 1 USDC.e (6 decimals)
const PROVING_AMOUNT = 500_000n;   // 0.5 USDC.e proving capital
const TEST_AGENT_ADDRESS = "0x0000000000000000000000000000000000C0FFEE" as Address; // mock agent EOA

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sepolia: Chain = {
  id: CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [SEPOLIA_RPC] }, public: { http: [SEPOLIA_RPC] } },
};

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY);
const messengerAccount = MESSENGER_KEY && MESSENGER_KEY !== "0x"
  ? privateKeyToAccount(MESSENGER_KEY)
  : deployerAccount;

const publicClient = createPublicClient({ chain: sepolia, transport: http() });
// Deployer wallet — for deposit(), registerAgent() (user-facing)
const deployerWallet = createWalletClient({ account: deployerAccount, chain: sepolia, transport: http() });
// Messenger wallet — for executeBatch() (messenger-only)
const messengerWallet = createWalletClient({ account: messengerAccount, chain: sepolia, transport: http() });

// ---------------------------------------------------------------------------
// ABIs (minimal fragments)
// ---------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const SATELLITE_ABI = parseAbi([
  // User functions
  "function deposit(uint256 amount) external",
  "function registerAgent(address agentAddress, uint256 provingAmount) external",
  // Messenger functions
  "function executeBatch((uint256 agentId, uint8 actionType, bytes params, uint256 blockNumber)[] intents) external",
  // Views
  "function idleBalance() view returns (uint256)",
  "function cachedSharePrice() view returns (uint256)",
  "function getAgentPositions(uint256 agentId) view returns (uint256[])",
  "function agentPositionCount(uint256 agentId) view returns (uint256)",
  "function messenger() view returns (address)",
]);

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": UNISWAP_API_KEY,
  "x-universal-router-version": "2.0",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hr(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function ok(msg: string) { console.log(`  [OK] ${msg}`); }
function warn(msg: string) { console.log(`  [WARN] ${msg}`); }
function fail(msg: string) { console.log(`  [FAIL] ${msg}`); }
function info(msg: string) { console.log(`  ${msg}`); }

async function waitForTx(hash: `0x${string}`, label: string) {
  info(`tx sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "success") {
    ok(`${label} — block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
  } else {
    fail(`${label} — REVERTED in block ${receipt.blockNumber}`);
  }
  return receipt;
}

// ---------------------------------------------------------------------------
// Step 1: Read on-chain state
// ---------------------------------------------------------------------------

async function readState() {
  hr("1. On-chain State");

  const [ethBal, usdcBal, usdcDecimals, usdcSymbol] = await Promise.all([
    publicClient.getBalance({ address: deployerAccount.address }),
    publicClient.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [deployerAccount.address] }),
    publicClient.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "symbol" }),
  ]);

  info(`Deployer:     ${deployerAccount.address}`);
  info(`Messenger:    ${messengerAccount.address}`);
  info(`Deployer ETH: ${formatUnits(ethBal, 18)} ETH`);
  info(`Deployer ${usdcSymbol}: ${formatUnits(usdcBal, usdcDecimals)} ${usdcSymbol}`);

  // Also check messenger balance if different from deployer
  if (messengerAccount.address.toLowerCase() !== deployerAccount.address.toLowerCase()) {
    const messengerEth = await publicClient.getBalance({ address: messengerAccount.address });
    info(`Messenger ETH: ${formatUnits(messengerEth, 18)} ETH`);
    if (messengerEth < 10n ** 15n) warn("Messenger has low ETH — executeBatch will fail. Fund it first!");
  }

  if (ethBal < 10n ** 15n) warn("Low ETH — may not have enough gas for transactions");
  if (usdcBal === 0n) warn("No USDC.e — deposit and register will fail");

  // Satellite state
  let messenger: Address | undefined;
  try {
    messenger = await publicClient.readContract({ address: SATELLITE, abi: SATELLITE_ABI, functionName: "messenger" }) as Address;
  } catch { /* messenger() may not exist */ }

  const [idleBalance, sharePrice] = await Promise.all([
    publicClient.readContract({ address: SATELLITE, abi: SATELLITE_ABI, functionName: "idleBalance" }).catch(() => 0n),
    publicClient.readContract({ address: SATELLITE, abi: SATELLITE_ABI, functionName: "cachedSharePrice" }).catch(() => 0n),
  ]);

  info(`Satellite:    ${SATELLITE}`);
  info(`Idle balance: ${formatUnits(idleBalance as bigint, 6)} USDC.e`);
  info(`Share price:  ${formatUnits(sharePrice as bigint, 18)}`);
  if (messenger) {
    info(`On-chain msg: ${messenger}`);
    if (messenger.toLowerCase() === messengerAccount.address.toLowerCase()) {
      ok("Messenger wallet matches satellite.messenger()");
    } else {
      warn(`Messenger wallet does NOT match satellite.messenger()`);
      warn(`On-chain: ${messenger}, wallet: ${messengerAccount.address}`);
    }
  }

  // Check allowance
  const allowance = await publicClient.readContract({
    address: USDC_E, abi: ERC20_ABI, functionName: "allowance",
    args: [deployerAccount.address, SATELLITE],
  });
  info(`USDC.e allowance to Satellite: ${formatUnits(allowance, 6)}`);

  return { usdcBal, ethBal, usdcDecimals };
}

// ---------------------------------------------------------------------------
// Step 2: Deposit USDC.e
// ---------------------------------------------------------------------------

async function doDeposit() {
  hr("2. Deposit USDC.e on Satellite");

  // Approve
  info(`Approving ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC.e to Satellite...`);
  const approveHash = await deployerWallet.writeContract({
    address: USDC_E,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [SATELLITE, DEPOSIT_AMOUNT],
  });
  await waitForTx(approveHash, "approve");

  // Deposit
  info(`Depositing ${formatUnits(DEPOSIT_AMOUNT, 6)} USDC.e...`);
  const depositHash = await deployerWallet.writeContract({
    address: SATELLITE,
    abi: SATELLITE_ABI,
    functionName: "deposit",
    args: [DEPOSIT_AMOUNT],
  });
  const receipt = await waitForTx(depositHash, "deposit");

  info(`Deposited event should trigger relayer → vault.recordDeposit() on 0G`);
  return receipt;
}

// ---------------------------------------------------------------------------
// Step 3: Register test agent
// ---------------------------------------------------------------------------

async function doRegister() {
  hr("3. Register Test Agent on Satellite");

  // Approve proving capital
  info(`Approving ${formatUnits(PROVING_AMOUNT, 6)} USDC.e for proving capital...`);
  const approveHash = await deployerWallet.writeContract({
    address: USDC_E,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [SATELLITE, PROVING_AMOUNT],
  });
  await waitForTx(approveHash, "approve proving capital");

  // Register
  info(`Registering agent (agentAddress=${TEST_AGENT_ADDRESS})...`);
  const regHash = await deployerWallet.writeContract({
    address: SATELLITE,
    abi: SATELLITE_ABI,
    functionName: "registerAgent",
    args: [TEST_AGENT_ADDRESS, PROVING_AMOUNT],
  });
  const receipt = await waitForTx(regHash, "registerAgent");

  info(`AgentRegistered event should trigger relayer → agentManager.recordRegistration() on 0G`);
  info(`(AgentManager not deployed yet — relayer will log an error, that's expected)`);
  return receipt;
}

// ---------------------------------------------------------------------------
// Step 4: Test Uniswap Trading API
// ---------------------------------------------------------------------------

async function testUniswapApi() {
  hr("4. Uniswap Trading API Test (Sepolia)");

  if (!UNISWAP_API_KEY) {
    warn("UNISWAP_API_KEY not set — skipping API test");
    return;
  }

  const testAmount = "500000"; // 0.5 USDC.e

  // ---- check_approval ----
  info("POST /check_approval ...");
  try {
    const approvalRes = await fetch(`${UNISWAP_API_URL}/check_approval`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        walletAddress: SATELLITE,
        token: USDC_E,
        amount: testAmount,
        chainId: CHAIN_ID,
      }),
    });
    const approvalData = await approvalRes.json();
    if (approvalRes.ok) {
      if (approvalData.approval) {
        warn("Satellite needs approval to Universal Router — check deployment");
        info(`  approval.to = ${approvalData.approval?.to}`);
      } else {
        ok("Satellite already approved (or native token)");
      }
    } else {
      warn(`check_approval returned ${approvalRes.status}: ${JSON.stringify(approvalData)}`);
    }
  } catch (err) {
    fail(`check_approval error: ${err}`);
  }

  // ---- quote (USDC.e → WETH) ----
  info("POST /quote (USDC.e → WETH, CLASSIC) ...");
  let quoteResponse: any = null;
  try {
    const quoteBody = {
      swapper: SATELLITE,
      tokenIn: USDC_E,
      tokenOut: WETH,
      tokenInChainId: String(CHAIN_ID),
      tokenOutChainId: String(CHAIN_ID),
      amount: testAmount,
      type: "EXACT_INPUT",
      slippageTolerance: 1.0,
      routingPreference: "BEST_PRICE",
      protocols: ["V3"],
    };
    info(`  body: ${JSON.stringify(quoteBody)}`);

    const quoteRes = await fetch(`${UNISWAP_API_URL}/quote`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify(quoteBody),
    });
    quoteResponse = await quoteRes.json();

    if (quoteRes.ok) {
      ok(`Quote received — routing=${quoteResponse.routing}`);
      if (quoteResponse.routing === "CLASSIC") {
        info(`  input:  ${quoteResponse.quote?.input?.amount} (${quoteResponse.quote?.input?.token})`);
        info(`  output: ${quoteResponse.quote?.output?.amount} (${quoteResponse.quote?.output?.token})`);
        info(`  gasFeeUSD: ${quoteResponse.quote?.gasFeeUSD}`);
      } else {
        warn(`Got non-CLASSIC routing: ${quoteResponse.routing}`);
      }
    } else {
      fail(`Quote failed (${quoteRes.status}): ${JSON.stringify(quoteResponse)}`);
      return;
    }
  } catch (err) {
    fail(`Quote error: ${err}`);
    return;
  }

  // ---- swap ----
  if (quoteResponse?.routing === "CLASSIC") {
    info("POST /swap (get Universal Router calldata) ...");
    try {
      const { permitData, permitTransaction, ...cleanQuote } = quoteResponse;
      const swapRes = await fetch(`${UNISWAP_API_URL}/swap`, {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify(cleanQuote),
      });
      const swapData = await swapRes.json();

      if (swapRes.ok) {
        const calldata = swapData?.swap?.data;
        if (calldata && calldata !== "0x" && calldata !== "") {
          ok(`Swap calldata received — ${calldata.length} chars`);
          info(`  to: ${swapData.swap?.to} (Universal Router)`);
          info(`  data: ${calldata.slice(0, 66)}...`);
        } else {
          warn("Swap returned empty calldata — quote may have expired");
        }
      } else {
        fail(`Swap failed (${swapRes.status}): ${JSON.stringify(swapData)}`);
      }
    } catch (err) {
      fail(`Swap error: ${err}`);
    }
  }

  // ---- quote (WETH → USDC.e) for zap-out ----
  info("POST /quote (WETH → USDC.e, zap-out test) ...");
  try {
    const quoteBody = {
      swapper: SATELLITE,
      tokenIn: WETH,
      tokenOut: USDC_E,
      tokenInChainId: String(CHAIN_ID),
      tokenOutChainId: String(CHAIN_ID),
      amount: "100000000000000", // 0.0001 WETH
      type: "EXACT_INPUT",
      slippageTolerance: 1.0,
      routingPreference: "BEST_PRICE",
      protocols: ["V3"],
    };

    const quoteRes = await fetch(`${UNISWAP_API_URL}/quote`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify(quoteBody),
    });
    const data = await quoteRes.json();

    if (quoteRes.ok && data.routing === "CLASSIC") {
      ok(`Zap-out quote OK — output=${data.quote?.output?.amount} USDC.e`);
    } else {
      warn(`Zap-out quote: ${quoteRes.status} routing=${data.routing || "N/A"}`);
    }
  } catch (err) {
    warn(`Zap-out quote error: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Mock executeBatch (OPEN_POSITION)
// ---------------------------------------------------------------------------

async function doExecuteBatch(agentId: bigint) {
  hr("5. Mock executeBatch (OPEN_POSITION)");

  // Encode IntentParams: (uint256 amountUSDC, int24 tickLower, int24 tickUpper)
  // Use a wide range around current tick for testing
  const amountUSDC = 100_000n; // 0.1 USDC.e
  const tickLower = -887220;   // wide range (near min tick, rounded to tickSpacing=60)
  const tickUpper = 887220;    // wide range (near max tick)

  // First get swap calldata from Uniswap API
  let swapCalldata: `0x${string}` = "0x";
  if (UNISWAP_API_KEY) {
    info("Fetching zap-in swap calldata from Uniswap Trading API...");
    try {
      const halfAmount = amountUSDC / 2n;
      const quoteRes = await fetch(`${UNISWAP_API_URL}/quote`, {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          swapper: SATELLITE,
          tokenIn: USDC_E,
          tokenOut: WETH,
          tokenInChainId: String(CHAIN_ID),
          tokenOutChainId: String(CHAIN_ID),
          amount: halfAmount.toString(),
          type: "EXACT_INPUT",
          slippageTolerance: 1.0,
          routingPreference: "BEST_PRICE",
          protocols: ["V3"],
        }),
      });
      if (quoteRes.ok) {
        const quoteResponse = await quoteRes.json();
        if (quoteResponse.routing === "CLASSIC") {
          const { permitData, permitTransaction, ...cleanQuote } = quoteResponse;
          const swapRes = await fetch(`${UNISWAP_API_URL}/swap`, {
            method: "POST",
            headers: API_HEADERS,
            body: JSON.stringify(cleanQuote),
          });
          if (swapRes.ok) {
            const swapData = await swapRes.json();
            if (swapData?.swap?.data && swapData.swap.data !== "0x") {
              swapCalldata = swapData.swap.data as `0x${string}`;
              ok(`Got swap calldata (${swapCalldata.length} chars)`);
            }
          }
        }
      }
    } catch (err) {
      warn(`Swap calldata fetch failed: ${err} — will use empty calldata`);
    }
  }

  // ABI-encode: (uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source)
  const params = encodeAbiParameters(
    parseAbiParameters("uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source"),
    [amountUSDC, tickLower, tickUpper, swapCalldata, 0] // source=0 (PROVING)
  );

  const intent = {
    agentId,
    actionType: 0, // OPEN_POSITION
    params,
    blockNumber: BigInt(await publicClient.getBlockNumber()),
  };

  info(`Intent: OPEN_POSITION for agentId=${agentId}`);
  info(`  amountUSDC: ${formatUnits(amountUSDC, 6)} USDC.e`);
  info(`  tickRange:  [${tickLower}, ${tickUpper}]`);
  info(`  swapCalldata: ${swapCalldata.length > 4 ? `${swapCalldata.length} chars` : "empty (0x)"}`);

  try {
    const hash = await messengerWallet.writeContract({
      address: SATELLITE,
      abi: SATELLITE_ABI,
      functionName: "executeBatch",
      args: [[intent]],
    });
    await waitForTx(hash, "executeBatch");
    ok("executeBatch succeeded — check satellite for new LP position");
  } catch (err: any) {
    fail(`executeBatch reverted: ${err.shortMessage || err.message}`);
    if (err.message?.includes("onlyMessenger")) {
      info("This wallet is not the satellite messenger — cannot call executeBatch");
      info("Only the relayer (messenger) can call this function");
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipDeposit = args.includes("--skip-deposit");
  const skipRegister = args.includes("--skip-register");
  const onlyUniswap = args.includes("--only-uniswap");
  const onlyRead = args.includes("--only-read");
  const skipExecute = args.includes("--skip-execute");

  console.log("\n  Agent Arena — Infrastructure Test Script");
  console.log("  =========================================\n");
  info(`Flags: ${args.join(" ") || "(none — full test)"}`);

  // Always read state
  const { usdcBal } = await readState();

  if (onlyRead) return;

  // Fund messenger with ETH from deployer if needed
  if (args.includes("--fund-messenger") &&
      messengerAccount.address.toLowerCase() !== deployerAccount.address.toLowerCase()) {
    hr("Fund Messenger");
    const messengerEth = await publicClient.getBalance({ address: messengerAccount.address });
    const fundAmount = 20n * 10n ** 15n; // 0.02 ETH
    if (messengerEth < 5n * 10n ** 15n) { // < 0.005 ETH
      info(`Sending ${formatUnits(fundAmount, 18)} ETH from deployer → messenger...`);
      const hash = await deployerWallet.sendTransaction({
        to: messengerAccount.address,
        value: fundAmount,
      });
      await waitForTx(hash, "fund messenger");
    } else {
      ok(`Messenger already has ${formatUnits(messengerEth, 18)} ETH — no funding needed`);
    }
  }

  if (onlyUniswap) {
    await testUniswapApi();
    return;
  }

  // Deposit
  if (!skipDeposit) {
    if (usdcBal < DEPOSIT_AMOUNT) {
      warn(`Not enough USDC.e for deposit (have ${formatUnits(usdcBal, 6)}, need ${formatUnits(DEPOSIT_AMOUNT, 6)})`);
      warn("Get Sepolia USDC.e from https://faucet.circle.com/");
    } else {
      await doDeposit();
    }
  }

  // Register agent
  if (!skipRegister) {
    const currentBal = await publicClient.readContract({
      address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [deployerAccount.address],
    });
    if (currentBal < PROVING_AMOUNT) {
      warn(`Not enough USDC.e to register agent (have ${formatUnits(currentBal, 6)}, need ${formatUnits(PROVING_AMOUNT, 6)})`);
    } else {
      await doRegister();
    }
  }

  // Uniswap API
  await testUniswapApi();

  // executeBatch (mock intent)
  if (!skipExecute) {
    // Use agentId=1 (first registered agent) — adjust if needed
    const agentId = 1n;
    info(`\nWill attempt executeBatch with agentId=${agentId}`);
    info("(This requires the wallet to be the satellite messenger)");
    await doExecuteBatch(agentId);
  }

  hr("Done");
  info("Check relayer logs to verify events were picked up and relayed.");
  info("Run with --only-read to just check state without sending transactions.");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
