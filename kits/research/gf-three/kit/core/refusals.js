// gf-three refusals: what the kit will not do for a game's code, said at the call. A misuse the kit can see is refused
// here with a stable code, written to console.error (verify check 3 reads it, so the build agent sees the message) and kept
// in a bounded list that window.__game.snapshot().refusals returns:
//
//   refuse(code, message, key?)   → { code, message, count, first, last }   (the same code+key counts up, logs once)
//   list()                        → a copy of the list, oldest first, at most MAX entries
//   clear()                       → forget them (tests)
//
// The codes:
//   players-add-with-friends   ctx.players.add / remove / place in a friends round (the room decides who plays)
//   sound-unlisted             ctx.audio.play of an id assets.json → sounds → sounds does not list
//   slot-unknown               ctx.assets.tag of an id assets.json does not declare
//   shared-write-not-host      a write to ctx.shared from a copy that is not the host (top level or nested)
//   goal-too-short             ctx.ui.goal / text.goal under 6 characters (the HUD and How to play need a sentence)
//
// Pure, no imports: Node loads it for tests.
export const MAX = 50;
export const CODES = ['players-add-with-friends', 'sound-unlisted', 'slot-unknown', 'shared-write-not-host', 'goal-too-short'];
const entries = new Map();
let t0 = Date.now();
const since = () => Math.round((Date.now() - t0) / 100) / 10;

export function refuse(code, message, key = '') {
  const k = `${code}|${key}`;
  const e = entries.get(k);
  if (e) { e.count++; e.last = since(); return e; }
  const rec = { code, message, count: 1, first: since(), last: since() };
  if (entries.size >= MAX) entries.delete(entries.keys().next().value);
  entries.set(k, rec);
  console.error(`gf-three refused [${code}]: ${message}`);
  return rec;
}
export const list = () => [...entries.values()].map(e => ({ ...e }));
export function clear() { entries.clear(); t0 = Date.now(); }

// ---- the goal line ----
export const GOAL_MIN = 6;
const goalLen = t => String(t ?? '').trim().length;
/** ctx.ui.goal(t): null/undefined gives back the game's own line; anything else must be a sentence. → true: set it */
export function goalCall(t) {
  if (t === null || t === undefined) return true;
  if (goalLen(t) >= GOAL_MIN) return true;
  refuse('goal-too-short', `ctx.ui.goal(${JSON.stringify(String(t))}): the goal line needs ${GOAL_MIN} characters or more (one short sentence saying what to do); the previous line stays`, String(t));
  return false;
}
/** The line the HUD starts with: text.goal, else the next candidate; a text.goal under GOAL_MIN is refused. */
export function startGoal(game) {
  const g = game.text?.goal;
  const rest = [game.round?.winBy, game.rules?.summary, game.text?.hook, game.hook];
  if (g && goalLen(g) < GOAL_MIN) {
    refuse('goal-too-short', `config/game.json → text.goal is ${JSON.stringify(String(g))}: the goal line needs ${GOAL_MIN} characters or more (one short sentence saying what to do)`, String(g));
    return rest.find(x => x && goalLen(x) >= GOAL_MIN) || g;
  }
  return g || rest.find(Boolean) || '';
}
