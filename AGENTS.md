# AGENTS.md — AI Context for this project

## Project Overview

This is a full-stack Discord bot and admin dashboard. The codebase is a Turborepo monorepo with 4 Next.js apps and 3 shared packages.

## Tech Stack Constraints

- **TypeScript only** — strict mode, no `any` anywhere
- **Prisma 6.6.0** — all DB access through `@repo/db`
- **Redis Streams** via ioredis — all queueing through `@repo/redis`
- **No inline types** — all types live in `packages/types/src/index.ts`
- **Vercel free tier** — no features requiring paid plans

## Service Responsibilities

- `apps/ingestion` — Discord webhook only. Must respond within 3s. No DB writes here.
- `apps/bot` — Serverless Lambda Actor (`/api/worker`). Fanout logic (Discord reply, Slack, DB log). Features 1-Lambda-per-channel execution and Redis LRU user sessions. Runs up to 60s per invocation.
- `apps/dashboard` — Admin UI behind JWT auth. Reads logs from SSE stream (Redis pub/sub) for live updates, DB for history.
- `apps/monitor` — Health checks for Redis and DB. Stateless.

## Key Patterns

### Redis Streams & Idempotency
- Queue operations go through `packages/redis/src/streams.ts`.
- `apps/bot` uses Redis TTL state machine (`claimed` → `discord_done` → `ai_done` → `db_queued`) for crash recovery without double processing.
- DB writes are batched using `BatchDbWriter` to minimize Neon connections.

### Serverless Actor Pattern (Channel Specific)
- Ingestion triggers an asynchronous HTTP request to `apps/bot` for a specific `channelId`.
- The bot Lambda runs a loop pulling from `stream:interactions:{channelId}`.
- It uses a Redis TTL lock (`worker:active:{channelId}`) to ensure only 1 Lambda processes a channel concurrently. It dies after 20s of inactivity.

### Live SSE Dashboard Logs
- `apps/bot` pushes completed interactions to a capped Redis list (`dashboard:logs:latest`) and a pub/sub channel.
- `apps/dashboard/src/app/api/logs/stream/route.ts` connects to these to stream live JSON events to the admin UI.

### AI Context (LRU Sessions)
- AI summarization uses a rolling session stored in Redis (`session:user:channel`).
- TTL is 30 minutes, refreshed on every interaction. Maintains context of the conversation.

### Deduplication
Every incoming interaction MUST be checked with `isDuplicate(interactionId)` before processing. This uses Redis SET NX with 24h TTL.

### Security
- Discord Ed25519 signature MUST be verified on every request in ingestion
- JWT session token stored in httpOnly cookie
- Bot token, public key, webhook URLs NEVER go client-side

## File Structure Rules

- New Discord payload types → `packages/types/src/index.ts`
- New DB models → `packages/db/prisma/schema.prisma` + run `db:generate`
- New Redis utilities → `packages/redis/src/streams.ts`
- Service-specific helpers → `apps/<service>/src/lib/`
