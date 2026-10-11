# gf-three: the games.fun three.js kit

Every new games.fun game is built on this kit (Studio v2, `research/studio-v2/PLAN.md`). A game is a short `rules.js` plus JSON config on top of the kit. The kit supplies:
- characters friends can see;
- live multiplayer;
- a good-looking renderer and worlds;
- a library of party-game mechanics;
- assets that can all be swapped;
- one-command QA.

The API is in **[CONTRACT.md](CONTRACT.md)**. Read it before writing any kit code or any game.

## Layout and owners (wave 1; each track writes only its own folders)

```
research/gf-three/
├── README.md, CONTRACT.md     parent
├── kit/                       the kit's dev source, vendored into games as gf/three/
│   ├── core/                  K1: boot, loop, input, rng, observation, quality tiers, config
│   ├── assets/                K1: slot loader, coverage walk, slot declarations → assets.json
│   ├── controller/            K1: Rapier capsule controller, camera rigs
│   ├── net/                   K1: live rounds over gf/mp/net.js, players, shared entities, events
│   ├── ui/                    K1: HUD, lobby, results, touch controls
│   ├── bots/                  K1: bot players
│   ├── qa/                    K1: verify, contact sheet, coverage, perf
│   ├── mechanics/<id>/        K2: one folder per mechanic
│   ├── look/                  L: renderer, lighting, post, materials, presets
│   ├── world/                 L: world templates and layout loading
│   └── character/             C: gf-humanoid-1 runtime
├── library/                   L: curated CC0 props and textures (+ LICENSES.json); C: bodies and clips
├── lookdev/                   L: the look bench (served on 5791)
├── tools/                     K1: create.mjs, verify.mjs (13 checks), slots.mjs, catalog.mjs, serve.mjs, upgrade.mjs; dressing.mjs (set-dressing lint);
│                              loadouts.mjs (verify check 5's loadout leg alone); regress.mjs (the broken examples and the delivered-game corpus)
│                              C: rig-check.mjs, retarget.mjs, bean.mjs, meshy-character.mjs, optimize.mjs,
│                              cc0-bodies.mjs (CC0 library bodies from library/body-sources.json); meshy-prop.mjs (a generated prop)
├── regressions/               never again: one broken example per mistake the creator found (README.md there)
├── sandbox/                   K1: the dev-case game made by create (served on 5790)
└── tests/                     each track adds its own *.test.mjs
```

Frozen releases go to `research/foundations/kits/gf-three/<semver>/` and are immutable. The parent cuts 1.0.0 after wave 2.

## Rules

1. **Swap anything (PLAN §2.2).**
   - Every visible mesh, texture and tuning value is a slot.
   - No visible art is drawn in code; a generator bakes to a file slot.
   - `verify` fails any visible mesh without `userData.gfSlot`.
2. **Pinned:**

   | Library | Pin | Source |
   |---|---|---|
   | three.js | 0.186 (`build/three.module.js`, WebGLRenderer) | `trials/fps-arena/source/vendor/three` |
   | Rapier | `@dimforge/rapier3d-compat` 0.19.2 | `trials/third-person-adventure/source/vendor/rapier` |
   | pmndrs `postprocessing` | as vendored | `trials/fps-arena/source/vendor/postprocessing` |
   | N8AO | as vendored | `trials/fps-arena/source/vendor/n8ao` |

   Keep each LICENSE beside its copy. A new dependency needs a permissive licence and a line in `kit/THIRD_PARTY.md`.
3. **No build step.** Plain ES modules and an import map. A game is served as static files.
4. **Generic, not tuned to the test.**
   - The mechanics are the list in PLAN §2.1.
   - Nothing in the kit may exist only for a frozen eval case: no pee, no call centre, no token chart.
   - Those cases (`research/studio-v2/evals/cases/`) are the system's final exam. Builders don't read them.
5. **Kit copies are never edited in a game.** `gf/three/`, `gf/mp/` and `audio/` are vendored by `create` and checked by `verify`.
6. **Multiplayer is live by default** (`research/multiplayer/STANDARD.md` bar): friends in one game, in sync, each seen as a character. Never pause during a live round.
7. **Audio through gf-audio** (`research/foundations/kits/gf-audio/1.5.0`); sounds are listed in `assets.json` → `sounds` → `sounds` (verify check 18 fails a sound anywhere else).
8. **Evidence.** QA runs write to `<game>/evidence/<run>/`, and they are append-only.

## Upgrading a game

`node research/gf-three/tools/upgrade.mjs <game> [--out <dir>] [--world]` brings a game made on an older kit onto the current one: the vendored copies are refreshed, `rules.js` and every config value the game set are kept, the config the new kit expects is added with its defaults, and `assets.json` is regenerated (CONTRACT §6d). Then run `verify`. Kit fixes (fair play, aim at the crosshair, interact that works) reach delivered games this way. `upgrade.mjs <game> --plan` changes nothing and says whether the game is behind the kit and whether `--world` is for it; the Studio worker runs it, then the upgrade, before a change job's agent starts.

## Never again

Every problem the creator finds by playing becomes a broken example in `regressions/` that a verify check must fail (creator decision 2026-10-06). `node research/gf-three/tools/regress.mjs` runs them all (about 4 minutes on the GPU), and `--corpus` re-verifies every delivered game, upgraded in a scratch copy (`research/studio-v2/evals/corpus.json`). The no-browser part runs with these tests, and `tests/r-regressions.test.mjs` fails when verify, `tools/lib`, the kit or the examples changed after the last green run (`regress.mjs --record` writes `regressions/last-green.json`). How to add one: `regressions/README.md`.

## Ports

| Port | Use |
|---|---|
| 5790 | sandbox (K1) |
| 5791 | lookdev (L) |
| 5792 | character bench (C) |
| 5793 | mechanics fixtures (K2) |
| 5794–5795 | Studio v2 (S) |
| 5796–5797 | eval runs |

## Status

| Item | State |
|---|---|
| Wave 0b contracts | 2026-10-06 |
| Wave 1 | in progress |
