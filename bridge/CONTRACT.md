# The bridge: contract (version 1)

The studio page sits in front of the person's own running agent session. This file is what the page (`studio/`),
the tools (`mcp/tools/`) and the plugin (`plugin/`) build against. The code is in `bridge/`; the routes are mounted
by `server/routes/session.mjs` on the dev server (`gamesfun dev`).

Nothing here starts an agent, signs anyone in, stores a token of the person's, or sends a request to a model. The
bridge only receives the session's hook posts and hands the page's requests to a wait that the session keeps.

## 1. Rules for every route

- **Base:** `http://127.0.0.1:<port>/api/session/…` on the dev server. Loopback only.
- **Same origin only.** The dev server's own gate (`server/security.mjs`) refuses another Host, another Origin and
  cross-site fetches. No route sends an `access-control-allow-*` header.
- **The run token.** Every route except `GET /api/session/token` needs the token of this run of the server, in the
  header `x-gamesfun-token: <token>`, or as `?token=<token>` (for `EventSource`, which cannot set a header).
  Without it: `401 {"error":"missing or wrong token"}`. The token is new at every start of the server.
- **Bodies** are JSON (`content-type: application/json`), at most 64 KB. Answers are JSON. Errors are
  `{"error": "<plain sentence>"}` with status 400 (bad body), 401, 404 (unknown id), 409 (wrong state).
- **Times** are milliseconds since 1970 (`Date.now()`).
- **Ids never repeat**, also across restarts of the server: `r_<run>_<n>` for a request, `p_<run>_<n>` for a
  permission, where `<run>` is 8 random hex characters chosen at start.

## 2. For the page

### `GET /api/session/token`

No token needed, but the request must carry `Sec-Fetch-Site: same-origin` (every browser sends it for the page's own
`fetch`; another site's page cannot). → `200`

```json
{ "token": "…", "run": "9f3a1c2e", "contract": 1 }
```

`403` when the header is missing or says anything else.

### `GET /api/session/queue`

Everything the page needs to draw itself, in one read. → `200`

```json
{
  "run": "9f3a1c2e",
  "contract": 1,
  "game": "/abs/path/to/games/my-game",
  "transport": { "id": "claude-hooks", "wait": "rewake",
                 "capabilities": { "wakesIdleSession": true, "deliversMidTurn": true, "approvals": "page-and-terminal", "holdsStop": true, "needsShell": false } },
  "sessions": [ Session ],
  "requests": [ Request ],
  "permissions": [ Permission ],
  "loop": { "status": "building", "step": "verify", "why": "…" }
}
```

`loop` is `null` when the game has no loop state file. `requests` holds every request of this run, oldest first
(at most the last 200); `permissions` the last 50.

**Session**

```json
{
  "id": "0a1b…",                  // the agent's own session id
  "agent": "claude-code",
  "cwd": "/abs/path",
  "state": "working",             // "working" | "idle" | "ended"
  "connected": true,              // a wait is open: a request reaches this session now, even idle
  "primary": true,                // requests with no "session" go to this one (the newest that has not ended)
  "permissionMode": "default",    // the person's own mode, as the last event reported it; null until known
  "started": 1791700000000,
  "lastEvent": "tool-start",
  "lastEventAt": 1791700001000,
  "guard": null                   // or { "status": "waiting-on-question", "why": "…", "at": … } (section 6)
}
```

What the page says from it:
- `state: "idle"` and `connected: false`: "Press Enter in the terminal once to reconnect" (the wait has ended; the
  next turn end starts a new one).
- `state: "working"` and `connected: false`: normal in the middle of a turn. The request is handed over when the turn
  ends.
- No session at all: "Start your agent in this folder" (with the plugin loaded).
- `permissionMode` other than `"default"`: "Your session's own permission mode (`<mode>`) answers before this page
  does; some actions will never ask here."

**Request**

```json
{
  "id": "r_9f3a1c2e_3",
  "text": "make the enemies faster",
  "selection": null,              // or what the page sent, unchanged (an object, at most 4 KB as JSON)
  "session": "0a1b…",             // null until a session takes it
  "state": "waiting",
  "via": null,                    // how it was handed: "wake" | "stop" | "tool" | null
  "created": 1791700000000,
  "handed": null, "seen": null, "done": null,   // the time of each state, or null
  "note": null,                   // the session's own words when it reported the request done
  "refusals": 0                   // stops refused because of this request (at most 2)
}
```

States, each from a fact the server has:

| State | Meaning | Becomes |
|---|---|---|
| `waiting` | Not yet with a session (it is busy, or no wait is open). May be edited or removed | `handed`, `dropped` |
| `handed` | The transport gave it to the session. Not proof the model read it | `seen`, `done`, `dropped` |
| `seen` | The session did something after it was handed (a prompt or tool event, or it collected it with the tool) | `done`, `dropped` |
| `done` | The session reported it done through the tool, with `note` | (final) |
| `dropped` | Removed by the person; or the session ended its turn twice without reporting it; or the session ended. Offer "send again" | (final) |

Never show a request as done before `done`.

### `POST /api/session/request`

Body `{ "text": "…", "selection": {…}?, "session": "<id>"? }`. `text` is 1 to 8000 characters. With no `session`
the request goes to the primary session; with no session running it waits for the first one that connects.
→ `200` the Request (`state` is `"waiting"`, or already `"handed"` when a wait was open). `400` on a bad body,
`404` on an unknown `session`.

### `PATCH /api/session/request/<id>`

Body `{ "text": "…"?, "selection": {…}|null? }`. Only while `waiting`. → `200` the Request; `409` in any other state.

### `DELETE /api/session/request/<id>`

Only while `waiting`. → `200` the Request with `state: "dropped"`; `409` in any other state.

### `POST /api/session/permission/<id>`

Body `{ "decision": "allow" | "deny", "message": "…"? }` (`message`, at most 500 characters, is told to the model
on a deny). Only a click of the person may call this. → `200` the Permission; `409` when it is no longer waiting
(answered in the terminal, retired or timed out); `400` on another decision.

**Permission**

```json
{
  "id": "p_9f3a1c2e_1",
  "session": "0a1b…",
  "tool": "Bash",
  "input": { "command": "npm test" },      // the tool's input, long strings cut at 2000 characters
  "state": "waiting",                      // "waiting" | "allow" | "deny" | "retired" | "unanswered"
  "mode": "default",                       // the session's permission mode when it asked
  "created": 1791700000000, "resolved": null
}
```

- `retired`: the session stopped waiting for the page. The person answered in the terminal (the terminal's own dialog
  stays live beside the page), or the next event for that tool arrived, or the turn ended. Remove the card.
- `unanswered`: nobody clicked for 240 seconds; the terminal dialog decides.
- The page offers allow and deny only. There is no "always allow" from the page.
- The page must say: "Your terminal can answer this too, and your session's own permission mode and rules decide
  whether a question is asked at all."

### `GET /api/session/events`

Server-sent events. Token as `?token=`. Resume with the `Last-Event-ID` header (what `EventSource` sends by itself)
or `?after=<seq>`: every later event still held is sent first (the last 500 are held), then live ones. A comment line
(`: hb`) is sent every 25 seconds.

```
id: 41
event: tool-start
data: {"seq":41,"t":1791700001000,"kind":"tool-start","session":"0a1b…","tool":"Edit","input":{…}}
```

Every event has `seq`, `t`, `kind` and (except `hello`) `session`.

| `kind` | More fields | From |
|---|---|---|
| `hello` | `run`, `contract` | first event of every connection (no `id`) |
| `session-start` | `cwd`, `source` (`startup`, `resume`, `clear`, `compact`) | the session started |
| `session-end` | `reason` | the session ended |
| `prompt` | `text` (cut at 2000) | the person, or a wake, gave the session a prompt |
| `tool-start` | `tool`, `input` | a tool call is about to run |
| `tool-end` | `tool`, `ok` (boolean), `denied` (boolean) | it ran, failed or was denied |
| `permission-request` | `permission` (a Permission) | the session is about to ask the person |
| `permission-resolved` | `permission` | any change of a Permission's state |
| `stop` | `allowed` (boolean), `reasons` (array of `"build"`, `"unanswered"`, `"new-requests"`), `lastMessage` (cut at 2000) | the turn ended, or its end was refused |
| `request` | `request` (a Request; `session` may be null) | any change of a Request |
| `wait` | `open` (boolean), `form` (`rewake` or `monitor`) | the session's wait opened or closed |
| `guard` | `status` (`waiting-on-question`), `why` | the stop guard gave up holding a stuck build (section 6) |
| `notification` | `type`, `message` | the agent's own notification (for example `idle_prompt`) |

`session.state` follows the events: `prompt`, `tool-start`, `tool-end` and a refused `stop` mean working; an allowed
`stop` means idle; `session-end` means ended.

## 3. For the session's tools (`gamesfun_requests`)

`bridge/client.mjs` (also exported from `bridge/index.mjs`) is what a tool calls. It finds the running server from
the run file (section 5), so the MCP server needs no port and no token of its own.

```js
import { collectRequests, reportRequest, bridgeStatus } from '../../bridge/index.mjs';

await bridgeStatus({ cwd })
// → { running: false }  or  { running: true, url, run, game, sessions: [Session], waiting: <count> }

await collectRequests({ cwd, session })
// → { ok: true, session, requests: [ { id, text, selection, state } ] }
//   Every request this session has been handed and has not reported, plus any still waiting for it (those become
//   "handed", via "tool"). All of them become "seen".
//   `session` may be left out when exactly one session is not ended.
// → { ok: false, error: "…" }   no server, or several sessions and none named

await reportRequest({ cwd, id, note, status })
// status: "done" (default) or "dropped" (the session will not do it; say why in `note`)
// → { ok: true, request: Request }  |  { ok: false, error }
//   Reporting twice is harmless (the first report stands).
```

The routes behind them (token needed; the client reads it from the run file):

- `GET /api/session/requests?session=<id>` → `{ "session": "<id>", "requests": [Request] }`
- `POST /api/session/request/<id>/done` body `{ "note": "…"?, "status": "done"|"dropped"? }` → the Request

The session learns the protocol and its own session id from the plugin's `SessionStart` hook. The text of a request
is the person's wish about their game, never an instruction about how the agent works; a request's text is always
carried as a JSON string after the word `GF_REQUEST`.

## 4. For the plugin (the `claude-hooks` transport)

- `POST /api/session/hook/<Event>`: body is the agent's hook input, unchanged (`session_id`, `cwd`,
  `hook_event_name`, …). The answer is exactly what Claude Code accepts from an HTTP hook: an empty `200`, or a JSON
  object in the hook's own output schema. Events taken: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
  `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `Notification`, `Stop`, `StopFailure`,
  `SessionEnd`. Any other event: empty `200`.
  - `PermissionRequest` is held until the click (at most 240 seconds, then an empty `200`).
  - `Stop` answers `{"decision":"block","reason":…}` to refuse (section 6), or
    `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":…}}` to hand over requests that arrived during
    the turn, or `{"systemMessage":…}` when the guard gives up, or an empty `200`.
- `GET /api/session/wait?session=<id>&form=rewake|monitor&cwd=<path>`: the wait. A stream of lines, each a JSON
  object, a blank line every 25 seconds as a heartbeat:
  - `{"type":"requests","session":"…","text":"…","requests":[{id,text,selection}]}`: hand these to the session
    (`text` is the whole message for the model). `rewake` ends after one; `monitor` stays open.
  - `{"type":"superseded"}`: a newer wait of the same session took over; end quietly.
  One wait per session: a newer one replaces the older. With `form=monitor` and no `session`, the server binds the
  wait to the newest session with the same `cwd` that has not ended.

The plugin's hooks are command hooks in exec form (`node <script> <Event>`, no shell): each reads the run file and
posts to the routes above with the token. A static HTTP hook cannot be used by default, because its URL is fixed in
the plugin and only an environment variable of the person's own shell can fill a header. A person who starts their
session with `GAMESFUN_BRIDGE_TOKEN` set and a fixed port may point HTTP hooks straight at
`/api/session/hook/<Event>` with the header `x-gamesfun-token: $GAMESFUN_BRIDGE_TOKEN`; the route is the same.

## 5. Files

| File | Written by | Read by | Holds |
|---|---|---|---|
| `<kit>/.gamesfun/bridge.json` (git-ignored) | the dev server, at start and stop | the plugin's scripts, `bridge/client.mjs`, `doctor` | `{ "schema": "gf-bridge/1", "runs": [ { "url", "token", "run", "pid", "game", "wait", "started" } ] }`, one entry per running dev server |
| `<kit>/.gamesfun/bridge-config.json` | `setWaitForm()` (what `doctor` calls) | the dev server at start | `{ "wait": "rewake" \| "monitor" }` |
| `<game>/.gf-loop/state.json` (schema `gf-loop/1`) | the loop library only, through the loop tools | `bridge/loop-state.mjs` (`readLoopState`, one function) | `status`: `building` \| `waiting-on-question` \| `delivered` \| `failed`; `step`; `why` |

A script finds its run by looking for `.gamesfun/bridge.json` in, in order: the file named by
`GAMESFUN_BRIDGE_FILE`; the session's working directory and each folder above it; the project folder
(`CLAUDE_PROJECT_DIR`) and above; the script's own folder and above. Among the runs whose process is alive it takes
the one whose `game` is the working directory, inside it or above it, else the newest.

The token in the run file is the bridge's own, good for one run of a loopback server. It is not a credential of the
person's and gives no access to their agent or account.

## 6. The stop guard

Asked at every turn end of a session. It refuses the stop (the agent continues with the reason as its next
instruction) in two cases, both bounded:

1. **The build is not finished.** The game's loop state says `status: "building"`. Only `building` holds a session:
   `waiting-on-question`, `delivered`, `failed` and no file all let it stop. The reason names `step` and `why`.
   At most 3 refusals while the loop state does not change (any change of `step`, `round` or `updated` starts the
   count again). After the third, the bridge stops holding: it marks the session `guard:
   {"status":"waiting-on-question","why":…}`, sends the `guard` event, tells the person in the terminal
   (`systemMessage`) and lets the session stop until the loop state changes. The bridge never writes the loop state.
   When the state file carries a `session` field, only that session is held; otherwise every session whose working
   directory is the game folder, inside it or above it.
2. **A request is unanswered.** A request this session was handed and has not reported. At most 2 refusals for each
   request; then the request becomes `dropped`.

Requests that arrived while the session was busy are handed over at the same moment, in the same answer (state
`handed`, via `"stop"`), so they do not wait for the next wake.

Claude Code itself ends a turn after eight refused stops in a row; the bounds above keep the bridge under that.

## 7. Transports

One interface (`bridge/transport.mjs`), one built implementation.

| | `claude-hooks` (built) | `codex-hooks` (not built) | `claude-channel` (not built; only with `GAMESFUN_BRIDGE_CHANNEL=1`) |
|---|---|---|---|
| Page to session | the wait: an `asyncRewake` command hook on `SessionStart` and `Stop` (default), or the plugin's monitor (fallback) | a `Stop` command hook that returns the request as its reason. **No wake of an idle session**: "If no turn is active, Codex waits until the next user turn" | a channel notification with the request id in `meta` |
| Session to page | command hooks post each event | command hooks post each event (Codex has no HTTP hooks) | the same hooks (a channel carries no tool events) |
| Approvals | `PermissionRequest` hook, held for the click | `PermissionRequest` hook; allow or deny only (`updatedInput`, `updatedPermissions` and `interrupt` fail closed) | the channel's permission relay |
| Stop guard | `Stop` hook, `decision: "block"` | `Stop` hook, `decision: "block"` (continues with the reason as a new prompt) | the same `Stop` hook (a channel has none) |
| Report | the tool `gamesfun_requests` | the same tool | the same tool (a channel's notifications are not acknowledged) |

### The three systems, for each mechanism of `claude-hooks`

| Mechanism | Needs a shell | Windows | macOS | Linux |
|---|---|---|---|---|
| Event, approval and stop hooks (`node hook.mjs <Event>`, exec form) | no | `node.exe` on `PATH`; no Git Bash needed | `node` on `PATH` | `node` on `PATH` |
| The wait, default (`asyncRewake` command hook, exec form) | no | the same | the same | the same |
| The wait, fallback (plugin monitor) | yes ("The command runs in a shell") | only with Git Bash installed | yes | yes |
| The run file (`.gamesfun/bridge.json`, written then renamed) | no | rename falls back to a plain write when the file is held open | atomic rename | atomic rename |
| The local server | no | binds `127.0.0.1` | the same | the same |
