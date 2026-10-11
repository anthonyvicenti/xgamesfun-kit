# The one line

A person pastes one line into the coding agent they already run (Claude Code or Codex) in their own terminal. Their
agent fetches this repository, checks the machine, adds our tools to itself through its own commands, and opens the
studio page. Nothing here signs anyone in, stores a token, or sends a request to a model: the person's agent does all the
talking to the model, under the person's own login.

## The line

Paste this, as it is, into the agent:

```text
Set up the games.fun game-building kit on this machine: git clone https://github.com/anthonyvicenti/gamesfun-kit.git (skip the clone if a gamesfun-kit folder is already here), then in that folder run these, one at a time, with Node 24: npm ci, then node bin/gamesfun.mjs doctor, then node bin/gamesfun.mjs connect, then node bin/gamesfun.mjs create games/first --from soak-squad, then start node bin/gamesfun.mjs dev games/first in the background and give me the studio address it prints (it opens my browser too). Tell me what each step printed in one line. If a step fails, do what its "If it fails" section in gamesfun-kit/docs/ONE-LINE.md says, and if that doesn't fix it, stop and tell me exactly what failed. Never ask me for a password, token or key.
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
agent now lists it. The default scope for Claude Code is `user`, so the tools are there in every folder; Codex has one
scope. It never edits an agent's configuration file.

If it fails:
- **"our MCP server did not start"**: nothing was registered. Read the message under it, run `doctor`, run `npm ci`
  again, and repeat `connect`.
- **"already registered"**: it was left as it is. Run `node bin/gamesfun.mjs connect --replace` only if the person
  wants it to point at this checkout.
- **An agent "refused"**: the message is the agent's own. Show it to the person. The tools are optional: the kit works
  without them, because the agent can run `node bin/gamesfun.mjs …` in a terminal.
- **"no coding agent found"**: also fine for the same reason; say so.
- Claude Code with `--scope project` asks the person to approve the server the first time they open the folder.

When it succeeds, tell the person the new tools appear in a **new** session (start a new Claude Code or Codex session in
the `gamesfun-kit` folder; in Claude Code `/mcp` lists servers). Do not restart the person's session yourself.

### 5. `node bin/gamesfun.mjs create games/first --from soak-squad`, then `dev`

`create` copies a finished example game into `games/first`. `dev games/first` serves it on 127.0.0.1, opens the studio
in the person's browser, and keeps running, so start it in the background and read its address from the first lines it
prints (`studio http://127.0.0.1:5180/studio/`).

If it fails:
- **The port is busy**: `dev` takes the next free port from 5180 to 5189 by itself; `--port <n>` picks one.
- **The browser did not open**: give the person the address to open.
- **`games/first` already exists**: use it; do not overwrite (`create` refuses without `--force`).
- Leave the dev server running when you finish; tell the person `Ctrl+C` in that terminal (or `gamesfun_dev_stop`
  from the tools) stops it.

### What to say at the end

Four lines: what is installed and where; whether the tools were added (and to which agent); the studio address; and
what to do next: say what game you want, in your own words (see `AGENTS.md`). Mention
`node bin/gamesfun.mjs update` for later; it fetches the newest kit (never changes `games/`).

## Updating

`node bin/gamesfun.mjs update` fast-forwards this checkout (it never merges or discards changes) and runs `npm ci` only
when the lockfile changed. A background check, at most once a day and never delaying a command, prints one line when a
newer kit exists. `GAMESFUN_NO_UPDATE_CHECK=1` turns it off.

## What was and was not tested

See `docs/DEVELOPING.md`, "The one line: what is tested".
