/**
 * query-pool.mjs — fetch current pool state from the Subgraph MCP server.
 *
 * Exports a queryPool(walletAddress) function for use by arena-loop.mjs.
 * Also works standalone when run directly — prints a JSON pool state object
 * to stdout.
 *
 * Uses CONFIG.MCP_SERVER_URL and CONFIG.POOL_ADDRESS from lib/config.mjs,
 * with optional overrides via MCP_SERVER_URL / POOL_ADDRESS environment vars.
 */

import { CONFIG } from "../lib/config.mjs";
import { getWallet } from "../lib/wallet.mjs";

const MCP_URL = process.env.MCP_SERVER_URL ?? CONFIG.MCP_SERVER_URL;
const POOL_ADDRESS = process.env.POOL_ADDRESS ?? CONFIG.POOL_ADDRESS;

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
// Exported queryPool function
// ---------------------------------------------------------------------------

/**
 * Fetch current pool state from the MCP server.
 *
 * @param {string} walletAddress  The agent's wallet address (used to look up open positions).
 * @returns {Promise<{
 *   currentPrice: number,
 *   previousPrice: null,
 *   currentTick: number,
 *   openPosition: { tickLower: number|null, tickUpper: number|null, liquidity: string|null, uncollectedFees: any },
 *   nearbyTicks: Array<{ tickIdx: number, liquidityNet: string, liquidityGross: string }>,
 * }>}
 */
export async function queryPool(walletAddress) {
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
  } catch {
    // Non-fatal — strategy can proceed without tick depth data
  }

  // --- Supplementary: open position (non-fatal) ---
  let openPosition = { tickLower: null, tickUpper: null, liquidity: null, uncollectedFees: null };
  if (walletAddress) {
    try {
      const positionsResult = await callTool(sessionId, "get_positions", {
        ownerAddress: walletAddress,
        poolAddress: POOL_ADDRESS,
        chain: "sepolia",
      });
      openPosition = extractPosition(positionsResult);
    } catch {
      // Non-fatal — strategy can proceed assuming no open position
    }
  }

  return {
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    // previousPrice is tracked across epochs by the arena loop.
    // When called standalone, previousPrice is null — strategies that depend on
    // price direction (contrarian) cannot function correctly without it in that path.
    previousPrice: null,
    currentTick,
    nearbyTicks,
    openPosition,
  };
}

// ---------------------------------------------------------------------------
// Standalone entrypoint
// ---------------------------------------------------------------------------

// Run directly: print pool state as JSON to stdout
if (process.argv[1] === new URL(import.meta.url).pathname) {
  (async () => {
    try {
      // Try to get wallet address from env; fall back to null
      let walletAddress = null;
      try {
        const { address } = getWallet();
        walletAddress = address;
      } catch {
        // No private key set — proceed without wallet address
      }

      const poolState = await queryPool(walletAddress);
      console.log(JSON.stringify(poolState));
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  })();
}
