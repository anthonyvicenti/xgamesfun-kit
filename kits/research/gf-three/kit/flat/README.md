# kit/flat: a 2D game in the one system

A flat game is `"engine": "flat"` in the spec with a `plane` (`top` or `side`). Inside the kit it is the party kit with four parts swapped: the same boot, session, net, bots, fair play, HUD, menu, sounds, slots, mechanics and flows. Every tool that asks "which engine" gets `party`; the difference is `gf/three/kit.js` → `modules.flat`.

| File | What it is |
|---|---|
| `index.js` | The part's manifest, read by the tools only: planes, styles, looks, worlds, the mechanics run on each plane (`runs`), the note a build reads, and what a check should read in a flat game (`reads`, `worldReport`, `bodyReport`). Pure |
| `slots.js` | The declarations: styles, looks, what a flat spec may name (`refuse`), `config/look.json` and `config/world.json`, the picture slots. Pure |
| `tilemap.js` | The tile map (`gf-tilemap-1`): read and check it, merge solids into boxes, the jump reach model, a generated map. Pure |
| `judge.js` | The picture judge (`gf-flat-1`): body sheets, props, tiles. Pure |
| `look.js` | The orthographic camera, the two styles' filtering, the pixel snap, a picture slot as a card (the seam every mechanic's `assets.model()` goes through) |
| `world.js` | The world from the tile map: one mesh a tile kind, Rapier boxes for solids, one-way ledges, spawns, marks |
| `character.js` | A body that is a picture sheet (1 row, or 3 rows by heading) |
| `controller.js` | The kit's own controller with a flat camera rig; side-on: the ledge rule, the portrait rule, bots that hop |
| `module.js` | Makes `create` carry this folder into a flat game and no other |
| `ART-STANDARD.md` | What a picture must be, for whoever makes them |

Tools: `tools/flat-art.mjs` (bakes the stand-ins in both styles), `tools/flat-judge.mjs` (judges a picture or a game's pictures), `tools/flat-reach.mjs` (drives the real player over every jump a side-on level needs). Examples: `flat-examples/` (`make.mjs` creates them). Tests: `tests/f8-flat.test.mjs`.

## Seams outside this folder

Each is written for any part that brings the same thing, not for flat by name:

| File | The seam |
|---|---|
| `core/boot.js` | `kit.js modules.flat` picks the four modules; a look may bring its camera (`createCamera`, `resizeCamera`) and frame the preview (`frameSubject`); a rig that places itself (`rig.place`) keeps the menu and a viewer's camera; a body may say where its name goes (`plateOffset`); a sound's distance under an orthographic camera |
| `net/players.js` | the controller is the game's kind's when its parts bring one; "can this player see that one" runs along an orthographic view's own direction |
| `controller/capsule.mjs` | `setQuery(groups)`: what a body's ground probe sees, settable per step (the ledge rule) |
| `mechanics/pickup/index.js` | `touchHeight` (a param): how far above or below a spot a body may be and still take it |
| `ui/ui.js` | the control hint of the `side` camera |

## Not done

- Mechanics on a plane beyond `pickup` (both planes) and `board` (top): `create` refuses the rest as "not run on the flat plane yet".
- Slopes, moving platforms, death pits (the map's bottom is closed), parallax backdrops, animated tiles, autotiling beyond `cap`.
- Bots do not plan a route up the ledges: they hop when blocked and now and then.
- The settings menu still offers mouse sensitivity, which does nothing here.
- Checks that assume 3D (13 side-on, 17, 19, 24, and 8, 9, 34): the part declares what they should read (`index.js` → `reads`, `worldReport`, `bodyReport`); the checks are track V's.
