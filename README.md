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
I want you to set up the XGames.fun game kit in this folder so I can make games in its studio. Here is what that involves, and I agree to it: git clone https://github.com/anthonyvicenti/gamesfun-kit.git (skip the clone if a gamesfun-kit folder is already here), then in that folder, with Node 24, run these one at a time: npm ci, then node bin/gamesfun.mjs doctor, then node bin/gamesfun.mjs connect, then start node bin/gamesfun.mjs dev in the background (it opens the studio's start page in my browser, where I describe my first game), then start node bin/gamesfun.mjs session wait in the background too. session wait is how the studio page reaches you in this session: it ends when I send something from the page and prints my request and how to build it, so when it ends, build what I asked with the kit's commands, report it with the command it names, and start session wait again. You don't need the kit's tools loaded in this session and nothing needs a reload: every tool has a node bin/gamesfun.mjs command. connect adds the kit's tools and a plugin to you at user scope for my next sessions; the plugin lets the studio page on 127.0.0.1 show my sessions, send them my requests and answer their permission prompts. I can undo it with node bin/gamesfun.mjs connect --remove. Tell me what each step printed in one line. If a step fails, do what its "If it fails" section in gamesfun-kit/docs/ONE-LINE.md says, and if that doesn't fix it, stop and tell me exactly what failed. Never ask me for a password, token or key. End with the studio address, and tell me to type my first game idea there.
```

Your agent clones this repository, installs it, checks your machine (`doctor`), adds our tools to itself through its own
commands (`claude mcp add`, `codex mcp add`, and for Claude Code `claude plugin install` for the hooks that link the
studio page to your session: `connect`), and opens the studio's start page. There you describe a game in your own words
(or start from an example): your session pitches a few takes in the studio's conversation, you pick one, and it builds
it while the game appears beside the conversation. Nothing else is typed in the terminal: the line's last step,
`session wait`, is how the page reaches the session you pasted it into (it needs no reload and no plugin, and the
session builds with the kit's commands, which do everything the tools do); new sessions get the tools and the plugin
by themselves.
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
npx gamesfun dev
```

**macOS and Linux**

```bash
npm ci
npx gamesfun dev
```

`dev` opens the studio's start page in your browser. Nothing plays there until you say what you want: describe a game
(your agent session pitches a few takes and builds the one you pick; the preview says "Making your game" until it is
done), open one of yours from `games/`, or pick an example (`npx gamesfun examples` lists them; **Start from this**
copies one into `games/`). With a game open you get the conversation with your agent, the game (play it with bots), its
tools, verify runs and a **Play with friends** lobby. Open the lobby in two tabs, Host in one and Join with the invite
link in the other, and you are two players in one game.

## Engines

A spec names one engine (`npx gamesfun catalog engines` lists them, with what each is for):

| Engine | For | Draws with |
|---|---|---|
| `party` (gf-three) | silly party games with friends | WebGL (three.js) |
| `flat` (gf-three) | 2D games seen from above or from the side | WebGL (three.js) |
| `scenic` (gf-scenic) | serious, scenic and action games: adventure, roguelite, brawler | WebGPU, or WebGL2 inside the same renderer |
| `vista` (gf-vista) | calm games where the place is the point: a coast, the sea, the sky; fishing with friends | **WebGPU only**, on a desktop graphics card |

**vista is not open yet.** games.fun is still building it, so the catalog does not offer it to a pitch unless
`GF_VISTA_OPEN=1` is set. It has no WebGL path: a browser without WebGPU, or a card with fewer than 31 sampled or 5
storage textures per shader stage, gets the kit's "open in a browser with WebGPU" screen; never a phone, never inside a
post on X. Each vista game carries the engine's core (about 53 MB; about 62 MB a game). Its clouds are the core's
own (MIT): this kit leaves out the volumetric sky-pro-webgpu clouds games.fun's Studio draws, whose notice names a
separate licence. The example is `lantern-cove`. games.fun's forge engine is not in this kit.

**Then open this folder in your agent and say what you want**: "make a game where we defend a lighthouse from crabs",
"make the water red and the rounds shorter", "swap the bucket for this model". The agent reads `AGENTS.md` (the
playbook) and the skills in `skills/`.

## What the commands do

| Command | |
|---|---|
| `npx gamesfun examples` | complete example games to start from: `soak-squad` (a party round), `giant-four` (a turn-based board game), `isle-run` (a scenic action run), `coin-hop` (a 2D platformer); `lantern-cove` (a calm fishing evening on the vista engine) with `GF_VISTA_OPEN=1` |
| `npx gamesfun catalog [--all]` | what the kit can build: engines (`catalog engines`), loops (how a game is played), mechanics, worlds, looks, bodies, props |
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
| `npx gamesfun login` / `publish [dir]` / `logout` | put a game on games.fun at a link anyone can play: games.fun hosts it, the game's checks gate it, the link is unlisted, publishing again updates it ([docs/PUBLISH.md](docs/PUBLISH.md)) |

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
