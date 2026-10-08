# Third-party code and art

Everything this repository carries that it did not write, with its licence and where the licence text sits. Licences
travel with the code: each vendored copy keeps its LICENSE beside it, and `create` writes an `ATTRIBUTION.md` into every
game listing the code and art that game carries.

This repository itself has no licence yet (its owner has not chosen one).

## games.fun's kits (`kits/`)

A snapshot of the games.fun repository at the commit in `kits/KITS.json`, made by `scripts/sync-kits.mjs`. games.fun
and this kit have the same owner.

| Kit | Version | In `kits/` | Licence |
|---|---|---|---|
| gf-three (the three.js game kit and its tools) | 0.1.0-dev | `research/gf-three/` | games.fun |
| gf-multiplayer | 1.3.0 | `research/foundations/kits/gf-multiplayer/1.3.0/` | MIT (its `kit.json`) |
| gf-audio | 1.5.0 | `research/foundations/kits/gf-audio/1.5.0/` | games.fun; ZzFX inside is MIT |
| gf-assets | 1.3.0 | `research/foundations/kits/gf-assets/1.3.0/` | games.fun |
| local signaling, validators, QA (signal server, asset-manifest validator, audio gate, Chrome launcher) | as synced | `research/multiplayer/`, `research/asset-manifest/`, `research/audio/`, `research/foundations/qa/`, `creator-studio/lib/` | games.fun |

## Code inside the kits

| What | Version | Licence | Licence text |
|---|---|---|---|
| three.js (build) | 0.186.0 | MIT | `kits/research/foundations/trials/fps-arena/source/vendor/three/LICENSE` |
| three.js addons (curated copy: loaders, utils, postprocessing, …; meshopt decoder, ktx-parse, zstddec, fflate) | 0.186.0 | MIT | `kits/research/gf-three/tools/lib/vendor/three/LICENSE` |
| Draco decoder, Basis Universal transcoder (from three.js) | 0.186.0 | Apache-2.0 | their `README.md` under `…/examples/jsm/libs/draco/` and `…/libs/basis/` |
| @dimforge/rapier3d-compat | 0.19.2 | Apache-2.0 | `kits/research/foundations/trials/third-person-adventure/source/vendor/rapier/LICENSE` |
| pmndrs postprocessing | 6.39.5 | Zlib | `kits/research/foundations/trials/fps-arena/source/vendor/postprocessing/LICENSE.md` |
| N8AO | as vendored | MIT | `kits/research/foundations/trials/fps-arena/source/vendor/n8ao/LICENSE` |
| pmndrs/ecctrl (floating-capsule logic, ported) | `e2cab804` | MIT, © 2023-2026 Erdong Chen | `kits/research/gf-three/kit/controller/LICENSE-ecctrl`, `NOTICE-ecctrl` |
| ws (the signal server's WebSocket) | 8.21.3 | MIT | `kits/research/multiplayer/p2p/vendor/ws/LICENSE`, `../ATTRIBUTION.md` |
| ZzFX (in gf-audio) | 1.3.2, adapted | MIT | `kits/research/foundations/kits/gf-audio/1.5.0/source/LICENSE-zzfx`, `ATTRIBUTION.md` |

The kit's own list is `kits/research/gf-three/kit/THIRD_PARTY.md`.

## Art (`kits/research/gf-three/library/`)

Every file has a record in `library/LICENSES.json` (licence, author, source page, download, sha256 of the source and the
shipped file, what was changed). The sync ships only CC0 and permissive licences, and never Meshy output (its licence
tier is unconfirmed).

| Source | Licence | Files |
|---|---|---|
| Kenney (kenney.nl) | CC0-1.0 | 139 props |
| Quaternius (Universal Animation Library and character packs) | CC0-1.0 | 14 bodies and the shared clips |
| games.fun (the bean bodies, procedural textures, previews) | CC0-1.0, or games.fun's own | 28 |
| Poly Haven (stand-in ground texture) | CC0-1.0 | `tools/lib/standin-assets/grass.ktx2` |
| Poly Pizza creators, below | CC-BY-3.0 | 10 props |

CC BY 3.0 requires credit. A game that uses one of these props carries the line in its `ATTRIBUTION.md` (create writes
it); the lines:

- "Slide" by Poly by Google, CC BY 3.0 (https://poly.pizza/m/dDe3njWPbg0)
- "Cloud" by jeremy, CC BY 3.0 (https://poly.pizza/m/8CXbPO6p0n2)
- "Cloud" by Poly by Google, CC BY 3.0 (https://poly.pizza/m/44cGXp6_8WD)
- "Swing set" by Poly by Google, CC BY 3.0 (https://poly.pizza/m/e-IJdcqZH4p)
- "Sandbox" by sirkitree, CC BY 3.0 (https://poly.pizza/m/07KqBahqHXK)
- "Picnic Table" by J-Toastie, CC BY 3.0 (https://poly.pizza/m/GQieALI2C4)
- "Barbecue Grill" by Jason Toff, CC BY 3.0 (https://poly.pizza/m/c53QXQ1ofIN)
- "Red/White Beach Umbrella" by S. Paul Michael, CC BY 3.0 (https://poly.pizza/m/2li3sdSkmCI)
- "Reel W/ Hose" by J-Toastie, CC BY 3.0 (https://poly.pizza/m/qXBsZPAaYQ)
- "Water Cooler" by J-Toastie, CC BY 3.0 (https://poly.pizza/m/zWi9p5FSxD)

Sounds are gf-audio presets, synthesised at run time: no audio files.

## The example game

`templates/examples/soak-squad/` is adapted from "Bladder Brawl", a game games.fun's Studio v2 built and delivered
(same owner). It uses only the library art above.

## npm dependencies (`package.json`, pinned exactly; installed by `npm ci`, not committed)

| Package | Version | Licence |
|---|---|---|
| @modelcontextprotocol/sdk | 1.30.1 | MIT |
| playwright-core | 1.63.0 | Apache-2.0 |
| their dependencies (93 packages: express, hono, zod, ajv, …) | as locked in `package-lock.json` | MIT (84), ISC (7), BSD-3-Clause (2), BSD-2-Clause (1) |

Installed on first use of `rig-check` or `meshy`, from `kits/research/gf-three/tools/lib/char-deps/package.json`:
@gltf-transform/core, extensions, functions 4.5.1 (MIT), meshoptimizer 1.1.1 (MIT), sharp 0.35.5 (Apache-2.0; its
prebuilt libvips binaries are LGPL-3.0, dynamically linked), three 0.186.0 (MIT).

When Playwright's Chromium is downloaded (no Chrome or Edge on the machine), it comes under Chromium's own licences.
