## On the vista engine (this game)

This game runs on **gf-vista**: a vendored WebGPU core (an island in the open sea with a physical sky, a simulated ocean, volumetric clouds, a walker, a boat and fishing) draws and simulates it, and the shared kit around it is the same as any game's (the home menu, the session, friends, sounds, slots). It is first person, calm, co-op for up to four on one island. You need nothing but this page, `game/spec.json`, `game/config/game.json`, `game/config/look.json` and `game/rules.js`; [CONTRACT §8 vista]({{KIT}}/CONTRACT.md) is the reference if you want one.

**What in "Rules of the job" below does not apply here.** No mechanic module runs on vista, so these lines are void, and this section stands in their place:

| Below | On vista |
|---|---|
| Mechanics, their callbacks and params | The core plays the walk, the swim, the boat and the fishing. Its numbers are the data tables (`config/game.json` → `vista`) |
| Fair play, bots, hits, enemies | Nothing hurts or knocks anyone, and there are no bots: friends play friends, alone is alone |
| The world (`entries`, zones, props) | The world is the core's island (`palm-isle`). `config/world.json` holds only the start places: leave it as `create` made it |
| Generated models, cosmetics | Nothing is generated for a vista game. Friends see the kit's bodies in each player's colour |
| "Play a round with bots yourself" | Play alone: `?seed=1` |

Every numbered check that applies runs on vista; one printed **"not yet for vista"** never counts against you.

### What already works before you write a line

- **The island.** Walking (WASD, the mouse to look after a click), sprinting (Shift), jumping, wading, swimming and diving; E boards the moored boat by the pier and takes its helm.
- **The fishing.** R takes out the rod; hold and let go of the left button to cast; strike when a fish bites, hold to reel. What bites, where and what it is worth is `vista.species`; the stalls' names and greetings are `vista.vendors`; the shop's gear and prices are `vista.gear`; the money a player starts with is `vista.economy.startMoney`; where players begin is `vista.start` (`pier`, `beach` or `boat`).
- **The look.** `config/look.json` (`preset`, `hour`, `sea`, `exposure`, `clouds`): each a slot the creator can change in Studio. Verify check 37 holds the core to it.
- **The HUD.** The shared HUD (the clock, the goal, the scores, the menu button) and vista's own parts (money, the cooler, the rod, the bite, the fight, the catch card, the stalls). Never draw your own HUD over them.
- **Friends.** Each player sees the others as a person in their colour with their name above, where they really are. The host's copy owns the time of day, the sea, the clock and the results; each player's catch, cooler and money are their own copy's.

### What is yours: `rules.js`

What the session is about, in a few lines. `create` wrote a plain version that already plays: a fish landed scores one point, and the session ends for everyone when one player has landed `rules.params.goalSpecies` different kinds of fish (or when the clock runs out). Keep what fits the spec and make the rest this game's own.

**Hooks.** `setup(ctx)`, `roundStart(ctx)`, `update(ctx, dt)`, `event(ctx, name, data)`, `check(ctx)`, `results(ctx)`. The game's events reach `event` **on the copy where they happened** (every player fishes on their own copy):

| Event | `data` |
|---|---|
| `bite`, `hooked`, `lost` | the species when it is known |
| `catch` | `{species, name, kg, cm, value}`: a fish landed |
| `sold` | `{sold, money}`: the catch sold at the buyer |
| `bought` | `{id, money}`: gear bought at the shop |
| `board`, `leave` | the player took or left the boat |

**What you may call.** `ctx.vista.state()` → `{money, cooler: {kg, capacity, count}, rod, fight, near, catches, log}` (`log` has one entry per species landed); `ctx.vista.sell()`, `ctx.vista.buy(id)`; `ctx.vista.look.set({hour, sea, exposure})` for the light changing during play (a day passing), never at boot; `ctx.vista.tables` (the filled tables); `ctx.me` (this copy's player: set `ctx.me.score`, and it reaches the host's results by itself); `ctx.players.list()`; `ctx.finish(reason)` ends the session for everyone with the results (on a joiner it asks the host); `ctx.ui.banner(text, seconds)`, `ctx.ui.toast(text)`, `ctx.ui.goal(text)`; `ctx.audio.play(id)` for a sound `assets.json` lists; `ctx.config.rules.params` for your own numbers (a `rules.*` slot each); `ctx.rng()` never `Math.random`; `ctx.time.left`.

**Traps.** Score on events, never every frame. Only `ctx.me.score` is yours to change on a copy: another player's score is their copy's. Never stop the core's frame, move the camera, take the mouse, or load anything from `gf/vista/core` yourself. A calm game ends on its goal or its clock, never on a loss.

### Tuning is the tables and the look, never code

Every number a player meets is a slot (`vista.species.<id>.value`, `vista.gear.<id>.price`, `vista.economy.startMoney`, `look.hour`, …). Edit `config/game.json` → `vista` and `config/look.json`. Words are slots too: `config/game.json` → `text`, every species' and gear's `name`, the vendors' names and greetings. **Our own words only:** no name of the game the creator mentioned, nor of any upstream game, person or place, anywhere in the game.

### What vista cannot do yet

Any world but the core's island; any camera but first person; enemies, combat, weapons, building, crafting or farming; a boat friends ride together; progress kept between sessions; phones or a post on X. If the spec asks for one of these, build the closest calm game the engine can, take the promise out of the hook in `config/game.json`, and say so in the delivery summary.

### verify on vista

`node {{KIT_TOOLS}}/verify.mjs game --quick` runs the checks that apply; it needs WebGPU, which the worker passes in. Re-run one with `--check N`: 3 (boots, walks), 6 (a session ends and replays), 20 (the menu), 21 (the HUD), 36 (the sea drawn and moving), 37 (the look is the config's). Never edit `game/gf/` (check 2 compares `gf/vista` byte for byte with what `create` made) and never add a `<script>` or an import map to `index.html`.
