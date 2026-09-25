FROM oven/bun:1-alpine AS base
ENV NODE_ENV=production

FROM base AS builder
WORKDIR /app
RUN bun add -g turbo
COPY . .
RUN turbo prune ingestion --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/bun.lockb* ./
RUN bun install
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN bun run db:generate
RUN bunx turbo run build --filter=ingestion...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeuser
USER nodeuser

COPY --from=installer --chown=nodeuser:nodejs /app .

WORKDIR /app/apps/ingestion
CMD ["node", "dist/index.js"]
