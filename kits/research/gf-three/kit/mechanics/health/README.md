# mechanic: health

Hit points (or none: a hit only knocks over), knockback with ragdoll and get-up, death, respawn with protection, regeneration, a HUD meter for the local player.

Part of the gf-three kit (track K2). Add it to a spec as `{ "id": "health", "as": "...", "params": {...} }`; `create` fills the defaults.

## Params
`hp` (0 = no meter, hits knock only), `regen`, `regenDelay`, `ragdollOnHit`, `getUpSeconds`, `respawnSeconds` (0 = out for the round), `respawnInvuln`, `respawnZone`, `killY`, `meter`, `label`, `color`, `soundHurt`, `soundDown`.

## Slots
`mechanic.health.hp`, `.respawn-seconds`, `.color` (the HUD meter), `.label` ... no meshes of its own (the body is the character; the meter is HUD). `.get-up-seconds` is advanced and applies only with fair play off; with it on, the main-tier `fair.down-seconds` rules every knock.

## Fair play (CONTRACT §6c, kit/core/fair.js; on by default)
- `damage()` does nothing and returns false, and `onDamage` doesn't fire, when the target can't be hit. That is a target who is down (knocked, getting up, out) or protected, a hit in the round's start grace, or a bot's hit on a human another bot is already fighting (`fair.botsPerTarget`).
- `damage(t, n, {push: true})` is a continuous hit, such as a stream tick or contact damage. It damages and shoves (`p.push`) but never knocks over.
- A knock lasts `fair.downSeconds` in all.
- A respawn goes to the spawn farthest from the other live players (`fair.respawnFar`), unless `respawnZone` is set. Protection counts from when the player can move.
- `isDown`/`isProtected` read fair play's view on every copy.

## Network ownership and message rates
**Host owns** every player's hit points, down/respawn timers and protection. Snapshot: `ctx.shared` key `hp`: `h = {playerId: hp}` (about 12 B per player). `p.alive` replicates through the kit's own world state, `p.knock`/`p.teleport` route to the owning copy through the kit. Events: `health:dmg` / `health:heal` only when `damage()`/`heal()` is called on a non-host copy (forwarded to the host); the usual callers (projectile, waves) run on the host, so normally none. Peak: 0 by default, a few per second if rules call `damage` from non-host copies.

## Netcode traps (PLAN 2.6)
A body that is down is not knocked again until it has got up, so hits cannot juggle; the hurt sound and `onHurt` fire on the edge of the hit-point change on every copy.

## Methods for rules.js
- Host: `damage(target, amount, {from, impulse, knockSeconds, push, point, source})` -> bool (false: refused); `down(target)`; `revive(target)`; `heal(target, n)`; `protect(target, secs)`.
- Every copy: `hpOf(player)`, `maxHp()`, `onHurt(fn)` `{player, hp, delta}`. Host: `isDown(p)`, `isProtected(p)`, `onDamage(fn)` `{target, from, amount, hp, lethal, knocked, source}`, `onDown(fn)`, `onRespawn(fn)`.

Example: `hp.onDamage(d => { if (d.from && d.knocked) d.from.score += 1; });`

## Fixture and tests
- Pure logic: `research/gf-three/tests/k2-health.test.mjs`.
- Two-player fixture: `fixture/spec.json` (mini-spec), `fixture/rules.js` (the tiny game, exposes `window.__fx`), `fixture/scenario.mjs`. Run: `node research/gf-three/tests/k2-fixture.mjs health` (creates the game with `tools/create.mjs` into the scratchpad, serves it, plays host + joiner over WebRTC in two headless contexts). The generated game is not kept in the repo (it is reproducible from those three files). Checks: two players: a hit lowers hit points identically on both copies (covered by the projectile fixture, which carries health); pure logic in `tests/k2-health.test.mjs`.
