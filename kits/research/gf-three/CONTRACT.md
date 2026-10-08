# gf-three contract (v0, wave 1)

This is the agreement between the five wave-1 tracks and every game agent. If an API here is wrong, tell the parent; don't fork it. The parent changes this file, and the version line, when a track asks.

## 1. A game project (what `gf-three create` writes)

```
game/
├── index.html              import map + <script type="module" src="main.js">; nothing else
├── main.js                 generated: import { boot } from './gf/three/core/boot.js'; import rules from './rules.js'; boot({ rules })
├── rules.js                THE GAME AGENT'S FILE: the game's own rules (§3)
├── config/
│   ├── game.json           title, players, round, controls, mechanics[] with params, rules params (from the spec)
│   ├── look.json           look preset id + every look value (slots)
│   ├── world.json          world template id + layout (props, spawns, zones)
│   └── characters.json     roster: body slot per role, tint palette, nameplate style
├── assets/models/          *.glb (model slots): bodies, props, items
├── assets/textures/        *.png|*.jpg|*.ktx2 (image/texture slots)
├── assets/clips/           shared animation GLB(s) for gf-humanoid-1
├── assets.json             gf-assets/1 manifest, generated from the kit's slot declarations (§2.2); validates with research/asset-manifest/validate.mjs
├── multiplayer.json        { "mode": "live", ... } per research/multiplayer/STANDARD.md
├── gf/three/               the kit (vendored, never edited)
├── gf/mp/                  gf-multiplayer 1.3.0 (vendored by research/multiplayer/party/adopt.mjs, never edited)
├── gf/gf-assets.js         gf-assets 1.3.0 runtime
├── audio/                  gf-audio 1.5.0
└── vendor/                 three (build/three.module.js + examples/jsm), rapier, postprocessing, n8ao
```

The import map is fixed:

| Import | Path |
|---|---|
| `three` | `./vendor/three/build/three.module.js` |
| `three/addons/` | `./vendor/three/examples/jsm/` |
| `@dimforge/rapier3d-compat` | `./vendor/rapier/rapier.mjs` |
| `postprocessing` | `./vendor/postprocessing/postprocessing.module.js` |
| `n8ao` | `./vendor/n8ao/N8AO.js` |
| `three/examples/jsm/` | `./vendor/three/examples/jsm/` (N8AO imports it) |

URL parameters:

| Parameter | Effect |
|---|---|
| `?seed=N` | Fixes every gameplay random |
| `?bots=N` | Fills seats |
| `?quality=low\|high` | Picks the quality tier |
| `?gf-show=<subject>` | Studio preview subject (§6) |
| `?gf-autoplay=1`, `?gf-ui=0` | QA only |
| `?gf-demo=<mechanic>.<moment>` | QA only: a mechanic's staged moment. `waves.hit`: no waves; one enemy at a time stands still 6 m in front of the local player, a new one after each kill (verify check 16) |

## 2. Assets: everything visible is a slot

### 2.1 Runtime (`kit/assets/assets.js`; K1)

```js
import { assets } from './gf/three/assets/assets.js';
const tree   = await assets.model('prop.crate');        // a clone of the slot's GLB, every mesh tagged userData.gfSlot = 'prop.crate'
const body   = await assets.model('character.body.player');
const tex    = await assets.texture('world.ground.albedo');   // THREE.Texture, colour space from the slot's constraints
const v      = assets.value('look.sun.intensity');        // a value slot, read through gf-assets (overrides applied)
const cfg    = assets.config('game');                     // the whole config/game.json (overrides applied)
assets.tag(object3d, slotId);                             // for kit primitives whose material is a slot (R1)
const report = assets.coverage(scene);                    // { meshes, tagged, untagged: [{name, path}] }; verify needs untagged = []
```

- Reads go through `gf/gf-assets.js`, so Studio overrides, packed mode and `__GF_ASSETS_SEEN` all work unchanged.
- GLBs are cached per slot and cloned per use (`SkeletonUtils.clone` for skinned meshes). Loaders: GLTFLoader with Meshopt, Draco and KTX2.
- A slot whose file is missing is an error, never a silent fallback. The exception is a slot declared `optional` with an explicit kit default.

### 2.2 Declarations (`slots.mjs`; K1 owns the tool, every module declares)

Every module exports `slots` (an array of slot templates). `create` and `node tools/slots.mjs <game> --write` assemble `assets.json` from them. The sources are:
- the kit's own modules (look, world, character, mechanics);
- `config/*.json`;
- the files under `assets/`.

A template is an ordinary gf-assets/1 slot: `id`, `label`, `group`, `type`, `source`, plus `constraints`, `generate`, `license`, `tier` and `facet`. It may carry `{param}` placeholders that the module fills from its params.

| Slot ids | What they are |
|---|---|
| `character.body.<role>` | Body model (`constraints: { rigged: true, rig: "gf-humanoid-1", animations: [...] }`) |
| `character.tint.<role>` | Tint |
| `character.hat.<role>` | Hat (optional) |
| `prop.<name>` | A prop |
| `world.<template>.<part>` | A part of a world template |
| `look.<group>.<name>` | Look values |
| `mechanic.<id>.<name>` | Mechanic values and models (e.g. `mechanic.projectile.model`, `mechanic.projectile.color`) |
| `rules.<name>` | Values the game agent exposes from `config/game.json` → `rules` |
| `ui.<name>` | UI text and colours |

Main tier: at most about 40 slots. The rest are `"tier": "advanced"`.

### 2.3 Coverage (R3)

`assets.coverage(scene)` walks visible meshes (`visible`, in the frustum or not, `material.visible`). Exempt only when `userData.gfExempt` holds a reason, for things like debug helpers or a ray-cast proxy. `verify` fails when `untagged` isn't empty.

## 3. The game agent's surface: `rules.js`

```js
export default {
  // Called once on every copy, after the world, players and mechanics exist. Register shared state, UI, listeners.
  setup(ctx) {},
  // Every copy, when the round starts (the same moment for everyone).
  roundStart(ctx) {},
  // Every frame on every copy. dt is in seconds. Keep host-only logic under `if (ctx.host)`.
  update(ctx, dt) {},
  // A gameplay event from another copy: ctx.net.send(name, data, to) on their side.
  event(ctx, name, data, from) {},
  // Host only: is the round over? Return null, or { winners: [playerId], reason }.
  check(ctx) { return null; },
  // Every copy, at round end. Return the rows for the results screen.
  results(ctx) { return ctx.players.list().map(p => ({ id: p.id, name: p.name, value: p.score })); },
  // Optional: steer a bot each frame (host owns bots).
  bot(ctx, player, dt) {},
};
```

**`ctx`** (K1 builds it; the modules hang off it):

| Field | What it is |
|---|---|
| `THREE`, `scene`, `camera`, `renderer` | the three.js objects |
| `physics` | the Rapier world (kit steps it; fixed 60 Hz) |
| `config` | `config/game.json` (`ctx.config.rules` is the game agent's own params) |
| `rng()` | seeded 0–1 random. Gameplay never calls `Math.random` |
| `time` | `{ now, round, left }` (seconds) |
| `host` | true on the copy that owns shared state (also true when playing alone) |
| `me` | the local player |
| `players` | `list()`, `get(id)`, `others()`. Each player has `{ id, name, color, isBot, local, score, alive, data: {}, character, body, pose }` |
| `world` | `{ template, spawn(i), zone(name), props: Map, raycast(from, dir, max) }` |
| `mechanics` | `get(id)` → the instance `create` configured from the spec |
| `shared` | host-owned state replicated to every copy: `register(key, initial)` → proxy; the host writes, others read; sent through `net.world` |
| `net` | `send(name, data, to='all'\|'host'\|playerId)`, `on(name, fn)`. Events are edges, never per frame |
| `ui` | `meter(id, opts)`, `score(rows)`, `banner(text, secs)`, `toast(text)`, `prompt(text)`, `timer(on)` |
| `audio` | `play(soundId, opts)`, the gf-audio sounds in `assets.json` |
| `assets` | §2.1 |
| `round` | `{ phase: 'lobby'\|'countdown'\|'playing'\|'results', end(reason) }` (host) |

The kit owns:
- the frame loop (`net.loop`);
- the lobby, countdown, results and replay;
- spawning players and bots;
- local movement through the controller, and sending and drawing poses;
- drawing friends as characters with nameplates;
- the camera;
- quality tiers.

`rules.js` owns only what makes this game this game.

## 4. Module interfaces

### 4.1 Mechanics (K2): `kit/mechanics/<id>/index.js`

```js
export const id = 'projectile';
export const params = { /* JSON Schema of the spec's params for this mechanic */ };
export const slots = [ /* slot templates (§2.2) */ ];
export function create(ctx, params) {
  return {
    update(dt) {},              // every copy
    hostState() {},             // optional: small snapshot for ctx.shared (host)
    applyState(s) {},           // optional: non-host copies
    event(name, data, from) {}, // optional: listens to its own events, prefixed `<id>:`
    dispose() {},
    // plus the mechanic's own methods, documented in its README.md (e.g. fire(player, dir), coverage(), spawnWave(n))
  };
}
```

Wave-1 ids (PLAN §2.1):

| Id | Mechanic |
|---|---|
| `projectile` | Discrete and continuous streams, arcs, hits, splash |
| `paint` | Surface coverage per player or team; territory score |
| `pickup` | Consumables that refill or modify a player's meters; respawn |
| `health` | Health, knockback, ragdoll and get-up, respawn |
| `carry` | Grab, carry and throw props or players |
| `waves` | Host-owned enemies, spawners, a target to defend |
| `station` | Interact with a prop: an in-world screen or panel UI, timed tasks, quotas |
| `race` | Checkpoints, laps, a finish order |
| `tag` | Roles that pass between players on contact, hide and seek |
| `teams` | Team assignment, team score |

Each mechanic must:
- carry a 2-player fixture in `kit/mechanics/<id>/fixture/`;
- handle the netcode traps in PLAN §2.6;
- keep every message within the gf-multiplayer limits: 4 KB a message, at most 60 messages per player per second, `net.world` at most 3.5 KB.

### 4.2 Look (L): `kit/look/look.js`

```js
export function createRenderer(canvas, preset, quality)  // WebGLRenderer + tone mapping + shadows from the preset
export function applyLook(ctx, preset)                   // lights, sky/fog, environment, post stack (EffectComposer: N8AO, bloom, outline, grade)
export function material(kind, opts)                     // house materials: 'character' | 'prop' | 'ground' | 'water' | 'liquid' | 'glow' | 'decal' (lit like the ground)
export const presets = { 'jelly-pastel': {...}, 'toon-lowpoly': {...}, 'soft-stylised': {...} }   // also shipped as JSON
```

- A preset is plain JSON. Every number and colour in it becomes a `look.*` slot.
- Materials accept a tint. Lighting and post settings are tuned per quality tier.

### 4.3 World (L): `kit/world/world.js`

```js
export async function loadWorld(ctx, worldConfig)   // template + layout → meshes (all slots), colliders, spawns, zones
export const templates = ['backyard', 'office', 'plaza', 'arena', 'store']
export async function templateLayout(id, { size, seed })   // the template's recipe expanded at a size class
```

- **Templates are recipes; layouts are generated (worlds track, 2026-10-07).** `kit/world/generate.js` (pure; create, upgrade, the lint and the browser share it) turns a template's recipe, a size class (`small` | `medium` | `large`, the spec's `world.size`) and a seed (the title's hash) into the concrete `config/world.json`. An **indoor** recipe (office, store: a supermarket) is a closed building: bands of side rooms round the main room, doorways joining them (a spanning tree from the main room, loops from medium up), doors to the street for the rooms marked `entry`, walls on a 2 m module with windows, a ceiling, lamps, each room dressed by its zone recipe from the template's furniture groups, and a street with city blocks outside. An **outdoor** recipe keeps its hand-dressed small layout, grows it for larger classes and closes its edge (`edge`, `gates`).
- **Indoor layouts** add `kind: "indoor"`, `sizeClass`, `rooms: [{id, kind, label, rect: [x0,z0,x1,z1], main}]`, `doors: [{at, rooms: [a, b], normal, width}]`, `entries: [{name, room, at, normal (outward), width}]` and `ceiling: {height, color, color2, glow, band, pattern}`. The ceiling is a kit primitive drawn as a **cutaway**: it faces down (seen from inside, culled from above) and fades as the camera rises to it, with what hangs from it; a band (slot `world.<t>.ceiling.band`) closes the walls up to it. Slots `world.<t>.ceiling.color`, `.band`, `.pattern`.
- **ctx.world** adds `kind`, `sizeClass`, `rooms`, `doors`, `entries`, `roomAt(x, z)`, `via(from, to)` (the next point toward another room, through its doors; the waves mechanic and the bots walk through it) and `entry(rng)` (a point just inside a real door or gate: the waves mechanic brings enemies in there). Spawns in a world with rooms face the main room's centre zone.
- **Colliders** may be `{shape: 'compound', parts: [...]}` (a doorway: two posts and a lintel, so the opening is real); `library/props.json` doorways carry `door: {width, height}`.

- A layout is JSON: `{ template, props: [{ prop, at:[x,y,z], rot, scale }], spawns: [[x,y,z]...], zones: { name: { shape, at, size } } }`. `rot` is in **degrees** (yaw, or `[x,y,z]`).
- Colliders come from simple shapes declared per prop in `library/props.json`.
- **Set dressing (assets track, 2026-10-06):** `ground.pattern` (slot `world.<t>.ground.pattern`, a baked CC0 texture: paving, carpet tiles, lawn stripes, checker) keeps every floor readable; `library/props.json` entries carry `real` (the real-world size the lint compares against a 1.7 m character) and `hosts` (what may stand on or inside them, e.g. a planter hosts a tree). Pickups draw the game's own prop (`mechanics[pickup].params.prop`) and their ground ring is `params.marker` (`auto` | `ring` | `none`). The lint `tools/dressing.mjs <game | template>` (rules and thresholds in `tools/lib/dressing.mjs`) is verify check 11; `research/studio-v2/prompts/look-rubric.md` is the agent's eight-question look review (the worker writes it into each build and revise job as `LOOK.md`). The contact sheet adds a `top` plan shot, and no shot starts inside or behind a prop.

### 4.4 Character (C): `kit/character/character.js` (as built, 2026-10-06; the standard is in `kit/character/RIG.md`)

```js
export async function spawnCharacter(ctx, { player, bodySlot, clipsSlot, tint, local, plate, onState })
// → { object3d, height, update(dt), play(clip, {loop, fade}), stop(), locomotion(speed, grounded), setAim(dir),
//     socket(name) /* head|hand_r|hand_l|back */, knock(velocity /* world m/s */), ragdoll(on), setTint(c),
//     nameplate(text, color), plate, state, anim, meta, clips, bones, dispose(),
//     express(name, seconds) /* a gfFaces face, e.g. 'hurt' */, face, faces, hipHeight }
// onState(state, info): 'getup' fires with {position, yaw}, and the controller teleports its capsule there.
export function slotsFor(cfg)   // slot templates: character.body.<role>, character.tint.<role>, character.hat.<role>
```

- Clips: 31 in `library/clips/gf-humanoid-1.glb`, bound by bone name. The names are in RIG.md.
- Any GLB that passes `tools/rig-check.mjs` works as a body.
- Faces (RIG.md §3, `gfFaces`): the beans carry a hurt face. The projectile mechanic shows it on a body while a stream is on it or a shot hits it, and a knocked-down body shows it by itself.
- Collision groups (RIG.md §6): WORLD 0x1, PLAYERS 0x2, PROPS 0x4, RAGDOLL 0x8. A player's capsule belongs to PLAYERS only.
- `ctx.physics` may be a bare Rapier world or `{RAPIER, world}`; K1 provides `{RAPIER, world}`.

### 4.5 Controller (K1): `kit/controller/controller.js`

```js
createController(ctx, { character, camera: 'third'|'first'|'top', speed, jump })
// → { update(dt), pose() /* for net */, teleport(p), aimAt(point | null), enabled }
```

- Keyboard and mouse, plus touch, through `kit/core/input.js`.
- `ctx.me.aim` is a normalised direction. In third and first person it points from the aim origin (feet + 1.2 m) at the point under the crosshair, and `ctx.me.aimDist` is how far that point is (§6d). Bots and the top camera have no `aimDist`.
- `ctx.me.actions` is `{ primary, secondary, interact, jump }` with edge flags.

### 4.6 Net (K1): `kit/net/`

- Wraps `gf/mp/net.js`.
- **Poses:** sent by the kit. The fields are `{x, y, z, yaw, anim, aim, ad, lk, extra}` (`ad`: the aim distance, §6d; `lk`: the player's loadout key, §6e, absent without a loadout). A mechanic may add small numbers to `extra`, for example a stream's on/off and pressure.
- **Shared state:** `ctx.shared` is batched into one `net.world` message. Numbers that must not blend are sent as strings or read from `latest` (net.js header).
- **Alone:** `net.active` is false, and the same code runs for one player plus bots.

## 5. The observation and the verify gate

- **`window.__game`** (K1): `{ kit: 'gf-three', version, phase, players: [{id, name, score, alive, x, z}], snapshot(), seed, quality }`. `snapshot()` holds no functions and is stable for the same seed.
- **`node research/gf-three/tools/verify.mjs <game> [--out evidence/verify-N] [--quick]`** prints a single verdict and writes `verdict.json`. The checks are:

| # | Check |
|---|---|
| 1 | `assets.json` valid (`research/asset-manifest/validate.mjs`) and `multiplayer.json` valid |
| 2 | Kit copies unedited (`gf/three`, `gf/mp`, `audio`) |
| 3 | Boots to play with no console errors (real input through `research/foundations/qa/browser.mjs`) |
| 4 | Slot coverage 100% (§2.3) |
| 5 | Two-player live gate (`research/multiplayer/party/gate-live.mjs` or its gf-three adapter): each screen shows the other player where they really are, and the shared state matches. Plus the loadout leg (§6e, `tools/lib/loadout-check.mjs`): two players in different test loadouts each draw the other in their own body colour (read from the body's material) and shot colour (a stream's from its material; a discrete shot's as each copy resolves it for the shooter); a change mid-round and a reloaded copy follow |
| 6 | A round runs to results and replays, alone with bots and with two players |
| 7 | Audio gate v4 (`research/audio/qa-gate-v4.mjs`) |
| 8 | Swap proof: one body and one prop slot replaced by override, and the new model is visible |
| 9 | Contact sheet on the real GPU (four cameras, `--quick` skips) and perf numbers |
| 10 | Fair play (§6c): a scripted human vs 3 bots for 42 s, twice at once (stands and fights; wanders and sprays), real keys, no `?gf-calm`. Fails when the player is out of control longer than `fair.downSeconds` + 1 s at once while alive, is in control under 85% of the time alive, or a protected player is knocked. Bot score balance is reported, not failed. `--check 10` runs it alone |
| 11 | Set dressing (§4.3, `tools/lib/dressing.mjs`, no browser, runs in `--quick`): nothing overlapping, floating, sunk or out of scale, no litter or stand-in pickups, open floor, readable ground and player colours, clear spawns. Errors fail; warnings are notes |
| 12 | Something happens: the solo round ends with some score of 2 or more, or on one of check 10's two pages a score climbs at least 2 above where it started and some score stays moved for at least 1.5 s (a lone point the rules wipe again does not count; a game scored 1 per round won would need its own rule). A game in which nobody ever scores is dead even when every other check passes (T1 run 5) |
| 13 | Controls work (§6d, `tools/lib/controls-check.mjs`): every control `config/game.json` → `controls` lists (the HUD's control line) does something the player sees on their own screen, on a solo page with no bots, real keys and mouse. `jump` rises ≥ 0.25 m. `interact`: walk to the nearest interactable a mechanic exposes (a pickup spot, a free station, a free carry item), inside its press distance but outside its touch distance, press E (hold or tap for a station) → it changes. `primary` and `secondary`, held 1.4 s: the shot shows at the crosshair (in ≥ 2 frames, ≥ 12% of the pixels within 2.5% of the screen height of the middle changed beyond the released frames' noise; or one frame ≥ 24% and a sum ≥ 0.48 for a quick throw; or one frame ≥ 12% when the kit's observation says the shot landed there, in view); with the kit's observation also the player's own body does not cover the crosshair and the shot lands within 10% of the screen height of it, not behind the body; and paint changes when the game paints. `--check 13` runs it alone (about 15 s) |
| 14 | Looks honoured (`tools/lib/looks-check.mjs`, no browser, runs in `--quick`; `--check 14` alone): a character or prop the spec asks for `from: "generate"` or `"reference"` is not still a stand-in (byte-identical to a library bean, a kit stand-in file or the placeholder `create` put in its slot, or a GLB whose extras say bean), and two roles the spec describes differently never share one body file (they would differ only by tint). The one excuse is a failed generation the Studio worker recorded in `game/generated.json` (`gf-three-generated/1`: each item's state, reason and attempts) whose `delivery` line, added to the delivery summary, names the role or prop and the file; an item still `running` is pending (the build agent's own verify while the worker generates). Creator, Hang Up On Them: the zombies were the player's bean tinted purple and the token a stand-in crate, and nothing said so |
| 15 | The loop is alive (`tools/lib/alive-check.mjs`, runs in `--quick`): every page verify opens records the observation 4 times a second, and each mechanic in `config/game.json` must show its own sign of life in the kit's state on them. `waves`: enemies come and close ≥ 2 m on their goal (the target zone, or the nearest player) or reach it; with a target, its zone exists in `config/world.json`, the HUD shows its meter, and on an undefended page (no bots, the player standing still) its health falls ≥ 20%; a player who aims at an enemy with real mouse moves and fires hurts or kills it (else a kill on a page with bots). `pickup`: one taken. `projectile`: shots fly and a hit lands. `carry`, `station`, `paint`, `race`, `tag`, `teams`: an item held, progress, cells painted, a gate passed, someone it, two teams. The goal (a `config/game.json` prop whose role is the thing to defend) fills ≥ 0.3% of the player's first look at round start (`window.__game.sight(ids)`: a depth-tested render from the player's camera) and stands at the waves target. A value the game never reports is unmeasured, which fails. `--check 15` runs it alone (about 30 s) |
| 16 | Hits read (§6f, `tools/lib/hits-check.mjs`, runs in `--quick`): on a solo page with no bots and the kit's staged moment `?gf-demo=waves.hit` (one enemy at a time standing 6 m in front of the player, the game's own wave-1 hit points, weapon, rules and config), the player aims with the mouse and shoots with real clicks until 3 kills. The median hits per kill (the kit's kill log) must be at least 2, unless the locked `spec.json` (its sha in `gf-three.json`) sets waves `oneHitKills`; the flag in `config/game.json` alone fails. A hit that does not kill must change at least 3% of the enemy's pixels on the player's own screen (beyond the noise between frames before it) and show the kit's health bar over it (shown, at least 24x4 px, within 60 px of its head, at the hit points left, its fill drawn in its colour). A game without waves or projectile passes (nothing to hit). `--check 16` runs it alone (about 15 s) |
| 17 | The world is complete (`tools/lib/world-check.mjs`, no browser, runs in `--quick`; `tools/world.mjs <game>` alone): the play area matches the spec's size class (small 350–950 m², medium 1000–1800, large 1900–3200; `kit/world/generate.js` `SIZE_CLASSES`); medium has at least 3 rooms or areas and large 5; an indoor world has a ceiling and walls all round, open only at doorways a player can walk through; no outside prop of an indoor world shows over its walls (a street or skyline, not trees on a plain); from the middle, at least 12 of 16 directions meet a building (indoor) or a building, tree or hill (outdoor) past the edge; an outdoor edge goes all round, broken only at gates; when enemies come in (waves), the world names entries at real doors or gates (medium 2, large 3), and every room is reached through the doors. Filled ground and the three scales per room are notes. `--check 17` (or `--check 11,17`) runs it alone |

**Pass rule.** verify passes when checks 1–8 and 10–17 pass (9, the contact sheet, counts only when it ran): `REQUIRED` in `tools/lib/verdict.mjs` lists them, so adding a check means adding it there and a row to the table above (`tests/r-regressions.test.mjs` compares the two, and holds the rule to its cases in `regressions/verdict-rule`).

## 6. Studio preview subjects

Kit games answer `?gf-show=<subject>` for:
- `character.<role>`: turntable;
- `prop.<name>`;
- `world`: wide shot;
- `look`;
- each mechanic's own subjects.

That way, Studio's Assets tab can show any slot in place with no per-game work.

## 6b. As built by K1 (2026-10-06): additions to §3 and §4

`research/gf-three/kit/core/README.md` is the source of truth for the implemented `ctx`. It adds the following to §3 and §4.

**Physics.** `ctx.physics` is the bare Rapier `World`, and `ctx.RAPIER` is the module. §4.4 accepts either. Modules read Rapier through `physicsOf(ctx)` (`kit/core/util.js`), which accepts both shapes.

**`ctx` additions:**
- `ctx.time.dt`;
- `ctx.onFrame` (an array of `fn(dt)`);
- `ctx.input`;
- `ctx.look` (`render`, `resize`, `update`);
- `ctx.players.owned()`, `humans()`, `bots()`.

**Player additions:**
- `owned`: this copy simulates the player;
- `act(word, secs)`;
- `knock(velocity, secs)` and `teleport(pos, yaw)`, callable from any copy;
- `poseExtra`, which also travels for bots;
- `p.bot` (bot steering);
- `p.data`, which keeps its identity across rounds.

**Hooks:**
- mechanics get `setup(ctx)` (runs after players exist) and `reset()`;
- `rules.js` may add `digest()` and `observe()` for QA.

**Slots:**
- families `round.*`, `players.*`, `controller.*`, `prop.<name>.size` and `.count`;
- a `rank` hint caps the main tier at 40;
- kit sound ids use dashes.

**Player colours have one owner:** `character.tint.<role>`. L's `look.palette.players` only seeds its defaults and is an advanced slot (parent decision, 2026-10-06).

**`create`:**
- `--standin-mechanics` and `--standins` force the stand-ins;
- `--force` never touches `rules.js`; only `--new-rules` replaces it.

## 6c. Fair play (kit-owned, on by default; 2026-10-06)

The creator on the first T1 build: "people kept knocking me down and I couldnt get up. The knock down timer was also pretty long." So fairness is the kit's job in every game, with no agent effort. The rules are in `kit/core/fair-logic.js`, the runtime is `kit/core/fair.js` (`ctx.fair`), and the bots' helper is `kit/bots/bots.js` (`ctx.bots`).

| | The kit guarantees |
|---|---|
| F1 | A knock takes a player out of control for `downSeconds` (1.2 s) at most, from the hit to walking again. That is a short ragdoll tumble, then the get-up clip played faster. |
| F2 | A player who is down (knocked, ragdolled, getting up, or out) takes no damage and no knocks, and hits on them count for nothing. |
| F3 | Once control returns, the player has `protectSeconds` (1.5 s) of protection: no knocks, no damage, no counted hits. Their body shimmers in the `fair.protect-color` slot (an emissive glow on its own materials, no new art). |
| F4 | After a respawn, protection counts from when the player can move. The respawn point is the spawn farthest from the other live players, unless the game set `health.respawnZone`. |
| F5 | For the first `startGrace` (2 s) of a round, no hit counts and bots hold fire. |
| F6 | Continuous attacks (stream ticks, contact damage) push but never knock over. Knock-overs need a discrete hit: a shot, a splash, or a tag with knock. |
| F7 | Bots pick targets that can be hit and spread across them. They react and aim like people (`botSkill`, 0.35 by default, is friendly). At most `botsPerTarget` (1) bots may hurt one human at a time. Every bot holds fire in the grace and while aiming at a player who can't be hit, whatever `rules.bot` asks. |
| F8 | `projectile.onHit`, `health.onDamage` and `waves.onPlayerHit` fire only for hits that counted. A hit fair play refused goes to `projectile.onBlocked` (`why`: `out`, `down`, `protected`, `grace`, `busy`). Rules that score in those callbacks can't farm a helpless player. |

**Config.** `config/game.json` → `fair`: `{ on, downSeconds, protectSeconds, startGrace, botSkill, botsPerTarget, respawnFar, protectColor }`.
- `create` writes it with the defaults (`FAIR_DEFAULTS`). A game without the block gets the same defaults.
- Every value is a `fair.*` slot. Three are main tier: `fair.down-seconds` ("Seconds down after a knock"), `fair.protect-seconds` and `fair.bot-skill`.
- `health.getUpSeconds` and `projectile.knockSeconds` apply only with fair play off.
- Turn any of it off only when the creator asks.

**API** (host decides; the other copies show).

| Call | What it does |
|---|---|
| `ctx.fair.canHit(p, {from})` | Does a hit on `p` count now? |
| `ctx.fair.blocked(p, {from})` | Why a hit doesn't count, or null |
| `ctx.fair.state(p)` | `'control'`, `'down'`, `'protected'` or `'out'` |
| `isDown(p)`, `isProtected(p)`, `grace`, `protect(p, secs)` | Read or set the same state |
| `params`, `split` | The values; `split` is `{total, ragdoll, getup}` for one knock |
| `p.knock(v, secs, {out, force})` | The host refuses (→ false) a knock on a player who is down or protected; `force` skips that for a deliberate knock. A knock lasts `downSeconds` in all; `{out: true}` keeps the player down until revived |
| `p.push(v)` | A shove that never knocks over |
| `health.damage(t, n, {push: true})` | A continuous hit: it damages and shoves |
| `ctx.bots.target(bot, {range, prefer})` | A player that can be hit, spread across bots; `prefer` is `'spread'`, `'nearest'` or `'leader'`. Null in the grace |
| `ctx.bots.attack(bot, t, {stop, action, hold})` | Seek, aim with human error, and hold `action` once ready |
| `ctx.bots.aim(bot, t)`, `ctx.bots.ready(bot)` | The parts of `attack` |

**Observation.** `window.__game.snapshot().players[i]` adds `control`, `down`, `protected` and `pl` (protection seconds left; host). `snapshot().fair` holds the values, `grace`, and stats (knocks, refused knocks, blocked hits by reason).

## 6d. Controls (kit-owned, on by default; 2026-10-07)

The creator on T1 run 5 ("Bladder Brawl", verify 12/12): "I cant seem to fire pee or drink". The stream fired along the camera's forward vector, which looks down at the player, so it landed about 2 m ahead, behind the player's own body, under a crosshair the body covered. "E: grab a drink" was on the HUD and E did nothing, because pickups were only taken by touch. So a player's own controls are the kit's job in every game, with no agent effort.

| | The kit guarantees |
|---|---|
| C1 | **Aim at the crosshair.** In third and first person the aim is the point under the crosshair: a ray from the camera through the middle of the screen into the world (ground, props, other players), starting at the player's depth so nothing between the camera and the player counts (`kit/core/aim.js` `crosshairPoint`). `p.aim` is the unit direction to it from the aim origin (feet + 1.2 m) and `p.aimDist` its distance; the pose carries both (`aim`, `ad`), so every copy knows the point (`aimTarget(p)`). Projectile shots and streams and carry's throw leave the player on the arc that lands there (`solveLaunch`: the low arc in reach, else the farthest landing toward it). Bots, the top camera and an explicit direction (`fire(p, dir)`, `throw(p, dir)`) keep the old way. While primary or secondary is held in a game with an aimed mechanic, the body turns to the aim. |
| C2 | **A readable crosshair.** Third-person framing puts the middle of the screen at head height 0.85 m right of the player (`RIG_DEFAULTS.third`: `height` 1.7, `shoulder` 0.85; was 1.45 and 0.45), so the body never covers it. The reticle (a ring and a dot, `kit/ui/ui.js`) shows in third and first person when a mechanic is aimed (`ctx.aimed`), in the `ui.crosshair` colour (`config/game.json` → `ui.crosshair`, default white) with a dark outline, readable on bright and dark scenes. It is UI, not world art. |
| C3 | **Interact means interact.** The pickup mechanic takes a spot on touch and on a press of `action` (E) within `reach` (`collect`: `touch` \| `press` \| `both`, default `both`; `reach` 2 m). Near something to press, the HUD prompts `E: <controls.interact>` in the game's own words (`ctx.ui.prompt(text, owner)`: pickup, carry and station each keep their own line). Every collect shows on every copy (the item flies into the collector, with the collect sound), whatever the rules then do with it. Carry prompts near a free item; station already took interact. |
| C4 | **verify check 13** (§5) plays every listed control from the player's own view. The HUD's control line never lists a control the check finds dead. |

**Observation.** `window.__game.controls()` → `{camera, crosshair, aimed, controls, prompt, viewport, aim: {dir, dist, point, hit, onSelf, screen}, landing: {point, screen, hiddenBySelf, fromAim}, interactables: [{kind, id, x, y, z, reach, touch, action, d}], mechanics: [{id, aimed, interacts, stats}], me}`. Mechanics expose `aimed`, `interacts` and `interactables()`; projectile adds `landing(p)`.

**Bringing a delivered game onto the current kit:** `node research/gf-three/tools/upgrade.mjs <game> [--out <dir>] [--world]`. It refreshes the vendored copies check 2 compares (`gf/three`, `gf/mp`, `gf/gf-assets.js`, `audio/`, `vendor/`, plus `index.html` and `main.js`), keeps `rules.js`, `multiplayer.json`, `assets/` and every `config/*.json` value the game set, adds the config blocks and keys the current kit expects with its defaults (e.g. `fair`, `ui.crosshair`, new mechanic params; never `controls` or `rules`, never into arrays), regenerates `assets.json` (the sound list is kept), records the upgrade in `gf-three.json` → `upgrades`, and prints what changed. `--out` upgrades a copy (without `evidence/`); `--world` also re-lays `config/world.json` and `config/props.json` from the current template (the old files are kept in `evidence/upgrade-N/`), only for a game whose world is still the stock template. Waves are held to the hits rule create applies (a basic enemy takes 2–4 hits from the game's weapon unless `oneHitKills`). A second run changes nothing. `--plan` changes nothing and says whether the game is behind the kit (its `gf/three` or `gf/mp` copy is not what create would write today) and whether `--world` is for it (check 17 fails and the world is a stock template layout from the template's git history); the Studio worker asks it before a change job's agent starts, then upgrades. This is how kit fixes reach delivered games.

## 6e. Player looks and loadouts (kit-owned, on by default; wallet phase 1, 2026-10-07)

The creator: "Eventually users will need to have the option to sign in with a wallet. We will have to be able to check their wallet for certain NFTs as in game items. For example, an NFT that represents a character color or pee stream color. This needs to be visibile from multiplayer as well." Decided ([decisions](../foundations/evidence/wallet-loadout-decisions-2026-10-07.json), [scope](../foundations/evidence/wallet-loadout-scope-2026-10-07.json)): the wallet is optional (guests play); items are per game; loadouts are client-trusted for now, with room for a signed, session-bound pass; the kit makes no game-specific cosmetic rules (colour clashes and the like are settled per game later). Phase 1 is this plumbing: no chain, no wallet.

| | The kit guarantees |
|---|---|
| P1 | **Player-look slots.** A slot with `scope: "player"` in `assets.json` resolves per player: that player's loadout value or file when they have one, else the game's. Every game has these by default: `character.body.player`, `character.hat.player` (always declared; optional, and view-only when the game gives players no hat), `character.tint.player`, and each aimed mechanic's colour (`mechanic.projectile.color`). `config/game.json` → `loadout: { slots: [ids], off: [ids] }` adds slots a loadout may set, or keeps some the game's for everyone (`tools/slots.mjs` writes the scope; text and JSON slots never). |
| P2 | **Every copy draws every player in that player's loadout.** The body tint shows on the body. The ring, the nameplate, paint, team colours and every other gameplay colour keep the seat or team colour, so the game reads and scores the same. The player's own shots, stream, drops and splashes use their colour. A new body is put on once the player is on their feet, keeping the ring, held items and the controller. A hat goes on the head socket. Bots wear the game's defaults. |
| P3 | **Loadouts travel with the player.** They go on join and on change, and late or reloaded copies get everyone's. Changing a loadout mid-round updates every screen within about a second. |
| P4 | **A loadout is never fatal.** Unknown slots, wrong types, values outside a slot's range, files other players couldn't load, files over a slot's byte budget, and bodies that are not gf-humanoid-1 rigs are dropped for that player, and the game's own is used instead. |

**Format** (a look in Studio's shape, `creator-studio/docs/web3.md` "Variations"; `kit/assets/loadout.js`):

```json
{ "values": { "character.tint.player": "#23c64a", "mechanic.projectile.color": "#2457ff" },
  "files":  { "character.body.player": "https://…/body.glb", "character.hat.player": { "url": "https://…/hat.glb", "revision": "…" } },
  "pass": null }
```

The checks for each part:
- **Values.**
  - `color` takes `#rrggbb` (`#rgb` is accepted). A `colors` slot (one entry per seat) takes one colour, the player's own.
  - `number` and `integer` must be within the slot's `min`–`max`; `enum` takes one of its options; `boolean` takes true or false.
  - Text and JSON are never part of a look.
- **Files.**
  - An https URL, or a path inside the game with the slot type's extension. A Studio revision carries its `url`; the page resolves revisions before handing the loadout over.
  - `data:` and `blob:` URLs are dropped, because other players couldn't load them.
  - The file must be within the slot's `maxBytes`. A body must pass the runtime rig check (skinned, with the gf-humanoid-1 required bones).
- **Size.** At most 3000 bytes of JSON (one net message).
- **`pass`** is reserved for wallet phase 2+. The play page will put a server-signed pass there (wallet, items, expiry, and a session key made in the player's browser). On join the player would sign the room's challenge with that key, so a stale pass is useless, and the host could refuse items the wallet doesn't own. Phase 1 carries it (opaque, ≤ 2 KB) and never reads it.
- **Phase 1 trusts the client.** Any player can claim any look, and every copy fetches the file URLs a player names. Phase 2 should check the pass, and limit file URLs to the item store's origin.

**Input** (`kit/net/looks.js`). The page hands this player's loadout to the game, before boot or at any time:
- `window.__GF_LOADOUT = loadout` from a same-origin host. A later assignment applies too.
- `postMessage({ type: 'gf:loadout', loadout }, '*')` into the game's frame, from any ancestor window, for the future play page with wallet sign-in. The game says `{ type: 'gf:loadout-ready', v: 1 }` to its ancestors once it listens, and answers each message with `{ type: 'gf:loadout-applied', key, dropped }`.
- `?gf-loadout=<base64url JSON>`, QA only.
- `?gf-show=` subjects wear the page's loadout too, so Studio can render an item's look in the game.

**Net.**
- The pose carries `lk`, the loadout's key (8 hex digits).
- A copy holding a different key for a player asks that player's owner (kit message `lq`, at most every 1.5 s per player). The owner answers with `lo` (the loadout, one message).
- A change is sent to everyone at once, at most twice a second.

**API.**

| Call | What it does |
|---|---|
| `ctx.assets.value(id, fallback, { player: p })` | That player's value: their loadout's for a player-look slot, else the game's. A `colors` slot gives the player's own entry (by `p.seat`) |
| `ctx.assets.model(id, { player: p })`, `texture(id, { player })`, `url(id, { player })` | That player's own file, else the slot's (a failed own file falls back, and is dropped for them) |
| `ctx.assets.own(id, p)` | The player's own value only (undefined without one) |
| `ctx.assets.setLoadout(id, l)`, `loadout(id)`, `onLoadout(fn)`, `playerLooks()` | The per-player store the kit fills (`setLoadout` → `{key, loadout, dropped, changed}`) |
| `ctx.looks.apply(l)`, `ctx.looks.key` | This player's loadout, as the page's message sets it |
| `p.character.setLookTint(c)`, `setHat(obj)`, `look` | The body's own colour (wins over `setTint`, the gameplay tint), the hat, and what it wears now |

Rules that draw something in a player's colour or model read it per player through these calls. They never copy the game's value for everyone.

**Observation.** `window.__game.looks()` → `{ me, local: {key, from}, slots, players: [{id, bot, key, values, files, dropped, drawn: {body, hat, tint, bodyTint, material, mix, visible}, shots: {color, stream, drops}}] }`. `drawn.material` is a tint material's colour read back from the scene, and `shots.stream` is the liquid arc's material tint.

**verify.** Check 5 runs the loadout leg after the gate. `node research/gf-three/tools/loadouts.mjs <game> [--third] [--a <json>] [--b <json>|none]` runs it alone. `--third` adds a player who joins during round 1 and must see the host's look in round 2.

## 6f. Hits read (kit-owned, on by default; 2026-10-07)

The creator on the live Studio game "Hang Up On Them" (verify 13/13, play-tester passed): "The zombies are instant killed to I couldn't even tell what was happened. There was no healthbar or anything." The spec had pistol damage 1 against 2 HP zombies; a hit that did not kill showed nothing, so the repair round answered "my pistol never visibly kills anything" by raising the damage to 2. So every hit is the kit's job ([evidence](../foundations/evidence/studio-v2-live-hang-up-on-them-creator-feedback-2026-10-07.json)).

| | The kit guarantees |
|---|---|
| H1 | **A hit that does not kill reads, on every copy** (from the shared hit points alone): the enemy flashes (`mechanic.waves.flash-color` over its own materials, like fair play's shimmer: no new art), flinches (the gf-humanoid-1 `hit` clip and the hurt face; a stand-in squashes), is pushed back `hitKnock` m and staggers `stagger` s (a stream's ticks push a little and never stop it). A health bar shows over it from then on, drawn by the kit's UI like a nameplate (`ui.bars`, never a model: R2), in `mechanic.waves.bar-color`; what the hit took stays light for a moment before it drains. |
| H2 | **A death reads**: the body falls (the `knockdown` clip; a stand-in tips over), then sinks into the floor over `deathSeconds` (1.6 s), with the `soundKill` sound (`enemy-down`, an `explosion-small` preset `create` adds to games with waves); the killer's own screen shows `+killPoints` over it (`ui.pop`). |
| H3 | **Hits to kill**: a basic enemy takes 2–4 hits from the game's weapon. The defaults are hp 2 against projectile damage 1; `create` (`tools/lib/spec-config.mjs` `enemyToughness`) raises a spec's waves `hp` to three hits' worth when its damage (a stream's `streamDamage`) would kill in one. One-hit kills only when the spec asks: waves `oneHitKills: true` in the locked spec. verify check 16 holds a game to H1 and H3. |
| H4 | **Aim at enemies**: the crosshair ray stops on an enemy where this copy draws it (`ctx.aimBodies`, kit/core/aim.js), so a shot lands on the one under the crosshair. |
| H5 | **Hits on players read** too: on the edge where a player's hit points drop, every copy plays their `hit` clip and hurt face, and the hurt player's own Health meter pulses. |

**Observation.** `window.__game.controls().mechanics[waves].stats` → `{demo, oneHitKills, hitsSeen, deathsSeen, dying, lastHit: {id, hp, max, t, flash, clip}, kills: [{id, hits, shots, max, from, t}] (host), enemies: [{id, x, z, hp, max, bar, body, head, feet (screen px)}]}`. The bars are `#gf-ui .gf-hbar[data-key="waves:<id>"]` (`data-frac` is the fill).

## 7. Change log

| Date | Change |
|---|---|
| 2026-10-06 | v0, written by the parent for wave 1 |
| 2026-10-07 | §4.2 decal material; §6b physicsOf(ctx) |
| 2026-10-06 | §4.3 layout rot in degrees |
| 2026-10-06 | §1 import map + QA params, §6b K1 as-built additions, player-colour owner |
| 2026-10-06 | §4.4 updated to track C's built API (update, stop, setAim, onState getup, knock takes velocity, clipsSlot, collision groups) |
| 2026-10-06 | §6c fair play (kit-owned, on by default), `ctx.fair`, `ctx.bots`, `p.push`; §5 verify check 10 (fair-play track, after the creator's Bladder Wars feedback) |
| 2026-10-06 | §4.3 set dressing (ground pattern, `real`/`hosts`, pickup `marker`, `top` shot); §5 verify check 11 and the look rubric (assets track, same feedback) |
| 2026-10-06 | §5 verify check 12, something happens (T1 run 5 shipped a game where no score ever moved); verify's pass now lists its required checks |
| 2026-10-07 | §6e player looks and loadouts (loadouts track, wallet phase 1): `scope: "player"` slots resolved per player (`ctx.assets.value/model/texture/url` with `{player}`), the loadout format and input (`__GF_LOADOUT`, `gf:loadout` postMessage, `?gf-loadout`), loadouts over the net (pose `lk`, `lo`/`lq`), per-shooter projectile colours, `__game.looks()`; §4.6 pose `lk`; §5 check 5's loadout leg; `tools/loadouts.mjs` |
| 2026-10-07 | §6d controls (controls track, after the creator's "I cant seem to fire pee or drink"): aim at the crosshair (`kit/core/aim.js`, pose `ad`, `controller.aimAt`), third-person framing and a readable reticle (`ui.crosshair`), pickup press-to-collect and prompts, `__game.controls()`; §5 verify check 13 and the pass rule; `tools/upgrade.mjs` |
| 2026-10-07 | §5 verify check 14, looks honoured, and `game/generated.json` (generation track, after the creator's Hang Up On Them feedback); `tools/meshy-prop.mjs` makes a spec prop `from: "generate"` (or `"reference"`), placed in its `prop.*` slot by the worker |
| 2026-10-07 | §4.3 worlds (worlds track, after the creator's "Hang Up On Them": "The open world is small ... make the worlds actually complete and make sense"): templates are recipes expanded by `kit/world/generate.js` at the spec's size class; indoor layouts (rooms, doors, entries, a cutaway ceiling), `ctx.world.via/entry/roomAt`, compound colliders; §5 verify check 17 and the pass rule |
| 2026-10-07 | §4.4 faces (`express`, `face`, `faces`, RIG.md §3 `gfFaces`; the beans' hurt face) and `hipHeight`; projectile `muzzle` ('chest' default, 'hips' for a pee stream, which create and upgrade pick for a pee game), after the creator asked for the pee stream to start lower and for a hurt face when hit |
| 2026-10-07 | §5 verify check 15, the loop is alive (pipeline track C, after the creator rejected "Hang Up On Them": round 1 passed 13/13 with no token on screen and zombies standing at the doors); `window.__game.sight(ids)` (`kit/core/sight.js`, QA only); verify's `timing` and the two-player gate run beside the solo session |
| 2026-10-07 | §6f hits read (combat-feel track, after the creator's "The zombies are instant killed … There was no healthbar"): waves hit flash, flinch, push back, stagger, health bars (`ui.bars`), a death that falls and sinks, `+N` (`ui.pop`), `oneHitKills`, `?gf-demo=waves.hit`, `ctx.aimBodies`; player hits play `hit` and the hurt face; create keeps damage below hp; §5 verify check 16 and the pass rule |
