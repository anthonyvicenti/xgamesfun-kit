// The studio page's modules (no browser), the build route, and the page's calls against the session stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';
import { attachSessionStub } from './stubs/session-stub.mjs';
import { IDLE_HINT, connection, describeEvent, normalizeEvent, normalizeQueue, pendingPermissions, requestWords } from '../studio/lib/session.js';
import { loopView, playtestNotes } from '../studio/lib/loop-state.js';
import { pendingChanges, sliderRange, tunables } from '../studio/lib/tune.js';

test('request states are in words a person understands', () => {
  assert.match(requestWords('waiting').label, /Waiting for your session/);
  assert.match(requestWords('handed').label, /Handed over/);
  assert.match(requestWords('seen').label, /seen/);
  assert.equal(requestWords('done').label, 'Done');
  assert.match(requestWords('dropped').label, /send again/i);
  assert.equal(requestWords('waiting').editable, true);
  assert.equal(requestWords('handed').editable, false, 'only a waiting request can be edited');
  assert.equal(requestWords('dropped').again, true);
});

test('events: normalised, described, permissions pair up', () => {
  const p = normalizeEvent('{"id":"p1","type":"permission","tool":"Bash","text":"npm test"}');
  assert.equal(p.tool, 'Bash');
  assert.equal(normalizeEvent('not json'), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent({ text: 'x' }, 'prompt').type, 'prompt');
  assert.match(describeEvent(p), /use Bash: npm test/);
  const evs = [p, normalizeEvent({ id: 'p2', type: 'permission', tool: 'Write' })];
  assert.deepEqual(pendingPermissions(evs).map(e => e.id), ['p1', 'p2']);
  assert.deepEqual(pendingPermissions(evs, new Set(['p1'])).map(e => e.id), ['p2'], 'answered here');
  evs.push(normalizeEvent({ type: 'permission-resolved', request: 'p2' }));
  assert.deepEqual(pendingPermissions(evs).map(e => e.id), ['p1'], 'answered in the terminal');
});

test('connection: idle says to press Enter, an open wait says listening', () => {
  const ev = t => normalizeEvent({ type: t });
  assert.equal(connection([], null), 'none');
  assert.equal(connection([ev('session-start'), ev('prompt')], { requests: [] }), 'working');
  assert.equal(connection([ev('session-start'), ev('stop')], { requests: [] }), 'idle');
  assert.equal(connection([ev('stop')], { requests: [], wait: { open: true } }), 'listening');
  assert.equal(connection([ev('session-end')], null), 'none');
  assert.match(IDLE_HINT, /Press Enter in the terminal/);
});

test('queue: a bare list or {requests}; each request gets its words', () => {
  assert.equal(normalizeQueue(null).length, 0);
  const q = normalizeQueue({ requests: [{ id: 1, text: 'faster', state: 'dropped' }, { id: 2, text: 'x' }, { text: 'no id' }] });
  assert.equal(q.length, 2);
  assert.equal(q[0].words.again, true);
  assert.equal(q[1].state, 'waiting');
  assert.equal(normalizeQueue([{ id: 'a', text: 't', state: 'done' }])[0].words.tone, 'ok');
});

const draft = {
  schema: 'gf-loop/1', kind: 'build', status: 'building', step: 'repair', why: 'the full verify failed', round: 2, repairs: 1, rescues: 0, verifies: 2, playtests: 1,
  verify: { n: 2, ok: false, playable: true, hash: 'h', at: '2026-10-11T10:00:00Z', failed: ['15'] },
  playtest: { round: 1, ok: false, verdict: 'fail', at: '2026-10-11T09:00:00Z' }, pt: { notes: ['The goal is hidden behind a wall'] },
  fixes: [{ round: 1, fix: 'fair-on', file: 'config/game.json', pointer: '/fair/on', line: 'x' }], outcome: null,
  history: [{ step: 'verify', next: 'repair', why: 'w', at: '2026-10-11T10:00:00Z' }],
};
test('loopView reads the gf-loop/1 state: failing checks only, play-tester notes, fixes, stale proof', () => {
  assert.equal(loopView(null).present, false);
  const verdict = { failed: [{ n: 15, name: 'The loop is alive', detail: 'waves: no enemy came' }, { n: 7, name: 'other', detail: '' }] };
  const v = loopView(draft, verdict);
  assert.equal(v.present, true);
  assert.equal(v.stepWords, 'Your session is repairing what failed');
  assert.deepEqual(v.failures.map(f => f.n), [15], 'only the checks the state names');
  assert.match(v.failures[0].detail, /no enemy came/);
  assert.deepEqual(v.playtest.notes, ['The goal is hidden behind a wall']);
  assert.equal(v.fixes[0].fix, 'fair-on');
  assert.equal(v.staleProof, false);
  assert.equal(loopView({ ...draft, status: 'delivered', outcome: 'delivered-stale-proof' }).staleProof, true);
  const noVerdict = loopView(draft, null);
  assert.equal(noVerdict.failures[0].name, 'check 15', 'a failed id with no verdict file still shows');
  assert.deepEqual(playtestNotes({ issues: [{ text: 'a' }, 'b'] }), ['a', 'b']);
});

test('tune: only safe value slots, staged edits, all "reload"', () => {
  const slots = [
    { id: 'a', kind: 'value', type: 'number', tier: 'main', value: 5, constraints: { min: 0, max: 10 } },
    { id: 'b', kind: 'value', type: 'color', tier: 'main', value: '#fff' },
    { id: 'c', kind: 'file', type: 'model', tier: 'main' },
    { id: 'd', kind: 'value', type: 'boolean', tier: 'advanced', value: true },
    { id: 'e', kind: 'value', type: 'integer', tier: 'main', value: 3, constraints: {} },
  ];
  const t = tunables(slots);
  assert.deepEqual(t.map(s => s.id), ['a', 'e']);
  assert.ok(t.every(s => s.applies === 'reload'));
  assert.deepEqual(sliderRange(slots[0]), { min: 0, max: 10, step: 0.1 });
  assert.equal(sliderRange(slots[4]), null);
  assert.deepEqual(pendingChanges(slots, { a: '5', e: '4', zz: 1 }), [{ id: 'e', value: '4' }], 'unchanged and unknown are dropped');
});

let game, srv, stub, base;
before(async () => {
  game = await tempGame();
  srv = await startDevServer({ gameDir: game.dir, port: 0, log: () => {}, watch: false });
  stub = attachSessionStub(srv);
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => { await srv?.close(); await game?.cleanup(); });
const call = (p, init) => fetch(base + p, init).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('build route: no state, then the state file and the newest verdict', async () => {
  let r = await call('/api/build/state');
  assert.equal(r.status, 200);
  assert.equal(r.body.loop, null);
  assert.deepEqual(r.body.checkpoints, []);
  await mkdir(path.join(game.dir, '.gf-loop'), { recursive: true });
  await writeFile(path.join(game.dir, '.gf-loop', 'state.json'), JSON.stringify(draft));
  r = await call('/api/build/state');
  assert.equal(r.body.loop.step, 'repair');
  assert.equal(r.body.rollback, false);
  r = await call('/api/build/rollback', { method: 'POST', body: JSON.stringify({ id: 'x' }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 501, 'no checkpoint library yet: said plainly');
  r = await call('/api/build/rollback', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
});

test('against the session stub: send, edit, remove, permission; wrong origins refused', async () => {
  const json = (method, body) => ({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  let r = await call('/api/session/request', json('POST', { text: 'faster enemies', selection: { id: 'waves.speed', label: 'Enemy speed' } }));
  assert.equal(r.body.id, 'r1');
  r = await call('/api/session/request/r1', json('PATCH', { text: 'much faster enemies' }));
  assert.equal(r.body.text, 'much faster enemies');
  stub.setState('r1', 'handed');
  assert.equal((await call('/api/session/request/r1', json('PATCH', { text: 'x' }))).status, 409);
  stub.setState('r1', 'waiting');
  assert.equal((await call('/api/session/request/r1', json('DELETE'))).body.removed, 'r1');
  assert.equal((await call('/api/session/queue')).body.requests.length, 0);
  assert.equal((await call('/api/session/permission/p1', json('POST', { decision: 'maybe' }))).status, 400);
  assert.equal((await call('/api/session/permission/p1', json('POST', { decision: 'allow' }))).status, 200);
  assert.deepEqual(stub.decisions, [{ id: 'p1', decision: 'allow' }]);
  const evil = await fetch(base + '/api/session/request', { ...json('POST', { text: 'x' }), headers: { 'content-type': 'application/json', origin: 'http://evil.example' } });
  assert.equal(evil.status, 403, 'another site cannot post requests');
});

test('the studio page and its tabs are served, and every tab imports its modules', async () => {
  const tabs = (await call('/api/studio/tabs')).body.map(t => t.file);
  for (const f of ['session.js', 'build.js', 'tune.js', 'friends.js', 'assets.js']) assert.ok(tabs.includes(f), f);
  for (const f of ['session.js', 'loop-state.js', 'tune.js']) assert.equal((await fetch(`${base}/studio/lib/${f}`)).status, 200, f);
});
