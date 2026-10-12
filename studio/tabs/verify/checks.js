// Health check (the Verify tab): the kit's verify checks in plain words, grouped into a few categories a person
// understands, and the scorecard's headline, progress and history. Pure: no DOM, so tests/studio-health.test.mjs runs it.
//
// The list is the kit's own: kits/research/gf-three/tools/lib/homes.json → checks (1–37), the names verify.mjs,
// verify-world.mjs, verify-forge.mjs (and gf-vista's verify-vista.mjs) emit. A check is keyed by its number; the words a
// flow prints for it may differ (check 5 is "the world gate" in a world, check 7 "audio gate v4" in forge), the meaning
// does not. A number not listed here falls into Other, under its own name.

/** The categories, in the order a passing card lists them. icon: inline SVG children (24×24, stroke currentColor). */
export const CATEGORIES = [
  { id: 'run', label: 'Starts and runs', icon: '<polygon points="7 4 19 12 7 20 7 4"/>' },
  { id: 'controls', label: 'Controls', icon: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".9"/><circle cx="18" cy="14" r=".9"/>' },
  { id: 'friends', label: 'Friends online', icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/>' },
  { id: 'looks', label: 'Looks', icon: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1-1.5-1-2.6 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>' },
  { id: 'world', label: 'World', icon: '<path d="M3 20h18"/><path d="M5 20l5-9 3 5 2-3 4 7"/><circle cx="17" cy="6" r="2"/>' },
  { id: 'sound', label: 'Sound', icon: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>' },
  { id: 'menus', label: 'Menus and HUD', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>' },
  { id: 'speed', label: 'Speed and screens', icon: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>' },
  { id: 'other', label: 'Other', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>' },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

/** Every check verify can make: its category, a short plain title, and what a failure means (one sentence). */
export const CHECKS = {
  1: { cat: 'run', title: 'Game files in order', fail: 'One of the game\'s settings files (its art list or its multiplayer settings) has a mistake, so parts of the game may not load.' },
  2: { cat: 'run', title: 'Kit parts untouched', fail: 'A shared kit file inside the game was edited; those must stay exactly as the kit ships them.' },
  3: { cat: 'run', title: 'Starts with no errors', fail: 'The game shows errors when it starts, or your player cannot move yet.' },
  4: { cat: 'looks', title: 'Every part can be restyled', fail: 'Some things on screen are not linked to the game\'s art list, so they cannot be swapped in Art & sound.' },
  5: { cat: 'friends', title: 'Two players in one game', fail: 'When a friend joins, the two players do not end up in the same game, or do not see each other.' },
  6: { cat: 'run', title: 'A round ends and replays', fail: 'A round does not reach its results, or Play again does not start the next one.' },
  7: { cat: 'sound', title: 'Sound at a good level', fail: 'The game is silent, or too quiet or too loud while you play.' },
  8: { cat: 'looks', title: 'Swapped art shows on screen', fail: 'Replacing a picture or a model does not change what you see in the game.' },
  9: { cat: 'speed', title: 'Runs smoothly', fail: 'The game runs slowly, or its overview pictures could not be taken.' },
  10: { cat: 'controls', title: 'Plays fair', fail: 'Someone gets an unfair edge: bots too strong, or no time to dodge.' },
  11: { cat: 'world', title: 'Level laid out well', fail: 'The level has blocked paths, props in odd places or bad places to appear.' },
  12: { cat: 'run', title: 'Something happens', fail: 'Nothing moves or changes during a round: there is no action on screen.' },
  13: { cat: 'controls', title: 'Every control does something', fail: 'A control the game lists (jump, use, attack…) does nothing you can see.' },
  14: { cat: 'looks', title: 'Chosen looks are used', fail: 'A look picked for a character or the world is not the one on screen.' },
  15: { cat: 'run', title: 'The goal is clear and alive', fail: 'The round\'s goal is not shown, or the game\'s main idea does not play out.' },
  16: { cat: 'controls', title: 'Hits are easy to see', fail: 'When you hit something it is hard to tell: no clear reaction on screen.' },
  17: { cat: 'world', title: 'The world is complete', fail: 'The world has holes or missing edges, lights or places to appear.' },
  18: { cat: 'sound', title: 'Every sound plays', fail: 'A sound the game uses is missing or not listed, so it cannot be heard or replaced.' },
  19: { cat: 'looks', title: 'Characters hold their shape', fail: 'A character\'s body bends wrongly: twisted arms, hands or legs.' },
  20: { cat: 'menus', title: 'The menu works', fail: 'The home or pause menu is missing a button, or a button does not work.' },
  21: { cat: 'menus', title: 'The HUD shows your state', fail: 'Your score, health or goal is not on screen while you play.' },
  22: { cat: 'menus', title: 'Wallet in the menu', fail: 'The wallet cannot be opened from the game\'s menu.' },
  23: { cat: 'looks', title: 'Looks like your pictures', fail: 'The game does not look like the reference pictures it was made from.' },
  24: { cat: 'menus', title: 'Plays inside a post', fail: 'Inside a post on X the game is hard to control (the mouse, full screen).' },
  25: { cat: 'friends', title: 'Friends can join by name', fail: 'Hosting, joining or naming players in the waiting room does not work.' },
  26: { cat: 'world', title: 'The world is saved', fail: 'Changes to the world are lost when everyone leaves.' },
  27: { cat: 'friends', title: 'The world stays when the host leaves', fail: 'When the host leaves, the other players lose the world.' },
  28: { cat: 'world', title: 'The starting area is safe', fail: 'Players can break or block the place where everyone appears.' },
  29: { cat: 'world', title: 'Signs are filtered', fail: 'Bad words written on signs are not filtered.' },
  30: { cat: 'speed', title: 'Plays on phones', fail: 'On a phone the game cannot be played with touch.' },
  31: { cat: 'speed', title: 'Sharp on every screen', fail: 'The game looks blurry on some screens (a phone, a laptop, a 4K screen).' },
  32: { cat: 'run', title: 'Works without WebGPU', fail: 'In a browser without WebGPU the game shows a blank screen instead of playing or explaining.' },
  33: { cat: 'run', title: 'Recovers from a graphics hiccup', fail: 'When the graphics card resets mid-game, the picture does not come back.' },
  34: { cat: 'friends', title: 'Watch, then play', fail: 'Watching a friend\'s stream, or joining their game from it, does not work.' },
  35: { cat: 'run', title: 'The game\'s own tests pass', fail: 'Tests written for this game\'s rules fail.' },
  36: { cat: 'looks', title: 'The sea moves', fail: 'The sea is not drawn, or it does not move.' },
  37: { cat: 'looks', title: 'The look matches its settings', fail: 'The colours and light on screen do not match the game\'s look settings.' },
};

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One check in plain words: → { n, name, title, fail, cat, state: 'pass' | 'fail' | 'skip', ok, detail } */
export function plainCheck(c) {
  const known = CHECKS[c?.n];
  const state = c?.ok === true ? 'pass' : c?.ok === false ? 'fail' : 'skip';
  const name = String(c?.name ?? (c?.n != null ? `check ${c.n}` : 'a check'));
  return {
    n: c?.n ?? null, name, ok: c?.ok ?? null, detail: c?.detail ?? '', state,
    cat: known?.cat ?? 'other',
    title: known?.title ?? cap(name),
    fail: known?.fail ?? `This check did not pass: ${name}.`,
  };
}

const RANK = { fail: 0, skip: 2, pass: 1 };
/** A run's checks grouped by category: categories with a failure first (most failures first), then the rest in
 *  CATEGORIES order; inside each, failures first. → [{ id, label, icon, checks, passed, failed, skipped, state }] */
export function groupChecks(checks = []) {
  const by = new Map();
  for (const c of checks.map(plainCheck)) {
    if (!by.has(c.cat)) by.set(c.cat, []);
    by.get(c.cat).push(c);
  }
  const order = CATEGORIES.map(c => c.id);
  return [...by.entries()].map(([id, list]) => {
    list.sort((a, b) => RANK[a.state] - RANK[b.state] || (a.n ?? 99) - (b.n ?? 99));
    const failed = list.filter(c => c.state === 'fail').length, passed = list.filter(c => c.state === 'pass').length;
    return { ...CAT[id], checks: list, passed, failed, skipped: list.length - passed - failed, state: failed ? 'fail' : passed ? 'pass' : 'skip' };
  }).sort((a, b) => (b.failed > 0) - (a.failed > 0) || b.failed - a.failed || order.indexOf(a.id) - order.indexOf(b.id));
}

const things = n => `${n} ${n === 1 ? 'thing needs' : 'things need'} fixing`;

/** The latest finished run's words: → { tone: 'good' | 'bad' | 'idle' | 'stopped', words, sub, passed, ran } */
export function headline(run, { stopped = false } = {}) {
  if (stopped) return { tone: 'stopped', words: 'The check stopped early', sub: 'It ended before a result. Details has what it printed.', passed: 0, ran: 0 };
  if (!run) return { tone: 'idle', words: 'Not checked yet', sub: 'Plays your game in Chrome with real keys and a second player, then shows what works.', passed: 0, ran: 0 };
  const failed = (run.checks ?? []).filter(c => c.ok === false).length;
  const passed = run.passed ?? (run.checks ?? []).filter(c => c.ok === true).length;
  const ran = run.ran ?? (run.checks ?? []).filter(c => c.ok !== null).length;
  if (run.pass) return { tone: 'good', words: 'Ready to share', sub: `All ${ran} checks passed${run.quick ? ' in the quick check' : ''}.`, passed, ran };
  if (failed) return { tone: 'bad', words: cap(things(failed)), sub: `${passed} of ${ran} checks passed.`, passed, ran };
  return { tone: 'bad', words: 'Not a full pass', sub: `${passed} of ${ran} checks passed; some were skipped.`, passed, ran };
}

/** A verify log line about one check (verify prints FAIL lines always, PASS and SKIP with --all). → { n, ok, name } | null */
export function parseLine(line) {
  const m = /^(PASS|FAIL|SKIP) (\d+) (.+?)(?: — .*)?$/.exec(String(line));
  return m ? { n: Number(m[2]), ok: m[1] === 'PASS' ? true : m[1] === 'FAIL' ? false : null, name: m[3] } : null;
}

/** Defaults when no earlier run says how long a run takes and how many checks it makes (a round game). */
export const TYPICAL = { quick: { seconds: 150, count: 22 }, full: { seconds: 330, count: 23 } };

/**
 * A running check's progress, from its log and the earlier runs. Honest: a count only from the lines verify printed;
 * otherwise a time estimate, labelled as one. → { pct, done, total, counted, last, fails, left, words }
 *   log: the lines so far; started: ISO; now: ms; quick: bool; runs: earlier runs (summaries)
 */
export function progress({ log = [], started = null, now = Date.now(), quick = true, runs = [] } = {}) {
  const like = runs.find(r => !!r.quick === !!quick && r.seconds) ?? null;
  const typical = quick ? TYPICAL.quick : TYPICAL.full;
  const seconds = like?.seconds ?? typical.seconds;
  const total = like?.checks?.length || typical.count;
  const seen = new Map();
  for (const l of log) { const p = parseLine(l); if (p) seen.set(p.n, p); }
  const done = seen.size, counted = [...seen.values()].some(p => p.ok !== false);   // PASS/SKIP lines: verify ran with --all
  const fails = [...seen.values()].filter(p => p.ok === false).map(p => plainCheck(p));
  const lastLine = [...log].reverse().map(parseLine).find(Boolean);
  const elapsed = started ? Math.max(0, (now - new Date(started).getTime()) / 1000) : 0;
  const byTime = Math.min(0.95, elapsed / seconds);
  const pct = counted ? Math.min(0.97, Math.max(done / total, byTime * 0.5)) : byTime;
  const left = Math.max(0, Math.round(seconds - elapsed));
  const leftWords = left > 90 ? `about ${Math.round(left / 60)} min left` : left > 15 ? 'about a minute left' : 'almost done';
  return {
    pct, done, total, counted, fails, left,
    last: lastLine ? plainCheck(lastLine).title : null,
    words: counted ? `Checking… ${Math.min(done, total)} of ${total}` : 'Checking your game…',
    sub: elapsed < 8 ? 'Opening Chrome' : `Playing your game in Chrome · ${leftWords}`,
  };
}

/** A shot's file name as a caption: "23-controls-primary-held.jpg" → "Controls primary held" */
export function shotCaption(url) {
  const f = decodeURIComponent(String(url).split('/').pop() ?? '').replace(/\.(jpe?g|png|webp)$/i, '').replace(/^\d+-/, '');
  return cap(f.replace(/[-_.]+/g, ' ').trim()) || 'Screenshot';
}

/** The run history as chips, newest first: → [{ run, tone, label, title }] */
export function historyChips(runs = []) {
  return runs.map(r => {
    const failed = (r.checks ?? []).filter(c => c.ok === false).length;
    const when = r.started ? new Date(r.started) : null;
    const at = when && !Number.isNaN(when.getTime()) ? when.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
    return {
      run: r.run, tone: r.pass ? 'good' : 'bad',
      label: `${r.passed}/${r.ran}`,
      title: `${r.pass ? 'Passed' : `${failed} to fix`}: ${r.passed} of ${r.ran} checks${r.quick ? ' · quick' : ' · full'}${r.seconds ? ` · ${Math.max(1, Math.round(r.seconds / 60))} min` : ''}${at ? ` · ${at}` : ''}`,
    };
  });
}

/** What the person's session is told when they ask it to fix a failing check. */
export function fixRequest(check, { run = null, rule = null, fix = null, words = '' } = {}) {
  const c = plainCheck(check);
  return [
    `Fix a failing Health check (verify) in the open game: check ${c.n} "${c.name}" (${c.title}).`,
    `What it means: ${c.fail}`,
    c.detail ? `What the check saw: ${c.detail}` : null,
    rule ? `The rule: ${rule}` : null,
    fix ? `How to fix: ${fix}` : null,
    run ? `Evidence: evidence/${run}/verdict.json and its screenshots.` : null,
    'When it is fixed, run verify again (npx gamesfun verify --quick) and say what changed in plain words.',
    words ? `The person adds: ${words}` : null,
  ].filter(Boolean).join('\n');
}
