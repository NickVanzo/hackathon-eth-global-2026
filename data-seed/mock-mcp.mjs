#!/usr/bin/env node
/**
 * mock-mcp.mjs — local mock Subgraph MCP server for development.
 *
 * Speaks the same Streamable HTTP MCP protocol as the real Firebase Function,
 * but returns deterministic mock data. Allows testing cron-trigger.js + agents
 * without GRAPH_API_KEY or a Sepolia RPC connection.
 *
 * Usage:
 *   node data-seed/mock-mcp.mjs
 *
 * Then run cron with:
 *   MCP_SERVER_URL=http://127.0.0.1:3001 POOL_ADDRESS=0x1234...abcd [...] node data-seed/cron-trigger.js
 *
 * Price drifts ~±5 ticks per epoch to simulate realistic market movement.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.MCP_SERVER_PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// Mock state — price drifts slightly each call to simulate live data
// ---------------------------------------------------------------------------

// Approximate ETH/USDC starting values
let currentTick = 74959;           // ~$1800 ETH
let currentPrice = 1800.0;         // token0PerToken1 (USDC per WETH)

const TICK_SPACING = 60;           // 0.3% fee tier
const DRIFT_TICKS = 5;             // max tick movement per price fetch

function advancePrice() {
  // Small random walk: ±DRIFT_TICKS ticks per call
  const delta = Math.floor((Math.random() * 2 - 1) * DRIFT_TICKS);
  currentTick += delta;
  // Derive price from tick: price = 1.0001^tick
  currentPrice = Math.pow(1.0001, currentTick);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function handleGetPoolPrice() {
  advancePrice();
  return {
    status: "ok",
    tick: currentTick,
    priceToken0PerToken1: parseFloat(currentPrice.toFixed(4)),
    priceToken1PerToken0: parseFloat((1 / currentPrice).toFixed(8)),
    sqrtPriceX96: "0",   // not used by agents
    source: "rpc",
  };
}

function handleGetPoolTicks() {
  // Generate a few ticks around current price
  const ticks = [-3, -2, -1, 0, 1, 2, 3].map((offset) => ({
    tickIdx: String(Math.round(currentTick / TICK_SPACING) * TICK_SPACING + offset * TICK_SPACING),
    liquidityNet: String(Math.floor(100_000 + Math.random() * 50_000)),
    liquidityGross: String(Math.floor(200_000 + Math.random() * 100_000)),
  }));
  return { status: "ok", ticks };
}

function handleGetEthMacroPrice() {
  return { status: "ok", ethPriceUSD: currentPrice.toFixed(2) };
}

function handleGetPoolVolume() {
  return {
    status: "ok",
    pool: {
      volumeUSD: (Math.random() * 5_000_000 + 1_000_000).toFixed(2),
      totalValueLockedUSD: (Math.random() * 50_000_000 + 10_000_000).toFixed(2),
      token0: { symbol: "USDC" },
      token1: { symbol: "WETH" },
      feeTier: "3000",
    },
  };
}

function handleGetPoolFees() {
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: String(Math.floor(Date.now() / 1000) - i * 86400),
    feesUSD: (Math.random() * 10_000 + 1_000).toFixed(2),
    volumeUSD: (Math.random() * 1_000_000 + 100_000).toFixed(2),
  }));
  return { status: "ok", poolDayDatas: days };
}

function handleGetRecentSwaps() {
  const swaps = Array.from({ length: 5 }, () => ({
    timestamp: String(Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3600)),
    amountUSD: (Math.random() * 50_000 + 1_000).toFixed(2),
    amount0: (Math.random() * 10_000).toFixed(6),
    amount1: (Math.random() * 5).toFixed(8),
    sender: "0x" + "a".repeat(40),
  }));
  return { status: "ok", swaps };
}

function handleGetWhaleMovements() {
  return handleGetRecentSwaps();
}

// Mock addresses
const MOCK_USDC  = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const MOCK_WETH  = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const MOCK_POOL  = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";

function handleGetQuote(args) {
  const { amount = "1000000000000000000", type = "EXACT_INPUT" } = args ?? {};
  // Simulate a USDC→WETH or WETH→USDC quote using the current mock price
  const amountNum = BigInt(amount);
  // quote output: if EXACT_INPUT 1 WETH (~1800 USDC), scale by price
  const quoteAmount = String(amountNum);
  return {
    status: "ok",
    routing: "CLASSIC",
    quote: {
      chainId: 1,
      swapper: "0x0000000000000000000000000000000000000000",
      input: {
        token: args?.tokenInAddress ?? MOCK_WETH,
        amount: quoteAmount,
        amountDecimals: (Number(amountNum) / 1e18).toFixed(6),
      },
      output: {
        token: args?.tokenOutAddress ?? MOCK_USDC,
        amount: String(Math.round(currentPrice * 1e6)),
        amountDecimals: currentPrice.toFixed(6),
        minimumAmount: String(Math.round(currentPrice * 0.995 * 1e6)),
      },
      slippage: 0.5,
      tradeType: type,
      gasFeeUSD: (Math.random() * 5 + 1).toFixed(2),
      priceImpact: (Math.random() * 0.3).toFixed(4),
    },
    permitData: null,
  };
}

function handleGetRoute(args) {
  const quote = handleGetQuote(args);
  // Augment with route detail
  quote.quote.route = [
    [
      {
        type: "v3-pool",
        address: MOCK_POOL,
        tokenIn:  { address: args?.tokenInAddress  ?? MOCK_WETH, symbol: "WETH", decimals: 18 },
        tokenOut: { address: args?.tokenOutAddress ?? MOCK_USDC, symbol: "USDC", decimals: 6 },
        fee: "3000",
        sqrtRatioX96: "0",
        liquidity: "12345678901234567890",
        tickCurrent: String(currentTick),
        amountIn:  quote.quote.input.amount,
        amountOut: quote.quote.output.amount,
      },
    ],
  ];
  return quote;
}

function handleGetPools(args) {
  const { chainId = 1 } = args ?? {};
  return {
    status: "ok",
    pools: [
      {
        address: MOCK_POOL,
        chainId,
        token0: { address: MOCK_USDC, symbol: "USDC", decimals: 6 },
        token1: { address: MOCK_WETH, symbol: "WETH", decimals: 18 },
        fee: 3000,
        tickSpacing: TICK_SPACING,
        sqrtPriceX96: "0",
        tick: currentTick,
        liquidity: "12345678901234567890",
        totalValueLockedUSD: (Math.random() * 50_000_000 + 10_000_000).toFixed(2),
        volumeUSD24h: (Math.random() * 5_000_000 + 1_000_000).toFixed(2),
        feeTier: "0.3%",
      },
    ],
  };
}

function handleGetPositions(args) {
  const { address = "0x0000000000000000000000000000000000000000" } = args ?? {};

  // Two mock LP positions bracketing the current tick
  const snap = Math.round(currentTick / TICK_SPACING) * TICK_SPACING;

  // Position 1: in-range — straddles currentTick
  const pos1TickLower = snap - TICK_SPACING * 10;  // ~600 ticks below
  const pos1TickUpper = snap + TICK_SPACING * 10;  // ~600 ticks above

  // Position 2: out-of-range — entirely below current tick (single-sided USDC)
  const pos2TickUpper = snap - TICK_SPACING * 20;
  const pos2TickLower = snap - TICK_SPACING * 40;

  return {
    status: "ok",
    positions: [
      {
        tokenId: "12345",
        owner: address,
        pool: MOCK_POOL,
        token0: { address: MOCK_USDC, symbol: "USDC", decimals: 6 },
        token1: { address: MOCK_WETH, symbol: "WETH", decimals: 18 },
        fee: 3000,
        tickLower: pos1TickLower,
        tickUpper: pos1TickUpper,
        liquidity: "5000000000000000000",
        amount0: "4820123456",          // USDC (6 dec)
        amount1: "2678901234567890123", // WETH (18 dec)
        inRange: true,
        uncollectedFees: {
          amount0: "12345678",          // USDC
          amount1: "6789012345678",     // WETH
        },
      },
      {
        tokenId: "12346",
        owner: address,
        pool: MOCK_POOL,
        token0: { address: MOCK_USDC, symbol: "USDC", decimals: 6 },
        token1: { address: MOCK_WETH, symbol: "WETH", decimals: 18 },
        fee: 3000,
        tickLower: pos2TickLower,
        tickUpper: pos2TickUpper,
        liquidity: "2000000000000000000",
        amount0: "9640246912",          // USDC only (out-of-range below)
        amount1: "0",
        inRange: false,
        uncollectedFees: {
          amount0: "987654",
          amount1: "0",
        },
      },
    ],
  };
}

const TOOL_HANDLERS = {
  get_pool_price: handleGetPoolPrice,
  get_pool_ticks: handleGetPoolTicks,
  get_eth_macro_price: handleGetEthMacroPrice,
  get_pool_volume: handleGetPoolVolume,
  get_pool_fees: handleGetPoolFees,
  get_recent_swaps: handleGetRecentSwaps,
  get_whale_movements: handleGetWhaleMovements,
  get_quote: handleGetQuote,
  get_route: handleGetRoute,
  get_pools: handleGetPools,
  get_positions: handleGetPositions,
};

// ---------------------------------------------------------------------------
// Streamable HTTP MCP protocol (minimal — only what cron + agents use)
// ---------------------------------------------------------------------------

const activeSessions = new Set();

function respond(res, statusCode, headers, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...headers,
  });
  res.end(json);
}

function handleInitialize(req, res) {
  const sessionId = randomUUID();
  // Evict oldest session if the set grows too large (long dev sessions open many sessions)
  if (activeSessions.size >= 1000) {
    activeSessions.delete(activeSessions.values().next().value);
  }
  activeSessions.add(sessionId);
  respond(res, 200, { "mcp-session-id": sessionId }, {
    jsonrpc: "2.0",
    id: req._body?.id ?? 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mock-mcp", version: "1.0.0" },
    },
  });
}

function handleToolCall(req, res) {
  const { id, params } = req._body;
  const toolName = params?.name;
  const handler = TOOL_HANDLERS[toolName];

  if (!handler) {
    return respond(res, 200, {}, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    });
  }

  const payload = handler(params?.arguments ?? {});
  respond(res, 200, {}, {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(payload) }],
    },
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try {
      req._body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end("Bad JSON");
      return;
    }

    const { method } = req._body;
    const sessionId = req.headers["mcp-session-id"];

    if (method === "initialize") {
      handleInitialize(req, res);
      return;
    }

    if (!sessionId || !activeSessions.has(sessionId)) {
      respond(res, 400, {}, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session ID" },
        id: null,
      });
      return;
    }

    if (method === "tools/call") {
      handleToolCall(req, res);
      return;
    }

    // Ignore other methods (notifications, ping, etc.)
    respond(res, 200, {}, { jsonrpc: "2.0", id: req._body.id ?? null, result: {} });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-mcp] running at http://127.0.0.1:${PORT}`);
  console.log(`[mock-mcp] tools: ${Object.keys(TOOL_HANDLERS).join(", ")}`);
  console.log(`[mock-mcp] starting price: $${currentPrice.toFixed(2)} (tick ${currentTick})`);
});
