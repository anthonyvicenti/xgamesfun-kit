# gf-multiplayer 1.6.4 (frozen): no late-candidate errors, and online signaling for a locally served game

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.6.3/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## What changed from 1.6.3

**1. The ten failed signaling calls on a join are gone.** On the play host (Bone Vigil, kit 1.6.3, seen twice on 2026-10-11) a host's page logged about ten `400 POST /signal/v1` with `no such peer`, op `signal`, in the half second after a friend joined. The room formed and played, so nobody noticed what they were.

- *Cause:* a joiner leaves signaling the moment its data channel opens (`sig.send({t:'leave'})` in `setupChannel`, which deletes its peer row). The host was still sending the ICE candidates it gathers late (reflexive and relay candidates arrive after the channel is already up) and, over HTTP, its candidate POSTs wait in one queue and go out one at a time. Every candidate that went out after the leave named a peer that no longer existed. A direct connection on this machine produces no late candidates, which is why the gate never saw it.
- *Reproduced locally* (`research/multiplayer/p2p/late-candidates.mjs`, real Chrome, the local signaling server over HTTP, a host and three joiners, ten late candidates injected on the host once its connection is `connected`): 27 `400 no such peer` on kit 1.6.3 against the host as it was; 0 on 1.6.4 against the same host. Record: `research/multiplayer/p2p/evidence/late-candidates-2026-10-11/` (a: 1.6.3 against the play host as it was, 27 failed; b: 1.6.3 against the fixed host, 0 failed but 27 wasted posts; c: 1.6.4 against the host as it was, 0 failed and none wasted; d: both fixed).
- *Fix:* the host sends no candidate to a joiner whose channel is open, and a candidate already queued is dropped when its turn comes if the channel opened or the joiner is gone (`skip` on the queued message). The play host also stopped treating this as an error (`{ok:true, gone:true}`, `creator-studio/lib/signal-core.mjs`), so games still on 1.6.3 or older log nothing once Studio is deployed with that change.
- *What a published game must do to get the kit's side:* be on 1.6.4 (`gf-three upgrade`, or `adopt.mjs` for a legacy game), then be republished. The server's side needs only the Studio deploy.

**2. Online signaling for a game served from somewhere else.** `p2p.json` gains `"online"`: the address of a play host's signaling (`https://games-fun-play.vercel.app/signal/v1`). It does nothing by itself. A page that sets `signal` to `online` (`GF_P2P_CONFIG`, or `?signal=online` in the link, which invite links keep) uses it from any page, a locally served game included, with that host's ICE servers (its relay credentials) and its plain refusals shown to the player ("too many rooms from this network: try again in 12 minutes", "online play for games run from other sites is off for now"). Only an `https` address ending in `/signal/v1` is accepted (or `http` on this machine, for a signaling server you run yourself: `research/multiplayer/p2p/serve-signal.mjs`). When the play host cannot be reached at all (no network), the page falls back to the WebSocket on this machine, so two tabs still work; when it answers with a refusal, the refusal is what the player reads. Without the setting a page on `localhost` keeps the WebSocket on this machine, exactly as before, so the gate and verify are unchanged.

Everything else is 1.6.3 byte for byte: `diff -r ../1.6.3/source source` lists `kit.json`, `p2p.json` and `vendor/gf.js`.

`DEV_VERSION` in `research/multiplayer/party/manifest.mjs` is `1.6.4`; `KIT_VERSION` (what `create` vendors) stays `1.6.3` until it is promoted.
