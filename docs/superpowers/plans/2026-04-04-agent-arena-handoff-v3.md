# Agent Arena — Handoff for Next Agent (v3)

**Date:** 2026-04-04 ~01:30 UTC  
**Project:** ETHGlobal Cannes 2026 — Agent Arena  
**Status:** VM stopped (intentionally). All 3 agents confirmed working end-to-end via gateway.

---

## What This Project Is

Three autonomous trading agents (alpha, beta, gamma) running on a fly.io VM compete to manage Uniswap v3 liquidity on Sepolia. Each submits intents to a vault contract on 0G testnet. The vault tracks Sharpe scores and allocates capital to the best-performing agent.

The demo showcases **OpenClaw** (AI agent framework) + **0G Compute** (inference via Qwen 2.5 7B) + **0G Chain** (on-chain intent submission).

---

## Current System State (as of this session)

### ✅ Fully Working
- **OpenClaw gateway** on fly.io VM — starts in ~60s, routes HTTP completions to 0G
- **3 agents (alpha, beta, gamma)** — each produces valid JSON decisions via gateway every 2 minutes
- **`cron-trigger.js`** — polls gateway on boot, fires epochs every 120s, agents called serially
- **Dry-run intent files** — written to `/data/intents/` on VM each epoch

### ❌ Not Yet Built
- Vault contract (0G testnet)
- AgentManager contract (0G testnet)
- iNFT / AgentNFT contract (0G testnet)
- Satellite `executeBatch()` — Uniswap LP execution (Sepolia)
- Relayer — cross-chain event routing
- MCP server — Uniswap subgraph data for agents
- Dashboard

### 🔧 DRY_RUN=true
Intents are written to `/data/intents/` instead of submitted on-chain. Set `DRY_RUN=false` in `fly.toml [env]` once vault is deployed.

---

## fly.io VM

- **App:** `hackathon-eth-global-2026-thrumming-cherry-7051`
- **Machine ID:** `e822051c6516d8`
- **Region:** `cdg` (Paris)
- **State:** STOPPED (stopped at end of this session — start with `fly machine start e822051c6516d8`)
- **Image:** `ghcr.io/openclaw/openclaw:latest`
- **Volume:** `openclaw_data` mounted at `/data`

### Fly Secrets (all correct as of this session)

| Secret | Notes |
|---|---|
| `OPENCLAW_API_KEY` | **Fixed this session** — was wrong before, now confirmed working. Format: `app-sk-<base64(rawMessage:signature)>` |
| `OPENCLAW_GATEWAY_TOKEN` | `02b01649dbb8fac3a577a96997fb277da5480d6a72a697c626a3ba471dca91e8` — gateway HTTP Bearer token |
| `AGENT_ALPHA_KEY` | Private key for agent-alpha wallet |
| `AGENT_BETA_KEY` | Private key for agent-beta wallet |
| `AGENT_GAMMA_KEY` | Private key for agent-gamma wallet |
| `AUTH_PASSWORD` | OpenClaw setup wizard password |

**IMPORTANT:** If agents start timing out again (`agent call failed: The operation was aborted due to timeout`), the first thing to check is whether `OPENCLAW_API_KEY` is still valid. The 0G key may expire (check `expiresAt` in the decoded JWT payload — currently 0 = no expiry). Test with:
```bash
fly ssh console -C "sh -c 'curl -s -w \"\n%{http_code} %{time_total}s\" -X POST https://compute-network-6.integratenetwork.work/v1/proxy/chat/completions -H \"Content-Type: application/json\" -H \"Authorization: Bearer \$OPENCLAW_API_KEY\" -d \"{\\\"model\\\":\\\"qwen/qwen-2.5-7b-instruct\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"say hi\\\"}],\\\"max_tokens\\\":10}\"'"
```
Expected: `200 ~7s`. If `400` → key is wrong/expired.

---

## Boot Sequence & Expected Log Output

Start VM: `fly machine start e822051c6516d8`

Then wait ~90s and run: `fly logs --no-tail | grep -E "\[cron\]|\[agent-"`

Expected:
```
[cron] started — epoch every 120s, agents: agent-alpha, agent-beta, agent-gamma
[cron] waiting for gateway...
[cron] gateway ready (60s)           ← was 130s on first boot; ~60s on warm boots
[cron] epoch @ 2026-04-04T...
[agent-alpha] decision: {"action":"open","tickLower":-887272,"tickUpper":887272}
[agent-alpha] dry-run: wrote agent-alpha-open-....json
[agent-beta] decision: {"action":"open","tickLower":74355,"tickUpper":75475}
[agent-beta] dry-run: wrote agent-beta-open-....json
[agent-gamma] decision: {"action":"open","tickLower":73718,"tickUpper":76184}
[agent-gamma] dry-run: wrote agent-gamma-open-....json
```

Each agent call takes ~10-35s. All 3 finish well within the 60s fetch timeout. New epoch fires every 120s.

---

## Known Gotchas

### 1. `fly ssh console -C` shell quoting
The `-C` flag does NOT use bash — it passes the command string literally to `exec`. This means:
- **Pipes (`|`) don't work** — use `sh -c '...'` wrapper
- **Env var expansion (`$VAR`) doesn't work** without `sh -c` wrapper
- Always wrap multi-command or pipeline invocations: `fly ssh console -C "sh -c 'env | grep OPENCLAW'"`

### 2. Gateway takes 60-130s to start
The `waitForGateway()` polling loop in `cron-trigger.js` handles this correctly — it retries `GET /v1/models` every 30s. Don't manually trigger epochs before gateway is ready.

### 3. `/data` file ownership must be uid 1000
Any file written via `tee` or SSH runs as root. Always `chown 1000:1000` after:
```bash
fly ssh console -C "sh -c 'tee /data/some-file.js'" < local-file.js
fly ssh console -C "sh -c 'chown 1000:1000 /data/some-file.js'"
```

### 4. `config set` anomaly on every boot (harmless)
`Config observe anomaly: gateway-mode-missing-vs-last-good` — this fires because the backup config has `gateway.remote.token` but the live config uses `gateway.auth.mode: "token"`. Gateway starts fine, ignore it.

### 5. Epoch interval must stay ≥ 120s
Agents are called serially. Each takes ~30-40s. 3 agents × ~35s = ~105s. At 120s intervals, queue stays clear. Do NOT reduce below 120s unless you parallelize agent calls in `cron-trigger.js`.

---

## What Needs to Be Done Next (Priority Order)

### Priority 1 ✅ — Gateway routing (DONE)
Agents call OpenClaw gateway, gateway calls 0G Compute, decisions are written as dry-run intents.

### Priority 2 — Deploy Vault + AgentManager + iNFT to 0G testnet (HIGH)

Contract stubs are at `packages/contracts/script/Deploy0G.s.sol` — everything is commented out waiting for implementations.

What needs building:
1. **`AgentNFT.sol`** — simple ERC-721, one mint per registered agent
2. **`AgentManager.sol`** — `submitIntent()`, agent registry, basic Sharpe EMA scoring, token bucket, promotion/eviction logic
3. **`Vault.sol`** — ERC20 share token, `recordDeposit()`, `processWithdraw()`, `epochCheck` + `_settleEpoch()` calling `AgentManager.settleAgents()`

Then deploy all three, call `AgentManager.setVault()`, update `.env`.

Full spec in `build-checklist.md` (Hours 1:15–4:45, Dev A + Dev B sections).

### Priority 3 — Satellite `executeBatch()` (HIGH, Sepolia)

`packages/contracts/src/Satellite.sol` — the `executeBatch()` function reverts with "not yet implemented". Needs:
- Zap-in: swap ~50% USDC.e → WETH via SwapRouter
- LP open: `NonfungiblePositionManager.mint()`
- LP close: `decreaseLiquidity()` + `collect()` + `burn()`
- LP modify: close + re-open at new ticks
- Position tracking per agentId
- `ValuesReported` event emission after epoch collect

### Priority 4 — Relayer (HIGH)

Node.js process watching events on both 0G testnet and Sepolia, routing 12 event types between chains. See `build-checklist.md` Hours 3:30–4:45, Dev B section.

### Priority 5 — Set DRY_RUN=false

Once vault is deployed and agents have real addresses:
1. Update `.env` in agent workspaces with real `VAULT_ADDRESS`
2. Set `DRY_RUN=false` in `fly.toml [env]`
3. `fly deploy --ha=false`
4. Ensure agent wallets have gas on 0G testnet:
   - **agent-alpha:** `0xCf5a0E19ed62654e404A48577c4f1EB2A194B510`
   - agent-beta / agent-gamma: check `/data/workspaces/agent-{beta,gamma}/.env`

---

## Key File Locations

| File | Purpose |
|---|---|
| `data-seed/cron-trigger.js` | Epoch trigger — polls gateway, calls agents serially, writes dry-run intents |
| `data-seed/openclaw.json` | OpenClaw config template — gateway auth, 0G provider, 3 agent definitions |
| `packages/contracts/src/Satellite.sol` | Sepolia custody + Uniswap execution contract (executeBatch is a stub) |
| `packages/contracts/src/interfaces/` | IVault, IAgentManager, ISatellite, IShared — all defined |
| `packages/contracts/script/Deploy0G.s.sol` | 0G deployment script — all commented out, waiting for contract implementations |
| `packages/contracts/script/DeploySepolia.s.sol` | Sepolia deployment script |
| `build-checklist.md` | Full build plan with hour-by-hour task breakdown |

---

## Quick Reference Commands

```bash
# Start VM
fly machine start e822051c6516d8

# Stop VM
fly machine stop e822051c6516d8

# Watch live logs
fly logs

# Check cron/agent activity only
fly logs --no-tail | grep -E "\[cron\]|\[agent-"

# SSH into VM
fly ssh console

# Check gateway internal log
fly ssh console -C "sh -c 'tail -50 /tmp/openclaw/openclaw-2026-04-04.log'"

# List intent files
fly ssh console -C "sh -c 'ls /data/intents/'"

# Test 0G provider health
fly ssh console -C "sh -c 'curl -s -w \"\n%{http_code} %{time_total}s\" -X POST https://compute-network-6.integratenetwork.work/v1/proxy/chat/completions -H \"Content-Type: application/json\" -H \"Authorization: Bearer \$OPENCLAW_API_KEY\" -d \"{\\\"model\\\":\\\"qwen/qwen-2.5-7b-instruct\\\",\\\"messages\\\":[{\\\"role\\\":\\\"user\\\",\\\"content\\\":\\\"say hi\\\"}],\\\"max_tokens\\\":10}\"'"

# Upload a file (always chown after)
fly ssh console -C "sh -c 'tee /data/some-file.js'" < local-file.js
fly ssh console -C "sh -c 'chown 1000:1000 /data/some-file.js'"

# Deploy fly.toml changes
fly deploy --ha=false
```

---

## Agent Wallet Addresses

- **agent-alpha:** `0xCf5a0E19ed62654e404A48577c4f1EB2A194B510`
- **agent-beta / agent-gamma:** check `/data/workspaces/agent-{beta,gamma}/.env` on VM

---

## OpenClaw Config on VM (`/data/openclaw.json`)

```json
{
  "gateway": {
    "controlUi": { "dangerouslyAllowHostHeaderOriginFallback": true },
    "auth": { "mode": "token" },
    "http": { "endpoints": { "chatCompletions": { "enabled": true } } }
  },
  "models": {
    "providers": {
      "0g": {
        "baseUrl": "https://compute-network-6.integratenetwork.work/v1/proxy",
        "apiKey": { "source": "env", "provider": "default", "id": "OPENCLAW_API_KEY" },
        "api": "openai-completions",
        "models": [{ "id": "qwen/qwen-2.5-7b-instruct", "name": "Qwen 2.5 7B", "compat": { "supportsTools": false } }]
      }
    }
  },
  "agents": {
    "defaults": { "model": { "primary": "0g/qwen/qwen-2.5-7b-instruct" } },
    "list": [
      { "id": "agent-alpha", "workspace": "/data/workspaces/agent-alpha", "agentDir": "/data/agents/agent-alpha" },
      { "id": "agent-beta",  "workspace": "/data/workspaces/agent-beta",  "agentDir": "/data/agents/agent-beta" },
      { "id": "agent-gamma", "workspace": "/data/workspaces/agent-gamma", "agentDir": "/data/agents/agent-gamma" }
    ]
  }
}
```

`gateway.auth.token` is NOT in the config — it's read from `OPENCLAW_GATEWAY_TOKEN` fly secret at runtime.
