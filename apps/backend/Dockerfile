FROM node:24-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Build the backend ─────────────────────────────────────────────────
FROM base AS builder

COPY apps/backend/package.json apps/backend/package-lock.json* ./apps/backend/
RUN cd apps/backend && npm ci

COPY apps/backend/ ./apps/backend/
RUN cd apps/backend && npx tsc

# ── Runtime ───────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Backend build output
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/

# Scripts the backend will execute
COPY scripts/ ./scripts/

# Config + env files needed by run-epochs.mjs
COPY packages/contracts/ ./packages/contracts/
COPY data-seed/ ./data-seed/

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["node", "apps/backend/dist/index.js"]
