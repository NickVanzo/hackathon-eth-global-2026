# query-pool

Fetches current market data for the Uniswap v3 pool this agent is trading on.

Call this skill **once at the start of every epoch**, before making your LP decision.

## When to call

Always call `query-pool` first. Do not make a decision using stale data from the previous epoch.

## What it returns

A JSON object with:

```json
{
  "currentPrice": 1800.5,
  "previousPrice": 1797.3,
  "currentTick": 74959,
  "openPosition": {
    "tickLower": null,
    "tickUpper": null,
    "liquidity": null
  }
}
```

| Field | Description |
|---|---|
| `currentPrice` | Current price of token1 per token0 (e.g. WETH per USDC.e). Use this for range calculations. |
| `previousPrice` | Price at the previous epoch. Positive delta = price rose. |
| `currentTick` | The active Uniswap v3 tick. Compute `tickLower`/`tickUpper` as offsets from this. |
| `openPosition.tickLower` | Lower tick of your current open position, or `null` if no position. |
| `openPosition.tickUpper` | Upper tick of your current open position, or `null` if no position. |
| `openPosition.liquidity` | Liquidity units in your current position, or `null` if no position. |

## Data sources (via Subgraph MCP)

The data comes from two MCP tools:

- **`get_pool_price`** (`poolAddress`, `chain: "sepolia"`) — returns current tick and price ratio from slot0 (live RPC) with subgraph fallback
- **`get_pool_ticks`** (`poolAddress`, `chain: "sepolia"`) — returns tick array with `liquidityNet`/`liquidityGross` per tick, showing liquidity concentration

`get_pool_price` tries TheGraph subgraph first; falls back to direct Sepolia RPC (`slot0()`) if subgraph is unavailable or lagging.

## After calling

Use the returned pool state to apply your strategy from AGENTS.md, then output your JSON decision.
