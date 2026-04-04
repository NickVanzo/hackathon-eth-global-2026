FROM node:24-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
RUN corepack prepare pnpm@9.7.1 --activate

WORKDIR /app

FROM base AS builder

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm envio codegen
RUN pnpm prune --prod

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    ENVIO_INDEXER_HOST=0.0.0.0 \
    TUI_OFF=true

WORKDIR /app

COPY --from=builder /app .
RUN chown -R node:node /app

USER node

EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["sh", "-c", "ENVIO_INDEXER_PORT=${PORT:-8080} pnpm envio start"]