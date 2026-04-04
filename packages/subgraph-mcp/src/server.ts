import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Chain } from "./config.js";
import {
  fetchEthPrice,
  fetchPoolVolume,
  fetchWhaleMovements,
  fetchPoolPrice,
  fetchPoolTicks,
  fetchPoolFees,
  fetchRecentSwaps,
} from "./subgraph.js";
import { getSpotPriceFromRpc } from "./rpc.js";
import {
  fetchQuote,
  fetchRoute,
  fetchPools,
  fetchPositions,
} from "./trading-api.js";

const chainValues: [Chain, ...Chain[]] = ["ethereum", "base", "sepolia"];

const chainSchema = z
  .enum(chainValues)
  .describe(`Target chain: ${chainValues.join(" or ")}`);

// Validates and normalises pool addresses: must be a 40-hex-char Ethereum address.
// Normalised to lowercase because The Graph indexes IDs in lowercase.
// .describe() precedes .transform() so the description attaches to the input schema,
// not the transform output — ensuring MCP clients see the description in tool schemas.
const poolAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid Ethereum address (0x + 40 hex chars)")
  .describe("Pool contract address (0x…, 40 hex chars)")
  .transform((address) => address.toLowerCase());

// Validates that minAmountUSD is a positive decimal string before it is
// sent as a GraphQL BigDecimal variable.
const minAmountUSDSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Must be a positive numeric string, e.g. '50000'")
  .describe("Minimum swap size in USD, e.g. '50000'");

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "0g-defi-mcp", version: "2.0.0" });

  server.registerTool(
    "get_eth_macro_price",
    {
      description: "Get the current ETH price in USD from a Uniswap V3 bundle on the given chain.",
      inputSchema: { chain: chainSchema },
    },
    getEthMacroPrice
  );

  server.registerTool(
    "get_pool_volume",
    {
      description: "Get 24h volume and TVL for a Uniswap V3 pool.",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
      },
    },
    getPoolVolume
  );

  server.registerTool(
    "get_whale_movements",
    {
      description: "Fetch the 10 most recent swaps in a Uniswap V3 pool that exceed a USD threshold.",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
        minAmountUSD: minAmountUSDSchema,
      },
    },
    getWhaleMovements
  );

  server.registerTool(
    "get_pool_price",
    {
      description: "Get the current token price ratio for a Uniswap V3 pool (token0Price, token1Price, and token symbols).",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
      },
    },
    getPoolPrice
  );

  server.registerTool(
    "get_pool_ticks",
    {
      description: "Get the tick array (liquidityNet, liquidityGross) for a Uniswap V3 pool, showing liquidity distribution across price ranges.",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
      },
    },
    getPoolTicks
  );

  server.registerTool(
    "get_pool_fees",
    {
      description: "Get the last 7 days of fee accrual and volume for a Uniswap V3 pool.",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
      },
    },
    getPoolFees
  );

  server.registerTool(
    "get_recent_swaps",
    {
      description: "Fetch recent swaps in a Uniswap V3 pool ordered by timestamp descending (no minimum size filter).",
      inputSchema: {
        poolAddress: poolAddressSchema,
        chain: chainSchema,
        count: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Number of swaps to return (1–100, default 20)"),
      },
    },
    getRecentSwaps
  );

  // ── Uniswap Trading API proxy tools ──────────────────────────────────

  server.registerTool(
    "get_quote",
    {
      description:
        "Get a Uniswap swap quote. Returns the best route and output amount.",
      inputSchema: {
        tokenInChainId: z.number().int().describe("Chain ID for the input token"),
        tokenOutChainId: z.number().int().describe("Chain ID for the output token"),
        tokenIn: poolAddressSchema.describe("Input token address"),
        tokenOut: poolAddressSchema.describe("Output token address"),
        amount: z.string().describe("Token amount in smallest unit (wei)"),
        type: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]).describe("Quote type"),
        swapper: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Swapper wallet address"),
      },
    },
    async ({ tokenInChainId, tokenOutChainId, tokenIn, tokenOut, amount, type, swapper }: {
      tokenInChainId: number; tokenOutChainId: number; tokenIn: string; tokenOut: string;
      amount: string; type: "EXACT_INPUT" | "EXACT_OUTPUT"; swapper: string;
    }) => {
      try {
        const result = await fetchQuote({
          tokenInChainId: String(tokenInChainId), tokenOutChainId: String(tokenOutChainId),
          tokenIn, tokenOut, amount, type, swapper,
        });
        return buildToolResult(result as unknown as Record<string, unknown>);
      } catch (err) { return buildErrorResult(toErrorMessage(err)); }
    }
  );

  server.registerTool(
    "get_route",
    {
      description: "Get the full swap route details for a Uniswap trade.",
      inputSchema: {
        tokenInChainId: z.number().int().describe("Chain ID for the input token"),
        tokenOutChainId: z.number().int().describe("Chain ID for the output token"),
        tokenIn: poolAddressSchema.describe("Input token address"),
        tokenOut: poolAddressSchema.describe("Output token address"),
        amount: z.string().describe("Token amount in smallest unit (wei)"),
        type: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]).describe("Quote type"),
        swapper: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Swapper wallet address"),
      },
    },
    async ({ tokenInChainId, tokenOutChainId, tokenIn, tokenOut, amount, type, swapper }: {
      tokenInChainId: number; tokenOutChainId: number; tokenIn: string; tokenOut: string;
      amount: string; type: "EXACT_INPUT" | "EXACT_OUTPUT"; swapper: string;
    }) => {
      try {
        const result = await fetchRoute({
          tokenInChainId: String(tokenInChainId), tokenOutChainId: String(tokenOutChainId),
          tokenIn, tokenOut, amount, type, swapper,
        });
        return buildToolResult(result as unknown as Record<string, unknown>);
      } catch (err) { return buildErrorResult(toErrorMessage(err)); }
    }
  );

  server.registerTool(
    "get_pools",
    {
      description: "List Uniswap pools, optionally filtered by token addresses.",
      inputSchema: {
        chainId: z.number().int().describe("Chain ID to query pools on"),
        tokenIn: poolAddressSchema.optional().describe("Optional input token address filter"),
        tokenOut: poolAddressSchema.optional().describe("Optional output token address filter"),
      },
    },
    async ({ chainId, tokenIn, tokenOut }: { chainId: number; tokenIn?: string; tokenOut?: string }) => {
      try {
        const result = await fetchPools({ chainId: String(chainId), tokenIn, tokenOut });
        return buildToolResult(result as unknown as Record<string, unknown>);
      } catch (err) { return buildErrorResult(toErrorMessage(err)); }
    }
  );

  server.registerTool(
    "get_positions",
    {
      description: "Get Uniswap liquidity positions for a wallet address on a given chain.",
      inputSchema: {
        chainId: z.number().int().describe("Chain ID to query positions on"),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid Ethereum address")
          .describe("Wallet address to look up positions for"),
      },
    },
    async ({ chainId, address }: { chainId: number; address: string }) => {
      try {
        const result = await fetchPositions({ chainId: String(chainId), address });
        return buildToolResult(result as unknown as Record<string, unknown>);
      } catch (err) { return buildErrorResult(toErrorMessage(err)); }
    }
  );

  return server;
}

async function getEthMacroPrice({ chain }: { chain: Chain }) {
  try {
    const result = await fetchEthPrice(chain);
    const ethPriceUSD = result.bundles[0]?.ethPriceUSD ?? "0";
    return buildToolResult({ ethPriceUSD });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

async function getPoolVolume({
  poolAddress,
  chain,
}: {
  poolAddress: string;
  chain: Chain;
}) {
  try {
    const result = await fetchPoolVolume(chain, poolAddress);
    if (!result.pool) {
      return buildErrorResult(`Pool ${poolAddress} not found on ${chain}`);
    }
    return buildToolResult({ pool: result.pool });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

async function getWhaleMovements({
  poolAddress,
  chain,
  minAmountUSD,
}: {
  poolAddress: string;
  chain: Chain;
  minAmountUSD: string;
}) {
  try {
    const result = await fetchWhaleMovements(chain, poolAddress, minAmountUSD);
    return buildToolResult({ swaps: result.swaps });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

async function getPoolPrice({
  poolAddress,
  chain,
}: {
  poolAddress: string;
  chain: Chain;
}) {
  // Try subgraph first; fall back to direct slot0() RPC read for Sepolia
  // (subgraph may lag or be unavailable on testnets).
  try {
    const result = await fetchPoolPrice(chain, poolAddress);
    if (result.pool) {
      return buildToolResult({ pool: result.pool, source: "subgraph" });
    }
  } catch {
    // subgraph failed — fall through to RPC
  }

  if (chain === "sepolia") {
    try {
      const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia.publicnode.com";
      const rpcPrice = await getSpotPriceFromRpc(poolAddress, rpcUrl);
      return buildToolResult({ ...rpcPrice, source: "rpc" });
    } catch (rpcErr) {
      return buildErrorResult(`Both subgraph and RPC failed: ${toErrorMessage(rpcErr)}`);
    }
  }

  return buildErrorResult(`Pool ${poolAddress} not found on ${chain}`);
}

async function getPoolTicks({
  poolAddress,
  chain,
}: {
  poolAddress: string;
  chain: Chain;
}) {
  try {
    const result = await fetchPoolTicks(chain, poolAddress);
    return buildToolResult({ ticks: result.ticks });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

async function getPoolFees({
  poolAddress,
  chain,
}: {
  poolAddress: string;
  chain: Chain;
}) {
  try {
    const result = await fetchPoolFees(chain, poolAddress);
    return buildToolResult({ poolDayDatas: result.poolDayDatas });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

async function getRecentSwaps({
  poolAddress,
  chain,
  count,
}: {
  poolAddress: string;
  chain: Chain;
  count: number;
}) {
  try {
    const result = await fetchRecentSwaps(chain, poolAddress, count);
    return buildToolResult({ swaps: result.swaps });
  } catch (err) {
    return buildErrorResult(toErrorMessage(err));
  }
}

function buildToolResult(payload: Record<string, unknown>) {
  return buildContent({ status: "ok", ...payload });
}

function buildErrorResult(message: string) {
  return buildContent({ status: "error", message });
}

function buildContent(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
