#!/usr/bin/env node
// One case through both hosts of the build loop, with no model: the same verdict from the same files (open builder M2).
//
//   node tests/two-hosts.mjs [--case soak-squad|dev-dodgeball] [--out <folder>] [--keep]
//
// The loop library (kits/research/gf-three/loop) is called by two hosts. This script drives it once as each, on the
// same locked spec and the same fixed rules.js, with the REAL create, fix and verify (verify needs a browser on a
// graphics card: about 5 minutes a host for a case that passes), and compares what the two leave behind.
//
//   host A, "worker"  the way Studio's worker calls it (research/foundations/studio-worker in games.fun, lib/v2.mjs;
//                     its test tests/worker-loop.test.mjs drives it with a stub executor): the job folder holds
//                     game/, out/, spec.json; the state is kept beside the job (loop.json), outside the folder the
//                     agent works in; the agent and the play-tester are runners the host passes; loop.run().
//   host B, "tools"   this kit's MCP tools (mcp/tools/loop.mjs), called in order by a scripted session:
//                     gamesfun_step_pitch → _spec → _create → (writes rules.js, gamesfun_verify) → _fix → _verify →
//                     _playtest → gamesfun_playtest_report → _playtest → _deliver. The state is in the game's folder.
//
// What stands in for the model, the same in both: the build round writes the case's fixed rules.js and runs the quick
// verify (the same CLI command); a later round changes nothing; the play-tester answers every promise "pass" without
// playing (so the play-test here proves nothing about the game: the comparison is of create, fix, verify and the
// loop's order). Nothing here signs anyone in or sends a request to a model.
//
// Compared: the two game folders byte for byte (without each host's own folders: .gf-loop/, evidence/), the two full
// verdicts check by check, and the loop's steps. Exit 0 when every check has the same result in both hosts and every
// file that differs is one of the differences explained below; 1 otherwise. The table is printed and saved as JSON.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openBuildLoop, kitTools, fileStore, readVerdict } from '../kits/research/gf-three/loop/index.mjs';
import { ensureBrowser } from '../lib/chrome.mjs';
import { BIN, EXAMPLES, GF3, GF3_TOOLS, KIT_ROOT, KITS, toPosix } from '../lib/paths.mjs';
import { TOOL_ENV } from '../lib/run-tool.mjs';
import { runCli } from '../mcp/server.mjs';
import * as coreTools from '../mcp/tools/core.mjs';
import * as loopTools from '../mcp/tools/loop.mjs';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };
const CASE = opt('case') ?? 'soak-squad';
const MARK = '\n// two-hosts: this case\'s fixed rules (create\'s stub, unchanged but for this line)\n';
const CASES = {
  // the kit's example: its spec and its rules.js pass verify, so the whole path runs (verify, play-test, deliver)
  'soak-squad': { spec: path.join(EXAMPLES, 'soak-squad', 'spec.json'), rules: async () => readFile(path.join(EXAMPLES, 'soak-squad', 'rules.js'), 'utf8') },
  // the development case (the spec the worker's test uses) with the rules the worker's stub executor leaves: create's
  // stub. Verify fails it, the same way in both hosts, and the rounds after it change nothing
  'dev-dodgeball': { spec: path.join(KITS, 'research', 'studio-v2', 'specs', 'dev-dodgeball.spec.json'), rules: async game => await readFile(path.join(game, 'rules.js'), 'utf8') + MARK },
};
if (!CASES[CASE]) { console.error(`--case is one of: ${Object.keys(CASES).join(', ')}`); process.exit(2); }

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const DELIVERY = { summary: 'Two-hosts run: the case\'s fixed rules, no model.', controls: 'See the HUD.' };
const quickVerify = game => new Promise(done => execFile(process.execPath, [BIN, 'verify', game, '--quick', '--json'], { cwd: KIT_ROOT, maxBuffer: 64 << 20, windowsHide: true }, (e, stdout) => {
  let pass = null; try { pass = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)).pass; } catch { /* no verdict */ }
  done({ code: e ? e.code ?? 1 : 0, pass });
}));
const allPass = list => ({ verdict: 'pass', promises: list.promises.map(p => ({ id: p.id, pass: true, evidence: [], note: 'Scripted answer (tests/two-hosts.mjs): nobody played.' })), feel: [], summary: 'Scripted: no play-tester ran.' });

// ---------------------------------------------------------------- host A: the way Studio's worker calls the loop
async function hostWorker(root, c) {
  const job = path.join(root, 'job'), game = path.join(job, 'game'), out = path.join(job, 'out');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(job, 'spec.json'), await readFile(c.spec));
  const rounds = [];
  const loop = await openBuildLoop({
    kind: 'build', job, game, kit: GF3, specFile: path.join(job, 'spec.json'), resume: false,
    store: fileStore(path.join(root, 'loop.json')),          // beside the job, as the worker keeps it
    paths: { JOB: toPosix(job), KIT_TOOLS: toPosix(GF3_TOOLS), PLAYTEST: toPosix(path.join(job, 'playtest')) },
    firstMessage: `Read ${toPosix(job)}/JOB.md and do the job it describes.`,
    spec: JSON.parse(await readFile(c.spec, 'utf8')),
    tools: kitTools({ kit: GF3, cwd: KIT_ROOT, log: l => log('  A', String(l).trim()) }),
    log: l => log('  A', String(l).trim()),
    async agent(o) {
      rounds.push(o.kind === 'repair' ? `repair:${o.repair}` : o.kind);
      if (o.kind === 'build') {
        await writeFile(path.join(game, 'rules.js'), await c.rules(game));
        const q = await quickVerify(game);
        log(`  A the round's own quick verify: ${q.pass ? 'pass' : 'FAIL'}`);
      }
      await writeFile(path.join(out, 'delivery.json'), JSON.stringify(DELIVERY, null, 2) + '\n');
    },
    async playtester({ dir }) {
      const list = JSON.parse(await readFile(path.join(dir, 'promises.json'), 'utf8'));
      await mkdir(path.join(dir, 'out'), { recursive: true });
      await writeFile(path.join(dir, 'out', 'playtest.json'), JSON.stringify(allPass(list), null, 2) + '\n');
    },
  });
  const last = await loop.run();
  const s = loop.state;
  return { game, state: s, rounds, outcome: last.outcome?.outcome ?? s.outcome, verdictDir: n => path.join(out, `verify-${n}`), promises: await readFile(path.join(job, 'promises.json'), 'utf8').then(JSON.parse).catch(() => null) };
}

// ---------------------------------------------------------------- host B: this kit's MCP tools, a scripted session
async function hostTools(root, c) {
  const game = path.join(root, 'game'), G = loopTools.places(game);
  const by = Object.fromEntries([...loopTools.tools, ...coreTools.tools].map(t => [t.name, t]));
  const ctx = { kitRoot: KIT_ROOT, log: (...a) => log('  B', ...a), progress: () => {}, runCli, signal: undefined };
  const calls = [], rounds = [];
  const call = async (name, input = {}) => {
    const r = await by[name].handler(name === 'gamesfun_verify' ? input : { game, ...input }, ctx);
    const v = r?.content ? JSON.parse(r.content[0].text) : r;
    calls.push(`${name}${v?.refused ? ` (refused: ${v.refused})` : ''}`);
    if (v?.refused && !v.round && !v.next) throw new Error(`${name} refused: ${JSON.stringify(v).slice(0, 600)}`);
    return v;
  };
  await call('gamesfun_step_pitch', { idea: 'two-hosts run' });
  // the session writes the spec file (the same bytes the worker's job folder gets), then has it checked and locked
  await mkdir(G.job, { recursive: true });
  await writeFile(G.spec, await readFile(c.spec));
  let r = await call('gamesfun_step_spec');
  if (r.outcome !== 'locked') throw new Error(`the spec did not lock: ${JSON.stringify(r.problems ?? r)}`);
  r = await call('gamesfun_step_create');
  for (let n = 0; n < 40 && r.next?.tool; n++) {
    const tool = r.next.tool;
    if (tool === 'gamesfun_step_fix') {
      rounds.push(String(r.round?.kind ?? 'round'));
      if (r.round?.kind === 'build') {
        await writeFile(path.join(game, 'rules.js'), await c.rules(game));
        const q = await call('gamesfun_verify', { dir: game });
        log(`  B the round's own quick verify: ${q.pass ? 'pass' : 'FAIL'}`);
      }
      r = await call('gamesfun_step_fix', DELIVERY);
    } else if (tool === 'gamesfun_step_playtest') {
      r = await call('gamesfun_step_playtest');
      if (r.round?.kind === 'playtest') {
        await call('gamesfun_playtest_report', { report: allPass(JSON.parse(await readFile(path.join(G.playtest, 'promises.json'), 'utf8'))) });
        r = await call('gamesfun_step_playtest');
      }
    } else r = await call(tool);
  }
  const s = JSON.parse(await readFile(G.state, 'utf8'));
  return { game, state: s, rounds, calls, outcome: s.outcome, verdictDir: n => path.join(G.out, `verify-${n}`), promises: await readFile(G.promises, 'utf8').then(JSON.parse).catch(() => null) };
}

// ---------------------------------------------------------------- the comparison
const HOST_DIRS = new Set(['.gf-loop', 'evidence']);     // each host's own: the loop's state and checkpoints, verify's records
async function filesOf(dir) {
  const out = new Map();
  const walk = async (d, rel) => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === 'node_modules' || (!rel && HOST_DIRS.has(e.name))) continue;
      const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else if (e.isFile()) out.set(r, createHash('sha256').update(await readFile(p)).digest('hex'));
    }
  };
  await walk(dir, '');
  return out;
}
/** Why a file differs between the hosts, when the difference is one a host makes on purpose. → the reason, or null */
async function explain(rel, a, b) {
  const GUIDE = { 'AGENTS.md': 1, 'CLAUDE.md': 1, '.gitignore': 1 };
  if (rel in GUIDE) return 'the kit\'s create (lib/create.mjs) adds the game\'s guide for the person\'s agent; the worker gives its agent a JOB.md outside the game';
  if (rel === 'assets.json') {
    const strip = async g => { const j = JSON.parse(await readFile(path.join(g, 'assets.json'), 'utf8')); j.ignore = (j.ignore ?? []).filter(x => !String(x?.path ?? '').startsWith('.gf-loop')); return JSON.stringify(j); };
    if (await strip(a) === await strip(b)) return 'only the ignore list: the tools host keeps the loop\'s folder in the game (.gf-loop/**), the worker keeps the state beside the job';
  }
  return null;
}

const root = opt('out') ? path.resolve(opt('out')) : await mkdtemp(path.join(os.tmpdir(), 'gf-two-hosts-'));
await mkdir(root, { recursive: true });
Object.assign(process.env, TOOL_ENV);                      // what every kit tool is told about this checkout, for both hosts
await ensureBrowser({ log: m => log(m), install: false });
const c = CASES[CASE], t0 = Date.now();
log(`case ${CASE}; folders under ${root}`);
log('host A (worker): create, round, fix, verify, play-test, deliver');
const A = await hostWorker(path.join(root, 'a'), c);
log(`host A: ${A.outcome} after ${Math.round((Date.now() - t0) / 1000)} s`);
const t1 = Date.now();
log('host B (tools): the step tools in order');
const B = await hostTools(path.join(root, 'b'), c);
log(`host B: ${B.outcome} after ${Math.round((Date.now() - t1) / 1000)} s`);

const fa = await filesOf(A.game), fb = await filesOf(B.game);
const differ = [];
for (const rel of [...new Set([...fa.keys(), ...fb.keys()])].sort()) {
  if (fa.get(rel) === fb.get(rel)) continue;
  differ.push({ file: rel, how: !fa.has(rel) ? 'only in B (tools)' : !fb.has(rel) ? 'only in A (worker)' : 'different bytes', why: await explain(rel, A.game, B.game) });
}
const verdicts = [];
const nA = A.state.verifies, nB = B.state.verifies;
for (let n = 1; n <= Math.max(nA, nB); n++) {
  const va = n <= nA ? await readVerdict(A.verdictDir(n)) : null, vb = n <= nB ? await readVerdict(B.verdictDir(n)) : null;
  const word = c => (!c ? '—' : c.skipped ? 'skip' : c.ok ? 'pass' : 'FAIL');
  const ids = [...new Set([...(va?.checks ?? []), ...(vb?.checks ?? [])].map(x => String(x.id)))];
  verdicts.push({ n, a: va ? (va.ok ? 'PASS' : 'FAIL') : '—', b: vb ? (vb.ok ? 'PASS' : 'FAIL') : '—', checks: ids.map(id => { const ca = va?.checks.find(x => String(x.id) === id), cb = vb?.checks.find(x => String(x.id) === id); return { id, name: (ca ?? cb).name, a: word(ca), b: word(cb) }; }) });
}
const steps = s => s.history.map(h => h.step).join(' → ');
const ids = l => (l?.promises ?? []).map(p => p.id).sort().join(' ');
const sameVerdicts = nA === nB && verdicts.every(v => v.a === v.b && v.checks.every(k => k.a === k.b));
const unexplained = differ.filter(d => !d.why);
const result = {
  case: CASE, kits: JSON.parse(await readFile(path.join(KITS, 'KITS.json'), 'utf8')).source.commit, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), folders: { a: A.game, b: B.game },
  outcome: { a: A.outcome, b: B.outcome }, steps: { a: steps(A.state), b: steps(B.state) }, rounds: { a: A.rounds, b: B.rounds }, calls: B.calls,
  files: { a: fa.size, b: fb.size, same: [...fa.keys()].filter(k => fb.get(k) === fa.get(k)).length, differ },
  verdicts, promises: { a: A.promises?.promises?.length ?? 0, b: B.promises?.promises?.length ?? 0, sameIds: ids(A.promises) === ids(B.promises) },
  hashes: { a: A.state.verify?.hash ?? null, b: B.state.verify?.hash ?? null },
  ok: sameVerdicts && !unexplained.length && A.outcome === B.outcome && steps(A.state) === steps(B.state),
};
await writeFile(path.join(root, 'two-hosts.json'), JSON.stringify(result, null, 2) + '\n');

const P = console.log;
P(`\nTwo hosts, one case: ${CASE} (kits ${result.kits.slice(0, 12)}; ${result.seconds} s)\n`);
P('| | A: worker\'s way | B: this kit\'s tools |'); P('|---|---|---|');
P(`| outcome | ${A.outcome} | ${B.outcome} |`);
P(`| steps | ${result.steps.a} | ${result.steps.b} |`);
P(`| agent rounds | ${A.rounds.join(', ')} | ${B.rounds.join(', ')} |`);
P(`| promises asked of the play-tester | ${result.promises.a} | ${result.promises.b}${result.promises.sameIds ? ' (same ids)' : ' (DIFFERENT ids)'} |`);
P(`| game files (without .gf-loop/, evidence/) | ${fa.size} | ${fb.size} |`);
P(`\nFiles: ${result.files.same} byte for byte the same; ${differ.length} differ.`);
if (differ.length) { P('\n| file | how | why |'); P('|---|---|---|'); for (const d of differ) P(`| ${d.file} | ${d.how} | ${d.why ?? 'NOT EXPLAINED'} |`); }
for (const v of verdicts) {
  P(`\nFull verify ${v.n}: A ${v.a}, B ${v.b}\n`); P('| check | A | B | |'); P('|---|---|---|---|');
  for (const k of v.checks) P(`| ${k.id} ${k.name} | ${k.a} | ${k.b} | ${k.a === k.b ? '' : 'DIFFERENT'} |`);
}
P(`\n${result.ok ? 'SAME' : 'DIFFERENT'}: ${sameVerdicts ? 'every check has the same result in both hosts' : 'the verdicts differ'}; ${unexplained.length ? `${unexplained.length} file difference(s) not explained` : 'every file difference is one a host makes on purpose'}. Record: ${path.join(root, 'two-hosts.json')}`);
if (!args.includes('--keep') && !opt('out')) await rm(root, { recursive: true, force: true });
process.exit(result.ok ? 0 : 1);
