# gf-vista (working name): the super scenic engine

Plan of record: `research/super-scenic/PLAN.md` (creator decisions 2026-10-12: route A, the clouds are safe to use,
WebGPU only). The fifth engine, for calm games where the place is the point: a physical sky and light, a simulated
ocean, volumetric clouds. Golden reference: Tidewater at 4811ba48 (frozen eval case T7).

```
core/      Tidewater's engine, vendored (UPSTREAM.json, LICENSE, ATTRIBUTION.md, CREDITS.md, PATCHES.md)
kit/       host.js (boots the core; ui: false builds none of its DOM), gpu.js (probe, MIN_LIMITS, the no-WebGPU screen),
           look.js (six presets; hour, sea, exposure, clouds), observe.js (window.__game), config.js (worlds, looks, slots),
           tables/ (spec.vista: species, gear, vendors, economy, start), game.js (the core's fishing under our names),
           audio.js + sounds.json (the soundscape on gf-audio), bodies.json (six Rocketbox bodies), humanoid.js +
           humanoid-rig.js (gf-humanoid-1 bodies skinned by the core), players.js (friends through gf/mp), meshopt.js
hud/       vista's HUD parts (money, cooler, rod, bite, tension, catch card, stall panels)
specs/     thin-cove.spec.json (Lantern Cove, the system proof)
sandbox/   core-view/ (the core alone, for the frame comparison; ?noui), humanoid/ (a body walking the pier; serve research/),
           fishing/ (track G: the fishing loop with our HUD),
           pier/ (the golden sandbox's first page: two players, live gf/mp 1.7.0; gf/vista, gf/core, gf/bodies and
           gf/clips are symlinks so the multiplayer gate and serve.mjs can serve it from its own folder)
briefs/    forge-wiring-map.md (every place forge plugs into the shared system: the wave 2 track S list)
tools/     serve, ref-capture (reference shots + frame times), frame-compare, img, gpu-screens, gpu-limits, look-live,
           humanoid-fixture, two-players, fish-loop, rocketbox/ (the body conversion)
tests/     tables, sounds, words (node --test research/gf-vista/tests/*.mjs)
```

## Run

```bash
node research/gf-vista/tools/serve.mjs research/gf-vista 5961     # http://127.0.0.1:5961/sandbox/core-view/
node research/gf-vista/tools/serve.mjs research/super-scenic/reference-build/src/dist 5960   # the reference build
node research/gf-vista/tools/frame-compare.mjs                    # the vendoring proof (both servers up)
node research/gf-vista/tools/ref-capture.mjs --out <dir> --dt 0.016666667 --frames 360 [--bench]   # a look pack
node research/gf-vista/tools/serve.mjs research 5962               # /gf-vista/sandbox/humanoid/ (bodies from the libraries)
node research/multiplayer/party/serve.mjs research/gf-vista/sandbox/pier --port 5963   # two players: /gf/mp/ to host or join
node research/gf-vista/tools/humanoid-fixture.mjs                 # bodies vs rig.js
node research/gf-vista/tools/two-players.mjs                      # host + joiner over WebRTC (server on 5963 up)
```

The reference build is made once from the local mirror (not committed; see research/super-scenic/README.md).
WebGPU in headless Chrome on this machine: `launchChrome({gpu: 'webgpu'})` (chrome-headless-shell on Vulkan) gets the
RTX 5090 with compute; nothing else is needed.

## Status

- Wave 0 (2026-10-12): the reference build on 5960, the reference pack (`research/super-scenic/reference/`), T7.
- Wave 1 (2026-10-12, done; record `research/super-scenic/evidence/wave1-2026-10-12.json`): the core vendored with
  one patch, frame comparison 34/34 bit-identical; look slots (hour, sea, exposure) swapped live; the core's minimum
  WebGPU limits and the kit's screen below them; gf-humanoid-1 bodies skinned by the core within 0.28 mm of rig.js;
  two players over gf/mp who see each other (14/14; the shared gate 23/24, soft on-screen check only). Not done: the
  low-tier frame times (no low-tier device here), the friend's boat (wave 4), swim and upper-body clips.
- Thin end-to-end wave (2026-10-12, `research/super-scenic/THIN_E2E.md`): `spec.engine: "vista"` through create, the
  shared boot (menu, HUD, session), verify (`tools/verify-vista.mjs`: 16 required checks, 10 "not yet for vista"), the
  catalog and the pitch, closed behind `GF_VISTA_OPEN=1`. Tracks G (the core's fishing under our names, audio on
  gf-audio, HUD; fish-loop 21/21), C (six Rocketbox bodies) and S (the system) merged. Lantern Cove verify 16/16.
  T7 ran twice through the whole loop (`research/super-scenic/evidence/t7-run1-…`, `t7-run2-…`): both delivered with
  an honest "Not yet the game you asked for"; run 2 in 26.7 min (run 1: 44.7); seven system fixes came from them.

## Make a vista game (closed to creators until the creator opens it)

```bash
node research/gf-three/tools/create.mjs research/gf-vista/specs/thin-cove.spec.json <out-dir>
node research/gf-three/tools/verify.mjs <out-dir>
node research/multiplayer/party/serve.mjs <out-dir> --port 5963     # /gf/mp/ to host or join (a WebGPU Chrome)
```
