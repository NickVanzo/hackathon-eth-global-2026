"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMcpServer = createMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const subgraph_js_1 = require("./subgraph.js");
const rpc_js_1 = require("./rpc.js");
const chainValues = ["ethereum", "base", "sepolia"];
const chainSchema = zod_1.z
    .enum(chainValues)
    .describe(`Target chain: ${chainValues.join(" or ")}`);
// Validates and normalises pool addresses: must be a 40-hex-char Ethereum address.
// Normalised to lowercase because The Graph indexes IDs in lowercase.
// .describe() precedes .transform() so the description attaches to the input schema,
// not the transform output — ensuring MCP clients see the description in tool schemas.
const poolAddressSchema = zod_1.z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid Ethereum address (0x + 40 hex chars)")
    .describe("Pool contract address (0x…, 40 hex chars)")
    .transform((address) => address.toLowerCase());
// Validates that minAmountUSD is a positive decimal string before it is
// sent as a GraphQL BigDecimal variable.
const minAmountUSDSchema = zod_1.z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Must be a positive numeric string, e.g. '50000'")
    .describe("Minimum swap size in USD, e.g. '50000'");
function createMcpServer() {
    const server = new mcp_js_1.McpServer({ name: "0g-defi-mcp", version: "1.0.0" });
    server.registerTool("get_eth_macro_price", {
        description: "Get the current ETH price in USD from a Uniswap V3 bundle on the given chain.",
        inputSchema: { chain: chainSchema },
    }, getEthMacroPrice);
    server.registerTool("get_pool_volume", {
        description: "Get 24h volume and TVL for a Uniswap V3 pool.",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
        },
    }, getPoolVolume);
    server.registerTool("get_whale_movements", {
        description: "Fetch the 10 most recent swaps in a Uniswap V3 pool that exceed a USD threshold.",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
            minAmountUSD: minAmountUSDSchema,
        },
    }, getWhaleMovements);
    server.registerTool("get_pool_price", {
        description: "Get the current token price ratio for a Uniswap V3 pool (token0Price, token1Price, and token symbols).",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
        },
    }, getPoolPrice);
    server.registerTool("get_pool_ticks", {
        description: "Get the tick array (liquidityNet, liquidityGross) for a Uniswap V3 pool, showing liquidity distribution across price ranges.",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
        },
    }, getPoolTicks);
    server.registerTool("get_pool_fees", {
        description: "Get the last 7 days of fee accrual and volume for a Uniswap V3 pool.",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
        },
    }, getPoolFees);
    server.registerTool("get_recent_swaps", {
        description: "Fetch recent swaps in a Uniswap V3 pool ordered by timestamp descending (no minimum size filter).",
        inputSchema: {
            poolAddress: poolAddressSchema,
            chain: chainSchema,
            count: zod_1.z
                .number()
                .int()
                .min(1)
                .max(100)
                .default(20)
                .describe("Number of swaps to return (1–100, default 20)"),
        },
    }, getRecentSwaps);
    return server;
}
async function getEthMacroPrice({ chain }) {
    var _a, _b;
    try {
        const result = await (0, subgraph_js_1.fetchEthPrice)(chain);
        const ethPriceUSD = (_b = (_a = result.bundles[0]) === null || _a === void 0 ? void 0 : _a.ethPriceUSD) !== null && _b !== void 0 ? _b : "0";
        return buildToolResult({ ethPriceUSD });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
async function getPoolVolume({ poolAddress, chain, }) {
    try {
        const result = await (0, subgraph_js_1.fetchPoolVolume)(chain, poolAddress);
        if (!result.pool) {
            return buildErrorResult(`Pool ${poolAddress} not found on ${chain}`);
        }
        return buildToolResult({ pool: result.pool });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
async function getWhaleMovements({ poolAddress, chain, minAmountUSD, }) {
    try {
        const result = await (0, subgraph_js_1.fetchWhaleMovements)(chain, poolAddress, minAmountUSD);
        return buildToolResult({ swaps: result.swaps });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
async function getPoolPrice({ poolAddress, chain, }) {
    var _a;
    // Try subgraph first; fall back to direct slot0() RPC read for Sepolia
    // (subgraph may lag or be unavailable on testnets).
    try {
        const result = await (0, subgraph_js_1.fetchPoolPrice)(chain, poolAddress);
        if (result.pool) {
            return buildToolResult({ pool: result.pool, source: "subgraph" });
        }
    }
    catch (_b) {
        // subgraph failed — fall through to RPC
    }
    if (chain === "sepolia") {
        try {
            const rpcUrl = (_a = process.env.SEPOLIA_RPC_URL) !== null && _a !== void 0 ? _a : "https://ethereum-sepolia.publicnode.com";
            const rpcPrice = await (0, rpc_js_1.getSpotPriceFromRpc)(poolAddress, rpcUrl);
            return buildToolResult(Object.assign(Object.assign({}, rpcPrice), { source: "rpc" }));
        }
        catch (rpcErr) {
            return buildErrorResult(`Both subgraph and RPC failed: ${toErrorMessage(rpcErr)}`);
        }
    }
    return buildErrorResult(`Pool ${poolAddress} not found on ${chain}`);
}
async function getPoolTicks({ poolAddress, chain, }) {
    try {
        const result = await (0, subgraph_js_1.fetchPoolTicks)(chain, poolAddress);
        return buildToolResult({ ticks: result.ticks });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
async function getPoolFees({ poolAddress, chain, }) {
    try {
        const result = await (0, subgraph_js_1.fetchPoolFees)(chain, poolAddress);
        return buildToolResult({ poolDayDatas: result.poolDayDatas });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
async function getRecentSwaps({ poolAddress, chain, count, }) {
    try {
        const result = await (0, subgraph_js_1.fetchRecentSwaps)(chain, poolAddress, count);
        return buildToolResult({ swaps: result.swaps });
    }
    catch (err) {
        return buildErrorResult(toErrorMessage(err));
    }
}
function buildToolResult(payload) {
    return buildContent(Object.assign({ status: "ok" }, payload));
}
function buildErrorResult(message) {
    return buildContent({ status: "error", message });
}
function buildContent(data) {
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function toErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    try {
        return JSON.stringify(err);
    }
    catch (_a) {
        return String(err);
    }
}
//# sourceMappingURL=server.js.map