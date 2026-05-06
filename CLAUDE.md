# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Blinko is an open-source, self-hosted note-taking application with AI-powered features. It's a multi-platform application (web, desktop via Tauri, mobile) built with TypeScript/React frontend and Node.js/Express backend.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS v4, Tauri 2 (desktop/mobile)
- **Backend**: Node.js, Express 5, tRPC v11, Prisma ORM, Mastra (agent framework)
- **Database**: PostgreSQL + LibSQL (vector store for embeddings)
- **Package Manager**: Bun (v1.2.8+)
- **Build Tool**: Turbo (monorepo)
- **AI**: Vercel AI SDK adapters for OpenAI, Anthropic, Google, Azure, DeepSeek, xAI, Ollama, OpenRouter

## Monorepo Structure

```
blinko/
├── app/                    # @blinko/frontend — React + Vite + Tauri
│   └── src/
│       ├── store/         # MobX stores (state management)
│       ├── pages/         # Route-level components
│       └── components/    # UI components
├── server/                 # @blinko/backend — Express + tRPC
│   ├── aiServer/          # AI services (AiService, AiModelFactory, providers, tools)
│   ├── routerTrpc/        # tRPC routers (one file per domain)
│   ├── routerExpress/     # Express routes (auth, file ops, RSS, OpenAI compat, MCP)
│   ├── jobs/              # pg-boss background jobs
│   ├── lib/               # Shared server utilities
│   ├── middleware/        # tRPC middleware (auth, admin, demo guards)
│   └── index.ts           # Server entry point
├── prisma/                # Schema, migrations, seed
├── shared/                # Shared types and utilities
└── blinko-types/         # Exported type definitions
```

## Development Commands

```bash
bun install                # Install all workspace dependencies (runs prisma:generate via postinstall)
bun run dev:backend        # Run backend only with hot reload (bun --watch, uses .env)
bun run dev:frontend       # Run frontend dev server (ViteExpress integration, same as backend)
bun run dev                # Run Tauri desktop app (requires Rust toolchain)
```

The frontend and backend share **port 1111** — ViteExpress serves the Vite dev server through the Express app. `dev:frontend` actually runs the backend (`cd ../server && bun run dev`).

### Building
```bash
bun run build:web          # Build full web app (Turbo: frontend → backend)
bun run start:server:production  # Copy built assets and start production server
```

### Database
```bash
bun run prisma:generate    # Generate Prisma client (auto-runs on install)
bun run prisma:migrate:dev # Create and apply a new migration
bun run prisma:migrate:deploy # Apply migrations (production)
bun run prisma:studio      # Open Prisma Studio GUI
bun run seed               # Seed the database
```

### Testing
```bash
bun run test               # Run all tests via Turbo
```

Tests live in `server/__tests__/unit/` and `server/__tests__/integration/`. To run a single test file:
```bash
cd server && bun test __tests__/unit/lib/sanitizeUploadFileName.test.ts
```

## Architecture

### Server Startup (`server/index.ts`)
The server bootstraps Express, mounts all routes, initializes pg-boss scheduled jobs, then binds ViteExpress. Key routes:
- `/api/trpc` — tRPC endpoint
- `/api/auth` — Auth routes (passport)
- `/api/file`, `/api/s3file` — File upload/download/delete
- `/api/rss` — RSS feeds
- `/v1` — OpenAI-compatible API
- `/` (MCP) — Model Context Protocol handler
- `/api-doc` — Swagger UI
- `/api/openapi.json` — OpenAPI spec
- `/health` — Health check

### tRPC (`server/routerTrpc/`)
Root router in `_app.ts` composes domain routers: `notes`, `tags`, `users`, `attachments`, `config`, `ai`, `task`, `aiTask`, `analytics`, `comments`, `follows`, `notifications`, `plugin`, `conversation`, `message`, `mcpServers`, `fonts`.

Middleware in `server/middleware/index.ts`:
- `publicProcedure` — unauthenticated
- `authProcedure` — requires JWT, checks token permissions against the procedure path
- `superAdminAuthMiddleware` — requires `role === 'superadmin'`
- `demoAuthMiddleware` — blocks mutations when `IS_DEMO=true`

Context (`server/context.ts`) extracts a JWT from each request and injects `{ id, name, role, sub, permissions, ... }`.

### AI Architecture (`server/aiServer/`)
- **`AiModelFactory`** — resolves the active AI provider, creates Mastra agents (`BaseChatAgent`, `CommentAgent`, `TagAgent`), manages vector queries and LibSQL vector store
- **`AiService`** — high-level AI operations: embedding upsert/delete, RAG completions, audio transcription, note post-processing
- **Providers**: `LLMProvider`, `EmbeddingProvider`, `AudioProvider` wrap Vercel AI SDK models
- **Tools** (Mastra tool format): `upsertBlinkoTool`, `updateBlinkoTool`, `deleteBlinkoTool`, `searchBlinkoTool`, `createCommentTool`, `webSearchTool`, `webExtra`, scheduled task tools
- **Vector storage**: LibSQLVector (`@mastra/libsql`) with index named `'blinko'`
- **RAG**: `@mastra/rag` MDocument chunking + `embedMany` from Vercel AI SDK

### Background Jobs (`server/jobs/`)
All jobs use pg-boss (`server/lib/pgBoss.ts`). Jobs extend `BaseScheduleJob` and expose `initialize()` + static trigger methods:
- `ArchiveJob` — auto-archive old notes
- `DBJob` — database backup
- `RebuildEmbeddingJob` — rebuild vector index (also has `ForceRebuild()`)
- `RecommandJob` — recommendation generation
- `AIScheduledTaskJob` — user-configured AI scheduled tasks

### Frontend State (`app/src/store/`)
MobX stores. `RootStore` (`root.ts`) composes all stores. `blinkoStore.tsx` is the primary store for notes (list, filter, CRUD, offline support). The `api` object in `app/src/lib/trpc.ts` is the tRPC client used throughout components and stores.

### Database Schema (key models)
`accounts`, `notes` (type: 0=blinko, 1=note, 2=todo), `attachments`, `tag`, `tagsToNote`, `comments`, `conversation`, `config`, `aiModels`, `aiScheduledTask`, `notifications`, `follows`

## Environment Configuration

```
DATABASE_URL=postgresql://user:password@localhost:5432/blinko
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:1111

# Optional
TRUST_PROXY=1          # Set to 1 when behind a reverse proxy
IS_DEMO=true           # Enables demo mode (blocks mutations)
UPLOAD_PATH=           # Custom upload directory
S3_ENDPOINT=           # S3-compatible storage
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

## Docker

```bash
docker-compose -f docker-compose.prod.yml up -d   # Production
docker-compose -f docker-compose.yml up -d --build # Build and run locally
```
