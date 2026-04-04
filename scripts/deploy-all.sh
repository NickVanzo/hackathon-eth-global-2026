#!/usr/bin/env bash
# deploy-all.sh — Compile, deploy, and wire all contracts for the hackathon
#
# Deploys:
#   1. AgentManager + Vault  → 0G testnet  (chain 16602)
#   2. Satellite              → Sepolia     (chain 11155111)
#
# Then updates every config file in the repo with the new addresses.
#
# Usage:
#   ./scripts/deploy-all.sh              # deploy both chains
#   SKIP_0G=1 ./scripts/deploy-all.sh    # skip 0G, deploy Sepolia only
#   SKIP_SEP=1 ./scripts/deploy-all.sh   # skip Sepolia, deploy 0G only
#   DRY_RUN=1 ./scripts/deploy-all.sh    # compile only, no deployment

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
RELAYER_DIR="$REPO_ROOT/packages/relayer"
SHARED_DIR="$REPO_ROOT/packages/shared"

# Constant
INFT_ADDRESS="0x2700F6A3e505402C9daB154C5c6ab9cAEC98EF1F"

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[0;33m'
CYN='\033[0;36m'
RST='\033[0m'

info()  { echo -e "${CYN}[INFO]${RST}  $*"; }
ok()    { echo -e "${GRN}[OK]${RST}    $*"; }
warn()  { echo -e "${YEL}[WARN]${RST}  $*"; }
die()   { echo -e "${RED}[FAIL]${RST}  $*" >&2; exit 1; }

# ─── Pre-flight checks ───────────────────────────────────────────────────────
command -v forge >/dev/null 2>&1 || die "forge not found — install Foundry first"
command -v jq    >/dev/null 2>&1 || die "jq not found — brew install jq"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

[[ -f "$CONTRACTS_DIR/.env" ]] || die "Missing $CONTRACTS_DIR/.env"

# Source the contracts .env so forge picks up env vars
set -a
# shellcheck disable=SC1091
source "$CONTRACTS_DIR/.env"
set +a

# ─── Step 1: Compile ─────────────────────────────────────────────────────────
info "Compiling contracts..."
(cd "$CONTRACTS_DIR" && forge build) || die "Compilation failed"
ok "Contracts compiled"

if [[ "${DRY_RUN:-}" == "1" ]]; then
    info "DRY_RUN=1 — skipping deployment"
    exit 0
fi

# ─── Step 2: Deploy to 0G testnet ────────────────────────────────────────────
OG_BROADCAST="$CONTRACTS_DIR/broadcast/Deploy0G.s.sol/16602/run-latest.json"

if [[ "${SKIP_0G:-}" != "1" ]]; then
    info "Deploying AgentManager + Vault to 0G testnet (chain 16602)..."
    (cd "$CONTRACTS_DIR" && forge script script/Deploy0G.s.sol \
        --rpc-url og_testnet \
        --broadcast \
        --skip-simulation \
        --legacy \
        --gas-price 3000000000 \
        2>&1 | tee /tmp/deploy-0g-output.log) || die "0G deployment failed"
    ok "0G deployment complete"
else
    warn "SKIP_0G=1 — skipping 0G deployment"
fi

# ─── Step 3: Deploy Satellite to Sepolia ─────────────────────────────────────
SEP_BROADCAST="$CONTRACTS_DIR/broadcast/DeploySepolia.s.sol/11155111/run-latest.json"

if [[ "${SKIP_SEP:-}" != "1" ]]; then
    info "Deploying Satellite to Sepolia (chain 11155111)..."
    (cd "$CONTRACTS_DIR" && forge script script/DeploySepolia.s.sol \
        --rpc-url sepolia \
        --broadcast \
        --skip-simulation \
        --verify \
        2>&1 | tee /tmp/deploy-sepolia-output.log) || die "Sepolia deployment failed"
    ok "Sepolia deployment complete"
else
    warn "SKIP_SEP=1 — skipping Sepolia deployment"
fi

# ─── Step 4: Parse deployed addresses from broadcast JSON ────────────────────
info "Parsing deployed addresses from broadcast JSON..."

# Helper: convert potential hex block number to decimal
hex_to_dec() {
    local val="$1"
    if [[ "$val" == 0x* ]]; then
        printf '%d' "$val"
    else
        echo "$val"
    fi
}

# --- 0G addresses ---
if [[ -f "$OG_BROADCAST" ]]; then
    # Deploy0G creates AgentManager first (index 0), Vault second (index 1)
    AGENT_MANAGER_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[0].contractAddress' "$OG_BROADCAST")
    VAULT_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[1].contractAddress' "$OG_BROADCAST")
    OG_BLOCK_RAW=$(jq -r '.receipts[-1].blockNumber' "$OG_BROADCAST")
    OG_START_BLOCK=$(hex_to_dec "$OG_BLOCK_RAW")

    [[ "$AGENT_MANAGER_ADDRESS" == "null" || -z "$AGENT_MANAGER_ADDRESS" ]] && die "Could not parse AgentManager address from broadcast"
    [[ "$VAULT_ADDRESS" == "null" || -z "$VAULT_ADDRESS" ]] && die "Could not parse Vault address from broadcast"

    ok "AgentManager : $AGENT_MANAGER_ADDRESS"
    ok "Vault        : $VAULT_ADDRESS"
    ok "0G start_block: $OG_START_BLOCK"
else
    warn "0G broadcast not found at $OG_BROADCAST — using existing env values"
    AGENT_MANAGER_ADDRESS="${AGENT_MANAGER_ADDRESS:-0x0000000000000000000000000000000000000000}"
    VAULT_ADDRESS="${VAULT_ADDRESS:-0x0000000000000000000000000000000000000000}"
    OG_START_BLOCK=""
fi

# --- Sepolia addresses ---
if [[ -f "$SEP_BROADCAST" ]]; then
    SATELLITE_ADDRESS=$(jq -r '[.transactions[] | select(.transactionType == "CREATE")] | .[0].contractAddress' "$SEP_BROADCAST")
    SEP_BLOCK_RAW=$(jq -r '.receipts[-1].blockNumber' "$SEP_BROADCAST")
    SEP_START_BLOCK=$(hex_to_dec "$SEP_BLOCK_RAW")

    [[ "$SATELLITE_ADDRESS" == "null" || -z "$SATELLITE_ADDRESS" ]] && die "Could not parse Satellite address from broadcast"

    ok "Satellite    : $SATELLITE_ADDRESS"
    ok "Sepolia start_block: $SEP_START_BLOCK"
else
    warn "Sepolia broadcast not found at $SEP_BROADCAST — using existing env values"
    SATELLITE_ADDRESS="${SATELLITE_ADDRESS:-0x0000000000000000000000000000000000000000}"
    SEP_START_BLOCK=""
fi

# ─── Step 5: Update config files ─────────────────────────────────────────────
info "Updating config files with new addresses..."

# --- 5a. packages/contracts/.env ---
update_env_var() {
    local file="$1" key="$2" value="$3"
    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    else
        # Ensure file ends with a newline before appending
        [[ -s "$file" && "$(tail -c1 "$file")" != "" ]] && echo "" >> "$file"
        echo "${key}=${value}" >> "$file"
    fi
}

update_env_var "$CONTRACTS_DIR/.env" "VAULT_ADDRESS" "$VAULT_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env" "SATELLITE_ADDRESS" "$SATELLITE_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env" "AGENT_MANAGER_ADDRESS" "$AGENT_MANAGER_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env" "INFT_ADDRESS" "$INFT_ADDRESS"
ok "Updated packages/contracts/.env"

# --- 5b. packages/contracts/.env.example ---
update_env_var "$CONTRACTS_DIR/.env.example" "VAULT_ADDRESS" "$VAULT_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env.example" "SATELLITE_ADDRESS" "$SATELLITE_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env.example" "AGENT_MANAGER_ADDRESS" "$AGENT_MANAGER_ADDRESS"
update_env_var "$CONTRACTS_DIR/.env.example" "INFT_ADDRESS" "$INFT_ADDRESS"
ok "Updated packages/contracts/.env.example"

# --- 5c. packages/shared/abis/ — extract .abi from forge output ---
info "Copying ABIs to packages/shared/abis/..."
for contract in AgentManager Vault Satellite; do
    src="$CONTRACTS_DIR/out/${contract}.sol/${contract}.json"
    dst="$SHARED_DIR/abis/${contract}.json"
    if [[ -f "$src" ]]; then
        jq '.abi' "$src" > "$dst"
        ok "  $contract ABI → $dst"
    else
        warn "  $contract build artifact not found at $src"
    fi
done

# --- 5d. packages/relayer/config.yaml — use Python3 for YAML transforms ---
info "Updating packages/relayer/config.yaml..."
python3 - "$RELAYER_DIR/config.yaml" "$VAULT_ADDRESS" "$AGENT_MANAGER_ADDRESS" "$SATELLITE_ADDRESS" "${OG_START_BLOCK:-}" "${SEP_START_BLOCK:-}" <<'PYEOF'
import sys, re

config_path = sys.argv[1]
vault_addr = sys.argv[2]
agent_mgr_addr = sys.argv[3]
satellite_addr = sys.argv[4]
og_start_block = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
sep_start_block = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else None

with open(config_path, 'r') as f:
    content = f.read()

# Update Vault address (under network 16602)
# The Vault address appears as "- 0x..." under the Vault contract in the 16602 block
content = re.sub(
    r'(- name: Vault\s+address:\s*\n\s+- )0x[0-9a-fA-F]+',
    r'\g<1>' + vault_addr,
    content
)

# Update AgentManager address
# Handle both commented and uncommented forms
content = re.sub(
    r'(- name: AgentManager\s+address:\s*\n\s+- )0x[0-9a-fA-F]+',
    r'\g<1>' + agent_mgr_addr,
    content
)

# Uncomment AgentManager block if still commented
# Match lines starting with "  # - name: AgentManager" etc.
lines = content.split('\n')
new_lines = []
in_commented_agent_manager = False
for line in lines:
    # Detect start of commented AgentManager block
    if re.match(r'^  # - name: AgentManager', line):
        in_commented_agent_manager = True
        new_lines.append(re.sub(r'^  # ', '  ', line))
        continue
    # If inside the commented block, uncomment lines that start with "  #"
    if in_commented_agent_manager:
        if re.match(r'^  #\s', line) or re.match(r'^  #$', line):
            uncommented = re.sub(r'^  # ?', '  ', line)
            # Replace placeholder address
            uncommented = re.sub(r'0x0{40}', agent_mgr_addr, uncommented)
            new_lines.append(uncommented)
            continue
        else:
            in_commented_agent_manager = False

    new_lines.append(line)

content = '\n'.join(new_lines)

# Update Satellite address (under network 11155111)
content = re.sub(
    r'(- name: Satellite\s+address:\s*\n\s+- )0x[0-9a-fA-F]+',
    r'\g<1>' + satellite_addr,
    content
)

# Update start_block values if provided
if og_start_block:
    # Replace start_block under the 16602 network
    content = re.sub(
        r'(- id: 16602\s*\n\s+start_block: )\d+',
        r'\g<1>' + og_start_block,
        content
    )

if sep_start_block:
    # Replace start_block under the 11155111 network
    content = re.sub(
        r'(- id: 11155111\s*\n\s+start_block: )\d+',
        r'\g<1>' + sep_start_block,
        content
    )

with open(config_path, 'w') as f:
    f.write(content)

print("config.yaml updated successfully")
PYEOF
ok "Updated packages/relayer/config.yaml"

# --- 5e. packages/relayer/.env.example ---
update_quoted_env_var() {
    local file="$1" key="$2" value="$3"
    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i '' "s|^${key}=.*|${key}=\"${value}\"|" "$file"
    else
        echo "${key}=\"${value}\"" >> "$file"
    fi
}

update_quoted_env_var "$RELAYER_DIR/.env.example" "SATELLITE_ADDRESS" "$SATELLITE_ADDRESS"
update_quoted_env_var "$RELAYER_DIR/.env.example" "VAULT_ADDRESS" "$VAULT_ADDRESS"
update_quoted_env_var "$RELAYER_DIR/.env.example" "AGENT_MANAGER_ADDRESS" "$AGENT_MANAGER_ADDRESS"
ok "Updated packages/relayer/.env.example"

# --- 5f. packages/relayer/src/relayer/env.ts — update hardcoded fallbacks ---
info "Updating packages/relayer/src/relayer/env.ts fallback addresses..."
ENV_TS="$RELAYER_DIR/src/relayer/env.ts"
if [[ -f "$ENV_TS" ]]; then
    python3 - "$ENV_TS" "$SATELLITE_ADDRESS" "$VAULT_ADDRESS" "$AGENT_MANAGER_ADDRESS" <<'PYEOF'
import sys, re

env_ts_path = sys.argv[1]
satellite = sys.argv[2]
vault = sys.argv[3]
agent_mgr = sys.argv[4]

with open(env_ts_path, 'r') as f:
    content = f.read()

# Replace the fallback for SATELLITE_ADDRESS
content = re.sub(
    r'(export const SATELLITE_ADDRESS\s*=\s*\n\s*\(process\.env\.SATELLITE_ADDRESS as `0x\$\{string\}`\) \|\|\s*\n\s*)"0x[0-9a-fA-F]+"',
    r'\1"' + satellite + '"',
    content
)

# Replace the fallback for VAULT_ADDRESS
content = re.sub(
    r'(export const VAULT_ADDRESS\s*=\s*\n\s*\(process\.env\.VAULT_ADDRESS as `0x\$\{string\}`\) \|\|\s*\n\s*)"0x[0-9a-fA-F]+"',
    r'\1"' + vault + '"',
    content
)

# Replace the fallback for AGENT_MANAGER_ADDRESS
content = re.sub(
    r'(export const AGENT_MANAGER_ADDRESS\s*=\s*\n\s*\(process\.env\.AGENT_MANAGER_ADDRESS as `0x\$\{string\}`\) \|\|\s*\n\s*)"0x[0-9a-fA-F]+"',
    r'\1"' + agent_mgr + '"',
    content
)

with open(env_ts_path, 'w') as f:
    f.write(content)

print("env.ts updated successfully")
PYEOF
    ok "Updated packages/relayer/src/relayer/env.ts"
else
    warn "env.ts not found at $ENV_TS"
fi

# --- 5g. data-seed/workspaces/agent-{alpha,beta,gamma}/.env ---
for agent in alpha beta gamma; do
    agent_env="$REPO_ROOT/data-seed/workspaces/agent-${agent}/.env"
    if [[ -f "$agent_env" ]]; then
        update_env_var "$agent_env" "VAULT_ADDRESS" "$VAULT_ADDRESS"
        update_env_var "$agent_env" "AGENT_MANAGER_ADDRESS" "$AGENT_MANAGER_ADDRESS"
        ok "Updated data-seed/workspaces/agent-${agent}/.env"
    else
        warn "Agent env not found: $agent_env"
    fi
done

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
info "=========================================="
info "  Deployment & config wiring complete!"
info "=========================================="
echo ""
info "Deployed addresses:"
info "  AgentManager : $AGENT_MANAGER_ADDRESS"
info "  Vault        : $VAULT_ADDRESS"
info "  Satellite    : $SATELLITE_ADDRESS"
info "  iNFT         : $INFT_ADDRESS"
echo ""
info "Updated files:"
info "  - packages/contracts/.env"
info "  - packages/contracts/.env.example"
info "  - packages/shared/abis/{AgentManager,Vault,Satellite}.json"
info "  - packages/relayer/config.yaml"
info "  - packages/relayer/.env.example"
info "  - packages/relayer/src/relayer/env.ts"
info "  - data-seed/workspaces/agent-{alpha,beta,gamma}/.env"
