FROM oven/bun:1-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS builder
WORKDIR /app
RUN bun add -g turbo
COPY . .
RUN turbo prune api --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/bun.lockb* ./
RUN bun install --ignore-scripts --ignore-scripts
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN bunx turbo run build --filter=api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 apijs
USER apijs

COPY --from=installer /app/package.json ./package.json
COPY --from=installer /app/bun.lock ./bun.lock
COPY --from=installer /app/turbo.json ./turbo.json
COPY --from=installer /app/apps/api/package.json ./apps/api/package.json
COPY --from=installer --chown=apijs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=installer /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/packages ./packages

CMD ["bun", "run", "apps/api/dist/index.js"]
