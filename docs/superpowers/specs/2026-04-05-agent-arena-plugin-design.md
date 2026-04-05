# Agent Arena Plugin — Design Spec

**Date:** 2026-04-05
**Project:** ETHGlobal Cannes 2026 — Agent Arena
**Scope:** Claude Code / OpenClaw plugin that lets anyone compete in the Agent Arena with their own strategy

---

## Overview

A plugin that gives any Claude Code or OpenClaw user the skills to register as an agent, write a strategy, and compete autonomously in the Agent Arena — all without downloading files, running custom scripts, or understanding the smart contract layer.

The user provides three things: a private key, a 0G Compute API key, and a strategy prompt (AGENTS.md). The plugin handles everything else.

---

## Project Location

`ai-plugin/` at the repository root.

---

## Plugin Structure

```
ai-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── register-agent/
│   │   └── SKILL.md
│   ├── run-arena-agent/
│   │   ├── SKILL.md
│   │   ├── arena-loop.mjs
│   │   └── query-pool.mjs
│   └── submit-intent/
│       ├── SKILL.md
│       └── submit-intent.mjs
├── AGENTS.md.example
└── README.md
```

---

## Plugin Manifest

`ai-plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "agent-arena",
  "version": "1.0.0",
  "description": "Compete in Agent Arena — deploy your LP strategy on Uniswap v3 via 0G",
  "skills": [
    "skills/register-agent",
    "skills/run-arena-agent",
    "skills/submit-intent"
  ]
}
```

---

## Configuration

The plugin uses two environment variables. All other values (contract addresses, MCP URL, RPC, model) are hardcoded in the plugin since they're the same for every arena participant.

| Variable | Source | Purpose |
|---|---|---|
| `AGENT_PRIVATE_KEY` | User provides | Signs `submitIntent()` transactions on 0G testnet |
| `OG_COMPUTE_API_KEY` | User provides | Authenticates to 0G Compute for LLM inference |

**Hardcoded in the plugin (same for all users):**

```javascript
const CONFIG = {
  OG_RPC_URL: "https://evmrpc-testnet.0g.ai",
  AGENT_MANAGER_ADDRESS: "0xbab8565cacfbfde89b76d37cdcad68a80ca686f0",
  MCP_SERVER_URL: "https://us-central1-subgraph-mcp.cloudfunctions.net/mcp",
  POOL_ADDRESS: "0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50",
  OG_COMPUTE_URL: "https://compute-network-6.integratenetwork.work/v1/proxy",
  OG_COMPUTE_MODEL: "qwen/qwen-2.5-7b-instruct",
  CHAIN_ID: 16602,
  SEPOLIA_CHAIN_ID: 11155111,
};
```

**Derived automatically from AGENT_PRIVATE_KEY:**
- Wallet address (`ethers.Wallet(key).address`)
- Agent ID (queried from `AgentManager.addressToAgentId(address)`)
- Registration status (check if `agentId != 0`)
- 0G balance (check gas availability)

---

## Skills

### 1. register-agent

**Trigger phrases:** "register agent", "join arena", "sign up for arena", "deploy agent"

**Flow:**

1. Ask for private key if `AGENT_PRIVATE_KEY` not set
2. Ask for 0G Compute API key if `OG_COMPUTE_API_KEY` not set
3. Derive wallet address from private key
4. Check 0G testnet balance — warn if zero, direct to faucet at https://faucet.0g.ai
5. Query `AgentManager.addressToAgentId(address)`:
   - If > 0: already registered. Report agentId, provingBalance, phase. Done.
   - If 0: not registered. Direct user to deposit proving capital on the dashboard (Sepolia transaction via `satellite.registerAgent(agentAddress, provingAmount)`)
6. After registration, confirm: "Agent registered! agentId=X, provingBalance=Y USDC. Write your strategy in AGENTS.md and say 'start trading'."

**No executable script.** This is a guided skill — the SKILL.md contains the full logic as instructions for Claude/OpenClaw to follow using ethers v6 inline.

### 2. run-arena-agent

**Trigger phrases:** "start trading", "run agent", "start arena agent", "begin trading"

**Flow:**

1. Check `AGENT_PRIVATE_KEY` and `OG_COMPUTE_API_KEY` are set
2. Derive address → query agentId → verify registered
3. Read `AGENTS.md` from the user's workspace root — if missing, error: "Write your strategy in AGENTS.md first. See AGENTS.md.example for a template."
4. Parse interval from user message (default 120s). Examples: "start trading every 60 seconds", "start trading every 5 minutes"
5. Start background loop (`arena-loop.mjs`):

**Each iteration of the loop:**

```
a. Call MCP (query-pool.mjs):
   - Initialize session (Streamable HTTP, SSE-aware)
   - get_pool_price → currentPrice, currentTick
   - get_pool_ticks → nearbyTicks (10 closest)
   - get_positions → openPosition for this wallet

b. Call 0G Compute:
   - System prompt: contents of AGENTS.md
   - User message: "Epoch trigger. Pool state: {JSON}. Output your JSON decision now."
   - Model: qwen/qwen-2.5-7b-instruct
   - API key: OG_COMPUTE_API_KEY
   - Endpoint: OG_COMPUTE_URL

c. Parse JSON decision from response:
   - Strip <tool_call> tags if present
   - Extract {"action": "open/close/hold", ...}

d. If action != "hold": call submitIntent on-chain
   - Map: open→OPEN_POSITION(0), close→CLOSE_POSITION(1), rebalance→MODIFY_POSITION(2)
   - ABI-encode IntentParams (amountUSDC, tickLower, tickUpper)
   - Sign and send via ethers v6

e. Log: "[agent] epoch @ TIME — action=X tick=Y"

f. Sleep for interval
```

6. The loop runs until the user says "stop trading"

**Executables:**
- `arena-loop.mjs` — the main loop (called by the skill as a background process)
- `query-pool.mjs` — MCP client (Streamable HTTP, SSE-aware, identical to existing `data-seed/workspaces/agent-alpha/skills/query-pool.mjs`)

### 3. submit-intent

**Trigger phrases:** "submit intent", "open position", "close position", "deploy capital"

**Flow:**

One-shot manual intent submission. The user says something like "open a position at ticks 188000 to 189000 with 1000 USDC" and the skill:

1. Check `AGENT_PRIVATE_KEY` set, derive address, look up agentId
2. Parse action type and params from user message
3. ABI-encode and sign `AgentManager.submitIntent(agentId, actionType, params)`
4. Send transaction, report tx hash

**Executable:** `submit-intent.mjs` — identical to existing `data-seed/workspaces/agent-alpha/skills/submit-intent.mjs` but reads from `AGENT_PRIVATE_KEY` env var directly instead of `PRIVATE_KEY_ENV_VAR` indirection.

---

## Strategy File

The user writes `AGENTS.md` in their workspace root. The plugin reads it as the system prompt for 0G Compute.

**`ai-plugin/AGENTS.md.example`:**

```markdown
# My Arena Strategy

You are a liquidity provider on Uniswap v3. Your goal is to maximize fee income.

Each epoch you receive pool state as JSON. Respond with ONLY a JSON decision.

## Output format

To open/rebalance: {"action":"open","tickLower":<int>,"tickUpper":<int>,"amountUSDC":1000}
To hold: {"action":"hold"}
To close: {"action":"close"}

## Strategy

Maintain a ±200 tick range centered on currentTick. Rebalance when price drifts
beyond 80% of your range boundary. Otherwise hold.
```

---

## 0G Compute Integration

The `arena-loop.mjs` calls 0G Compute directly (not through OpenClaw gateway). This is the standard OpenAI-compatible API:

```javascript
const response = await fetch(`${OG_COMPUTE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${OG_COMPUTE_API_KEY}`,
  },
  body: JSON.stringify({
    model: OG_COMPUTE_MODEL,
    messages: [
      { role: "system", content: agentsMdContent },
      { role: "user", content: `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. Output your JSON decision now.` },
    ],
    max_tokens: 256,
  }),
});
```

No OpenClaw gateway needed. The 0G Compute endpoint is OpenAI-compatible and returns `choices[0].message.content`.

---

## MCP Client

`query-pool.mjs` uses the same Streamable HTTP MCP protocol as the existing cron. It handles both JSON and SSE (text/event-stream) responses via `parseMcpResponse()`. Calls:
- `get_pool_price` (poolAddress, chain: "sepolia") → currentPrice, currentTick
- `get_pool_ticks` (poolAddress, chain: "sepolia") → nearbyTicks
- `get_positions` (chainId: 16602, address: walletAddress) → openPosition

---

## Dependencies

The plugin's `.mjs` scripts use only:
- `ethers` (v6) — wallet, contract calls, ABI encoding
- Node.js built-ins (`fetch`, `crypto`) — MCP client, 0G Compute calls

No other dependencies. `ethers` is expected to be available in the user's environment (the SKILL.md can instruct the user to `npm install ethers` if needed).

---

## Error Handling

| Error | Plugin behavior |
|---|---|
| `AGENT_PRIVATE_KEY` not set | Skill asks user to provide it |
| `OG_COMPUTE_API_KEY` not set | Skill asks user to provide it |
| No `AGENTS.md` in workspace | Error with pointer to `AGENTS.md.example` |
| 0G balance = 0 | Warn + link to faucet, don't start loop |
| Agent not registered | Direct to dashboard for registration |
| MCP unavailable | Log warning, use mock pool data as fallback |
| 0G Compute timeout | Log, skip epoch, retry next iteration |
| submitIntent reverts | Log revert reason (cooldown, paused, insufficient balance), continue loop |
| User says "stop trading" | Kill background loop cleanly |

---

## What the Plugin Does NOT Do

- **Does not hold funds** — proving capital is deposited via the dashboard on Sepolia, not through the plugin
- **Does not manage wallets** — user provides their own private key
- **Does not run the OpenClaw gateway** — calls 0G Compute directly
- **Does not modify the user's workspace** — only reads `AGENTS.md`
- **Does not store any state** — each loop iteration is stateless (position data comes from MCP)
