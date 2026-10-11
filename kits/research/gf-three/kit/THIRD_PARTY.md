# gf-three: third-party code and art (the vendoring list)

Every library a gf-three game carries, where `create` copies it from, and its licence. The licence file travels beside
each copy. A new dependency needs a permissive licence and a line here (research/gf-three/README.md rule 2).

## Code a game vendors (`<game>/vendor/`, `<game>/gf/`, `<game>/audio/`)

| What | Version / pin | Copied from | Into the game | Licence |
|---|---|---|---|---|
| three.js build | 0.186.0 (`build/three.module.js`, `three.core.js`), byte-identical to the npm tarball | `research/foundations/trials/fps-arena/source/vendor/three/` | `vendor/three/build/`, `vendor/three/LICENSE` | MIT |
| three.js addons | 0.186.0, only the files the kit, the modules, the libraries and `rules.js` import (resolved by `tools/lib/vendor.mjs`) | `research/gf-three/tools/lib/vendor/three/examples/jsm/` (a curated copy of the npm 0.186.0 tree: animation, csm, curves, effects, environments, geometries, lights, lines, math, misc, modifiers, objects, postprocessing, shaders, textures, utils; the GLTF, DRACO, KTX2, HDR, RGBE and EXR loaders; meshopt, ktx-parse, zstddec, fflate) | `vendor/three/examples/jsm/` | MIT |
| Draco decoder | from three.js 0.186.0 `examples/jsm/libs/draco/gltf/` | the curated copy | `vendor/three/examples/jsm/libs/draco/` (with its README) | Apache-2.0 |
| Basis Universal transcoder | from three.js 0.186.0 `examples/jsm/libs/basis/` | the curated copy | `vendor/three/examples/jsm/libs/basis/` (with its README) | Apache-2.0 |
| @dimforge/rapier3d-compat | 0.19.2 (wasm inlined) | `research/foundations/trials/third-person-adventure/source/vendor/rapier/` | `vendor/rapier/` (`LICENSE`, `package.json`) | Apache-2.0 |
| pmndrs postprocessing | 6.39.5 | `research/foundations/trials/fps-arena/source/vendor/postprocessing/` | `vendor/postprocessing/` (`LICENSE.md`) | Zlib |
| N8AO | as vendored by fps-arena | `research/foundations/trials/fps-arena/source/vendor/n8ao/` | `vendor/n8ao/` (`LICENSE`) | MIT |
| gf-multiplayer | 1.3.0 | `research/multiplayer/party/adopt.mjs` (from `research/foundations/kits/gf-multiplayer/`) | `gf/mp/` | games.fun (MIT header) |
| gf-assets | 1.3.0 (`gf-assets.js` only) | `research/foundations/kits/gf-assets/1.3.0/source/` | `gf/gf-assets.js` | games.fun |
| gf-audio | 1.5.0 (ZzFX inside: MIT, `LICENSE-zzfx`) | `research/foundations/kits/gf-audio/1.5.0/source/` | `audio/` | games.fun; ZzFX MIT |
| gf-three (this kit) | 0.1.0-dev | `research/gf-three/kit/` | `gf/three/` (+ `gf/three/kit.js`, the hashes) | games.fun |
| three.js WebGPU build (scenic games only, CONTRACT §8) | 0.186.0 (`build/three.webgpu.js`, `three.tsl.js`, the same `three.core.js`), byte-identical to the npm tarball | `research/foundations/trials/third-person-adventure/source/vendor/three/` | `vendor/three/build/` | MIT |
| three.js TSL addons (scenic games only) | 0.186.0 `examples/jsm/tsl/` | `research/gf-scenic/tools/lib/vendor/three/` (copied from the npm 0.186.0 tarball) | `vendor/three/examples/jsm/tsl/` (only what the modules import) | MIT |
| gf-scenic (the scenic engine, scenic games only) | 0.1.0-dev | `research/gf-scenic/kit/` (folio-2025 by Bruno Simon @ `41046b5`, MIT, ported; `LICENSE-folio-2025` beside it) | `gf/scenic/` (hashed in `gf/three/kit.js`) | games.fun; folio-2025 MIT |

## Code inside the kit

| What | Where | Upstream | Licence |
|---|---|---|---|
| Floating-capsule character logic | `kit/controller/capsule.mjs` | [pmndrs/ecctrl](https://github.com/pmndrs/ecctrl) @ `e2cab804f9f15661a642e76f52d09f0b2db63f35` (`src/character/Ecctrl.tsx`), by way of games.fun's `trials/third-person-adventure/source/src/physics.mjs`; `LICENSE-ecctrl` and `NOTICE-ecctrl` beside it | MIT, Copyright (c) 2023-2026 Erdong Chen |
| Third-person camera rig | `kit/controller/camera-rig.js` | games.fun's `trials/third-person-adventure/source/src/camera-rig.js` (authored there) | games.fun |
| Friends drawn from poses, nameplates, `onScreen` | `kit/net/players.js` | patterns from games.fun's `trials/dusk-outbreak/source/src/friends.js` and `research/multiplayer/party/LIVE_HANDBOOK.md` | games.fun |
| The Node import hook for declarations | `research/gf-three/tools/lib/kit-import.mjs` | Node's `module.registerHooks` | — |
| Melee combat model (combo chains, swing arcs, queued presses and combo windows, the dash strike, hit-stop) | `kit/mechanics/melee/logic.js` (rewritten as data and a step function; nothing copied line for line) | [octobooth-4/buddy-rollback](https://github.com/octobooth-4/buddy-rollback) @ `db51978d61ed329fcdcfbfc8653b28cfdb007404` (`src/weapons.js`, `src/player.js`); `LICENSE-buddy-rollback` and `NOTICE-buddy-rollback` beside it. No Buddy or VS Code character, name or lore | MIT, Copyright (c) 2026 BUDDY: ROLLBACK contributors |
| Attack tokens and telegraphed windups for enemies | `kit/mechanics/waves/` | games.fun's Knuckle Row, `trials/brawler/source/src/model.mjs` | games.fun |

## Stand-in art `create` copies into a game (until tracks L and C have a match)

Listed with hashes in `research/gf-three/tools/lib/standin-assets/provenance.json`.

| File | Slot | Source | Licence |
|---|---|---|---|
| `mannequin.glb` | `character.body.<role>` (only when the character module is the stand-in) | Quaternius Universal Animation Library mannequin, `trials/third-person-adventure/source/assets/hero/hero.glb` byte for byte | CC0-1.0 |
| `grass.ktx2` | `world.<template>.ground` (stand-in world only) | Poly Haven `leafy_grass`, converted by `trials/scenic-valley` | CC0-1.0 |
| `ball.glb`, `slide.glb`, `bench.glb`, `crate.glb` | `prop.<name>` with no library match | baked by `tools/lib/standin-bake.mjs` (games.fun) | CC0-1.0 |
| `cap.glb`, `cap-backwards.glb` | `character.hat.<role>` | baked by `tools/lib/standin-bake.mjs` (games.fun) | CC0-1.0 |

Library props, bodies and clips (`research/gf-three/library/`) carry their own records: `library/LICENSES.json`
(props, textures) and `library/bodies.json` (bodies, e.g. the Meshy body is CC BY 4.0 crediting Meshy). `create` copies
each record into the game's `assets.json` slot and `ATTRIBUTION.md`.
