#!/usr/bin/env node
/**
 * Epoch trigger for Agent Arena.
 *
 * Each epoch:
 *   1. Fetch real pool state from the Subgraph MCP server (falls back to mock if unavailable)
 *   2. Call the OpenClaw gateway with tool definitions injected (0G Compute Adapter pattern)
 *   3. Agent calls query_pool tool → cron executes it → sends results back → agent decides
 *   4. In DRY_RUN mode, write intent to /data/intents/ instead of submitting on-chain
 *
 * Tool calling follows the pattern from:
 * https://github.com/claraverse-space/0G-Compute-Adapter
 *
 * Models that don't natively support tools (Qwen 2.5 7B via 0G) receive tool
 * definitions in the prompt and respond with <tool_call> tags. The cron parses
 * these, executes the tool, and sends results back for a final decision.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR ?? join(__dirname, "../local");
const EPOCH_INTERVAL_MS = parseInt(process.env.EPOCH_INTERVAL_MS || "30000", 10);
const DRY_RUN = process.env.DRY_RUN === "true";
const AGENTS = ["agent-alpha", "agent-beta", "agent-gamma"];
const WORKSPACE_BASE = join(STATE_DIR, "workspaces");

const GATEWAY_URL = "http://127.0.0.1:3000";
const MCP_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3001";
const POOL_ADDRESS = process.env.POOL_ADDRESS;

// ---------------------------------------------------------------------------
// Agent wallet addresses — loaded from workspace .env files at startup
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const agentWalletAddresses = {};

for (const agentId of ["agent-alpha", "agent-beta", "agent-gamma"]) {
  try {
    const envPath = join(WORKSPACE_BASE, agentId, ".env");
    const envContent = readFileSync(envPath, "utf8");
    const match = envContent.match(/^AGENT_WALLET_ADDRESS=(.+)$/m);
    if (match) agentWalletAddresses[agentId] = match[1].trim();
  } catch {
    // workspace .env not present — wallet address will be undefined
  }
}

// ---------------------------------------------------------------------------
// Position tracking — persists agent positions across epochs
// ---------------------------------------------------------------------------

/** @type {Record<string, {tickLower: number, tickUpper: number, liquidity: string}>} */
const agentPositions = {};

function getTrackedPosition(agentId) {
  return agentPositions[agentId] ?? { tickLower: null, tickUpper: null, liquidity: null };
}

function updatePosition(agentId, decision) {
  if (decision.action === "open") {
    agentPositions[agentId] = {
      tickLower: decision.tickLower,
      tickUpper: decision.tickUpper,
      liquidity: "1000000", // synthetic — real value comes from satellite
    };
  } else if (decision.action === "close") {
    delete agentPositions[agentId];
  }
  // "hold" → no change
}

// ---------------------------------------------------------------------------
// Subgraph MCP client — minimal Streamable HTTP implementation
// ---------------------------------------------------------------------------

/**
 * Parse an MCP response body. The Streamable HTTP transport may return either:
 * - application/json: a raw JSON-RPC envelope
 * - text/event-stream (SSE): one or more "data: {...}" lines
 * This helper handles both formats transparently.
 */
async function parseMcpResponse(res) {
  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("text/event-stream")) {
    // SSE: extract the last "data:" line containing a JSON-RPC response
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i].slice(5).trim());
      } catch { /* try previous line */ }
    }
    throw new Error("SSE response contained no parseable JSON-RPC data");
  }

  return JSON.parse(raw);
}

async function mcpInitSession() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "cron-trigger", version: "1.0" },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP did not return a session ID");
  await parseMcpResponse(res); // drain body
  return sessionId;
}

async function mcpCallTool(sessionId, toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
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
// Gateway / LLM communication
// ---------------------------------------------------------------------------

async function waitForGateway(maxWaitMs = 900_000) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const start = Date.now();
  console.log("[cron] waiting for gateway...");
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/models`, {
        headers: { "Authorization": `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        console.log(`[cron] gateway ready (${Math.round((Date.now() - start) / 1000)}s)`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error("gateway did not start within 15 minutes");
}

/**
 * Send messages to the OpenClaw gateway.
 * Accepts either a single string (legacy) or a messages array (multi-turn).
 */
async function callAgent(agentId, messagesOrString, maxTokens = 256) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) throw new Error("OPENCLAW_GATEWAY_TOKEN is not set");

  const messages =
    typeof messagesOrString === "string"
      ? [{ role: "user", content: messagesOrString }]
      : messagesOrString;

  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: `openclaw/${agentId}`,
      messages,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gateway error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// 0G Compute Adapter pattern — tool calling for non-native-tool models
// ---------------------------------------------------------------------------

/**
 * Build a tool definition prompt following the 0G Compute Adapter pattern.
 * Qwen-family models respond best to <tool_call> XML tags.
 */
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

/**
 * Parse <tool_call> tags from the model's response.
 * Supports the primary format used by Qwen/DeepSeek via 0G Compute Adapter.
 * Falls back to ```tool_calls code blocks and bare JSON objects.
 */
function parseToolCalls(text) {
  const calls = [];

  // Format 1: <tool_call>...</tool_call> (primary for Qwen)
  const xmlMatches = text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g);
  for (const m of xmlMatches) {
    try {
      calls.push(JSON.parse(m[1]));
    } catch { /* skip malformed */ }
  }
  if (calls.length > 0) return calls;

  // Format 2: ```tool_calls [...] ``` (DeepSeek style)
  const codeBlockMatch = text.match(/```tool_calls?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* fall through */ }
  }

  // Format 3: bare {"name": "query_pool", ...} not wrapped in other JSON
  const bareMatch = text.match(/\{\s*"name"\s*:\s*"query_pool"[\s\S]*?\}/);
  if (bareMatch) {
    try {
      calls.push(JSON.parse(bareMatch[0]));
    } catch { /* skip */ }
  }

  return calls;
}

// ---------------------------------------------------------------------------
// Pool state — fetched from MCP, enriched with tracked position
// ---------------------------------------------------------------------------

const previousPrices = {};

async function getPoolState(agentId) {
  let currentPrice, currentTick, source;
  let nearbyTicks = [];
  let mcpOpenPosition = null;

  if (POOL_ADDRESS && !POOL_ADDRESS.startsWith("TODO")) {
    try {
      const sessionId = await mcpInitSession();
      const priceResult = await mcpCallTool(sessionId, "get_pool_price", {
        poolAddress: POOL_ADDRESS,
        chain: "sepolia",
      });
      source = priceResult.source;

      if (priceResult.source === "rpc") {
        currentPrice = priceResult.priceToken0PerToken1 ?? priceResult.priceToken1PerToken0;
        currentTick = priceResult.tick;
      } else {
        const pool = priceResult.pool;
        currentPrice = parseFloat(pool.token1Price);
        currentTick = Math.floor(Math.log(currentPrice) / Math.log(1.0001));
      }

      // Supplementary: tick liquidity distribution
      try {
        const ticksResult = await mcpCallTool(sessionId, "get_pool_ticks", {
          poolAddress: POOL_ADDRESS,
          chain: "sepolia",
        });
        const ticks = Array.isArray(ticksResult) ? ticksResult : (ticksResult.ticks ?? []);
        // Sort by distance from currentTick and take the 10 closest
        nearbyTicks = ticks
          .filter((t) => t.tickIdx != null)
          .sort((a, b) => Math.abs(Number(a.tickIdx) - currentTick) - Math.abs(Number(b.tickIdx) - currentTick))
          .slice(0, 10)
          .map((t) => ({
            tickIdx: String(t.tickIdx),
            liquidityNet: String(t.liquidityNet ?? "0"),
            liquidityGross: String(t.liquidityGross ?? "0"),
          }));
      } catch (tickErr) {
        // tick data is supplementary — failure is non-fatal
        console.warn(`[cron] get_pool_ticks failed (${tickErr.message}), continuing without tick data`);
      }

      // Supplementary: on-chain LP positions for this agent's wallet
      const walletAddress = agentWalletAddresses[agentId];
      if (!walletAddress) {
        console.warn(`[cron] no wallet address for ${agentId} — skipping get_positions`);
      }
      if (walletAddress) {
        try {
          const positionsResult = await mcpCallTool(sessionId, "get_positions", {
            chainId: 11155111,
            address: walletAddress,
          });
          const positions = Array.isArray(positionsResult)
            ? positionsResult
            : (positionsResult.positions ?? []);
          // Use the first in-range position (tickLower <= currentTick <= tickUpper)
          const inRange = positions.find(
            (p) => p.tickLower != null && p.tickUpper != null &&
              Number(p.tickLower) <= currentTick && currentTick <= Number(p.tickUpper)
          );
          if (inRange) {
            mcpOpenPosition = {
              tickLower: Number(inRange.tickLower),
              tickUpper: Number(inRange.tickUpper),
              liquidity: String(inRange.liquidity ?? "0"),
              uncollectedFees: inRange.uncollectedFees ?? inRange.feesOwed ?? null,
            };
          }
        } catch (posErr) {
          // positions are supplementary — failure is non-fatal
          console.warn(`[cron] get_positions failed (${posErr.message}), falling back to tracked position`);
        }
      }
    } catch (err) {
      console.warn(`[cron] MCP unavailable (${err.message}), falling back to mock`);
    }
  } else if (!getPoolState._warnedOnce) {
    console.warn("[cron] POOL_ADDRESS not set — using mock pool state");
    getPoolState._warnedOnce = true;
  }

  // Mock fallback
  if (currentPrice == null) {
    currentPrice = 1800.0 + Math.random() * 20 - 10;
    currentTick = Math.floor(Math.log(currentPrice) / Math.log(1.0001));
    source = "mock";
  }

  const previousPrice = previousPrices[agentId] ?? currentPrice;
  previousPrices[agentId] = currentPrice;

  if (source !== "mock") {
    console.log(`[cron] pool state from MCP (source: ${source}): price=${currentPrice.toFixed(4)} tick=${currentTick}`);
  }

  return {
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    previousPrice: parseFloat(previousPrice.toFixed(4)),
    currentTick,
    openPosition: mcpOpenPosition ?? getTrackedPosition(agentId),
    nearbyTicks,
  };
}

// ---------------------------------------------------------------------------
// Intent action type mapping — agent strings → IShared.ActionType enum values
// See packages/contracts/src/interfaces/IShared.sol
// ---------------------------------------------------------------------------

const ACTION_TYPE = {
  OPEN_POSITION: 0,
  CLOSE_POSITION: 1,
  MODIFY_POSITION: 2,
};

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

function parseDecision(reply) {
  // Strip <tool_call>...</tool_call> blocks — the model sometimes repeats them
  // in the follow-up response alongside the actual decision.
  const cleaned = reply.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  const target = cleaned || reply; // fall back to original if stripping removed everything

  // Match a JSON object containing "action" — this is the decision, not a tool call
  const actionMatch = target.match(/\{[^{}]*"action"\s*:[^{}]*\}/);
  if (actionMatch) return JSON.parse(actionMatch[0]);

  // Fallback: first JSON object
  const fallback = target.match(/\{[\s\S]*?\}/);
  if (!fallback) throw new Error(`no JSON found in: ${reply}`);
  return JSON.parse(fallback[0]);
}

// ---------------------------------------------------------------------------
// Intent submission
// ---------------------------------------------------------------------------

/** Map enum value back to name for logging/filenames */
const ACTION_NAMES = ["OPEN_POSITION", "CLOSE_POSITION", "MODIFY_POSITION"];

function submitIntent(agentId, actionType, params = {}) {
  const actionName = ACTION_NAMES[actionType] ?? `UNKNOWN(${actionType})`;

  if (DRY_RUN) {
    const intentsDir = join(STATE_DIR, "intents");
    mkdirSync(intentsDir, { recursive: true });
    const filename = `${agentId}-${actionName}-${Date.now()}.json`;
    const intent = { agentId, actionType, actionName, params, timestamp: new Date().toISOString() };
    writeFileSync(join(intentsDir, filename), JSON.stringify(intent, null, 2));
    console.log(`[${agentId}] dry-run: wrote ${filename}`);
    return;
  }

  // TODO: call submit-intent.mjs once vault is deployed
  // submit-intent.mjs expects: node submit-intent.mjs <actionType:uint8> <paramsJson>
  console.warn(`[${agentId}] non-dry-run submit not yet implemented`);
}

// ---------------------------------------------------------------------------
// Per-agent epoch — tool-calling flow
// ---------------------------------------------------------------------------

async function runAgentEpoch(agentId) {
  // Step 1: Initial call with tool definitions (0G Compute Adapter pattern).
  // The agent's AGENTS.md (system prompt) is injected by the OpenClaw gateway.
  // We add tool definitions in the user message so the model knows it can call query_pool.
  const toolPrompt = buildToolPrompt();
  const initialMessage = [
    {
      role: "user",
      content: toolPrompt + "\n\nEpoch trigger. Call the query_pool tool to get the current pool state before making your decision.",
    },
  ];

  let reply;
  try {
    reply = await callAgent(agentId, initialMessage);
  } catch (err) {
    console.error(`[${agentId}] agent call failed: ${err.message}`);
    return;
  }

  // Step 2: Check if the model produced a tool call
  const toolCalls = parseToolCalls(reply);

  if (toolCalls.length > 0 && toolCalls[0].name === "query_pool") {
    // Step 3: Execute the tool — fetch pool state from MCP (with tracked position)
    const poolState = await getPoolState(agentId);
    console.log(`[${agentId}] tool_call: query_pool → tick=${poolState.currentTick} pos=${JSON.stringify(poolState.openPosition)}`);

    // Step 4: Send tool result back and ask for final decision (multi-turn)
    const followUp = [
      ...initialMessage,
      { role: "assistant", content: reply },
      {
        role: "user",
        content: `Tool result:\n${JSON.stringify(poolState)}\n\nNow output your JSON decision based on this data.`,
      },
    ];

    try {
      reply = await callAgent(agentId, followUp);
    } catch (err) {
      console.error(`[${agentId}] follow-up call failed: ${err.message}`);
      return;
    }
  } else {
    // Model responded directly without calling tool — fallback: inject pool state
    // and retry so the agent has data to work with
    console.warn(`[${agentId}] model did not call tool — injecting pool state directly`);
    const poolState = await getPoolState(agentId);
    const fallbackMessage = `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. Output your JSON decision now.`;

    try {
      reply = await callAgent(agentId, fallbackMessage);
    } catch (err) {
      console.error(`[${agentId}] fallback call failed: ${err.message}`);
      return;
    }
  }

  // Step 5: Parse the final decision
  let decision;
  try {
    decision = parseDecision(reply);
  } catch (err) {
    console.error(`[${agentId}] parse failed: ${err.message} | reply: ${reply}`);
    return;
  }

  console.log(`[${agentId}] decision: ${JSON.stringify(decision)}`);

  // Step 6: Update tracked position BEFORE submitting intent
  updatePosition(agentId, decision);

  // Step 7: Submit intent — map agent decision to IShared.ActionType enum
  try {
    if (decision.action === "hold") {
      console.log(`[${agentId}] holding — no intent submitted`);
      return;
    }

    if (decision.action === "rebalance") {
      // MODIFY_POSITION (2) = close existing + re-open at new ticks (single intent)
      submitIntent(agentId, ACTION_TYPE.MODIFY_POSITION, {
        tickLower: decision.tickLower,
        tickUpper: decision.tickUpper,
        amountUSDC: decision.amountUSDC ?? 1000,
      });
      return;
    }

    if (decision.action === "open") {
      submitIntent(agentId, ACTION_TYPE.OPEN_POSITION, {
        tickLower: decision.tickLower,
        tickUpper: decision.tickUpper,
        amountUSDC: decision.amountUSDC ?? 1000,
      });
      return;
    }

    if (decision.action === "close") {
      submitIntent(agentId, ACTION_TYPE.CLOSE_POSITION, {});
      return;
    }

    console.warn(`[${agentId}] unknown action: ${decision.action}`);
  } catch (err) {
    console.error(`[${agentId}] submit-intent failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function runEpoch() {
  console.log(`[cron] epoch @ ${new Date().toISOString()}`);
  for (const agentId of AGENTS) {
    await runAgentEpoch(agentId);
  }
}

console.log(`[cron] started — epoch every ${EPOCH_INTERVAL_MS / 1000}s, agents: ${AGENTS.join(", ")}`);

waitForGateway()
  .then(() => {
    runEpoch();
    setInterval(runEpoch, EPOCH_INTERVAL_MS);
  })
  .catch((err) => {
    console.error(`[cron] fatal: ${err.message}`);
    process.exit(1);
  });
