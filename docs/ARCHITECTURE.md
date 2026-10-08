# gamesfun-kit architecture

gamesfun-kit is a repository that advanced users clone and open in the AI coding agent they
already use (Claude Code, Codex, Cursor, opencode, Cline…). The agent follows `AGENTS.md` to
turn a prompt into a multiplayer three.js browser game on games.fun's `gf-three` kit, then adds
Solana items, loot boxes, a shop and a token. Everything runs on Windows, macOS and Linux with
Node 24 and Chrome. No desktop app, no build step, and no bash.

## Two audiences

- **Game builders.** The user and their agent. `README.md` (quick start) and `AGENTS.md`/`CLAUDE.md`
  (the build playbook) are for them, as are `skills/` (mirrored for each agent) and the MCP server.
- **Kit maintainers.** `docs/` (this file, `DEVELOPING.md`) and `CONTRIBUTING.md` are for them.

## Layout

| Path | What | Owner during the first build |
| --- | --- | --- |
| `bin/gamesfun.mjs` | CLI entry; dispatches to `commands/*.mjs` | core |
| `commands/` | `create`, `dev`, `verify`, … (one module per subcommand) | core; `web3.mjs` is web3's |
| `mcp/server.mjs` | MCP server (stdio) exposing the CLI's operations as agent tools; loads `mcp/tools/*.mjs` | core; `mcp/tools/web3.mjs` is web3's |
| `server/` | The local dev server behind `gamesfun dev`: serves a game, the studio page, live reload, local multiplayer signaling, and API routes from `server/routes/*.mjs` | core; `server/routes/web3.mjs` is web3's |
| `studio/` | The local studio page (plain ES modules, no build): game preview plus tabs loaded from `studio/tabs/*.js` | core; `studio/tabs/{token,shop}.js` etc. are web3's |
| `web3/` | Solana layer: transaction builders, Irys uploads, network config, and the in-game kit `gf-web3` | web3 |
| `kits/` | Vendored snapshots of games.fun's kits (`gf-three`, `gf-audio`, `gf-multiplayer`) at a pinned games.fun commit (`kits/KITS.json`); never edited here | core (via `scripts/sync-kits.mjs`) |
| `templates/` | What `create` copies into a new game | core |
| `skills/` | Agent skills (source of truth), mirrored to `.claude/skills/` and `.agents/skills/` | core; `skills/gamesfun-web3*/` are web3's |
| `games/` | The user's games (git-ignored) | users |
| `tests/` | `node --test` suites | each owner |

## Seams

Both builders work against these contracts. Keep them stable, and change one only after agreeing
the change in the parent session.

**Commands:** `commands/<name>.mjs` exports
`default { name, summary, usage, run(args: string[]): Promise<number | void> }`.

**MCP tools:** `mcp/tools/<area>.mjs` exports `tools`, an array of
`{ name, description, inputSchema /* JSON Schema */, handler(input, ctx) → result }`. Every tool that
spends money, signs or changes chain state must return a step for the human ("open this link and
approve in your wallet"). It never signs.

**Dev-server routes:** `server/routes/<area>.mjs` exports
`default function register(router, ctx)`. `router` has `get(path, handler)` and
`post(path, handler)` under `/api/<area>/…`. `ctx` holds `{ gameDir, kitRoot, network, log }`.
Handlers receive `(req, res, params)`. The server binds 127.0.0.1 only and checks Host/Origin.

**Studio tabs:** `studio/tabs/<id>.js` exports `default { id, label, order, mount(el, ctx) }`. Here
`ctx` holds `{ game, api(path, body?), wallet, toast(msg) }`, and `wallet` is the Wallet Standard
connection the studio page owns.

**Game config:** each game keeps its public web3 settings in `<game>/gamesfun.json`, written by the
web3 layer and read by the in-game kit. It holds public addresses only, never secrets.

## Rules

- Cross-platform: Node APIs only (`node:path`, `node:fs`), no shell scripts, no symlinks in
  committed paths, no case-only renames. Paths are built with `path.join`/`URL`.
- Chrome is the reference browser (`gamesfun verify` and `gamesfun dev` open it through Playwright).
- Never edit `kits/`; fix the kit in games.fun and re-sync.
- Licences: only permissive dependencies. Keep each vendored LICENSE beside its copy and list
  it in `THIRD_PARTY.md`.
- Devnet only until the owner approves mainnet.
- The kit never holds a user's private key. Wallets sign in the user's own browser.
