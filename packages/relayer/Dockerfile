FROM node:24-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
RUN corepack prepare pnpm@9.7.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm envio codegen

FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
RUN corepack prepare pnpm@9.7.1 --activate

WORKDIR /app

COPY --from=builder /app .

CMD ["pnpm", "envio", "start"]