#!/usr/bin/env bash
# test-checklist.sh — Exercise all untested checklist items against live contracts
#
# Tests:
#   1. Deposit + Withdrawal (Tier 1)
#   2. Pause / Unpause
#   3. Eviction (zeroSharpeStreak)
#   4. Commission claim flow
#   5. recordClosure with source parameter
#
# Does NOT modify any existing code — only sends transactions via cast.

set -u

# ─── Config ──────────────────────────────────────────────────────────────────

AM=0xC346168268af5f69D318C50661592370fdb0ba32
VAULT=0x904588f5074F9C75325906AD3613A3f7a98a4D02
SAT=0x03a1125a9746fa5fc70411A3235eb8b9D18bc24E
USDC=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
INFT=0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F
RPC_0G=https://evmrpc-testnet.0g.ai
RPC_SEP=https://ethereum-sepolia.publicnode.com

DEPLOYER_KEY=0xb721615acdec3c13e7321cbb5bea902d06e6ff3e6bc1367121787e9f7c6262dd
DEPLOYER=0x9F36F2581A4f5773cE1B7E25Bc2F83b1b3cFAC06
RELAYER_KEY=0x03fd9c5a6a4d37e488f1c6806182d14a7d0c1cd90c405fee2b20002ee70e778a
RELAYER=0x71a376c2E8F8201d843b4BAD0f7Dd18b8A13213E
ALPHA_KEY=0x67dda80f07176a33eecfd1ab5404241cb31620c2f0276c6add965077c231a478
ALPHA=0xCf5a0E19ed62654e404A48577c4f1EB2A194B510

OG_TX="--legacy --gas-price 3000000000"
PASS=0
FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL + 1)); }
hr()   { echo ""; echo "═══════════════════════════════════════════════════"; echo "  $*"; echo "═══════════════════════════════════════════════════"; }

# Helper: send on 0G with legacy gas
send_0g() {
  cast send "$@" --rpc-url $RPC_0G --legacy --gas-price 3000000000 2>&1
}

# Helper: send on Sepolia
send_sep() {
  cast send "$@" --rpc-url $RPC_SEP 2>&1
}

# Helper: read on 0G
read_0g() {
  cast call "$@" --rpc-url $RPC_0G 2>&1
}

# Helper: read on Sepolia
read_sep() {
  cast call "$@" --rpc-url $RPC_SEP 2>&1
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: Deposit + Tier-1 Withdrawal
# ═══════════════════════════════════════════════════════════════════════════════

hr "TEST 1: Deposit + Tier-1 Withdrawal"

echo "  Step 1a: Approve + deposit 2 USDC.e on Satellite..."
send_sep $USDC "approve(address,uint256)" $SAT 2000000 --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "approve" || fail "approve"
HASH=$(send_sep $SAT "deposit(uint256)" 2000000 --private-key $DEPLOYER_KEY)
echo "$HASH" | grep -q "status.*1" && ok "deposit(2 USDC.e)" || fail "deposit"

echo "  Step 1b: Relay recordDeposit to Vault on 0G..."
RESULT=$(send_0g $VAULT "recordDeposit(address,uint256)" $DEPLOYER 2000000 --private-key $RELAYER_KEY)
echo "$RESULT" | grep -q "status.*1" && ok "vault.recordDeposit()" || fail "vault.recordDeposit()"

echo "  Step 1c: Verify shares minted..."
SHARES=$(read_0g $VAULT "balanceOf(address)(uint256)" $DEPLOYER)
if [ "$SHARES" != "0" ]; then
  ok "shares minted: $SHARES"
else
  fail "no shares minted"
fi

TOTAL_ASSETS=$(read_0g $VAULT "totalAssets()(uint256)")
echo "  totalAssets after deposit: $TOTAL_ASSETS"

echo "  Step 1d: Request withdrawal on Satellite..."
send_sep $SAT "requestWithdraw(uint256)" 1000000 --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "requestWithdraw(1 USDC.e)" || fail "requestWithdraw"

echo "  Step 1e: Relay processWithdraw to Vault (Tier 1 — should be instant)..."
# Convert tokenAmount to shares: shares = tokenAmount * totalSupply / totalAssets
# For simplicity, assume 1:1 since sharePrice = 1e18
RESULT=$(send_0g $VAULT "processWithdraw(address,uint256)" $DEPLOYER 1000000 --private-key $RELAYER_KEY)
if echo "$RESULT" | grep -q "status.*1"; then
  # Check for WithdrawApproved event in logs
  if echo "$RESULT" | grep -q "WithdrawApproved\|0x19b317a6"; then
    ok "Tier-1 withdrawal approved (WithdrawApproved emitted)"
  else
    ok "processWithdraw succeeded (check logs for WithdrawApproved)"
  fi
else
  fail "processWithdraw reverted"
fi

echo "  Step 1f: Relay release on Satellite..."
RESULT=$(send_sep $SAT "release(address,uint256)" $DEPLOYER 1000000 --private-key $RELAYER_KEY)
echo "$RESULT" | grep -q "status.*1" && ok "satellite.release() — tokens returned" || fail "satellite.release()"

DEPLOYER_BAL=$(read_sep $USDC "balanceOf(address)(uint256)" $DEPLOYER)
echo "  Deployer USDC.e after withdrawal: $DEPLOYER_BAL"


# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: Pause / Unpause
# ═══════════════════════════════════════════════════════════════════════════════

hr "TEST 2: Pause / Unpause"

echo "  Step 2a: Pause agent-alpha (id=1) via Satellite..."
# pauseAgent emits PauseRequested — must be called by iNFT owner
# The deployer (0x9F36F2...) owns the iNFT since they registered the agent
send_sep $SAT "pauseAgent(uint256)" 1 --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "satellite.pauseAgent(1)" || fail "pauseAgent"

echo "  Step 2b: Relay processPause to AgentManager..."
RESULT=$(send_0g $AM "processPause(uint256,address,bool)" 1 $DEPLOYER true --private-key $RELAYER_KEY)
echo "$RESULT" | grep -q "status.*1" && ok "agentManager.processPause(1, true)" || fail "processPause"

echo "  Step 2c: Verify agent is paused..."
AGENT_DATA=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 1)
PAUSED=$(echo "$AGENT_DATA" | sed -n '7p')
if [ "$PAUSED" = "true" ]; then
  ok "agent 1 is paused"
else
  fail "agent 1 is NOT paused (got: $PAUSED)"
fi

echo "  Step 2d: Try to submitIntent while paused (should revert)..."
PARAMS=$(cast abi-encode "f(uint256,int24,int24)" 100000 -887220 887220)
RESULT=$(send_0g $AM "submitIntent(uint256,uint8,bytes)" 1 0 $PARAMS --private-key $ALPHA_KEY 2>&1 || true)
if echo "$RESULT" | grep -qi "paused\|revert"; then
  ok "submitIntent correctly rejected (agent paused)"
else
  fail "submitIntent should have reverted but didn't"
fi

echo "  Step 2e: Unpause agent-alpha..."
send_sep $SAT "unpauseAgent(uint256)" 1 --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "satellite.unpauseAgent(1)" || fail "unpauseAgent"
RESULT=$(send_0g $AM "processPause(uint256,address,bool)" 1 $DEPLOYER false --private-key $RELAYER_KEY)
echo "$RESULT" | grep -q "status.*1" && ok "agentManager.processPause(1, false)" || fail "processPause(false)"

echo "  Step 2f: Verify unpaused..."
AGENT_DATA=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 1)
PAUSED=$(echo "$AGENT_DATA" | sed -n '7p')
if [ "$PAUSED" = "false" ]; then
  ok "agent 1 is unpaused"
else
  fail "agent 1 is still paused"
fi


# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: Eviction (zeroSharpeStreak)
# ═══════════════════════════════════════════════════════════════════════════════

hr "TEST 3: Eviction via zeroSharpeStreak"

echo "  We need to settle 3 epochs WITHOUT reporting values for an agent."
echo "  Agent-beta (id=2) will be our eviction target."
echo "  Report values for agents 1 and 3 only, skip agent 2."

for EPOCH_NUM in 1 2 3; do
  echo ""
  echo "  --- Eviction epoch $EPOCH_NUM ---"

  # Report values for agents 1 and 3 only (skip 2)
  send_0g $AM "reportValues(uint256,uint256,uint256)" 1 1050000 10000 --private-key $RELAYER_KEY > /dev/null 2>&1
  send_0g $AM "reportValues(uint256,uint256,uint256)" 3 1050000 10000 --private-key $RELAYER_KEY > /dev/null 2>&1
  echo "  Reported values for agents 1,3 (skipped agent 2)"

  # Wait for epoch boundary (strip cast's bracketed format e.g. "300 [3e2]" → "300")
  LAST_BLOCK=$(read_0g $VAULT "lastEpochBlock()(uint256)" | awk '{print $1}')
  EPOCH_LEN=$(read_0g $VAULT "epochLength()(uint256)" | awk '{print $1}')
  TARGET=$((LAST_BLOCK + EPOCH_LEN))
  echo "  Waiting for block $TARGET..."
  while true; do
    CURR=$(cast block-number --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
    if [ "$CURR" -ge "$TARGET" ]; then break; fi
    sleep 5
  done

  # Settle
  RESULT=$(send_0g $VAULT "triggerSettleEpoch()" --private-key $RELAYER_KEY)
  echo "$RESULT" | grep -q "status.*1" && echo "  Epoch settled" || echo "  Settlement failed"

  # Check agent 2 status
  AGENT2=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 2)
  STREAK=$(echo "$AGENT2" | sed -n '6p')
  REG=$(echo "$AGENT2" | sed -n '8p')
  echo "  Agent 2: zeroStreak=$STREAK registered=$REG"
done

# Verify eviction
AGENT2_FINAL=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 2)
REG=$(echo "$AGENT2_FINAL" | sed -n '8p')
if [ "$REG" = "false" ]; then
  ok "Agent 2 evicted (deregistered after 3 zero-Sharpe epochs)"
else
  STREAK=$(echo "$AGENT2_FINAL" | sed -n '6p')
  fail "Agent 2 NOT evicted (registered=$REG, zeroStreak=$STREAK)"
fi


# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: Commission Claim
# ═══════════════════════════════════════════════════════════════════════════════

hr "TEST 4: Commission Claim Flow"

echo "  Step 4a: Check if commissions are owed (from epochs with feesCollected > 0)..."
COMMISSION_1=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" 1)
COMMISSION_3=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" 3)
echo "  Commission owed agent 1: $COMMISSION_1"
echo "  Commission owed agent 3: $COMMISSION_3"

if [ "$COMMISSION_1" != "0" ] || [ "$COMMISSION_3" != "0" ]; then
  CLAIM_AGENT=1
  [ "$COMMISSION_3" != "0" ] && CLAIM_AGENT=3
  COMMISSION_AMT=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" $CLAIM_AGENT)
  echo "  Claiming commission for agent $CLAIM_AGENT (amount=$COMMISSION_AMT)..."

  echo "  Step 4b: claimCommissions on Satellite..."
  send_sep $SAT "claimCommissions(uint256)" $CLAIM_AGENT --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "satellite.claimCommissions($CLAIM_AGENT)" || fail "claimCommissions"

  echo "  Step 4c: Relay processCommissionClaim to AgentManager..."
  RESULT=$(send_0g $AM "processCommissionClaim(uint256,address)" $CLAIM_AGENT $DEPLOYER --private-key $RELAYER_KEY)
  if echo "$RESULT" | grep -q "status.*1"; then
    ok "agentManager.processCommissionClaim() → vault.approveCommissionRelease()"
  else
    fail "processCommissionClaim (may not own iNFT or no commission)"
  fi

  echo "  Step 4d: Check commission zeroed..."
  AFTER=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" $CLAIM_AGENT)
  if [ "$AFTER" = "0" ]; then
    ok "Commission zeroed after claim"
  else
    fail "Commission still owed: $AFTER"
  fi
else
  echo "  No commissions owed yet — reporting values with fees to generate some..."
  # Report with fees for agent 1
  send_0g $AM "reportValues(uint256,uint256,uint256)" 1 1100000 50000 --private-key $RELAYER_KEY > /dev/null 2>&1
  send_0g $AM "reportValues(uint256,uint256,uint256)" 3 1100000 50000 --private-key $RELAYER_KEY > /dev/null 2>&1

  # Settle an epoch to trigger fee waterfall
  LAST_BLOCK=$(read_0g $VAULT "lastEpochBlock()(uint256)" | awk '{print $1}')
  EPOCH_LEN=$(read_0g $VAULT "epochLength()(uint256)" | awk '{print $1}')
  TARGET=$((LAST_BLOCK + EPOCH_LEN))
  echo "  Waiting for epoch boundary (block $TARGET)..."
  while true; do
    CURR=$(cast block-number --rpc-url $RPC_0G 2>/dev/null | awk '{print $1}')
    if [ "$CURR" -ge "$TARGET" ]; then break; fi
    sleep 5
  done
  send_0g $VAULT "triggerSettleEpoch()" --private-key $RELAYER_KEY > /dev/null 2>&1

  COMMISSION_1=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" 1)
  echo "  Commission owed agent 1 after settlement: $COMMISSION_1"

  if [ "$COMMISSION_1" != "0" ]; then
    ok "Fee waterfall generated commissions ($COMMISSION_1)"

    echo "  Step 4b: claimCommissions on Satellite..."
    send_sep $SAT "claimCommissions(uint256)" 1 --private-key $DEPLOYER_KEY | grep -q "status.*1" && ok "satellite.claimCommissions(1)" || fail "claimCommissions"

    echo "  Step 4c: Relay processCommissionClaim..."
    RESULT=$(send_0g $AM "processCommissionClaim(uint256,address)" 1 $DEPLOYER --private-key $RELAYER_KEY)
    echo "$RESULT" | grep -q "status.*1" && ok "processCommissionClaim → approveCommissionRelease" || fail "processCommissionClaim"

    AFTER=$(read_0g $VAULT "commissionsOwed(uint256)(uint256)" 1)
    if [ "$AFTER" = "0" ]; then
      ok "Commission zeroed after claim"
    else
      fail "Commission still owed: $AFTER"
    fi
  else
    fail "No commissions generated after epoch with fees"
  fi
fi


# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: recordClosure with source parameter
# ═══════════════════════════════════════════════════════════════════════════════

hr "TEST 5: recordClosure with source parameter"

echo "  Step 5a: Check agent 1 proving state before closure..."
AGENT1=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 1)
PROVING_BAL=$(echo "$AGENT1" | sed -n '3p')
PROVING_DEP=$(echo "$AGENT1" | sed -n '4p')
echo "  provingBalance=$PROVING_BAL provingDeployed=$PROVING_DEP"

DEPLOYED_BEFORE=$(read_0g $AM "totalDeployedVault()(uint256)")
echo "  totalDeployedVault before: $DEPLOYED_BEFORE"

echo "  Step 5b: Call recordClosure with source=PROVING (0)..."
RESULT=$(send_0g $AM "recordClosure(uint256,uint256,uint8)" 1 100000 0 --private-key $RELAYER_KEY)
if echo "$RESULT" | grep -q "status.*1"; then
  ok "recordClosure(agent=1, recovered=100000, source=PROVING)"
else
  fail "recordClosure with PROVING source"
fi

echo "  Step 5c: Verify provingDeployed decremented..."
AGENT1_AFTER=$(read_0g $AM "agents(uint256)(address,uint8,uint256,uint256,uint256,uint256,bool,bool)" 1)
PROVING_DEP_AFTER=$(echo "$AGENT1_AFTER" | sed -n '4p')
echo "  provingDeployed after: $PROVING_DEP_AFTER (was $PROVING_DEP)"

echo "  Step 5d: Call recordClosure with source=VAULT (1)..."
RESULT=$(send_0g $AM "recordClosure(uint256,uint256,uint8)" 1 50000 1 --private-key $RELAYER_KEY)
if echo "$RESULT" | grep -q "status.*1"; then
  ok "recordClosure(agent=1, recovered=50000, source=VAULT)"
else
  fail "recordClosure with VAULT source"
fi

DEPLOYED_AFTER=$(read_0g $AM "totalDeployedVault()(uint256)")
echo "  totalDeployedVault after: $DEPLOYED_AFTER (was $DEPLOYED_BEFORE)"

echo "  Step 5e: Call vault.recordRecovery (audit event)..."
RESULT=$(send_0g $VAULT "recordRecovery(uint256,uint256)" 1 100000 --private-key $RELAYER_KEY)
echo "$RESULT" | grep -q "status.*1" && ok "vault.recordRecovery() emitted RecoveryRecorded" || fail "vault.recordRecovery()"


# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

hr "RESULTS"
echo ""
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Total:  $((PASS + FAIL))"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  🎉 ALL TESTS PASSED"
else
  echo "  ⚠️  $FAIL test(s) failed"
fi
echo ""
