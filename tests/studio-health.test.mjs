// The Health check tab's pure parts (studio/tabs/verify/checks.js): every check the kit's verify can make has plain
// words and a category; an unknown one falls into Other under its own name; the headline, progress, history and the
// fix request say what they should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CHECKS, fixRequest, groupChecks, headline, historyChips, parseLine, plainCheck, progress, shotCaption } from '../studio/tabs/verify/checks.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'kits/research/gf-three/tools');

test('every check the kit lists has a category and plain words', async () => {
  const homes = JSON.parse(await readFile(path.join(TOOLS, 'lib/homes.json'), 'utf8'));
  const ids = new Set(CATEGORIES.map(c => c.id));
  for (const n of Object.keys(homes.checks)) {
    const c = CHECKS[n];
    assert.ok(c, `check ${n} (${homes.checks[n].name}) has no plain words`);
    assert.ok(ids.has(c.cat) && c.cat !== 'other', `check ${n}: category ${c.cat}`);
    assert.ok(c.title.length > 3 && c.title.length <= 40, `check ${n}: a short title`);
    assert.match(c.fail, /^[A-Z].*\.$/, `check ${n}: one sentence`);
    assert.doesNotMatch(`${c.title} ${c.fail}`, /\bcheck \d|verify|\.json|--/i, `check ${n}: plain words, no ids or commands`);
  }
});

test('every check number the verify flows emit is one with plain words', async () => {
  const files = (await readdir(TOOLS)).filter(f => /^verify.*\.mjs$/.test(f));
  assert.ok(files.includes('verify.mjs'));
  const seen = new Set();
  for (const f of files) {
    const src = await readFile(path.join(TOOLS, f), 'utf8');
    for (const m of src.matchAll(/\badd\((\d+), '/g)) seen.add(Number(m[1]));
  }
  assert.ok(seen.size > 25, `found ${seen.size} checks`);
  for (const n of seen) assert.ok(CHECKS[n], `check ${n} is emitted but has no plain words`);
  // the vista checks share the list (gf-vista's verify-vista.mjs on games.fun main)
  for (const n of [36, 37]) assert.ok(CHECKS[n]);
});

test('an unknown check falls into Other under its own name', () => {
  const c = plainCheck({ n: 99, name: 'the moon is round', ok: false, detail: 'it is square' });
  assert.equal(c.cat, 'other');
  assert.equal(c.title, 'The moon is round');
  assert.match(c.fail, /the moon is round/);
  const g = groupChecks([{ n: 99, name: 'the moon is round', ok: false }, { n: 3, name: 'boots', ok: true }]);
  assert.deepEqual(g.map(x => x.id), ['other', 'run']);
  assert.equal(g[0].label, 'Other');
});

test('the same number keeps its meaning whatever words a flow prints', () => {
  assert.equal(plainCheck({ n: 5, name: 'the world gate', ok: true }).title, plainCheck({ n: 5, name: 'two-player live gate', ok: true }).title);
  assert.equal(plainCheck({ n: 7, name: 'audio gate v4', ok: true }).cat, 'sound');
});

test('categories with failures come first, failures first inside', () => {
  const checks = [
    { n: 1, name: 'manifests', ok: true }, { n: 3, name: 'boots', ok: true }, { n: 7, name: 'audio', ok: true },
    { n: 13, name: 'controls work', ok: true }, { n: 16, name: 'hits read', ok: false }, { n: 10, name: 'fair play', ok: null },
    { n: 18, name: 'sounds play', ok: false }, { n: 20, name: 'menu', ok: false },
  ];
  const g = groupChecks(checks);
  assert.deepEqual(g.slice(0, 3).map(x => x.id).sort(), ['controls', 'menus', 'sound']);
  const controls = g.find(x => x.id === 'controls');
  assert.equal(controls.checks[0].n, 16);
  assert.equal(controls.state, 'fail');
  assert.equal(controls.failed, 1); assert.equal(controls.passed, 1); assert.equal(controls.skipped, 1);
  assert.equal(g.find(x => x.id === 'run').state, 'pass');
});

test('the headline says it in words', () => {
  assert.equal(headline(null).words, 'Not checked yet');
  assert.equal(headline({ pass: true, passed: 22, ran: 22, quick: true, checks: [] }).words, 'Ready to share');
  assert.equal(headline({ pass: false, passed: 20, ran: 22, checks: [{ ok: false }, { ok: false }] }).words, '2 things need fixing');
  assert.equal(headline({ pass: false, passed: 21, ran: 22, checks: [{ ok: false }] }).words, '1 thing needs fixing');
  assert.equal(headline(null, { stopped: true }).tone, 'stopped');
});

test('progress: a count only from what verify printed, else a time estimate', () => {
  const started = new Date(0).toISOString();
  const est = progress({ log: ['verify: games/x in Chrome (/usr/bin/chrome)'], started, now: 60_000, quick: true });
  assert.equal(est.counted, false);
  assert.equal(est.words, 'Checking your game…');
  assert.ok(est.pct > 0.3 && est.pct < 0.5, String(est.pct));
  const failOnly = progress({ log: ['FAIL 13 controls work — jump did nothing', '  rule: x'], started, now: 30_000 });
  assert.equal(failOnly.counted, false);
  assert.deepEqual(failOnly.fails.map(f => f.title), ['Every control does something']);
  const all = progress({ log: ['PASS 1 manifests — ok', 'PASS 2 kit copies unedited', 'FAIL 3 boots — errors', 'SKIP 9 contact sheet and perf — --quick'], started, now: 20_000, runs: [{ quick: true, seconds: 100, checks: new Array(20).fill({}) }] });
  assert.equal(all.counted, true);
  assert.equal(all.done, 4); assert.equal(all.total, 20);
  assert.equal(all.words, 'Checking… 4 of 20');
  assert.equal(all.last, 'Runs smoothly');
  assert.ok(all.pct < 1);
});

test('log lines, captions, history chips', () => {
  assert.deepEqual(parseLine('FAIL 21 the HUD shows your state — no card'), { n: 21, ok: false, name: 'the HUD shows your state' });
  assert.equal(parseLine('  rule: something'), null);
  assert.equal(shotCaption('/game/evidence/verify-2/23-controls-primary-held.jpg'), 'Controls primary held');
  assert.equal(shotCaption('friends-02-host-waiting-alone.jpg'), 'Friends 02 host waiting alone');
  const chips = historyChips([{ run: 'verify-2', pass: true, passed: 22, ran: 22, quick: true, seconds: 130, checks: [] }, { run: 'verify-1', pass: false, passed: 20, ran: 22, checks: [{ ok: false }, { ok: false }] }]);
  assert.deepEqual(chips.map(c => [c.run, c.tone, c.label]), [['verify-2', 'good', '22/22'], ['verify-1', 'bad', '20/22']]);
  assert.match(chips[1].title, /2 to fix/);
});

test('the fix request carries the check, what it saw, the rule and the fix, and the person\'s words', () => {
  const t = fixRequest({ n: 13, name: 'controls work', ok: false, detail: 'jump did nothing' }, { run: 'verify-3', rule: 'every control does something', fix: 'wire jump', words: 'please' });
  for (const s of ['check 13', '"controls work"', 'Every control does something', 'jump did nothing', 'The rule: every control', 'How to fix: wire jump', 'evidence/verify-3/verdict.json', 'The person adds: please']) assert.ok(t.includes(s), s);
});
