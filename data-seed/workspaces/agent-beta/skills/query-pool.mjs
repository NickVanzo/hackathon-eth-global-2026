/**
 * query-pool.mjs — fetch current pool state from the Subgraph MCP server.
 *
 * Reads POOL_ADDRESS from workspace .env and MCP_SERVER_URL from the process
 * environment. Prints a JSON pool state object to stdout.
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

const MCP_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3001";

// ---------------------------------------------------------------------------
// Minimal Streamable HTTP MCP client
// ---------------------------------------------------------------------------

async function initSession() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  // Drain body to avoid socket hang
  await res.text();
  return sessionId;
}

async function callTool(sessionId, toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
  const envelope = await res.json();
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    const sessionId = await initSession();

    const priceResult = await callTool(sessionId, "get_pool_price", {
      poolAddress: POOL_ADDRESS,
      chain: "sepolia",
    });

    const { currentPrice, currentTick } = extractPriceAndTick(priceResult);

    // Pool state format expected by AGENTS.md strategy prompts
    const poolState = {
      currentPrice: parseFloat(currentPrice.toFixed(4)),
      // previousPrice is tracked across epochs by cron-trigger.js.
      // When this skill is called standalone (directly through the gateway),
      // previousPrice is null — strategies that depend on price direction (contrarian)
      // cannot function correctly without it in that path.
      previousPrice: null,
      currentTick: currentTick ?? Math.floor(Math.log(currentPrice) / Math.log(1.0001)),
      openPosition: { tickLower: null, tickUpper: null, liquidity: null },
    };

    console.log(JSON.stringify(poolState));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
