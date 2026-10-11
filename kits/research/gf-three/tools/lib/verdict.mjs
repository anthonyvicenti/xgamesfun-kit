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

/** Every check of a round game, as a release run holds it (regress.mjs --corpus; verify --release): 1–8, 10–25, 31 and
 *  34. 9 (the contact sheet) counts only when it ran. A build's own verify requires these less RELEASE_ONLY. */
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
export function passesForge(checks, required = REQUIRED_FORGE) {
  const core = checks.filter(c => !c.notYet);
  return required.every(n => core.some(c => c.n === n && c.ok === true)) && core.every(c => c.ok !== false);
}

/**
 * The checks that test the kit, not the game: no rules.js or config a build agent writes can fail them
 * (research/game-templates/ai-studios-2026-10-10/findings/verify-our-numbers.md, claim 2: 8 the swap proof, 31 sharp
 * on every screen, 34 watch then play). They run per release (verify --release, which regress.mjs --corpus passes),
 * and a build's own verify neither runs nor requires them. 2 and 25 stay in every build: a game can fail both.
 * Their home in tools/lib/homes.json is "invariant" with run "release".
 */
export const RELEASE_ONLY = [8, 31, 34];
const LISTS = { round: REQUIRED, world: REQUIRED_WORLD, forge: REQUIRED_FORGE };
/** The checks a verify of this kind of game must run and pass: a build's (the list less RELEASE_ONLY) or a release's. */
export function requiredFor(kind = 'round', { release = false } = {}) {
  const all = LISTS[kind] ?? REQUIRED;
  return release ? all : all.filter(n => !RELEASE_ONLY.includes(n));
}
/** Is check n run in this verify? Every check in a release run; in a build's run all but RELEASE_ONLY. */
export const runsHere = (n, { release = false } = {}) => release || !RELEASE_ONLY.includes(n);

/**
 * A profiled run (verify --profile <file>, e.g. a CI runner with no graphics card) skips checks by name and reason.
 * It can be green for what it ran and is never a pass: `passes` stays false while a required check is skipped.
 * → true when every required check that was not skipped by the profile ran and passed, and nothing failed.
 */
export function profilePasses(checks, required = REQUIRED) {
  const core = checks.filter(c => c.n !== 9 && !c.notYet);
  const skipped = new Set(core.filter(c => c.ok === null && c.skippedBy === 'profile').map(c => c.n));
  return required.every(n => skipped.has(n) || core.some(c => c.n === n && c.ok === true))
    && core.every(c => c.ok === true || skipped.has(c.n)) && checks.filter(c => c.n === 9).every(c => c.ok !== false);
}

/**
 * The shape of a profile file (verify --profile): {name, environment?: {VAR: value}, skip: [{check, reason, legs?}],
 * run?: [n…] (for the reader; must not name a skipped check)}. `legs: "lobby"` is for check 5 alone: the gate's lobby
 * legs still run. → the problems (empty: the profile is well formed)
 */
export function checkProfile(p) {
  const out = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['a profile is a JSON object'];
  if (typeof p.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.name)) out.push('name must be a short lower-case id (ci-software)');
  if (p.environment !== undefined && (typeof p.environment !== 'object' || p.environment === null || Array.isArray(p.environment) || Object.values(p.environment).some(v => !['string', 'number'].includes(typeof v)))) out.push('environment must map variable names to strings');
  if (!Array.isArray(p.skip)) return [...out, 'skip must be a list of {check, reason}'];
  const seen = new Set();
  for (const s of p.skip) {
    if (!Number.isInteger(s?.check) || s.check < 1) { out.push(`skip: ${JSON.stringify(s)} has no check number`); continue; }
    if (seen.has(s.check)) out.push(`skip names check ${s.check} twice`);
    seen.add(s.check);
    if (typeof s.reason !== 'string' || s.reason.trim().length < 8) out.push(`skip ${s.check} needs its reason (a skipped check is recorded with it)`);
    if (s.legs !== undefined && !(s.check === 5 && s.legs === 'lobby')) out.push(`skip ${s.check}: legs can only be "lobby", on check 5`);
  }
  for (const n of Array.isArray(p.run) ? p.run : []) if (seen.has(n)) out.push(`check ${n} is in run and in skip`);
  return out;
}

export function passes(checks, required = REQUIRED) {
  const core = checks.filter(c => c.n !== 9);
  return required.every(n => core.some(c => c.n === n)) && core.every(c => c.ok) && checks.filter(c => c.n === 9).every(c => c.ok !== false);
}
