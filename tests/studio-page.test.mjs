// The studio page's modules (no browser), the build route, and the page's calls against the session stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';
import { sessionDriver } from './stubs/session-driver.mjs';
import { IDLE_HINT, LISTENER_IDLE_HINT, NONE_HINT, STALLED_HINT, TERMINAL_NOTE, connection, describeEvent, inputLine, modeNote, normalizeEvent, readQueue, requestWords } from '../studio/lib/session.js';
import { loopView, playtestNotes } from '../studio/lib/loop-state.js';
import {
  cardsOf, defaultOf, endLabels, formatValue, fractionOf, fromSlider, groupIcon, isColourText, niceCeil, optionsOf, pendingChanges, sliderRange,
  snapValue, tunables, unitOf, visualOf,
} from '../studio/lib/tune.js';

test('request states are in words a person understands', () => {
  assert.match(requestWords('waiting').label, /Waiting for your session/);
  assert.match(requestWords('handed').label, /Handed over/);
  assert.match(requestWords('seen').label, /on it/);
  assert.match(requestWords('stalled').label, /Waiting for your session.*Type go/);
  assert.equal(readQueue({ requests: [{ id: 'x', state: 'handed', stalled: true }] }).requests[0].words.label, requestWords('stalled').label, 'a stalled request reads as waiting for the session, never as being worked on');
  assert.equal(requestWords('done').label, 'Done');
  assert.match(requestWords('dropped').label, /send again/i);
  assert.equal(requestWords('waiting').editable, true);
  assert.equal(requestWords('handed').editable, false, 'only a waiting request can be edited');
  assert.equal(requestWords('dropped').again, true);
});

test('events (contract kinds): normalised and described; the rest is left to the queue', () => {
  const e = normalizeEvent('{"seq":4,"t":1,"kind":"tool-start","session":"s","tool":"Edit","input":{"file_path":"config/world.json"}}');
  assert.match(describeEvent(e), /Using Edit: config\/world.json/);
  assert.match(describeEvent(normalizeEvent({ kind: 'prompt', text: 'Requests from the studio page: GF_REQUEST {"id":"r_1"}' })), /handed to your session/, 'a wake is not shown as something the person typed');
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
  assert.equal(idle.hint, IDLE_HINT);
  assert.match(IDLE_HINT, /Type go in its terminal/);
  assert.doesNotMatch(NONE_HINT, /reload-plugins/, 'no session yet: the step needs no plugin and no reload');
  assert.match(NONE_HINT, /session wait/);
  // a session that only the terminal listener reaches (no plugin): never "working" without a request it holds
  const t = o => ({ sessions: [{ id: 'a', state: 'working', connected: false, primary: true, channel: 'terminal', agent: 'claude-code', ...o.s }], requests: o.r ?? [] });
  assert.equal(connection(readQueue(t({ s: { connected: true, listening: 'listener' } }))).state, 'listening');
  assert.match(connection(readQueue(t({ s: { connected: true, listening: 'listener', agent: 'terminal' } }))).hint, /Codex waits for its next turn/, 'an agent that may not wake says so');
  const gone = connection(readQueue(t({ s: {} })));
  assert.equal(gone.state, 'idle', 'its listener closed and it holds nothing: not listening, not working');
  assert.equal(gone.hint, LISTENER_IDLE_HINT);
  const busy = connection(readQueue(t({ s: { tools: 'cli' }, r: [{ id: 'r1', session: 'a', state: 'seen' }] })));
  assert.equal(busy.state, 'working');
  assert.equal(busy.open, 1);
  assert.match(busy.toolsNote, /terminal commands/);
  const stalled = connection(readQueue(t({ s: { state: 'idle' }, r: [{ id: 'r1', session: 'a', state: 'handed', stalled: true }] })));
  assert.equal(stalled.state, 'stalled');
  assert.equal(stalled.hint, STALLED_HINT);
  assert.equal(connection(readQueue(t({ r: [{ id: 'r1', session: 'a', state: 'done' }] }))).state, 'idle', 'a done request is not work in hand');
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

test('tune (Settings): the safe value slots, staged edits, all "reload"', () => {
  const slots = [
    { id: 'a', kind: 'value', type: 'number', tier: 'main', value: 5, constraints: { min: 0, max: 10 } },
    { id: 'b', kind: 'value', type: 'color', tier: 'main', value: '#fff' },
    { id: 'c', kind: 'file', type: 'model', tier: 'main' },
    { id: 'd', kind: 'value', type: 'boolean', tier: 'advanced', value: true },
    { id: 'e', kind: 'value', type: 'integer', tier: 'main', value: 3, constraints: {} },
    { id: 'f', kind: 'value', type: 'text', tier: 'main', value: 'hi' },
  ];
  const t = tunables(slots);
  assert.deepEqual(t.map(s => s.id), ['a', 'b', 'e'], 'numbers, colours; no files, no free text, no advanced tier');
  assert.deepEqual(tunables(slots, { all: true }).map(s => s.id), ['a', 'b', 'd', 'e'], 'all: the advanced tier too');
  assert.ok(t.every(s => s.applies === 'reload'));
  assert.equal(tunables([{ ...slots[0], constraints: { min: 0, max: 10, live: true } }])[0].applies, 'live');
  assert.deepEqual(sliderRange(slots[0]), { min: 0, max: 10, step: 0.1, soft: { min: false, max: false } });
  assert.deepEqual(sliderRange(slots[4]), { min: 0, max: 6, step: 1, soft: { min: true, max: true } }, 'an integer with no range: 0..2×value, whole steps');
  assert.deepEqual(pendingChanges(slots, { a: '5', e: '4', zz: 1 }), [{ id: 'e', value: '4' }], 'unchanged and unknown are dropped');
});

test('tune (Settings): every number gets a slider range, inferred from its constraints, type and value', () => {
  const n = (value, constraints = {}, extra = {}) => ({ id: 'x', label: 'X', kind: 'value', type: 'number', value, constraints, ...extra });
  const r = (s, base) => { const x = sliderRange(s, base); return x && [x.min, x.max, x.step]; };
  assert.deepEqual(r(n(1.15, { min: 0 })), [0, 2.5, 0.01], 'a min only: up to 2×value, rounded up to a round number, on a step the value sits on');
  assert.deepEqual(r(n(3, { min: 0 })), [0, 6, 0.05]);
  assert.deepEqual(r(n(260, { min: 0 })), [0, 600, 5]);
  assert.deepEqual(r(n(0.72, { min: 0 })), [0, 1, 0.01], 'a value between 0 and 1 with no top: a 0–1 fraction');
  assert.deepEqual(r(n(0.35, { min: 0, max: 1 })), [0, 1, 0.01]);
  assert.deepEqual(r(n(55, { min: -180 }, { label: 'Sun height (degrees)' })), [-180, 180, 1], 'degrees (from the label): a full turn from the min');
  assert.deepEqual(r(n(30, { unit: 'deg' })), [0, 360, 1], 'degrees with no range: 0..360');
  assert.deepEqual(r(n(-20, { unit: '°' })), [-180, 180, 1]);
  assert.deepEqual(r(n(-4)), [-8, 8, 0.1], 'a negative value: both ways');
  assert.deepEqual(r(n(0)), [0, 1, 0.01], 'zero: 0..1');
  assert.deepEqual(r({ ...n(0), type: 'integer' }), [0, 10, 1]);
  assert.deepEqual(r(n(5, { max: 100 })), [0, 100, 1], 'a max only: from 0');
  assert.deepEqual(r(n(4, { min: 1, max: 8, step: 0.5 })), [1, 8, 0.5], 'the slot\'s own step wins');
  assert.deepEqual(r(n(30, { min: 0 }), 2), [0, 30, 0.1], 'the value in hand stays reachable when it passes the inferred end');
  assert.equal(sliderRange({ ...n(1), type: 'boolean' }), null, 'not a number: no slider');
  // the range is drawn around the value when the tool opened, never past the slot's own ends
  const own = n(5, { min: 0, max: 10 });
  assert.equal(snapValue(own, 12), 10); assert.equal(snapValue(own, -1), 0);
  assert.equal(snapValue(n(5, { min: 0 }), 40), 40, 'an inferred end is soft: a typed value past it is kept');
  assert.equal(snapValue({ ...own, type: 'integer' }, '3.6'), 4);
  assert.equal(fromSlider(n(1.15, { min: 0 }), sliderRange(n(1.15, { min: 0 })), '1.2300000004'), 1.23);
  assert.equal(niceCeil(2.3), 2.5); assert.equal(niceCeil(520), 600); assert.equal(niceCeil(6), 6); assert.equal(niceCeil(0), 0);
});

test('tune (Settings): how a setting is drawn follows its type and unit, never its id', () => {
  const s = (type, value, constraints = {}, label = 'Thing') => ({ id: 'zz.any-id', label, kind: 'value', type, value, constraints });
  assert.equal(visualOf(s('boolean', true)), 'switch');
  assert.equal(visualOf(s('enum', 'a', { options: ['a', 'b'] })), 'pills');
  assert.equal(visualOf(s('color', '#ff0000')), 'swatches');
  assert.equal(visualOf(s('integer', 4, { min: 1, max: 8 })), 'dots', 'a short count: dots');
  assert.equal(visualOf(s('integer', 6, { min: 1, max: 60 })), 'slider', 'a long count: the slider alone');
  assert.equal(visualOf(s('integer', 90, { min: 30, max: 900, unit: 's' })), 'slider', 'a whole number of seconds is not a count');
  assert.equal(visualOf(s('number', 55, { min: -180 }, 'Sun height (degrees)')), 'dial');
  assert.equal(visualOf(s('number', 0.35, { min: 0, max: 1 })), 'fill');
  assert.equal(visualOf(s('number', 5.2, { min: 1, max: 14, unit: 'm/s' })), 'slider');
  // the same slot under another id is drawn the same
  assert.equal(visualOf({ ...s('number', 0.35, { min: 0, max: 1 }), id: 'look.sun.shadow-strength' }), visualOf(s('number', 0.35, { min: 0, max: 1 })));
});

test('tune (Settings): values and ends in words, units from the slot or its label', () => {
  const s = (type, constraints = {}, label = 'Thing') => ({ id: 'q', label, kind: 'value', type, constraints });
  assert.deepEqual(unitOf(s('number', {}, 'Haze distance (metres)')), { unit: 'm', name: 'Haze distance' });
  assert.deepEqual(unitOf(s('number', {}, 'View (metres across the short side)')), { unit: '', name: 'View (metres across the short side)' }, 'a bracket that is not a unit stays in the name');
  assert.deepEqual(unitOf(s('number', { unit: 's' }, 'Round (minutes)')), { unit: 's', name: 'Round (minutes)' }, 'the slot\'s own unit wins');
  assert.equal(formatValue(s('number', { unit: 's' }), 1.5), '1.5 seconds');
  assert.equal(formatValue(s('number', { unit: 's' }), 1), '1 second');
  assert.equal(formatValue(s('integer', { unit: 's' }), 90), '1 min 30 s');
  assert.equal(formatValue(s('integer', { unit: 's' }), 900), '15 min');
  assert.equal(formatValue(s('number', { unit: 'm/s' }), 5.2), '5.2 m/s');
  assert.equal(formatValue(s('number', {}, 'Height (degrees)'), 55), '55°');
  assert.equal(formatValue(s('number', { min: 0, max: 1 }), 0.72), '72%');
  assert.equal(formatValue(s('number', {}), 0.30000000000000004 * 10), '3');
  assert.equal(formatValue(s('boolean'), true), 'On');
  assert.equal(formatValue({ ...s('enum'), constraints: { options: [{ value: 'golden', label: 'Golden hour' }] } }, 'golden'), 'Golden hour');
  assert.equal(formatValue(s('color'), '#ff5fa2'), '#FF5FA2');
  assert.deepEqual(endLabels({ ...s('number', { min: 0, max: 120, unit: 's' }), value: 4 }), { min: '0 seconds', max: '2 min' });
  assert.deepEqual(optionsOf({ constraints: { options: ['a', { value: 'b', label: 'Bee' }] } }), [{ value: 'a', label: 'a' }, { value: 'b', label: 'Bee' }]);
  assert.ok(isColourText('#fa0') && isColourText('#ffaa00') && isColourText('rgb(1,2,3)') && !isColourText('golden'));
  assert.equal(fractionOf({ min: 0, max: 8 }, 4), 0.5); assert.equal(fractionOf({ min: 0, max: 8 }, 99), 1);
  assert.equal(defaultOf({ constraints: { default: 2 } }, 5), 2, 'the value the game was made with, when the slot says');
  assert.equal(defaultOf({ constraints: {} }, 5), 5, 'else the value when the tool opened');
});

test('tune (Settings): one card per slot group, in the game\'s order, the advanced tier inside', () => {
  const s = (id, group, tier = 'main') => ({ id, group, tier, kind: 'value', type: 'number', value: 1 });
  const cards = cardsOf([s('a', 'rules'), s('b', 'look'), s('c', 'look', 'advanced'), s('d', 'look-times', 'advanced'), s('e', null)],
    [{ id: 'look', label: 'Look & light' }, { id: 'look-times', label: 'Look: times of day' }, { id: 'rules', label: 'Rules & scoring' }]);
  assert.deepEqual(cards.map(c => [c.label, c.main.length, c.more.length]), [['Look & light', 1, 1], ['Rules & scoring', 1, 0], ['Other', 1, 0], ['Look: times of day', 0, 1]],
    'cards with settings to show first, in the manifest\'s group order; advanced-only cards last');
  assert.deepEqual(cards.map(c => c.icon), ['light', 'trophy', 'sliders', 'light'], 'an icon from the group\'s words');
  assert.equal(groupIcon('controls', 'Movement & camera'), 'move');
  assert.equal(groupIcon('whatever', 'Something new'), 'sliders', 'an unknown group: the generic icon');
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
  assert.equal(r.body.rollback, true, 'the route found lib/checkpoint.mjs under the names it asks for');
  // the roll-back button: a checkpoint the loop tools keep (the same store) is listed and restored byte for byte
  const { checkpointStore, treeHash } = await import('../lib/checkpoint.mjs');
  const before = await treeHash(game.dir), rules = path.join(game.dir, 'rules.js'), was = await readFile(rules, 'utf8');
  await checkpointStore(game.dir).keep('round-1', { step: 'agent', kind: 'build', before: true });
  await writeFile(rules, was + '\n// a round wrote this\n');
  await writeFile(path.join(game.dir, 'added-by-the-round.txt'), 'x');
  r = await call('/api/build/state');
  assert.deepEqual(r.body.checkpoints.map(c => [c.id, c.round, c.label]), [['round-1', 1, 'Before round 1 of your session\'s work (build)']]);
  assert.ok(r.body.checkpoints[0].at);
  r = await call('/api/build/rollback', { method: 'POST', body: JSON.stringify({ id: 'round-1' }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.restored, r.body.written, r.body.removed], ['round-1', 1, 1]);
  assert.equal(await treeHash(game.dir), before, 'the folder is what it was');
  assert.equal(await readFile(rules, 'utf8'), was);
  // the run was under way: the roll-back cancels it. This server cannot write the loop's state (the MCP server holds
  // it), so it leaves the mark the loop tools apply; the Build tab and the stop guard read the run as cancelled at once
  const { readCancel, clearCancel } = await import('../lib/cancel.mjs');
  assert.equal(r.body.cancelled.step, 'repair');
  assert.match((await readCancel(game.dir)).reason, /rolled the game back from the studio page to "Before round 1/);
  assert.equal(JSON.parse(await readFile(path.join(game.dir, '.gf-loop', 'state.json'), 'utf8')).status, 'building', 'the state file is the loop library\'s: not written here');
  r = await call('/api/build/state');
  assert.deepEqual([r.body.loop.status, r.body.loop.step], ['cancelled', 'done']);
  // a session there is told once at its next turn end (one refusal), and is then free: the build no longer holds it
  const { bridgeFor } = await import('../server/routes/session.mjs');
  const bridge = bridgeFor(srv.url).bridge;
  bridge.event('session-start', { session: 'RB', cwd: game.dir, mode: 'default' });
  let st = await bridge.stop({ session: 'RB', cwd: game.dir });
  assert.deepEqual(st.reasons, ['rolled-back']);
  assert.match(st.refuse, /rolled the game back.*Before round 1.*do not put the undone changes back.*gamesfun_next/s);
  st = await bridge.stop({ session: 'RB', cwd: game.dir });
  assert.equal(st.refuse, null, 'told once; a cancelled run holds nobody');
  bridge.event('session-end', { session: 'RB', reason: 'exit' });
  await clearCancel(game.dir);
  r = await call('/api/build/rollback', { method: 'POST', body: JSON.stringify({ id: 'round-9' }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400, 'an unknown checkpoint is refused');
  assert.match(r.body.error, /no checkpoint/);
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

test('a request the session ends two turns without reporting is reminded once, then stalls (not dropped); the page says it waits for the session', async () => {
  const s = await sessionDriver(base, { id: 'drop-1', cwd: game.dir });
  try {
    await s.start();
    const w = await s.wait();
    const r = (await s.call('POST', 'request', { text: 'add a boss' })).body;
    await until(() => w.lines.length);
    await new Promise(res => setTimeout(res, 3200));   // the rule: a request handed less than 3 s ago is not refused at the stop
    assert.equal((await s.stop()).body.decision, 'block');
    for (let i = 0; i < 3; i++) assert.notEqual((await s.stop()).body?.decision, 'block', 'quiet after one reminder');
    const q = readQueue(await s.queue());
    const mine = q.requests.find(x => x.id === r.id);
    assert.equal(mine.state, 'handed');
    assert.equal(mine.stalled, true);
    assert.match(mine.words.label, /Waiting for your session/);
    assert.equal(connection({ ...q, sessions: q.sessions.filter(x => x.id === 'drop-1').map(x => ({ ...x, primary: true })) }).state, 'stalled');
  } finally { s.closeAll(); await s.end(); }
});

test('the studio page and its tabs are served, and every tab imports its modules', async () => {
  const tabs = (await call('/api/studio/tabs')).body.map(t => t.file);
  for (const f of ['tune.js', 'friends.js', 'assets.js']) assert.ok(tabs.includes(f), f);
  // the session and the build are the conversation on the left (studio/chat.js), not tools
  for (const f of ['session.js', 'build.js']) assert.ok(!tabs.includes(f), f);
  for (const f of ['chat.js', 'start.js']) assert.equal((await fetch(`${base}/studio/${f}`)).status, 200, f);
  for (const f of ['session.js', 'session-client.js', 'loop-state.js', 'tune.js']) assert.equal((await fetch(`${base}/studio/lib/${f}`)).status, 200, f);
});
