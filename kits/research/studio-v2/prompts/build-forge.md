## On the forge engine (this game)

This game runs on **gf-forge**: a Rust core on WebGPU draws and simulates it, and the shared kit around it is the same as any game's (the home menu, the round, friends, sounds, slots). It is first person, co-op for up to four, in one arena. You need nothing but this page, `game/spec.json`, `game/config/game.json` and `game/rules.js`; [CONTRACT §8 forge]({{KIT}}/CONTRACT.md) is the reference if you want one.

**What in "Rules of the job" below does not apply here.** No mechanic module runs on forge, so these lines are void, and this section stands in their place:

| Below | On forge |
|---|---|
| Fair play (`ctx.bots.target`, `p.knock`, `fair`) | The core limits what an enemy does to a player. Write no bot code: the core's bots fight by themselves, and `ctx.bots` and `p.knock` do nothing here |
| Aim and interact (`prj.fire`, pickups on E) | The core fires the weapon in hand at the crosshair. E raises a fallen friend, and nothing else |
| Hits (projectile `damage` under waves `hp`) | The same rule over the tables: "Hits must read" below |
| The world (`entries`, the `centre` zone, a waves `target`) | The arena is generated with its graves, cover and edge. Leave `config/world.json` and `props` as `create` made them. The spec's prop (the chest) is something to stand by: it has no health and nothing targets it. Check 15 only asks that it is on screen when the round starts, which `create` arranged |
| Generated models, cosmetics | Nothing is generated for a forge game. Friends see the kit's hunters in each player's colour |
| "Play a round with bots yourself" | Play alone: `?seed=1`. verify check 12 adds three of the core's own bots, which fight with the same weapons and score through your `enemy-down` rule |

Every numbered check applies on forge except one printed **"not yet for forge"**, which never counts against you.

### What already works before you write a line

`create` filled the data tables (`config/game.json` → `forge`: `player`, `weapons`, `enemies`, `waves`, `cards`, `deal`, `feel`) and the kit plays them by itself:

- **The fight.** Walk, jump, evade (Shift), fire, reload (R), a quick melee (V: it swings the first row of `weapons` whose `kind` is melee, whether or not the player holds it), weapon keys; every hit's flash and number, kills that break into pieces, coins, the combo, the red edge when hurt.
- **The waves.** The director starts wave 1 just after `roundStart` on the host, raises each wave's enemies and stops when the round ends. A wave whose row says `reward: true` opens the three-card reward by itself when it is cleared (each player picks or passes for themselves, and a card changes only the player who took it; the inspector, the countdown and the bots' picks are the kit's), and then the next wave comes. The last wave never asks for a reward. The reward comes where the tables put it: move it only if the spec's rules say so.
- **Down and revive.** With a friend standing, a player at zero health is down (`p.down`), and a friend holding E beside them brings them back. Alone, zero health is out. Either way `p.alive` is false until they stand again.
- **The HUD.** Health, armour and stamina, the wave and what remains, a boss's bar, score, coins, the weapons held, friends' health, the wave and boss banners, the results, touch buttons for every action. Never draw another health bar, hide this one or build a reward screen.

### What is yours: `rules.js`

Five things no table can say. For a game with waves `create` wrote a plain version of all five into `game/rules.js`, so the game already scores, can be won and can be lost: read it, keep what fits and make the rest this game's own (its banners, its own numbers in `rules.params`, what the spec's rules add). Bone Vigil's rules (`{{REPO}}/research/gf-forge/specs/vigil.rules.js`, 100 lines) are a worked example:

1. **Start over.** In `roundStart`, on the host, every player begins again: `ctx.forge.cmd.raw(FEEL_OP.RESET, [n])` (health and armour from the tables, last run's cards gone, weapons refilled), then `ctx.forge.cmd.raw(FEEL_OP.CLEAR, [])` (old pieces and coins). `n` is `ctx.players.nid(p.id)`, the player's id in the core; `import { FEEL_OP } from './gf/forge/feel.js'`.
2. **Score.** The kit never scores. In `event`, on the host while `ctx.round.phase === 'playing'`: `enemy-down` gives `d.b` points to the player whose core id is `d.d`; `coin` gives `d.a` to the player `d.entity`. Score what the spec's `rules.scoring` says and nothing more (drop the coin line if only kills score). Each player keeps their own `p.score`, in co-op too; the host's scores reach every copy by themselves.
3. **Win.** On `waves-done`: `ctx.round.end('cleared', ids)` with the ids of the players whose `p.alive` is not false.
4. **Lose.** In `update`, on the host: when every player's `p.alive === false`, `ctx.round.end('lost', [])`. Nothing else ends a lost round, and verify check 6 fells a player alone and waits for the results.
5. **The clock.** `round.seconds` is the longest a run may last. Left to itself the kit ends the round there and names the top scorer the winner, so end it first with no winner: `if (ctx.time.left <= 0.5) ctx.round.end('time', [])`.

The results card says `text.wins` when the winners' list has anyone in it, `text.lost` when the reason is `'lost'`, and `text.draw` otherwise; the reason is otherwise your own word.

**Hooks.** `setup(ctx)`, `roundStart(ctx)`, `update(ctx, dt)` and `event` run on every copy, so keep commands and scoring under `if (ctx.host)`. The core's rule events arrive as `rules.event(ctx, name, {entity, a, b, c, d, remote}, 'forge')` (`remote`: it came from the host's copy; the last argument only says the core sent it):

| Event | `entity`; `a`, `b`, `c`, `d` |
|---|---|
| `wave-start` | 0; the wave (from 1), how many waves, its enemies, 1 for a boss wave |
| `wave-clear` | 0; the wave, how many waves, 1 when a reward follows |
| `waves-done` | 0; how many waves (the last one is cleared: the run is won) |
| `enemy-down` | the enemy; its row, its score, its coins, the killer's core id, or 0 when no player killed it (a boss sends this and `boss-down`: score on `enemy-down` only) |
| `coin` | the player's core id; the value |
| `boss-arrive`, `boss-phase` | the boss; for a phase: the phase, how many |
| `player-down`, `player-revived`, `player-out` | the player's core id |
| `card-picked` | the player's core id; the card's row |

**What you may call.** `ctx.players.list()` (each `p`: `id`, `name`, `local`, `score`, `alive`, `down`, `health {hp, max, armor}`, `position`; `p.teleport(pos, yaw)`), `ctx.players.nid(id)`, and `ctx.players.byNid(n)`, which gives nothing for an id that is no player. `ctx.forge.cmd.setHealth(n, hp, max, armor)`, `ctx.forge.cmd.damage(n, amount)`. `ctx.cards.give(p.id, 'card-id')`, `ctx.cards.revive(p.id)`. `ctx.ai.spawn('enemy-id')`, `ctx.ai.director.skip(wave)`, `.state()`. `ctx.ui.banner(text, seconds)`, `ctx.ui.goal(text)`, `ctx.ui.toast(text)`. `ctx.audio.play(id)` for a sound `assets.json` lists. `ctx.config.rules.params` for your own rule numbers (a `rules.*` slot each: how much a cleared wave mends, say), `ctx.tables` for the tables as filled, `ctx.rng()` never `Math.random`, `ctx.time.now` and `ctx.time.left`. `p.alive`, `p.health` and `p.position` are the core's every frame: change them with commands, never by assignment.

**Traps.** Score on events, never every frame. Define `rules.reward` only if the game needs its own reward, and then call `resume()` or the waves stop for good. `ctx.round.end` with no winners list makes the top scorer win. Never start the waves yourself, switch a player's controller off, or cover the screen for seconds (check 10).

### Tuning is the tables, never code

Every number of the fight is a slot the creator can change in Studio (`forge.weapons.<id>.damage`, `forge.enemies.<id>.health`, `forge.waves.<id>.maxAlive`, …). Edit `config/game.json` → `forge`; `node {{REPO}}/research/gf-forge/tools/tables.mjs game/config/game.json` says what the core refuses. What a round's length is made of: each wave's `enemies: [{type, count}]`, `maxAlive`, `friends` (the share a wave, and a boss's health, grows per extra player), `reward`, `boss`; each enemy's `health`, `damage`, `speed`; each weapon's `damage`, `fireInterval`, `magazine`, `reload`, `start` (in hand from the start; a card of `kind: "weapon"` gives the others).

- **Hits must read (check 16).** verify puts every weapon a player can hold in their hands (the ones a card gives too) and shoots the first enemy row: a body hit may not kill it. Keep each gun's `damage` under that enemy's `health`, and a melee weapon a player holds under half of it (a swing lands on the head, which doubles). A scattergun is judged by one pellet. The quick melee may kill on contact.
- **Leave the feel alone.** The defaults of `player` (walk, jump, evade), each weapon's kick and light, and the enemies' tells are measured values. Change how hard and how many, not how it handles.
- **Words are slots too.** `config/game.json` → `text`, a weapon's, an enemy's and a card's `name` and `text`, and the reward screen's own words (`forge.deal.text`) are yours to make this game's: if the spec calls the cards relics, say relics.

### Controls and How to play

`config/game.json` → `controls` lists `jump`, `primary` and, in a game for two or more, `interact` (E raises a fallen friend). `controls.more` holds the engine's own keys for How to play, each row `[the key, what it does, its touch button's name]`. Keep the rows, and keep the second column true to what the key does: check 20 presses every one, with every weapon a player can come to hold already in hand. Take the weapon-keys row out only if no card and no rule ever gives a second weapon. Never list `secondary`: right click does nothing yet.

### What forge cannot do yet

More than one place (levels, rooms, doors, a shop); any camera but first person; players hurting each other, or teams; pickups to carry, stations, a base with health; bodies or props made for the game (the players are the kit's hunters, the enemies the library's skeletons by archetype, the prop a library piece); an alternate fire or thrown things; spending coins. If the spec asks for one of these, build the closest game the tables can, take the promise out of the hook in `config/game.json`, and say so in the delivery summary.

### verify on forge

`node {{KIT_TOOLS}}/verify.mjs game --quick` runs every check through the engine's observation interface; it needs WebGPU, which the worker passes in. Re-run one with `--check N`: 6 (a round ends, won and lost), 10 (control), 12 (bots score), 13 (controls), 15 (the prop on screen at the start), 16 (hits), 18 (sounds), 20 (the menu and the key table), 21 (health on the HUD). Never edit `game/gf/` (its `forge/wasm/` is the pinned core: check 2 compares it byte for byte) and never add a `<script>` or an import map to `index.html`.
