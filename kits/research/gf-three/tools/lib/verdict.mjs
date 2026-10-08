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

/** The checks a full verify must run and pass: 1–8 and 10–17. 9 (the contact sheet) counts only when it ran. */
export const REQUIRED = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17];

export function passes(checks, required = REQUIRED) {
  const core = checks.filter(c => c.n !== 9);
  return required.every(n => core.some(c => c.n === n)) && core.every(c => c.ok) && checks.filter(c => c.n === 9).every(c => c.ok !== false);
}
