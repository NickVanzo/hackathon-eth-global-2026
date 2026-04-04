import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from "viem";
import {
  UNISWAP_API_URL,
  UNISWAP_API_KEY,
  DEPOSIT_TOKEN_ADDRESS,
  WETH_ADDRESS,
  SATELLITE_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from "./env";

// ---------------------------------------------------------------------------
// Uniswap Trading API — swap calldata for the Universal Router
//
// Sepolia (11155111) is a supported chain on the Trading API.
//
// The satellite uses the Trading API calldata to:
//   1. Zap-in (OPEN_POSITION): swap ~50% USDC.e → WETH before LP minting
//   2. Zap-out (CLOSE/forceClose): swap WETH → USDC.e after LP withdrawal
//
// Flow: POST /quote → POST /swap → extract swap.data (Universal Router calldata)
//
// We force routingPreference: "CLASSIC" because the satellite is a contract
// and cannot sign UniswapX (DUTCH_V2/V3/PRIORITY) off-chain orders.
// ---------------------------------------------------------------------------

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": UNISWAP_API_KEY,
  "x-universal-router-version": "2.0",
};

// Exponential backoff for 429 / 5xx responses
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === maxRetries) return response; // return last failed response
    const delay = Math.min(200 * Math.pow(2, attempt) + Math.random() * 100, 5000);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Core helper: POST /quote then POST /swap → returns Universal Router calldata
// ---------------------------------------------------------------------------

async function getSwapCalldata(
  tokenIn: string,
  tokenOut: string,
  amount: bigint,
  label: string,
): Promise<`0x${string}`> {
  if (!UNISWAP_API_KEY) {
    console.warn(`[uniswap] ${label}: no API key — returning empty calldata`);
    return "0x";
  }
  if (amount === 0n) return "0x";

  // ---- Step 1: POST /quote ----
  const quoteBody = {
    swapper: SATELLITE_ADDRESS,
    tokenIn,
    tokenOut,
    tokenInChainId: String(SEPOLIA_CHAIN_ID),
    tokenOutChainId: String(SEPOLIA_CHAIN_ID),
    amount: amount.toString(),
    type: "EXACT_INPUT",
    slippageTolerance: 1.0, // 1 % — generous for hackathon
    routingPreference: "BEST_PRICE", // satellite is a contract — we filter for CLASSIC in the response
    protocols: ["V3"],
  };

  console.log(`[uniswap] ${label}: POST /quote`, JSON.stringify(quoteBody));

  const quoteRes = await fetchWithRetry(`${UNISWAP_API_URL}/quote`, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(quoteBody),
  });

  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    console.warn(`[uniswap] ${label}: quote failed (${quoteRes.status}):`, errText);
    return "0x";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quoteResponse = await quoteRes.json() as any;

  // Safety: even with routingPreference=BEST_PRICE, verify we got AMM routing
  if (quoteResponse.routing !== "CLASSIC") {
    console.warn(`[uniswap] ${label}: got non-CLASSIC routing "${quoteResponse.routing}" — skipping`);
    return "0x";
  }

  console.log(`[uniswap] ${label}: quote OK — output=${quoteResponse.quote?.output?.amount}`);

  // ---- Step 2: POST /swap ----
  // Spread quote response into body, strip permitData/permitTransaction per API spec.
  // For CLASSIC routes executed by a contract (no Permit2 signing), we omit both
  // signature and permitData entirely.
  const { permitData, permitTransaction, ...cleanQuote } = quoteResponse as {
    permitData?: unknown;
    permitTransaction?: unknown;
    [key: string]: unknown;
  };

  const swapRes = await fetchWithRetry(`${UNISWAP_API_URL}/swap`, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(cleanQuote),
  });

  if (!swapRes.ok) {
    const errText = await swapRes.text();
    console.warn(`[uniswap] ${label}: swap failed (${swapRes.status}):`, errText);
    return "0x";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const swapData = await swapRes.json() as any;
  const calldata = swapData?.swap?.data;

  // Validate calldata before returning
  if (!calldata || calldata === "0x" || calldata === "") {
    console.warn(`[uniswap] ${label}: empty swap.data — quote may have expired`);
    return "0x";
  }

  console.log(`[uniswap] ${label}: swap OK — calldata length=${calldata.length}`);
  return calldata as `0x${string}`;
}

// ---------------------------------------------------------------------------
// getZapInCalldata
// Returns Universal Router calldata for swapping `halfAmountUSDC` USDC.e → WETH
// (the satellite uses it before LP minting to obtain the WETH leg).
// ---------------------------------------------------------------------------

export async function getZapInCalldata(halfAmountUSDC: bigint): Promise<`0x${string}`> {
  try {
    return await getSwapCalldata(
      DEPOSIT_TOKEN_ADDRESS,
      WETH_ADDRESS,
      halfAmountUSDC,
      "zap-in",
    );
  } catch (err) {
    console.error("[uniswap] getZapInCalldata error:", err);
    return "0x";
  }
}

// ---------------------------------------------------------------------------
// getZapOutCalldata
// Returns Universal Router calldata for swapping `wethAmount` WETH → USDC.e
// (the satellite uses it after LP withdrawal to recover USDC.e).
// ---------------------------------------------------------------------------

export async function getZapOutCalldata(wethAmount: bigint): Promise<`0x${string}`> {
  try {
    return await getSwapCalldata(
      WETH_ADDRESS,
      DEPOSIT_TOKEN_ADDRESS,
      wethAmount,
      "zap-out",
    );
  } catch (err) {
    console.error("[uniswap] getZapOutCalldata error:", err);
    return "0x";
  }
}

// ---------------------------------------------------------------------------
// checkApproval
// Checks whether the satellite has approved enough tokens for the swap.
// Useful for debugging — the satellite should have pre-approved the
// Universal Router during deployment. Returns the approval tx if needed.
// ---------------------------------------------------------------------------

export async function checkApproval(
  token: string,
  amount: bigint,
): Promise<{ needed: boolean; approvalTx?: Record<string, unknown> }> {
  if (!UNISWAP_API_KEY) return { needed: false };

  try {
    const res = await fetchWithRetry(`${UNISWAP_API_URL}/check_approval`, {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        walletAddress: SATELLITE_ADDRESS,
        token,
        amount: amount.toString(),
        chainId: SEPOLIA_CHAIN_ID,
      }),
    });

    if (!res.ok) return { needed: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    if (data.approval) {
      console.warn(`[uniswap] approval needed for ${token} — satellite may need pre-approval`);
      return { needed: true, approvalTx: data.approval };
    }
    return { needed: false };
  } catch {
    return { needed: false };
  }
}

// ---------------------------------------------------------------------------
// encodeOpenPositionParams
// ABI-encode intent params for OPEN_POSITION:
//   (uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source)
// ---------------------------------------------------------------------------

export function encodeOpenPositionParams(
  amountUSDC: bigint,
  tickLower: number,
  tickUpper: number,
  swapCalldata: `0x${string}`,
  source: number
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters("uint256 amountUSDC, int24 tickLower, int24 tickUpper, bytes swapCalldata, uint8 source"),
    [amountUSDC, tickLower, tickUpper, swapCalldata, source]
  );
}

// ---------------------------------------------------------------------------
// encodeClosePositionParams
// ABI-encode intent params for CLOSE_POSITION:
//   (uint256 tokenId, bytes swapCalldata)
// ---------------------------------------------------------------------------

export function encodeClosePositionParams(
  tokenId: bigint,
  swapCalldata: `0x${string}`
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters("uint256 tokenId, bytes swapCalldata"),
    [tokenId, swapCalldata]
  );
}

// ---------------------------------------------------------------------------
// decodeOpenPositionParams
// Decode intent params for OPEN_POSITION from bytes
// ---------------------------------------------------------------------------

export function decodeOpenPositionParams(params: `0x${string}`): {
  amountUSDC: bigint;
  tickLower: number;
  tickUpper: number;
} {
  try {
    const decoded = decodeAbiParameters(
      [
        { name: "amountUSDC", type: "uint256" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
      ],
      params
    );
    return {
      amountUSDC: decoded[0] as bigint,
      tickLower: Number(decoded[1]),
      tickUpper: Number(decoded[2]),
    };
  } catch {
    return { amountUSDC: 0n, tickLower: 0, tickUpper: 0 };
  }
}
