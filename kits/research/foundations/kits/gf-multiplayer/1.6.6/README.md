# gf-multiplayer 1.6.6 (frozen): a locked room, and a round alone

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.6.5/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`.

## What changed from 1.6.5

**The creator, 2026-10-11:** "Just found another issue. We cant lock it so others cant join. We also cant play solo". Asked which they meant, they chose "Lock room, stream solo" (`research/watch/evidence/lock-room-and-solo-stream-request-2026-10-11.json`).

- *Why it happened:* since 1.4.0 a friends round needs two players (the creator, 2026-10-08: no bots with friends), and Go live needs a room. So a player alone could neither start a round nor stream, and a viewer's Join always put them in the streamer's room. Play alone left the friends page for the game's own page, which has no Go live.
- *What 1.6.6 does:* the host's waiting room has **Lock room** (`#mp-lock`; **Unlock room** to undo). While locked:
  - the room refuses anyone new. The host engine (`p2p/host-engine.js`, `lock(on)`) answers a new hello with `refused`, code `locked`, and the joiner sees "This room is locked: the host is playing on their own." Players already in the room, and a seat coming back with its token, are not affected. Every lobby frame carries `locked`, and `gf.room.lock(on)` / `gf.room.locked` are the host-join kit's calls (`vendor/gf.js`; `p2p/host-worker.js` passes `{k:'lock'}`);
  - a round starts with whoever is in, the host alone included ("Start on my own"): the page sends the room `minPlayers: 1`, and unlocking puts the minimum back;
  - a stream's meta says so (`room.locked`), and a viewer's Join reads **Room locked** and can't be pressed; Start a room and Play solo stay beside it.
  A world is one shared room per game and has no lock.
- *Held by* verify check 34 (`research/gf-three/tools/lib/friends-watch-check.mjs`): "a streamer locks their room and plays alone, live: viewers can't join, an invite is refused". The streamer locks, starts a round alone and is live in it, a viewer watches that round with Join locked, and a friend opening the invite link is refused with the locked message while the room stays at one player. On 2026-10-11 it failed a Bladder Brawl built on 1.6.5 ("lock not taken … 2 in the room") and passed the same game on 1.6.6 (22 of 22 steps). And `research/multiplayer/p2p/tests/host-engine.test.mjs` "lock": a newcomer refused, a returning seat kept, a newcomer seated after unlocking.

Files: `party.js`, `party.css`, `vendor/gf.js`, `p2p/host-engine.js`, `p2p/host-worker.js` (and `kit.json`); everything else is 1.6.5 byte for byte.

This is the default (`KIT_VERSION` 1.6.6). A published game gets the lock once it is upgraded and republished.
