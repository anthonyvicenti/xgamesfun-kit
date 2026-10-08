# {{TITLE}}

{{HOOK}}

A multiplayer three.js game on games.fun's gf-three kit, made with gamesfun-kit. **The playbook is `{{KIT}}/AGENTS.md`**
(the kit root): read it first. If this folder was moved out of the kit, the playbook is AGENTS.md in the gamesfun-kit
repository.

- Mechanics: {{MECHANICS}}
- Controls: {{CONTROLS}}
- World: {{WORLD}}

## Files

| File | Who edits it |
|---|---|
| `rules.js` | you: this game's own rules (`{{KIT}}/kits/research/gf-three/CONTRACT.md` §3) |
| `config/*.json` | you: tuning; every number and colour is a slot (`config/game.json` → `rules.params` for the game's own) |
| `assets/` | through their slots only: `npx gamesfun slots set <id> --file <path>` |
| `spec.json` | the locked spec this game was made from; change it when the plan changes |
| `assets.json` | generated from the slot declarations: `npx gamesfun slots write {{GAME}}` after adding a prop, mechanic, rules param or file |
| `multiplayer.json` | mode `live`: friends in one game, each seen as a character |
| `gf/`, `audio/`, `vendor/`, `index.html`, `main.js`, `gf-three.json` | the kit's: **never edit** (verify check 2) |
| `evidence/` | verify's records: append-only |

## Commands (from the kit root)

```bash
npx gamesfun dev {{GAME}}                 # the studio, live reload, two tabs play together on /game/gf/mp/
npx gamesfun verify {{GAME}} --quick      # must pass before you call it done
npx gamesfun verify {{GAME}} --check 13   # one check alone while you fix it
npx gamesfun slots list {{GAME}}          # the main slots; --all for every one
npx gamesfun promises {{GAME}}            # what the game promises a player (the play-test list)
```
