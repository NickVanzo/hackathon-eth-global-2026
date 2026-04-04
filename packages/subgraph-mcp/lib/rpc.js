"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPoolTokens = getPoolTokens;
exports.getSpotPriceFromRpc = getSpotPriceFromRpc;
require("dotenv/config");
const ethers_1 = require("ethers");
// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions we actually call
// ---------------------------------------------------------------------------
const POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
];
const ERC20_ABI = ["function decimals() external view returns (uint8)"];
// ---------------------------------------------------------------------------
// Default RPC URL
// ---------------------------------------------------------------------------
const DEFAULT_RPC_URL = (_a = process.env.SEPOLIA_RPC_URL) !== null && _a !== void 0 ? _a : "https://ethereum-sepolia.publicnode.com";
// ---------------------------------------------------------------------------
// getPoolTokens — fetch token addresses and their decimals from a pool
// ---------------------------------------------------------------------------
async function getPoolTokens(poolAddress, rpcUrl = DEFAULT_RPC_URL) {
    try {
        const provider = new ethers_1.JsonRpcProvider(rpcUrl);
        const pool = new ethers_1.Contract(poolAddress, POOL_ABI, provider);
        const [token0Address, token1Address] = await Promise.all([
            pool.token0(),
            pool.token1(),
        ]);
        const token0Contract = new ethers_1.Contract(token0Address, ERC20_ABI, provider);
        const token1Contract = new ethers_1.Contract(token1Address, ERC20_ABI, provider);
        const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals(),
        ]);
        return {
            token0: token0Address,
            token1: token1Address,
            decimals0: Number(decimals0),
            decimals1: Number(decimals1),
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch pool tokens for ${poolAddress}: ${message}`);
    }
}
// ---------------------------------------------------------------------------
// getSpotPriceFromRpc — read slot0 and compute human-readable prices
// ---------------------------------------------------------------------------
async function getSpotPriceFromRpc(poolAddress, rpcUrl = DEFAULT_RPC_URL) {
    try {
        const provider = new ethers_1.JsonRpcProvider(rpcUrl);
        const pool = new ethers_1.Contract(poolAddress, POOL_ABI, provider);
        // Fetch slot0 and token decimals in parallel
        const [slot0Result, tokens] = await Promise.all([
            pool.slot0(),
            getPoolTokens(poolAddress, rpcUrl),
        ]);
        const sqrtPriceX96 = slot0Result[0];
        const tick = Number(slot0Result[1]);
        // Compute human-readable price from sqrtPriceX96
        const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
        const rawPrice = sqrtPrice ** 2;
        // Adjust for token decimal differences
        const priceToken1PerToken0 = rawPrice * 10 ** (tokens.decimals0 - tokens.decimals1);
        const priceToken0PerToken1 = priceToken1PerToken0 !== 0 ? 1 / priceToken1PerToken0 : 0;
        return {
            sqrtPriceX96: sqrtPriceX96.toString(),
            tick,
            priceToken1PerToken0,
            priceToken0PerToken1,
        };
    }
    catch (error) {
        // Re-throw our own errors as-is
        if (error instanceof Error &&
            error.message.startsWith("Failed to fetch")) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read spot price from pool ${poolAddress}: ${message}`);
    }
}
//# sourceMappingURL=rpc.js.map