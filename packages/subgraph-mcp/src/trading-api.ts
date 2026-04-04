/**
 * Proxies requests to the Uniswap Trading API.
 *
 * The MCP server acts as a secure proxy so that downstream agents never
 * see the API key. The key is read from `process.env.UNISWAP_API_KEY`
 * (a Firebase secret injected at runtime).
 *
 * Base URL: https://api.uniswap.org/v1
 */

const BASE_URL = "https://api.uniswap.org/v1";

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
 * Generic GET request to the Uniswap Trading API.
 *
 * - Reads the API key from the environment.
 * - Builds the URL with query parameters.
 * - Enforces an 8-second timeout via `AbortSignal.timeout`.
 * - Throws on non-2xx responses or GraphQL-style `errors` payloads.
 */
async function callTradingApi<T>(
  path: string,
  params: Record<string, string>
): Promise<T> {
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
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: string;
}

export async function fetchQuote(params: QuoteParams): Promise<QuoteResponse> {
  const qs: Record<string, string> = {
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
  return callTradingApi<QuoteResponse>("/quote", qs);
}

export interface RouteParams {
  tokenInChainId: string;
  tokenOutChainId: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: string;
}

export async function fetchRoute(params: RouteParams): Promise<RouteResponse> {
  const qs: Record<string, string> = {
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
  return callTradingApi<RouteResponse>("/route", qs);
}

export interface PoolsParams {
  chainId: string;
  token0Address?: string;
  token1Address?: string;
  fee?: string;
}

export async function fetchPools(params: PoolsParams): Promise<PoolsResponse> {
  const qs: Record<string, string> = {
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
  return callTradingApi<PoolsResponse>("/pools", qs);
}

export interface PositionsParams {
  chainId: string;
  address: string;
}

export async function fetchPositions(
  params: PositionsParams
): Promise<PositionsResponse> {
  return callTradingApi<PositionsResponse>("/positions", {
    chainId: params.chainId,
    address: params.address,
  });
}
