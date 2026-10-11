# Developing gamesfun-kit

For maintainers of the kit itself. Game builders want `README.md` and `AGENTS.md`. The layout and the seams are in
`ARCHITECTURE.md`.

## Setup

Node 24 (`.nvmrc`), then `npm ci`. Chrome or Edge for the browser tests (else Playwright's Chromium is downloaded on
first use).

```bash
npm test                         # the fast suites, about 5 s, no browser
GAMESFUN_SMOKE=1 npm test        # plus the smoke test: create, quick verify, two pages that see each other (~3 min)
node tests/two-players.mjs http://127.0.0.1:5180/ --shots <dir>    # the two-page check against a running dev server
node tests/two-hosts.mjs [--case soak-squad|dev-dodgeball] [--out <dir>]   # one case through both hosts of the loop, no model (~9 min, real browser)
node tests/online-e2e.mjs [--out <dir>] [--ports a,b,c]            # online play: two pages on two origins through a signaling server on a third; a host that refuses (~1 min, real browser, nothing on the internet)
```

`tests/two-hosts.mjs` drives the build loop twice on one locked spec and one fixed `rules.js`, with the real create, fix
and verify: once the way Studio's worker calls the library (the job folder, the state beside it, runners) and once
through this kit's MCP tools called by a scripted session. It prints the game folders compared byte for byte, the two
full verdicts check by check, and exits 1 when a check differs or a file difference is not one a host makes on purpose.

PowerShell: `$env:GAMESFUN_SMOKE = "1"; npm test`.

## Updating the kits

games.fun's kits change often; `kits/` holds one commit of them.

```bash
GAMESFUN_REPO=/path/to/games.fun node scripts/sync-kits.mjs              # snapshot games.fun's HEAD
node scripts/sync-kits.mjs --from /path/to/games.fun --commit <sha>         # a specific commit
node scripts/sync-kits.mjs --dry-run                                        # what would change
node scripts/sync-kits.mjs --check                                          # kits/ vs the recorded commit (exit 1 on drift)
```

Without `--from` or `GAMESFUN_REPO` it looks for `../games.fun` beside this checkout (or beside the main checkout when
this is a git worktree). Files are read from git objects at the commit, never the working tree, so uncommitted edits in
games.fun never leak in and the same commit always gives the same bytes.

### What is copied

There is no list of files. The script works out what the tools need from the tools themselves:

1. **The walk.** From the tools this package runs (`TOOL_ENTRIES`, plus the signal server and the two tools a check's
   message tells a person to run), it follows every relative `import`, `import('…')`, `register('…', import.meta.url)`
   and `new URL('…', import.meta.url)`, however deep (text inside a template literal is never an import: `create.mjs` writes a game's source as a template). That brings the multiplayer gate, the manifest validator, the
   audio gate, the browser launcher, the watch relay and the modules of `creator-studio/lib` they use.
2. **Parts loaded by path.** A tool loads a part a game may not need with `importPart(join(FOLDER, '…'))`. The script
   reads those calls: a part this package carries is walked like an import (the world server, the character bench);
   a part in `LEFT_OUT` is recorded and skipped (the forge engine).
3. **Data** (`DATA`, about thirty lines): folders that are copied into a game, served to a page or read as documents,
   so no import leads to them: the kit, the two libraries, the scenic engine's kit, the kit folders, the pinned
   three.js builds, Rapier, the specs and schemas. Kit versions are never written there: `{mp}`, `{audio}` and
   `{assets}` are read from the tools at that commit, so a sync cannot copy a version the tools do not ask for.
4. **A cross-check.** Every path `tools/lib/paths.mjs` names must be in the snapshot or in `LEFT_OUT`. A new engine or
   a moved vendor folder fails the sync with the line to add, instead of failing in `create` later.

`tests/sync-kits.test.mjs` fails when the CLI runs a tool that is not an entry, or an entry is no longer run.

### What stops a sync

The sync refuses, and leaves `kits/` alone, when:
- a text file holds a key-shaped string (API keys, private key blocks, JWTs, wallet keypairs, base58 secrets);
- an import of the Node tooling points at a file games.fun does not track, or statically into a left-out part;
- a path would break Windows or macOS (over 170 characters with `kits/`, case-only collisions, device names, forbidden
  characters, a trailing dot or space), or is a symlink;
- a data path is missing at that commit, a kit version cannot be read from the tools, or `paths.mjs` names a folder
  that nothing was copied from;
- a module the tools import is a file that must never ship (a `.env`, a key, the Meshy ledger), or a library file the
  licence rule leaves out.

Left out by name: `EXCLUDED_DIRS` (evidence, regressions, sandbox, lookdev, caches, `node_modules`) and the file-name
rules. Left out by licence: a library file ships when its `LICENSES.json` record is CC0 or permissive, or games.fun
generated it, or its folder carries its upstream's permissive `LICENSE` text (the scenic library's folio folder);
never Meshy output. `kits/KITS.json` records the commit, the kit versions, the entries, the parts (taken or not, and
why), the modules the walk found, each data folder's size, the library files left out and why, and a sha256 per file.

### The drift test

`tests/kits.test.mjs` holds `kits/` to that record byte for byte (nothing changed, missing or extra) on every system,
and, when a games.fun checkout with the recorded commit is beside this one, rebuilds the snapshot from that commit and
compares it file for file with `kits/` and with `KITS.json`. So a file edited by hand fails the first test anywhere,
and a `KITS.json` edited to match fails the second on a maintainer's machine. `node scripts/sync-kits.mjs --check` is
the same comparison as a command.

### After a sync

1. `npm test`, then `GAMESFUN_SMOKE=1 npm test` (the example must still pass verify on the new kits).
2. If an example fails, fix `templates/examples/<id>/` (never the kits), and update its `example.json` → `verified`.
3. Commit `kits/` alone, with the games.fun commit in the message.
4. Existing games move onto the new kits with `npx gamesfun upgrade <game>`.

Never edit `kits/`. A kit bug is fixed in games.fun, then synced.

## How the tools are run

Each tool runs as it ships: `node kits/research/gf-three/tools/<tool>.mjs …` in a child process (`lib/run-tool.mjs`),
with no module hooks and no copies of a tool's command line. What this checkout tells the tools goes through the
environment:

| Setting | Set by | What it does |
|---|---|---|
| `GF_MANIFEST_IGNORE` | `lib/run-tool.mjs`, for every tool | names `lib/manifest-ignore.json`: the files this kit adds to a game that are not assets (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `scratch/`, `gamesfun.json`). gf-three writes them into `assets.json` → `ignore` and keeps them |
| `MESHY_API_KEY`, `GF_MESHY_LEDGER`, `GF_MESHY_WAVE`, `GF_MESHY_CAP` | `gamesfun meshy` | the person's own key, and a ledger under `.gamesfun/` (outside games.fun the tools refuse a paid task without one) |
| `CHROME_PATH` | `lib/chrome.mjs` `ensureBrowser`, only when no browser is installed | Playwright's own Chromium, downloaded once. Finding an installed Chrome, Chromium or Edge is the tools' job (`qa/browser.mjs`) |

Playwright is found by package name (`playwright-core`, pinned in this package). The 3D tools' own packages
(gltf-transform, meshoptimizer, sharp) are installed on first use into `kits/research/gf-three/tools/lib/char-deps/`
(`lib/char-deps.mjs`; git-ignored). `verify` needs them too since check 19 reads every body's skeleton.

`lib/manifest-ignores.mjs` remains for one caller: `web3/node/game.mjs` adds `gamesfun.json` to a game that already
has an `assets.json` and adds its ignore entry at once. It reads the same JSON file.

## Tool faults worked around here (requests to games.fun)

Checked against the kits synced from games.fun de2ea9313 (2026-10-11). Deleted here because the loop library now covers them: `paths.GAME` for the rescue and play-repair messages, `playWords.REPORT_HOW` for the play-test brief's report line (`gamesfun_playtest_report`), a refusal that `step()` returns being marked told, `.gf-loop/**` in the game's ignore list decided by where the state file is (`ignoreStateDir`), `host.session` kept as `state.session` (the stop guard holds that session only); the reminder
round's words after a restart, the promises writer bound by hand, the rewriting of the loop's messages and of the play-tester's brief for this kit's
folders and tools (`paths`, `toolNames`, `playWords`), stopping a running verify with its host (`host.signal`), and the roll-back work-around (`loop.cancel`). Fixed upstream and removed from this table: the forge
HUD and forge-spec refusals now load by `importPart` (`spec-config.mjs`, `create.mjs`); `verify.mjs` imports the body judge
only when check 19 runs (the CLI still installs the 3D packages first, so check 19 can run); the scenic `follow` camera
failing checks 24 and 34 (the example passes both); melee under `third` and `orbit` cameras (a scenic spec with either
camera passed 27 of 27 with `--quick --release`).

| Fault | Where | Work-around here | Fix asked for |
|---|---|---|---|
| `lookdev/capture.mjs` (check 9's contact sheet) is left out | `tools/verify.mjs` | none needed: `--quick` skips it and a full verify says it is absent | none |
| Keeping a person's edits made while the play-tester had the game has no entry in the loop library | `loop/build-loop.mjs` (the `playtest` and `deliver` steps) | `gamesfun_keep_edits` (`mcp/tools/loop.mjs`) uses the library's own steps: it puts the play-tester's files back for the one step that reads the report (so the proof on record names those files), restores the kept files, and lets the delivery step's stale-proof rule send the loop to verify and then to the play-test again. With no report the round ends as an error, and the library then delivers with no play-test on the kept files (the kit's delivery answer says so by name) | `loop.keepEdits({wish})`: the wish on the state, from a handed play-test straight to verify, and a play-test afterwards also when the first round had no report |
| A friend's join sometimes hangs after the connection opens: the host never answers the friend's first message ("Connected. Waiting for the host…" until the gate times out) | `gf-multiplayer` 1.6.3's lobby (1.6.5 is the version new games get now; whether the hang still happens on it is not known) or the gate (`research/multiplayer/party/gate.mjs`); seen once on a Linux runner and once here under load (`docs/CI.md`, fault 7) | none: the run is repeated | find the race (it may be the one behind the ten refused `signal` calls after a join that track M is looking at) |
| `specs/dev-dodgeball.spec.json` names no `loop`, and a pitch card's spec must (`$.cards[n].spec.loop`) | `research/studio-v2/specs/` | none: the pitch round's message points to it as an example of a locked spec, where `loop` is optional | add `"loop": "round"` so the example is also a valid card spec |

## Examples

An example is `templates/examples/<id>/` with `spec.json` (a locked spec), `rules.js`, `README.md` (what it shows,
provenance) and `example.json` (`title`, `summary`, `verified: { result, kits, date }`). Optional `files/` is laid over
the created game (then `assets.json` is regenerated). An example ships only after `npx gamesfun verify --quick` passes
on a fresh `create --from` with the current kits; record the result in `example.json`. An example that a kit fault fails may list the failing checks in `example.json` → `knownFailing` and say why in its README; the smoke test then requires exactly those to fail. No example has one now (`giant-four` had check 7 until the kits carried audio gate v5). There is one per engine:
`soak-squad` (party, WebGL) and the scenic one (WebGPU, with WebGL2 inside WebGPURenderer where Chrome has no adapter), and `giant-four` for a game that is not a party round (the `turns` loop and the `board` mechanic, party engine).

`tests/try-it-shots.mjs <out dir> [port]` takes the screenshots `docs/TRY-IT.md` shows (`docs/try-it/01` to `10`) from real runs of the examples; run it again when the studio page or an example changes.

## The studio's web3 tabs

The Token and Shop tabs are off. `GET /api/studio/tabs` (`server/routes/studio.mjs`) leaves `token.js` and `shop.js` out of the
list the page builds its tab row from, so they are neither in the page nor reachable by keyboard, unless the dev server
was started with `GAMESFUN_WEB3=1` (the variable that also lists the MCP server's `web3_*` tools) or the game has a
`gamesfun.json`. `tests/web3-switch.test.mjs` holds both ways.

## Skills

`skills/<name>/SKILL.md` is the source. `node scripts/sync-skills.mjs` mirrors it byte for byte into `.claude/skills/`
and `.agents/skills/`; `tests/skills.test.mjs` fails on drift. The front matter `name` must equal the folder name.

## Cross-platform rules

No shell: child processes are `process.execPath` plus arguments (npm through `npm-cli.js`). No symlinks, no case-only
renames, no POSIX-only paths: build paths with `path.join`, show them with forward slashes (`toPosix`). Tests check
Windows path rules with `path.win32` so they run everywhere. `.gitattributes` makes text LF everywhere and keeps
`kits/` byte-exact.

## The one line: agents, doctor, connect, update

Code: `lib/agents.json` (the rows) and `lib/agents.mjs` (its reader), `lib/connect.mjs`, `lib/doctor.mjs`,
`lib/update.mjs`, `lib/proc.mjs` (programs started without a shell, trees stopped), `lib/mcp-check.mjs` (starts our
server and lists its tools), the three commands, `tests/one-line.test.mjs`. The text a person pastes and what the agent does
at each step: `docs/ONE-LINE.md`.

**A new agent is a row.** Copy a row in `lib/agents.json`: `binaries` per system, `install` per system, `mcp.add`,
`get`, `list`, `remove` as argument lists (`{name}`, `{scope}`, `{command}`, and the element `{...args}`), `scopes` and
`defaultScope`. `tests/one-line.test.mjs` validates every row. We never edit an agent's own configuration file; if an agent
has no command for adding a server, it does not get a row (document the manual step in `docs/MCP.md` instead).

**What the vendors document (fetched 2026-10-10; re-read before changing a row).**
- Claude Code, https://code.claude.com/docs/en/mcp: "claude mcp add [options] <name> -- <command> [args...]";
  "the `--` (double dash) separates Claude's own options, such as `--transport`, `--env`, and `--scope`, from the command
  and arguments that run the server"; scopes "`local` (default): available only to you in the current project",
  "`project`: shared with everyone in the project via the `.mcp.json` file", "`user`: available to you across all
  projects"; `claude mcp list`, `claude mcp get <name>`, `claude mcp remove <name>` (with `--scope <scope>` for a
  duplicate); "Claude Code prompts for approval in interactive sessions before using project-scoped servers from
  `.mcp.json` files" (until then `list` shows "Pending approval").
- Codex, https://learn.chatgpt.com/docs/extend/mcp?surface=cli (developers.openai.com/codex/mcp redirects there):
  "codex mcp add <server-name> --env VAR1=VALUE1 --env VAR2=VALUE2 -- <stdio server-command>"; "codex mcp list" shows
  configured servers; "By default this is `~/.codex/config.toml`"; project scope is `.codex/config.toml` ("trusted
  projects only"). `get`, `remove`, `list --json` and `CODEX_HOME` are not on that page; they are in `codex mcp --help`
  of codex-cli 0.160.0 (`CODEX_HOME` moved the config file in the run below).

**What is tested, and where.**
- Unit tests (`npm test`, any system): the rows; the agents' commands for both agents; Windows PATHEXT lookup and the
  `.cmd` shim through cmd.exe (with `path.win32`, a fake platform, and refusal of cmd.exe syntax characters); the
  `taskkill`/process-group choice; `connect` against a recording stand-in for the agents (register, already
  registered, replace, remove, a server that does not start, a refused add, dry run); `doctor` with injected probes
  (old Node, missing packages, software graphics, busy ports, a missing optional agent, per-system fixes); `update`
  against real git repositories made in a temporary folder (up to date, fast-forward, diverged, dirty, no upstream,
  `npm ci` only when the lockfile changed); the daily check's switches; the one line is identical in README and
  `docs/ONE-LINE.md`.
- Real runs on Linux (2026-10-10): `connect` against the installed Claude Code 2.1.296 in a scratch folder (project
  scope, then local scope, where `claude mcp list` shows "Connected"), and against codex-cli 0.160.0 with `CODEX_HOME`
  pointed at a scratch folder; each registration was removed afterwards.
- **Not run:** anything on Windows or macOS (no machine). Untested there: the `cmd.exe` call for `codex.cmd`, `taskkill`,
  `winget`/`brew` fix lines, Chrome and Edge lookup (covered by the kit's own tests), a real `claude.exe`.
  Codex's `.cmd` shim is the likeliest first failure on Windows.

**The daily update check** starts a detached `node bin/gamesfun.mjs update --refresh-cache` (stdio ignored, never awaited)
when `.gamesfun/update-check.json` is over a day old, and prints its cached note after a command that talks to a person.
Off with `GAMESFUN_NO_UPDATE_CHECK=1`, in CI, under `node --test`, for `--json` output and for `dev`.
git is started with `GIT_TERMINAL_PROMPT=0` so a private remote fails instead of asking a question.

## CI

`.github/workflows/check.yml` runs `npm ci`, the tests, and create plus `verify --quick --profile
.github/ci-profile.json` for the party and the scenic example on Ubuntu and Windows (pull requests) and macOS as well
(pushes to `main`). `docs/CI.md` has the profile, what a runner can check, the measured software-rendering runs and the
cost. It runs on GitHub since 2026-10-11, green on Linux, Windows and macOS; `docs/CI.md` section 7 lists what the
first runs found and section 8 what still has to be tried by hand on a real Windows machine or a Mac. One system or one
job runs alone by hand: `gh workflow run check.yml --ref <branch> -f system=windows -f job=scenic`.
