// The Publish tool's pure logic (studio/tabs/publish/model.js): the four steps' states, plain-word errors, the share
// card's picture and the versions timeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsOf, currentStep, plainError, pickShot, versionsOf, phaseOf, ago, shortLink } from '../studio/tabs/publish/model.js';

const states = s => Object.fromEntries(s.map(x => [x.id, x.state]));
const idle = { running: false, lines: [], result: null, error: null, code: null };

test('a fresh game, signed out: sign in is the step; check waits; nothing is a problem', () => {
  const s = stepsOf({ status: { signedIn: null, signIn: { state: 'idle' }, known: null, run: idle }, check: { ok: true, problems: [], secrets: null } });
  assert.deepEqual(states(s), { signin: 'now', check: 'waiting', publish: 'waiting', share: 'waiting' });
  assert.equal(currentStep(s), 'signin');
});

test('signed in, checks passed last time: publish is the step', () => {
  const s = stepsOf({ status: { signedIn: { email: 'a@b.c' }, known: null, run: idle }, check: { ok: true }, verify: { pass: true } });
  assert.deepEqual(states(s), { signin: 'done', check: 'done', publish: 'now', share: 'waiting' });
  assert.equal(s[0].note, 'Signed in');
  assert.equal(currentStep(s), 'publish');
});

test('waiting on the person to approve in games.fun; a sign-in that failed is a problem', () => {
  assert.equal(stepsOf({ status: { signIn: { state: 'waiting' }, run: idle } })[0].note, 'Approve in the new tab');
  assert.equal(stepsOf({ status: { signIn: { state: 'failed' }, run: idle } })[0].state, 'problem');
});

test('while running: check, then publish once the upload starts', () => {
  const base = { signedIn: { email: 'a' }, run: { ...idle, running: true, lines: ['Reading the game’s files…', 'Checking the game (verify --quick…)'] } };
  assert.equal(phaseOf(base.run.lines), 'check');
  assert.equal(states(stepsOf({ status: base })).check, 'now');
  base.run.lines.push('Publishing “Coin Hop” on http://x…', 'Uploading 8 new files (0.1 MB); 0 games.fun already has.');
  assert.equal(phaseOf(base.run.lines), 'publish');
  const s = states(stepsOf({ status: base }));
  assert.equal(s.publish, 'now');
  assert.equal(s.share, 'waiting', 'no sharing while a version is going up');
});

test('published: share is the step; a draft (checks failed) marks the check red', () => {
  const pub = stepsOf({ status: { signedIn: { email: 'a' }, known: { url: 'https://p/play/x', lastVersion: 2 }, run: { ...idle, result: { url: 'https://p/play/x', version: { number: 2 }, verify: { pass: true } } } } });
  assert.deepEqual(states(pub), { signin: 'done', check: 'done', publish: 'done', share: 'now' });
  assert.equal(pub[2].note, 'Version 2');
  const draft = stepsOf({ status: { signedIn: { email: 'a' }, known: { url: null, lastVersion: 1 }, run: { ...idle, result: { url: null, version: { number: 1 }, verify: { pass: false } } } } });
  assert.equal(states(draft).check, 'problem');
  assert.equal(states(draft).publish, 'waiting');
  assert.equal(currentStep(draft), 'check');
});

test('errors land on their step: login on sign in, secrets on check, a network failure on publish', () => {
  const st = code => states(stepsOf({ status: { signedIn: { email: 'a' }, run: { ...idle, error: 'x', code } } }));
  assert.equal(st('login').signin, 'problem');
  assert.equal(st('secrets').check, 'problem');
  assert.equal(st(null).publish, 'problem');
  assert.equal(states(stepsOf({ status: { run: idle }, check: { ok: false, secrets: 'rules.js line 3: a service-role key' } })).check, 'problem');
});

test('plain words: what happened and what to do, never a raw error alone', () => {
  assert.match(plainError({ code: 'login', message: 'Not signed in to games.fun' }).todo, /Sign in again/);
  assert.match(plainError({ secrets: 'rules.js line 3: a service-role key' }).title, /secret key/);
  assert.match(plainError({ problems: ['.env: a .env file'] }).todo, /Move those files/);
  assert.match(plainError({ message: 'Could not reach games.fun at https://x (ECONNREFUSED).' }).title, /didn’t answer/);
  assert.match(plainError({ code: 'files', message: 'Nothing was published:\n  - a: b' }).text, /^ {2}- a: b|^- a: b|a: b/);
  const other = plainError({ message: 'weird' });
  assert.equal(other.title, 'Publishing stopped');
  assert.match(other.todo, /Details/);
  assert.equal(plainError(null), null);
});

test('the share card picture: playing first, never the lobby when there is another', () => {
  assert.equal(pickShot(['/e/01-lobby.jpg', '/e/02-first-look.jpg', '/e/03-playing.jpg']), '/e/03-playing.jpg');
  assert.equal(pickShot(['/e/01-lobby.jpg', '/e/02-other.jpg']), '/e/02-other.jpg');
  assert.equal(pickShot(['/e/01-lobby.jpg']), '/e/01-lobby.jpg');
  assert.equal(pickShot([]), null);
});

test('versions: newest first, the live one marked; an old record with no history is one version', () => {
  const v = versionsOf({ history: [{ version: 1, draft: false, url: 'u', at: 'a' }, { version: 2, draft: true, url: null, at: 'b' }, { version: 3, draft: false, url: 'u', at: 'c' }] });
  assert.deepEqual(v.map(x => [x.version, x.live]), [[3, true], [2, false], [1, false]]);
  assert.deepEqual(versionsOf({ lastVersion: 4, draft: false, url: 'u', at: 'z' }).map(x => x.version), [4]);
  assert.deepEqual(versionsOf(null), []);
  assert.equal(versionsOf({ history: [{ version: 1, url: 'u' }, { version: 2, url: 'u' }] }, 1)[1].live, true, 'games.fun says which is live');
});

test('small words: ago and the short link', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  assert.equal(ago('2026-10-12T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-10-12T11:50:00Z', now), '10 min ago');
  assert.equal(ago('2026-10-10T12:00:00Z', now), '2 days ago');
  assert.equal(ago(null, now), '');
  assert.equal(shortLink('https://games-fun-play.vercel.app/play/coin-hop/'), 'games-fun-play.vercel.app/play/coin-hop');
});
