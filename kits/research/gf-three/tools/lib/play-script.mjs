// The step language of tools/play.mjs (the play-tester's harness): parse and check a script before any browser starts,
// so a bad script costs nothing. Pure; tests in tests/pt-play-script.test.mjs.
//
// A script is a JSON array of steps (or {"steps": [...]}). Seconds are wall-clock seconds of play.
//
//   {"do":"start", "bots":3, "seed":1, "round":60}   open the game (always first; added when missing), the lobby, Play,
//                                                     then a click on the game takes the mouse. round: the round's
//                                                     length in seconds for this run (20–900), else the game's own
//   {"do":"hold", "key":"Mouse", "seconds":2, "shot":"firing", "look":{"dx":200}}
//                                                     hold one key (or "keys":[...] together) for N seconds; "shot" takes
//                                                     a screenshot just before letting go; "look" turns while holding
//   {"do":"press", "key":"KeyE", "times":1}           tap a key (or a mouse button)
//   {"do":"move", "dir":"forward", "seconds":1.5}     walk: forward | back | left | right, or "keys":"WD"; "sprint":true
//   {"do":"look", "dx":300, "dy":-40}                 turn the camera by mouse pixels (about 600 px is a quarter turn)
//   {"do":"wait", "seconds":3}
//   {"do":"shot", "name":"first-look"}               a screenshot of my own view
//   {"do":"snap", "name":"after-drink"}              the observation, trimmed: phase, time, players, the HUD text
//   {"do":"until", "phase":"results", "timeout":120}  wait until the round reaches a phase
//   {"do":"again"}                                    press "Play again" on the results card
//   {"do":"click", "x":640, "y":360}                  click a point on the screen (a button I can see)
// A phone (the forge play-tester, research/studio-v2/prompts/playtest-forge.md): {"do":"start", "touch":true} opens the
// game on a touch screen (play.mjs --size 390x844 or 844x390 picks the phone's size); then fingers, not keys:
//   {"do":"tap", "x":320, "y":700, "seconds":0.1, "shot":"fired"}     one finger down and up (hold it with "seconds")
//   {"do":"drag", "from":[90,700], "to":[90,620], "seconds":1.5, "with":{"from":[300,400], "to":[240,400]}, "shot":"walking"}
//                                                     a finger pressed at "from", slid to "to" and held there until
//                                                     the seconds are up (a stick pushed, a look swiped); "with" is a
//                                                     second finger at the same time (walk while looking or firing)
//
// Keys: Mouse (left button), MouseRight, Space, ShiftLeft, KeyA–KeyZ, Digit0–9, Enter, Escape, Tab, Arrow*; shorthands
// "E" → KeyE, "click" → Mouse, "right click" → MouseRight, "Shift" → ShiftLeft.
export const LIMITS = { steps: 200, holdSeconds: 20, waitSeconds: 120, untilSeconds: 300, totalSeconds: 300, look: 3000, bots: 7 };
export const DOS = ['start', 'hold', 'press', 'move', 'look', 'wait', 'shot', 'snap', 'until', 'again', 'click', 'tap', 'drag'];
export const PHASES = ['lobby', 'countdown', 'playing', 'results'];
const DIRS = { forward: ['KeyW'], back: ['KeyS'], backward: ['KeyS'], left: ['KeyA'], right: ['KeyD'], 'forward-left': ['KeyW', 'KeyA'], 'forward-right': ['KeyW', 'KeyD'], 'back-left': ['KeyS', 'KeyA'], 'back-right': ['KeyS', 'KeyD'] };
const NAMED = new Set(['Mouse', 'MouseRight', 'Space', 'ShiftLeft', 'ShiftRight', 'Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft']);
const ALIAS = { click: 'Mouse', mouse: 'Mouse', lmb: 'Mouse', 'left click': 'Mouse', 'mouse left': 'Mouse', rmb: 'MouseRight', 'right click': 'MouseRight', 'mouse right': 'MouseRight', mouseright: 'MouseRight', space: 'Space', shift: 'ShiftLeft', enter: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab' };

/** A key name as the browser knows it (KeyboardEvent.code, or Mouse / MouseRight), or null. */
export function normKey(k) {
  if (typeof k !== 'string') return null;
  const s = k.trim();
  if (NAMED.has(s) || /^Key[A-Z]$/.test(s) || /^Digit[0-9]$/.test(s)) return s;
  if (/^[A-Za-z]$/.test(s)) return `Key${s.toUpperCase()}`;
  if (/^[0-9]$/.test(s)) return `Digit${s}`;
  return ALIAS[s.toLowerCase()] ?? null;
}
/** A screenshot or snapshot name: lowercase words and dashes, at most 40 characters. */
export const safeName = n => String(n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * → {steps, notes, seconds} with every step normalised ({do, ...}, keys as codes, names safe), or throws an Error whose
 * message lists every problem (one per line, "step N (do): ..."). `input` is an array, {steps}, or JSON text.
 */
export function parseScript(input) {
  let raw = input;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { throw new Error(`the script is not JSON: ${e.message}`); } }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.steps)) raw = raw.steps;
  if (!Array.isArray(raw)) throw new Error('a script is a JSON array of steps, e.g. [{"do":"start"},{"do":"shot","name":"first-look"}]');
  const problems = [], notes = [], steps = [];
  if (!raw.length) problems.push('the script has no steps');
  if (raw.length > LIMITS.steps) problems.push(`the script has ${raw.length} steps; at most ${LIMITS.steps}`);
  const names = new Set();
  raw.forEach((s, i) => {
    const at = `step ${i + 1}${s && typeof s.do === 'string' ? ` (${s.do})` : ''}`;
    const bad = m => problems.push(`${at}: ${m}`);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return bad('a step is an object like {"do":"wait","seconds":1}');
    if (!DOS.includes(s.do)) return bad(`"do" must be one of ${DOS.join(', ')}`);
    const st = { do: s.do };
    const seconds = (lo, hi, def) => { const v = s.seconds ?? def; if (!num(v, lo, hi)) bad(`"seconds" must be a number from ${lo} to ${hi}`); else st.seconds = v; };
    const shotName = (field = 'shot') => {
      if (s[field] === undefined) return;
      const n = safeName(s[field]); if (!n) return bad(`"${field}" must be a name, e.g. "firing"`);
      let u = n, k = 2; while (names.has(u)) u = `${n}-${k++}`;
      names.add(u); st[field] = u;
    };
    const look = v => {
      const o = typeof v === 'object' && v ? v : null;
      if (!o) { bad('"look" must be {"dx": pixels, "dy": pixels}'); return null; }
      const dx = o.dx ?? 0, dy = o.dy ?? 0;
      if (!num(dx, -LIMITS.look, LIMITS.look) || !num(dy, -LIMITS.look, LIMITS.look)) { bad(`look dx and dy must be numbers from -${LIMITS.look} to ${LIMITS.look}`); return null; }
      return { dx, dy };
    };
    switch (s.do) {
      case 'start':
        if (i !== 0) bad('"start" must be the first step (one game per run)');
        st.bots = s.bots ?? 3; if (!Number.isInteger(st.bots) || st.bots < 0 || st.bots > LIMITS.bots) bad(`"bots" must be a whole number from 0 to ${LIMITS.bots}`);
        st.seed = s.seed ?? 1; if (!Number.isInteger(st.seed) || st.seed < 0) bad('"seed" must be a whole number');
        if (s.round !== undefined) { if (!num(s.round, 20, 900)) bad('"round" (seconds) must be from 20 to 900'); else st.round = Math.round(s.round); }
        if (s.quality !== undefined) { if (!['low', 'high'].includes(s.quality)) bad('"quality" must be low or high'); else st.quality = s.quality; }
        if (s.touch !== undefined) { if (typeof s.touch !== 'boolean') bad('"touch" must be true or false'); else if (s.touch) st.touch = true; }
        break;
      case 'tap':
        if (!num(s.x, 0, 4000) || !num(s.y, 0, 4000)) bad('"tap" needs "x" and "y" (screen pixels)'); else { st.x = s.x; st.y = s.y; }
        seconds(0.03, LIMITS.holdSeconds, 0.08);
        shotName();
        break;
      case 'drag': {
        const point = (v, what) => { if (!Array.isArray(v) || v.length !== 2 || !num(v[0], 0, 4000) || !num(v[1], 0, 4000)) { bad(`${what} must be [x, y] in screen pixels`); return null; } return [v[0], v[1]]; };
        const from = point(s.from, '"from"'), to = s.to === undefined ? from : point(s.to, '"to"');
        if (from && to) { st.from = from; st.to = to; }
        if (s.with !== undefined) {
          const w = s.with && typeof s.with === 'object' ? s.with : null;
          const wf = w ? point(w.from, '"with.from"') : (bad('"with" must be {"from": [x, y], "to": [x, y]}'), null), wt = w && wf ? (w.to === undefined ? wf : point(w.to, '"with.to"')) : null;
          if (wf && wt) st.with = { from: wf, to: wt };
        }
        seconds(0.05, LIMITS.holdSeconds, 0.6);
        shotName();
        break;
      }
      case 'hold': {
        const list = s.keys !== undefined ? s.keys : s.key !== undefined ? [s.key] : null;
        if (!Array.isArray(list) || !list.length) { bad('"hold" needs "key" (e.g. "Mouse", "KeyE") or "keys" (a list)'); break; }
        const keys = list.map(normKey);
        if (keys.some(k => !k)) bad(`unknown key ${JSON.stringify(list[keys.indexOf(null)])}; use Mouse, MouseRight, Space, ShiftLeft, KeyA–KeyZ, Digit0–9`);
        st.keys = [...new Set(keys.filter(Boolean))];
        seconds(0.05, LIMITS.holdSeconds, 1);
        shotName();
        if (s.look !== undefined) { const l = look(s.look); if (l) st.look = l; }
        break;
      }
      case 'press': {
        const k = normKey(s.key); if (!k) bad(`"press" needs a known "key" (got ${JSON.stringify(s.key)})`); else st.key = k;
        st.times = s.times ?? 1; if (!Number.isInteger(st.times) || st.times < 1 || st.times > 10) bad('"times" must be 1 to 10');
        shotName();
        break;
      }
      case 'move': {
        let keys = null;
        if (s.dir !== undefined) keys = DIRS[String(s.dir).toLowerCase()] ?? null;
        else if (typeof s.keys === 'string' && /^[WASDwasd]{1,2}$/.test(s.keys)) keys = [...new Set(s.keys.toUpperCase().split(''))].map(c => `Key${c}`);
        if (!keys) { bad(`"move" needs "dir" (${Object.keys(DIRS).join(', ')}) or "keys" like "W" or "WD"`); break; }
        st.keys = s.sprint ? [...keys, 'ShiftLeft'] : keys;
        seconds(0.05, LIMITS.holdSeconds, 1);
        shotName();
        if (s.look !== undefined) { const l = look(s.look); if (l) st.look = l; }
        break;
      }
      case 'look': { const l = look(s); if (l) Object.assign(st, l); break; }
      case 'wait': seconds(0, LIMITS.waitSeconds, undefined); break;
      case 'shot': if (s.name === undefined) s.name = `shot-${i + 1}`; { const n = safeName(s.name); if (!n) bad('"name" must be a name'); else { let u = n, k = 2; while (names.has(u)) u = `${n}-${k++}`; names.add(u); st.name = u; } } break;
      case 'snap': st.name = safeName(s.name ?? '') || `snap-${i + 1}`; break;
      case 'until':
        if (!PHASES.includes(s.phase)) bad(`"phase" must be one of ${PHASES.join(', ')}`); else st.phase = s.phase;
        st.timeout = s.timeout ?? 60; if (!num(st.timeout, 1, LIMITS.untilSeconds)) bad(`"timeout" must be 1 to ${LIMITS.untilSeconds} seconds`);
        break;
      case 'again': break;
      case 'click':
        if (!num(s.x, 0, 4000) || !num(s.y, 0, 4000)) bad('"click" needs "x" and "y" (screen pixels)'); else { st.x = s.x; st.y = s.y; }
        st.button = s.button === 'right' ? 'right' : 'left';
        break;
    }
    const unknown = Object.keys(s).filter(k => !['do', 'note', ...Object.keys(st), 'key', 'keys', 'dir', 'sprint', 'name', 'look', 'button', 'touch', 'to', 'with'].includes(k));
    if (unknown.length) notes.push(`${at}: ignored ${unknown.map(k => `"${k}"`).join(', ')}`);
    if (typeof s.note === 'string') st.note = s.note.slice(0, 200);
    steps.push(st);
  });
  if (steps.length && steps[0].do !== 'start' && !problems.some(p => /"start" must be the first/.test(p))) { steps.unshift({ do: 'start', bots: 3, seed: 1 }); notes.unshift('added {"do":"start","bots":3,"seed":1} as the first step'); }
  // the play time the script asks for (until counts its timeout: the most it can take)
  const seconds = steps.reduce((n, st) => n + (st.seconds ?? 0) + (st.do === 'until' ? st.timeout ?? 0 : 0) + (st.do === 'press' ? 0.15 * (st.times ?? 1) : 0), 0);
  if (seconds > LIMITS.totalSeconds) problems.push(`the script asks for up to ${Math.round(seconds)} s of play; at most ${LIMITS.totalSeconds} s per run (split it into several runs)`);
  if (problems.length) throw new Error(problems.join('\n'));
  return { steps, notes, seconds: Math.round(seconds * 10) / 10 };
}
