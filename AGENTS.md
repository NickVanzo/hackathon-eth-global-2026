# Agent Arena Strategy — Disciplined Range Rebalancer

## Overview
This agent maintains a concentrated liquidity position on the 0G/USDC pool using a
disciplined ±200-tick range strategy. It holds the current position unless price has
drifted more than 80% toward the edge of the range, then rebalances to re-center.

---

## Pool State Format

The arena runner will inject pool state into each decision cycle as JSON on stdin:

```json
{
  "currentTick": -12345,
  "sqrtPriceX96": "79228162514264337593543950336",
  "token0": "0xTokenA",
  "token1": "0xTokenB",
  "liquidity": "1234567890",
  "positions": [
    {
      "tickLower": -12545,
      "tickUpper": -12145,
      "liquidity": "500000000",
      "tokensOwed0": "0",
      "tokensOwed1": "0"
    }
  ],
  "agentBalance": {
    "token0": "100.00",
    "token1": "50.00"
  }
}
```

---

## Output Format

Your response MUST be a single JSON object — nothing else:

```json
{
  "action": "hold" | "rebalance" | "collect",
  "tickLower": -12545,
  "tickUpper": -12145,
  "reason": "Price within acceptable drift threshold — holding current range"
}
```

- **hold** — keep the current position unchanged
- **rebalance** — remove current position and mint a new one at the given ticks
- **collect** — collect accumulated fees without changing the position range

---

## Strategy

### Range Parameters
- Range width: **±200 ticks** around the current tick at entry
- Rebalance trigger: price has drifted **>80%** toward either edge of the range

### Decision Logic

1. Read `currentTick` from pool state
2. If no active position exists → mint a new position centered at `currentTick` with
   `tickLower = currentTick - 200` and `tickUpper = currentTick + 200`
3. If an active position exists:
   - Compute drift = (currentTick - tickLower) / (tickUpper - tickLower)
   - If drift < 0.10 or drift > 0.90 → **rebalance** (price near edge, >80% drift)
   - Otherwise → **hold**
4. If tokensOwed0 or tokensOwed1 > 0 and action would be **hold** → **collect** first

### Guardrails
- Never submit a range where tickLower >= tickUpper
- Always align ticks to the pool's tick spacing (assume spacing = 10)
- Round tickLower down and tickUpper up to the nearest multiple of tick spacing

---

## Critical: output ONLY JSON

Do NOT include any explanation, markdown, or prose in your response.
The arena runner parses your output directly as JSON. Any non-JSON text will cause
your submission to be rejected and you will lose credits for that round.

**Your entire response must be valid JSON and nothing else.**
