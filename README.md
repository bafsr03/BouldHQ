<img style="margin-bottom:20px" src="./app/public/bouldhq-logo.png" alt="BouldHQ" height="80" />

# BouldHQ

BouldHQ is a self-hosted **team HQ for running a Shopify-store operations team**.
Salespeople capture work and submit store requests, an AI triage layer routes
each request to an automatable playbook or a human, managers run the work,
founders broadcast announcements, and merchants get a read-only portal into their
own store. All AI runs through a single shared **Claude Code** subscription, so
team members never need their own API keys.

BouldHQ is built on top of the open-source
[Blinko](https://github.com/blinko-space/blinko) note-taking app and inherits its
notes/RAG/attachments/Tauri foundation. It is distributed under the same license
— see [`LICENSE`](./LICENSE).

> This README documents the application for people who run, build, and extend it.
> For the cofounder/remote-Postgres handoff flow see [`HANDOFF.md`](./HANDOFF.md);
> for Docker build recipes see [`DEV.md`](./DEV.md); for the agent/codebase guide
> see [`CLAUDE.md`](./CLAUDE.md).

---

## Key concepts

These are the domains that make BouldHQ more than a note app. Everything is
scoped to a **team**.

### Teams

A team is the primary unit of ownership and access control. Teams own their
stores (modeled as tags), store requests, and announcements. A user can belong to
multiple teams and switches the active one via `accounts.lastActiveTeamId`; the
API resolves scope from the active team.

- Models `team` / `teamMember` in [`prisma/schema.prisma`](./prisma/schema.prisma)
- Router [`server/routerTrpc/team.ts`](./server/routerTrpc/team.ts)

### Roles

Three team roles, plus a separate merchant role:

| Role | Can do |
| --- | --- |
| **founder** | Everything: post announcements (any scope), manage members, triage/assign/run requests, open a terminal for manual work |
| **manager** | Team-wide ops: create/triage/assign requests, run & re-run playbooks, update status, manage store profiles, open a terminal — but no member management or announcements |
| **salesman** | Submit store requests; read-only on most surfaces |
| **brand_owner** | Merchant with magic-link-only access; sees their own store's requests/feed and can submit requests; read-only on notes & announcements |

Team roles live on `teamMember.role`; `brand_owner` lives on `accounts.role`.
Access is enforced by tRPC middleware — `teamMemberProcedure`,
`managerProcedure`, `founderProcedure`, `brandOwnerProcedure` — in
[`server/middleware/index.ts`](./server/middleware/index.ts).

### /hq dashboard

The team headquarters at `/hq`: a snapshot of metrics (stores managed, new stores
this month, reviewed ratio, open requests), the team roster grouped by role,
system-generated "heads up" notes, and the announcement panels. Founders get a
"Post" button; everyone else is read-only.

- Page [`app/src/pages/hq.tsx`](./app/src/pages/hq.tsx)
- Router [`server/routerTrpc/bouldhq.ts`](./server/routerTrpc/bouldhq.ts)

### Announcements

Founders broadcast notices; team members and brand owners read them.

- **Categories:** `announcement`, `workflow_update`, `changelog` (each is a
  separate panel on `/hq`).
- **Scope:** global (`teamId = NULL`, all teams), per-team, or owners-only
  (`ownersOnly = true`, visible to brand owners — founders also see these).
- Router [`server/routerTrpc/announcement.ts`](./server/routerTrpc/announcement.ts),
  model `announcement` in [`prisma/schema.prisma`](./prisma/schema.prisma)

### Store requests + AI triage

A work-ticket system. A team member submits a request against a store; the AI
classifier categorizes it and routes it either to an automatable playbook or to a
human. Managers can re-triage, run/re-run playbooks, assign owners, add notes, and
open an iTerm session for manual work.

Lifecycle:

```
pending_triage → auto_running → auto_done
                            ↘ needs_assistance → in_progress → done
```

Triage classifies into known automatable categories (e.g. `theme_setting_tweak`,
`product_metadata_update`, `inventory_sync_check`, `shipping_rate_update`,
`app_install`, `dns_record_check`). Anything unrecognized — or any request when no
LLM is configured — falls back to `claude_code`, which runs an autonomous Claude
Code agent to investigate.

- Router [`server/routerTrpc/storeRequest.ts`](./server/routerTrpc/storeRequest.ts)
- Triage/classifier [`server/lib/triage.ts`](./server/lib/triage.ts)
- Model `storeRequest` in [`prisma/schema.prisma`](./prisma/schema.prisma)

### Brand-owner portal

Merchants get magic-link access (no password) to a read-only view of their own
store's requests and feed, plus the ability to submit new requests.

- Router [`server/routerTrpc/brandOwner.ts`](./server/routerTrpc/brandOwner.ts)
- Models `brandOwner` / `brandOwnerMagicLink` in
  [`prisma/schema.prisma`](./prisma/schema.prisma)

---

## AI architecture

The headline change from upstream Blinko: **all chat and agent inference goes
through the owner's Claude Code subscription**, not per-user API keys.

### Claude Code backend

The integration seam is
[`server/aiServer/claudeCodeAgent.ts`](./server/aiServer/claudeCodeAgent.ts). It
wraps the `@anthropic-ai/claude-agent-sdk` and exposes a Mastra-agent-shaped
surface (`.generate()` / `.stream()`), converting BouldHQ's tools into MCP tools
the SDK can call.

- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` — a long-lived token from
  `claude setup-token`, set once on the server. Optional `CLAUDE_CODE_BIN` points
  at the `claude` binary if it is not on `PATH`.
- **Status:** the `/ai` page queries `api.ai.claudeCodeStatus`
  ([`server/routerTrpc/ai.ts`](./server/routerTrpc/ai.ts)) and shows a green
  "Claude Code" chip when connected. Without the token, AI calls fail closed with
  a clear message.

One-time setup (on the box that hosts the server):

```bash
npm i -g @anthropic-ai/claude-code
claude setup-token          # log in with the account that owns the subscription
# copy the printed token into the server's .env:
#   CLAUDE_CODE_OAUTH_TOKEN=<token>
```

### The /ai assistant

[`app/src/pages/ai.tsx`](./app/src/pages/ai.tsx) drives a Claude-Code-style chat
with three modes, mirrored server-side in
[`server/routerTrpc/ai.ts`](./server/routerTrpc/ai.ts):

| Mode | Behavior |
| --- | --- |
| **normal** | Prompts for approval (Allow/Deny card) before each write/destructive tool call |
| **acceptEdits** | Runs all tools without asking |
| **plan** | Read-only — denies write tools so the agent proposes a plan first |

Responses are streamed through the `assistantChatStream` route, which yields
tagged chunks (`delta`, `tool`, `permission`, `error`, `done`). In normal mode a
gated write tool parks the stream and pushes a `permission` event; the UI renders
an approval card and calls `respondToToolPermission` to resolve it.

### AI tools

Tools live in [`server/aiServer/tools/`](./server/aiServer/tools/):

- **Notes:** create / search (RAG) / update / delete notes, post AI comments
  (`createBlinko.ts`, `searchBlinko.ts`, `updateBlinko.ts`, `deleteBlinko.ts`,
  `createComment.ts`).
- **BouldHQ ops:** find/list/create/move/rename/delete resource files, list a
  team's stores, and open a task for a manager
  (`bouldHqAssistant.ts`, `resourceManager.ts`, `createResourceFile.ts`).
- **Scheduled tasks:** create / list / delete (`scheduledTask.ts`).
- **Web:** Tavily web search and a web crawler (`webSearch.ts`, `webExtra.ts`).

### What still uses configurable providers

Not everything goes through Claude Code. The provider layer
(`server/aiServer/AiModelFactory` + `providers/`), configured in the AI settings
UI, still powers:

- **Embeddings / RAG** — semantic note search.
- **Audio** — transcription.

Image description runs through the Claude Code agent. Embedding/audio providers
(OpenAI, Azure, Voyage, Ollama, etc.) are configured per deployment.

---

## Tech stack

- **Frontend:** React 18, Vite 6, TailwindCSS v4, Tauri 2 (desktop + mobile),
  MobX, tRPC v11 client, HeroUI.
- **Backend:** Bun / Node 20, Express 5, tRPC v11, Prisma 5, Mastra agent
  framework, Vercel AI SDK adapters, `@anthropic-ai/claude-agent-sdk`, pg-boss
  background jobs.
- **Data:** PostgreSQL (primary) + LibSQL (vector store for embeddings).
- **Tooling:** Bun 1.2.8+ (package manager), Turborepo (monorepo builds),
  TypeScript 5.

---

## Monorepo layout

```
bouldhq/
├── app/            @blinko/frontend — React + Vite + Tauri (UI, MobX stores, pages)
├── server/         @blinko/backend — Express + tRPC + Prisma + AI
│   ├── aiServer/     Claude Code seam, AI services, tools, providers
│   ├── routerTrpc/   one router per domain (team, storeRequest, ai, …)
│   ├── routerExpress/ auth, file ops, RSS, OpenAI-compat, MCP
│   ├── jobs/         pg-boss background jobs
│   ├── lib/          shared server utilities (incl. triage)
│   └── middleware/   tRPC auth/role guards
├── prisma/         schema, migrations, seed
├── shared/         shared types and utilities
└── blinko-types/   exported type definitions
```

---

## Getting started (development)

**Prerequisites:** Bun ≥ 1.2.8, Node ≥ 20, a PostgreSQL database.

```bash
bun install                     # installs deps; runs prisma:generate via postinstall

# configure .env (see Environment variables below), then set up the DB:
bun run prisma:migrate:deploy
bun run seed
bun run scripts/seed-test-accounts.ts   # creates the BouldHQ team test accounts

# run it — frontend and backend share port 1111:
bun run dev:backend             # Express + Vite (web) at http://localhost:1111
bun run dev                     # Tauri desktop app (requires the Rust toolchain)
```

> The frontend and backend share **port 1111** — ViteExpress serves the Vite dev
> server through the Express app. `bun run dev:frontend` actually runs the
> backend (`cd server && bun run dev`).

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | yes | Auth/session signing secret |
| `NEXTAUTH_URL` | yes | Public base URL (e.g. `http://localhost:1111`) |
| `NEXT_PUBLIC_BASE_URL` | yes | Base URL exposed to the client |
| `CLAUDE_CODE_OAUTH_TOKEN` | for AI | Long-lived token from `claude setup-token`; backs all chat/agent AI |
| `CLAUDE_CODE_BIN` | no | Path to the `claude` binary if not on `PATH` |
| `ANTHROPIC_API_KEY` | no | Optional fallback for legacy non-Claude-Code AI paths |
| `UPLOAD_PATH` | no | Custom upload directory |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | no | S3-compatible attachment storage |
| `TRUST_PROXY` | no | Set to `1` when behind a reverse proxy |
| `IS_DEMO` | no | Demo mode — blocks mutations |

See [`.env.tmpl`](./.env.tmpl) for a starting point.

---

## Build & deploy

```bash
bun run build:web                  # Turbo build: frontend → backend
bun run start:server:production    # copy built assets and start the production server
```

**Desktop (.dmg):**

```bash
cd app && bun run tauri:desktop:build
# output: app/src-tauri/target/release/bundle/dmg/BouldHQ_<version>_<arch>.dmg
```

**Docker:**

```bash
docker-compose -f docker-compose.prod.yml up -d     # production
docker-compose -f docker-compose.yml up -d --build  # build & run locally
```

For shipping a desktop build to a teammate and pointing it at a shared remote
Postgres, follow [`HANDOFF.md`](./HANDOFF.md). For additional Docker build recipes
(arm64, QEMU, local image builds) see [`DEV.md`](./DEV.md).

---

## Database

```bash
bun run prisma:generate        # generate the Prisma client (auto-runs on install)
bun run prisma:migrate:dev     # create + apply a migration (development)
bun run prisma:migrate:deploy  # apply migrations (production)
bun run prisma:studio          # open Prisma Studio
bun run seed                   # seed the database
```

Key models: `accounts`, `team`, `teamMember`, `tag` (stores), `notes`,
`announcement`, `storeRequest`, `storeProfile`, `brandOwner` /
`brandOwnerMagicLink`, `conversation` / `message`, `aiProviders` / `aiModels`.
Full schema in [`prisma/schema.prisma`](./prisma/schema.prisma).

---

## Testing

```bash
bun run test                   # all tests via Turbo

# a single file:
cd server && bun test __tests__/unit/lib/sanitizeUploadFileName.test.ts
```

Tests live in `server/__tests__/` (`unit`, `integration`, `e2e`).

---

## Credits & license

BouldHQ is built on the open-source
[Blinko](https://github.com/blinko-space/blinko) project. It is distributed under
the license in [`LICENSE`](./LICENSE).
</content>
</invoke>
