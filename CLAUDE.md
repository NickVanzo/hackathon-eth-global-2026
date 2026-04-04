# 0G Agent Skills

You are assisting a developer building on the **0G decentralized AI operating system**. This
repository contains 14 agent skills across 4 categories: Storage, Compute, Chain, and Cross-Layer.

## How to Use

1. Read `AGENTS.md` for orchestration rules, activation triggers, and workflow sequences
2. Load the relevant `SKILL.md` file based on what the developer is building
3. Reference `patterns/*.md` for deep architectural context
4. Follow ALL ALWAYS/NEVER rules — they prevent common bugs

## Critical Rules (Memorize These)

- **processResponse()**: Call after EVERY compute inference. Param order:
  `(providerAddress, chatID, usageData)`
- **ChatID**: Extract from `ZG-Res-Key` header FIRST, `data.id` as fallback (chatbot only)
- **evmVersion**: ALWAYS use `"cancun"` for 0G Chain contracts
- **ethers**: ALWAYS v6 (`ethers.JsonRpcProvider`, `ethers.parseEther`). NEVER v5
- **File handles**: ALWAYS close `ZgFile` with `file.close()` in a `finally` block
- **Private keys**: ALWAYS from `.env`, NEVER hardcoded
- **Upload signature**: `indexer.upload(file, rpcUrl, signer)` — returns `[result, error]` tuple
- **Download behavior**: `indexer.download()` can THROW in addition to returning errors — always
  wrap in try/catch
- **Service tuples**: `listService()` returns tuple arrays, not objects — use `s[0]` for
  providerAddress, `s[1]` for serviceType, `s[6]` for model, `s[10]` for teeVerified
- **Ledger tuples**: `getLedger()` returns tuple — use `account[1]` for totalBalance, `account[2]`
  for availableBalance

## Skill Map

### Storage

- `skills/storage/upload-file/SKILL.md` — Upload files to 0G Storage
- `skills/storage/download-file/SKILL.md` — Download & verify files
- `skills/storage/merkle-verification/SKILL.md` — Data integrity verification

### Compute

- `skills/compute/provider-discovery/SKILL.md` — Find & verify providers
- `skills/compute/account-management/SKILL.md` — Deposits, transfers, refunds
- `skills/compute/streaming-chat/SKILL.md` — LLM inference (DeepSeek, Qwen, Gemma)
- `skills/compute/text-to-image/SKILL.md` — Image generation (Flux Turbo)
- `skills/compute/speech-to-text/SKILL.md` — Audio transcription (Whisper)
- `skills/compute/fine-tuning/SKILL.md` — Model training (testnet only)

### Chain

- `skills/chain/scaffold-project/SKILL.md` — Initialize new 0G projects
- `skills/chain/deploy-contract/SKILL.md` — Deploy Solidity contracts
- `skills/chain/interact-contract/SKILL.md` — Read/write deployed contracts

### Cross-Layer

- `skills/cross-layer/storage-plus-chain/SKILL.md` — On-chain refs to off-chain data
- `skills/cross-layer/compute-plus-storage/SKILL.md` — AI inference + storage I/O

## Pattern Documents

- `patterns/NETWORK_CONFIG.md` — Endpoints, chain IDs, SDK versions, .env template
- `patterns/STORAGE.md` — Storage architecture & SDK reference
- `patterns/COMPUTE.md` — Compute architecture & processResponse() deep-dive
- `patterns/CHAIN.md` — EVM patterns, Hardhat/Foundry configs, ethers v6
- `patterns/SECURITY.md` — Key management, TEE, data integrity
- `patterns/TESTING.md` — Testing strategies & mock patterns

## OpenClaw Gateway Tokens

There are **two** OpenClaw instances with different `OPENCLAW_GATEWAY_TOKEN` values. Always use the right one:

| Environment | How to get the token |
|---|---|
| **VM (fly.io)** | Injected automatically from fly secret — no action needed |
| **Local (`~/.openclaw/`)** | `python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])"` |

When running `cron-trigger.js` locally:
```bash
OPENCLAW_GATEWAY_TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])") \
OPENCLAW_STATE_DIR=./local \
DRY_RUN=true \
node data-seed/cron-trigger.js
```

## Contract Address Management — CRITICAL

After any contract deployment or redeployment, **ALL** of the following files must be updated with new addresses. Missing even one causes silent failures (relayer calls old contracts, scripts submit to wrong AgentManager, etc.):

| File | What to update |
|------|----------------|
| `packages/contracts/.env` | VAULT_ADDRESS, AGENT_MANAGER_ADDRESS, SATELLITE_ADDRESS |
| `packages/contracts/.env.example` | Same as above |
| `packages/relayer/.env` | SATELLITE_ADDRESS, VAULT_ADDRESS, AGENT_MANAGER_ADDRESS |
| `packages/relayer/.env.example` | Same as above |
| `packages/relayer/config.yaml` | Contract addresses under each network + start_block values |
| `packages/relayer/src/relayer/env.ts` | Hardcoded fallback addresses |
| `data-seed/workspaces/agent-{alpha,beta,gamma}/.env` | VAULT_ADDRESS, AGENT_MANAGER_ADDRESS |
| `scripts/run-epochs.mjs` | Hardcoded AGENT_MANAGER_ADDR, VAULT_ADDR, SATELLITE_ADDR |

**Use `./scripts/deploy-all.sh`** — it updates all of the above automatically. But if `packages/relayer/.env` was created manually, it must also be updated (the deploy script handles this now).

**After updating addresses:** restart the Envio relayer (`npx envio stop && npx envio dev`). It loads config at startup and does NOT hot-reload.

**Verify after deploy:** always run on-chain cross-reference checks (AM↔Vault, messenger on all 3 contracts). The deploy script prints these but manual verification catches bugs the script can't.

## Quick Start

When a developer asks to build something on 0G:

1. Check `AGENTS.md` workflow sequences to determine which skills to activate
2. Load the primary skill's `SKILL.md`
3. Load `patterns/NETWORK_CONFIG.md` for environment setup
4. Follow the skill's Quick Workflow section
5. Apply all ALWAYS/NEVER rules from `AGENTS.md`
