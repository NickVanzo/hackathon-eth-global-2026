"use strict";
/**
 * Proxies requests to the Uniswap Trading API.
 *
 * The MCP server acts as a secure proxy so that downstream agents never
 * see the API key. The key is read from `process.env.UNISWAP_API_KEY`
 * (a Firebase secret injected at runtime).
 *
 * Base URL: https://trade-api.gateway.uniswap.org/v1
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchQuote = fetchQuote;
exports.fetchRoute = fetchRoute;
exports.fetchPools = fetchPools;
exports.fetchPositions = fetchPositions;
const BASE_URL = "https://trade-api.gateway.uniswap.org/v1";
// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------
function getApiKey() {
    const key = process.env.UNISWAP_API_KEY;
    if (!key) {
        throw new Error("UNISWAP_API_KEY is not set. Ensure the secret is configured in your Firebase environment.");
    }
    return key;
}
/**
 * Generic POST request to the Uniswap Trading API.
 *
 * - Reads the API key from the environment.
 * - Sends JSON body via POST (the Trading API uses POST, not GET).
 * - Enforces an 8-second timeout via `AbortSignal.timeout`.
 * - Throws on non-2xx responses or error payloads.
 */
async function callTradingApi(path, body) {
    const key = getApiKey();
    const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
            "x-api-key": key,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Uniswap API ${path} returned ${response.status}: ${text}`);
    }
    const data = (await response.json());
    if (Array.isArray(data.errors) && data.errors.length > 0) {
        throw new Error(`Uniswap API ${path} returned errors: ${JSON.stringify(data.errors)}`);
    }
    return data;
}
async function fetchQuote(params) {
    const body = {
        tokenInChainId: Number(params.tokenInChainId),
        tokenOutChainId: Number(params.tokenOutChainId),
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amount: params.amount,
        type: params.type,
        swapper: params.swapper,
        configs: [{ routingType: "CLASSIC", protocols: ["V3"] }],
    };
    if (params.slippageTolerance !== undefined) {
        body.slippageTolerance = params.slippageTolerance;
    }
    return callTradingApi("/quote", body);
}
async function fetchRoute(params) {
    const body = {
        tokenInChainId: Number(params.tokenInChainId),
        tokenOutChainId: Number(params.tokenOutChainId),
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amount: params.amount,
        type: params.type,
        swapper: params.swapper,
        configs: [{ routingType: "CLASSIC", protocols: ["V3"] }],
    };
    if (params.slippageTolerance !== undefined) {
        body.slippageTolerance = params.slippageTolerance;
    }
    return callTradingApi("/route", body);
}
async function fetchPools(params) {
    const body = {
        chainId: Number(params.chainId),
    };
    if (params.tokenIn !== undefined)
        body.tokenIn = params.tokenIn;
    if (params.tokenOut !== undefined)
        body.tokenOut = params.tokenOut;
    if (params.fee !== undefined)
        body.fee = params.fee;
    return callTradingApi("/pools", body);
}
async function fetchPositions(params) {
    return callTradingApi("/positions", {
        chainId: Number(params.chainId),
        address: params.address,
    });
}
//# sourceMappingURL=trading-api.js.map