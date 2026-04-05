/**
 * query-pool.mjs — fetch current pool state from the Subgraph MCP server.
 *
 * Reads POOL_ADDRESS and AGENT_WALLET_ADDRESS from workspace .env and
 * MCP_SERVER_URL from the process environment. Prints a JSON pool state
 * object to stdout.
 *
 * Called by OpenClaw when the agent invokes the query-pool skill.
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const POOL_ADDRESS = process.env.POOL_ADDRESS;
if (!POOL_ADDRESS || POOL_ADDRESS.startsWith("TODO")) {
  console.error(JSON.stringify({ error: "POOL_ADDRESS not set in workspace .env" }));
  process.exit(1);
}

const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS;

const MCP_URL = process.env.MCP_SERVER_URL ?? "https://us-central1-subgraph-mcp.cloudfunctions.net/mcp";

// ---------------------------------------------------------------------------
// Minimal Streamable HTTP MCP client
// ---------------------------------------------------------------------------

/**
 * Parse an MCP response. Handles both JSON and SSE (text/event-stream) formats.
 */
async function parseMcpResponse(res) {
  const raw = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i].slice(5).trim()); } catch { /* next */ }
    }
    throw new Error("SSE contained no parseable JSON-RPC data");
  }
  return JSON.parse(raw);
}

async function initSession() {
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
        clientInfo: { name: "query-pool", version: "1.0" },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP server did not return a session ID");
  await parseMcpResponse(res); // drain body
  return sessionId;
}

async function callTool(sessionId, toolName, args) {
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

  if (!res.ok) throw new Error(`MCP tool call failed: HTTP ${res.status}`);
  const envelope = await parseMcpResponse(res);
  if (envelope.error) throw new Error(`MCP error: ${envelope.error.message}`);

  const text = envelope.result?.content?.[0]?.text;
  if (!text) throw new Error("MCP returned empty content");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Build pool state from MCP tool results
// ---------------------------------------------------------------------------

function extractPriceAndTick(priceResult) {
  const { source } = priceResult;

  if (source === "rpc") {
    // Direct slot0 read — most accurate
    return {
      currentPrice: priceResult.priceToken0PerToken1 ?? priceResult.priceToken1PerToken0,
      currentTick: priceResult.tick,
    };
  }

  // Subgraph result
  const pool = priceResult.pool;
  if (!pool) throw new Error("get_pool_price returned no pool data");
  return {
    // token1Price = price of token1 in terms of token0 (e.g. WETH in USDC.e)
    currentPrice: parseFloat(pool.token1Price),
    currentTick: null, // subgraph doesn't return current tick; RPC fallback should have run
  };
}

/**
 * Extract the 10 ticks closest to currentTick from the ticks result.
 * Returns an empty array on any failure so this is non-fatal.
 */
function extractNearbyTicks(ticksResult, currentTick) {
  const ticks = ticksResult?.ticks ?? ticksResult?.pool?.ticks ?? [];
  if (!Array.isArray(ticks) || ticks.length === 0) return [];

  return ticks
    .map((t) => ({ tickIdx: parseInt(t.tickIdx ?? t.tick, 10), liquidityNet: t.liquidityNet, liquidityGross: t.liquidityGross }))
    .filter((t) => !isNaN(t.tickIdx))
    .sort((a, b) => Math.abs(a.tickIdx - currentTick) - Math.abs(b.tickIdx - currentTick))
    .slice(0, 10);
}

/**
 * Extract the agent's open position from the positions result.
 * Returns a null-filled object on any failure so this is non-fatal.
 */
function extractPosition(positionsResult) {
  const positions = positionsResult?.positions ?? positionsResult?.result ?? [];
  if (!Array.isArray(positions) || positions.length === 0) {
    return { tickLower: null, tickUpper: null, liquidity: null, uncollectedFees: null };
  }

  // Use the first active position (liquidity > 0) if available
  const active = positions.find((p) => p.liquidity && p.liquidity !== "0") ?? positions[0];
  return {
    tickLower: active.tickLower ?? null,
    tickUpper: active.tickUpper ?? null,
    liquidity: active.liquidity ?? null,
    uncollectedFees: active.uncollectedFees ?? null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    const sessionId = await initSession();

    // --- Required: price + current tick ---
    const priceResult = await callTool(sessionId, "get_pool_price", {
      poolAddress: POOL_ADDRESS,
      chain: "sepolia",
    });

    const { currentPrice, currentTick: rawTick } = extractPriceAndTick(priceResult);
    const currentTick = rawTick ?? Math.floor(Math.log(currentPrice) / Math.log(1.0001));

    // --- Supplementary: nearby ticks (non-fatal) ---
    let nearbyTicks = [];
    try {
      const ticksResult = await callTool(sessionId, "get_pool_ticks", {
        poolAddress: POOL_ADDRESS,
        chain: "sepolia",
      });
      nearbyTicks = extractNearbyTicks(ticksResult, currentTick);
    } catch (err) {
      // Non-fatal — strategy can proceed without tick depth data
    }

    // --- Supplementary: open position (non-fatal) ---
    let openPosition = { tickLower: null, tickUpper: null, liquidity: null, uncollectedFees: null };
    if (AGENT_WALLET_ADDRESS && !AGENT_WALLET_ADDRESS.startsWith("TODO")) {
      try {
        const positionsResult = await callTool(sessionId, "get_positions", {
          ownerAddress: AGENT_WALLET_ADDRESS,
          poolAddress: POOL_ADDRESS,
          chain: "sepolia",
        });
        openPosition = extractPosition(positionsResult);
      } catch (err) {
        // Non-fatal — strategy can proceed assuming no open position
      }
    }

    // Pool state format expected by AGENTS.md strategy prompts
    const poolState = {
      currentPrice: parseFloat(currentPrice.toFixed(4)),
      // previousPrice is tracked across epochs by cron-trigger.js.
      // When this skill is called standalone (directly through the gateway),
      // previousPrice is null — strategies that depend on price direction (contrarian)
      // cannot function correctly without it in that path.
      previousPrice: null,
      currentTick,
      nearbyTicks,
      openPosition,
    };

    console.log(JSON.stringify(poolState));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
