FROM oven/bun:1-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS builder
WORKDIR /app
RUN bun add -g turbo
COPY . .
RUN turbo prune bot --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/bun.lockb* ./
RUN bun install
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN bun run db:generate
RUN bunx turbo run build --filter=bot...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

COPY --from=installer /app/apps/bot/next.config.js .
COPY --from=installer /app/apps/bot/package.json .

COPY --from=installer --chown=nextjs:nodejs /app/apps/bot/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/bot/.next/static ./apps/bot/.next/static
# Provide full node_modules so Bun's symlinked Prisma engine can be found
COPY --from=installer --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=installer --chown=nextjs:nodejs /app/packages/db ./packages/db

CMD ["bun", "run", "apps/bot/server.js"]
