# Agent Arena — OpenClaw Setup (0G Team Review)

## Overview

Three autonomous OpenClaw agents running on a single fly.io VM, each in an isolated workspace. They compete to manage Uniswap v3 liquidity by submitting intents to a vault contract on 0G testnet.

---

## fly.io Setup

Single machine with two processes:

| Process | Role |
|---------|------|
| OpenClaw gateway | Hosts all 3 agents, exposes WebSocket on port 3000 |
| Cron trigger | Sends an "run epoch" message to each agent every N seconds |

Persistent volume at `/data` stores all agent workspaces and the gateway config.

---

## The Three Agents

Each agent is a separate OpenClaw workspace with its own:
- `AGENTS.md` — strategy personality (steers LLM reasoning)
- Skills — `query-pool` (Subgraph MCP) and `submit-intent` (0G Chain tx)
- EOA private key — used to sign `vault.submitIntent()` on 0G testnet

### Agent Alpha — "Passive LP"
- Opens the widest possible tick range on first trigger
- Never rebalances regardless of price movement
- Strategy prompt: *"You are a passive liquidity provider. Always deploy at the maximum tick range. Never close or modify positions."*
- Expected outcome: collects minimal fees, high impermanent loss → low Sharpe → starved of capital

### Agent Beta — "Contrarian"
- Always moves its range in the opposite direction of recent price movement
- Strategy prompt: *"You are a contrarian. When price moves up, shift your range down. When price moves down, shift your range up."*
- Expected outcome: perpetually out of range → zero fees → evicted after N bad epochs

### Agent Gamma — "Disciplined Rebalancer"
- Opens a ±2% range around current price
- Rebalances whenever price exits 80% of the current range
- Strategy prompt: *"Maintain a tight range around the current price. Rebalance whenever the price moves past 80% of your range boundary."*
- Expected outcome: consistently in range → fee income → positive Sharpe → promoted to vault capital

---

## Agent Loop (per epoch trigger)

```
Cron fires → gateway delivers message to agent
  → agent calls Subgraph MCP → gets current price, tick distribution, open position
  → Claude reasons about strategy (per AGENTS.md)
  → agent calls submit-intent skill
    → signs vault.submitIntent(agentId, action, params) on 0G testnet
      → relayer picks up IntentQueued event → executes on Sepolia Uniswap
```

---

## Questions for the 0G team

1. Is there a recommended way to configure multi-agent workspaces in OpenClaw? (bindings, `agents.list` in `openclaw.json`)
2. Can an OpenClaw skill call an external RPC directly (ethers v6 tx), or does it go through a built-in tool?
3. Any known issues running OpenClaw on fly.io with a persistent volume we should know about?
