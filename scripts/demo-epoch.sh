#!/usr/bin/env bash
# demo-epoch.sh — Advance one epoch for the demo
#
# What it does:
#   1. Each agent makes a live LLM decision via 0G Compute
#   2. Submits intents to AgentManager on 0G
#   3. Reports values (synthetic) to AgentManager
#   4. Triggers epoch settlement on Vault
#   5. Prints agent status (phase, Sharpe, promotion/eviction)
#
# Usage: ./scripts/demo-epoch.sh

set -u

TOKEN=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['gateway']['auth']['token'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "❌ OPENCLAW_GATEWAY_TOKEN not found"; exit 1; fi

cd "$(dirname "$0")/.."

OPENCLAW_GATEWAY_TOKEN=$TOKEN \
POOL_ADDRESS=0x6Ce0896eAE6D4BD668fDe41BB784548fb8F59b50 \
node scripts/run-epochs.mjs --epochs 1 --synthetic
