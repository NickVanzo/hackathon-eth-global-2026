import "dotenv/config";
import { JsonRpcProvider, Contract } from "ethers";

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

const DEFAULT_RPC_URL =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia.publicnode.com";

// ---------------------------------------------------------------------------
// getPoolTokens — fetch token addresses and their decimals from a pool
// ---------------------------------------------------------------------------

export async function getPoolTokens(
  poolAddress: string,
  rpcUrl: string = DEFAULT_RPC_URL
): Promise<{
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}> {
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const pool = new Contract(poolAddress, POOL_ABI, provider);

    const [token0Address, token1Address] = await Promise.all([
      pool.token0() as Promise<string>,
      pool.token1() as Promise<string>,
    ]);

    const token0Contract = new Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new Contract(token1Address, ERC20_ABI, provider);

    const [decimals0, decimals1] = await Promise.all([
      token0Contract.decimals() as Promise<bigint>,
      token1Contract.decimals() as Promise<bigint>,
    ]);

    return {
      token0: token0Address,
      token1: token1Address,
      decimals0: Number(decimals0),
      decimals1: Number(decimals1),
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch pool tokens for ${poolAddress}: ${message}`
    );
  }
}

// ---------------------------------------------------------------------------
// getSpotPriceFromRpc — read slot0 and compute human-readable prices
// ---------------------------------------------------------------------------

export async function getSpotPriceFromRpc(
  poolAddress: string,
  rpcUrl: string = DEFAULT_RPC_URL
): Promise<{
  sqrtPriceX96: string;
  tick: number;
  priceToken1PerToken0: number;
  priceToken0PerToken1: number;
}> {
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const pool = new Contract(poolAddress, POOL_ABI, provider);

    // Fetch slot0 and token decimals in parallel
    const [slot0Result, tokens] = await Promise.all([
      pool.slot0(),
      getPoolTokens(poolAddress, rpcUrl),
    ]);

    const sqrtPriceX96: bigint = slot0Result[0];
    const tick: number = Number(slot0Result[1]);

    // Compute human-readable price from sqrtPriceX96
    const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
    const rawPrice = sqrtPrice ** 2;

    // Adjust for token decimal differences
    const priceToken1PerToken0 =
      rawPrice * 10 ** (tokens.decimals0 - tokens.decimals1);
    const priceToken0PerToken1 =
      priceToken1PerToken0 !== 0 ? 1 / priceToken1PerToken0 : 0;

    return {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      priceToken1PerToken0,
      priceToken0PerToken1,
    };
  } catch (error: unknown) {
    // Re-throw our own errors as-is
    if (
      error instanceof Error &&
      error.message.startsWith("Failed to fetch")
    ) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read spot price from pool ${poolAddress}: ${message}`
    );
  }
}
