# Isle Run (example, scenic engine)

A co-op action run for 1–4 players (bots fill empty seats) on the scenic engine: knights fight skeleton warriors,
archers and brutes across three floating isles joined by portals, then face the Bone Sorcerer.

```bash
npx gamesfun create games/my-game --from isle-run
npx gamesfun dev games/my-game
```

What it shows:
- **`"engine": "scenic"` in the spec.** The scenic look and a generated world (`isles`, one island per level), the
  `follow` camera, and the scenic library's KayKit bodies, weapons and dungeon props (CC0). It draws with WebGPU; in a
  Chrome without a WebGPU adapter it runs on WebGL2 inside the same renderer.
- **A game that is all mechanics.** `melee` (sword combos, a heavy strike, a dodge roll), `waves` with three enemy
  types, `health`, `levels` (a portal opens when an isle is clear), `boss` and `loot`, every one configured in
  `spec.json`. `rules.js` is fifteen lines: only the results card. Start here when your idea is "an action game with
  levels and a boss", and add to `rules.js` what the mechanics do not say.
- **Every model and number is a slot.** The four bodies, each weapon, the boss's name and health, the wave sizes:
  `npx gamesfun slots list games/my-game --all`.

**Known failing checks (2026-10-10, kits at games.fun 4c3585f89).** A fresh create fails `verify --quick` on two
checks, both about the `follow` camera and neither fixable in a game's own files:
- **24, plays inside a post:** the check waits for the frame to refuse a pointer lock, and a `follow` camera never asks
  for one.
- **34, watch then play:** a viewer's camera does not follow the streamer's `follow` camera (about 45 m and 84° apart).

`example.json` → `knownFailing` lists them, and the smoke test fails when that list and the verdict differ, so the
entry goes when the kit is fixed. With `"camera": "third"` or `"orbit"` the same spec fails checks 13 and 16 instead
(a melee swing does not go where those cameras aim), so the engine's own camera stays.

Provenance: games.fun's scenic sandbox spec (`kits/research/gf-scenic/specs/sandbox.spec.json`), with the prompt
reworded. Same owner as this kit (THIRD_PARTY.md).
