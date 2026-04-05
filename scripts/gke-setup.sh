#!/usr/bin/env bash
#
# GKE Autopilot full setup: cluster + relayer + subgraph
#
# Usage:
#   GCP_PROJECT_ID=my-project ./scripts/gke-setup.sh
#
# Optional overrides:
#   GCP_REGION          (default: us-central1)
#   GKE_CLUSTER_NAME    (default: arena-autopilot)
#   AR_REPO_NAME        (default: arena-images)
#   SUBGRAPH_DOMAIN     (default: subgraph.arena.example.com)
#
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
CLUSTER_NAME="${GKE_CLUSTER_NAME:-arena-autopilot}"
REPO_NAME="${AR_REPO_NAME:-arena-images}"
SUBGRAPH_DOMAIN="${SUBGRAPH_DOMAIN:-subgraph.arena.example.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================"
echo "  Arena GKE Autopilot Setup"
echo "============================================"
echo "  Project:   $PROJECT_ID"
echo "  Region:    $REGION"
echo "  Cluster:   $CLUSTER_NAME"
echo "  AR Repo:   $REPO_NAME"
echo "  Domain:    $SUBGRAPH_DOMAIN"
echo "============================================"
echo ""

# ─── 1. Enable required GCP APIs ─────────────────────────────────────
echo "==> [1/8] Enabling GCP APIs..."
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="$PROJECT_ID"

# ─── 2. Create Artifact Registry ─────────────────────────────────────
echo "==> [2/8] Creating Artifact Registry..."
gcloud artifacts repositories describe "$REPO_NAME" \
  --location="$REGION" \
  --project="$PROJECT_ID" >/dev/null 2>&1 \
|| gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --description="Docker images for Arena platform"

# ─── 3. Create GKE Autopilot cluster ─────────────────────────────────
echo "==> [3/8] Creating GKE Autopilot cluster (this takes ~5 min)..."
if gcloud container clusters describe "$CLUSTER_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "    Cluster already exists, skipping."
else
  gcloud container clusters create-auto "$CLUSTER_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --release-channel=regular
fi

# ─── 4. Get cluster credentials ──────────────────────────────────────
echo "==> [4/8] Fetching cluster credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID"

# ─── 5. Reserve a static IP for the subgraph ingress ─────────────────
echo "==> [5/8] Reserving static IP for Hasura ingress..."
if gcloud compute addresses describe arena-subgraph-ip \
  --global --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "    Static IP already exists."
else
  gcloud compute addresses create arena-subgraph-ip \
    --global \
    --project="$PROJECT_ID"
fi

STATIC_IP=$(gcloud compute addresses describe arena-subgraph-ip \
  --global --project="$PROJECT_ID" --format='value(address)')
echo "    Static IP: $STATIC_IP"

# ─── 6. Build & push relayer image ───────────────────────────────────
echo "==> [6/8] Building and pushing relayer image..."
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/relayer:latest"

docker build \
  -t "$IMAGE_TAG" \
  -f "$ROOT_DIR/packages/relayer/Dockerfile" \
  "$ROOT_DIR/packages/relayer"

docker push "$IMAGE_TAG"

# Patch the deployment with the real image
echo "    Patching relayer deployment image..."
sed -i "s|image: relayer:latest|image: ${IMAGE_TAG}|" \
  "$ROOT_DIR/packages/relayer/k8s/04-deployment.yaml"

# ─── 7. Patch subgraph domain ────────────────────────────────────────
echo "==> [7/8] Patching subgraph domain to: $SUBGRAPH_DOMAIN"
sed -i "s|subgraph.arena.example.com|${SUBGRAPH_DOMAIN}|g" \
  "$ROOT_DIR/packages/subgraph/k8s/05-ingress.yaml"

# ─── 8. Deploy workloads ─────────────────────────────────────────────
echo "==> [8/8] Deploying workloads..."

echo "    Applying relayer namespace (Postgres + Envio relayer)..."
kubectl apply -k "$ROOT_DIR/packages/relayer/k8s/"

echo "    Waiting for Postgres to be ready..."
kubectl rollout status statefulset/postgres -n arena-relayer --timeout=120s

echo "    Applying subgraph namespace (Hasura)..."
kubectl apply -k "$ROOT_DIR/packages/subgraph/k8s/"

echo "    Waiting for Hasura to be ready..."
kubectl rollout status deployment/hasura -n arena-subgraph --timeout=120s

echo "    Waiting for relayer to be ready..."
kubectl rollout status deployment/relayer -n arena-relayer --timeout=180s

# ─── Done ─────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
echo ""
echo "  Postgres:  postgres-service.arena-relayer.svc.cluster.local:5432"
echo "  Hasura:    hasura-service.arena-subgraph.svc.cluster.local:8080"
echo "  Relayer:   running in arena-relayer namespace"
echo ""
echo "  Hasura external IP: $STATIC_IP"
echo "  Point DNS '$SUBGRAPH_DOMAIN' -> $STATIC_IP"
echo "  HTTPS cert will auto-provision once DNS resolves."
echo ""
echo "  Useful commands:"
echo "    kubectl get pods -n arena-relayer"
echo "    kubectl get pods -n arena-subgraph"
echo "    kubectl logs -f deployment/relayer -n arena-relayer"
echo "    kubectl logs -f deployment/hasura -n arena-subgraph"
echo ""
