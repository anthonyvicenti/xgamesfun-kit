# Coin Hop (example)

A 2D platformer seen from the side: run along a stage of ledges, jump, and grab coins. The level is a tile map written in
the spec (`world.map`), the bodies are drawn pictures (gf-flat-1), and `rules.js` is 20 lines.

```bash
npx gamesfun create games/my-game --from coin-hop
npx gamesfun dev games/my-game
```

What it shows: engine `flat` (the gf-three kit on a plane, `plane: side`), a tile map as a slot (`world.map` in
`config/world.json`; `node kits/research/gf-three/tools/flat-map.mjs games/my-game` prints it and checks every ledge and
coin can be reached), and picture bodies with six frames (idle, walk1, walk2, air, act, down).

Provenance: games.fun's `research/gf-three/flat-examples/coin-hop` (open builder track F), spec and rules unchanged.
Same owner as this kit (THIRD_PARTY.md).
