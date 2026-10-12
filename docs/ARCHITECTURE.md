# gamesfun-kit architecture

gamesfun-kit is a repository that advanced users clone and open in the AI coding agent they
already use (Claude Code, Codex, Cursor, opencode, Cline…). The agent follows `AGENTS.md` to
turn a prompt into a multiplayer three.js browser game on games.fun's `gf-three` kit, then adds
a Solana economy (items, loot boxes, a shop, lotteries, stakes, crafting and a token, as one spec; devnet). Everything runs on Windows, macOS and Linux with
Node 24 and Chrome. No desktop app, no build step, and no bash.

## Two audiences

- **Game builders.** The user and their agent. `README.md` (quick start) and `AGENTS.md`/`CLAUDE.md`
  (the build playbook) are for them, as are `skills/` (mirrored for each agent) and the MCP server.
- **Kit maintainers.** `docs/` (this file, `DEVELOPING.md`, `MCP.md`) and `CONTRIBUTING.md` are for them.

## Layout

| Path | What | Owner during the first build |
| --- | --- | --- |
| `bin/gamesfun.mjs` | CLI entry; dispatches to `commands/*.mjs` (a command that fails to load is reported, never fatal) | core |
| `commands/` | `create`, `dev`, `verify`, `slots`, `catalog`, `examples`, `play`, `promises`, `upgrade`, `rig-check`, `meshy` (one module per subcommand) | core; `web3.mjs` is web3's |
| `lib/` | Shared code: paths and path safety, the kit hooks and tool runner, Chrome discovery, games, slots, examples, local state | core |
| `mcp/server.mjs` | MCP server (stdio) exposing the CLI's operations as agent tools; loads `mcp/tools/*.mjs` | core; `mcp/tools/web3.mjs` is web3's |
| `server/` | The local dev server behind `gamesfun dev`: serves a game, the studio page, live reload, local multiplayer signaling, and API routes from `server/routes/*.mjs`; `server/online.mjs` gives a game's pages the online-play line when the game's multiplayer kit knows it (`docs/ONLINE.md`, `GAMESFUN_ONLINE`) | core; `server/routes/web3.mjs` is web3's |
| `studio/` | The local studio page (plain ES modules, no build): game preview plus tabs loaded from `studio/tabs/*.js` | core; `studio/tabs/economy.js` and `studio/tabs/web3/` are web3's |
| `web3/` | Solana layer: transaction builders, Irys uploads, network config, and the in-game kit `gf-web3` | web3 |
| `kits/` | A snapshot of games.fun's kits and tools (`gf-three`, `gf-audio`, `gf-multiplayer`, `gf-assets`) at a pinned games.fun commit (`kits/KITS.json`), laid out as a sparse mirror of the games.fun repository so its tools run unedited; never edited here | core (via `scripts/sync-kits.mjs`) |
| `templates/game/` | What `create` writes into a new game besides gf-three's output: its `AGENTS.md`, `CLAUDE.md`, `.gitignore` | core |
| `templates/examples/<id>/` | Complete example games `create --from` starts from (`spec.json`, `rules.js`, `README.md`, `example.json`) | core |
| `skills/` | Agent skills (source of truth), mirrored to `.claude/skills/` and `.agents/skills/` by `scripts/sync-skills.mjs` | core; `skills/gamesfun-web3*/` are web3's |
| `games/` | The user's games (git-ignored) | users |
| `.gamesfun/` | Local state (git-ignored): running dev servers, the Meshy ledger | — |
| `tests/` | `node --test` suites | each owner |

## How the kits run

`kits/` mirrors the games.fun paths the tools expect (`kits/research/gf-three/tools/create.mjs` finds
`kits/research/foundations/kits/gf-audio/1.5.0/` exactly as in games.fun), so they run byte for byte as games.fun ships
them. Each tool runs as a child process: `node kits/…/tools/<tool>.mjs …` (`lib/run-tool.mjs`), with the environment the
tools read their settings from (`GF_MANIFEST_IGNORE` names this kit's own ignore list). No module hooks and no import
rewriting: the tools find their packages (Playwright, the 3D tools' packages) through their own search order, and nothing
inside `kits/` is changed. Commands then add what the kit doesn't have: finding Chrome on each OS, examples, the game's
agent guide, game-folder resolution.

## Seams

Both builders work against these contracts. Keep them stable, and change one only after agreeing
the change in the parent session. Fields marked *extra* were added by the core build; they are
additive, and code that ignores them keeps working.

**Commands:** `commands/<name>.mjs` exports
`default { name, summary, usage, run(args: string[]): Promise<number | void> }`. The return value is the exit code.
`lib/cli.mjs` has optional helpers (`parse`, `guard`, `printJson`, `UsageError`).

**MCP tools:** `mcp/tools/<area>.mjs` exports `tools`, an array of
`{ name, description, inputSchema /* JSON Schema */, handler(input, ctx) → result }`. Every tool that
spends money, signs or changes chain state must return a step for the human ("open this link and
approve in your wallet"). It never signs. Names match `^[a-zA-Z0-9_-]{1,64}$` and are unique across files (a
duplicate or a file that fails to load is reported on stderr and skipped). A result may be a string, any JSON value
(sent as text), or an MCP result `{ content: [...] }`; a throw becomes `isError` with the message. *Extra* in `ctx`:
`{ kitRoot, log(...), progress(message), runCli(args, { onLine }) → { code, stdout, stderr }, signal }`.

**Dev-server routes:** `server/routes/<area>.mjs` exports
`default function register(router, ctx)`. `router` has `get(path, handler)` and
`post(path, handler)` under `/api/<area>/…`. `ctx` holds `{ gameDir, kitRoot, network, log }`.
Handlers receive `(req, res, params)`. The server binds 127.0.0.1 only and checks Host/Origin.
Details as built: `<area>` is the file name (lower-case letters, digits, dashes); a path may hold `:name` segments,
which arrive in `params`; `req.query` is the URL's `searchParams`; a handler may be async, and a value it returns
without writing a response is sent as JSON (a thrown `HttpError(status, message)` from `server/http.mjs` sends that
status). `server/http.mjs` also has `sendJson`, `readBody`, `readJson` (size-limited). A route file that throws on load
is reported and skipped. *Extra* in `ctx`: `url` (the server's base URL) and `events.send(event, data)` (a
Server-Sent Event to open studio pages; `ctx.on(event)` in tabs receives it).

**Studio tabs:** `studio/tabs/<id>.js` exports `default { id, label, order, mount(el, ctx) }`. Here
`ctx` holds `{ game, api(path, body?), wallet, toast(msg) }`, and `wallet` is the Wallet Standard
connection the studio page owns. As built: `game` is `/api/game/info` (title, hook, mechanics, controls, `network`,
`gamesfun` = the game's `gamesfun.json`); `api('web3/items')` or `api('/api/web3/items')` GETs, `api(path, body)` POSTs
JSON (or raw bytes for a Blob or ArrayBuffer) and resolves to the parsed JSON or rejects with the server's error;
`wallet` (`studio/wallet.js`) is `{ list(), connect(name?), disconnect(), account, address, wallet, feature(name),
onChange(fn) }` over the standard's `wallet-standard:app-ready` / `register-wallet` events; `toast(msg, kind?)` with
kind `'ok'` or `'error'`. `mount` may return a cleanup function. Tabs are listed by `GET /api/studio/tabs` and mounted
when first opened, in `order`. *Extra* in `ctx`: `preview` (`reload()`, `show(path)`) and `on(event, fn)` for
dev-server events (`game` when the game's files change, `verify`, and any `ctx.events.send` from a route).

**Game config:** each game keeps its public web3 settings in `<game>/gamesfun.json`, written by the
web3 layer and read by the in-game kit. It holds public addresses only, never secrets. The dev server reads its
`network` (default `devnet`; `GAMESFUN_NETWORK` overrides) for `ctx.network`, and `/api/game/info` returns the file.

## The dev server's URLs

| Path | Serves |
| --- | --- |
| `/` | redirect to `/studio/` |
| `/studio/…` | `studio/` (index, shell, `tabs/*.js`) |
| `/game/…` | the game folder; HTML pages get the live-reload script; `/game/gf/mp/` is the friends lobby |
| `/signal` (WebSocket), `/signal/v1`, `/signal/v1/ice` | gf-multiplayer signaling, from the kits' own signal server |
| `/api/<area>/…` | routes; core areas: `game` (info, slots, verify), `studio` (tabs), `dev` (status) |
| `/__gamesfun/events`, `/__gamesfun/reload.js` | live reload (Server-Sent Events) |

Every response is `no-store`, `nosniff` and frameable only by the server's own pages. Paths are resolved by
`resolveInside` (`lib/paths.mjs`): no traversal, no dotfiles (`.env` is never served), no Windows device names,
drive letters or alternate data streams.

## Rules

- Cross-platform: Node APIs only (`node:path`, `node:fs`), no shell scripts, no symlinks in
  committed paths, no case-only renames. Paths are built with `path.join`/`URL`. Child processes are
  `process.execPath` with arguments, never a shell; npm is run through its own `npm-cli.js`.
- Chrome is the reference browser. `gamesfun verify` and `gamesfun play` drive it through Playwright (Chrome or Edge
  installed on the machine, else Playwright's Chromium, installed on demand). `gamesfun dev` opens the studio in the
  person's own Chrome (their profile, so their wallet extension is there), else their default browser.
- Never edit `kits/`; fix the kit in games.fun and re-sync. `.gitattributes` keeps `kits/` byte-exact on every OS.
- Licences: only permissive dependencies. Keep each vendored LICENSE beside its copy and list
  it in `THIRD_PARTY.md`.
- Devnet only until the owner approves mainnet.
- The kit never holds a user's private key. Wallets sign in the user's own browser.
