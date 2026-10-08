# gf-multiplayer 1.3.0 (frozen)

Friends in one game, who see each other. One player hosts in their own browser, the others join with a code or a link. No game server. This directory is immutable. What the kit is and how a game uses it: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/`, `../1.2.2/` and `../1.2.3/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## Changes from 1.2.3 (2026-10-07): signaling that works off this machine

The creator asked (2026-10-07) for games made in Studio to be playable "live across friends outside of local host". Until now the only signaling was a Node WebSocket on this machine, and Studio's play origin runs on Vercel, which can't hold a WebSocket.

Only `vendor/gf.js` changed (and `kit.json`, which lists the hashes). `party.js`, `net.js`, `room.js` and everything under `p2p/` are byte-identical to 1.2.3, so no game code changes.

- **A second signaling transport, HTTP.** `POST /signal/v1` with `{op: host | join | signal | poll | leave}` and a long-poll, plus `GET /signal/v1/ice`. Same messages, room codes, payload checks and limits as the WebSocket. The protocol lives in one module, `creator-studio/lib/signal-core.mjs`, which both servers run: Studio's play origin (on Postgres, migration `0012_signal.sql`) and the local Node server (`research/multiplayer/p2p/signal-server.mjs`, in memory, beside its WebSocket). The host and joiner code in `gf.js` is unchanged: both transports sit behind one handle (`send`, `close`).
- **Which transport a page uses:**
  1. `?signal=` wins, then `GF_P2P_CONFIG` / `p2p.json` `"signal"`. Values: `http`, `ws`, `auto`, or a URL. A URL ending in `/signal/v1` is HTTP; any other URL is a WebSocket URL, as in 1.2.x.
  2. Otherwise a page on `localhost` / `127.0.0.1` keeps the WebSocket at `/signal`, exactly as before (no extra request).
  3. Any other page asks `GET /signal/v1/ice`. If it answers, the page uses HTTP signaling and takes that answer's ICE servers (public STUN, plus TURN when the platform sets one). If it doesn't answer within 4 s, the page falls back to the WebSocket.
  4. If neither answers, the lobby shows **Connection failed: Could not reach the signaling server**, with "Tried HTTP signaling (/signal/v1) and the WebSocket (/signal); neither answered", within about 12 s at most. It never hangs.
- **A failed long-poll is retried, backing off.** A network error, or a server that is busy (503) or rate-limiting, is tried again. Only six failures in a row (about 20 s) end signaling, and then players already in the room keep playing. A session the server no longer knows ends it at once.
- **The WebSocket gets an 8 s open timeout** (it used to wait for the browser).
- **Invite links always keep `?signal=`.** A room lives on one transport, so friends must use the host's.
- **A joiner still mid-handshake leaves signaling when its tab closes.** Over HTTP nothing else would tell the server. The host already did this.
- `window.__p2p.snapshot()` adds `signal` (`'http'` or `'ws'`) and `signalWhy` (`forced`, `configured`, `localhost`, `found` or `fallback`).

## Limits (new in this version)

- **A new or returning joiner waits for the host's next look:** at most about 0.35 s while the host's long-poll is open. The host keeps one request open to `/signal/v1` for as long as its room is open, renewed every 8 s.
- **No TURN relay is configured.** Roughly 10–20% of real network pairs (symmetric NAT, strict corporate or carrier networks) can't connect directly. They see "Could not connect to the host … the game may need a TURN relay". The hook exists: Studio's `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL` reach every page through `/signal/v1/ice`.
- The host's page needs a secure context (HTTPS, or a `localhost` name), as before: its room engine uses `crypto.randomUUID`.
- Games on 1.2.3 and older know only the WebSocket. They play with friends on this machine but not through the play origin until they are re-adopted.
- Not yet measured: real networks, phones, Safari.

## Verified (2026-10-07)

- Kit tests: `node --test research/multiplayer/party/tests/*.test.mjs research/multiplayer/p2p/tests/*.test.mjs` passes 48 of 48. That includes `signal-transport.test.mjs`, five cases in real Chrome on the arena fixture:
  - `?signal=http` on 127.0.0.1: a round where each draws the other, and the host leaving closes its room;
  - a host whose long-polls hit three 503s keeps its room, and a friend still joins;
  - 127.0.0.1 with nothing set: the WebSocket, with no HTTP request at all;
  - a non-loopback host (`play.test`): HTTP when `/signal/v1/ice` answers, and the WebSocket when it doesn't;
  - neither transport answering: the error panel in under a second.
- The gate on the arena fixture with this kit vendored:
  - `--signal http`: 26 of 26;
  - the WebSocket default: 24 of 24;
  - `--signal ws`: 26 of 26.
- Through Studio's play origin (local `next dev`, PGlite): two Chrome contexts host and join through `POST /signal/v1`, open a data channel, and play a round where each draws the other, 13 of 13 (`research/multiplayer/p2p/studio-e2e.mjs`).
- Records are in `research/multiplayer/p2p/evidence/http-signaling-2026-10-07/`.
- These are automated checks, not creator acceptance.
