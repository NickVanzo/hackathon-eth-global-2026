"use strict";
/**
 * Proxies requests to the Uniswap Trading API.
 *
 * The MCP server acts as a secure proxy so that downstream agents never
 * see the API key. The key is read from `process.env.UNISWAP_API_KEY`
 * (a Firebase secret injected at runtime).
 *
 * Base URL: https://api.uniswap.org/v1
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchQuote = fetchQuote;
exports.fetchRoute = fetchRoute;
exports.fetchPools = fetchPools;
exports.fetchPositions = fetchPositions;
const BASE_URL = "https://api.uniswap.org/v1";
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
 * Generic GET request to the Uniswap Trading API.
 *
 * - Reads the API key from the environment.
 * - Builds the URL with query parameters.
 * - Enforces an 8-second timeout via `AbortSignal.timeout`.
 * - Throws on non-2xx responses or GraphQL-style `errors` payloads.
 */
async function callTradingApi(path, params) {
    const key = getApiKey();
    const url = new URL(`${BASE_URL}${path}`);
    const searchParams = new URLSearchParams(params);
    url.search = searchParams.toString();
    const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
            "x-api-key": key,
            Accept: "application/json",
        },
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
    const qs = {
        tokenInChainId: params.tokenInChainId,
        tokenOutChainId: params.tokenOutChainId,
        tokenInAddress: params.tokenInAddress,
        tokenOutAddress: params.tokenOutAddress,
        amount: params.amount,
        type: params.type,
    };
    if (params.slippageTolerance !== undefined) {
        qs.slippageTolerance = params.slippageTolerance;
    }
    return callTradingApi("/quote", qs);
}
async function fetchRoute(params) {
    const qs = {
        tokenInChainId: params.tokenInChainId,
        tokenOutChainId: params.tokenOutChainId,
        tokenInAddress: params.tokenInAddress,
        tokenOutAddress: params.tokenOutAddress,
        amount: params.amount,
        type: params.type,
    };
    if (params.slippageTolerance !== undefined) {
        qs.slippageTolerance = params.slippageTolerance;
    }
    return callTradingApi("/route", qs);
}
async function fetchPools(params) {
    const qs = {
        chainId: params.chainId,
    };
    if (params.token0Address !== undefined) {
        qs.token0Address = params.token0Address;
    }
    if (params.token1Address !== undefined) {
        qs.token1Address = params.token1Address;
    }
    if (params.fee !== undefined) {
        qs.fee = params.fee;
    }
    return callTradingApi("/pools", qs);
}
async function fetchPositions(params) {
    return callTradingApi("/positions", {
        chainId: params.chainId,
        address: params.address,
    });
}
//# sourceMappingURL=trading-api.js.map