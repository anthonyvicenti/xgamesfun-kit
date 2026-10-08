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

## web3 (`web3/`, `server/routes/web3.mjs`, `commands/web3.mjs`, `mcp/tools/web3.mjs`, `studio/tabs/{token,shop}.js`)

The Solana layer has **no runtime npm dependencies**. Its Solana code is written in the kit's own plain ES modules,
in `web3/gf-web3/chain/`. That covers base58, SHA-256, the ed25519 curve check, PDAs, Borsh, legacy and v0
transactions, the loot program, Metaplex Core, the Meteora DBC launch instructions and mint parsing. Node's own
`node:crypto` provides ed25519 and SHA-384. The kit adopts nothing from `@solana/web3.js`, which pulls in
`rpc-websockets` (LGPL-3.0-only).

| What | Where it is used | Licence | How |
| --- | --- | --- | --- |
| games.fun loot program IDL (program `FWVap91D…f53D`) | `web3/gf-web3/chain/loot-idl.js` | games.fun's own | Copied from games.fun `launchpad/loot/client/idl.json` at commit `111d4f926be7ab62dce6e5f7344e23ac6afe2adc`, with doc comments removed |
| Meteora Dynamic Bonding Curve IDL facts (instruction discriminators, account orders, `PoolConfig`/`VirtualPool` field offsets, program version 0.2.1) | `web3/gf-web3/chain/dbc.js` | MIT, per the `license` field of `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12. The npm package ships no LICENSE file. | Read from the IDL inside that SDK. The kit does not copy the SDK's code. The kit's builders are checked against the SDK's output through golden fixtures. |
| Wallet Standard protocol | `web3/gf-web3/wallet.js`, `studio/tabs/web3/wallet.js` | Specification (wallet-standard, Apache-2.0) | Implemented from the protocol's events (`wallet-standard:register-wallet`, `wallet-standard:app-ready`). No library is used. |
| ANS-104 data items | `web3/node/irys.mjs` | Specification (ArweaveTeam/arweave-standards) | Implemented from the specification. The output is checked against `@irys/bundles` 0.0.5 (Apache-2.0) through golden fixtures. That package is not a dependency. |

### Test-only (not installed with the kit)

`tests/web3/fixtures/generate.mjs` regenerates `tests/web3/fixtures/chain.json` from a separate reference install,
which is never part of the kit. That install holds `@solana/web3.js` 1.99.0 (MIT), `@solana/spl-token` 0.4.15
(Apache-2.0), `@meteora-ag/dynamic-bonding-curve-sdk` 1.5.12 (MIT), `@irys/bundles` 0.0.5 (Apache-2.0),
`bn.js` 5.2.5 (MIT) and games.fun's own loot client. The fixture file holds the outputs and public devnet account
bytes. It holds no code.

The web3 browser test (`tests/web3-studio.test.mjs`) and the devnet proof (`tests/web3/devnet/proof.mjs`) drive Chrome through
the kit's `playwright-core` (above) with an injected Wallet Standard wallet; they add no dependency.

