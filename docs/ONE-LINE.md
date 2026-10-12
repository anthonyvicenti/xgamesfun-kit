# The one line

A person pastes one line into the coding agent they already run (Claude Code or Codex) in their own terminal. Their
agent fetches this repository, checks the machine, adds our tools to itself through its own commands, and opens the
studio page. Nothing here signs anyone in, stores a token, or sends a request to a model: the person's agent does all the
talking to the model, under the person's own login.

## The line

Paste this, as it is, into the agent:

```text
I want you to set up the XGames.fun game kit in this folder so I can make games in its studio. Here is what that involves, and I agree to it: git clone https://github.com/anthonyvicenti/gamesfun-kit.git (skip the clone if a gamesfun-kit folder is already here), then in that folder, with Node 24, run these one at a time: npm ci, then node bin/gamesfun.mjs doctor, then node bin/gamesfun.mjs connect, then start node bin/gamesfun.mjs dev in the background and give me the studio address it prints (it opens the studio's start page in my browser, where I describe my first game). connect adds the kit's tools and a plugin to you at user scope; the plugin lets the studio page on 127.0.0.1 show this session, send it my requests and answer its permission prompts. I can undo it with node bin/gamesfun.mjs connect --remove. Tell me what each step printed in one line. If a step fails, do what its "If it fails" section in gamesfun-kit/docs/ONE-LINE.md says, and if that doesn't fix it, stop and tell me exactly what failed. Never ask me for a password, token or key. End your last message with the line connect printed after "next:" (what I type in this session so the studio page reaches it), word for word, and nothing after it.
```

The address in the line is where the repository lives today; replace it when the repository is public. (Until then the
repository is private, and a clone fails for anyone it was not shared with: see step 1.)

Why these commands and not `npx gamesfun …`: `node bin/gamesfun.mjs` is the same program and works on every system and
every npm.

## What the agent does, step by step, and what to do when it fails

An agent reads this file after step 1. Every failure ends the same way: say plainly what failed, say what you tried,
and stop for the person. Do not work around a refusal by editing files in `kits/`, changing the agent's own
configuration files, or asking for credentials.

### 1. Clone

`git clone https://github.com/anthonyvicenti/gamesfun-kit.git` into the folder the person is in (ask where only if that
folder is the home folder or a system folder). The folder is `gamesfun-kit`.

If it fails:
- **`git` not found**: tell the person the one command for their system, which `doctor` would also print: Windows
  `winget install Git.Git`, macOS `xcode-select --install`, Linux `sudo apt install git` (or the distribution's
  package manager). Run it only if they say yes, then clone again.
- **The folder already exists**: do not clone over it. If it is a git checkout of this kit, run
  `node bin/gamesfun.mjs update` in it and carry on; if not, ask for another folder.
- **Authentication or "repository not found"** (the repository is private today): stop. Tell the person the repository
  has not been shared with their account. Do not ask for, read, or paste a token or password; the person fixes access
  themselves (for example by signing in to GitHub in their own terminal) and pastes the line again.

### 2. `npm ci` (in `gamesfun-kit`)

Installs the two packages the kit needs, exactly as locked. Needs Node 24 or newer.

If it fails:
- **`node` not found, or `EBADENGINE` / an old version**: `node --version` must say 24 or higher. The fix per system:
  Windows `winget install OpenJS.NodeJS`, macOS `brew install node@24`, Linux `nvm install 24`. Then open a new
  terminal (the agent may need restarting to see it) and repeat.
- **A network error**: try once more; if it fails again, say the registry could not be reached and stop.
- **A permissions error (`EACCES`, `EPERM`)**: the folder is not one the person can write to. Clone somewhere under
  their home folder instead. Never use `sudo` or an administrator shell for `npm ci`.

### 3. `node bin/gamesfun.mjs doctor`

Prints one line per check: Node, packages, kits, git, browser, graphics, ports, write access, and each agent. A `FAIL`
line blocks a first game and the exit code is 1; every other line is information. Each problem line prints the one
command that fixes it on this system (`--all-systems` prints all three).

If it fails (exit code 1): run the fix command printed under the `FAIL` line (ask first when it installs something
system-wide), then run `doctor` again. Stop if the same line fails twice.
Report these without trying to fix them: `warn` lines about graphics (software rendering means games run slowly and
scenic games may not run), an agent that is not installed (the kit works from any agent that reads `AGENTS.md`), or
no Chrome or Edge (the first `verify` downloads Playwright's Chromium, about 170 MB, and says so).

### 4. `node bin/gamesfun.mjs connect`

Starts our MCP server once to check that it runs and lists its tools, then adds it to every agent `doctor` found, using
that agent's own command (`claude mcp add …`, `codex mcp add …`; the rows are in `lib/agents.json`), and checks the
agent now lists it. For Claude Code it then installs this kit's plugin from this checkout, again with the agent's own
commands (`claude plugin marketplace add <this folder>`, `claude plugin install gamesfun@gamesfun-kit`), and checks the
agent lists it. The plugin is the hooks that link the studio page to the person's session (a change typed in the page
reaches the session, the session's steps and permission questions show in the page, a build is not left half done) and
the play-tester subagent. The default scope for Claude Code is `user`, so both are there in every folder; Codex has one
scope and no plugin yet (its sessions get the tools, not the page's link). It never edits an agent's configuration
file.

If it fails:
- **"our MCP server did not start"**: nothing was registered. Read the message under it, run `doctor`, run `npm ci`
  again, and repeat `connect`.
- **"already registered"** or **plugin "already installed"**: it is this checkout's already, and was left as it is.
- **A `moved:` line**: connect re-points by itself. The MCP server, the plugin marketplace or the plugin (or Codex's
  server) had been added from another folder, an older or a deleted clone, so it was taken out and added again from
  this checkout; the line names the old folder and the new one. Nothing to fix. If the old folder is still a kit, the
  line says so: running `connect` in that folder switches back. (`--replace` registers again even when it is this
  checkout's already.)
- **An agent "refused"**: the message is the agent's own. Show it to the person. The tools are optional: the kit works
  without them, because the agent can run `node bin/gamesfun.mjs …` in a terminal.
- **plugin "failed"**: the tools are registered and the first game works; the studio page will say "no session" until
  the plugin is in. Show the person the agent's message and carry on with step 5.
- **"no coding agent found"**: also fine for the same reason; say so.
- Claude Code with `--scope project` asks the person to approve the server the first time they open the folder.

Before you run it, know what it does, because the person's line says it too: it adds the kit's tools and, for Claude
Code, a plugin at user scope (every folder). The plugin's hooks let the studio page on 127.0.0.1 show this session,
hand it the requests the person types there, and answer its permission prompts from the page; the session's own
permission mode still decides first. `connect --remove` takes both out.

When it succeeds it prints a line that starts `next:`. For Claude Code it is: **type `/reload-plugins` in the session
you are in, then say hi**. That one command loads the new tools and the plugin's hooks into the running session (checked on Claude
Code 2.1.296, 2026-10-11); only the person can type it, so say it to them as the last thing. With their next message
the session is told its id and how the page talks to it. A new session picks everything up by itself. Do not restart
the person's session yourself.

`connect --remove` takes the tools and the plugin out again.

### 5. `node bin/gamesfun.mjs dev`

`dev` with no game folder serves the studio's start page on 127.0.0.1, opens it in the person's browser, and keeps
running, so start it in the background and read its address from the first lines it prints
(`studio http://127.0.0.1:5180/studio/`). Nothing is played or shown on the start page: no game, no example and no
preview until the person's first prompt. They describe their first game there (the idea goes to their session, which
starts the build loop, and the preview says "Making your game" until the first build is delivered), open one of theirs
from `games/` (listed, never opened for them), or pick an example. Do not make a game for them, and do not start `dev`
with a game folder.

If it fails:
- **The port is busy**: `dev` takes the next free port from 5180 to 5189 by itself; `--port <n>` picks one.
- **The browser did not open**: give the person the address to open.
- Leave the dev server running when you finish; tell the person `Ctrl+C` in that terminal (or `gamesfun_dev_stop`
  from the tools) stops it.

### What to say at the end

Four short lines: what is installed and where; whether the tools and the plugin were added (and to which agent); the
studio address, where they describe their first game; and then, as the very last line, word for word, the line
`connect` printed after `next:`. In Claude Code that line tells the person to type `/reload-plugins` and say hi. It is
the one step a person has to do by hand: an agent cannot reload its own plugins. Nothing comes after it.

## Updating

`node bin/gamesfun.mjs update` fast-forwards this checkout (it never merges or discards changes) and runs `npm ci` only
when the lockfile changed. A background check, at most once a day and never delaying a command, prints one line when a
newer kit exists. `GAMESFUN_NO_UPDATE_CHECK=1` turns it off.

## For a test machine

Two pairs of environment variables, read only when the matching option is not given, let the line run unchanged
without touching the machine's own setup: `GAMESFUN_CONNECT_SCOPE` and `GAMESFUN_CONNECT_DIR` (the scope and folder
`connect` registers in) and `GAMESFUN_DEV_PORT` and `GAMESFUN_NO_OPEN=1` (the port `dev` takes, and no browser).

## What was and was not tested

See `docs/DEVELOPING.md`, "The one line: what is tested", and `tests/e2e-live/README.md` for the whole line run in a
real session from a fresh clone (Linux, 2026-10-11, Claude Code 2.1.296): `connect` added the server and the plugin,
and `/reload-plugins` loaded both into the running session ("1 plugin · 7 agents · 13 hooks", the `gamesfun` server
connected). Typed in the same second as the install, `/reload-plugins` ran before Claude Code had noticed the changed
settings and loaded nothing; a second later it did. A person types it after the line has finished. Not run on
Windows or macOS: the by-hand steps are in that README.
