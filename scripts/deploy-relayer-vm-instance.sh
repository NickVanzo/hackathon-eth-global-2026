#!/usr/bin/env bash
set -euo pipefail

# Simple one-command deploy for hackathon use.
# Packages local relayer, uploads to VM, starts docker compose,
# then updates frontend env with the reachable Hasura endpoint.

VM_NAME="${VM_NAME:-${1:-envio-relayer-vm}}"
ZONE="${ZONE:-${2:-us-central1-a}}"
PROJECT="${PROJECT:-${3:-subgraph-mcp}}"

HASURA_SECRET="${HASURA_SECRET:-testing}"
HASURA_EXTERNAL_PORT="${HASURA_EXTERNAL_PORT:-8081}"
# Domain for Caddy HTTPS — defaults to nip.io wildcard DNS
CADDY_DOMAIN="${CADDY_DOMAIN:-}"

RELAYER_DIR="packages/relayer"
FRONTEND_ENV_FILE="apps/frontend/.env.local"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"

  awk -F= -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $1 == key {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (updated == 0) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"

  mv "$tmp" "$file"
}

require_cmd gcloud
require_cmd tar
require_cmd awk
require_cmd mktemp
require_cmd curl
require_cmd python3

if [[ ! -d "$RELAYER_DIR" ]]; then
  echo "Relayer directory not found: $RELAYER_DIR" >&2
  exit 1
fi

if [[ ! -f "$RELAYER_DIR/docker-compose.yaml" ]]; then
  echo "Missing docker compose file in $RELAYER_DIR" >&2
  exit 1
fi

ARCHIVE="/tmp/relayer-$(date +%Y%m%d-%H%M%S).tgz"
TMP_ENV="/tmp/relayer-env-$(date +%Y%m%d-%H%M%S).env"

if [[ -f "$RELAYER_DIR/.env" ]]; then
  cp "$RELAYER_DIR/.env" "$TMP_ENV"
else
  cp "$RELAYER_DIR/.env.example" "$TMP_ENV"
fi

upsert_env_var "$TMP_ENV" "HASURA_GRAPHQL_ADMIN_SECRET" "$HASURA_SECRET"
upsert_env_var "$TMP_ENV" "HASURA_EXTERNAL_PORT" "$HASURA_EXTERNAL_PORT"

# Resolve Caddy domain — use nip.io if no custom domain provided
if [[ -z "$CADDY_DOMAIN" ]]; then
  echo "No CADDY_DOMAIN set — will derive nip.io domain from VM IP after upload"
fi

echo "[1/9] Packaging relayer from $RELAYER_DIR"
tar \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='generated' \
  -czf "$ARCHIVE" \
  -C "$RELAYER_DIR" \
  .

echo "[2/9] Uploading files to VM: $VM_NAME"
gcloud compute scp \
  "$ARCHIVE" \
  "$TMP_ENV" \
  "$VM_NAME:~/" \
  --zone "$ZONE" \
  --project "$PROJECT"

REMOTE_ARCHIVE="$(basename "$ARCHIVE")"
REMOTE_ENV="$(basename "$TMP_ENV")"

echo "[3/9] Getting VM public IP"
VM_IP="$(gcloud compute instances describe "$VM_NAME" --zone "$ZONE" --project "$PROJECT" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

# Build nip.io domain from IP (replace dots with dashes)
if [[ -z "$CADDY_DOMAIN" ]]; then
  CADDY_DOMAIN="$(echo "$VM_IP" | tr '.' '-').nip.io"
fi
echo "  HTTPS domain: $CADDY_DOMAIN"

echo "[4/9] Ensuring GCP firewall allows HTTPS (443) and HTTP (80)"
if ! gcloud compute firewall-rules describe allow-caddy-https --project "$PROJECT" &>/dev/null; then
  gcloud compute firewall-rules create allow-caddy-https \
    --project "$PROJECT" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:80,tcp:443 \
    --source-ranges=0.0.0.0/0 \
    --description="Allow HTTP/HTTPS for Caddy reverse proxy"
  echo "  Firewall rule created"
else
  echo "  Firewall rule already exists"
fi

echo "[5/9] Starting relayer stack on VM"
gcloud compute ssh "$VM_NAME" \
  --zone "$ZONE" \
  --project "$PROJECT" \
  --command "set -euo pipefail; \
    rm -rf ~/relayer && mkdir -p ~/relayer; \
    tar -xzf ~/$REMOTE_ARCHIVE -C ~/relayer; \
    mv ~/$REMOTE_ENV ~/relayer/.env; \
    cd ~/relayer; \
    echo 'CADDY_DOMAIN=$CADDY_DOMAIN' >> .env; \
    sudo docker compose up -d --build; \
    sudo docker compose ps"

HASURA_URL="https://$CADDY_DOMAIN/v1/graphql"

echo "[6/9] Waiting for HTTPS to become available..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w '%{http_code}' --max-time 3 "https://$CADDY_DOMAIN/healthz" 2>/dev/null | grep -qE '200|404'; then
    echo "  HTTPS is up!"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "  Warning: HTTPS not responding yet — Caddy may still be getting the TLS cert."
    echo "  Try again in a minute: curl https://$CADDY_DOMAIN/v1/graphql"
  fi
  sleep 5
done

HASURA_METADATA_URL="https://$CADDY_DOMAIN/v1/metadata"

echo "[7/9] Waiting for indexer to create tables..."
for i in $(seq 1 40); do
  TABLE_COUNT="$(gcloud compute ssh "$VM_NAME" \
    --zone "$ZONE" --project "$PROJECT" \
    --command "sudo docker exec relayer-envio-postgres-1 psql -U postgres -d envio-dev -tAc \"SELECT count(*) FROM pg_tables WHERE schemaname='envio';\"" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$TABLE_COUNT" -gt 5 ]] 2>/dev/null; then
    echo "  Found $TABLE_COUNT tables in envio schema"
    break
  fi
  if [[ $i -eq 40 ]]; then
    echo "  Warning: tables not yet created after 200s — indexer may still be starting."
  fi
  sleep 5
done

echo "[8/9] Tracking tables in Hasura and setting custom root fields..."
# Derive table names from schema.graphql so this stays in sync automatically
SCHEMA_FILE="$RELAYER_DIR/schema.graphql"
if [[ -f "$SCHEMA_FILE" ]]; then
  ENTITY_TABLES="$(grep -oP '^type \K\S+' "$SCHEMA_FILE" | sort)"
else
  echo "  Warning: schema.graphql not found, using hardcoded table list"
  ENTITY_TABLES=""
fi

# Envio internal tables that also need tracking
INTERNAL_TABLES="raw_events dynamic_contract_registry persisted_state envio_chains envio_checkpoints chain_metadata _meta"

ALL_TABLES="$ENTITY_TABLES"
for t in $INTERNAL_TABLES; do
  ALL_TABLES="$ALL_TABLES
$t"
done

python3 -c "
import json, sys, subprocess

tables = [t.strip() for t in '''$ALL_TABLES'''.strip().split('\n') if t.strip()]
metadata_url = '$HASURA_METADATA_URL'
secret = '$HASURA_SECRET'

# Step 1: Track all tables
track_args = []
for t in tables:
    track_args.append({
        'type': 'pg_track_table',
        'args': {
            'source': 'default',
            'table': {'schema': 'envio', 'name': t}
        }
    })

req = json.dumps({'type': 'bulk', 'args': track_args})
result = subprocess.run(
    ['curl', '-s', '-X', 'POST', metadata_url,
     '-H', 'Content-Type: application/json',
     '-H', f'x-hasura-admin-secret: {secret}',
     '-d', req],
    capture_output=True, text=True
)
resp = json.loads(result.stdout)
tracked = sum(1 for r in resp if isinstance(r, dict) and r.get('message') == 'success')
already = sum(1 for r in resp if isinstance(r, dict) and 'already tracked' in r.get('message', '') or 'already-tracked' in str(r.get('code', '')))
print(f'  Tracked {tracked} new tables ({already} already tracked)')

# Step 2: Set custom root fields (strip envio_ prefix)
custom_args = []
for t in tables:
    custom_args.append({
        'type': 'pg_set_table_customization',
        'args': {
            'source': 'default',
            'table': {'schema': 'envio', 'name': t},
            'configuration': {
                'custom_root_fields': {
                    'select': t,
                    'select_by_pk': t + '_by_pk',
                    'select_aggregate': t + '_aggregate'
                }
            }
        }
    })

req = json.dumps({'type': 'bulk', 'args': custom_args})
result = subprocess.run(
    ['curl', '-s', '-X', 'POST', metadata_url,
     '-H', 'Content-Type: application/json',
     '-H', f'x-hasura-admin-secret: {secret}',
     '-d', req],
    capture_output=True, text=True
)
resp = json.loads(result.stdout)
customized = sum(1 for r in resp if isinstance(r, dict) and r.get('message') == 'success')
print(f'  Customized root fields for {customized} tables')

# Step 3: Reload metadata
subprocess.run(
    ['curl', '-s', '-X', 'POST', metadata_url,
     '-H', 'Content-Type: application/json',
     '-H', f'x-hasura-admin-secret: {secret}',
     '-d', json.dumps({'type': 'reload_metadata', 'args': {}})],
    capture_output=True, text=True
)
print('  Metadata reloaded')
"

# Quick smoke test
echo -n "  Smoke test: "
SMOKE="$(curl -s -X POST "https://$CADDY_DOMAIN/v1/graphql" \
  -H "Content-Type: application/json" \
  -H "x-hasura-admin-secret: $HASURA_SECRET" \
  -d '{"query":"{ AgentPerformanceSnapshot(limit:1) { id } }"}' 2>/dev/null)"
if echo "$SMOKE" | grep -q '"AgentPerformanceSnapshot"'; then
  echo "OK — AgentPerformanceSnapshot query works"
else
  echo "WARN — query returned: $SMOKE"
fi

echo "[9/9] Updating frontend env at $FRONTEND_ENV_FILE"
if [[ ! -f "$FRONTEND_ENV_FILE" ]]; then
  touch "$FRONTEND_ENV_FILE"
fi

upsert_env_var "$FRONTEND_ENV_FILE" "NEXT_PUBLIC_HASURA_URL" "$HASURA_URL"
upsert_env_var "$FRONTEND_ENV_FILE" "NEXT_PUBLIC_HASURA_ADMIN_SECRET" "$HASURA_SECRET"

echo
echo "Relayer deployed successfully with HTTPS!"
echo "Hasura URL: $HASURA_URL"
echo "Hasura Admin Secret: $HASURA_SECRET"
echo
echo "Frontend env updated: $FRONTEND_ENV_FILE"
