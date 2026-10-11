// verify's pass rule (CONTRACT §5), on its own so a unit test can hold it (research/gf-three/regressions/verdict-rule).
//
// Twice a change to verify broke this rule while every check still read "ok": wiring check 11 left the old rule
// ("exactly 9 core checks") in place, so every verdict failed with all checks passing (fixed in 2067b7c37; the worker's
// repair message said only "verify failed"). The rule now names its required checks, and adding a check means adding
// its number here and a row to CONTRACT §5 (tests/r-regressions.test.mjs compares the two).
//
//   passes(checks) → true when every required check ran and passed, no other check failed, and check 9 (the contact
//   sheet) did not fail: it counts only when it ran (--quick skips it, which is ok: null).
//   checks: [{n, ok}] as verify records them (ok true | false | null for skipped)

/** The checks a full verify must run and pass: 1–8 and 10–25. 9 (the contact sheet) counts only when it ran. */
export const REQUIRED = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 31, 34];

/** A world (CONTRACT §9, tools/verify-world.mjs): no rounds, so 6, 10, 12, 15, 16, 17 and 23 have a world's
 *  equivalents instead (26 persists, 27 the host leaves, 28 the spawn square holds, 29 sign words, 30 phones). */
export const REQUIRED_WORLD = [1, 2, 3, 4, 5, 7, 8, 11, 13, 14, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 34];

/**
 * The forge engine (CONTRACT §8 forge, tools/verify-forge.mjs): the checks that apply through the observation
 * interface, and two of forge's own: 32 (no WebGPU: the kit's "open in your browser" screen, never a blank canvas) and
 * 33 (a lost GPU device is recovered). Since track S (live co-op): 5 (the gate, the loadout leg and forge's sight leg),
 * 6 with its two-player half, and 25. Track R (research/gf-forge/lookdev/forge-checks.mjs): 19 runs on forge (the model
 * judge, with forge's poses and GPU skinning held to rig.js), and 9 (the forge capture's sheet and perf) counts when it
 * ran, as on gf-three. Track F (tools/lib/forge-feel-check.mjs): 16 (hits read; a game with no weapon passes as not
 * applicable) and 10's feel half (the evade and death are the only ways control goes). Track A: 11 and 17 (the forge
 * world lint, gf/forge/arena.js) and 12 (a round with forge bots). Since the wave 1b integration every numbered check
 * up to 33 applies; mechanic modules and 34 (watch then play, CONTRACT §9b) are not yet for forge.
 */
export const REQUIRED_FORGE = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 31, 32, 33];
/** What cannot apply to a forge game yet, and why: recorded "not yet for forge" (ok: null), never counted as passed. */
export const NOT_YET_FORGE = {
  mechanics: 'no mechanic module runs on forge yet (tracks F and A); their params stay in config/game.json for the rules',
  34: 'a forge game offers no Go live yet: the boot does not stream a round or draw a viewer\'s camera (CONTRACT §9b is gf-three and worlds only)',
};
/** The forge pass rule: every REQUIRED_FORGE check ran and passed, no other check failed; not-yet checks never count. */
export function passesForge(checks) {
  const core = checks.filter(c => !c.notYet);
  return REQUIRED_FORGE.every(n => core.some(c => c.n === n && c.ok === true)) && core.every(c => c.ok !== false);
}

export function passes(checks, required = REQUIRED) {
  const core = checks.filter(c => c.n !== 9);
  return required.every(n => core.some(c => c.n === n)) && core.every(c => c.ok) && checks.filter(c => c.n === 9).every(c => c.ok !== false);
}
