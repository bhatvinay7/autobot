# Automate — Discord Bot + Dashboard

A production-grade Discord bot interaction system built with Next.js, TypeScript, Neon Postgres, and Redis Streams. Features an admin dashboard, fanout architecture, and full observability.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Discord (slash command)             │
└───────────────────────┬──────────────────────────────┘
                        │ HTTPS POST
                        ▼
          ┌─────────────────────────┐
          │   apps/ingestion        │  ← Vercel (Serverless)
          │   Verify Ed25519 sig    │
          │   Dedup + store token   │
          │   ACK (type 5) <3s      │
          │   → Redis Stream per    │
          │       channel           │
          └────────────┬────────────┘
                       │ Async Fetch Trigger
                       ▼
          ┌─────────────────────────┐
          │   apps/bot              │  ← Vercel (Serverless Lambda)
          │   1 Lambda per Channel  │
          │   Runs up to 60s        │
          │   LRU User Sessions     │
          │   AI context enrichment │
          │   DB Batch Writer       │
          └────────────┬────────────┘
                       │ Redis Pub/Sub & Capped List
          ┌────────────▼────────────┐
          │   apps/dashboard        │  ← Vercel (Serverless)
          │   Admin login (JWT)     │
          │   Live SSE interaction  │
          │   log (Redis cached)    │
          └─────────────────────────┘
          ┌─────────────────────────┐
          │   apps/monitor          │  ← Vercel (Serverless)
          │   /api/health           │
          │   Redis + DB checks     │
          └─────────────────────────┘
```

## Monorepo Structure

```
automate/
├── apps/
│   ├── ingestion/     # Discord interactions endpoint
│   ├── bot/           # Queue consumer + fanout worker
│   ├── dashboard/     # Admin web UI
│   └── monitor/       # Health checks
└── packages/
    ├── types/         # Shared TypeScript types (no `any`)
    ├── db/            # Prisma 6.6 + Neon Postgres client
    └── redis/         # ioredis + Redis Streams utilities
```

## Local Development

### Prerequisites
- Node.js >= 24
- npm >= 11
- A running Redis instance (Upstash, local Docker, etc.)
- A Neon Postgres connection string

### Setup

```bash
git clone <your-repo>
cd automate

# Copy env and fill in your secrets
cp .env.example .env
# Edit .env with your keys (Discord token, Neon Postgres URL, etc.)
```

### Running Locally (Docker Compose)

The easiest way to run the entire stack locally is using Docker Compose. This spins up Redis and all 4 Next.js services automatically.

```bash
docker-compose up --build
```

Services will start at:
- **Dashboard**: http://localhost:3000
- **Ingestion**: http://localhost:3001/api/interactions
- **Bot Worker**: http://localhost:3002/api/worker
- **Monitor**: http://localhost:3003/api/health

### Running Locally (Native Node.js)

Alternatively, you can run the services natively:

```bash
# Install dependencies
npm install

# Generate Prisma client and push schema
npm run db:generate
npm run db:push

# Run all services concurrently
npm run dev
```

### Seed Admin User

```bash
# Run this one-time script to create an admin account
# (You'll need to hash the password with bcrypt first)
node -e "require('bcryptjs').hash('yourpassword', 12).then(h => console.log(h))"
# Then insert into DB:
# INSERT INTO "AdminUser" (id, email, "passwordHash", "createdAt")
# VALUES (gen_random_uuid(), 'admin@example.com', '<hash>', now());
```

## Environment Variables

See [`.env.example`](.env.example) for all required variables with documentation.

## Deployment

Deploy each `apps/*` directory as a **separate Vercel project** from the same GitHub repository (Free Tier):

| Vercel Project | Root Directory | URL used for |
|---|---|---|
| `automate-ingestion` | `apps/ingestion` | Discord Interactions Endpoint |
| `automate-bot` | `apps/bot` | Serverless Actor Worker |
| `automate-dashboard` | `apps/dashboard` | Admin UI & SSE Logs |
| `automate-monitor` | `apps/monitor` | Health checks |

Set all environment variables in each Vercel project's settings.

In the Discord Developer Portal, set your **Interactions Endpoint URL** to:
```
https://<your-ingestion-url>.vercel.app/api/interactions
```

## Slash Commands

Register commands via the Discord Developer Portal or using the REST API:

| Command | Description |
|---|---|
| `/report <text>` | Submit a report |
| `/status` | Check bot status |

## Quality Guarantees

- ✅ **Ed25519 verification** on every request
- ✅ **Deduplication** via Redis NX key (24h TTL)
- ✅ **<3s ACK** — deferred response, async processing
- ✅ **Fanout with retry** (exponential backoff, 5 attempts)
- ✅ **DLQ** via Redis Streams for failed events
- ✅ **No secrets** in code, logs, or client

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict, no `any`)
- **ORM**: Prisma 6.6.0
- **Database**: Neon (Postgres)
- **Queue**: Redis Streams via ioredis
- **Auth**: JWT via `jose`
- **Deployment**: Vercel Free Tier
