# BouldHQ — Cofounder Handoff

Use this to get a teammate (JakeK) running on the BouldHQ desktop app, pointed
at the shared remote Postgres. All commands assume macOS.

---

## What you (the host, Brian) need to set up once

### 1. Make the backend reachable from outside your laptop

The Tauri desktop app is just the frontend — it talks to a running Express +
tRPC server. Pick one:

**Option A — Tunnel your local backend (fastest, free):**
```bash
# in repo root, with the dev server already running on port 1111:
bun run dev:backend

# in another terminal, expose 1111 to the internet
brew install cloudflared
cloudflared tunnel --url http://localhost:1111
```
Cloudflared prints a public URL like `https://something-random.trycloudflare.com`.
That's the URL Jake will paste into the app. Keep this terminal open — when you
close it the URL dies.

**Option B — Deploy somewhere persistent:**
Build with `bun run build:web`, copy `dist/` to a small VM (Fly, Railway, your
own droplet), run `bun run start:server:production`. More setup, but the URL
doesn't change.

### 2. Make Postgres reachable

Right now `DATABASE_URL=postgresql://prueba@localhost:5432/blinko` — Jake's
backend can't reach that. Pick one:

**Option A — Hosted Postgres (recommended):** Sign up for Neon
(neon.tech) free tier, create a database, copy the connection string into
`.env` on whichever machine runs the backend (yours via cloudflared, or the
deploy). Run `bun run prisma:migrate:deploy && bun run seed && bun run
scripts/seed-test-accounts.ts` against it once to set up the schema and the
JakeK account.

**Option B — Tunnel your local Postgres:** Same idea as cloudflared above but
for Postgres. Tailscale works well — install on both machines, share, and Jake
points his `DATABASE_URL` at your Tailscale IP. Only relevant if Jake is also
running his own backend, which we're not doing for this handoff.

### 3. Build the .dmg

```bash
cd app
bun run tauri:desktop:build
```

Output lands in `app/src-tauri/target/release/bundle/dmg/BouldHQ_1.8.7_<arch>.dmg`
(arch is `aarch64` on M-series Macs, `x64` on Intel). If you need an Intel
build for an older teammate Mac, add `--target x86_64-apple-darwin` to the
tauri build command (requires the x86_64 Rust toolchain).

### 4. Send Jake

1. The `.dmg` file (drag/drop, AirDrop, Google Drive — anything).
2. The public backend URL from step 1 (the cloudflared one).
3. His login:
   - **username:** `JakeK`
   - **password:** `bouldhq2026`

---

## What Jake does

1. Double-click the `.dmg`, drag **BouldHQ** to Applications.
   - On first launch macOS may say "BouldHQ can't be opened because the
     developer cannot be verified." Right-click the app → **Open**, then
     confirm. Only required once.
2. On the first screen the app asks for a **server endpoint**. Paste the URL
   you sent (e.g. `https://something.trycloudflare.com`).
3. Sign in with `JakeK` / `bouldhq2026`.
4. He's in. Team is BouldHQ, role is founder, so he sees everything.

If the app shows "cannot connect" — your tunnel/server is down. Restart it on
your end.

---

## Resetting Jake's password

If he loses it, on your machine:

```bash
bun run scripts/seed-test-accounts.ts
```

The script resets every account listed in `TEAM_USERS` to the password defined
inline. To rotate the password, edit the file first.

---

## Common gotchas

- **Cloudflared URL keeps changing** — the free `--url` flag gives an ephemeral
  URL. For something stable, use `cloudflared tunnel create` with a named
  tunnel + your own domain (free, but more setup).
- **`prisma:migrate:deploy` errors with "shadow database"** — Neon doesn't
  allow shadow DB creation. Use `prisma migrate deploy` (which we already use
  here), not `prisma migrate dev`, against Neon.
- **AI features don't work for Jake** — set `ANTHROPIC_API_KEY` (or another
  provider key) in the backend `.env`. Without it, store-request triage falls
  back to the Claude Code agent (which still needs `claude` on the backend
  machine's PATH — set `CLAUDE_CODE_BIN` if it's somewhere unusual).
- **Quicknote is intentionally disabled** in this build. Don't be surprised if
  Shift+Space does nothing.
