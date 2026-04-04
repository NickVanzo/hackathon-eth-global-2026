/**
 * Proxies requests to the Uniswap Trading API.
 *
 * The MCP server acts as a secure proxy so that downstream agents never
 * see the API key. The key is read from `process.env.UNISWAP_API_KEY`
 * (a Firebase secret injected at runtime).
 *
 * Base URL: https://trade-api.gateway.uniswap.org/v1
 */

const BASE_URL = "https://trade-api.gateway.uniswap.org/v1";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface QuoteResponse {
  routing: string;
  quote: unknown;
  permitData: unknown;
}

export interface RouteResponse {
  routing: string;
  quote: unknown;
}

export interface PoolsResponse {
  pools: unknown[];
}

export interface PositionsResponse {
  positions: unknown[];
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new Error(
      "UNISWAP_API_KEY is not set. Ensure the secret is configured in your Firebase environment."
    );
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
async function callTradingApi<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
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
    throw new Error(
      `Uniswap API ${path} returned ${response.status}: ${text}`
    );
  }

  const data = (await response.json()) as T & { errors?: unknown[] };

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(
      `Uniswap API ${path} returned errors: ${JSON.stringify(data.errors)}`
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export interface QuoteParams {
  tokenInChainId: string;
  tokenOutChainId: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  swapper: string;
  slippageTolerance?: string;
}

export async function fetchQuote(params: QuoteParams): Promise<QuoteResponse> {
  const body: Record<string, unknown> = {
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
  return callTradingApi<QuoteResponse>("/quote", body);
}

export interface RouteParams {
  tokenInChainId: string;
  tokenOutChainId: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  swapper: string;
  slippageTolerance?: string;
}

export async function fetchRoute(params: RouteParams): Promise<RouteResponse> {
  const body: Record<string, unknown> = {
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
  return callTradingApi<RouteResponse>("/route", body);
}

export interface PoolsParams {
  chainId: string;
  tokenIn?: string;
  tokenOut?: string;
  fee?: string;
}

export async function fetchPools(params: PoolsParams): Promise<PoolsResponse> {
  const body: Record<string, unknown> = {
    chainId: Number(params.chainId),
  };
  if (params.tokenIn !== undefined) body.tokenIn = params.tokenIn;
  if (params.tokenOut !== undefined) body.tokenOut = params.tokenOut;
  if (params.fee !== undefined) body.fee = params.fee;
  return callTradingApi<PoolsResponse>("/pools", body);
}

export interface PositionsParams {
  chainId: string;
  address: string;
}

export async function fetchPositions(
  params: PositionsParams
): Promise<PositionsResponse> {
  return callTradingApi<PositionsResponse>("/positions", {
    chainId: Number(params.chainId),
    address: params.address,
  });
}
