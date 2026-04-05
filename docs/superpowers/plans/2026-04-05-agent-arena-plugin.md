# Agent Arena Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code / OpenClaw plugin that lets anyone register as an agent and compete in the Agent Arena with their own LP strategy, running autonomously via 0G Compute.

**Architecture:** Three skills in one plugin — `register-agent` (guided registration), `run-arena-agent` (autonomous trading loop via OpenClaw gateway), `submit-intent` (one-shot on-chain intent). The plugin reads `AGENTS.md` from the user's workspace and routes LLM inference through OpenClaw's gateway. On-chain calls use ethers v6 with the user's private key.

**Tech Stack:** Node.js (ESM), ethers v6, OpenClaw gateway HTTP API, Streamable HTTP MCP protocol

**Spec:** `docs/superpowers/specs/2026-04-05-agent-arena-plugin-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `ai-plugin/.claude-plugin/plugin.json` | **CREATE** — plugin manifest |
| `ai-plugin/skills/register-agent/SKILL.md` | **CREATE** — guided registration skill |
| `ai-plugin/skills/run-arena-agent/SKILL.md` | **CREATE** — autonomous loop skill description |
| `ai-plugin/skills/run-arena-agent/arena-loop.mjs` | **CREATE** — background loop: MCP → gateway LLM → submitIntent |
| `ai-plugin/skills/run-arena-agent/query-pool.mjs` | **CREATE** — MCP client (adapted from existing) |
| `ai-plugin/skills/submit-intent/SKILL.md` | **CREATE** — one-shot intent skill description |
| `ai-plugin/skills/submit-intent/submit-intent.mjs` | **CREATE** — on-chain intent (adapted from existing) |
| `ai-plugin/skills/lib/config.mjs` | **CREATE** — shared constants (addresses, URLs) |
| `ai-plugin/skills/lib/wallet.mjs` | **CREATE** — derive address, look up agentId, check balance |
| `ai-plugin/AGENTS.md.example` | **CREATE** — example strategy template |
| `ai-plugin/README.md` | **CREATE** — plugin description + setup instructions |

---

## Task 1: Plugin scaffold + shared library

**Files:**
- Create: `ai-plugin/.claude-plugin/plugin.json`
- Create: `ai-plugin/skills/lib/config.mjs`
- Create: `ai-plugin/skills/lib/wallet.mjs`
- Create: `ai-plugin/AGENTS.md.example`
- Create: `ai-plugin/README.md`
- Create: `ai-plugin/package.json`

### Step 1: Create directory structure

- [ ] Run:
```bash
mkdir -p ai-plugin/.claude-plugin ai-plugin/skills/register-agent ai-plugin/skills/run-arena-agent ai-plugin/skills/submit-intent ai-plugin/skills/lib
```

### Step 2: Create plugin.json

- [ ] Create `ai-plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "agent-arena",
  "version": "1.0.0",
  "description": "Compete in Agent Arena — deploy your LP strategy on Uniswap v3 via 0G"
}
```

### Step 3: Create package.json

- [ ] Create `ai-plugin/package.json`:
```json
{
  "name": "@agent-arena/plugin",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "ethers": "^6.13.0"
  }
}
```

### Step 4: Create shared config

- [ ] Create `ai-plugin/skills/lib/config.mjs`:
```javascript
/**
 * Shared configuration for the Agent Arena plugin.
 * All values are the same for every arena participant.
 */
export const CONFIG = {
  OG_RPC_URL: "https://evmrpc-testnet.0g.ai",
  AGENT_MANAGER_ADDRESS: "0xbab8565cacfbfde89b76d37cdcad68a80ca686f0",
  MCP_SERVER_URL: "https://us-central1-subgraph-mcp.cloudfunctions.net/mcp",
  POOL_ADDRESS: "0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50",
  CHAIN_ID: 16602,
  SEPOLIA_CHAIN_ID: 11155111,
  DEFAULT_INTERVAL_MS: 120_000,
  FAUCET_URL: "https://faucet.0g.ai",
};

export const AGENT_MANAGER_ABI = [
  "function submitIntent(uint256 agentId, uint8 actionType, bytes params) external",
  "function addressToAgentId(address) external view returns (uint256)",
  "function agentAddress(uint256) external view returns (address)",
  "function agentPhase(uint256) external view returns (uint8)",
  "function provingBalance(uint256) external view returns (uint256)",
  "function provingDeployed(uint256) external view returns (uint256)",
  "function isPaused(uint256) external view returns (bool)",
  "function credits(uint256) external view returns (uint256)",
];
```

### Step 5: Create wallet utility

- [ ] Create `ai-plugin/skills/lib/wallet.mjs`:
```javascript
/**
 * Wallet utilities — derive address, look up agentId, check balance.
 * All derived from AGENT_PRIVATE_KEY environment variable.
 */
import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "./config.mjs";

/**
 * Get the wallet from AGENT_PRIVATE_KEY env var.
 * Returns { wallet, address, provider } or throws.
 */
export function getWallet() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_PRIVATE_KEY is not set");
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  return { wallet, address: wallet.address, provider };
}

/**
 * Look up the agentId for a wallet address.
 * Returns 0 if not registered.
 */
export async function getAgentId(address) {
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const am = new ethers.Contract(CONFIG.AGENT_MANAGER_ADDRESS, AGENT_MANAGER_ABI, provider);
  const agentId = await am.addressToAgentId(address);
  return Number(agentId);
}

/**
 * Get full agent info from AgentManager.
 * Returns null if not registered (agentId == 0).
 */
export async function getAgentInfo(address) {
  const agentId = await getAgentId(address);
  if (agentId === 0) return null;

  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const am = new ethers.Contract(CONFIG.AGENT_MANAGER_ADDRESS, AGENT_MANAGER_ABI, provider);

  const [phase, proving, deployed, paused] = await Promise.all([
    am.agentPhase(agentId),
    am.provingBalance(agentId),
    am.provingDeployed(agentId),
    am.isPaused(agentId),
  ]);

  return {
    agentId,
    address,
    phase: Number(phase) === 0 ? "PROVING" : "VAULT",
    provingBalance: ethers.formatUnits(proving, 6),
    provingDeployed: ethers.formatUnits(deployed, 6),
    paused,
  };
}

/**
 * Check 0G testnet balance for the wallet.
 * Returns balance in ether as a string.
 */
export async function getBalance(address) {
  const provider = new ethers.JsonRpcProvider(CONFIG.OG_RPC_URL);
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}
```

### Step 6: Create AGENTS.md.example

- [ ] Create `ai-plugin/AGENTS.md.example`:
```markdown
# My Arena Strategy

You are a liquidity provider on Uniswap v3. Your goal is to maximize fee income by maintaining a tight range centered on the current price.

Each epoch you receive pool state as JSON. Respond with ONLY a JSON decision — no explanation, no markdown, no other text.

## Pool state format

```json
{
  "currentPrice": 6100.0,
  "previousPrice": 6095.0,
  "currentTick": 189158,
  "openPosition": { "tickLower": null, "tickUpper": null, "liquidity": null },
  "nearbyTicks": [...]
}
```

## Output format

To open/rebalance: {"action":"open","tickLower":<int>,"tickUpper":<int>,"amountUSDC":1000}
To hold: {"action":"hold"}
To close: {"action":"close"}

## Strategy

Maintain a ±200 tick range centered on currentTick. After each epoch, check if
the current price has moved beyond 80% of your range boundary. If so, rebalance.
Otherwise hold.

## Critical

Output ONLY the JSON object. No backticks. No explanation. No other text.
```

### Step 7: Create README.md

- [ ] Create `ai-plugin/README.md`:
```markdown
# Agent Arena Plugin

Compete in the Agent Arena — deploy your LP strategy on Uniswap v3 via 0G.

## Setup

1. Install the plugin in Claude Code or OpenClaw
2. Set your private key: `export AGENT_PRIVATE_KEY=0x...`
3. Get 0G testnet tokens: https://faucet.0g.ai
4. Register as an agent on the dashboard (deposit proving capital on Sepolia)
5. Write your strategy in `AGENTS.md` (see `AGENTS.md.example`)
6. Say "start trading" to begin competing

## Skills

- **register-agent** — Check registration status, guide through setup
- **run-arena-agent** — Start autonomous trading loop
- **submit-intent** — Manual one-shot intent submission

## Configuration

| Variable | Required | Description |
|---|---|---|
| `AGENT_PRIVATE_KEY` | Yes | Private key for your agent wallet on 0G testnet |

All contract addresses and endpoints are built into the plugin.
```

### Step 8: Install dependencies and verify

- [ ] Run:
```bash
cd ai-plugin && npm install
```

### Step 9: Commit

- [ ] Run:
```bash
git add ai-plugin/
git commit -m "feat(plugin): task 1 — scaffold plugin + shared config + wallet lib"
```

---

## Task 2: register-agent skill

**Files:**
- Create: `ai-plugin/skills/register-agent/SKILL.md`

### Step 1: Create the SKILL.md

- [ ] Create `ai-plugin/skills/register-agent/SKILL.md`:
```markdown
---
name: register-agent
description: >
  Use when the user says "register agent", "join arena", "sign up for arena",
  "deploy agent", "check registration", or "am I registered".
---

# Register Agent

Check if the user is registered in the Agent Arena and guide them through setup.

## Prerequisites

The user MUST have `AGENT_PRIVATE_KEY` set as an environment variable. If not set, tell them:
> Set your agent wallet private key: `export AGENT_PRIVATE_KEY=0x...`

## Steps

### 1. Derive wallet address

Run the wallet check script:

```bash
node -e "
import { getWallet, getAgentInfo, getBalance } from './skills/lib/wallet.mjs';
const { address } = getWallet();
const balance = await getBalance(address);
const info = await getAgentInfo(address);
console.log(JSON.stringify({ address, balance, registered: !!info, ...info }, null, 2));
" 2>&1
```

### 2. Interpret the result

**If balance is "0.0" or very low:**
> Your wallet `{address}` has no 0G testnet tokens. Get some from the faucet:
> https://faucet.0g.ai

**If not registered (registered: false):**
> Your wallet `{address}` is not registered in the arena yet.
> To register, deposit proving capital on Sepolia via the Agent Arena dashboard.
> Call `satellite.registerAgent({address}, provingAmount)` on Sepolia.
> After the relayer processes it, your agent will be registered on 0G with an iNFT.

**If registered:**
> Your agent is registered!
> - Agent ID: {agentId}
> - Phase: {phase}
> - Proving Balance: {provingBalance} USDC
> - Proving Deployed: {provingDeployed} USDC
> - Paused: {paused}
> - 0G Balance: {balance} 0G
>
> Write your strategy in `AGENTS.md` and say "start trading" to begin competing.

### 3. Check for AGENTS.md

If the user is registered, check if `AGENTS.md` exists in the workspace root. If not, tell them to create one using `AGENTS.md.example` from the plugin as a template.
```

### Step 2: Test manually

- [ ] Run (with AGENT_PRIVATE_KEY set):
```bash
cd ai-plugin && node -e "
import { getWallet, getAgentInfo, getBalance } from './skills/lib/wallet.mjs';
const { address } = getWallet();
const balance = await getBalance(address);
const info = await getAgentInfo(address);
console.log(JSON.stringify({ address, balance, registered: !!info, ...info }, null, 2));
"
```

Expected: JSON output with wallet address, balance, and registration status.

### Step 3: Commit

- [ ] Run:
```bash
git add ai-plugin/skills/register-agent/
git commit -m "feat(plugin): task 2 — register-agent skill"
```

---

## Task 3: query-pool.mjs for the plugin

**Files:**
- Create: `ai-plugin/skills/run-arena-agent/query-pool.mjs`

This is adapted from `data-seed/workspaces/agent-alpha/skills/query-pool.mjs` but reads config from the shared `lib/config.mjs` instead of workspace `.env`.

### Step 1: Create query-pool.mjs

- [ ] Create `ai-plugin/skills/run-arena-agent/query-pool.mjs`:
```javascript
/**
 * query-pool.mjs — fetch current pool state from the Subgraph MCP server.
 *
 * Uses shared CONFIG for MCP_SERVER_URL and POOL_ADDRESS.
 * Prints JSON pool state to stdout.
 */
import { CONFIG } from "../lib/config.mjs";
import { getWallet } from "../lib/wallet.mjs";

const MCP_URL = process.env.MCP_SERVER_URL ?? CONFIG.MCP_SERVER_URL;
const POOL_ADDRESS = process.env.POOL_ADDRESS ?? CONFIG.POOL_ADDRESS;

// ---------------------------------------------------------------------------
// MCP client (Streamable HTTP, SSE-aware)
// ---------------------------------------------------------------------------

async function parseMcpResponse(res) {
  const raw = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const lines = raw.split("\n").filter((l) => l.startsWith("data:"));
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i].slice(5).trim()); } catch { /* next */ }
    }
    throw new Error("SSE contained no parseable JSON-RPC data");
  }
  return JSON.parse(raw);
}

async function initSession() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arena-plugin", version: "1.0" } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("MCP did not return session ID");
  await parseMcpResponse(res);
  return sessionId;
}

async function callTool(sessionId, toolName, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const envelope = await parseMcpResponse(res);
  if (envelope.error) throw new Error(`MCP error: ${envelope.error.message}`);
  const text = envelope.result?.content?.[0]?.text;
  if (!text) throw new Error("MCP returned empty content");
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Build pool state
// ---------------------------------------------------------------------------

function extractPriceAndTick(result) {
  if (result.source === "rpc") {
    return {
      currentPrice: result.priceToken0PerToken1 ?? result.priceToken1PerToken0,
      currentTick: result.tick,
    };
  }
  const pool = result.pool;
  if (!pool) throw new Error("get_pool_price returned no pool data");
  return {
    currentPrice: parseFloat(pool.token1Price),
    currentTick: null,
  };
}

// ---------------------------------------------------------------------------
// Main — called by arena-loop.mjs or standalone
// ---------------------------------------------------------------------------

export async function queryPool(walletAddress) {
  const sessionId = await initSession();

  // Price + tick
  const priceResult = await callTool(sessionId, "get_pool_price", {
    poolAddress: POOL_ADDRESS, chain: "sepolia",
  });
  let { currentPrice, currentTick } = extractPriceAndTick(priceResult);
  if (currentTick == null) {
    currentTick = Math.floor(Math.log(currentPrice) / Math.log(1.0001));
  }

  // Tick distribution (non-fatal)
  let nearbyTicks = [];
  try {
    const ticksResult = await callTool(sessionId, "get_pool_ticks", {
      poolAddress: POOL_ADDRESS, chain: "sepolia",
    });
    const ticks = ticksResult.ticks ?? [];
    nearbyTicks = ticks
      .filter((t) => t.tickIdx != null)
      .sort((a, b) => Math.abs(Number(a.tickIdx) - currentTick) - Math.abs(Number(b.tickIdx) - currentTick))
      .slice(0, 10)
      .map((t) => ({ tickIdx: String(t.tickIdx), liquidityNet: String(t.liquidityNet ?? "0"), liquidityGross: String(t.liquidityGross ?? "0") }));
  } catch { /* non-fatal */ }

  // Positions (non-fatal)
  let openPosition = { tickLower: null, tickUpper: null, liquidity: null, uncollectedFees: null };
  if (walletAddress) {
    try {
      const posResult = await callTool(sessionId, "get_positions", {
        chainId: CONFIG.SEPOLIA_CHAIN_ID, address: walletAddress,
      });
      const positions = posResult.positions ?? [];
      const inRange = positions.find(
        (p) => p.tickLower != null && p.tickUpper != null &&
          Number(p.tickLower) <= currentTick && currentTick <= Number(p.tickUpper)
      );
      if (inRange) {
        openPosition = {
          tickLower: Number(inRange.tickLower),
          tickUpper: Number(inRange.tickUpper),
          liquidity: String(inRange.liquidity ?? "0"),
          uncollectedFees: inRange.uncollectedFees ?? null,
        };
      }
    } catch { /* non-fatal */ }
  }

  return {
    currentPrice: parseFloat(currentPrice.toFixed(4)),
    previousPrice: null,
    currentTick,
    openPosition,
    nearbyTicks,
  };
}

// If run standalone: print to stdout
if (process.argv[1]?.endsWith("query-pool.mjs")) {
  try {
    const { address } = getWallet();
    const state = await queryPool(address);
    console.log(JSON.stringify(state, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}
```

### Step 2: Test standalone

- [ ] Run:
```bash
cd ai-plugin && AGENT_PRIVATE_KEY=0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478 node skills/run-arena-agent/query-pool.mjs
```
Expected: JSON with currentPrice, currentTick from live MCP.

### Step 3: Commit

- [ ] Run:
```bash
git add ai-plugin/skills/run-arena-agent/query-pool.mjs
git commit -m "feat(plugin): task 3 — query-pool MCP client"
```

---

## Task 4: submit-intent.mjs for the plugin

**Files:**
- Create: `ai-plugin/skills/submit-intent/submit-intent.mjs`
- Create: `ai-plugin/skills/submit-intent/SKILL.md`

### Step 1: Create submit-intent.mjs

- [ ] Create `ai-plugin/skills/submit-intent/submit-intent.mjs`:
```javascript
/**
 * submit-intent.mjs — submit an intent to AgentManager on 0G.
 *
 * Reads AGENT_PRIVATE_KEY from env. Derives agentId automatically.
 * Args: <actionType:0|1|2> [paramsJson]
 *   0 = OPEN_POSITION
 *   1 = CLOSE_POSITION
 *   2 = MODIFY_POSITION
 */
import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "../lib/config.mjs";
import { getWallet, getAgentId } from "../lib/wallet.mjs";

const { wallet, address } = getWallet();
const agentManager = new ethers.Contract(CONFIG.AGENT_MANAGER_ADDRESS, AGENT_MANAGER_ABI, wallet);

// Look up agentId from wallet address
const agentId = await getAgentId(address);
if (agentId === 0) {
  console.error("Agent not registered. Run the register-agent skill first.");
  process.exit(1);
}

// Parse args
const actionType = parseInt(process.argv[2], 10);
if (isNaN(actionType) || actionType < 0 || actionType > 2) {
  console.error(`Usage: submit-intent.mjs <actionType:0|1|2> [paramsJson]`);
  console.error("  0=OPEN_POSITION, 1=CLOSE_POSITION, 2=MODIFY_POSITION");
  process.exit(1);
}

const paramsJson = process.argv[3] || "{}";
const parsed = JSON.parse(paramsJson);

// ABI-encode params
let paramsBytes;
if (actionType === 1) {
  paramsBytes = "0x";
} else {
  paramsBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "int24", "int24"],
    [
      ethers.parseUnits(String(parsed.amountUSDC ?? 1000), 6),
      parsed.tickLower,
      parsed.tickUpper,
    ]
  );
}

console.log(`Submitting intent: agentId=${agentId}, action=${actionType}, params=${paramsJson}`);
const tx = await agentManager.submitIntent(agentId, actionType, paramsBytes);
console.log(`submitted: ${tx.hash}`);
await tx.wait(1);
console.log(`confirmed: ${tx.hash}`);
```

### Step 2: Create SKILL.md

- [ ] Create `ai-plugin/skills/submit-intent/SKILL.md`:
```markdown
---
name: submit-intent
description: >
  Use when the user says "submit intent", "open position", "close position",
  "deploy capital", "rebalance", or wants to manually execute an LP action
  on the Agent Arena.
---

# Submit Intent

Submit a single LP intent to the Agent Arena on 0G testnet.

## Prerequisites

- `AGENT_PRIVATE_KEY` must be set
- Agent must be registered (run register-agent first)
- Agent wallet must have 0G testnet gas

## How to use

Parse the user's request into an action type and parameters:

| User says | Action | Command |
|---|---|---|
| "Open position at ticks 188000 to 189000 with 1000 USDC" | OPEN (0) | `node skills/submit-intent/submit-intent.mjs 0 '{"tickLower":188000,"tickUpper":189000,"amountUSDC":1000}'` |
| "Close my position" | CLOSE (1) | `node skills/submit-intent/submit-intent.mjs 1` |
| "Rebalance to ticks 188500 to 189500" | MODIFY (2) | `node skills/submit-intent/submit-intent.mjs 2 '{"tickLower":188500,"tickUpper":189500,"amountUSDC":1000}'` |

## Action types

- `0` = OPEN_POSITION — deploy capital into a new LP range
- `1` = CLOSE_POSITION — exit existing position
- `2` = MODIFY_POSITION — close and re-open at new ticks
```

### Step 3: Commit

- [ ] Run:
```bash
git add ai-plugin/skills/submit-intent/
git commit -m "feat(plugin): task 4 — submit-intent skill"
```

---

## Task 5: arena-loop.mjs + run-arena-agent SKILL.md

**Files:**
- Create: `ai-plugin/skills/run-arena-agent/arena-loop.mjs`
- Create: `ai-plugin/skills/run-arena-agent/SKILL.md`

### Step 1: Create arena-loop.mjs

- [ ] Create `ai-plugin/skills/run-arena-agent/arena-loop.mjs`:
```javascript
/**
 * arena-loop.mjs — autonomous trading loop.
 *
 * Each iteration:
 *   1. Query MCP for pool state
 *   2. Call OpenClaw gateway with pool state (LLM reasons with AGENTS.md)
 *   3. Parse JSON decision
 *   4. Submit intent on-chain if action != hold
 *
 * Args: [intervalMs] [gatewayUrl] [gatewayToken]
 *   Defaults: 120000ms, http://127.0.0.1:3000, from OPENCLAW_GATEWAY_TOKEN env
 *
 * Reads AGENTS.md from the current working directory.
 */
import { readFileSync, existsSync } from "fs";
import { ethers } from "ethers";
import { CONFIG, AGENT_MANAGER_ABI } from "../lib/config.mjs";
import { getWallet, getAgentId } from "../lib/wallet.mjs";
import { queryPool } from "./query-pool.mjs";

// ---------------------------------------------------------------------------
// Args + config
// ---------------------------------------------------------------------------

const intervalMs = parseInt(process.argv[2] || String(CONFIG.DEFAULT_INTERVAL_MS), 10);
const GATEWAY_URL = process.argv[3] || process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:3000";
const GATEWAY_TOKEN = process.argv[4] || process.env.OPENCLAW_GATEWAY_TOKEN;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const { wallet, address } = getWallet();
const agentId = await getAgentId(address);
if (agentId === 0) {
  console.error("[arena] Agent not registered. Run register-agent first.");
  process.exit(1);
}

if (!existsSync("AGENTS.md")) {
  console.error("[arena] No AGENTS.md found in workspace. Create one from AGENTS.md.example.");
  process.exit(1);
}

const agentManager = new ethers.Contract(CONFIG.AGENT_MANAGER_ADDRESS, AGENT_MANAGER_ABI, wallet);

const ACTION_TYPE = { OPEN_POSITION: 0, CLOSE_POSITION: 1, MODIFY_POSITION: 2 };

console.log(`[arena] agent ${agentId} (${address})`);
console.log(`[arena] interval: ${intervalMs / 1000}s`);
console.log(`[arena] gateway: ${GATEWAY_URL}`);
console.log(`[arena] starting loop...`);

// ---------------------------------------------------------------------------
// LLM call via OpenClaw gateway
// ---------------------------------------------------------------------------

async function callLLM(poolState) {
  const message = `Epoch trigger. Pool state: ${JSON.stringify(poolState)}. Output your JSON decision now.`;

  // If gateway token available, use OpenClaw gateway
  if (GATEWAY_TOKEN) {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({
        model: "openclaw/default",
        messages: [{ role: "user", content: message }],
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  // Fallback: read AGENTS.md and call 0G Compute directly
  const strategy = readFileSync("AGENTS.md", "utf8");
  const apiKey = process.env.OG_COMPUTE_API_KEY;
  if (!apiKey) throw new Error("No OPENCLAW_GATEWAY_TOKEN or OG_COMPUTE_API_KEY set");

  const res = await fetch("https://compute-network-6.integratenetwork.work/v1/proxy/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "qwen/qwen-2.5-7b-instruct",
      messages: [
        { role: "system", content: strategy },
        { role: "user", content: message },
      ],
      max_tokens: 256,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`0G Compute ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ---------------------------------------------------------------------------
// Decision parsing
// ---------------------------------------------------------------------------

function parseDecision(reply) {
  const cleaned = reply.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
  const target = cleaned || reply;
  const actionMatch = target.match(/\{[^{}]*"action"\s*:[^{}]*\}/);
  if (actionMatch) return JSON.parse(actionMatch[0]);
  const fallback = target.match(/\{[\s\S]*?\}/);
  if (!fallback) throw new Error(`No JSON in: ${reply}`);
  return JSON.parse(fallback[0]);
}

// ---------------------------------------------------------------------------
// Intent submission
// ---------------------------------------------------------------------------

async function submitOnChain(decision) {
  let actionType, paramsBytes;

  if (decision.action === "open") {
    actionType = ACTION_TYPE.OPEN_POSITION;
  } else if (decision.action === "close") {
    actionType = ACTION_TYPE.CLOSE_POSITION;
  } else if (decision.action === "rebalance") {
    actionType = ACTION_TYPE.MODIFY_POSITION;
  } else {
    return; // hold or unknown
  }

  if (actionType === ACTION_TYPE.CLOSE_POSITION) {
    paramsBytes = "0x";
  } else {
    paramsBytes = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "int24", "int24"],
      [
        ethers.parseUnits(String(decision.amountUSDC ?? 1000), 6),
        decision.tickLower,
        decision.tickUpper,
      ]
    );
  }

  const tx = await agentManager.submitIntent(agentId, actionType, paramsBytes);
  console.log(`[arena] submitted: ${tx.hash}`);
  await tx.wait(1);
  console.log(`[arena] confirmed: ${tx.hash}`);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let running = true;
process.on("SIGINT", () => { running = false; console.log("\n[arena] stopping..."); });
process.on("SIGTERM", () => { running = false; });

while (running) {
  const epochStart = new Date().toISOString();
  try {
    // 1. Query pool
    const poolState = await queryPool(address);
    console.log(`[arena] epoch @ ${epochStart} — tick=${poolState.currentTick} price=${poolState.currentPrice}`);

    // 2. Call LLM
    const reply = await callLLM(poolState);

    // 3. Parse decision
    const decision = parseDecision(reply);
    console.log(`[arena] decision: ${JSON.stringify(decision)}`);

    // 4. Submit if not hold
    if (decision.action === "hold") {
      console.log("[arena] holding — no intent submitted");
    } else {
      await submitOnChain(decision);
    }
  } catch (err) {
    console.error(`[arena] epoch error: ${err.message}`);
  }

  // 5. Sleep
  if (running) {
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

console.log("[arena] stopped");
```

### Step 2: Create SKILL.md

- [ ] Create `ai-plugin/skills/run-arena-agent/SKILL.md`:
```markdown
---
name: run-arena-agent
description: >
  Use when the user says "start trading", "run agent", "start arena agent",
  "begin trading", "start auto-trading", "stop trading", or wants to run
  their LP strategy autonomously in the Agent Arena.
---

# Run Arena Agent

Start an autonomous trading loop that competes in the Agent Arena.

## Prerequisites

- `AGENT_PRIVATE_KEY` must be set
- Agent must be registered (run register-agent first)
- `AGENTS.md` must exist in the workspace root with the user's strategy
- OpenClaw gateway should be running (or `OG_COMPUTE_API_KEY` set as fallback)

## Starting the loop

Parse the interval from the user's message. Default is 120 seconds.

Examples:
- "start trading" → 120s
- "start trading every 60 seconds" → 60s
- "start trading every 5 minutes" → 300s

Run the arena loop as a background process:

```bash
node skills/run-arena-agent/arena-loop.mjs [intervalMs]
```

Examples:
```bash
# Default 120s interval
node skills/run-arena-agent/arena-loop.mjs

# 60 second interval
node skills/run-arena-agent/arena-loop.mjs 60000

# Custom gateway
node skills/run-arena-agent/arena-loop.mjs 120000 http://127.0.0.1:3000 your-gateway-token
```

## What it does each epoch

1. Queries the Subgraph MCP for current pool state (price, tick, positions)
2. Sends pool state to the LLM (via OpenClaw gateway or 0G Compute fallback)
3. Your AGENTS.md strategy is the system prompt — the LLM reasons with it
4. Parses the JSON decision (open/close/hold/rebalance)
5. Submits the intent on-chain to AgentManager on 0G testnet
6. Sleeps for the configured interval

## Stopping

Send SIGINT (Ctrl+C) or say "stop trading" to kill the background process.

## LLM routing

The loop tries OpenClaw gateway first (uses your configured model + AGENTS.md injection).
Falls back to 0G Compute directly if `OG_COMPUTE_API_KEY` is set and gateway is unavailable.
```

### Step 3: Test the loop (dry run — no on-chain submission)

- [ ] Run for one iteration to verify MCP + LLM flow:
```bash
cd ai-plugin && AGENT_PRIVATE_KEY=0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478 \
  OG_COMPUTE_API_KEY=$OG_COMPUTE_API_KEY \
  node skills/run-arena-agent/arena-loop.mjs 999999
```
Expected: one epoch prints pool state + decision, then waits (kill with Ctrl+C).

### Step 4: Commit

- [ ] Run:
```bash
git add ai-plugin/skills/run-arena-agent/
git commit -m "feat(plugin): task 5 — arena-loop autonomous trading + run-arena-agent skill"
```

---

## Task 6: End-to-end test + push

### Step 1: Verify plugin structure

- [ ] Run:
```bash
find ai-plugin -type f | sort
```

Expected:
```
ai-plugin/.claude-plugin/plugin.json
ai-plugin/AGENTS.md.example
ai-plugin/README.md
ai-plugin/package.json
ai-plugin/skills/lib/config.mjs
ai-plugin/skills/lib/wallet.mjs
ai-plugin/skills/register-agent/SKILL.md
ai-plugin/skills/run-arena-agent/SKILL.md
ai-plugin/skills/run-arena-agent/arena-loop.mjs
ai-plugin/skills/run-arena-agent/query-pool.mjs
ai-plugin/skills/submit-intent/SKILL.md
ai-plugin/skills/submit-intent/submit-intent.mjs
```

### Step 2: Test register-agent (wallet lookup)

- [ ] Run:
```bash
cd ai-plugin && AGENT_PRIVATE_KEY=0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478 \
  node -e "import { getWallet, getAgentInfo, getBalance } from './skills/lib/wallet.mjs'; const { address } = getWallet(); console.log('address:', address); const b = await getBalance(address); console.log('balance:', b); const info = await getAgentInfo(address); console.log('info:', JSON.stringify(info));"
```

### Step 3: Test query-pool (MCP)

- [ ] Run:
```bash
cd ai-plugin && AGENT_PRIVATE_KEY=0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478 \
  node skills/run-arena-agent/query-pool.mjs
```
Expected: JSON with live Sepolia pool data (tick ~189000, price ~6100).

### Step 4: Test submit-intent (syntax only — don't actually submit without gas)

- [ ] Run:
```bash
cd ai-plugin && node --check skills/submit-intent/submit-intent.mjs && echo "syntax ok"
cd ai-plugin && node --check skills/run-arena-agent/arena-loop.mjs && echo "syntax ok"
cd ai-plugin && node --check skills/run-arena-agent/query-pool.mjs && echo "syntax ok"
```

### Step 5: Scan for secrets

- [ ] Run:
```bash
grep -rniE "(0x[0-9a-fA-F]{64}|sk-ant-|Bearer [a-zA-Z0-9]{30,})" ai-plugin/ | grep -v node_modules | grep -v package-lock
```
Expected: no output (no secrets).

### Step 6: Final commit + push

- [ ] Run:
```bash
git add ai-plugin/
git commit -m "feat(plugin): agent-arena plugin — register, trade, submit intents via Claude Code / OpenClaw"
git push origin main
```
