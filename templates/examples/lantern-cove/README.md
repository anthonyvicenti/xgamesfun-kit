# Lantern Cove (example, vista engine)

A calm fishing evening for 1–4 friends on one island: walk out along the pier at sunset, cast, land fish, sell them at
the fish stall and buy better tackle. The evening ends when one of you has landed four different kinds of fish, or when
the clock runs out.

```bash
npx gamesfun create games/my-game --from lantern-cove
npx gamesfun dev games/my-game
```

**Before you start: vista is not open yet.** The engine is still being built in games.fun, so the catalog does not
offer it to a pitch (`gamesfun catalog engines` says "not open yet") and `npx gamesfun examples` lists this example
only with `GF_VISTA_OPEN=1` set. `create --from lantern-cove` makes it either way. What it needs:
- **WebGPU on a desktop graphics card.** The engine has no WebGL path: in a browser without WebGPU the game shows the
  kit's "open in a browser with WebGPU" screen. It also needs an adapter with at least 31 sampled and 5 storage
  textures per shader stage (`gf/vista/kit/gpu.js`, `MIN_LIMITS`); a card below that gets the same screen. Never for a
  phone or for a post on X.
- **About 62 MB per game.** `create` copies the engine's core whole into `gf/vista/core/` (about 54 MB: its code, sounds,
  models, textures and cloud noise).
- **A first visit of about 10 s** while the core compiles its shaders.

What it shows:
- **`"engine": "vista"` in the spec.** A physical sky and light over a simulated ocean with volumetric clouds, seen in
  first person, on the core's own island (`palm-isle`: a bay, a long pier, a fishing village, a reef, open sea, a boat
  and wildlife). `look.preset` picks one of six looks (`gamesfun catalog looks`); the hour, the sea state, the exposure
  and the clouds are each a slot.
- **A game with no mechanic modules.** The core plays the walking, swimming, the boat and the fishing from the data
  tables in `spec.json` → `vista` (the species, the gear, the two vendors, the money, where you start); create refuses
  what the core cannot do. `rules.js` keeps only the score and the goal (`rules.goalSpecies`, a slot).
- **Friends on the same island.** Each friend is a gf-humanoid-1 body (six Microsoft Rocketbox people, MIT) in their own
  colour; each player fishes on their own copy and keeps their own score.

**Checks.** A fresh create passes the full `verify --release` on a machine with WebGPU (see `example.json`). Fourteen
checks are "not yet for vista" (each with its reason in `verdict.json` → `notYet`, such as slot coverage of the core's
own models and the audio gate run) and are not counted as passed. CI does not run it: GitHub's runners have no WebGPU
adapter (docs/CI.md).

Provenance: games.fun's vista development spec (`kits/research/gf-vista/specs/thin-cove.spec.json`), with the prompt
reworded; our own design and names. The engine's core is Tidewater by DRG Software Solutions LLC (MIT), credited in
`gf/vista/core/ATTRIBUTION.md` in every game (THIRD_PARTY.md).
