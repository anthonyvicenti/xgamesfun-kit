# A game's own backend (optional)

A game needs no backend. It runs in the browser, and friends play peer to peer through the kit's multiplayer. Add a
backend only when the game needs something that outlives a round:
- a leaderboard;
- saved progress;
- accounts;
- a server of its own.

It lives in the person's own account, on their own bill. The game carries only public values.

| Piece | Where |
|---|---|
| Command | `npx gamesfun backend …` (`commands/backend.mjs`) |
| Library | `lib/backend/`: `index.mjs` (use, check, status), `providers.mjs` (the registry), `providers/<id>.mjs` (one per provider), `supabase.mjs` (Management API, the kit's own sign-in), `mcp.mjs` (Supabase's MCP server for the person's agent), `oauth.mjs` (PKCE, loopback), `config.mjs` (`backend.json`), `scan.mjs` (secrets), `rls.mjs` (row-level security) |
| Secret store | `lib/secret-store.mjs` |
| Studio | `studio/tabs/backend.js` (Launch group) and one panel per provider, `studio/tabs/backend/<id>.js`; routes `server/routes/backend.mjs` |
| MCP tools | `mcp/tools/backend.mjs`: `gamesfun_backend_status`, `_add_mcp`, `_use`, `_check` |
| In-game client | `backend/gf-backend/`, copied into a game at `gf/backend/` |
| Agent skill | `skills/gamesfun-backend/` (with a high-score and a saved-progress example) |
| Tests | `tests/backend.test.mjs` (against `tests/stubs/supabase-mock.mjs`); `tests/backend-tab.test.mjs` (Chrome); `tests/backend-local-e2e.mjs` (by hand, a real local Supabase) |

## What a game holds

- **`backend.json`**: `{ version, provider, url, key?, keyKind?, project?, origins, players }`. Public values only;
  `lib/backend/config.mjs` validates the file on every read and write.
  - It is its own file because `gamesfun.json` is web3's: its writer drops fields it does not know.
  - It is not a slot, because slots are what a player sees or tunes.
- **`gf/backend/`**: the client (`connectBackend()`; `null` with no backend).
- **`supabase/migrations/*.sql`**: the tables and access rules, in the Supabase CLI's own layout. This folder is not
  part of a published game.

`lib/manifest-ignore.json` lists `backend.json` and `supabase/**`, so verify check 1 does not count them as assets.

## Connecting Supabase: three ways, best first

1. **The person's own agent, through Supabase's hosted MCP server.** This is the default
   (`npx gamesfun backend connect supabase`, or the studio's "Connect Supabase").
   - The kit adds `https://mcp.supabase.com/mcp` with the agent's own command:
     - Claude Code: `claude mcp add --scope local --transport http supabase …`, then `/mcp` → Authenticate.
     - Codex: `codex mcp add supabase --url …`, then `codex mcp login supabase`.
   - The browser signs in through Supabase's dynamic client registration. Nobody registers an app, and the kit never
     sees a token.
   - The agent then calls `list_projects`, `create_project`, `get_project_url` and `get_publishable_keys`, then
     `gamesfun backend use`, then `apply_migration` and `get_advisors`.
   - Docs: https://supabase.com/docs/guides/getting-started/mcp.
2. **A personal access token** (`--token-stdin`, or pasted in the studio). Make one at
   https://supabase.com/dashboard/account/tokens, scoped to one organization. The kit keeps it in the secret store.
3. **The kit's own OAuth sign-in** (`--sign-in`). PKCE S256, a checked `state`, and one fixed loopback redirect,
   `http://localhost:53841/callback`.
   - Supabase requires an OAuth app registered by an organization owner (Organization settings → OAuth Apps).
   - Its token exchange wants the client secret: `token_endpoint_auth_methods_supported` is `client_secret_basic`
     and `client_secret_post` only (https://api.supabase.com/.well-known/oauth-authorization-server).
   - A downloadable kit cannot keep a secret, so none ships. Either:
     - **games.fun's app plus an exchange** (`GAMESFUN_SUPABASE_CLIENT_ID`, `GAMESFUN_SUPABASE_BROKER`): a games.fun
       route adds the secret and forwards `/token` and `/revoke`, storing nothing. It is not built; that is the
       creator's decision.
     - **The person's own app**: `--client-id <uuid> --client-secret-stdin`. The secret is kept in the secret store.

With the kit's own sign-in, `connect supabase --project <ref>` or `--create --name … --org … --region …` does the rest:
1. It polls the project's health.
2. It reads its API keys without `reveal`, keeps only the publishable one, and creates one if there is none.
3. It writes `backend.json`.
4. For a new project, it generates the database password, keeps it in the secret store and never puts it in the game.
   The studio shows the password once, and `gamesfun backend password <ref>` shows it in the person's own terminal
   only.

A paused project (free projects pause after a week without use) is said plainly: "restore it in the dashboard".

## The secret store (`lib/secret-store.mjs`)

| System | Where |
|---|---|
| macOS | The login keychain, through `security -i`. The secret goes in on stdin, never as an argument |
| Linux | The Secret Service through `secret-tool`, when it is installed and a session bus is running |
| Windows | A DPAPI-encrypted file (PowerShell `ConvertFrom-SecureString`, this user only) |
| Anywhere else, or `GAMESFUN_SECRET_STORE=file` | A 0600 file in the user's config folder (`%APPDATA%\gamesfun`, `~/Library/Application Support/gamesfun`, `$XDG_CONFIG_HOME/gamesfun`) |

It is the kit's only secret store: `lib/credentials.mjs` (the games.fun sign-in, `gamesfun login`) keeps its token
here too, under `publish-<16 hex>`; the backend's names are `backend-supabase`, `backend-supabase-app`,
`supabase-db-<ref>`, `railway-token` and `railway-client`, so the two never overwrite each other
(`tests/secret-store-shared.test.mjs`).

The file store is the one run on Linux in the tests. The keychain and DPAPI paths have not been run on macOS or
Windows yet.

## The checks

- **`scan.mjs`** refuses anything key-shaped in a game folder. It is the kit's sync scanner plus:
  - `sb_secret_` and `sbp_` keys;
  - a JWT whose role is not `anon` (the service-role key, a session);
  - a Postgres URL with a password;
  - `.env` and key files.
  `use` runs it before and after writing, and publishing should refuse what it flags.
- **`rls.mjs`** refuses:
  - a `public` table without row-level security, or one that turns it off;
  - a view without `security_invoker`;
  - a materialized view;
  - a `security definer` function without `search_path`;
  - a table the code reads with `.from()` that no migration creates.
  It warns on a write policy that is `true` for everyone, and on a table with no policy. It reads both the migrations
  and, live, Postgres' own view (`LIVE_SQL`: through the Management API's read-only query, or rows from the agent's
  `execute_sql`).

## The in-game client (`backend/gf-backend/index.js`)

- For Supabase:
  - anonymous sign-in, refreshed and kept per browser;
  - `from(table)` with `select`, `insert`, `upsert`, `update` and `delete` (filters `eq`, `gt`… `order`, `limit`);
  - `rpc` and `invoke` (edge functions).
- For a server provider: `get`, `post`, `put`, `del` and `socketUrl` over its URL.
- It never throws and never writes a console error. A game keeps playing when the database is away.
- **In an automated browser (`navigator.webdriver`: verify, `gamesfun play`, play-testers) it is off by default.** No
  test run writes to a person's real database. `?gf-backend=on` or `globalThis.__GF_BACKEND = 'on'` turns it on, as
  the local end-to-end script does.

## Adding a provider

Add one file, `lib/backend/providers/<id>.mjs`. Its shape is in the header of `lib/backend/providers.mjs`: `id`,
`label`, `kind`, `about`, `ways`, `publicKey`, `settings`, `status`, `disconnect` and `agentSteps`, plus optional
`cli`, `routes` and `panel`. If it has a panel, add `studio/tabs/backend/<id>.js` too.

Nothing else changes: the command, the routes, the tab, `backend.json` and the client are shared. `tests/backend.test.mjs`
checks every provider file's shape.
