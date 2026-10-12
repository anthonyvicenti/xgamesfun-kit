// The Publish tool's pure logic (no DOM): the four steps and their states, the words for a refusal, the picture for
// the share card, and the versions. studio/tabs/publish.js draws them; tests/publish-model.test.mjs checks them.
//
// A step's state is one of: done (green tick), now (the step to act on), waiting (later; or waiting on the person
// elsewhere, with a note), problem (red: needs you).

export const STEPS = [
  { id: 'signin', label: 'Sign in' },
  { id: 'check', label: 'Check' },
  { id: 'publish', label: 'Publish' },
  { id: 'share', label: 'Share' },
];

const CHECK_CODES = new Set(['files', 'secrets', 'size']);

/** Where a running publish is, from its progress lines: 'check' until the upload starts, then 'publish'. */
export function phaseOf(lines = []) {
  return lines.some(l => /^(Uploading|Publishing “|Updating )/.test(l) || /^\s+uploaded \d+ of/.test(l)) ? 'publish' : 'check';
}

/**
 * The four steps for what the routes say now.
 *   status   GET /api/publish/status ({ signedIn, signIn, known, run })
 *   check    GET /api/publish/check  ({ ok, problems, secrets }) or { error } or null (not loaded yet)
 *   verify   the newest verify run ({ pass, passed, ran }) or null
 * → [{ id, label, state, note }]
 */
export function stepsOf({ status = {}, check = null, verify = null } = {}) {
  const run = status.run ?? {}, r = run.result ?? null, code = run.error ? run.code ?? null : null;
  const signedIn = !!status.signedIn, signState = status.signIn?.state ?? 'idle';
  const phase = run.running ? phaseOf(run.lines) : null;
  const url = r?.url ?? status.known?.url ?? null;
  const out = {};

  out.signin = code === 'login' ? ['problem', 'Sign in again']
    : signedIn ? ['done', 'Signed in']
    : signState === 'waiting' ? ['now', 'Approve in the new tab']
    : signState === 'failed' ? ['problem', 'Did not finish']
    : ['now', 'Your games.fun account'];

  const checkBad = check && (check.error || check.ok === false);
  const draftFail = r && !r.url && r.verify && !r.verify.pass;
  out.check = checkBad || CHECK_CODES.has(code) ? ['problem', check?.secrets ? 'A secret key' : 'Needs a fix']
    : phase === 'check' ? ['now', 'Checking… (about 2 min)']
    : draftFail ? ['problem', 'Checks failed']
    : r?.verify?.pass || url ? ['done', 'Passed']
    : verify?.pass ? ['done', 'Passed last time']
    : verify && !verify.pass ? ['problem', 'Failed last time']
    : ['waiting', 'Runs when you publish'];

  out.publish = run.error && code !== 'login' && !CHECK_CODES.has(code) ? ['problem', 'Stopped']
    : phase === 'publish' ? ['now', 'Uploading…']
    : r && !r.url ? ['waiting', 'Saved as a private draft']
    : url ? ['done', `Version ${r?.version?.number ?? status.known?.lastVersion ?? ''}`.trim()]
    : status.known && !url ? ['waiting', 'A private draft so far']
    : signedIn && out.check[0] !== 'problem' && !run.running ? ['now', 'Ready']
    : ['waiting', 'Not yet'];

  out.share = url && !run.running ? ['now', 'Send the link'] : ['waiting', 'Your link'];

  return STEPS.map(s => ({ ...s, state: out[s.id][0], note: out[s.id][1] }));
}

/** The step to act on: the first problem, else the first 'now'. → id or null */
export function currentStep(steps) {
  return (steps.find(s => s.state === 'problem') ?? steps.find(s => s.state === 'now'))?.id ?? null;
}

/**
 * A refusal or failure in plain words: { title, text, todo }. `err` is { message, code } (a run's error) or a check's
 * { problems, secrets, error }.
 */
export function plainError(err) {
  if (!err) return null;
  const message = String(err.message ?? err.error ?? '').trim();
  if (err.secrets) return { title: 'A file looks like it holds a secret key', text: err.secrets, todo: 'Take the key out of the game (a secret belongs on your server, never in a game anyone can download), then publish again.' };
  if (err.problems?.length) return { title: 'Some files can’t go online', text: err.problems.join('\n'), todo: 'Move those files out of the game’s folder, then publish again.' };
  const code = err.code ?? null;
  if (code === 'login' || /Not signed in|Sign in first/i.test(message)) return { title: 'You’re signed out of games.fun', text: message, todo: 'Sign in again, then press Publish.' };
  if (code === 'secrets') return { title: 'A file looks like it holds a secret key', text: message, todo: 'Take the key out of the game, then publish again.' };
  if (code === 'files') return { title: 'Some files can’t go online', text: message.replace(/^Nothing was published:\s*/, ''), todo: 'Move those files out of the game’s folder, then publish again.' };
  if (code === 'size') return { title: 'The game is too big to publish', text: message, todo: 'Make the big files smaller (pictures, models, sounds), or ask your session to.' };
  if (code === 'changed') return { title: 'The game changed while it was going up', text: message, todo: 'Wait until nothing is editing the game, then publish again.' };
  if (/Could not reach games\.fun/i.test(message)) return { title: 'games.fun didn’t answer', text: message, todo: 'Check your internet connection, then try again.' };
  if (/does not offer publishing from the kit/i.test(message)) return { title: 'This games.fun can’t take games from the studio yet', text: message, todo: 'Try again later, or ask the games.fun team.' };
  if (/No game is open/i.test(message)) return { title: 'No game is open', text: message, todo: 'Open a game from the start page first.' };
  return { title: 'Publishing stopped', text: message || 'Something went wrong.', todo: 'Try again. If it keeps happening, open Details and show the log to your session.' };
}

/** The best verify screenshot for a share card: playing, then mid-round, first look, anything but the lobby. */
export function pickShot(shots = []) {
  const order = [/playing/, /mid-round/, /round-2/, /first-look/, /results/];
  for (const re of order) { const s = shots.find(x => re.test(String(x))); if (s) return s; }
  return shots.find(x => !/lobby/.test(String(x))) ?? shots[0] ?? null;
}

/**
 * The versions, newest first: [{ version, draft, url, at, live }]. From the remembered history (lib/publish/index.mjs
 * writes it), else the one version the link record names. `liveVersion` marks the one at the public link now.
 */
export function versionsOf(known, liveVersion = null) {
  if (!known) return [];
  let list = Array.isArray(known.history) && known.history.length ? known.history
    : known.lastVersion != null ? [{ version: known.lastVersion, draft: !!known.draft, url: known.url ?? null, at: known.at ?? null }] : [];
  list = list.filter(v => v && v.version != null).slice().reverse();
  const live = liveVersion ?? list.find(v => !v.draft && v.url)?.version ?? null;
  return list.map(v => ({ ...v, live: v.version === live && !v.draft }));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", else the date. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) { const d = Math.round(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return new Date(t).toISOString().slice(0, 10);
}

/** The link without its scheme, for showing big: games-fun-play.vercel.app/play/coin-hop */
export const shortLink = url => String(url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
