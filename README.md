# games.fun kit

Make multiplayer 3D browser games with the AI coding agent you already use (Claude Code, Codex, Cursor, opencode,
Cline…). You say what you want; your agent pitches it, locks a spec, builds it on games.fun's three.js kit
(**gf-three**), and checks it in a real browser until it passes. Friends join from their own browser and see each other
in the game. Every model, texture and number is a slot you can swap without code.

Windows, macOS and Linux. No desktop app and no build step: Node 24 and Chrome. For advanced users.

## Quick start

You need **Node 24** (`node --version`) and **Google Chrome** or **Microsoft Edge** (without either, the kit downloads
Playwright's Chromium the first time it needs a browser). Clone this repository, then in its folder:

**Windows (PowerShell)**

```powershell
npm ci
npx gamesfun create games/my-game --from soak-squad
npx gamesfun dev games/my-game
```

**macOS and Linux**

```bash
npm ci
npx gamesfun create games/my-game --from soak-squad
npx gamesfun dev games/my-game
```

`dev` opens the studio in your browser: the game on the left (play it with bots), its slots, verify runs, and a
**Play with friends** lobby. Open the lobby in two tabs, Host in one and Join with the invite link in the other, and you
are two players in one game.

**Then open this folder in your agent and say what you want**: "make a game where we defend a lighthouse from crabs",
"make the water red and the rounds shorter", "swap the bucket for this model". The agent reads `AGENTS.md` (the
playbook) and the skills in `skills/`.

## What the commands do

| Command | |
|---|---|
| `npx gamesfun examples` | complete example games to start from |
| `npx gamesfun catalog [--all]` | what the kit can build: mechanics, worlds, looks, bodies, props |
| `npx gamesfun create <dir> --from <example>` or `--spec <spec.json>` | make a game |
| `npx gamesfun dev [dir]` | the studio, live reload and local multiplayer (127.0.0.1 only) |
| `npx gamesfun verify [dir] --quick` | the checks a game must pass, in real Chrome with real input (about 2 minutes) |
| `npx gamesfun slots list\|get\|set …` | list and swap slots (`slots set prop.bucket --file my.glb`) |
| `npx gamesfun play [dir] --steps '…' --out <dir>` | play it like a new player, with screenshots |
| `npx gamesfun promises [dir]` | what the game promises a player |
| `npx gamesfun upgrade [dir]` | move a game onto newer kits, keeping its rules and config |
| `npx gamesfun rig-check <body.glb>` | does a model work as a character body? |
| `npx gamesfun meshy prop\|character …` | optional: generate a model with your own Meshy key |

`npx gamesfun <command> --help` gives each one's options. If `npx` can't find the command (an older npm), run
`node bin/gamesfun.mjs <command>` instead: it is the same program.

## Your agent

- **Claude Code**: open this folder. `CLAUDE.md` imports `AGENTS.md`, the skills are in `.claude/skills/`, and
  `.mcp.json` offers the `gamesfun` MCP server (approve it when asked).
- **Codex, Cursor, opencode, Cline**: open this folder; they read `AGENTS.md` (Codex also `.agents/skills/`). The MCP
  server is optional (the agent can run `npx gamesfun …` in a terminal); to add it, see [docs/MCP.md](docs/MCP.md).

## Optional: Meshy

To generate props and characters, put your own key in a `.env` file at the root of this folder (it is git-ignored):

```
MESHY_API_KEY=your-key
GF_MESHY_CAP=150
```

`npx gamesfun meshy status` shows what has been spent. Everything else works without it, from the kit's library of
CC0 and permissive models.

## Where things are

`games/` your games (git-ignored: each can be its own repository) · `AGENTS.md` the playbook · `skills/` the agent
skills · `templates/examples/` example games · `kits/` games.fun's kits, a pinned snapshot (never edited here) ·
`studio/`, `server/` the local studio · `mcp/` the MCP server · `docs/` for maintainers.

## Credits

Built on games.fun's kits: **gf-three** (the three.js game kit), **gf-multiplayer** (host-in-the-browser multiplayer),
**gf-audio** and **gf-assets**, snapshotted in `kits/` at the commit in `kits/KITS.json`. They carry three.js, Rapier,
pmndrs postprocessing, N8AO, ecctrl, ws and ZzFX, and a library of CC0 and CC BY models by Kenney, Quaternius, Poly by
Google and others. Every licence is listed in [THIRD_PARTY.md](THIRD_PARTY.md).

This repository has no licence yet: its owner has not chosen one.
