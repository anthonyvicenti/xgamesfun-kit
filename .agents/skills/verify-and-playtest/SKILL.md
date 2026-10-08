---
name: verify-and-playtest
description: Prove a gf-three game works - run gamesfun verify (real Chrome, real input, two players over WebRTC) until every required check passes, fix failures with the right lever, answer the look questions, and play-test it black box like a new player with screenshots. Use before calling a game done, after any change, or when someone reports that something doesn't work.
---

# Verify and playtest

A game is done when `verify` passes on the files you deliver **and** a player can see every promise on their own
screen. A green verify is the kit's bar, not the person's verdict: report honestly.

## Verify

```bash
npx gamesfun verify games/<name> --quick        # about 2 minutes; prints PASS/FAIL per check, then one verdict
npx gamesfun verify games/<name> --check 13     # one check alone (10, 13, 14, 15, 16; or static 11, 17, 11,17)
```

Chrome: `CHROME_PATH`, else an installed Chrome or Edge, else Playwright's Chromium (downloaded once). Evidence:
`games/<name>/evidence/verify-N/verdict.json` and screenshots (append-only). Exit code 0 means it passed.

| Fails | Usual cause | Lever |
|---|---|---|
| 1 manifests | config added without regenerating | `npx gamesfun slots write games/<name>` |
| 2 kit copies | something under `gf/`, `audio/`, `vendor/` changed | `npx gamesfun upgrade games/<name>` puts the kit's copies back (keeps rules and config) |
| 3 boots | an exception in `rules.js` | the console error in the detail; fix the code |
| 4 coverage | a mesh drawn in code | make it a slot (a prop, a mechanic param); never draw art in code |
| 5 two players | shared state decided on a non-host copy | `if (ctx.host)`, `ctx.shared`, events on edges (skill `multiplayer`) |
| 6 results | the round never ends or replay breaks | `check()` returns null or `{winners, reason}`; reset state in `roundStart` |
| 7 audio | silent or too loud | sounds come from `assets.json` → `sounds` presets; don't add oscillators |
| 10 fair play | stun-locks, bots ganging up | score only in `onHit`/`onDamage`; bots via `ctx.bots.target`/`attack`; leave `fair` on |
| 11 set dressing | props overlapping, floating, clutter | `config/world.json` → `props` (`at`, `rot`, `scale`), `spawns`; the detail names each with its fix |
| 12 nothing happens | scores never move | the scoring path in `rules.js`, and bots that actually play |
| 13 controls | a listed control does nothing visible | use the mechanic's own `fire`/`stream`/E; or remove the control from `config/game.json` → `controls` |
| 14 looks | a generated look is still a stand-in; two roles share a body | give each role its own library body, or generate it |
| 15 loop alive | a mechanic never shows life; the goal is unreadable | make the rules use it; waves `target` is a zone name; goal in the `centre` zone |
| 16 hits read | one-hit kills | keep projectile `damage` below waves `hp` |
| 17 world | wrong size, open walls, no doors | keep the generated world; set the spec's `world.size`; never remove walls or the ceiling |

Run the whole `--quick` once more after your last edit. Don't change a check, its thresholds or the kit to pass.

## The look, in eight questions

From the screenshots in the evidence folder (or your own from `play`), answer yes or no; fix every "no" in
`config/*.json` and slots, never in code or the look preset:
1. Does the ground read as a surface (pattern visible, players lighter or darker than it)?
2. Can you see every player colour, its paint and the stream on the ground?
3. Is the floor free of litter (no loose small things, no scenery that looks collectable)?
4. Does every prop stand cleanly (no overlap, float, sink, tilt; seats face something)?
5. Is the layout purposeful (props along edges and in groups, open floor in the middle)?
6. Is everything to scale with a 1.7 m character (benches hip high, pickups about a third of its height)?
7. Do the shots show the game (no camera inside or behind a wall or prop)?
8. Does every player start on open floor, inside the play area, facing the middle?

## Play-test, black box

Play it as a new player would, judging only what is on screen:

```bash
npx gamesfun promises games/<name>                       # what the game promises (controls, loop, mechanics, hook)
npx gamesfun play games/<name> --out games/<name>/scratch/play-1 --steps '[{"do":"start","bots":3,"seed":1,"round":40},{"do":"shot","name":"first-look"},{"do":"hold","key":"Mouse","seconds":2,"shot":"firing"},{"do":"press","key":"KeyE","shot":"after-e"},{"do":"until","phase":"results","timeout":90},{"do":"again"}]'
```

`play` prints one line per step (phase, clock, score, HUD) and saves screenshots of the player's own view; **look at
them**. Steps: `start`, `hold`, `press`, `move` (`forward`, `left`, ...), `look` (`dx`, `dy`), `wait`, `shot`, `snap`,
`until`, `again`, `click`. A plan: first look (can I tell which one is me?), each HUD control (looking ahead, then a
little down), the core loop once, getting hit and getting up, a short round to the end and play again.

A promise passes only when a screenshot or the log shows it happening because of what you did. If your agent can start
a fresh subagent, give it only the promises and the `play` command (never the code) and let it judge: an author tests
what they meant, a new player tests what is there.

## Two players

Open the friends lobby twice (skill `multiplayer`): host in one tab, join from the other, play a round. Both screens
must show the other player where they really are.

## Report

Say what passed, what failed and why, what the person will see, and what you left out. Never report a check you
didn't run.
