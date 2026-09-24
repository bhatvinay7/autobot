FROM oven/bun:1-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

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
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=installer /app/apps/ingestion/next.config.js .
COPY --from=installer /app/apps/ingestion/package.json .
COPY --from=installer --chown=nextjs:nodejs /app/apps/ingestion/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/ingestion/.next/static ./apps/ingestion/.next/static


CMD ["bun", "run", "apps/ingestion/server.js"]
