#!/usr/bin/env bash
# epoch-cron.sh — Automatic epoch settlement loop
#
# Runs forever: every epoch, reports values for all agents then settles.
# Start once and forget. Agents submit intents independently via demo-epoch.sh
# or cron-trigger.js.
#
# Usage:
#   ./scripts/epoch-cron.sh          # run in foreground
#   ./scripts/epoch-cron.sh &        # run in background
#   ./scripts/epoch-cron.sh --once   # settle one epoch then exit

set -u

cd "$(dirname "$0")/.."
source packages/contracts/.env

AM=$AGENT_MANAGER_ADDRESS
VAULT=$VAULT_ADDRESS
RPC_0G=https://evmrpc-testnet.0g.ai
RELAYER_KEY=0x03fd9c5a6a4d37e488f1c6806182d14a7d0c1cd90c405fee2b20002ee70e778a
OG="--legacy --gas-price 3000000000"

ONCE=false
[ "${1:-}" = "--once" ] && ONCE=true

log() { echo "[$(date +%H:%M:%S)] $*"; }

report_and_settle() {
  local EPOCH=$(cast call $VAULT "currentEpoch()(uint256)" --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
  log "── Epoch $((EPOCH + 1)) settlement ──"

  # Report synthetic values for each registered agent
  local COUNT=$(cast call $AM "agentCount()(uint256)" --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
  for id in $(seq 1 $COUNT); do
    local REG=$(cast call $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" $id --rpc-url $RPC_0G 2>/dev/null | tail -1)
    if [ "$REG" != "true" ]; then continue; fi

    # Differentiate agents: gamma (id=3) gets good returns, others get mediocre
    local POS_VAL=980000
    local FEES=1000
    if [ "$id" = "3" ]; then POS_VAL=1050000; FEES=10000; fi
    if [ "$id" = "2" ]; then POS_VAL=970000; FEES=500; fi

    cast send $AM "reportValues(uint256,uint256,uint256)" $id $POS_VAL $FEES \
      --private-key $RELAYER_KEY --rpc-url $RPC_0G $OG > /dev/null 2>&1 && \
      log "  agent $id: reported posValue=$POS_VAL fees=$FEES" || \
      log "  agent $id: reportValues failed"
  done

  # Wait for epoch boundary
  local LAST=$(cast call $VAULT "lastEpochBlock()(uint256)" --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
  local ELEN=$(cast call $VAULT "epochLength()(uint256)" --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
  local TARGET=$((LAST + ELEN))

  while true; do
    local CURR=$(cast block-number --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
    if [ "$CURR" -ge "$TARGET" ]; then break; fi
    local REMAINING=$((TARGET - CURR))
    log "  waiting: block $CURR / $TARGET ($REMAINING remaining)"
    sleep 5
  done

  # Settle
  cast send $VAULT "triggerSettleEpoch()" \
    --private-key $RELAYER_KEY --rpc-url $RPC_0G $OG > /dev/null 2>&1 && \
    log "  ✅ epoch settled" || \
    log "  ❌ settlement failed"

  # Print status
  for id in $(seq 1 $COUNT); do
    local DATA=$(cast call $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" $id --rpc-url $RPC_0G 2>/dev/null)
    local PHASE=$(echo "$DATA" | sed -n '2p' | awk '{print $1}')
    local EPOCHS=$(echo "$DATA" | sed -n '5p' | awk '{print $1}')
    local STREAK=$(echo "$DATA" | sed -n '6p' | awk '{print $1}')
    local LABEL="PROVING"
    [ "$PHASE" = "1" ] && LABEL="VAULT"
    log "  agent $id: $LABEL epochs=$EPOCHS zeroStreak=$STREAK"
  done
}

log "Epoch cron started (epochLength=$(cast call $VAULT 'epochLength()(uint256)' --rpc-url $RPC_0G | awk '{print $1}') blocks)"

if $ONCE; then
  report_and_settle
  exit 0
fi

while true; do
  report_and_settle
  log "sleeping 10s before next cycle..."
  sleep 10
done
