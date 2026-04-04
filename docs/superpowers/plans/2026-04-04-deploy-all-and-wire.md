# Deploy All Contracts & Wire Everything Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single shell script that deploys all contracts (AgentManager + Vault on 0G, Satellite on Sepolia with Etherscan verification), wires them together, and updates every config file in the repo with the new addresses.

**Architecture:** A bash orchestration script (`scripts/deploy-all.sh`) that runs the existing Forge deploy scripts sequentially, parses addresses from broadcast JSON, and uses `sed` to patch all `.env`, `config.yaml`, and workspace files. No new Solidity — reuses `Deploy0G.s.sol` and `DeploySepolia.s.sol` as-is.

**Tech Stack:** Bash, Forge (foundry), jq (for JSON parsing), sed

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/contracts/.env` | Modify | Add missing Sepolia deploy vars (UNISWAP_POSITION_MANAGER, UNISWAP_UNIVERSAL_ROUTER, PROTOCOL_TREASURY, IDLE_RESERVE_RATIO) |
| `scripts/deploy-all.sh` | Create | Orchestration: compile → deploy 0G → deploy Sepolia → extract addresses → patch all configs |
| `.env.example` | Modify | Add UNISWAP_UNIVERSAL_ROUTER, IDLE_RESERVE_RATIO, PROTOCOL_TREASURY |
| `packages/contracts/.env.example` | Modify | Add UNISWAP_UNIVERSAL_ROUTER, IDLE_RESERVE_RATIO, PROTOCOL_TREASURY |
| `packages/relayer/config.yaml` | Modified by script | Updated Vault address, uncommented AgentManager with real address, updated start_block |
| `packages/relayer/.env.example` | Modified by script | Updated VAULT_ADDRESS, AGENT_MANAGER_ADDRESS, SATELLITE_ADDRESS |
| `packages/shared/abis/AgentManager.json` | Created by script | Copied from forge build output |
| `data-seed/workspaces/agent-{alpha,beta,gamma}/.env` | Modified by script | Updated VAULT_ADDRESS, AGENT_MANAGER_ADDRESS |

---

### Task 1: Add Missing Env Vars for Satellite Deployment

The `DeploySepolia.s.sol` script reads `UNISWAP_POSITION_MANAGER`, `UNISWAP_UNIVERSAL_ROUTER`, `PROTOCOL_TREASURY`, and `IDLE_RESERVE_RATIO` from env, but these are not in `packages/contracts/.env`.

**Files:**
- Modify: `packages/contracts/.env`
- Modify: `packages/contracts/.env.example`
- Modify: `.env.example`

- [ ] **Step 1: Add missing vars to `packages/contracts/.env`**

Append these lines after the existing `UNISWAP_V3_POOL_ADDRESS` line:

```
WETH_ADDRESS=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
UNISWAP_POSITION_MANAGER=0x1238536071E1c677A632429e3655c799b22cDA52
UNISWAP_UNIVERSAL_ROUTER=0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD
PROTOCOL_TREASURY=0x5068517ba17Dd5E3A49c09273bc0964fD0fa8e47
IDLE_RESERVE_RATIO=2000
```

Notes on values:
- `UNISWAP_POSITION_MANAGER`: Uniswap v3 NonfungiblePositionManager on Sepolia (confirmed from `scripts/seed-liquidity.ts:26`)
- `UNISWAP_UNIVERSAL_ROUTER`: Uniswap Universal Router on Sepolia
- `PROTOCOL_TREASURY`: set to deployer address (same as Deploy0G.s.sol line 54)
- `IDLE_RESERVE_RATIO`: 2000 = 20% (from test base `SatelliteTestBase.sol:41`)

- [ ] **Step 2: Update `packages/contracts/.env.example`**

Add after the `UNISWAP_SWAP_ROUTER` line:

```
UNISWAP_UNIVERSAL_ROUTER=0x0000000000000000000000000000000000000000
PROTOCOL_TREASURY=0x0000000000000000000000000000000000000000
IDLE_RESERVE_RATIO=2000
```

- [ ] **Step 3: Update root `.env.example`**

Add after the `UNISWAP_SWAP_ROUTER` line (around line 91):

```
# Uniswap Universal Router address on Sepolia
UNISWAP_UNIVERSAL_ROUTER=

# Protocol treasury address (receives protocol fees on Sepolia)
PROTOCOL_TREASURY=

# Idle reserve ratio in basis points (2000 = 20%)
IDLE_RESERVE_RATIO=2000
```

- [ ] **Step 4: Verify Satellite compiles with these vars**

Run:
```bash
cd packages/contracts && source .env && forge build --force
```
Expected: compilation succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/.env.example .env.example packages/contracts/.env
git commit -m "chore: add missing Sepolia deploy vars (position manager, universal router, treasury, idle reserve ratio)"
```

---

### Task 2: Create the deploy-all.sh Script

**Files:**
- Create: `scripts/deploy-all.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# deploy-all.sh — Deploy all Agent Arena contracts and wire everything
#
# Deploys:
#   1. AgentManager + Vault on 0G testnet (+ setVault + fund)
#   2. Satellite on Sepolia (+ Etherscan verification)
#
# Then:
#   3. Extracts deployed addresses from forge broadcast JSON
#   4. Updates all .env, config.yaml, and workspace files
#   5. Copies ABIs to shared/abis/
# =============================================================================

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
RELAYER_DIR="$REPO_ROOT/packages/relayer"
SHARED_DIR="$REPO_ROOT/packages/shared"
WORKSPACES_DIR="$REPO_ROOT/data-seed/workspaces"

# Load .env from contracts dir
set -a
source "$CONTRACTS_DIR/.env"
set +a

echo "============================================="
echo " Agent Arena — Full Deploy"
echo "============================================="
echo ""
echo "Deployer:  $ADDRESS_DEPLOYER"
echo "Relayer:   $ADDRESS_RELAYER"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Compile
# -----------------------------------------------------------------------------

echo ">>> Compiling contracts..."
cd "$CONTRACTS_DIR"
forge build --force
echo "    Compilation successful."
echo ""

# -----------------------------------------------------------------------------
# Step 2: Deploy 0G (AgentManager + Vault + wire)
# -----------------------------------------------------------------------------

echo ">>> Deploying AgentManager + Vault to 0G testnet..."
forge script script/Deploy0G.s.sol \
  --rpc-url og_testnet \
  --broadcast \
  --skip-simulation \
  -vvv 2>&1 | tee /tmp/deploy-0g-output.log

# Parse addresses from broadcast JSON
OG_BROADCAST="$CONTRACTS_DIR/broadcast/Deploy0G.s.sol/16602/run-latest.json"
if [ ! -f "$OG_BROADCAST" ]; then
  echo "ERROR: 0G broadcast file not found at $OG_BROADCAST"
  exit 1
fi

# Extract created contract addresses in order: AgentManager (1st), Vault (2nd)
AGENT_MANAGER_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[0].contractAddress' "$OG_BROADCAST")
VAULT_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[1].contractAddress' "$OG_BROADCAST")

if [ "$AGENT_MANAGER_ADDRESS" = "null" ] || [ "$VAULT_ADDRESS" = "null" ]; then
  echo "ERROR: Could not parse addresses from broadcast JSON."
  echo "  AgentManager: $AGENT_MANAGER_ADDRESS"
  echo "  Vault: $VAULT_ADDRESS"
  exit 1
fi

echo ""
echo "    AgentManager: $AGENT_MANAGER_ADDRESS"
echo "    Vault:        $VAULT_ADDRESS"
echo ""

# Get the latest block number for relayer start_block config
OG_START_BLOCK=$(jq -r '.receipts[-1].blockNumber' "$OG_BROADCAST")
# Convert hex to decimal if needed
if [[ "$OG_START_BLOCK" == 0x* ]]; then
  OG_START_BLOCK=$((OG_START_BLOCK))
fi
echo "    0G start block: $OG_START_BLOCK"

# -----------------------------------------------------------------------------
# Step 3: Deploy Sepolia (Satellite + verify)
# -----------------------------------------------------------------------------

echo ""
echo ">>> Deploying Satellite to Sepolia (with Etherscan verification)..."
forge script script/DeploySepolia.s.sol \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  --skip-simulation \
  -vvv 2>&1 | tee /tmp/deploy-sepolia-output.log

SEPOLIA_BROADCAST="$CONTRACTS_DIR/broadcast/DeploySepolia.s.sol/11155111/run-latest.json"
if [ ! -f "$SEPOLIA_BROADCAST" ]; then
  echo "ERROR: Sepolia broadcast file not found at $SEPOLIA_BROADCAST"
  exit 1
fi

SATELLITE_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[0].contractAddress' "$SEPOLIA_BROADCAST")

if [ "$SATELLITE_ADDRESS" = "null" ]; then
  echo "ERROR: Could not parse Satellite address from broadcast JSON."
  exit 1
fi

SEPOLIA_START_BLOCK=$(jq -r '.receipts[-1].blockNumber' "$SEPOLIA_BROADCAST")
if [[ "$SEPOLIA_START_BLOCK" == 0x* ]]; then
  SEPOLIA_START_BLOCK=$((SEPOLIA_START_BLOCK))
fi

echo ""
echo "    Satellite:          $SATELLITE_ADDRESS"
echo "    Sepolia start block: $SEPOLIA_START_BLOCK"
echo ""

# -----------------------------------------------------------------------------
# Step 4: Update packages/contracts/.env
# -----------------------------------------------------------------------------

echo ">>> Updating packages/contracts/.env..."
sed -i '' "s|^VAULT_ADDRESS=.*|VAULT_ADDRESS=$VAULT_ADDRESS|" "$CONTRACTS_DIR/.env"
sed -i '' "s|^SATELLITE_ADDRESS=.*|SATELLITE_ADDRESS=$SATELLITE_ADDRESS|" "$CONTRACTS_DIR/.env"

# Add or update AGENT_MANAGER_ADDRESS
if grep -q "^AGENT_MANAGER_ADDRESS=" "$CONTRACTS_DIR/.env"; then
  sed -i '' "s|^AGENT_MANAGER_ADDRESS=.*|AGENT_MANAGER_ADDRESS=$AGENT_MANAGER_ADDRESS|" "$CONTRACTS_DIR/.env"
else
  echo "AGENT_MANAGER_ADDRESS=$AGENT_MANAGER_ADDRESS" >> "$CONTRACTS_DIR/.env"
fi

echo "    Done."

# -----------------------------------------------------------------------------
# Step 5: Copy ABIs to shared/abis/
# -----------------------------------------------------------------------------

echo ">>> Copying ABIs to shared/abis/..."
mkdir -p "$SHARED_DIR/abis"

# Extract just the ABI array from forge output
jq '.abi' "$CONTRACTS_DIR/out/AgentManager.sol/AgentManager.json" > "$SHARED_DIR/abis/AgentManager.json"
jq '.abi' "$CONTRACTS_DIR/out/Vault.sol/Vault.json" > "$SHARED_DIR/abis/Vault.json"
jq '.abi' "$CONTRACTS_DIR/out/Satellite.sol/Satellite.json" > "$SHARED_DIR/abis/Satellite.json"

echo "    AgentManager.json, Vault.json, Satellite.json written."

# -----------------------------------------------------------------------------
# Step 6: Update relayer config.yaml
# -----------------------------------------------------------------------------

echo ">>> Updating relayer config.yaml..."

RELAYER_CONFIG="$RELAYER_DIR/config.yaml"

# Replace Vault address (already uncommented)
sed -i '' "s|    - 0x[0-9a-fA-F]\{40\}  # Vault|    - $VAULT_ADDRESS  # Vault|" "$RELAYER_CONFIG"

# If the generic sed didn't match (no comment marker), try matching the bare address under Vault
# We'll use a Python one-liner for the more complex YAML update
python3 << PYEOF
import re, sys

config_path = "$RELAYER_CONFIG"
with open(config_path, 'r') as f:
    content = f.read()

# --- Update Vault address on 0G network ---
# Match: contracts section under network 16602, name: Vault, address line
content = re.sub(
    r'(- name: Vault\n\s+address:\n\s+- )0x[0-9a-fA-F]{40}',
    r'\g<1>$VAULT_ADDRESS',
    content
)

# --- Update 0G start_block ---
content = re.sub(
    r'(- id: 16602\n\s+start_block: )\d+',
    r'\g<1>$OG_START_BLOCK',
    content
)

# --- Uncomment AgentManager section and set address ---
# Remove comment markers from the AgentManager block
am_block_commented = re.search(r'(  # - name: AgentManager[\s\S]*?)(?=\n- id:|\nunordered)', content)
if am_block_commented:
    commented = am_block_commented.group(1)
    uncommented = re.sub(r'^  # ', '  ', commented, flags=re.MULTILINE)
    # Set the real address
    uncommented = re.sub(r'0x0{40}', '$AGENT_MANAGER_ADDRESS', uncommented)
    content = content.replace(commented, uncommented)

# --- Update Satellite address on Sepolia ---
content = re.sub(
    r'(- name: Satellite\n\s+address:\n\s+- )0x[0-9a-fA-F]{40}',
    r'\g<1>$SATELLITE_ADDRESS',
    content
)

# --- Update Sepolia start_block ---
content = re.sub(
    r'(- id: 11155111\n\s+start_block: )\d+',
    r'\g<1>$SEPOLIA_START_BLOCK',
    content
)

with open(config_path, 'w') as f:
    f.write(content)

print("    config.yaml updated.")
PYEOF

# -----------------------------------------------------------------------------
# Step 7: Update relayer .env.example
# -----------------------------------------------------------------------------

echo ">>> Updating relayer .env.example..."
sed -i '' "s|^SATELLITE_ADDRESS=.*|SATELLITE_ADDRESS=\"$SATELLITE_ADDRESS\"|" "$RELAYER_DIR/.env.example"
sed -i '' "s|^VAULT_ADDRESS=.*|VAULT_ADDRESS=\"$VAULT_ADDRESS\"|" "$RELAYER_DIR/.env.example"
sed -i '' "s|^AGENT_MANAGER_ADDRESS=.*|AGENT_MANAGER_ADDRESS=\"$AGENT_MANAGER_ADDRESS\"|" "$RELAYER_DIR/.env.example"
echo "    Done."

# -----------------------------------------------------------------------------
# Step 8: Update relayer env.ts defaults
# -----------------------------------------------------------------------------

echo ">>> Updating relayer env.ts defaults..."
RELAYER_ENV_TS="$RELAYER_DIR/src/relayer/env.ts"
sed -i '' "s|\"0xeFD9583eF616e9770ca98E4201e940315128C0BF\"|\"$SATELLITE_ADDRESS\"|" "$RELAYER_ENV_TS"
sed -i '' "s|\"0x8c7799b6E70b8Ef5Ba89eAA04cC4a82B944F839f\"|\"$VAULT_ADDRESS\"|" "$RELAYER_ENV_TS"
sed -i '' "s|\"0x0000000000000000000000000000000000000000\"|\"$AGENT_MANAGER_ADDRESS\"|" "$RELAYER_ENV_TS"
echo "    Done."

# -----------------------------------------------------------------------------
# Step 9: Update agent workspace .env files
# -----------------------------------------------------------------------------

echo ">>> Updating agent workspace .env files..."
for AGENT in agent-alpha agent-beta agent-gamma; do
  AGENT_ENV="$WORKSPACES_DIR/$AGENT/.env"
  if [ -f "$AGENT_ENV" ]; then
    sed -i '' "s|^VAULT_ADDRESS=.*|VAULT_ADDRESS=$VAULT_ADDRESS|" "$AGENT_ENV"
    sed -i '' "s|^AGENT_MANAGER_ADDRESS=.*|AGENT_MANAGER_ADDRESS=$AGENT_MANAGER_ADDRESS|" "$AGENT_ENV"
    echo "    $AGENT updated."
  else
    echo "    WARN: $AGENT_ENV not found, skipping."
  fi
done

# -----------------------------------------------------------------------------
# Step 10: Update root .env.example
# -----------------------------------------------------------------------------

echo ">>> Updating root .env.example contract addresses (clearing to blank for template)..."
# Root .env.example should have blank placeholders — it's a template
# No action needed here since it already has blanks

# -----------------------------------------------------------------------------
# Step 11: Update packages/contracts/.env.example
# -----------------------------------------------------------------------------

echo ">>> Updating packages/contracts/.env.example..."
sed -i '' "s|^SATELLITE_ADDRESS=.*|SATELLITE_ADDRESS=$SATELLITE_ADDRESS|" "$CONTRACTS_DIR/.env.example"
sed -i '' "s|^VAULT_ADDRESS=.*|VAULT_ADDRESS=$VAULT_ADDRESS|" "$CONTRACTS_DIR/.env.example"
sed -i '' "s|^AGENT_MANAGER_ADDRESS=.*|AGENT_MANAGER_ADDRESS=$AGENT_MANAGER_ADDRESS|" "$CONTRACTS_DIR/.env.example"
echo "    Done."

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

echo ""
echo "============================================="
echo " Deploy Complete!"
echo "============================================="
echo ""
echo " 0G Testnet:"
echo "   AgentManager:  $AGENT_MANAGER_ADDRESS"
echo "   Vault:         $VAULT_ADDRESS"
echo "   iNFT:          $INFT_ADDRESS"
echo ""
echo " Sepolia:"
echo "   Satellite:     $SATELLITE_ADDRESS"
echo ""
echo " Updated files:"
echo "   packages/contracts/.env"
echo "   packages/contracts/.env.example"
echo "   packages/relayer/config.yaml"
echo "   packages/relayer/.env.example"
echo "   packages/relayer/src/relayer/env.ts"
echo "   packages/shared/abis/{AgentManager,Vault,Satellite}.json"
echo "   data-seed/workspaces/agent-{alpha,beta,gamma}/.env"
echo ""
echo " Next steps:"
echo "   1. cd packages/relayer && pnpm codegen"
echo "   2. Start relayer: pnpm dev"
echo "   3. Start agents: DRY_RUN=false node data-seed/cron-trigger.js"
echo "============================================="
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/deploy-all.sh
```

- [ ] **Step 3: Verify the script is syntactically valid**

```bash
bash -n scripts/deploy-all.sh
```
Expected: no output (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-all.sh
git commit -m "feat: add deploy-all.sh script for full contract deploy + config wiring"
```

---

### Task 3: Run the Deploy Script

- [ ] **Step 1: Ensure jq is installed**

```bash
which jq || brew install jq
```

- [ ] **Step 2: Run the deploy script**

```bash
cd /Users/nick/Documents/hackathon-eth-global-2026
./scripts/deploy-all.sh
```

Watch for:
- 0G deploy: 3 transactions (CREATE AgentManager, CREATE Vault, CALL setVault, CALL fund)
- Sepolia deploy: 1 transaction (CREATE Satellite) + Etherscan verification
- All sed/python updates succeed

If Etherscan verification fails (rate limits, etc.), it can be retried later with:
```bash
forge verify-contract <SATELLITE_ADDRESS> src/Satellite.sol:Satellite \
  --chain sepolia \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,address,uint256)" \
    $UNISWAP_V3_POOL_ADDRESS $USDC_E_ADDRESS $UNISWAP_POSITION_MANAGER $UNISWAP_UNIVERSAL_ROUTER \
    $ADDRESS_RELAYER $PROTOCOL_TREASURY $IDLE_RESERVE_RATIO)
```

- [ ] **Step 3: Verify the deployed contracts on-chain**

```bash
# Check AgentManager has vault set
cast call <NEW_AGENT_MANAGER> "vault()(address)" --rpc-url https://evmrpc-testnet.0g.ai

# Check Vault has agentManager set
cast call <NEW_VAULT> "agentManager()(address)" --rpc-url https://evmrpc-testnet.0g.ai

# Check Satellite messenger
cast call <NEW_SATELLITE> "messenger()(address)" --rpc-url https://ethereum-sepolia.publicnode.com
```

All three should return the expected addresses.

- [ ] **Step 4: Verify config files were updated**

Spot-check:
```bash
grep "AGENT_MANAGER_ADDRESS" packages/contracts/.env
grep "VAULT_ADDRESS" packages/contracts/.env
grep "SATELLITE_ADDRESS" packages/contracts/.env
grep "AgentManager" packages/relayer/config.yaml | head -3
cat packages/shared/abis/AgentManager.json | jq 'length'
```

- [ ] **Step 5: Run relayer codegen**

```bash
cd packages/relayer && pnpm codegen
```

This regenerates TypeScript types for the newly uncommented AgentManager events.

- [ ] **Step 6: Commit all updated configs**

```bash
git add -A
git commit -m "deploy: fresh AgentManager + Vault on 0G, Satellite on Sepolia (verified)

All configs updated: .env files, relayer config.yaml, shared ABIs, agent workspaces."
```

---

### Task 4: Verify Relayer Builds with New Config

- [ ] **Step 1: Check relayer compiles**

```bash
cd packages/relayer && pnpm build
```

Expected: no TypeScript errors. The AgentManager handlers now have real generated types.

- [ ] **Step 2: If build fails, fix type imports**

The `generated` module types come from `pnpm codegen`. If there are mismatches between handler code and generated types, update the handler imports to match the new codegen output.

Common issue: the generated entity type names may differ slightly after codegen. Check `generated/src/Types.gen.ts` for exact type names.

- [ ] **Step 3: Commit any fixes**

```bash
git add packages/relayer/
git commit -m "fix: update relayer types after AgentManager codegen"
```
