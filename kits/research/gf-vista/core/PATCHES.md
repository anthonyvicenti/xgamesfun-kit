# gf-vista core patches

Every change to the vendored Tidewater source (`UPSTREAM.json`: 4811ba48). Each edit in the code carries the marker
`gf-vista:` naming the patch number here, so a later upstream version can be vendored and these replayed. The build
agent never edits the core (PLAN §7); only the core track does, and adds a row here.

| # | Files | What | Why |
|---|---|---|---|
| 1 | new `src/vista-io.js`; `audio/SoundScape.js`, `engine/loaders/GLTF.js`, `game/Chandlery.js`, `game/FishStand.js`, `game/StallKit.js`, `post/AntiAlias.js`, `sky/SkyProClouds.js`, `world/debris/ScannedDebris.js`, `world/marine/Whale.js`, `world/marine/WhaleTextures.js` | The 8 uses of Vite's `import.meta.env.BASE_URL` read `assetBase()`; the 10 `fetch()` calls of game files go through `vistaFetch()`. With no reader set, `vistaFetch` is `fetch` and the base is the host's (`kit/host.js` sets `core/public/`). | The core runs as plain ES modules with no build (our no-build rule), from any sub-path, and a game can read every file through gf-assets (Studio's swaps and overrides, a packed page) by `setReader()`. Each file got one import line. |
| 2 | `audio/SoundScape.js` | `routeSoundScape({ context, output })`, a module-level route set before the first `resume()`: the soundscape builds its graph in that context and its limiter ends in `output` instead of `ctx.destination`; `dispose()` then disconnects instead of closing a context it doesn't own. Unset (the reference, core-view, every frame comparison), nothing changes. | Games play the core's soundscape through the shared gf-audio kit (`kit/audio.js`: its sfx bus, master, player volume, mute, limiter, hidden-tab silence; CLAUDE.md audio rules: nothing but the kit connects to the speakers). Track G, thin end-to-end wave, 2026-10-12. |
| 3 | `game/StallKit.js` | The sign atlas texture (`stallSigns`) is created with `copySrc` usage too (`arrayTexture` takes extra usages). | A game paints its own stall signs over upstream's names (`kit/game.js` writes the same texture from its tables) and a check reads the texture back to prove what the stalls draw (`tools/fish-loop.mjs`). A usage flag changes no pixel. |
| 4 | `game/GameState.js` | `SAVE_KEY` exported (no other change). | The kit's game bridge maps the core's browser save to the game's own key; importing the constant keeps the upstream name out of kit code. |
| 5 | `App.js`, `vista-io.js` | `SkyProClouds` is imported on demand (`await import`) instead of at the top, and `vista-io.js` gains `setClouds('volumetric' \| 'basic')` / `cloudsChoice()`; 'basic' draws the core's own `sky/Clouds.js` (as `?oldClouds` did). The default is unchanged. | The open-source kit ships without the sky-pro-webgpu files (their notice speaks of a separate licence; the creator chose the MIT clouds for the kit, 2026-10-12), and the core must still run there. |

Removed from the vendored tree (not patches): `public/ui/` (upstream key art). Upstream's `index.html`, `vite.config.js`,
`package*.json`, `test/`, `tools/` and `docs/` are not vendored (the mirror has them).

Unchanged on purpose in wave 1, so the frame comparison holds: the upstream UI (`src/ui/`) and game layer (`src/game/`)
still show upstream's names; the sandbox uses them, games will not (wave 2 track S puts the shared menu and HUD in
front, wave 4 ports fishing as a generic mechanic).

Thin end-to-end wave (track G, 2026-10-12): games boot with `ui: false`, and the game layer is driven by `kit/game.js`
without further core edits: the tables go into the core's table objects in place, the save key is mapped by a storage
wrapper, the core's Game gets a HUD adapter (so it never builds upstream's HUD, minimap or first-play guide), vendor
names and greetings are set from the tables, and the sign texture is painted over from the tables. The frame comparison
after patches 2 and 3: 34/34 shots bit-identical (PSNR 99 dB, 0 % of pixels over tolerance).
