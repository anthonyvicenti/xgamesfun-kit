# Credits

The kit stands on other people's work. This page thanks them and gives the credit that some of their licences require.
The full, file-by-file list with licences is [THIRD_PARTY.md](THIRD_PARTY.md); how the licences work for you is in
[docs/LICENSING.md](docs/LICENSING.md).

## Art that asks for credit (CC BY 3.0)

Ten props from [Poly Pizza](https://poly.pizza), made by the people below and shared under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). They were resized to metres,
recentred, joined per material and compressed for the kit (changes, as the licence asks us to say). **A game that keeps
one of these files must keep its credit line.**

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

### An eleventh record: the Meshy gecko (not shipped)

The kit's library lists a "Cyborg gecko" body generated with Meshy, recorded as CC BY 4.0 with Meshy AI credited because
the plan it was made on is unconfirmed. Its file is left out of this kit by the sync, so no game made here carries it
today. If it is ever shipped, the credit line is:

- "Cyborg gecko (Meshy)" by Meshy AI (generated for games.fun), CC BY 4.0 (https://www.meshy.ai)

## Art and sound given freely (CC0, credit not required, given anyway)

- [Kenney](https://kenney.nl): 139 props and 28 textures (CC0).
- [Quaternius](https://quaternius.com): character bodies and the Universal Animation Library clips and mannequin (CC0).
- [Kay Lousberg, KayKit](https://kaylousberg.com): the dungeon props, weapons and character bodies of the scenic
  library (CC0).
- [Poly Haven](https://polyhaven.com): the stand-in ground texture, `leafy_grass` (CC0).
- games.fun: the bean bodies and the procedural textures (CC0).

## Code and art under MIT and other permissive licences

- [three.js](https://threejs.org) (MIT) and the Draco and Basis Universal decoders it ships (Apache-2.0), including the
  meshoptimizer decoder (Arseny Kapoulkine, MIT), fflate (MIT), ktx-parse and zstddec.
- [Rapier](https://rapier.rs) by Dimforge (Apache-2.0), the physics.
- [pmndrs](https://github.com/pmndrs): postprocessing (Zlib), and ecctrl by Erdong Chen (MIT), whose floating-capsule
  character logic is ported here.
- N8AO (ambient occlusion; its licence text in the repository is CC0).
- [folio-2025](https://github.com/brunosimon/folio-2025) by Bruno Simon (MIT): the scenic engine's rendering, materials,
  lighting, terrain and vegetation are ported from it, and some of its models and textures are scenic props.
- [BUDDY: ROLLBACK](https://github.com/octobooth-4/buddy-rollback) by its contributors (MIT): the combat model of the
  melee mechanic.
- The three.js voxel example by Google Inc. and threejsfundamentals (BSD-3-Clause), adapted into the voxel world.
- [ZzFX](https://github.com/KilledByAPixel/ZzFX) by Frank Force (MIT), the sound engine inside gf-audio.
- [ws](https://github.com/websockets/ws) (MIT), for the local signaling server.
- The npm packages the tools use (the Model Context Protocol SDK, Playwright) and their dependencies, all permissive;
  see THIRD_PARTY.md.

## How a game made with the kit carries these credits

If your game keeps a credited file, it must keep the credit. Today:

- `create` writes an `ATTRIBUTION.md` into every game, listing each library file the game uses with its licence and
  author, and each code library with where its licence text sits. The licence texts of three.js, Rapier,
  postprocessing, N8AO, ecctrl, the melee model, folio-2025 (scenic) and ZzFX are copied into the game beside the code.
- **That `ATTRIBUTION.md` is not yet enough for CC BY.** For a CC-BY file it prints only the licence name and the
  author ("CC-BY-3.0, J-Toastie"). The licence also asks for the title and a link to the work, and a link to the
  licence. The exact lines are in the library's `LICENSES.json` (`credit`), but `create` does not copy them.
- Nothing shows a credit to a *player* either; a game published with a CC-BY prop should show its credit lines somewhere
  a player can find them (a credits screen, the page, or the post). The kit has no credits screen yet.
- The kit's own MIT licence text is not copied into games next to the `gf/` code (see below).

These are gaps in `create`, which is written in games.fun. The request to games.fun is in
[docs/LICENSING.md](docs/LICENSING.md), section "Requests to games.fun".

If you ship your game, keep `ATTRIBUTION.md` with it, and add the credit lines above for any CC-BY file you kept.
