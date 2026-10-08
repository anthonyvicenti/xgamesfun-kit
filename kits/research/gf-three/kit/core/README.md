# gf-three kit core (track K1): how a game, a mechanic or a module plugs in

The contract is `research/gf-three/CONTRACT.md`. This page says what K1 actually implements today (kit 0.1.0-dev) and how
a mechanic (K2), the look and world (L) and the character (C) are picked up. Anything marked **CONTRACT-REQUEST** is
something K1 needed beyond the contract; it is listed in K1's report for the parent.

## The project and the boot

`node research/gf-three/tools/create.mjs <spec.json> <out>` writes a game (CONTRACT §1). Its `main.js` is
`boot({ rules })` from `gf/three/core/boot.js`, which runs, in order:

1. `assets.init()`: `assets.json` and every JSON a value slot points into (config/game, look, world, characters, props).
2. Seed (`?seed=` → `net.seed` → random), quality tier (`?quality=low|high`, else from the device).
3. `look.createRenderer(canvas, lookConfig, tier)` and `look.applyLook(ctx, lookConfig)`.
4. Rapier (`ctx.physics` is the `RAPIER.World`, `ctx.RAPIER` the module; the kit steps it at a fixed 60 Hz).
5. `world.loadWorld(ctx, config/world.json)` → `ctx.world`.
6. `?gf-show=<subject>` stops here and shows the subject (`core/show.js`).
7. Audio (gf-audio 1.5.0), input, UI.
8. Mechanics: `create(ctx, params)` for each `config/game.json → mechanics[]` whose module the kit carries.
9. Players and bots (`net/session.js`), then each mechanic's optional `setup(ctx)` (players, `ctx.me` and
   `ctx.shared` exist from here; **CONTRACT-REQUEST**), then `rules.setup(ctx)`.
10. Alone: the lobby card (Play). Live: `net.ready()`; the party page starts everyone together.
11. The frame, through `net.loop` (never pauses, also in a background tab).

**Which modules run.** `create` vendors the kit into `gf/three/` and writes `gf/three/kit.js` (`{version, modules:
{look, world, character, mechanics: [ids]}, files: {path: sha256}}`). A module counts when its file exists in
`research/gf-three/kit/` **and** imports in Node with the contract's exports (look: `createRenderer`, `applyLook`;
world: `loadWorld`; character: `spawnCharacter`; a mechanic: `id`, `create`). Otherwise the stand-in in
`core/standins/` runs, and its art is still slots. `create --standins` forces the stand-ins. Re-run `create` on a game
to pick up a module that landed later: it refreshes the kit and vendor copies and keeps `rules.js`, `config/*.json`,
`assets/` and `multiplayer.json` (`--force` replaces those too; only `--new-rules` ever replaces `rules.js`).

## The frame (every copy)

```
input.update()                     the local player's move/look/actions (edges valid for this frame)
session.tick(dt)                   round clock; a non-host copy applies the host's world; friends placed from poses
bots (host only)                   brain.begin() → rules.bot(ctx, p, dt) or wander → brain.finish(dt)
physics ×N at 60 Hz                controller.fixedStep() → world.step() → controller.postStep()
controllers.update(dt, alpha)      characters placed and animated, camera, ctx.me.aim
fair.update(dt)                    who is down or protected (the host referees; every copy shows the shimmer)
mechanic.update(dt)                each mechanic instance
rules.update(ctx, dt)              every phase: check ctx.round.phase yourself
ctx.onFrame[i](dt)
session.send()                     my pose (15/s) and, on the host, the world (12/s): kit state + ctx.shared
world.update(dt), look.update, ui.update, look.render(camera)
```

## `ctx` as implemented

| Field | What |
|---|---|
| `THREE`, `scene`, `camera`, `renderer` | three.js 0.186 objects |
| `physics`, `RAPIER` | the Rapier `World` (bare, as CONTRACT §3 says) and the Rapier module |
| `config` | `config/game.json` (Studio patches applied). `config.rules.params` are the game's own numbers |
| `assets` | `kit/assets/assets.js` (below) |
| `rng()` | seeded, with `.int(n)`, `.range(a,b)`, `.pick(list)`, `.fork(label)`; never `Math.random` in gameplay |
| `seed`, `quality` | the seed; the tier object `{name: 'low'\|'high', pixelRatio, shadows, …}` |
| `time` | `{now, dt, round, left}` seconds; `dt` is this frame's step; `round` is the host's round clock on every copy |
| `host` | this copy owns shared state (true alone) |
| `me` | the local player |
| `players` | `list()`, `get(id)`, `others()`, `owned()`, `humans()`, `bots()` (sorted by seat) |
| `world` | the world module's object: `spawn(i)`, `zone(name)`, `props`, `raycast(from, dir, max)`, `bounds` (Box3), `root` |
| `mechanics` | `get(id)` → the instance, or `{id, as, params, standin: true}` while K2's module is missing; `list()` |
| `shared` | `register(key, initialObject)` → proxy; `smooth(key)`; `snapshot()` (below) |
| `net` | `send(name, data, to='all'\|'host'\|playerId)`, `on(name, fn)`, `active`, `you`, `blend` |
| `ui` | `meter(id, {label, value, max, color})` → `{set, remove}`, `score(rows\|null)`, `banner(text, secs)`, `toast(text)`, `prompt(text\|null, owner?)` (each owner keeps its own line; the latest shows), `timer(on)`, `crosshair(on)` |
| `aimed` | true when a mechanic aims (projectile; carry with a throw action): the kit shows the crosshair in third and first person and turns the shooter to the aim while firing (`core/aim.js`, CONTRACT §6d) |
| `audio` | `play(soundId, {at: {x,y,z}, gainDb, pitch, optional})`, `has(id)`, `stop(id)`, `raw` (the gf-audio object) |
| `round` | `{phase, number, winners, reason, end(reason, winners)}`; `end` acts on the host only |
| `input` | the local input (`move`, `look`, `actions`, `sprint`, `touch`) |
| `look` | the look handle (`render`, `resize`, `fitShadows`, …) |
| `onFrame` | an array: push `fn(dt)` to run every frame after the rules |
| `fair` | fair play (`core/fair.js`, CONTRACT §6c): `canHit(p, {from})`, `blocked`, `state(p)`, `isDown`, `isProtected`, `grace`, `protect(p, secs)`, `params`, `split`; on by default from `config/game.json → fair` |
| `bots` | the bots' fair target helper (`bots/bots.js`): `target(bot, {range, prefer})`, `attack(bot, t, {stop, action, hold})`, `aim`, `ready` |
| `looks` | this player's loadout (`net/looks.js`, CONTRACT §6e): `key`, `apply(loadout)`; everyone's reach every copy over the net and each player is drawn in theirs. Read a player's look with `assets.value(id, fallback, {player: p})` |

**A player** `{ id, name, color, seat, isBot, local, owned, score, alive, data: {}, character, controller, body, pose,
position (feet, Vector3), yaw, anim, aim [x,y,z], aimDist, actions, input, bot, poseExtra }`.
- `aim` is a unit direction from the aim origin (feet + 1.2 m); `aimDist` (local player in third or first person, and
  friends through the pose's `ad`) is how far along it the point under the crosshair is: `aimTarget(p)` in
  `core/aim.js`. Bots and the top camera have no `aimDist` (null). `p.controller.aimAt(point | null)` holds the aim on
  a world point (QA, fixtures).
- `owned` (**CONTRACT-REQUEST**): this copy simulates it (the local player; every bot on the host). Read
  `p.actions.<primary|secondary|interact|jump>.{pressed,down,released}` on owned players only.
- `p.act(word, seconds)` (**CONTRACT-REQUEST**): hold an anim word (`'aim'`, `'emote_cheer'`, …); the pose carries
  it, so every copy plays it.
- `p.knock({x,y,z} m/s, seconds)` and `p.teleport({x,y,z}, yaw)` (**CONTRACT-REQUEST**): callable from any copy; the
  kit applies it on the copy that owns the player (an event to that copy otherwise). With fair play on, the host refuses
  a knock on a player who is down or protected (→ false; `{force: true}` skips that), and a knock lasts
  `fair.downSeconds` in all; `{out: true}` keeps a player who was taken out down until revived. `p.push(v)` is a shove
  that never knocks over (streams, contact damage), routed the same way.
- `p.poseExtra = {k: number}`: small numbers that ride in the pose (`extra`), e.g. a stream's pressure. A bot's ride in
  the host's bot list (`e`), so every copy reads `p.pose.extra` for friends and bots alike.
- `p.data` is yours for per-player state; a replay empties it but keeps the same object.
- `p.bot` on the host's bots (**CONTRACT-REQUEST**): `seek(pos, {stop})`, `flee(pos)`, `wander()`, `stop()`,
  `aimAt(pos)`, `face(yaw)`, `press(action)`, `hold(action, secs)`, `rng()`.

## Shared state and events

```js
const S = ctx.shared.register('balls', { list: [] });   // every copy, in setup(): same key, same initial object
if (ctx.host) S.list.push({ id: 1, x: 0, y: 0, z: 0, h: '' });   // the host mutates; others' writes are ignored
const drawn = ctx.shared.smooth('balls');                // other copies: blended between snapshots (for drawing)
```
- Everything registered goes into one `net.world` message with the kit's state (≤ 3.5 KB: short keys, round numbers).
- Read numbers that must not blend (ids, counts, states) through the proxy (the latest snapshot), never `smooth()`.
- A replay resets every key to a copy of its initial object.
- `ctx.net.send(name, data, to)` travels as one kit message type; it reaches `rules.event(ctx, name, data, from)`, any
  `ctx.net.on(name, fn)`, or, for a name `"<mechanicId>:<event>"`, that mechanic's `event(event, data, from)`.
  Alone nothing is sent: the local copy is the host, so apply directly.

## A mechanic (track K2): `kit/mechanics/<id>/index.js`

```js
export const id = 'projectile';
export const params = { type: 'object', properties: { speed: { type: 'number', default: 18 } } };  // JSON Schema
export const examples = ['dodgeball throw', 'water-gun stream'];        // the `as` lines catalog.mjs shows
export const slots = [ /* templates, see below */ ];                    // or slotsFor(mechanicConfig, cfgAll)
export function create(ctx, params) { return { setup(ctx) {}, update(dt) {}, hostState() {}, applyState(s) {}, event(name, data, from) {}, reset() {}, dispose() {} }; }
```
- **It must import in Node with no DOM** (`tools/lib/kit-import.mjs` resolves `three`, `three/addons/*`, Rapier,
  `postprocessing`, `n8ao`, `../../../mp/net.js`, `../../../gf-assets.js`): `create`, `slots.mjs` and `catalog.mjs`
  read `id`, `params`, `examples` and `slots` that way.
- `create` checks the spec's params against `params` and fills its `default`s into `config/game.json`.
- Slot templates may use `{base}` (`/mechanics/<i>/params`, the pointer to this instance's params in
  `config/game.json`), `{i}`, `{id}`, `{as}` and `{<paramName>}`; `source.file` defaults to `config/game.json`.
  Example: `{ id: 'mechanic.projectile.speed', label: 'Throw speed', group: 'mechanics', type: 'number',
  source: { pointer: '{base}/speed' }, tier: 'main' }`. Without `slots`, the kit declares one value slot per param.
- `create` runs before the players exist; `setup(ctx)` (optional, may be async) runs once they do, before
  `rules.setup` — register `ctx.shared` keys there. `reset()` (**CONTRACT-REQUEST**) runs on a replay alone; `hostState()/applyState(s)` are yours to call through
  `ctx.shared` (register a key in `create`).
- Models through `ctx.assets.model('mechanic.<id>.model')` or a `prop.<name>` slot; every mesh you add must carry a
  slot (`ctx.assets.tag(obj, slotId)`), or verify check 4 fails.
- A fixture is a mini-spec: `node research/gf-three/tools/create.mjs <mini.spec.json> kit/mechanics/<id>/fixture`
  then write its `rules.js`; serve with `tools/serve.mjs` and gate with `tools/verify.mjs`.

## Look, world, character (tracks L and C)

- **look**: `createRenderer(canvas, lookConfig, tier)`, `applyLook(ctx, lookConfig)` → a handle with `render(camera)`,
  `resize(w, h)`, `update(dt)` (**CONTRACT-REQUEST**: the kit calls `render`/`resize`/`update` when present, else
  `renderer.render`). `lookConfig(presetId, {time})` (optional) is what `create` writes to `config/look.json`.
  `slotsFor(lookJson)` declares the look slots. Seat colours come from `look.palette.players` when present.
- **world**: `loadWorld(ctx, worldJson)` → `{spawn(i), zone(name), props, raycast, bounds: Box3, root, update(dt)}`.
  `slotsFor(worldJson, catalog, licences)`. `create` writes `config/props.json` (the catalog entries the layout uses)
  and copies each used prop to `assets/models/<id>.glb`.
- **character** (CONTRACT §4.4, track C as built): the kit calls `spawnCharacter(ctx, {player, bodySlot, tint, local,
  height, plate: null, onState})`, then every frame places `object3d` (feet, `rotation.y = yaw`), calls
  `locomotion(speed, grounded)`, `setAim(pitch)` (-1..1 from the aim's y) and `update(dt)`. Anim words drive the rest:
  `knockdown` (stunned) → `ragdoll(true)`; `down` (the ragdoll still settling, the kit's word while
  `character.state === 'ragdoll'`) → `ragdoll(false)` so it gets up once settled; `getup` (while `state === 'getup'`);
  any other word → `play(word)`. `player.knock(v, secs)` → the capsule flies and is stunned, and
  `character.knock(v, {getUp: false})` ragdolls with the same world velocity. `onState('getup', {position, yaw})`
  teleports the owned player's capsule there (camera kept). While the character is not in `'anim'`, the capsule takes
  no input. A remote player's copy ragdolls from the same words.
- **Collision groups** (RIG.md §6, in `core/util.js`): WORLD 0x1, PLAYERS 0x2, PROPS 0x4, RAGDOLL 0x8. A capsule is
  a PLAYER meeting WORLD | PLAYERS | PROPS; its ground cast and the camera's cast see WORLD | PROPS only; the stand-in
  world's colliders are WORLD. `ctx.physics` is the bare Rapier `World` and `ctx.RAPIER` the module (track L's world
  calls `ctx.physics.createRigidBody`; track C accepts either shape). `physicsOf(ctx)` in `core/util.js` →
  `{RAPIER, world}` from either shape (the bare World + `ctx.RAPIER`, or `{RAPIER, world}` from a bench or fixture);
  the character, projectile, carry, waves and `fixedRay` read Rapier through it.

## QA parameters (never used in real play; **CONTRACT-REQUEST**)

`?gf-autoplay=1` skips the lobby when playing alone (the countdown starts at once); `?gf-ui=0` hides the HUD.
`tools/verify.mjs` passes both to the contact-sheet capture, and Studio's `__GF_ASSET_OVERRIDES` patches (for
example a 25 s round) to its solo round.

## `window.__game` (CONTRACT §5)

`{kit, version, seed, quality, phase, ready, players, snapshot(), coverage(), slots(), controls(), looks()}`. `looks()` is
what this copy draws each player in (CONTRACT §6e: the loadout it holds for them, the body's tint read back from its
material, the colour of their stream's material; verify check 5's loadout leg). `controls()` is
what the local player's own screen shows of each control (verify check 13, CONTRACT §6d): the crosshair, the aim point
and where it is on screen, where the last shot landed (and whether the player's own body hides it), the HUD prompt, and
the interactables nearest first. `snapshot()` is plain JSON:
phase, round, time, players `{id, name, score, alive, bot, local, x, y, z, anim}`, winners, results, shared
(`ctx.shared.snapshot()`), `rules` (**CONTRACT-REQUEST**: an optional `rules.observe(ctx)` adds the game's own
fields), and `net` (the multiplayer gate's block; null alone). `coverage()` = `assets.coverage(scene)` plus
`unknownSlots` (slot ids on meshes that `assets.json` lacks); `slots()` = per-slot drawables, triangles, on screen.
