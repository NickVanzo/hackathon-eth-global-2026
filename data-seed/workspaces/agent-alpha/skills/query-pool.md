---
name: query-pool
description: >
  Use when the user says "check pool", "get pool state", "query market data",
  "what's the current price", "check my position", or needs current Uniswap pool data.
---

# query-pool

Fetches current market data for the Uniswap v3 pool this agent is trading on.

Call this skill **once at the start of every epoch**, before making your LP decision.

## How to call

Use the `exec` tool to run:

```
node skills/query-pool.mjs
```

This prints a JSON object to stdout with the current pool state.

## When to call

Always call `query-pool` first. Do not make a decision using stale data from the previous epoch.

## What it returns

A JSON object with:

```json
{
  "currentPrice": 1800.5,
  "previousPrice": 1797.3,
  "currentTick": 74959,
  "nearbyTicks": [
    { "tickIdx": 74940, "liquidityNet": "120000000000", "liquidityGross": "120000000000" },
    { "tickIdx": 74960, "liquidityNet": "-80000000000", "liquidityGross": "80000000000" }
  ],
  "openPosition": {
    "tickLower": 74800,
    "tickUpper": 75100,
    "liquidity": "5000000000000",
    "uncollectedFees": { "token0": "1.23", "token1": "0.0005" }
  }
}
```

| Field | Description |
|---|---|
| `currentPrice` | Current price of token1 per token0 (e.g. WETH per USDC.e). Use this for range calculations. |
| `previousPrice` | Price at the previous epoch. Positive delta = price rose. `null` when called standalone (not via cron-trigger). |
| `currentTick` | The active Uniswap v3 tick. Compute `tickLower`/`tickUpper` as offsets from this. |
| `nearbyTicks` | Array of the 10 ticks closest to `currentTick`, each with `tickIdx`, `liquidityNet`, and `liquidityGross`. Use to gauge liquidity concentration around your intended range. |
| `openPosition.tickLower` | Lower tick of your current open position, or `null` if no position. |
| `openPosition.tickUpper` | Upper tick of your current open position, or `null` if no position. |
| `openPosition.liquidity` | Liquidity units in your current position, or `null` if no position. |
| `openPosition.uncollectedFees` | Fees earned but not yet collected, as `{ token0, token1 }` strings. Present when sourced from MCP; `null` otherwise. |

## Data sources (via Subgraph MCP)

Three MCP tools are called to build the pool state:

- **`get_pool_price`** (`poolAddress`, `chain: "sepolia"`) — returns current tick and price ratio from slot0 (live RPC) with subgraph fallback. **Used by query-pool.**
- **`get_pool_ticks`** (`poolAddress`, `chain: "sepolia"`) — returns tick array with `liquidityNet`/`liquidityGross` per tick; the 10 closest to `currentTick` are surfaced as `nearbyTicks`. **Used by query-pool.**
- **`get_positions`** (`ownerAddress`, `poolAddress`, `chain: "sepolia"`) — returns open LP positions with uncollected fees. **Used by query-pool.**

`get_pool_price` tries TheGraph subgraph first; falls back to direct Sepolia RPC (`slot0()`) if subgraph is unavailable or lagging.

### All 11 MCP tools (available for agent strategies)

**Subgraph tools** (pool/market data):

| Tool | Purpose |
|---|---|
| `get_pool_price` | Current tick + price ratio (used by query-pool) |
| `get_pool_ticks` | Tick array with liquidity per tick (used by query-pool) |
| `get_pool_fees` | Fee tier and fee growth data for the pool |
| `get_pool_volume` | Historical trading volume |
| `get_recent_swaps` | Recent swap events |
| `get_eth_macro_price` | ETH/USD price from a macro source |
| `get_whale_movements` | Large liquidity add/remove events |

**Trading API tools** (positions/routing):

| Tool | Purpose |
|---|---|
| `get_positions` | Open LP positions + uncollected fees (used by query-pool) |
| `get_quote` | Price quote for a given swap |
| `get_route` | Optimal swap route |
| `get_pools` | Pool discovery and metadata |

Tools marked **used by query-pool** are called automatically. The rest are available for strategy scripts that need deeper market context.

## After calling

Use the returned pool state to apply your strategy from AGENTS.md, then output your JSON decision.
