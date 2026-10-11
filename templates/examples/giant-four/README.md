# Giant Four (example)

Four in a row on a giant board that lies on the town square, for 2 to 4 players (alone, bots take the other seats).
Players take turns. On your turn, walk to a column and press E: your disc slides in. Four in a row wins. A full board
is a draw.

```bash
npx gamesfun create games/my-game --from giant-four
npx gamesfun dev games/my-game
```

What it shows:
- **A game that is not a party round.** The spec says `"loop": "turns"`: one player acts at a time, in order, with a
  clock for each turn (`round.params.turnSeconds`, 25 seconds). There is no round clock. The kit's other loops are in
  `npx gamesfun catalog loops`.
- **The board mechanic.** The grid, the discs, whose turn it is, a move refused with a reason ("Not your turn", a full
  column), the bots and the end of the game are the kit's `board` mechanic, configured in `spec.json` (7 by 6, discs
  that drop). `rules.js` is 20 lines: only what makes it four in a row (the `winner` rule).
- **The host owns the board.** A move is sent to the host, which plays or refuses it; every screen shows the same
  board and names the same next player.
- **Every colour and number is a slot.** The board's colours, the cell size, the turn clock and `rules.need` (how many
  in a row win): `npx gamesfun slots list games/my-game --all`. `npx gamesfun slots set rules.need 5` makes it five in a
  row with no code.

**Checks.** A fresh create passes 23 of the 24 checks of `verify --quick`. It fails one, check 7 (the audio gate), by
half a decibel: momentary loudness -32.5 LUFS against a floor of -32. The game is heard; it is quiet because one disc
landing is the loudest thing it ever does, and the gate's floor was set on rounds where many sounds overlap. The sound
levels are not raised to pass. games.fun is making the next version of the gate for games of single sounds; until the
kits carry it, `example.json` lists the check under `knownFailing` and the smoke test holds the verdict to exactly
that one failure.

Provenance: the board mechanic's proof game from games.fun's open builder (tracks M4-F and M4-C, 2026-10-11:
`research/open-builder/findings/m4c/giant-four-turns/`), spec and rules unchanged. Same owner as this kit
(THIRD_PARTY.md).
