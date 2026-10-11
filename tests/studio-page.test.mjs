// The studio page's modules (no browser), the build route, and the page's calls against the session stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';
import { sessionDriver } from './stubs/session-driver.mjs';
import { IDLE_HINT, TERMINAL_NOTE, connection, describeEvent, inputLine, modeNote, normalizeEvent, readQueue, requestWords } from '../studio/lib/session.js';
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

test('events (contract kinds): normalised and described; the rest is left to the queue', () => {
  const e = normalizeEvent('{"seq":4,"t":1,"kind":"tool-start","session":"s","tool":"Edit","input":{"file_path":"config/world.json"}}');
  assert.match(describeEvent(e), /Using Edit: config\/world.json/);
  assert.equal(normalizeEvent('not json'), null);
  assert.equal(normalizeEvent({ type: 'old shape' }), null, 'no kind, no event');
  assert.equal(describeEvent(normalizeEvent({ kind: 'tool-end', ok: true })), null);
  assert.match(describeEvent(normalizeEvent({ kind: 'tool-end', tool: 'Bash', ok: false })), /failed/);
  assert.match(describeEvent(normalizeEvent({ kind: 'tool-end', tool: 'Bash', denied: true })), /denied/);
  assert.match(describeEvent(normalizeEvent({ kind: 'stop', allowed: false, reasons: ['build'] })), /build is not finished/);
  assert.equal(describeEvent(normalizeEvent({ kind: 'stop', allowed: true })), 'Your session finished its turn');
  assert.equal(describeEvent(normalizeEvent({ kind: 'hello' })), null);
  assert.equal(describeEvent(normalizeEvent({ kind: 'request', request: {} })), null);
  assert.equal(inputLine({ command: 'npm test' }), 'npm test');
});

test('queue: requests get words, removed ones are hidden, only waiting permissions are cards', () => {
  const q = readQueue({ requests: [{ id: 'a', text: 'faster', state: 'dropped' }, { id: 'b', text: 'x' }, { text: 'no id' }],
    permissions: [{ id: 'p1', tool: 'Bash', input: { command: 'npm test' }, state: 'waiting' }, { id: 'p2', tool: 'Edit', state: 'retired' }, { id: 'p3', tool: 'Edit', state: 'allow' }] }, new Set(['b']));
  assert.deepEqual(q.requests.map(r => r.id), ['a']);
  assert.equal(q.requests[0].words.again, true);
  assert.deepEqual(q.permissions.map(p => [p.id, p.line]), [['p1', 'npm test']]);
  assert.deepEqual(readQueue(null).requests, []);
  assert.match(TERMINAL_NOTE, /terminal can answer this too/);
});

test('connection: what the contract says for each session state', () => {
  const s = o => ({ sessions: [{ id: 'a', state: 'working', connected: false, primary: true, permissionMode: 'default', ...o }] });
  assert.equal(connection(readQueue(null)).state, 'none');
  assert.equal(connection(readQueue({ sessions: [{ state: 'ended' }] })).state, 'none');
  assert.equal(connection(readQueue(s({}))).state, 'working');
  const idle = connection(readQueue(s({ state: 'idle' })));
  assert.equal(idle.state, 'idle');
  assert.match(idle.hint, /Press Enter in the terminal/);
  assert.match(IDLE_HINT, /reconnect/);
  assert.equal(connection(readQueue(s({ state: 'idle', connected: true }))).state, 'listening', 'an open wait reaches an idle session');
  const m = connection(readQueue(s({ permissionMode: 'acceptEdits' })));
  assert.equal(m.mode, 'acceptEdits');
  assert.match(modeNote(m.mode), /acceptEdits\) answers before this page does/);
  assert.equal(connection(readQueue(s({ guard: { status: 'waiting-on-question', why: 'x' } }))).guard.why, 'x');
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

let game, srv, base;
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out waiting'); };
before(async () => {
  game = await tempGame();
  srv = await startDevServer({ gameDir: game.dir, port: 0, log: () => {}, watch: false });
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
  await rm(path.join(game.dir, '.gf-loop'), { recursive: true, force: true });   // a building game would hold every stop in the bridge tests below
});

test('against the REAL bridge routes, driven by the plugin\'s hook posts: token, send, edit, remove, permission; wrong origins refused', async () => {
  const same = { 'sec-fetch-site': 'same-origin' };
  const tok = (await call('/api/session/token', { headers: same })).body.token;
  assert.equal((await call('/api/session/token')).status, 403, 'the token needs a same-origin fetch');
  const j = (method, body, extra = {}) => ({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-gamesfun-token': tok, ...extra } });
  assert.equal((await call('/api/session/queue')).status, 401);
  let r = await call('/api/session/request', j('POST', { text: 'faster enemies', selection: { id: 'waves.speed', label: 'Enemy speed' } }));
  const id = r.body.id;
  assert.equal(r.body.state, 'waiting');
  r = await call(`/api/session/request/${id}`, j('PATCH', { text: 'much faster enemies' }));
  assert.equal(r.body.text, 'much faster enemies');
  assert.equal((await call(`/api/session/request/${id}`, j('DELETE'))).body.state, 'dropped');
  assert.equal((await call(`/api/session/request/${id}`, j('PATCH', { text: 'x' }))).status, 409);
  assert.equal((await call(`/api/session/request/${id}`, j('DELETE'))).status, 409, 'a dropped request cannot be removed again: the page only hides it');
  const evil = await fetch(base + '/api/session/request', j('POST', { text: 'x' }, { origin: 'http://evil.example' }));
  assert.equal(evil.status, 403, 'another site cannot post requests');
});

test('a request travels waiting → handed → seen → done, and the page lib says so (real routes, hook posts, tool routes)', async () => {
  const s = await sessionDriver(base, { id: 'flow-1', cwd: game.dir });
  try {
    await s.start();
    let q = readQueue(await s.queue());
    assert.equal(connection(q).state, 'idle', 'just started, waiting for a first prompt');
    await s.prompt('hello');
    assert.equal(connection(readQueue(await s.queue())).state, 'working', 'mid-turn with no wait open is normal');
    await s.stop();                                 // the turn ended: the session is idle, no wait open
    const sent = (await s.call('POST', 'request', { text: 'make the enemies faster', selection: { id: 'waves.speed' } })).body;
    assert.equal(sent.state, 'waiting', 'idle with no wait open: it waits');
    assert.equal(sent.session, 'flow-1', 'no session named: the primary one');
    assert.equal(readQueue(await s.queue()).requests.at(-1).words.editable, true);
    q = readQueue(await s.queue());
    const sess = q.sessions.find(x => x.id === 'flow-1');
    assert.equal(sess.state, 'idle');
    assert.equal(sess.connected, false);
    assert.equal(connection(q).state, 'idle');
    assert.match(connection(q).hint, new RegExp(IDLE_HINT.slice(0, 20)));
    const w = await s.wait();                       // the plugin's wait opens: the waiting request is handed at once
    await until(() => w.lines.length);
    assert.equal(w.lines[0].type, 'requests');
    assert.match(w.lines[0].text, /GF_REQUEST/);
    q = readQueue(await s.queue());
    const mine = q.requests.find(x => x.id === sent.id);
    assert.equal(mine.state, 'handed');
    assert.equal(mine.via, 'wake');
    assert.match(mine.words.label, /Handed over/);
    await s.prompt(w.lines[0].text);                // the wake becomes a prompt: seen
    assert.equal(readQueue(await s.queue()).requests.find(x => x.id === sent.id).state, 'seen');
    const got = (await s.collect()).body;
    assert.equal(got.requests[0].id, sent.id);
    const rep = (await s.done(sent.id, 'speed 4 to 6')).body;
    assert.equal(rep.state, 'done');
    q = readQueue(await s.queue());
    assert.equal(q.requests.find(x => x.id === sent.id).words.label, 'Done');
    assert.equal(q.requests.find(x => x.id === sent.id).note, 'speed 4 to 6');
  } finally { s.closeAll(); await s.end(); }
});

test('permissions: a held PermissionRequest hook is answered by the page\'s click, allow and deny', async () => {
  const s = await sessionDriver(base, { id: 'perm-1', cwd: game.dir });
  try {
    await s.start();
    const held = s.ask('Bash', { command: 'npm test' });
    await until(async () => readQueue(await s.queue()).permissions.length);
    const q = readQueue(await s.queue());
    assert.equal(q.permissions.length, 1);
    assert.equal(q.permissions[0].tool, 'Bash');
    assert.equal(q.permissions[0].line, 'npm test');
    const pid = q.permissions[0].id;
    assert.equal((await s.call('POST', `permission/${pid}`, { decision: 'maybe' })).status, 400);
    assert.equal((await s.call('POST', `permission/${pid}`, { decision: 'allow' })).body.state, 'allow');
    const out = await held;
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    assert.equal((await s.call('POST', `permission/${pid}`, { decision: 'deny' })).status, 409);
    assert.equal(readQueue(await s.queue()).permissions.length, 0, 'answered: no card');
    const held2 = s.ask('Edit', { file_path: 'rules.js' });
    await until(async () => readQueue(await s.queue()).permissions.length);
    const pid2 = readQueue(await s.queue()).permissions[0].id;
    await s.call('POST', `permission/${pid2}`, { decision: 'deny', message: 'not that file' });
    assert.deepEqual((await held2).body.hookSpecificOutput.decision, { behavior: 'deny', message: 'not that file' });
    // the person answers in the terminal instead: the next event for that session retires the card
    const held3 = s.ask('Bash', { command: 'ls' });
    await until(async () => readQueue(await s.queue()).permissions.length);
    await s.tool('Bash', { command: 'ls' });
    await until(async () => !readQueue(await s.queue()).permissions.length);
    await s.stop();
    assert.equal((await held3).text, '', 'retired: an empty 200, the terminal decides');
  } finally { s.closeAll(); await s.end(); }
});

test('the stop guard: a building game refuses the stop three times, then the session is marked waiting for the person', async () => {
  const s = await sessionDriver(base, { id: 'guard-1', cwd: game.dir });
  const stateFile = path.join(game.dir, '.gf-loop', 'state.json');
  try {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ ...draft, status: 'building', step: 'verify', why: 'checking the build' }));
    await s.start();
    for (let i = 0; i < 3; i++) {
      const r = await s.stop();
      assert.equal(r.body.decision, 'block', `refusal ${i + 1}`);
      assert.match(r.body.reason, /verify/);
    }
    const last = await s.stop();
    assert.match(last.body.systemMessage, /./, 'the guard gives up and says so in the terminal');
    const sess = (await s.queue()).sessions.find(x => x.id === 'guard-1');
    assert.equal(sess.guard.status, 'waiting-on-question');
    assert.match(connection(readQueue(await s.queue())).guard.status, /waiting-on-question/);
  } finally { await rm(path.join(game.dir, '.gf-loop'), { recursive: true, force: true }); s.closeAll(); await s.end(); }
});

test('a request the session ends two turns without reporting is dropped, and the page offers to send it again', async () => {
  const s = await sessionDriver(base, { id: 'drop-1', cwd: game.dir });
  try {
    await s.start();
    const w = await s.wait();
    const r = (await s.call('POST', 'request', { text: 'add a boss' })).body;
    await until(() => w.lines.length);
    await new Promise(res => setTimeout(res, 3200));   // the rule: a request handed less than 3 s ago is not refused at the stop
    for (let i = 0; i < 2; i++) assert.equal((await s.stop()).body.decision, 'block');
    await s.stop();
    const mine = readQueue(await s.queue()).requests.find(x => x.id === r.id);
    assert.equal(mine.state, 'dropped');
    assert.equal(mine.words.again, true);
  } finally { s.closeAll(); await s.end(); }
});

test('the studio page and its tabs are served, and every tab imports its modules', async () => {
  const tabs = (await call('/api/studio/tabs')).body.map(t => t.file);
  for (const f of ['session.js', 'build.js', 'tune.js', 'friends.js', 'assets.js']) assert.ok(tabs.includes(f), f);
  for (const f of ['session.js', 'session-client.js', 'loop-state.js', 'tune.js']) assert.equal((await fetch(`${base}/studio/lib/${f}`)).status, 200, f);
});
