### 4. Write the rules

`rules.js` holds only what makes this game this game; the kit already runs the lobby, players, bots, the round, results and replay, movement, the camera, friends drawn as characters, fair play, aiming, hits and the world. The hooks: `setup`, `roundStart`, `update`, `event`, `check`, `results`, `bot` (CONTRACT §3). Each mechanic's own notes and callbacks are in the `rules.js` stub `create` wrote for this game, and in `npx gamesfun catalog`.

Rules that hold for every game:

{{RULE:never-edit-kit}}
{{RULE:slots}}
{{RULE:host}}
{{RULE:menu-hud}}
{{RULE:mouse-camera}}
{{RULE:friends}}

Rules that hold when the game has the part they name:

{{RULE:fair}}
{{RULE:hits}}
{{RULE:world}}
{{RULE:cosmetics}}
{{RULE:backend}}
