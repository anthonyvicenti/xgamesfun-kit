# The gamesfun MCP server

`mcp/server.mjs` speaks MCP over stdio. It exposes the CLI's operations as tools, so an agent can call them directly
instead of running `npx gamesfun …` in a terminal (both work; the playbook uses the commands). Tools:

| Tool | Does |
|---|---|
| `gamesfun_catalog` | what the kit can build (sections: mechanics, worlds, looks, bodies, props, clips, fair, spec) |
| `gamesfun_examples`, `gamesfun_games` | the example games; the games in `games/` |
| `gamesfun_create` | make a game from an example (`from`) or a spec file (`spec`) |
| `gamesfun_verify` | verify a game (quick by default; `check` for one check); streams progress |
| `gamesfun_slots_list`, `gamesfun_slots_set` | list slots; set a value or swap a file |
| `gamesfun_dev_status`, `gamesfun_dev_start`, `gamesfun_dev_stop` | the dev server in the background: its URLs |

Plus any tools other parts of the kit add in `mcp/tools/*.mjs` (e.g. web3). Paths in tool arguments are relative to
the kit root, wherever the agent starts the server from. Requires `npm ci` first.

## Claude Code

Nothing to do: `.mcp.json` at the root declares the server, and Claude Code asks you to approve it the first time you
open the folder. By hand: `claude mcp add gamesfun -- node mcp/server.mjs` (from the kit root).

## Codex

In `~/.codex/config.toml` (use the absolute path of your checkout; on Windows write it with forward slashes or
doubled backslashes):

```toml
[mcp_servers.gamesfun]
command = "node"
args = ["/path/to/gamesfun-kit/mcp/server.mjs"]
```

## Cursor

In `.cursor/mcp.json` at the root of this folder (or Cursor's global MCP settings):

```json
{
  "mcpServers": {
    "gamesfun": { "command": "node", "args": ["${workspaceFolder}/mcp/server.mjs"] }
  }
}
```

## opencode

In `opencode.json` at the root of this folder:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "gamesfun": { "type": "local", "command": ["node", "mcp/server.mjs"], "enabled": true }
  }
}
```

## Cline and others

Any client that starts a stdio server: command `node`, argument the absolute path of `mcp/server.mjs`.

## Notes

- `gamesfun_verify` takes about 2 minutes with `quick`; clients with a short tool timeout should use the CLI instead
  (`npx gamesfun verify <game> --quick`).
- The server never writes to stdout except the protocol; its logs go to stderr.
- Tools that would spend money or change chain state return a step for the person ("open this link and approve in
  your wallet"); none signs anything.
