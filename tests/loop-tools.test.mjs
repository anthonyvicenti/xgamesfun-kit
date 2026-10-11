// The build loop as tools (mcp/tools/loop.mjs): the order is held by the tools, a tool out of order is refused with
// the right one, a build is picked up from its state file, and a round can be rolled back byte for byte.
// The kit's own create, fix and promise scripts run for real; only the browser steps are stood in (a verify that
// writes the verdict it is told to), so this file needs no Chrome. tests/smoke.test.mjs covers the real verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { normalizeVerdict } from '../kits/research/gf-three/loop/index.mjs';
import { checkpointStore, gameFiles, treeHash } from '../lib/checkpoint.mjs';
import { KIT_ROOT, KITS } from '../lib/paths.mjs';
import { createServer, loadTools, offered, INSTRUCTIONS } from '../mcp/server.mjs';
import * as loop from '../mcp/tools/loop.mjs';
import * as requests from '../mcp/tools/loop-requests.mjs';
import { generatedDrift, generatedFiles } from '../scripts/gen-loop.mjs';

const DEV_SPEC = path.join(KITS, 'research', 'studio-v2', 'specs', 'dev-dodgeball.spec.json');
const ctx = { log: () => {}, progress: () => {}, runCli: async () => ({ code: 0, stdout: '', stderr: '' }) };
const parse = r => (r?.content ? JSON.parse(r.content[0].text) : r);

/** A scratch game folder and a caller for one copy of the tools. `verdicts`: what each full verify answers, in order. */
async function bench(t, { verdicts = [], own = { ok: true, why: 'stand-in' } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gf-loop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const game = path.join(root, 'my-game'), G = loop.places(game);
  const stand = {
    ownVerify: async () => own,
    verify: async (g, out) => {
      const ok = verdicts.length ? verdicts.shift() : true;
      const v = { pass: ok, checks: [{ n: 3, name: 'boots to play', ok: true }, { n: 6, name: 'a round ends', ok: true }, { n: 13, name: 'every control works', ok, detail: ok ? '' : 'KeyE does nothing you can see', rule: 'List only controls that work.', fix: 'Make E do its part or take it out of controls.' }] };
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, 'verdict.json'), JSON.stringify(v));
      return { ...normalizeVerdict(v), outDir: out };
    },
  };
  const use = mod => { mod.seams.tools = stand; const by = Object.fromEntries(mod.tools.map(x => [x.name, x])); return async (name, args = {}) => parse(await by[name].handler({ game, ...args }, ctx)); };
  t.after(() => { loop.seams.tools = null; });
  return { root, game, G, call: use(loop), use, verdicts };
}
const lockSpec = async b => {
  await b.call('gamesfun_step_pitch', { idea: 'dodgeball in the playground with friends' });
  await mkdir(b.G.job, { recursive: true });
  await copyFile(DEV_SPEC, b.G.spec);
  return b.call('gamesfun_step_spec');
};
const answerAll = async (b, pass = true) => {
  const list = JSON.parse(await readFile(path.join(b.G.playtest, 'promises.json'), 'utf8'));
  return b.call('gamesfun_playtest_report', { report: { verdict: pass ? 'pass' : 'fail', promises: list.promises.map((x, i) => ({ id: x.id, pass: pass || i > 0, evidence: [], note: pass || i > 0 ? 'I saw it happen.' : 'Nothing happened on my screen.' })), feel: [], summary: 'Played a round.' } });
};
const state = async b => JSON.parse(await readFile(b.G.state, 'utf8'));
const DONE = { summary: 'Throw balls at your friends; last one standing scores.', controls: 'WASD move, mouse aim, click throw, E pick up' };

test('the order is held: each tool is refused until its step, and names the right tool', async t => {
  const b = await bench(t, { verdicts: [false, true] });
  const seq = [];
  const call = async (n, a) => { const r = await b.call(n, a); seq.push(`${n}${r.refused ? ` (refused: ${r.refused})` : ''}`); return r; };

  let r = await call('gamesfun_next');
  assert.equal(r.phase, 'none'); assert.equal(r.next.tool, 'gamesfun_step_pitch');
  for (const tool of ['gamesfun_step_spec', 'gamesfun_step_create', 'gamesfun_step_fix', 'gamesfun_step_verify', 'gamesfun_step_playtest', 'gamesfun_step_deliver']) {
    r = await call(tool);
    assert.equal(r.refused, 'out-of-order', tool); assert.equal(r.next.tool, 'gamesfun_step_pitch', tool);
  }
  assert.equal(existsSync(b.G.state), false, 'a refused tool writes nothing');

  r = await call('gamesfun_step_pitch', { idea: 'dodgeball in the playground with friends' });
  assert.match(r.round.brief, /dodgeball in the playground/); assert.equal(r.next.tool, 'gamesfun_step_spec');
  assert.equal((await state(b)).status, 'building');
  r = await call('gamesfun_step_create');
  assert.equal(r.refused, 'out-of-order'); assert.equal(r.next.tool, 'gamesfun_step_spec');

  // an answer that is not a spec the kit can build: the problems and one repair round, then a valid one locks
  await mkdir(b.G.job, { recursive: true });
  const spec = JSON.parse(await readFile(DEV_SPEC, 'utf8'));
  await writeFile(b.G.spec, JSON.stringify({ ...spec, mechanics: [{ id: 'no-such-mechanic' }] }));
  r = await call('gamesfun_step_spec');
  assert.equal(r.valid, false); assert.match(r.round.brief, /not valid yet/); assert.match(r.round.brief, /mechanics/);
  r = await call('gamesfun_step_spec', { spec, pitch: {} });
  assert.equal(r.refused, 'two-answers');
  r = await call('gamesfun_step_spec', { spec });          // the answer may be passed to the tool, which writes the file
  assert.equal(r.outcome, 'locked'); assert.equal(r.next.tool, 'gamesfun_step_create');
  assert.deepEqual(JSON.parse(await readFile(b.G.spec, 'utf8')), spec);
  assert.equal(existsSync(path.join(b.game, 'index.html')), false, 'nothing is built before create');

  r = await call('gamesfun_step_verify');
  assert.equal(r.refused, 'out-of-order'); assert.equal(r.next.tool, 'gamesfun_step_create');
  r = await call('gamesfun_step_create');
  assert.equal(r.step, 'agent'); assert.equal(r.round.checkpoint, 'round-1'); assert.equal(r.next.tool, 'gamesfun_step_fix');
  assert.match(r.round.brief, /# Build round: Recess Rumble/);
  assert.match(r.round.brief, /`projectile`:/, 'the brief carries the notes of this game\'s own mechanics');
  assert.doesNotMatch(r.round.brief, /\{\{[A-Z_]+\}\}/, 'no placeholder is left in the brief');
  assert.ok(existsSync(path.join(b.game, 'rules.js')));
  assert.ok(JSON.parse(await readFile(path.join(b.game, 'assets.json'), 'utf8')).ignore.some(i => i.path === '.gf-loop/**'), 'the loop\'s folder is not a game asset');

  for (const tool of ['gamesfun_step_verify', 'gamesfun_step_playtest', 'gamesfun_step_deliver', 'gamesfun_step_create', 'gamesfun_step_pitch']) {
    r = await call(tool);
    assert.equal(r.refused, 'out-of-order', tool); assert.equal(r.next.tool, 'gamesfun_step_fix', tool);
  }
  r = await call('gamesfun_step_fix');
  assert.equal(r.refused, 'no-summary');
  await writeFile(path.join(b.game, 'rules.js'), `${await readFile(path.join(b.game, 'rules.js'), 'utf8')}\n// round 1\n`);
  r = await call('gamesfun_step_fix', DONE);
  assert.deepEqual(r.ran, ['agent', 'fix']); assert.equal(r.next.tool, 'gamesfun_step_verify');
  r = await call('gamesfun_step_deliver');
  assert.equal(r.refused, 'out-of-order'); assert.equal(r.next.tool, 'gamesfun_step_verify');

  // the full verify fails: a repair round with the failed check's rule and fix, and a checkpoint before it
  r = await call('gamesfun_step_verify');
  assert.equal(r.verify.pass, false); assert.equal(r.step, 'repair'); assert.equal(r.round.checkpoint, 'round-2');
  assert.match(r.round.brief, /Rule: List only controls that work\./); assert.match(r.round.brief, /Fix: Make E do its part/);
  assert.match(r.round.brief, /gamesfun_step_fix/);
  r = await call('gamesfun_step_playtest');
  assert.equal(r.refused, 'out-of-order'); assert.equal(r.next.tool, 'gamesfun_step_fix');
  await writeFile(path.join(b.game, 'rules.js'), `${await readFile(path.join(b.game, 'rules.js'), 'utf8')}\n// repair 1\n`);
  r = await call('gamesfun_step_fix', DONE);
  assert.deepEqual(r.ran, ['repair', 'fix']);
  r = await call('gamesfun_step_verify');
  assert.equal(r.verify.pass, true); assert.equal(r.next.tool, 'gamesfun_step_playtest');

  // the play-test: handed over; no report, an old report and changed files are each refused
  r = await call('gamesfun_step_playtest');
  assert.equal(r.round.agent, 'playtester'); assert.equal(r.round.checkpoint, 'playtest-1');
  assert.ok(existsSync(path.join(b.G.playtest, 'PLAYTEST.md')));
  r = await call('gamesfun_step_deliver');
  assert.equal(r.refused, 'out-of-order');
  r = await call('gamesfun_step_playtest');
  assert.equal(r.refused, 'no-report');
  const report = path.join(b.G.playtest, 'out', 'playtest.json');
  await writeFile(report, JSON.stringify({ verdict: 'pass', promises: [], feel: [], summary: 'an old report' }));
  const old = new Date(Date.now() - 3600e3);
  await utimes(report, old, old);
  r = await call('gamesfun_step_playtest');
  assert.equal(r.refused, 'stale-playtest'); assert.match(r.why, /older than this play-test round/);
  r = await call('gamesfun_playtest_report', { report: { verdict: 'pass' } });
  assert.equal(r.refused, 'bad-report');
  r = await answerAll(b);
  assert.equal(r.verdict, 'pass'); assert.equal(r.answered, r.asked);
  await writeFile(path.join(b.game, 'config', 'late.json'), '{"changed":"while the play-tester played"}');
  r = await call('gamesfun_step_playtest');
  assert.equal(r.refused, 'stale-playtest'); assert.match(r.why, /files changed after the play-tester/);
  assert.deepEqual(r.next, { tool: 'gamesfun_rollback', args: { game: b.game.split(path.sep).join('/'), checkpoint: 'playtest-1' } });
  assert.equal((await state(b)).step, 'playtest', 'a refused report leaves the loop where it was');
  r = await call('gamesfun_rollback', { checkpoint: 'playtest-1' });
  assert.deepEqual(r.removed, ['config/late.json']);
  r = await call('gamesfun_step_playtest');
  assert.equal(r.playtest.ok, true); assert.equal(r.next.tool, 'gamesfun_step_deliver');

  r = await call('gamesfun_step_deliver');
  assert.equal(r.outcome, 'delivered'); assert.equal(r.status, 'delivered'); assert.deepEqual(r.proof.stale, []);
  assert.equal(r.delivery.summary, DONE.summary);
  const s = await state(b);
  assert.equal(s.schema, 'gf-loop/1'); assert.equal(s.status, 'delivered');
  assert.deepEqual(s.history.map(h => h.step), ['create', 'agent', 'fix', 'verify', 'repair', 'fix', 'verify', 'playtest', 'deliver'], 'no step was skipped');
  r = await call('gamesfun_step_deliver');
  assert.equal(r.refused, 'out-of-order');
  t.diagnostic(seq.filter(x => !/refused/.test(x)).join(' → '));
});

test('stale proof is refused at delivery: a file changed after verify sends the loop back to verify', async t => {
  const b = await bench(t);
  await lockSpec(b);
  await b.call('gamesfun_step_create');
  await b.call('gamesfun_step_fix', DONE);
  await b.call('gamesfun_step_verify');
  await b.call('gamesfun_step_playtest');
  await answerAll(b);
  let r = await b.call('gamesfun_step_playtest');
  assert.equal(r.next.tool, 'gamesfun_step_deliver');
  await writeFile(path.join(b.game, 'rules.js'), `${await readFile(path.join(b.game, 'rules.js'), 'utf8')}\n// a late edit\n`);
  r = await b.call('gamesfun_next');
  assert.deepEqual(r.proof.stale, ['stale-verify', 'stale-playtest']);
  r = await b.call('gamesfun_step_deliver');
  assert.equal(r.delivered, false); assert.equal(r.step, 'verify'); assert.match(r.why, /stale proof/); assert.equal(r.next.tool, 'gamesfun_step_verify');
  assert.equal((await state(b)).status, 'building');
  await b.call('gamesfun_step_verify');
  r = await b.call('gamesfun_step_deliver');
  assert.equal(r.delivered, false); assert.equal(r.refused, 'stale-playtest'); assert.equal(r.next.tool, 'gamesfun_step_playtest');
  await b.call('gamesfun_step_playtest');
  await answerAll(b);
  await b.call('gamesfun_step_playtest');
  r = await b.call('gamesfun_step_deliver');
  assert.equal(r.outcome, 'delivered');
});

test('resume: a new copy of the tools picks a build up at the right step, with the round\'s brief', async t => {
  const b = await bench(t, { verdicts: [false, true] });
  await lockSpec(b);
  const first = await b.call('gamesfun_step_create');
  // a new session: nothing but the files (a fresh copy of the module, as a new MCP server process has)
  const fresh = async tag => b.use(await import(`${pathToFileURL(path.join(KIT_ROOT, 'mcp', 'tools', 'loop.mjs')).href}?session=${tag}`));
  let call = await fresh('a');
  let r = await call('gamesfun_next');
  assert.equal(r.step, 'agent'); assert.equal(r.status, 'building'); assert.equal(r.next.tool, 'gamesfun_step_fix');
  assert.equal(r.round.brief, first.round.brief, 'the round\'s brief is given again');
  assert.equal(r.round.checkpoint, 'round-1');
  r = await call('gamesfun_step_verify');
  assert.equal(r.refused, 'out-of-order');
  await call('gamesfun_step_fix', DONE);
  call = await fresh('b');
  r = await call('gamesfun_next');
  assert.equal(r.step, 'verify'); assert.equal(r.next.tool, 'gamesfun_step_verify');
  r = await call('gamesfun_step_verify');
  assert.equal(r.step, 'repair');
  call = await fresh('c');
  r = await call('gamesfun_next');
  assert.equal(r.step, 'repair'); assert.match(r.round.brief, /KeyE does nothing/); assert.equal(r.rounds.repairs, 1);
  await call('gamesfun_step_fix', DONE);
  await call('gamesfun_step_verify');
  await call('gamesfun_step_playtest');
  call = await fresh('d');
  r = await call('gamesfun_next');
  assert.equal(r.step, 'playtest'); assert.equal(r.round.agent, 'playtester'); assert.match(r.round.brief, /PLAYTEST\.md/);
  await answerAll(b);
  await call('gamesfun_step_playtest');
  call = await fresh('e');
  r = await call('gamesfun_step_deliver');
  assert.equal(r.outcome, 'delivered');
  assert.deepEqual((await state(b)).history.map(h => h.step), ['create', 'agent', 'fix', 'verify', 'repair', 'fix', 'verify', 'playtest', 'deliver']);
});

test('the one reminder: a round that ends without a passing quick verify gets it, also across a restart', async t => {
  const own = { ok: false, why: 'its last verify (verify-2) failed check 7' };
  const b = await bench(t, { own });
  await lockSpec(b);
  await b.call('gamesfun_step_create');
  let r = await b.call('gamesfun_step_fix', DONE);
  assert.deepEqual(r.ran, ['agent', 'fix']); assert.equal(r.step, 'agent'); assert.equal(r.round.kind, 'reminder'); assert.equal(r.round.checkpoint, 'round-2');
  assert.match(r.round.brief, /without a passing verify --quick/); assert.match(r.round.brief, /failed check 7/); assert.equal(r.next.tool, 'gamesfun_step_fix');
  // a new process (the session was closed in the reminder round): the round ends and the loop goes on to the full verify
  const call = b.use(await import(`${pathToFileURL(path.join(KIT_ROOT, 'mcp', 'tools', 'loop.mjs')).href}?session=reminder`));
  r = await call('gamesfun_next');
  assert.equal(r.round.kind, 'reminder'); assert.match(r.round.brief, /failed check 7/);
  r = await call('gamesfun_step_fix', DONE);
  assert.deepEqual(r.ran, ['agent', 'fix']); assert.equal(r.step, 'verify'); assert.equal(r.next.tool, 'gamesfun_step_verify');
});

test('rollback: a round is undone and the folder is byte for byte what it was', async t => {
  const b = await bench(t);
  await lockSpec(b);
  await b.call('gamesfun_step_create');
  const snapshot = async () => { const out = new Map(); for (const rel of (await gameFiles(b.game)).files) out.set(rel, await readFile(path.join(b.game, ...rel.split('/')))); return out; };
  const before = await snapshot(), hash = await treeHash(b.game);
  // the round: a file edited, a kit copy damaged, a file deleted, files added in new folders
  await writeFile(path.join(b.game, 'rules.js'), 'export default {};\n');
  await writeFile(path.join(b.game, 'config', 'game.json'), '{"broken":true}');
  await rm(path.join(b.game, 'ATTRIBUTION.md'));
  await mkdir(path.join(b.game, 'assets', 'new', 'deep'), { recursive: true });
  await writeFile(path.join(b.game, 'assets', 'new', 'deep', 'thing.bin'), Buffer.from([0, 255, 1, 254]));
  await writeFile(path.join(b.game, 'notes.txt'), 'scratch');
  assert.notEqual(await treeHash(b.game), hash);
  let r = await b.call('gamesfun_rollback', { round: 7 });
  assert.equal(r.refused, 'no-checkpoint'); assert.ok(r.checkpoints.includes('round-1'));
  r = await b.call('gamesfun_rollback');
  assert.equal(r.restored, 'round-1');
  assert.deepEqual(r.written.sort(), ['ATTRIBUTION.md', 'config/game.json', 'rules.js']);
  assert.deepEqual(r.removed.sort(), ['assets/new/deep/thing.bin', 'notes.txt']);
  const after = await snapshot();
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [rel, buf] of before) assert.ok(buf.equals(after.get(rel)), rel);
  assert.equal(await treeHash(b.game), hash);
  assert.equal(existsSync(path.join(b.game, 'assets', 'new')), false, 'folders the round made are gone');
  // the loop stands where it stood: the round is still the session's
  r = await b.call('gamesfun_next');
  assert.equal(r.step, 'agent'); assert.equal(r.next.tool, 'gamesfun_step_fix');
});

test('a checkpoint store keeps each file once and refuses to restore from a damaged store', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gf-cp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'a', 'b'), { recursive: true });
  await mkdir(path.join(dir, '.gf-loop'), { recursive: true });
  await writeFile(path.join(dir, 'a', 'b', 'x.txt'), 'one');
  await writeFile(path.join(dir, 'y.txt'), 'one');
  await writeFile(path.join(dir, '.gf-loop', 'state.json'), '{}');
  const cp = checkpointStore(dir);
  const k1 = await cp.keep('round-1', { step: 'agent' });
  assert.equal(k1.files, 2); assert.equal(k1.added, 1, 'two files with the same bytes are stored once');
  await writeFile(path.join(dir, 'y.txt'), 'two');
  const k2 = await cp.keep('round-2');
  assert.equal(k2.added, 1); assert.equal(await cp.next('round'), 3);
  assert.deepEqual((await cp.list()).map(c => c.name), ['round-1', 'round-2']);
  await writeFile(path.join(dir, '.gf-loop', 'state.json'), '{"later":true}');
  const r = await cp.restore('round-1');
  assert.deepEqual(r.written, ['y.txt']); assert.equal(await readFile(path.join(dir, 'y.txt'), 'utf8'), 'one');
  assert.equal(await readFile(path.join(dir, '.gf-loop', 'state.json'), 'utf8'), '{"later":true}', 'the loop\'s own folder is never restored');
  await assert.rejects(() => cp.keep('../escape'), /lowercase letters/);
  await assert.rejects(() => cp.restore('round-9'), /no checkpoint/);
  // damage: the stored copy of y.txt at round-2 is gone → nothing is changed
  const m = await cp.get('round-2');
  await rm(path.join(cp.dir, 'objects', m.files['y.txt'].slice(0, 2), m.files['y.txt']));
  await writeFile(path.join(dir, 'a', 'b', 'x.txt'), 'edited');
  await assert.rejects(() => cp.restore('round-2'), /damaged/);
  assert.equal(await readFile(path.join(dir, 'a', 'b', 'x.txt'), 'utf8'), 'edited');
});

test('asking the person: the first round ends the build waiting on a question; a change is a new run of the same loop', async t => {
  const b = await bench(t);
  let r = await b.call('gamesfun_ask', { message: 'I should not build this.' });
  assert.equal(r.refused, 'out-of-order');
  await lockSpec(b);
  await b.call('gamesfun_step_create');
  r = await b.call('gamesfun_change', { request: 'make the balls red' });
  assert.equal(r.refused, 'out-of-order', 'no change while a build is under way');
  r = await b.call('gamesfun_ask', { message: 'This plan needs a mechanic the kit does not have.', questions: [{ id: 'plan', text: 'Simpler?', options: [{ id: 'keep', label: 'Keep' }, { id: 'simpler', label: 'Simpler' }], default: 'keep' }] });
  assert.equal(r.status, 'waiting-on-question'); assert.equal(r.outcome, 'asked'); assert.equal(r.next.tool, null); assert.equal(r.next.waitingOn, 'the person');
  assert.equal((await state(b)).status, 'waiting-on-question');
  // the person answers: back in through the pitch, the same spec, and the build goes on in the folder that is there
  await b.call('gamesfun_step_pitch', { idea: 'keep the plan' });
  r = await b.call('gamesfun_step_spec');
  assert.equal(r.outcome, 'locked');
  r = await b.call('gamesfun_step_create');
  assert.equal(r.step, 'agent');
  await b.call('gamesfun_step_fix', DONE);
  await b.call('gamesfun_step_verify');
  await b.call('gamesfun_step_playtest');
  await answerAll(b);
  await b.call('gamesfun_step_playtest');
  r = await b.call('gamesfun_step_deliver');
  assert.equal(r.outcome, 'delivered');
  r = await b.call('gamesfun_change', { request: 'make the balls red' });
  assert.equal(r.step, 'agent'); assert.equal(r.status, 'building'); assert.match(r.round.brief, /# Change round/); assert.match(r.round.brief, /make the balls red/);
  assert.equal((await state(b)).kind, 'change');
});

test('web3 tools are off by default and an environment variable turns them on', async () => {
  const { tools: all } = await loadTools();
  assert.ok([...all.keys()].some(n => n.startsWith('web3_')), 'the web3 tools are still in mcp/tools');
  assert.equal(offered('web3_status', {}), false); assert.equal(offered('web3_status', { GAMESFUN_WEB3: '1' }), true); assert.equal(offered('gamesfun_next', {}), true);
  const names = async env => {
    const { server } = await createServer({ log: () => {}, env });
    const [a, c] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' }, { capabilities: {} });
    await Promise.all([server.connect(a), client.connect(c)]);
    try { return (await client.listTools()).tools.map(x => x.name); } finally { await client.close(); }
  };
  const off = await names({}), on = await names({ GAMESFUN_WEB3: '1' });
  assert.deepEqual(off.filter(n => n.startsWith('web3_')), []);
  assert.ok(on.filter(n => n.startsWith('web3_')).length >= 10);
  for (const n of ['gamesfun_next', 'gamesfun_step_pitch', 'gamesfun_step_spec', 'gamesfun_step_create', 'gamesfun_step_fix', 'gamesfun_step_verify', 'gamesfun_step_playtest', 'gamesfun_step_deliver', 'gamesfun_ask', 'gamesfun_change', 'gamesfun_rollback', 'gamesfun_requests', 'gamesfun_play', 'gamesfun_playtest_report']) assert.ok(off.includes(n), n);
  for (const o of loop.ORDER) assert.ok(INSTRUCTIONS.includes(o.tool), `the server's instructions name ${o.tool}`);
});

test('gamesfun_requests calls the bridge\'s three functions and nothing else', async t => {
  const tool = requests.tools.find(x => x.name === 'gamesfun_requests');
  if (!existsSync(requests.BRIDGE)) assert.equal((await tool.handler({})).running, false, 'with no bridge in the checkout it says so');
  const calls = [];
  const queue = [{ id: 'r_1', text: 'make the enemies faster', selection: null, state: 'handed', refusals: 0 }];
  requests.seams.bridge = {
    bridgeStatus: async o => { calls.push(['status', o]); return { running: true }; },
    collectRequests: async o => { calls.push(['collect', o]); return o.session === 'nobody' ? { ok: false, error: 'no such session' } : { ok: true, session: 's1', requests: queue.filter(q => q.state !== 'done') }; },
    reportRequest: async o => { calls.push(['report', o]); const q = queue.find(x => x.id === o.id); if (!q) return { ok: false, error: 'unknown id' }; q.state = o.status; q.note = o.note; return { ok: true, request: q }; },
  };
  t.after(() => { requests.seams.bridge = null; });
  let r = await tool.handler({});
  assert.deepEqual(r.requests, [{ id: 'r_1', text: 'make the enemies faster', selection: null, state: 'handed' }]);
  r = await tool.handler({ session: 'nobody' });
  assert.equal(r.ok, false); assert.equal(r.error, 'no such session');
  r = await tool.handler({ done: { id: 'r_1', note: 'Enemies run 30% faster.' } });
  assert.deepEqual(r.reported, { id: 'r_1', state: 'done', note: 'Enemies run 30% faster.' });
  assert.deepEqual((await tool.handler({})).requests, []);
  await assert.rejects(() => tool.handler({ done: { id: 'r_1', status: 'ignored' } }), /"done" or "dropped"/);
  assert.deepEqual(calls.map(c => c[0]), ['collect', 'collect', 'status', 'report', 'collect']);
  assert.equal(calls[0][1].cwd, KIT_ROOT);
});

test('the skill and the play-tester agent are generated from the tools and the loop\'s prompt (run node scripts/sync-skills.mjs on drift)', async () => {
  for (const g of await generatedDrift()) assert.ok(g.same, `${g.file} differs from what the tools and prompts give`);
  const [skill, agent] = await generatedFiles();
  for (const x of [...loop.tools, ...requests.tools]) assert.ok(skill.text.includes(`\`${x.name}\``), `the skill names ${x.name}`);
  for (const o of loop.ORDER) assert.ok(loop.tools.some(x => x.name === o.tool), `${o.tool} is a tool`);
  assert.match(agent.text, /^---\nname: playtester\n/);
  assert.match(agent.text, /tools: Read, mcp__gamesfun__gamesfun_play, mcp__gamesfun__gamesfun_playtest_report\n/);
  const prompt = await readFile(path.join(loop.PROMPTS, 'playtest.md'), 'utf8');
  assert.ok(agent.text.includes(prompt.split('## Judge\n')[1].split('\n## ')[0].trim()), 'the judging rules are the prompt\'s own words');
  assert.doesNotMatch(agent.text, /\{\{[A-Z_]+\}\}/);
});
