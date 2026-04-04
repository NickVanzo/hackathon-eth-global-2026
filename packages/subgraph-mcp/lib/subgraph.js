"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchEthPrice = fetchEthPrice;
exports.fetchPoolVolume = fetchPoolVolume;
exports.fetchWhaleMovements = fetchWhaleMovements;
exports.fetchPoolPrice = fetchPoolPrice;
exports.fetchPoolTicks = fetchPoolTicks;
exports.fetchPoolFees = fetchPoolFees;
exports.fetchRecentSwaps = fetchRecentSwaps;
const config_js_1 = require("./config.js");
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
const SUBGRAPH_TIMEOUT_MS = 8000;
async function executeQuery(chain, query, variables = {}) {
    var _a;
    const subgraphUrl = (0, config_js_1.getChainSubgraphUrls)()[chain];
    const response = await fetch(subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(SUBGRAPH_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`The Graph returned HTTP ${response.status} for chain '${chain}'`);
    }
    const body = (await response.json());
    if ((_a = body.errors) === null || _a === void 0 ? void 0 : _a.length) {
        const messages = body.errors.map((e) => e.message).join("; ");
        throw new Error(`GraphQL errors: ${messages}`);
    }
    if (body.data == null) {
        throw new Error(`The Graph returned no data for chain '${chain}'`);
    }
    return body.data;
}
async function fetchEthPrice(chain) {
    return executeQuery(chain, ETH_PRICE_QUERY);
}
async function fetchPoolVolume(chain, poolId) {
    return executeQuery(chain, POOL_VOLUME_QUERY, { poolId });
}
async function fetchWhaleMovements(chain, poolId, minAmountUSD) {
    return executeQuery(chain, WHALE_MOVEMENTS_QUERY, {
        poolId,
        minAmountUSD,
    });
}
async function fetchPoolPrice(chain, poolId) {
    return executeQuery(chain, POOL_PRICE_QUERY, { poolId });
}
async function fetchPoolTicks(chain, poolId) {
    return executeQuery(chain, POOL_TICKS_QUERY, { poolId });
}
async function fetchPoolFees(chain, poolId) {
    return executeQuery(chain, POOL_FEES_QUERY, { poolId });
}
async function fetchRecentSwaps(chain, poolId, count) {
    return executeQuery(chain, RECENT_SWAPS_QUERY, {
        poolId,
        count,
    });
}
//# sourceMappingURL=subgraph.js.map