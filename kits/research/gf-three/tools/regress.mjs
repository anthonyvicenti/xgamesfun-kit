#!/usr/bin/env node
// gf-three regress: never again. Every past mistake is a saved broken example (research/gf-three/regressions/), and
// verify must keep failing each one on the check made for it. A check that silently stops working fails here, loudly.
//
//   node research/gf-three/tools/regress.mjs [--only id,id] [--jobs N] [--json] [--keep] [--no-retry] [--verify <verify.mjs>] [--record]
//   node research/gf-three/tools/regress.mjs --corpus [--only id,id] [--jobs N] [--json] [--keep] [--no-retry] [--sheet] [--jobs-root <dir>]
//
// Examples: each is built in a temp folder (tools/lib/regress-lib.mjs: create from a known spec, then the example's
// rules, files and JSON-pointer patches) and verified: `--check N` when every check it judges can run alone, else the
// whole verify (--quick: the contact sheet is never judged). Every mustFail check must fail (and its details match),
// every mustPass check must pass, and a verdict with a failing check must not pass. A pass-rule example is judged
// with no browser. Two at a time by default (each verify drives its own Chrome on the GPU; 3 is the most to use).
// --verify runs another copy of verify.mjs (prove that a broken check is caught; see regressions/README.md).
// --record: after a green run of every example with the real verify, write regressions/last-green.json (when, how long,
// and the fingerprint of verify, tools/lib, the kit and the examples). tests/r-regressions.test.mjs fails while that
// fingerprint differs from what is in the repo, so the browser tier runs whenever the checks or the kit change.
//
// --corpus: every delivered game we keep (research/studio-v2/evals/corpus.json). Each is copied to a scratch folder,
// upgraded there onto the current kit (tools/upgrade.mjs --out; "world": true adds --world) unless the entry says
// "upgrade": false, and given the whole verify (--quick; --sheet adds the contact sheet). The original job folders
// are never touched. A game whose verdict differs from the entry's `expect` is a surprise.
//
// A row that surprises is verified once more (--no-retry: not): a broken check fails both times, while a surprise the
// second run does not repeat is shown as flaky (with what the first run said) and does not fail the run. verify has
// timing-bound checks (the gate's shared state, the audio loudness floor) that flake now and then.
//
// Exit 0 when nothing surprised, 1 when something did, 2 on bad usage. Temp folders are removed unless --keep or a
// surprise (then their paths are printed).
import { readFile, rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, TOOLS } from './lib/paths.mjs';
import { loadExamples, buildExample, planVerify, judge, judgeUnit, fingerprint, STAMP } from './lib/regress-lib.mjs';

export const CORPUS = join(REPO, 'research/studio-v2/evals/corpus.json');

/** Run one verify in a child process; → the verdict (verdict.json) or null, and the last lines it printed. */
function runVerify(verifyPath, game, args, outDir, timeoutMs) {
  return new Promise(res => {
    const t0 = Date.now();
    const c = spawn(process.execPath, [verifyPath, game, ...args, '--out', outDir], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = d => { tail = (tail + d).slice(-4000); };
    c.stdout.on('data', keep); c.stderr.on('data', keep);
    const t = setTimeout(() => c.kill('SIGTERM'), timeoutMs);
    c.on('close', async code => {
      clearTimeout(t);
      let verdict = null;
      try { verdict = JSON.parse(await readFile(join(outDir, 'verdict.json'), 'utf8')); } catch {}
      res({ verdict, code, seconds: Math.round((Date.now() - t0) / 1000), tail: tail.trim().split('\n').slice(-6).join('\n') });
    });
  });
}

/** Map over items, at most n at a time, keeping the order. */
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

const checkList = got => Object.keys(got).map(Number).sort((a, b) => a - b).map(n => `${n}${got[n] === true ? '' : got[n] === false ? 'x' : '-'}`).join(' ');

/** The broken examples. → {ok, rows, root, minutes} */
export async function regress({ only = null, jobs = 2, verifyPath = join(TOOLS, 'verify.mjs'), keep = false, record = false, retry = true, log = console.log } = {}) {
  const t0 = Date.now();
  const fp = await fingerprint();
  let examples = await loadExamples();
  if (only) { const want = new Set(only); examples = examples.filter(e => want.has(e.id)); const miss = [...want].filter(id => !examples.some(e => e.id === id)); if (miss.length) throw new Error(`no example ${miss.join(', ')}`); }
  const root = join(tmpdir(), `gf-regress-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(root, { recursive: true });
  log(`regress: ${examples.length} examples, ${jobs} at a time, verify ${relative(REPO, resolve(verifyPath))}, work in ${root}`);
  const cost = ex => { const m = planVerify(ex).mode; return m === 'full' ? 0 : m === 'unit' ? 2 : 1; };   // the longest first
  const order = [...examples].sort((a, b) => cost(a) - cost(b));
  const done = await pool(order, jobs, async ex => {
    const plan = planVerify(ex), t1 = Date.now();
    const row = { id: ex.id, mode: plan.mode, mustFail: ex.mustFail ?? [], mustPass: ex.mustPass ?? [], ok: false, surprises: [], got: {}, others: [], seconds: 0 };
    try {
      if (plan.mode === 'unit') {
        const u = judgeUnit(ex);
        Object.assign(row, { ok: u.ok, surprises: u.surprises, cases: u.rows.length, mustFail: [], mustPass: [] });
      } else {
        const b = await buildExample(ex, join(root, ex.id, 'game'));
        row.build = b.steps;
        for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt++) {
          const out = join(root, ex.id, attempt === 1 ? 'verify' : `verify-${attempt}`);
          const v = await runVerify(resolve(verifyPath), b.dir, plan.args, out, plan.mode === 'full' ? 15 * 60000 : 5 * 60000);
          if (!v.verdict) { row.surprises = [`verify left no verdict (exit ${v.code}): ${v.tail}`]; break; }
          const first = attempt > 1 ? row.surprises : null;
          const j = judge(ex, v.verdict);
          Object.assign(row, { ok: j.ok, surprises: j.surprises, got: j.got, others: j.others, verdictPass: v.verdict.pass, evidence: out, attempts: attempt });
          if (first && j.ok) row.flaky = first;                 // a surprise the second run did not repeat: shown, not failed
          if (j.ok) break;
        }
      }
    } catch (e) { row.surprises.push(`could not run: ${e.message}`); }
    row.seconds = Math.round((Date.now() - t1) / 1000);
    log(`  ${row.ok ? (row.flaky ? 'FLAKY   ' : 'ok      ') : 'SURPRISE'} ${row.id} (${row.mode}, ${row.seconds} s)${row.surprises.length ? `: ${row.surprises.join(' | ')}` : row.flaky ? `: first run ${row.flaky.join(' | ')}; the second run was as expected` : ''}`);
    return row;
  });
  const rows = examples.map(ex => done[order.indexOf(ex)]);
  const ok = rows.every(r => r.ok);
  const minutes = +((Date.now() - t0) / 60000).toFixed(1);
  if (!keep && ok) await rm(root, { recursive: true, force: true });
  const r = { schema: 'gf-three-regress/1', at: new Date().toISOString(), verify: relative(REPO, resolve(verifyPath)), jobs, ok, minutes, fingerprint: fp.sha, root: ok && !keep ? null : root, rows };
  if (record) {
    const why = !ok ? 'the run had surprises' : only ? '--only ran a subset' : resolve(verifyPath) !== join(TOOLS, 'verify.mjs') ? '--verify is not the real verify' : (await fingerprint()).sha !== fp.sha ? 'the checks, kit or examples changed during the run' : null;
    if (why) r.recorded = `not recorded: ${why}`;
    else {
      await writeFile(STAMP, JSON.stringify({ schema: 'gf-three-regress-stamp/1', about: 'The last green run of every broken example (node research/gf-three/tools/regress.mjs --record). tests/r-regressions.test.mjs fails while the fingerprint of verify, tools/lib, the kit and the examples differs from this one.', at: r.at, minutes, jobs, fingerprint: fp.sha, files: fp.files, rows: rows.map(x => ({ id: x.id, mode: x.mode, seconds: x.seconds, ...(x.mode === 'unit' ? { cases: x.cases } : { got: x.got }), ...(x.flaky ? { flaky: x.flaky } : {}) })) }, null, 2) + '\n');
      r.recorded = relative(REPO, STAMP);
    }
  }
  return r;
}

/** The corpus: every delivered game we keep, upgraded in a scratch copy and verified. → {ok, rows, root, minutes} */
export async function corpus({ only = null, jobs = 2, sheet = false, keep = false, jobsRoot = null, retry = true, log = console.log } = {}) {
  const t0 = Date.now();
  const C = JSON.parse(await readFile(CORPUS, 'utf8'));
  const base = resolve(jobsRoot ?? process.env.GF_JOBS_ROOT ?? C.jobsRoot);
  let games = C.games;
  if (only) games = games.filter(g => only.includes(g.id));
  const root = join(tmpdir(), `gf-corpus-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(root, { recursive: true });
  log(`corpus: ${games.length} games from ${base}, ${jobs} at a time, work in ${root}`);
  const { upgrade } = await import('./upgrade.mjs');
  const rows = await pool(games, jobs, async g => {
    const t1 = Date.now(), src = resolve(base, g.path), dir = join(root, g.id, 'game');
    const row = { id: g.id, title: g.title, run: g.run, kit: g.upgrade === false ? 'delivered' : g.world ? 'upgraded --world' : 'upgraded', expect: g.expect, ok: false, surprises: [], got: {}, seconds: 0 };
    try {
      if (!existsSync(join(src, 'config/game.json'))) throw new Error(`${src} is missing (or not a gf-three game)`);
      if (g.upgrade !== false) {
        const u = await upgrade(src, { out: dir, world: !!g.world });
        if (!u.ok) throw new Error(`upgrade failed: ${(u.problems ?? []).join('; ')}`);
        row.upgrade = { kitFiles: u.kit.changed.length + u.kit.added.length + u.kit.removed.length, config: u.config.length };
      } else await cp(src, dir, { recursive: true, filter: f => !/[\\/](evidence|node_modules|\.git)([\\/]|$)/.test(relative(src, f) ? `/${relative(src, f)}` : '') });
      for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt++) {
        const out = join(root, g.id, attempt === 1 ? 'verify' : `verify-${attempt}`);
        const v = await runVerify(join(TOOLS, 'verify.mjs'), dir, sheet ? [] : ['--quick'], out, 20 * 60000);
        if (!v.verdict) throw new Error(`verify left no verdict (exit ${v.code}): ${v.tail}`);
        const first = attempt > 1 ? { surprises: row.surprises, failed: row.failed.map(f => f.n) } : null;
        row.got = {}; row.surprises = [];
        for (const c of v.verdict.checks) row.got[c.n] = c.ok;
        row.pass = v.verdict.pass;
        row.failed = v.verdict.checks.filter(c => c.ok === false).map(c => ({ n: c.n, detail: c.detail.slice(0, 300) }));
        row.evidence = out; row.attempts = attempt;
        const want = g.expect ?? { pass: true };
        if (want.pass !== row.pass) row.surprises.push(`expected ${want.pass ? 'PASS' : 'FAIL'}, verify says ${row.pass ? 'PASS' : 'FAIL'}${row.failed.length ? ` (failed ${row.failed.map(f => f.n).join(', ')})` : ''}`);
        for (const n of want.fail ?? []) if (row.got[n] !== false) row.surprises.push(`check ${n} expected to fail; it ${row.got[n] === true ? 'passed' : 'did not run'}`);
        row.ok = row.surprises.length === 0;
        if (first && row.ok) row.flaky = first;                  // shown, not failed: the second run was as expected
        if (row.ok) break;
      }
    } catch (e) { row.surprises.push(e.message); }
    row.seconds = Math.round((Date.now() - t1) / 1000);
    log(`  ${row.ok ? (row.flaky ? 'FLAKY   ' : 'ok      ') : 'SURPRISE'} ${row.id}: ${row.pass === undefined ? '—' : row.pass ? 'PASS' : `FAIL ${row.failed.map(f => f.n).join(', ')}`} (${row.seconds} s)${row.surprises.length ? `: ${row.surprises.join(' | ')}` : row.flaky ? `: first run ${row.flaky.surprises.join(' | ')}; the second run was as expected` : ''}`);
    return row;
  });
  const ok = rows.every(r => r.ok);
  const minutes = +((Date.now() - t0) / 60000).toFixed(1);
  if (!keep && ok) await rm(root, { recursive: true, force: true });
  return { schema: 'gf-three-corpus/1', at: new Date().toISOString(), jobsRoot: base, jobs, sheet, ok, minutes, root: ok && !keep ? null : root, rows };
}

function table(r, corpusMode) {
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [];
  if (corpusMode) {
    lines.push(`${pad('game', 26)}${pad('run', 8)}${pad('kit', 18)}${pad('expect', 16)}${pad('verdict', 20)}${pad('checks (x failed, - skipped)', 40)}${pad('s', 6)}result`);
    for (const x of r.rows) lines.push(`${pad(x.id, 26)}${pad(x.run ?? '', 8)}${pad(x.kit, 18)}${pad(x.expect?.pass === false ? `FAIL ${(x.expect.fail ?? []).join(',')}` : 'PASS', 16)}${pad(x.pass === undefined ? '—' : x.pass ? 'PASS' : `FAIL ${x.failed.map(f => f.n).join(',')}`, 20)}${pad(checkList(x.got), 40)}${pad(x.seconds, 6)}${x.ok ? (x.flaky ? `ok, flaky (run 1 failed ${x.flaky.failed.join(',') || '—'})` : 'ok') : 'SURPRISE'}`);
  } else {
    lines.push(`${pad('example', 18)}${pad('verify', 10)}${pad('must fail', 11)}${pad('must pass', 12)}${pad('checks (x failed, - skipped)', 44)}${pad('s', 6)}result`);
    for (const x of r.rows) lines.push(`${pad(x.id, 18)}${pad(x.mode, 10)}${pad(x.mode === 'unit' ? `${x.cases ?? 0} cases` : x.mustFail.join(','), 11)}${pad(x.mustPass.join(',') || '—', 12)}${pad(x.mode === 'unit' ? 'tools/lib/verdict.mjs passes()' : checkList(x.got), 44)}${pad(x.seconds, 6)}${x.ok ? (x.flaky ? 'ok, flaky' : 'ok') : 'SURPRISE'}`);
  }
  for (const x of r.rows) for (const s of x.surprises) lines.push(`  ${x.id}: ${s}`);
  for (const x of r.rows) if (x.flaky) for (const s of x.flaky.surprises ?? x.flaky) lines.push(`  ${x.id} (flaky, first run only): ${s}`);
  lines.push(`${corpusMode ? 'corpus' : 'regress'}: ${r.ok ? 'OK' : 'SURPRISES'} ${r.rows.filter(x => x.ok).length}/${r.rows.length} in ${r.minutes} min${r.root ? ` · work kept in ${r.root}` : ''}${r.recorded ? ` · ${r.recorded.startsWith('not') ? r.recorded : `stamp written: ${r.recorded}`}` : ''}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const known = new Set(['--only', '--jobs', '--json', '--keep', '--verify', '--corpus', '--sheet', '--jobs-root', '--record', '--no-retry']);
  const bad = a.filter((x, i) => x.startsWith('--') ? !known.has(x) : !['--only', '--jobs', '--verify', '--jobs-root'].includes(a[i - 1]));
  if (bad.length) { console.error(`regress: unknown ${bad.join(' ')}\nusage: regress.mjs [--only id,id] [--jobs N] [--json] [--keep] [--no-retry] [--verify <verify.mjs>] [--record] | --corpus [--only id,id] [--jobs N] [--sheet] [--jobs-root <dir>]`); process.exit(2); }
  const jobs = Math.max(1, Math.min(3, Number(opt('--jobs') ?? 2) || 2));
  const only = opt('--only') ? opt('--only').split(',').map(s => s.trim()).filter(Boolean) : null;
  const json = a.includes('--json');
  const log = json ? () => {} : console.log;
  let r;
  try {
    r = a.includes('--corpus')
      ? await corpus({ only, jobs, sheet: a.includes('--sheet'), keep: a.includes('--keep'), jobsRoot: opt('--jobs-root'), retry: !a.includes('--no-retry'), log })
      : await regress({ only, jobs, verifyPath: opt('--verify') ?? join(TOOLS, 'verify.mjs'), keep: a.includes('--keep'), record: a.includes('--record'), retry: !a.includes('--no-retry'), log });
  } catch (e) { console.error(`regress: ${e.message}`); process.exit(2); }
  if (r.root) await writeFile(join(r.root, 'summary.json'), JSON.stringify(r, null, 2) + '\n').catch(() => {});
  if (json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else console.log('\n' + table(r, a.includes('--corpus')));
  process.exitCode = r.ok ? 0 : 1;
}
