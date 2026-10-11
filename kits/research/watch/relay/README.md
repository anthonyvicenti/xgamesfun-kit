# Watch relay (track R of "watch then play")

A dumb fan-out relay: a streamer's browser publishes a game's state feed on one WebSocket, viewers' browsers subscribe read-only. It keeps the latest key frame plus the deltas after it for late viewers, counts viewers, and binds a channel to its streamer's secret (as a sha256). It reads only a frame's `k` and size, never its content. Plan and contracts: [research/watch/PLAN.md](../PLAN.md) (§3.1 channel, §3.2 this protocol, §3.3 the feed).

MIT, like the rest of the kit files. The Node server uses the repo's vendored ws (`research/multiplayer/p2p/vendor/ws`, MIT).

## Layout

| File | What |
|---|---|
| `core.mjs` | The rules as pure logic: `Channel` (hello/claim, replace, size limits, rate bucket, key-frame cache, caps, slow viewers, read-only, grace, `end`, counts, expiry), plus `route`, `originOk`, `parseOrigins`, `httpAnswer`. Sockets, clock, one wake-up timer and storage are injected |
| `node.mjs` | `attachWatchRelay(server, opts)` for any `http.Server`, and a CLI |
| `cloudflare/` | `worker.mjs` (route + origin check + `/health`), `channel.mjs` (the Durable Object logic, testable under Node), `wrangler.toml` |
| `tests/` | `core.test.mjs` (units), `channel-do.test.mjs` (the DO class on a fake runtime), `node.test.mjs` (`--data`, CLI, mount), `e2e.test.mjs` (real WebSockets; takes a base URL) |

## Protocol in short

All under `/watch/v1/`; `<id>` is `^[a-z0-9]{12}$` (else 400).

- `GET /watch/v1/<id>` gives `{v, id, live, viewers, meta, since}` (`since` is epoch ms), `no-store`, CORS `*`. `GET /watch/v1/health` gives `{ok: true}`.
- WebSocket `?role=pub` is the streamer (first frame `hello` within 5 s: `{k:'hello', v:1, key, meta}`), a bare WebSocket is a viewer. `Origin`, when present, must be in `WATCH_ORIGINS` (403 before the upgrade).
- Streamer frames: `key` (64 KB), `d` (16 KB), `meta` (2 KB), `bye`, `ping`. At most 40 a second, burst 80, else close 4008.
- Viewers get `state`, then the cached key frame and deltas, then every `key`/`d`/`meta`, `viewers` (at most once a second) and `end` (`bye` at once, `lost` after a 10 s grace).
- Close codes: 1008 viewer sent anything but `ping`; 4003 wrong key; 4008 rate; 4009 replaced; 4010 slow viewer (more than 1 MiB buffered); 4029 channel full (200 viewers).
- Two codes the plan does not name: **4000** for a first frame that is not a valid `hello` (or no hello within 5 s, or a binary streamer frame) and **1009** for a frame over its limit. Both come after `{k:'error', code}`.
- `end` is not followed by a `state` frame; the viewer socket stays open, and `state` (live) plus a key frame follow when the streamer returns.

## Run it locally

```bash
source ~/.nvm/nvm.sh && nvm use                     # Node 24.19.0
node research/watch/relay/node.mjs --port 5831      # ws://127.0.0.1:5831/watch/v1/<id>
node research/watch/relay/node.mjs --port 5831 --data /tmp/watch.json --origins http://localhost:5830 --max-viewers 200
```

Or mount it on a server you already have (research/worlds/serve.mjs does):

```js
import { attachWatchRelay } from '../watch/relay/node.mjs';
const relay = attachWatchRelay(server, { path: '/watch/v1/', origins: [...], maxViewers: 200, log });
// first thing in the request handler:  if (relay.handleHttp(req, res)) return;
```

`options`: `path` (default `/watch/v1/`), `origins` (array or comma string; default env `WATCH_ORIGINS`; unset = allow all), `maxViewers` (default env `WATCH_MAX_VIEWERS`, else 200), `data` (JSON file; keys are stored as sha256 only, cached frames never), `log`, and test knobs `graceMs`, `helloMs`, `now`, `limits`. Returns `{handleHttp(req, res) → boolean, close(), stats()}`.

## Tests

```bash
node --test research/watch/relay/tests/*.test.mjs                  # units + Node e2e (44 tests)

# the same e2e suite against the Worker, locally:
cd research/watch/relay/cloudflare
npx wrangler@4.140.0 dev --port 5832 --ip 127.0.0.1 --persist-to <scratch dir> \
  --var WATCH_ORIGINS:https://play.example --var WATCH_MAX_VIEWERS:3 --var WATCH_GRACE_MS:600 --var WATCH_HELLO_MS:800
# in another shell, from the repo top:
WATCH_URL=http://127.0.0.1:5832 node --test --test-force-exit research/watch/relay/tests/e2e.test.mjs
```

Known limits of the Worker run (wrangler 4.140.0, workerd local): a close the server starts on a socket the client has not sent a frame on yet is not delivered (the `state {full:true}` and `error` frames are). The cap test therefore asserts only `full: true` there, and the hello-timeout test sends one `ping` first. The slow-viewer test is skipped there: Durable Object sockets expose no buffered size, so that rule is a no-op on Cloudflare (the 200-viewer cap and 16 KB deltas keep it small in practice). It has not been checked whether production behaves the same as local on the first point.

## Deploy to Cloudflare

**Deployed 2026-10-10** at the creator's OK ("sure deploy the worker"): `https://gf-watch.anthony-6be.workers.dev`, so Studio's `WATCH_RELAY_URL` is `wss://gf-watch.anthony-6be.workers.dev/watch/v1/` (record: `../evidence/relay-deploy-2026-10-10.json`). Check it with `node research/watch/relay/tests/prod-smoke.mjs` (13 checks; pass another base as the first argument).

Wrangler 4.140.0's `deploy` uploads the script and then fails on a follow-up lookup ("This Worker does not exist on your account", code 10007) before it turns on the workers.dev address. The upload stands; the address was turned on once through the API (`POST /accounts/<id>/workers/scripts/gf-watch/subdomain {"enabled": true}`) and stays on through later deploys. The Workers free plan works (SQLite-backed Durable Object).

1. A Cloudflare account, then either `npx wrangler@4.140.0 login`, or an API token with **Workers Scripts: Edit** exported as `CLOUDFLARE_API_TOKEN` (plus `CLOUDFLARE_ACCOUNT_ID` when the account has more than one).
2. `cd research/watch/relay/cloudflare`
3. Check `wrangler.toml`: `WATCH_ORIGINS` is the play origin `https://games-fun-play.vercel.app` (comma-separate more, e.g. `http://localhost:5830` for local pages; unset allows every origin), `WATCH_MAX_VIEWERS` is `"200"`. The migration `v1` creates the class `Channel` with `new_sqlite_classes`.
4. `npx wrangler@4.140.0 deploy`. The URL is `https://gf-watch.<subdomain>.workers.dev`; the relay is `wss://gf-watch.<subdomain>.workers.dev/watch/v1/`.
5. Check: `curl https://gf-watch.<subdomain>.workers.dev/watch/v1/health` gives `{"ok":true}`. Then set the play host's `WATCH_RELAY_URL` to that `wss://…/watch/v1/` (track S).
6. A custom route (for example `watch.games.fun/watch/v1/*`) can be added under `routes` in `wrangler.toml`; the path must stay `/watch/v1/`.

`WATCH_MAX_PER_IP` (default 8; `0` turns it off): at most that many viewers of one channel from one client address (`CF-Connecting-IP` on Cloudflare, the socket's address on Node), so one network can't fill the audience; the one turned away gets `{k:'state', full: true, why: 'network'}` and close 4029.

Do not set `WATCH_GRACE_MS` or `WATCH_HELLO_MS` in production (test knobs; defaults are 10 s and 5 s).

## Cost notes (Cloudflare Durable Objects, check current pricing before relying on these)

- Requests: each WebSocket connection counts as one request; **incoming** WebSocket messages are billed at 20 to 1 (20 messages = 1 request); **outgoing** messages are free. A stream is mostly outgoing fan-out, and the streamer's ~10 frames a second is the incoming part (about 0.5 request a second).
- Duration: billed while the object is awake. With the Hibernation API it sleeps between messages, but a live stream sends every 100 ms, so a live channel is effectively always awake (128 MB). Viewers add no duration beyond that.
- `ping` is answered by `setWebSocketAutoResponse` without waking the object.
- Storage: one small key-value record per channel plus the id; writes happen on go-live, end, meta changes and key binding, not per frame. Channels are deleted 30 days after last use (alarm).
- Worker requests: one per HTTP GET and per WebSocket connect.

## Notes on behaviour

- After a Durable Object wakes, its cache is empty: a new viewer gets `state` and then waits for the streamer's next key frame (the kit sends one every 2 s). Viewer counts are recounted from `ctx.getWebSockets('viewer')`.
- Keys and meta are in memory on Node (and in `--data` when given). Cached frames are never persisted.
- The relay never forwards anything from a viewer.
