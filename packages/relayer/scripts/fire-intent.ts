#!/usr/bin/env npx tsx
/**
 * fire-intent.ts — Mock agent intent script
 *
 * Run this in a SECOND terminal while `pnpm dev` is running in the first.
 * It fires transactions on Sepolia and you watch the Envio indexer relay
 * them to 0G in real-time.
 *
 * What it does:
 *   A) deposit()        → emits Deposited     → relayer calls vault.recordDeposit() on 0G
 *   B) registerAgent()  → emits AgentRegistered → relayer calls agentManager.recordRegistration() on 0G
 *   C) executeBatch()   → emits ValuesReported + PositionClosed → relayer calls agentManager.reportValues()
 *
 * Usage:
 *   npx tsx scripts/fire-intent.ts                # full: deposit + register + open intent
 *   npx tsx scripts/fire-intent.ts --deposit      # only deposit
 *   npx tsx scripts/fire-intent.ts --register     # only register new agent
 *   npx tsx scripts/fire-intent.ts --open [id]    # OPEN_POSITION intent (default agentId=1)
 *   npx tsx scripts/fire-intent.ts --close [id]   # CLOSE_POSITION intent (close all for agentId=1)
 *   npx tsx scripts/fire-intent.ts --status [id]  # read agent position state
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
// Config
// ---------------------------------------------------------------------------

const DEPLOYER_KEY = (process.env.PRIVATE_KEY_DEPLOYER || process.env.PRIVATE_KEY_RELAYER) as `0x${string}`;
const MESSENGER_KEY = process.env.PRIVATE_KEY_RELAYER as `0x${string}`;
const SATELLITE  = (process.env.SATELLITE_ADDRESS  || "0xeFD9583eF616e9770ca98E4201e940315128C0BF") as Address;
const USDC_E     = (process.env.USDC_E_ADDRESS     || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238") as Address;
const WETH       = (process.env.WETH_ADDRESS       || "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14") as Address;
const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY || "";
const UNISWAP_API_URL = "https://trade-api.gateway.uniswap.org/v1";
const CHAIN_ID   = 11155111;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com";

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sepolia: Chain = {
  id: CHAIN_ID, name: "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [SEPOLIA_RPC] }, public: { http: [SEPOLIA_RPC] } },
};

const deployerAccount  = privateKeyToAccount(DEPLOYER_KEY);
const messengerAccount = privateKeyToAccount(MESSENGER_KEY);
const pub  = createPublicClient({ chain: sepolia, transport: http() });
const dep  = createWalletClient({ account: deployerAccount,  chain: sepolia, transport: http() });
const msg  = createWalletClient({ account: messengerAccount, chain: sepolia, transport: http() });

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const SAT_ABI = parseAbi([
  "function deposit(uint256) external",
  "function registerAgent(address,uint256) external",
  "function executeBatch((uint256 agentId,uint8 actionType,bytes params,uint256 blockNumber)[]) external",
  "function getAgentPositions(uint256) view returns (uint256[])",
  "function agentPositionCount(uint256) view returns (uint256)",
  "function idleBalance() view returns (uint256)",
  "function agentDeployer(uint256) view returns (address)",
  "function provingCapital(uint256) view returns (uint256)",
  "event Deposited(address indexed user, uint256 amount)",
  "event AgentRegistered(uint256 indexed agentId, address agentAddress, address indexed deployer, uint256 provingAmount)",
  "event ValuesReported(uint256 indexed agentId, uint256 positionValue, uint256 feesCollected)",
  "event PositionClosed(uint256 indexed agentId, uint256 indexed positionId, uint256 recoveredAmount)",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hr = (t: string) => { console.log(`\n${"─".repeat(55)}`); console.log(`  ${t}`); console.log("─".repeat(55)); };
const ok   = (m: string) => console.log(`  ✓  ${m}`);
const warn = (m: string) => console.log(`  ⚠  ${m}`);
const info = (m: string) => console.log(`     ${m}`);

async function waitTx(hash: `0x${string}`, label: string) {
  console.log(`  →  ${label}`);
  console.log(`     tx: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status === "success") {
    ok(`${label}  block=${r.blockNumber}  gas=${r.gasUsed}`);
  } else {
    console.log(`  ✗  ${label} REVERTED`);
    process.exit(1);
  }
  return r;
}

async function ensureApproval(amount: bigint) {
  const allowance = await pub.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "allowance", args: [deployerAccount.address, SATELLITE] });
  if (allowance < amount) {
    info(`Approving ${formatUnits(amount, 6)} USDC.e to Satellite...`);
    const h = await dep.writeContract({ address: USDC_E, abi: ERC20_ABI, functionName: "approve", args: [SATELLITE, amount] });
    await waitTx(h, "approve");
  } else {
    ok(`Already approved (${formatUnits(allowance, 6)} USDC.e)`);
  }
}

async function getSwapCalldata(tokenIn: string, tokenOut: string, amount: bigint, label: string): Promise<`0x${string}`> {
  if (!UNISWAP_API_KEY || amount === 0n) return "0x";
  try {
    const qr = await fetch(`${UNISWAP_API_URL}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": UNISWAP_API_KEY, "x-universal-router-version": "2.0" },
      body: JSON.stringify({ swapper: SATELLITE, tokenIn, tokenOut, tokenInChainId: String(CHAIN_ID), tokenOutChainId: String(CHAIN_ID), amount: amount.toString(), type: "EXACT_INPUT", slippageTolerance: 1.0, routingPreference: "BEST_PRICE", protocols: ["V3"] }),
    });
    const q = await qr.json();
    if (!qr.ok || q.routing !== "CLASSIC") { warn(`${label} quote: ${q.routing ?? qr.status} — falling back to 0x`); return "0x"; }
    const { permitData, permitTransaction, ...cleanQ } = q;
    const sr = await fetch(`${UNISWAP_API_URL}/swap`, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": UNISWAP_API_KEY, "x-universal-router-version": "2.0" }, body: JSON.stringify(cleanQ) });
    const s = await sr.json();
    const cd = s?.swap?.data;
    if (!cd || cd === "0x") { warn(`${label} swap returned empty calldata`); return "0x"; }
    ok(`${label} swap calldata  (${cd.length} chars, output ~${q.quote?.output?.amount})`);
    return cd as `0x${string}`;
  } catch (e) {
    warn(`${label} API error: ${e}`); return "0x";
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function doDeposit(amount: bigint = 1_000_000n) {
  hr("DEPOSIT  →  Satellite.deposit()");
  const bal = await pub.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [deployerAccount.address] });
  info(`Deployer USDC.e: ${formatUnits(bal, 6)}`);
  if (bal < amount) { warn(`Need ${formatUnits(amount, 6)} USDC.e — get from https://faucet.circle.com/`); process.exit(1); }
  await ensureApproval(amount);
  const h = await dep.writeContract({ address: SATELLITE, abi: SAT_ABI, functionName: "deposit", args: [amount] });
  const r = await waitTx(h, `deposit(${formatUnits(amount, 6)} USDC.e)`);
  info(`Envio should pick up Deposited → relay to vault.recordDeposit() on 0G`);
  // Print the event
  const log = r.logs.find(l => l.address.toLowerCase() === SATELLITE.toLowerCase() && l.topics[0] === "0x5548c837ab068cf56a2c2479df0882a4922fd203edb7517321831d95078c5f62");
  if (log) info(`Deposited event: logIndex=${log.logIndex}`);
}

async function doRegister(agentEOA?: Address) {
  hr("REGISTER AGENT  →  Satellite.registerAgent()");
  const provingAmount = 500_000n; // 0.5 USDC.e
  const agentAddress = agentEOA ?? deployerAccount.address; // default: use deployer as agent EOA
  const bal = await pub.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [deployerAccount.address] });
  info(`Deployer USDC.e: ${formatUnits(bal, 6)}`);
  if (bal < provingAmount) { warn(`Need ${formatUnits(provingAmount, 6)} USDC.e for proving capital`); process.exit(1); }
  await ensureApproval(provingAmount);
  const h = await dep.writeContract({ address: SATELLITE, abi: SAT_ABI, functionName: "registerAgent", args: [agentAddress, provingAmount] });
  const r = await waitTx(h, `registerAgent(agentEOA=${agentAddress}, proving=${formatUnits(provingAmount, 6)})`);
  // Find the AgentRegistered event to get the assigned agentId
  const AGENT_REG_TOPIC = "0x" + "AgentRegistered".padEnd(64, "0"); // rough — parse properly below
  info(`Envio should pick up AgentRegistered → relay to agentManager.recordRegistration() on 0G`);
  info(`Check Envio logs for the agentId assigned by the satellite`);
}

async function doOpenPosition(agentId: bigint = 1n, amountUSDC: bigint = 200_000n) {
  hr(`OPEN POSITION  →  Satellite.executeBatch()  (agentId=${agentId})`);

  // Current positions
  const posBefore = await pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "getAgentPositions", args: [agentId] }) as bigint[];
  const idle      = await pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "idleBalance" });
  info(`Agent #${agentId} positions before: [${posBefore.join(", ")}]`);
  info(`Satellite idle balance: ${formatUnits(idle as bigint, 6)} USDC.e`);
  if ((idle as bigint) < amountUSDC) { warn(`Idle balance too low — deposit first`); }

  // Tick range: ±200 ticks around current price (disciplined rebalancer strategy)
  // For hackathon we use a wide range so it's always in-range
  const tickLower = -887220;
  const tickUpper =  887220;

  // Fetch zap-in swap calldata (USDC.e → WETH for the WETH leg of the LP)
  const halfAmount = amountUSDC / 2n;
  info(`Fetching zap-in calldata: ${formatUnits(halfAmount, 6)} USDC.e → WETH...`);
  const swapCalldata = await getSwapCalldata(USDC_E, WETH, halfAmount, "zap-in");

  // ABI-encode IntentParams: (uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source)
  const params = encodeAbiParameters(
    parseAbiParameters("uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source"),
    [amountUSDC, tickLower, tickUpper, swapCalldata, 0] // source=0 (PROVING)
  );

  const intent = {
    agentId,
    actionType: 0, // OPEN_POSITION
    params,
    blockNumber: await pub.getBlockNumber(),
  };

  info(`Intent: OPEN_POSITION  amountUSDC=${formatUnits(amountUSDC, 6)}  ticks=[${tickLower},${tickUpper}]`);
  const h = await msg.writeContract({ address: SATELLITE, abi: SAT_ABI, functionName: "executeBatch", args: [[intent]] });
  const r = await waitTx(h, "executeBatch(OPEN_POSITION)");

  // Read new positions
  const posAfter = await pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "getAgentPositions", args: [agentId] }) as bigint[];
  const newPos = posAfter.filter(p => !posBefore.includes(p));
  if (newPos.length > 0) {
    ok(`New LP position(s) minted: tokenId(s) = [${newPos.join(", ")}]`);
  }
  info(`Envio should pick up ValuesReported → relay to agentManager.reportValues() on 0G`);
}

async function doClosePosition(agentId: bigint = 1n) {
  hr(`CLOSE POSITION  →  Satellite.executeBatch()  (agentId=${agentId})`);

  const positions = await pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "getAgentPositions", args: [agentId] }) as bigint[];
  if (positions.length === 0) { warn(`Agent #${agentId} has no open positions`); return; }
  info(`Agent #${agentId} open positions: [${positions.join(", ")}]`);

  // For each position, get zap-out calldata (WETH → USDC.e)
  // Use a conservative WETH estimate — satellite handles it
  info(`Fetching zap-out calldata: 0.0001 WETH → USDC.e...`);
  const swapCalldata = await getSwapCalldata(WETH, USDC_E, 100_000_000_000_000n, "zap-out");

  // Encode close params: (uint256 tokenId, bytes swapCalldata) — close first position
  const tokenId = positions[0];
  const params = encodeAbiParameters(
    parseAbiParameters("uint256 tokenId, bytes swapCalldata"),
    [tokenId, swapCalldata]
  );

  const intent = {
    agentId,
    actionType: 1, // CLOSE_POSITION
    params,
    blockNumber: await pub.getBlockNumber(),
  };

  info(`Intent: CLOSE_POSITION  tokenId=${tokenId}`);
  const h = await msg.writeContract({ address: SATELLITE, abi: SAT_ABI, functionName: "executeBatch", args: [[intent]] });
  const r = await waitTx(h, "executeBatch(CLOSE_POSITION)");

  const posAfter = await pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "getAgentPositions", args: [agentId] }) as bigint[];
  info(`Positions after: [${posAfter.join(", ")}]`);
  if (posAfter.length < positions.length) {
    ok(`Position ${tokenId} closed — PositionClosed event emitted`);
    info(`Envio should pick up PositionClosed → agentManager.recordClosure() + vault.recordRecovery() on 0G`);
  }
}

async function doStatus(agentId: bigint = 1n) {
  hr(`STATUS  (agentId=${agentId})`);
  const [positions, count, deployer, proving, idle] = await Promise.all([
    pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "getAgentPositions", args: [agentId] }),
    pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "agentPositionCount", args: [agentId] }),
    pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "agentDeployer", args: [agentId] }),
    pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "provingCapital", args: [agentId] }),
    pub.readContract({ address: SATELLITE, abi: SAT_ABI, functionName: "idleBalance" }),
  ]);
  const [depBal, msgEth] = await Promise.all([
    pub.readContract({ address: USDC_E, abi: ERC20_ABI, functionName: "balanceOf", args: [deployerAccount.address] }),
    pub.getBalance({ address: messengerAccount.address }),
  ]);
  info(`Agent #${agentId}:`);
  info(`  deployer:        ${deployer}`);
  info(`  provingCapital:  ${formatUnits(proving as bigint, 6)} USDC.e`);
  info(`  positions (${count}):  [${(positions as bigint[]).join(", ")}]`);
  info(`Satellite idle:    ${formatUnits(idle as bigint, 6)} USDC.e`);
  info(`Deployer USDC.e:   ${formatUnits(depBal, 6)}`);
  info(`Messenger ETH:     ${formatUnits(msgEth, 18)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  console.log("\n  Agent Arena — Fire Intent Script");
  console.log("  =================================");
  console.log("  (Run `pnpm dev` in another terminal)\n");

  const agentIdArg = args.find(a => /^\d+$/.test(a));
  const agentId = agentIdArg ? BigInt(agentIdArg) : 1n;

  if (args.includes("--deposit")) {
    await doDeposit();
  } else if (args.includes("--register")) {
    await doRegister();
  } else if (args.includes("--open")) {
    await doOpenPosition(agentId);
  } else if (args.includes("--close")) {
    await doClosePosition(agentId);
  } else if (args.includes("--status")) {
    await doStatus(agentId);
  } else {
    // Full run: deposit + open intent
    await doStatus(agentId);
    await doDeposit(500_000n);
    await doOpenPosition(agentId, 100_000n);
  }

  console.log("\n  ─────────────────────────────────────────────────────");
  console.log("  Watch the pnpm dev terminal for relay logs:");
  console.log("  [relay] Deposited(...) → tx: 0x...");
  console.log("  [relay] ValuesReported(...) → Sepolia tx: 0x...");
  console.log("  ─────────────────────────────────────────────────────\n");
}

main().catch(e => { console.error("\nFatal:", e.shortMessage ?? e.message); process.exit(1); });
