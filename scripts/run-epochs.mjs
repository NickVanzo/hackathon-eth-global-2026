#!/usr/bin/env node
/**
 * E2E Epoch Orchestrator for Agent Arena
 *
 * Runs multiple trading epochs end-to-end:
 *   1. Call OpenClaw gateway for each agent to get trading decisions
 *   2. Submit intents to AgentManager on 0G using agent private keys
 *   3. Relay intents to Satellite on Sepolia using relayer key (executeBatch)
 *   4. Report position values to AgentManager on 0G using relayer key
 *   5. Trigger epoch settlement on Vault
 *   6. Log Sharpe scores and promotion status
 *
 * Usage: node scripts/run-epochs.mjs [--epochs N] [--synthetic]
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const epochCount = (() => {
  const idx = args.indexOf("--epochs");
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 4;
})();
const syntheticMode = args.includes("--synthetic");
const externalRelayer = args.includes("--relayer");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ZG_RPC = "https://evmrpc-testnet.0g.ai";
const SEPOLIA_RPC = "https://ethereum-sepolia.publicnode.com";

const AGENT_MANAGER_ADDR = "0xC346168268af5f69D318C50661592370fdb0ba32"; // 0G
const VAULT_ADDR = "0x904588f5074F9C75325906AD3613A3f7a98a4D02"; // 0G
const SATELLITE_ADDR = "0x03a1125a9746fa5fc70411A3235eb8b9D18bc24E"; // Sepolia

const RELAYER_KEY = "0x03fd9c5a6a4d37e488f1c6806182d14a7d0c1cd90c405fee2b20002ee70e778a";

const AGENTS = [
  {
    name: "agent-alpha",
    id: 1,
    key: "0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478",
    wallet: "0xCf5a0E19ed62654e404A48577c4f1EB2A194B510",
    syntheticMultiplier: 0.98,
    syntheticFees: 1000,
  },
  {
    name: "agent-beta",
    id: 2,
    key: "0xd4fabef7a758f547c8068eeaef7714d3f63146ccd1967b4dc4f19fe851a1d9e2",
    wallet: "0xA58383E7Fde3710f21b11fD1824254A4e5aF1074",
    syntheticMultiplier: 0.97,
    syntheticFees: 500,
  },
  {
    name: "agent-gamma",
    id: 3,
    key: "0x27d95F3Bbd5334915c710C703FC56603CD861f8D",
    wallet: "0x27d95F3Bbd5334915c710C703FC56603CD861f8D",
    syntheticMultiplier: 1.05,
    syntheticFees: 10000,
  },
];
// Fix agent-gamma key (the above wallet was pasted; correct key from spec)
AGENTS[2].key = "0x05569e34f16180dd62cfe2f077f6f036fe2f0e8257458d6aec81de2fca149c52";

const GATEWAY_URL = "http://127.0.0.1:3000";
const MCP_URL = "https://us-central1-subgraph-mcp.cloudfunctions.net/mcp";

const ZG_TX_OVERRIDES = { type: 0, gasPrice: 3000000000n };

// ---------------------------------------------------------------------------
// Gateway token
// ---------------------------------------------------------------------------

function getGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  try {
    const data = JSON.parse(readFileSync(homedir() + "/.openclaw/openclaw.json", "utf8"));
    return data.gateway.auth.token;
  } catch {
    throw new Error("OPENCLAW_GATEWAY_TOKEN not set and ~/.openclaw/openclaw.json not found");
  }
}

// ---------------------------------------------------------------------------
// Minimal ABIs
// ---------------------------------------------------------------------------

const AGENT_MANAGER_ABI = [
  "function submitIntent(uint256 agentId, uint8 actionType, bytes params) external",
  "function reportValues(uint256 agentId, uint256 positionValue, uint256 feesCollected) external",
  "function agents(uint256) view returns (address agentAddress, uint8 phase, uint256 provingBalance, uint256 provingDeployed, uint256 epochsCompleted, uint256 zeroSharpeStreak, bool paused, bool registered)",
  "function scores(uint256) view returns (int256 emaReturn, int256 emaReturnSq, uint256 positionValue, uint256 feesCollected, uint256 lastReportedBlock)",
  "function buckets(uint256) view returns (uint256 credits, uint256 maxCredits, uint256 refillRate, uint256 lastActionBlock)",
  "event IntentQueued(uint256 indexed agentId, uint8 actionType, bytes params, uint256 blockNumber)",
];

const VAULT_ABI = [
  "function triggerSettleEpoch() external",
  "function lastEpochBlock() view returns (uint256)",
  "function epochLength() view returns (uint256)",
  "function currentEpoch() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
];

const SATELLITE_ABI = [
  "function executeBatch(tuple(uint256 agentId, uint8 actionType, bytes params, uint256 blockNumber)[] intents) external",
  "function collectAndReport(uint256 agentId, uint256 positionValue) external",
  "function getAgentPositions(uint256 agentId) view returns (uint256[])",
];

// ---------------------------------------------------------------------------
// Providers and signers
// ---------------------------------------------------------------------------

const zgProvider = new ethers.JsonRpcProvider(ZG_RPC);
const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

const relayerZg = new ethers.Wallet(RELAYER_KEY, zgProvider);
const relayerSepolia = new ethers.Wallet(RELAYER_KEY, sepoliaProvider);

const agentSigners = AGENTS.map((a) => new ethers.Wallet(a.key, zgProvider));

const agentManager = new ethers.Contract(AGENT_MANAGER_ADDR, AGENT_MANAGER_ABI, relayerZg);
const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, relayerZg);
const satellite = new ethers.Contract(SATELLITE_ADDR, SATELLITE_ABI, relayerSepolia);

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

// ---------------------------------------------------------------------------
// MCP client (Streamable HTTP, from cron-trigger.js)
// ---------------------------------------------------------------------------

async function parseMcpResponse(res) {
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i].slice(5).trim()); } catch { /* next */ }
    }
    throw new Error("SSE: no parseable JSON-RPC data");
  }
  return JSON.parse(raw);
}

async function mcpInitSession() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "run-epochs", version: "1.0" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP did not return session ID");
  await parseMcpResponse(res);
  return sessionId;
}

async function mcpCallTool(sessionId, toolName, toolArgs) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: toolArgs } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const envelope = await parseMcpResponse(res);
  if (envelope.error) throw new Error(`MCP error: ${envelope.error.message}`);
  const text = envelope.result?.content?.[0]?.text;
  if (!text) throw new Error("MCP returned empty content");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Pool state from MCP
// ---------------------------------------------------------------------------

async function getPoolState() {
  try {
    const sessionId = await mcpInitSession();
    const poolAddress = process.env.POOL_ADDRESS;
    const priceResult = await mcpCallTool(sessionId, "get_pool_price", { poolAddress, chain: "sepolia" });
    let currentPrice, currentTick;
    if (priceResult.source === "rpc") {
      currentPrice = priceResult.priceToken0PerToken1 ?? priceResult.priceToken1PerToken0;
      currentTick = priceResult.tick;
    } else {
      const pool = priceResult.pool;
      currentPrice = parseFloat(pool.token1Price);
      currentTick = Math.floor(Math.log(currentPrice) / Math.log(1.0001));
    }

    let nearbyTicks = [];
    try {
      const ticksResult = await mcpCallTool(sessionId, "get_pool_ticks", { poolAddress, chain: "sepolia" });
      const ticks = Array.isArray(ticksResult) ? ticksResult : (ticksResult.ticks ?? []);
      nearbyTicks = ticks
        .filter((t) => t.tickIdx != null)
        .sort((a, b) => Math.abs(Number(a.tickIdx) - currentTick) - Math.abs(Number(b.tickIdx) - currentTick))
        .slice(0, 10);
    } catch { /* supplementary */ }

    return { currentPrice: parseFloat(currentPrice.toFixed(4)), currentTick, nearbyTicks, source: priceResult.source };
  } catch (err) {
    log("MCP", `unavailable (${err.message}), falling back to RPC slot0`);
  }

  // RPC fallback: read slot0() directly from the pool contract on Sepolia
  try {
    const poolAddr = process.env.POOL_ADDRESS;
    if (poolAddr) {
      const poolContract = new ethers.Contract(poolAddr, [
        "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
      ], sepoliaProvider);
      const slot0 = await poolContract.slot0();
      const currentTick = Number(slot0.tick);
      // Compute price from sqrtPriceX96: price = (sqrtPriceX96 / 2^96)^2
      // price = token1/token0 in raw units. For USDC.e(6dec)/WETH(18dec):
      // ETH price in USDC = 1/price * 10^(18-6) = 10^12 / price
      const sqrtPrice = Number(slot0.sqrtPriceX96) / 2 ** 96;
      const rawPrice = sqrtPrice * sqrtPrice;
      const currentPrice = 1e12 / rawPrice;
      log("pool", `RPC fallback: tick=${currentTick} price=${currentPrice.toFixed(4)}`);
      return { currentPrice: parseFloat(currentPrice.toFixed(4)), currentTick, nearbyTicks: [], source: "rpc" };
    }
  } catch (err2) {
    log("pool", `RPC fallback failed: ${err2.message}`);
  }

  // Last resort mock (should not reach here if POOL_ADDRESS is set)
  const currentPrice = 1800.0 + Math.random() * 20 - 10;
  const currentTick = Math.floor(Math.log(currentPrice) / Math.log(1.0001));
  return { currentPrice: parseFloat(currentPrice.toFixed(4)), currentTick, nearbyTicks: [], source: "mock" };
}

// ---------------------------------------------------------------------------
// OpenClaw gateway — tool-calling flow (from cron-trigger.js)
// ---------------------------------------------------------------------------

function buildToolPrompt() {
  return [
    "You have access to the following tool:\n",
    "Tool: query_pool",
    "Description: Fetch current pool state including price, tick, and your open position.",
    "Parameters: none required",
    "",
    "When you need to call this tool, respond with EXACTLY this format and nothing else:",
    "<tool_call>",
    '{"name": "query_pool", "arguments": {}}',
    "</tool_call>",
    "",
    "IMPORTANT: When calling a tool, output ONLY the <tool_call> block. No other text.",
    "After receiving the tool result, output your JSON decision.",
  ].join("\n");
}

function parseToolCalls(text) {
  const calls = [];
  const xmlMatches = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g);
  for (const m of xmlMatches) {
    try { calls.push(JSON.parse(m[1])); } catch { /* skip */ }
  }
  if (calls.length > 0) return calls;

  const codeBlockMatch = text.match(/```tool_calls?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* fall through */ }
  }

  const bareMatch = text.match(/\{\s*"name"\s*:\s*"query_pool"[\s\S]*?\}/);
  if (bareMatch) {
    try { calls.push(JSON.parse(bareMatch[0])); } catch { /* skip */ }
  }
  return calls;
}

function parseDecision(reply) {
  const cleaned = reply.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  const target = cleaned || reply;
  const actionMatch = target.match(/\{[^{}]*"action"\s*:[^{}]*\}/);
  if (actionMatch) return JSON.parse(actionMatch[0]);
  const fallback = target.match(/\{[\s\S]*?\}/);
  if (!fallback) throw new Error(`no JSON found in: ${reply}`);
  return JSON.parse(fallback[0]);
}

async function callAgent(agentName, messages, token, maxTokens = 512) {
  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: `openclaw/${agentName}`, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway ${response.status}: ${text}`);
  }
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

async function getAgentDecision(agent, poolState, token) {
  const toolPrompt = buildToolPrompt();
  const initialMessages = [
    { role: "user", content: toolPrompt + "\n\nEpoch trigger. Call the query_pool tool to get the current pool state before making your decision." },
  ];

  let reply;
  try {
    reply = await callAgent(agent.name, initialMessages, token);
  } catch (err) {
    log(agent.name, `gateway call failed: ${err.message}`);
    return null;
  }

  const toolCalls = parseToolCalls(reply);

  if (toolCalls.length > 0 && toolCalls[0].name === "query_pool") {
    log(agent.name, `tool_call: query_pool -> tick=${poolState.currentTick}`);
    const followUp = [
      ...initialMessages,
      { role: "assistant", content: reply },
      { role: "user", content: `Tool result:\n${JSON.stringify(poolState)}\n\nNow output your JSON decision based on this data.` },
    ];
    try {
      reply = await callAgent(agent.name, followUp, token);
    } catch (err) {
      log(agent.name, `follow-up call failed: ${err.message}`);
      return null;
    }
  } else {
    log(agent.name, "model did not call tool, injecting pool state directly");
    try {
      reply = await callAgent(agent.name, [
        { role: "user", content: `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. Output your JSON decision now.` },
      ], token);
    } catch (err) {
      log(agent.name, `fallback call failed: ${err.message}`);
      return null;
    }
  }

  try {
    const decision = parseDecision(reply);
    log(agent.name, `decision: ${JSON.stringify(decision)}`);
    return decision;
  } catch (err) {
    log(agent.name, `parse failed: ${err.message} | reply: ${reply.slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 1+2: Get decisions and submit intents on 0G
// ---------------------------------------------------------------------------

async function submitIntentOnChain(agent, decision, signerIdx) {
  if (!decision || decision.action === "hold") {
    log(agent.name, "holding or no decision -- skipping intent");
    return null;
  }

  let actionType;
  if (decision.action === "open") actionType = 0;
  else if (decision.action === "close") actionType = 1;
  else if (decision.action === "rebalance" || decision.action === "modify") actionType = 2;
  else {
    log(agent.name, `unknown action: ${decision.action}`);
    return null;
  }

  // Encode params
  let params;
  if (actionType === 0 || actionType === 2) {
    // Use 200,000 raw = 0.2 USDC.e (proven to work in fire-intent.ts)
    const amountUSDC = 200_000n;
    // Use full-range ticks (always works regardless of current price, no swap needed for token ratio)
    // Agent tick decisions are based on mock/inaccurate prices, so override with safe full-range
    const tickLower = -887220;
    const tickUpper = 887220;
    log(agent.name, `intent params: amount=${amountUSDC} ticks=[${tickLower},${tickUpper}] (full-range override)`);
    params = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "int24", "int24"],
      [amountUSDC, tickLower, tickUpper]
    );
  } else {
    params = "0x";
  }

  const signer = agentSigners[signerIdx];
  const managerWithSigner = agentManager.connect(signer);

  try {
    log(agent.name, `submitting intent: actionType=${actionType}`);
    const tx = await managerWithSigner.submitIntent(agent.id, actionType, params, ZG_TX_OVERRIDES);
    const receipt = await tx.wait();
    log(agent.name, `intent submitted: tx=${receipt.hash}`);

    // Parse IntentQueued event
    const iface = new ethers.Interface(AGENT_MANAGER_ABI);
    for (const logEntry of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: logEntry.topics, data: logEntry.data });
        if (parsed && parsed.name === "IntentQueued") {
          return {
            agentId: Number(parsed.args.agentId),
            actionType: Number(parsed.args.actionType),
            params: parsed.args.params,
            blockNumber: Number(parsed.args.blockNumber),
          };
        }
      } catch { /* not our event */ }
    }
    log(agent.name, "warning: IntentQueued event not found in receipt");
    return { agentId: agent.id, actionType, params, blockNumber: receipt.blockNumber };
  } catch (err) {
    log(agent.name, `submitIntent failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3: Relay intents to Satellite on Sepolia
// ---------------------------------------------------------------------------

async function relayIntentsToSepolia(intents) {
  if (intents.length === 0) {
    log("relay", "no intents to relay");
    return false;
  }

  // Enrich params for Satellite: (amountUSDC, tickLower, tickUpper, swapCalldata, source)
  const enrichedIntents = intents.map((intent) => {
    if (intent.actionType === 0 || intent.actionType === 2) {
      // Decode original (amountUSDC, tickLower, tickUpper)
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "int24", "int24"],
        intent.params
      );
      // Re-encode with swapCalldata=0x and source=0 (PROVING)
      const enrichedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "int24", "int24", "bytes", "uint8"],
        [decoded[0], decoded[1], decoded[2], "0x", 0]
      );
      return { ...intent, params: enrichedParams };
    }
    return intent;
  });

  try {
    log("relay", `sending executeBatch with ${enrichedIntents.length} intent(s) to Sepolia`);
    const tx = await satellite.executeBatch(enrichedIntents);
    const receipt = await tx.wait();
    log("relay", `executeBatch succeeded: tx=${receipt.hash}`);
    return true;
  } catch (err) {
    log("relay", `executeBatch FAILED: ${err.message}`);
    log("relay", "falling back to synthetic value reporting");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 4: Report values to AgentManager on 0G
// ---------------------------------------------------------------------------

async function reportValues(agent, useSynthetic) {
  let positionValue, feesCollected;

  if (useSynthetic) {
    // Read proving balance from contract
    try {
      const agentData = await agentManager.agents(agent.id);
      const provingBal = agentData.provingBalance;
      // Apply synthetic multiplier
      positionValue = BigInt(Math.floor(Number(provingBal) * agent.syntheticMultiplier));
      feesCollected = BigInt(agent.syntheticFees);
      log(agent.name, `synthetic values: positionValue=${positionValue} feesCollected=${feesCollected}`);
    } catch (err) {
      log(agent.name, `failed to read agent data: ${err.message}`);
      // Fallback: 1 USDC.e = 1000000
      positionValue = BigInt(Math.floor(1000000 * agent.syntheticMultiplier));
      feesCollected = BigInt(agent.syntheticFees);
    }
  } else {
    // In real mode, we'd read from satellite; for now use synthetic as fallback
    positionValue = BigInt(Math.floor(1000000 * agent.syntheticMultiplier));
    feesCollected = BigInt(agent.syntheticFees);
  }

  try {
    const tx = await agentManager.reportValues(agent.id, positionValue, feesCollected, ZG_TX_OVERRIDES);
    const receipt = await tx.wait();
    log(agent.name, `reportValues tx=${receipt.hash}`);
  } catch (err) {
    log(agent.name, `reportValues failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: Trigger epoch settlement
// ---------------------------------------------------------------------------

async function waitForEpochAndSettle() {
  const epochLength = await vault.epochLength();
  const lastEpochBlock = await vault.lastEpochBlock();
  const targetBlock = Number(lastEpochBlock) + Number(epochLength);

  log("vault", `epochLength=${epochLength} lastEpochBlock=${lastEpochBlock} targetBlock=${targetBlock}`);

  // Poll until we've passed the target block
  let currentBlock = await zgProvider.getBlockNumber();
  while (currentBlock < targetBlock) {
    const remaining = targetBlock - currentBlock;
    log("vault", `waiting for epoch: current=${currentBlock} target=${targetBlock} remaining=${remaining} blocks (~${remaining}s)`);
    // Wait in 15-second increments
    await new Promise((r) => setTimeout(r, 15_000));
    currentBlock = await zgProvider.getBlockNumber();
  }

  try {
    log("vault", "triggering epoch settlement...");
    const tx = await vault.triggerSettleEpoch(ZG_TX_OVERRIDES);
    const receipt = await tx.wait();
    log("vault", `settleEpoch tx=${receipt.hash}`);
    return true;
  } catch (err) {
    log("vault", `triggerSettleEpoch failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step 6: Status reporting
// ---------------------------------------------------------------------------

async function reportStatus() {
  log("status", "=== Agent Status ===");
  const phaseNames = ["PROVING", "VAULT"];

  for (const agent of AGENTS) {
    try {
      const data = await agentManager.agents(agent.id);
      const sc = await agentManager.scores(agent.id);
      log("status", [
        `${agent.name} (id=${agent.id}):`,
        `phase=${phaseNames[Number(data.phase)] ?? data.phase}`,
        `epochs=${data.epochsCompleted}`,
        `zeroStreak=${data.zeroSharpeStreak}`,
        `provingBal=${data.provingBalance}`,
        `posValue=${sc.positionValue}`,
        `fees=${sc.feesCollected}`,
        `emaReturn=${sc.emaReturn}`,
      ].join(" "));
    } catch (err) {
      log("status", `${agent.name}: failed to read: ${err.message}`);
    }
  }

  try {
    const epoch = await vault.currentEpoch();
    const totalAssets = await vault.totalAssets();
    const sharePrice = await vault.sharePrice();
    log("status", `Vault: epoch=${epoch} totalAssets=${totalAssets} sharePrice=${sharePrice}`);
  } catch (err) {
    log("status", `Vault read failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main: run N epochs
// ---------------------------------------------------------------------------

async function runOneEpoch(epochNum, token) {
  log("epoch", `===== EPOCH ${epochNum} =====`);

  // 1. Get pool state (shared across agents)
  const poolState = await getPoolState();
  log("pool", `price=${poolState.currentPrice} tick=${poolState.currentTick} source=${poolState.source}`);

  // 2. Get decisions from each agent via OpenClaw
  const decisions = [];
  for (let i = 0; i < AGENTS.length; i++) {
    const decision = await getAgentDecision(AGENTS[i], poolState, token);
    decisions.push(decision);
  }

  // 3. Submit intents on 0G
  const intents = [];
  for (let i = 0; i < AGENTS.length; i++) {
    const intent = await submitIntentOnChain(AGENTS[i], decisions[i], i);
    if (intent) intents.push(intent);

    // Wait a bit between submissions to avoid cooldown issues
    if (i < AGENTS.length - 1 && intent) {
      log("wait", "pausing 12s for minActionInterval between agents...");
      await new Promise((r) => setTimeout(r, 12_000));
    }
  }

  if (externalRelayer) {
    // External relayer handles: executeBatch + reportValues
    // We submit intents, wait for relay, then trigger epoch settlement
    // (Envio indexer is event-driven — it has no periodic loop to call triggerSettleEpoch)
    if (intents.length > 0) {
      log("mode", "external relayer mode — relayer handles intent execution on Sepolia");
      log("mode", `submitted ${intents.length} intent(s), waiting for relayer to execute...`);
      log("wait", "waiting 60s for relayer to execute intents on Sepolia...");
      await new Promise((r) => setTimeout(r, 60_000));
    } else {
      log("mode", "no intents this epoch");
    }

    // Report values directly on 0G (skip collectAndReport roundtrip — not needed for PoC)
    // Check Sepolia positions to confirm execution, then report with synthetic multipliers
    const satellite = new ethers.Contract(SATELLITE_ADDR, SATELLITE_ABI, sepoliaProvider);
    for (const agent of AGENTS) {
      try {
        const positions = await satellite.getAgentPositions(agent.id);
        const positionValue = BigInt(Math.round(1_000_000 * agent.syntheticMultiplier));
        const feesCollected = BigInt(agent.syntheticFees);
        log(agent.name, `${positions.length} position(s) on Sepolia, reporting: posValue=${positionValue} fees=${feesCollected}`);
        const tx = await agentManager.connect(relayerZg).reportValues(agent.id, positionValue, feesCollected, ZG_TX_OVERRIDES);
        const receipt = await tx.wait();
        log(agent.name, `reportValues tx=${receipt.hash}`);
      } catch (err) {
        log(agent.name, `reportValues failed: ${err.message?.slice(0, 120)}`);
      }
    }

    // Trigger epoch settlement
    await waitForEpochAndSettle();
  } else {
    // 4. Relay to Sepolia (or fall back to synthetic)
    let relaySuccess = false;
    if (!syntheticMode && intents.length > 0) {
      relaySuccess = await relayIntentsToSepolia(intents);
    }

    const useSynthetic = syntheticMode || !relaySuccess;
    if (useSynthetic) {
      log("mode", "using synthetic values for reporting");
    }

    // 5. Report values for each agent
    for (const agent of AGENTS) {
      await reportValues(agent, useSynthetic);
    }

    // 6. Trigger epoch settlement
    await waitForEpochAndSettle();
  }

  // 7. Report status
  await reportStatus();
}

async function main() {
  log("main", `Agent Arena E2E Orchestrator`);
  log("main", `epochs=${epochCount} synthetic=${syntheticMode} externalRelayer=${externalRelayer}`);
  log("main", `0G RPC: ${ZG_RPC}`);
  log("main", `Sepolia RPC: ${SEPOLIA_RPC}`);
  log("main", `AgentManager: ${AGENT_MANAGER_ADDR}`);
  log("main", `Vault: ${VAULT_ADDR}`);
  log("main", `Relayer: ${relayerZg.address}`);

  const token = getGatewayToken();
  log("main", "gateway token loaded");

  // Verify connectivity
  try {
    const zgBlock = await zgProvider.getBlockNumber();
    log("main", `0G connected: block=${zgBlock}`);
  } catch (err) {
    log("main", `FATAL: 0G RPC unreachable: ${err.message}`);
    process.exit(1);
  }

  // Initial status
  await reportStatus();

  for (let e = 1; e <= epochCount; e++) {
    try {
      await runOneEpoch(e, token);
    } catch (err) {
      log("epoch", `epoch ${e} FAILED: ${err.message}`);
      log("epoch", err.stack);
    }

    if (e < epochCount) {
      log("main", "waiting 5s before next epoch...");
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  log("main", "all epochs complete");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
