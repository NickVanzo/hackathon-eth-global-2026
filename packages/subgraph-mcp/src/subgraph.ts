import { getChainSubgraphUrls, type Chain } from "./config.js";

export type EthPriceData = {
  bundles: [{ ethPriceUSD: string }];
};

export type PoolToken = { symbol: string; decimals?: string };

export type PoolVolumeData = {
  pool: {
    volumeUSD: string;
    totalValueLockedUSD: string;
    token0: PoolToken;
    token1: PoolToken;
    feeTier: string;
  } | null;
};

export type Swap = {
  timestamp: string;
  amountUSD: string;
  amount0: string;
  amount1: string;
  sender: string;
};

export type WhaleMovementsData = {
  swaps: Swap[];
};

export type PoolPriceData = {
  pool: {
    token0Price: string;
    token1Price: string;
    token0: PoolToken;
    token1: PoolToken;
  } | null;
};

export type Tick = {
  tickIdx: string;
  liquidityNet: string;
  liquidityGross: string;
};

export type PoolTicksData = {
  ticks: Tick[];
};

export type PoolDayData = {
  date: number;
  feesUSD: string;
  volumeUSD: string;
};

export type PoolFeesData = {
  poolDayDatas: PoolDayData[];
};

export type RecentSwap = {
  timestamp: string;
  amountUSD: string;
  amount0: string;
  amount1: string;
  sender: string;
  origin: string;
};

export type RecentSwapsData = {
  swaps: RecentSwap[];
};

// Variables are used instead of string interpolation to prevent GraphQL injection.
// The Graph supports standard GraphQL variables for all scalar types including ID
// and BigDecimal.

const ETH_PRICE_QUERY = `
  query EthPrice {
    bundles(first: 1) {
      ethPriceUSD
    }
  }
`;

const POOL_VOLUME_QUERY = `
  query PoolVolume($poolId: ID!) {
    pool(id: $poolId) {
      volumeUSD
      totalValueLockedUSD
      token0 { symbol }
      token1 { symbol }
      feeTier
    }
  }
`;

const WHALE_MOVEMENTS_QUERY = `
  query WhaleMovements($poolId: ID!, $minAmountUSD: BigDecimal!) {
    swaps(
      where: { pool: $poolId, amountUSD_gt: $minAmountUSD }
      orderBy: timestamp
      orderDirection: desc
      first: 10
    ) {
      timestamp
      amountUSD
      amount0
      amount1
      sender
    }
  }
`;

const POOL_PRICE_QUERY = `
  query PoolPrice($poolId: ID!) {
    pool(id: $poolId) {
      token0Price
      token1Price
      token0 { symbol decimals }
      token1 { symbol decimals }
    }
  }
`;

const POOL_TICKS_QUERY = `
  query PoolTicks($poolId: String!) {
    ticks(
      where: { pool: $poolId }
      orderBy: tickIdx
      first: 100
    ) {
      tickIdx
      liquidityNet
      liquidityGross
    }
  }
`;

const POOL_FEES_QUERY = `
  query PoolFees($poolId: String!) {
    poolDayDatas(
      where: { pool: $poolId }
      orderBy: date
      orderDirection: desc
      first: 7
    ) {
      date
      feesUSD
      volumeUSD
    }
  }
`;

const RECENT_SWAPS_QUERY = `
  query RecentSwaps($poolId: String!, $count: Int!) {
    swaps(
      where: { pool: $poolId }
      orderBy: timestamp
      orderDirection: desc
      first: $count
    ) {
      timestamp
      amountUSD
      amount0
      amount1
      sender
      origin
    }
  }
`;

// Abort if The Graph hasn't responded within this window.
// Without a timeout, a hung connection occupies a concurrency slot indefinitely.
const SUBGRAPH_TIMEOUT_MS = 8_000;

type GraphQLVariables = Record<string, unknown>;

async function executeQuery<T>(
  chain: Chain,
  query: string,
  variables: GraphQLVariables = {}
): Promise<T> {
  const subgraphUrl = getChainSubgraphUrls()[chain];

  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`The Graph returned HTTP ${response.status} for chain '${chain}'`);
  }

  const body = (await response.json()) as {
    data?: T | null;
    errors?: { message: string }[];
  };

  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL errors: ${messages}`);
  }

  if (body.data == null) {
    throw new Error(`The Graph returned no data for chain '${chain}'`);
  }

  return body.data;
}

export async function fetchEthPrice(chain: Chain): Promise<EthPriceData> {
  return executeQuery<EthPriceData>(chain, ETH_PRICE_QUERY);
}

export async function fetchPoolVolume(
  chain: Chain,
  poolId: string
): Promise<PoolVolumeData> {
  return executeQuery<PoolVolumeData>(chain, POOL_VOLUME_QUERY, { poolId });
}

export async function fetchWhaleMovements(
  chain: Chain,
  poolId: string,
  minAmountUSD: string
): Promise<WhaleMovementsData> {
  return executeQuery<WhaleMovementsData>(chain, WHALE_MOVEMENTS_QUERY, {
    poolId,
    minAmountUSD,
  });
}

export async function fetchPoolPrice(
  chain: Chain,
  poolId: string
): Promise<PoolPriceData> {
  return executeQuery<PoolPriceData>(chain, POOL_PRICE_QUERY, { poolId });
}

export async function fetchPoolTicks(
  chain: Chain,
  poolId: string
): Promise<PoolTicksData> {
  return executeQuery<PoolTicksData>(chain, POOL_TICKS_QUERY, { poolId });
}

export async function fetchPoolFees(
  chain: Chain,
  poolId: string
): Promise<PoolFeesData> {
  return executeQuery<PoolFeesData>(chain, POOL_FEES_QUERY, { poolId });
}

export async function fetchRecentSwaps(
  chain: Chain,
  poolId: string,
  count: number
): Promise<RecentSwapsData> {
  return executeQuery<RecentSwapsData>(chain, RECENT_SWAPS_QUERY, {
    poolId,
    count,
  });
}
