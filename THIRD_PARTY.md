# Third-party code and art

Everything this repository carries that it did not write: its licence, where the licence text sits, whether it asks for
credit, and whether it is copied into the games people make. Audited from the repository itself on 2026-10-11; a thing
whose licence the repository cannot show is listed at the end under "Needs a person" and is not described as settled.
For the people and projects behind the art, see [CREDITS.md](CREDITS.md); for a plain-words version, see
[docs/LICENSING.md](docs/LICENSING.md). `tests/licensing.test.mjs` fails when a library file has no licence record, when
a CC-BY file is missing from `CREDITS.md`, or when `LICENSE` is missing or not MIT.

This repository's own code is MIT (see [LICENSE](LICENSE); creator decision 2026-10-11, "Just keep it all MIT, yolo").
That covers games.fun's own code and art in `kits/`. Everything below keeps its own licence.

"In a game" means `create` copies it into the game folder; the game's own `ATTRIBUTION.md` then lists it (see "How a
created game carries its credits" in [CREDITS.md](CREDITS.md)).

## games.fun's kits (`kits/`)

A snapshot of the games.fun repository at the commit in `kits/KITS.json`, made by `scripts/sync-kits.mjs`. games.fun and
this kit have the same owner, so these are MIT under this repository's `LICENSE`.

| Kit | Version | In `kits/` | Licence | In a game |
|---|---|---|---|---|
| gf-three (the three.js game kit and its tools) | 0.1.0-dev | `research/gf-three/` | MIT (this repository) | kit part: yes (`gf/three/`); tools: no |
| gf-scenic (the scenic engine: WebGPU, generated islands and dungeons) | 0.1.0-dev | `research/gf-scenic/` | MIT (this repository); the folio-2025 code inside is a separate row below | scenic games: yes (`gf/scenic/`) |
| gf-multiplayer | 1.7.0 | `research/foundations/kits/gf-multiplayer/1.7.0/` | MIT (its `kit.json` and file headers) | yes (`gf/mp/`) |
| gf-audio | 1.5.0 | `research/foundations/kits/gf-audio/1.5.0/` | MIT (this repository); ZzFX inside is a separate row below | yes (`audio/`) |
| gf-assets | 1.3.0 | `research/foundations/kits/gf-assets/1.3.0/` | MIT (this repository) | yes (`gf/gf-assets.js`) |
| local signaling, validators, QA (signal server, asset-manifest validator, audio gate, Chrome launcher) | as synced | `research/multiplayer/`, `research/asset-manifest/`, `research/audio/`, `research/foundations/qa/`, `creator-studio/lib/` | MIT (this repository) | no |

## Code inside the kits

| # | What | Version | Licence | Licence text (path from the repository root) | Credit asked? | In a game |
|---|---|---|---|---|---|---|
| 1 | three.js (build) | 0.186.0 | MIT | `kits/research/foundations/trials/fps-arena/source/vendor/three/LICENSE` | keep the notice | yes, `vendor/three/` with its `LICENSE` |
| 2 | three.js addons (curated copy: loaders, utils, postprocessing, ...) | 0.186.0 | MIT | `kits/research/gf-three/tools/lib/vendor/three/LICENSE`; `kits/research/gf-scenic/tools/lib/vendor/three/LICENSE` | keep the notice | yes (only what the game imports) |
| 3 | three.js WebGPU build and TSL addons (scenic) | 0.186.0 | MIT | `kits/research/foundations/trials/third-person-adventure/source/vendor/three/LICENSE` | keep the notice | scenic games |
| 4 | Draco decoder (from three.js) | 0.186.0 | Apache-2.0 | stated in its `README.md` under `.../examples/jsm/libs/draco/`; the full Apache text is not beside it | keep notices | yes, with its README |
| 5 | Basis Universal transcoder (from three.js) | 0.186.0 | Apache-2.0 | stated in its `README.md` under `.../examples/jsm/libs/basis/`; the full Apache text is not beside it | keep notices | yes, with its README |
| 6 | meshoptimizer decoder (in three.js addons) | as in three 0.186.0 | MIT | header of `.../jsm/libs/meshopt_decoder.module.js` (Copyright (C) 2016-2026 Arseny Kapoulkine) | keep the notice | yes, inside the addons |
| 7 | fflate (in three.js addons) | as in three 0.186.0 | MIT | header of `.../jsm/libs/fflate.module.js` names MIT and links its LICENSE; no text beside it | keep the notice | yes, inside the addons |
| 8 | ktx-parse, zstddec (in three.js addons) | as in three 0.186.0 | not shown by the files | no licence text or header in the repository | see "Needs a person" | yes, inside the addons |
| 9 | @dimforge/rapier3d-compat | 0.19.2 | Apache-2.0 | `kits/research/foundations/trials/third-person-adventure/source/vendor/rapier/LICENSE` | keep notices | yes, `vendor/rapier/` with its `LICENSE` |
| 10 | pmndrs postprocessing | 6.39.5 | Zlib | `kits/research/foundations/trials/fps-arena/source/vendor/postprocessing/LICENSE.md` | notice kept; no credit needed | party games, `vendor/postprocessing/` |
| 11 | N8AO | as vendored | CC0-1.0 by the text beside it (earlier versions of this file said MIT; see "Needs a person") | `kits/research/foundations/trials/fps-arena/source/vendor/n8ao/LICENSE` | none (CC0) | party games, `vendor/n8ao/` |
| 12 | pmndrs/ecctrl (floating-capsule logic, ported) | `e2cab804` | MIT, (c) 2023-2026 Erdong Chen | `kits/research/gf-three/kit/controller/LICENSE-ecctrl`, `NOTICE-ecctrl` | keep the notice | yes, beside `capsule.mjs` |
| 13 | BUDDY: ROLLBACK (combat model, rewritten as data; nothing copied line for line) | `db51978` | MIT, (c) 2026 BUDDY: ROLLBACK contributors | `kits/research/gf-three/kit/mechanics/melee/LICENSE-buddy-rollback`, `NOTICE-buddy-rollback` | keep the notice | yes, beside the melee mechanic |
| 14 | three.js manual example `voxel-geometry-culled-faces-ui` (adapted into the voxel world's grid) | r186, `148ef33e` | BSD-3-Clause, (c) 2018 Google Inc. (from threejsfundamentals) | named in the header of `kits/research/gf-three/kit/world/voxel/grid.mjs`; the licence text it promises (`LICENSE-three-voxel` beside it) is not in the snapshot | keep the notice | voxel games (`gf/three/world/voxel/`); see gap 2 |
| 15 | folio-2025 by Bruno Simon (rendering, materials, lighting, terrain, vegetation, ported) | `41046b5` | MIT, (c) 2025 Bruno Simon | `kits/research/gf-scenic/kit/LICENSE-folio-2025` | keep the notice | scenic games, beside `gf/scenic/` |
| 16 | ZzFX (in gf-audio) | 1.3.2, adapted | MIT | `kits/research/foundations/kits/gf-audio/1.5.0/source/LICENSE-zzfx`, `ATTRIBUTION.md` | keep the notice | yes, `audio/LICENSE-zzfx` |
| 17 | ws (the signal server's WebSocket) | 8.21.3 | MIT | `kits/research/multiplayer/p2p/vendor/ws/LICENSE`, `../ATTRIBUTION.md` | keep the notice | no (Node side only) |
| 18 | Mannequin animation clips and `hero.glb` (stand-in body) | Quaternius, via pmndrs/ecctrl `e2cab804` | CC0-1.0 | `kits/research/gf-three/tools/lib/standin-assets/LICENSE-mannequin.txt` | none (credit is courteous) | yes, as the stand-in body |

Gap list from this table (each is a request to games.fun, where `kits/` is written; this repository never edits `kits/`):
rows 4 and 5 and 8 lack a full licence text; row 14 lacks `LICENSE-three-voxel`; row 11 needs a person.
The kit's own list is `kits/research/gf-three/kit/THIRD_PARTY.md`.

## Art (`kits/research/gf-three/library/` and `kits/research/gf-scenic/library/`)

Every library file has a record in that library's `LICENSES.json` (licence, author, source page, download, sha256 of the
source and of the shipped file, what was changed). The sync ships only CC0 and permissive licences, and never Meshy
output (its licence tier is unconfirmed). `tests/licensing.test.mjs` fails when a library file has no record.

| # | Source | Licence | Files | Credit asked? | In a game |
|---|---|---|---|---|---|
| A1 | Kenney (kenney.nl): props and textures | CC0-1.0 | 139 props + 28 textures | no | the ones the game uses |
| A2 | Quaternius (Universal Animation Library and character packs) | CC0-1.0 | 13 bodies + the shared clips (`clips/gf-humanoid-1.glb`) | no | the ones the game uses |
| A3 | games.fun (bean bodies, textures, previews) | CC0-1.0, or generated (previews, one noise texture) | 4 bodies + 10 textures + 19 generated | no | the ones the game uses |
| A4 | Kay Lousberg, KayKit (scenic library: dungeon props, weapons, 9 character bodies) | CC0-1.0 | 84 | no | scenic games |
| A5 | Poly Haven `leafy_grass` (stand-in ground) | CC0-1.0 | `tools/lib/standin-assets/grass.ktx2` | no | every party game's stand-in ground |
| A6 | folio-2025 models and textures as scenic props (`library/folio/`) | MIT (Bruno Simon), `library/folio/LICENSE` | 15 files | keep the notice | scenic games that use them |
| A7 | Poly Pizza creators (below) | **CC-BY-3.0** | **10 props** | **yes** | yes: soak-squad, the party example, carries 9 of them |
| A8 | Meshy AI "Cyborg gecko" | recorded as CC-BY-4.0 (plan unconfirmed) | **0 shipped**: the record is in `LICENSES.json`; the file is left out of this kit by the sync | yes, if it is ever shipped | no |

The ten CC-BY-3.0 props, each with the credit line exactly as the licence asks (author, title, a link to the work); the
licence is [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). They were resized to metres, recentred, joined per
material and meshopt-compressed (gltf-transform), which counts as a change:

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

The Meshy gecko's credit line, kept for the day it ships:

- "Cyborg gecko (Meshy)" by Meshy AI (generated for games.fun), CC BY 4.0 (https://www.meshy.ai)

The creator's count of 11 (2026-10-11, "keep them for now") is these ten plus the Meshy gecko record (A8), which is
CC-BY-4.0 and credits Meshy AI; its file is not in this kit.

Sounds are gf-audio presets, synthesised at run time: no audio files. The grim theme names two OFL-1.1 fonts (Grenze
Gotisch and Grenze, Omnibus-Type) but their files are not in the snapshot, so nothing is shipped; see "Needs a person".

## The example game

`templates/examples/soak-squad/` is adapted from "Bladder Brawl", a game games.fun's Studio v2 built and delivered
(same owner, MIT with the rest). It uses only library art, and 9 of the 10 CC-BY props.

`templates/examples/isle-run/` is games.fun's scenic sandbox spec, and `templates/examples/giant-four/` is the proof
game of games.fun's board mechanic and turns loop (same owner). Each uses only the library art of its engine.

## npm dependencies (`package.json`, pinned exactly; installed by `npm ci`, not committed)

| Package | Version | Licence | In a game |
|---|---|---|---|
| @modelcontextprotocol/sdk | 1.30.1 | MIT | no (tools only) |
| playwright-core | 1.63.0 | Apache-2.0 | no (tools only) |
| their dependencies (93 packages: express, hono, zod, ajv, ...) | as locked in `package-lock.json` | MIT (83), ISC (7), BSD-3-Clause (2), BSD-2-Clause (1) | no |

The licence texts of npm packages are in their folders under `node_modules/` after `npm ci`; the repository does not
commit them.

Installed on first use of `rig-check` or `meshy`, from `kits/research/gf-three/tools/lib/char-deps/package.json`
(tools only, never in a game): @gltf-transform/core, extensions, functions 4.5.1 (MIT), meshoptimizer 1.1.1 (MIT),
sharp 0.35.5 (Apache-2.0; its prebuilt libvips binaries are LGPL-3.0, dynamically linked), three 0.186.0 (MIT).

When Playwright's Chromium is downloaded (no Chrome or Edge on the machine), it comes under Chromium's own licences.

## Needs a person

Not settled from the repository itself:

1. **N8AO.** The licence text beside the vendored copy is CC0 1.0, but earlier lists in this repository and in
   games.fun's `kit/THIRD_PARTY.md` say MIT. The repository does not show which is the upstream's. Both are permissive;
   what a person should confirm is only the label. Also unconfirmed: the version.
2. **ktx-parse and zstddec** (inside the three.js addons): no licence text or header in the repository. They are the
   copies three.js 0.186.0 ships; confirm against that tarball.
3. **Draco and Basis Universal**: the repository states Apache-2.0 in their READMEs but has no copy of the full text.
4. **folio-2025 art** (A6): the record cites Bruno Simon's `license.md` (MIT, text beside the files). Whether the 3D
   models and textures in that repository fall under the same licence is something the MIT text alone does not say; a
   person should read the upstream repository's terms for its art.
5. **Quaternius bodies** fetched through Poly Pizza: each record says the Poly Pizza page showed "CC0 1.0" on the day
   it was retrieved; the repository keeps no copy of that page.
6. **The grim theme's fonts** (OFL-1.1): not in the snapshot; if they are added they bring OFL-1.1's own conditions
   (the licence text with the font; the font may not be sold by itself).
7. **Chromium** downloaded by Playwright and sharp's libvips (LGPL-3.0): not shipped by this repository; mentioned only.


## The loot program's source (`program/`)

games.fun's loot program 0.3 (the Solana program every economy runs on, devnet `88Labq6t…KXqM`), copied from games.fun
`launchpad/loot` at commit `66e896f97` and published with the kit under its MIT licence (creator decision 4,
2026-10-11/12; `program/LICENSE` is the same text). `program/README.md` says how to build it and check it against devnet.
Its Rust dependencies are not committed; `cargo` fetches them, at the versions in `program/loot/Cargo.lock`:

| Crate | Version | Licence | Used for |
| --- | --- | --- | --- |
| anchor-lang, anchor-spl | 1.1.2 | Apache-2.0 | the program framework and SPL token calls (in the deployed program) |
| ephemeral-rollups-sdk, ephemeral-vrf-sdk (MagicBlock) | 0.17.2 | MIT | asking MagicBlock's VRF oracle for randomness (in the deployed program) |
| magicblock-delegation-program-api, magicblock-magic-program-api | 3.1.0, 0.10.1 | MIT | pulled in by the MagicBlock SDK |
| solana-sha256-hasher | 3.1.0 | Apache-2.0 | ticket and terms hashes (in the deployed program) |
| litesvm | 0.10.0 | Apache-2.0 | the program's tests only |
| mpl-core (Metaplex) | 0.12.1 | Metaplex NFT Open Source License 1.0 (Apache-style, with restrictions on modifying Metaplex's code) | the program's tests only (building Core instructions); the deployed program calls Core through its own `core_cpi.rs` |
| solana-* crates, spl-token-2022-interface | 2.x to 3.x, 2.1.0 | Apache-2.0 | the program's tests only |
| borsh | 1.x | MIT OR Apache-2.0 | the program's tests only |

Not in `program/`: the upstream programs the tests load (`tests/fixtures/*.so`, dumped from devnet by
`scripts/fetch-fixtures.sh` onto the machine that runs them). The program data snapshots under `tests/fixtures/venue/`
and `tests/fixtures/v1/` are public devnet account bytes.

## The full simulation (`web3/economy/sim/`)

Nothing new is installed with the kit. On first use of `gamesfun economy simulate --full` (or `economy_simulate` with
`full: true`) it installs, into the user's cache folder (never the kit's `node_modules`, never into a game):

| Package | Version | Licence | How |
| --- | --- | --- | --- |
| litesvm (and its prebuilt native module, `litesvm-<platform>`) | 1.5.0 | MIT | the local Solana the simulation runs the real program in; Linux and macOS builds only |
| its dependencies (@solana/kit 8.4.0 and 42 small @solana packages, @solana-program/token and system) | as npm resolves them for litesvm 1.5.0 | MIT (49), Apache-2.0 (2) | used by LiteSVM's own wrapper; the kit's code does not import them |

It also reads, once, from devnet into the same cache folder, and runs locally: the loot program 0.3 (games.fun's own,
MIT, checked against the deploy record's sha256), Metaplex Core and Metaplex Token Metadata (Metaplex NFT Open Source
License 1.0), and MagicBlock's VRF program (Business Source License 1.1: copying and non-production use allowed, MIT
from 2029-12-01). None of these binaries is committed or shipped; a simulation on the user's own machine is
non-production use.

## web3 (`web3/`, `server/routes/web3.mjs`, `commands/web3.mjs`, `mcp/tools/web3.mjs`, `studio/tabs/{token,shop}.js`)

The Solana layer has **no runtime npm dependencies**. Its Solana code is written in the kit's own plain ES modules,
in `web3/gf-web3/chain/`. That covers base58, SHA-256, the ed25519 curve check, PDAs, Borsh, legacy and v0
transactions, the loot program (0.3, classic SPL and Token-2022 tokens), Metaplex Core, the Meteora DBC launch instructions and mint parsing. Node's own
`node:crypto` provides ed25519 and SHA-384. The kit adopts nothing from `@solana/web3.js`, which pulls in
`rpc-websockets` (LGPL-3.0-only).

| What | Where it is used | Licence | How |
| --- | --- | --- | --- |
| games.fun loot program 0.3 IDL (program `88Labq6t…KXqM`, devnet) and its client | `web3/gf-web3/chain/loot-idl.js`, `loot.js`, `borsh.js`, `token2022.js` | games.fun's own (MIT) | The IDL is games.fun `launchpad/loot`'s `anchor build` output (`target/idl/loot.json`) at commit `905eb7e63`, with doc comments removed. The client is ported from `client/codec.mjs` and `devnet-e2e-0.3.mjs` at the same commit, and checked against them byte for byte (`tests/web3-loot.test.mjs`). The transfer-hook resolution follows the spl-transfer-hook-interface account list and is checked against `@solana/spl-token` 0.4.15 (Apache-2.0), which is not a dependency |
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

