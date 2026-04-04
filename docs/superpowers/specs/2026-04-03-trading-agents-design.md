# Trading Agents Design — Agent Arena

**Date:** 2026-04-03
**Project:** ETHGlobal Cannes 2026 — Agent Arena
**Scope:** Three autonomous OpenClaw trading agents on fly.io

---

## Overview

Three OpenClaw agents run on a single fly.io VM competing to manage Uniswap v3 liquidity on Sepolia. Each agent submits intents to a vault contract on 0G testnet. The vault tracks performance via Sharpe scores and allocates capital to the best-performing agent. Two agents are deliberately bad (for demo purposes); one is good.

---

## Architecture

```
fly.io VM (/data volume)
│
├── Process: openclaw-gateway (port 3000)
│   ├── agent-alpha  →  /data/workspaces/agent-alpha  (bad: passive, never rebalances)
│   ├── agent-beta   →  /data/workspaces/agent-beta   (bad: contrarian)
│   └── agent-gamma  →  /data/workspaces/agent-gamma  (good: disciplined rebalancer)
│
└── Process: cron-trigger
    └── /data/cron-trigger.js — fires every N seconds → WebSocket message to gateway

Per-agent loop:
  Cron fires → gateway routes message to agent
    → agent queries Subgraph MCP (pool price, ticks, open position)
    → Claude (LLM) reasons per AGENTS.md strategy
    → submit-intent skill: signs + sends vault.submitIntent() on 0G testnet
      → relayer picks up IntentQueued → executes on Sepolia via satellite
```

---

## fly.toml Changes

Two processes instead of one:

```toml
[processes]
  app  = "sh -c 'node openclaw.mjs config set gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback true && exec node openclaw.mjs gateway --allow-unconfigured --port 3000 --bind lan'"
  cron = "node /data/cron-trigger.js"

[[vm]]
  size   = "shared-cpu-2x"
  memory = "2048mb"
```

The `cron` process connects to `ws://localhost:3000` — same VM, no external hop.

---

## Agent Configuration (`/data/openclaw.json`)

```json
{
  "gateway": {
    "controlUi": { "dangerouslyAllowHostHeaderOriginFallback": true }
  },
  "agents": {
    "list": [
      { "id": "agent-alpha", "workspace": "/data/workspaces/agent-alpha" },
      { "id": "agent-beta",  "workspace": "/data/workspaces/agent-beta"  },
      { "id": "agent-gamma", "workspace": "/data/workspaces/agent-gamma" }
    ]
  }
}
```

---

## Workspace Structure

Each agent workspace at `/data/workspaces/agent-{name}/`:

```
agent-{name}/
├── AGENTS.md             ← strategy personality prompt
├── skills/
│   ├── query-pool.md     ← Subgraph MCP: fetch price, ticks, open position
│   └── submit-intent.md  ← sign + send vault.submitIntent() via ethers v6
└── .env                  ← AGENT_ID, VAULT_ADDRESS, PRIVATE_KEY_ENV_VAR name
```

---

## The Three Agents

### agent-alpha — Passive LP (bad)

**AGENTS.md strategy:**
> You are a passive liquidity provider. On your first action, open a position at the maximum possible tick range. Never close, modify, or rebalance it regardless of price movement. If you already have a position, always respond with "hold".

**Expected outcome:** Perpetually out of range → minimal fees → high impermanent loss → Sharpe → 0 → starved of capital → evicted after N bad epochs.

### agent-beta — Contrarian (bad)

**AGENTS.md strategy:**
> You are a contrarian trader. Always shift your liquidity range in the opposite direction of the most recent price movement. If price moved up, center your new range below current price. If price moved down, center above. Rebalance every epoch regardless of position.

**Expected outcome:** Perpetually chasing the wrong direction → always out of range → zero fee income → evicted.

### agent-gamma — Disciplined Rebalancer (good)

**AGENTS.md strategy:**
> You are a disciplined liquidity provider. Maintain a ±2% range centered on the current pool price. After each epoch, check if the current price has moved beyond 80% of your range boundary. If so, close the current position and open a new one centered on the current price. Otherwise, hold.

**Expected outcome:** Consistently in range → steady fee income → positive Sharpe → promoted to vault capital allocation.

---

## Skills

### `query-pool.md`

Calls the Subgraph MCP server with:
- Current pool price and tick
- Liquidity distribution around current tick
- Agent's open position (if any): tick range, liquidity, unrealized fees

Returns structured data the LLM uses for its decision.

### `submit-intent.md`

Uses ethers v6 to:
1. Read `AGENT_ID` and `VAULT_ADDRESS` from `.env`
2. Read private key from `process.env[PRIVATE_KEY_ENV_VAR]` (fly secret)
3. Construct and sign `vault.submitIntent(agentId, actionType, params)` on 0G testnet RPC
4. Return tx hash

No key material is written to disk or included in skill output.

---

## Cron Trigger (`/data/cron-trigger.js`)

~30-line Node.js script:

```
1. Connect to ws://localhost:3000 with gateway token
2. Every N seconds (epoch interval):
   a. Send trigger message to agent-alpha
   b. Send trigger message to agent-beta
   c. Send trigger message to agent-gamma
3. Log responses (agent decisions visible in fly logs)
```

Epoch interval matches the vault's `epochLength` (short for demo — a few seconds of blocks).

---

## Wallets

Three EOAs, one per agent. Private keys stored as fly secrets — never on disk:

```bash
fly secrets set AGENT_ALPHA_KEY=0x...
fly secrets set AGENT_BETA_KEY=0x...
fly secrets set AGENT_GAMMA_KEY=0x...
```

Each workspace `.env` specifies which env var name to read:
```
PRIVATE_KEY_ENV_VAR=AGENT_ALPHA_KEY
```

---

## LLM

All three agents use Claude (Anthropic API). The `ANTHROPIC_API_KEY` is set as a fly secret:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Strategy differentiation is entirely in `AGENTS.md` — same model, different instructions.

---

## Error Handling

- **Subgraph lag**: if MCP returns stale data (>2 blocks old), agent holds and logs a warning — no intent submitted that epoch
- **Insufficient credits**: vault rejects the intent with `insufficient credits` — agent logs and waits for next epoch
- **Cron connection failure**: cron-trigger retries with exponential backoff; gateway logs show missed epochs
- **RPC failure on 0G**: submit-intent retries once after 2s; on second failure, logs and skips epoch

---

## Out of Scope

- Subgraph MCP server implementation (separate component, priority #5 in build plan)
- Vault and satellite smart contracts (priority #1 and #2)
- Relayer script (priority #3)
- Dashboard (priority #8)
- Strategy sophistication beyond the three defined above
