# games.fun kit

Make multiplayer 3D browser games with the AI coding agent you already use (Claude Code, Codex, Cursor, opencode,
Cline…). You say what you want; your agent pitches it, locks a spec, builds it on games.fun's three.js kit
(**gf-three**), and checks it in a real browser until it passes. Friends join from their own browser and see each other
in the game. Every model, texture and number is a slot you can swap without code.

Windows, macOS and Linux. No desktop app and no build step: Node 24 and Chrome. For advanced users.

**Trying it by hand on Windows or a Mac?** [docs/TRY-IT.md](docs/TRY-IT.md) is one page: what to install, the one
line, what you should see, eight things to try and what to send us when one goes wrong.

## The one line

Open your coding agent (Claude Code or Codex) in a terminal and paste this:

```text
I want you to set up the XGames.fun game kit in this folder so I can make games in its studio. Here is what that involves, and I agree to it: git clone https://github.com/anthonyvicenti/gamesfun-kit.git (skip the clone if a gamesfun-kit folder is already here), then in that folder, with Node 24, run these one at a time: npm ci, then node bin/gamesfun.mjs doctor, then node bin/gamesfun.mjs connect, then start node bin/gamesfun.mjs dev in the background and give me the studio address it prints (it opens the studio's start page in my browser, where I describe my first game). connect adds the kit's tools and a plugin to you at user scope; the plugin lets the studio page on 127.0.0.1 show this session, send it my requests and answer its permission prompts. I can undo it with node bin/gamesfun.mjs connect --remove. Tell me what each step printed in one line. If a step fails, do what its "If it fails" section in gamesfun-kit/docs/ONE-LINE.md says, and if that doesn't fix it, stop and tell me exactly what failed. Never ask me for a password, token or key. End your last message with the line connect printed after "next:" (what I type in this session so the studio page reaches it), word for word, and nothing after it.
```

Your agent clones this repository, installs it, checks your machine (`doctor`), adds our tools to itself through its own
commands (`claude mcp add`, `codex mcp add`, and for Claude Code `claude plugin install` for the hooks that link the
studio page to your session: `connect`), and opens the studio's start page. There you describe a game in your own words
(or start from an example): your session pitches a few takes in the studio's conversation, you pick one, and it builds
it while the game appears beside the conversation. One step is yours: in Claude Code, type `/reload-plugins` once in the
same session (an agent cannot reload its own plugins); the tools and the page's link are live without a restart.
`node bin/gamesfun.mjs connect --remove` takes the tools and the plugin out again. Your agent talks to the model the way
it always does, under your own login; nothing here signs you in or sends anything to a model. What each step does and
what the agent does when one fails: [docs/ONE-LINE.md](docs/ONE-LINE.md). The line names the address the repository has
today; it changes when the repository is public.

Stay current with `node bin/gamesfun.mjs update` (fast-forward only; a once-a-day background check prints one line when
there is a newer kit, and `GAMESFUN_NO_UPDATE_CHECK=1` turns it off).

## Quick start by hand

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
| `npx gamesfun examples` | complete example games to start from: `soak-squad` (a party round), `giant-four` (a turn-based board game), `isle-run` (a scenic action run), `coin-hop` (a 2D platformer) |
| `npx gamesfun catalog [--all]` | what the kit can build: loops (how a game is played), mechanics, worlds, looks, bodies, props |
| `npx gamesfun create <dir> --from <example>` or `--spec <spec.json>` | make a game |
| `npx gamesfun dev [dir]` | the studio, live reload and local multiplayer (127.0.0.1 only); a game on multiplayer kit 1.6.4 or newer opens its rooms online ([docs/ONLINE.md](docs/ONLINE.md); `GAMESFUN_ONLINE=off` keeps them on this machine) |
| `npx gamesfun verify [dir] --quick` | the checks a game must pass, in real Chrome with real input (about 2 minutes) |
| `npx gamesfun slots list\|get\|set …` | list and swap slots (`slots set prop.bucket --file my.glb`) |
| `npx gamesfun play [dir] --steps '…' --out <dir>` | play it like a new player, with screenshots |
| `npx gamesfun promises [dir]` | what the game promises a player |
| `npx gamesfun upgrade [dir]` | move a game onto newer kits, keeping its rules and config |
| `npx gamesfun rig-check <body.glb>` | does a model work as a character body? |
| `npx gamesfun meshy prop\|character …` | optional: generate a model with your own Meshy key |
| `npx gamesfun doctor` | is this machine ready? One line per check, with the one command that fixes each problem on your system (`--json`) |
| `npx gamesfun connect` | add our MCP server to Claude Code and Codex through their own commands, and for Claude Code install the kit's plugin (the studio page's link to your session); checks both (`--remove` undoes it) |
| `npx gamesfun update` | fetch and fast-forward the kit; `npm ci` only if the lockfile changed |

`npx gamesfun <command> --help` gives each one's options. If `npx` can't find the command (an older npm), run
`node bin/gamesfun.mjs <command>` instead: it is the same program.

## Your agent

- **Claude Code**: open this folder. `CLAUDE.md` imports `AGENTS.md`, the skills are in `.claude/skills/`, and
  `.mcp.json` offers the `gamesfun` MCP server (approve it when asked). `connect` adds it for every folder instead.
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
Google and others. The people and projects to thank, with the credit line each licence asks for, are in
[CREDITS.md](CREDITS.md); every licence is listed in [THIRD_PARTY.md](THIRD_PARTY.md).

## Licence

MIT: see [LICENSE](LICENSE). It covers everything of ours in this repository. The models, textures and libraries that
come from other people keep their own licences; [docs/LICENSING.md](docs/LICENSING.md) says which is which and what a
game you make with the kit has to carry.
