# gf-multiplayer 1.6.3 (frozen): a viewer's own room, or the game alone

Friends in one game, who see each other. One player hosts in their own browser and the others join. There is no game server. This directory is immutable.

What the kit is: the 1.2.0 README (`../1.2.0/README.md`), the changes in `../1.2.1/` to `../1.6.2/README.md`, and `research/multiplayer/party/LIVE_HANDBOOK.md`. Watch then play is 1.6.0's to 1.6.2's (`research/watch/PLAN.md`).

## What changed from 1.6.2

The creator, 2026-10-10: "Also add an option to  start own lobby or play solo" (`research/watch/evidence/own-room-or-solo-request-2026-10-10.json`). Until now a viewer's bar had one button: Join, the streamer's game.

- **Start a room** (`#mp-watch-own`, a live game's stream): the game's friends page without the stream or its invite, where the viewer picks a name and hosts a room of their own. The page keeps the parameters an invite link keeps (`inviteParams`).
- **Play solo** (`#mp-watch-solo`, every stream): the game's own page (`live.entry` / `world.entry`, `index.html` by default), at its home menu. A world's own page is its practice copy, which saves nothing.
- **A world has no Start a room.** A world is one shared world per link, so its viewers are offered Join and Play solo.
- **After a stream** the first button says where it goes: Play with friends (the friends page) or, for a world, Enter the world (its card). It said Play. Play solo stays beside it.
- **The bar's layout.** One row where it fits. Where it doesn't (a frame the size of a post, a phone), the buttons take a row of their own under the line, and the bar sits at the left, clear of the game's full-screen button at the bottom right.

Everything else is 1.6.2 byte for byte: `diff -r ../1.6.2/source source` lists `kit.json`, `party.css` and `party.js`.

`KIT_VERSION` and `DEV_VERSION` in `research/multiplayer/party/manifest.mjs` are `1.6.3`. Checked by gf-three verify check 34 (numbered 32 in the 1.6.0–1.6.2 READMEs), which gained three steps for a live game (the buttons inside a 480×480 frame, a room of one's own hosted, the game alone on its own page) and two for a world (Play solo offered and no Start a room; the world's own page). They fail 1.6.2.
