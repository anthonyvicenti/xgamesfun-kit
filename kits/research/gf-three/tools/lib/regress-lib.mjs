// Never again (creator decision 2026-10-06, research/foundations/evidence/studio-v2-build-method-decision-2026-10-06.json):
// every complaint becomes a saved broken example that a verify check must fail. This module loads the examples in
// research/gf-three/regressions/, builds one into a folder (create from a known spec, then the example's rules, files
// and JSON-pointer patches), says how verify should run on it, and judges the verdict. tools/regress.mjs runs them;
// tests/r-regressions.test.mjs runs the ones that need no browser.
//
// An example (regressions/<id>/example.json; paths are relative to that folder):
//   { id, complaint: {verbatim, evidence}, build: {spec, rules?, files?: {"<game path>": "<file>"}, patches?: [...]},
//     mustFail: [check numbers], mustPass?: [...], details?: {"<n>": ["regex", ...]}, why }
//   A patch is Studio's override shape {file, pointer, value} (a JSON pointer into one of the game's JSON files; a token
//   "[id=pickup]" picks the array element whose id is pickup). details: each regex must match that check's detail
//   (case-insensitive), so a check that fails for some other reason does not count as catching the mistake.
//   A unit example has kind "pass-rule" and cases [{name, checks: [{n, ok}], pass}] instead of build (tools/lib/verdict.mjs).
//   control?: {why, patches?, files?, mustPass: [...]}: the same build with the mistake taken out, which must pass the
//   checks it names (a check broken to fail everything fails there). It runs as its own row, id "<id>+control".
import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { REPO, GF3, LIBRARY, json, walk, sha256 } from './paths.mjs';
import { passes } from './verdict.mjs';

export const REGRESSIONS = join(GF3, 'regressions');
/** The checks verify can run alone (`--check N`); anything else needs the whole verify. */
export const CHECK_ALONE = [10, 13, 14, 15, 16, 17];
/** The static checks (no browser): verify runs any set of them together (`--check 11,17`). */
export const STATIC_CHECKS = [11, 17];
/** The stamp of the last green browser-tier run (tools/regress.mjs --record); the fast tier compares fingerprints. */
export const STAMP = join(REGRESSIONS, 'last-green.json');

/**
 * What a verdict on the examples depends on, as one hash: verify and the tools that build and upgrade games, the
 * check libraries (tools/lib/*.mjs), the whole kit and the examples themselves (Markdown aside). When it differs from
 * the stamp's, the browser tier has not run on what is here now. → {sha, files}
 */
export async function fingerprint() {
  const rels = ['tools/verify.mjs', 'tools/regress.mjs', 'tools/create.mjs', 'tools/upgrade.mjs', 'tools/slots.mjs'];
  for (const [d, deep] of [['tools/lib', false], ['kit', true], ['regressions', true]]) for (const r of await walk(join(GF3, d), { skip: (rel, e) => !deep && e.isDirectory() })) rels.push(`${d}/${r}`);
  const list = [...new Set(rels)].filter(r => r !== 'regressions/last-green.json' && !r.endsWith('.md')).sort();   // prose never changes a verdict
  const lines = [];
  for (const r of list) lines.push(`${sha256(await readFile(join(GF3, r)))}  ${r}`);
  return { sha: sha256(Buffer.from(lines.join('\n'))), files: list.length };
}

/** Every example, sorted by id (bases/ and anything without an example.json are skipped). */
export async function loadExamples(root = REGRESSIONS) {
  const out = [];
  for (const e of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = join(root, e.name, 'example.json');
    if (!e.isDirectory() || !existsSync(f)) continue;
    const ex = JSON.parse(await readFile(f, 'utf8'));
    ex.folder = join(root, e.name);
    const problems = checkExample(ex);
    if (problems.length) throw new Error(`regressions/${e.name}/example.json: ${problems.join('; ')}`);
    out.push(ex);
    if (ex.control) out.push(controlOf(ex));
  }
  return out;
}

/** An example's control: its build plus the control's patches and files, judged on the checks the control must pass. */
export function controlOf(ex) {
  const c = ex.control;
  return { id: `${ex.id}+control`, controlOf: ex.id, folder: ex.folder, complaint: ex.complaint, why: c.why ?? ex.why,
    build: { ...ex.build, files: { ...(ex.build.files ?? {}), ...(c.files ?? {}) }, patches: [...(ex.build.patches ?? []), ...(c.patches ?? [])] },
    mustFail: [], mustPass: c.mustPass ?? [], details: c.details ?? {} };
}

/** The shape every example must have (a broken example that is itself malformed would prove nothing). */
export function checkExample(ex) {
  const p = [];
  if (!ex.id || basename(ex.folder ?? ex.id) !== (ex.controlOf ?? ex.id)) p.push('id must equal the folder name');
  if (!ex.complaint?.verbatim || !ex.complaint?.evidence) p.push('complaint needs verbatim and evidence');
  else if (!existsSync(join(REPO, ex.complaint.evidence))) p.push(`evidence file ${ex.complaint.evidence} does not exist`);
  if (!ex.why) p.push('why is missing');
  if (ex.kind === 'pass-rule') { if (!Array.isArray(ex.cases) || !ex.cases.length) p.push('a pass-rule example needs cases'); return p; }
  if (!ex.build?.spec) p.push('build.spec is missing');
  if (ex.controlOf) { if (!ex.mustPass?.length) p.push('a control must list the checks it must pass'); }
  else if (!Array.isArray(ex.mustFail) || !ex.mustFail.length) p.push('mustFail must list at least one check');
  if (ex.control && (!ex.control.mustPass?.length || !(ex.control.patches?.length || Object.keys(ex.control.files ?? {}).length))) p.push('control needs mustPass and patches or files');
  const both = (ex.mustPass ?? []).filter(n => ex.mustFail?.includes(n));
  if (both.length) p.push(`checks ${both.join(', ')} are in mustFail and mustPass`);
  for (const f of [ex.build?.spec, ex.build?.rules, ...Object.values(ex.build?.files ?? {}), ...Object.values(ex.control?.files ?? {})].filter(Boolean)) if (ex.folder && !existsSync(join(ex.folder, f))) p.push(`${f} does not exist`);
  return p;
}

/** How verify runs on an example: one check alone when every check it judges can run alone, else the whole verify
 *  (--quick: the contact sheet, check 9, is never judged here). → {mode, args, checks} */
export function planVerify(ex) {
  if (ex.kind === 'pass-rule') return { mode: 'unit', args: [], checks: [] };
  const checks = [...new Set([...ex.mustFail, ...(ex.mustPass ?? []), ...Object.keys(ex.details ?? {}).map(Number)])].sort((a, b) => a - b);
  if (checks.length === 1 && CHECK_ALONE.includes(checks[0])) return { mode: `check ${checks[0]}`, args: ['--check', String(checks[0])], checks };
  if (checks.every(n => STATIC_CHECKS.includes(n))) return { mode: `check ${checks.join(',')}`, args: ['--check', checks.join(',')], checks };
  return { mode: 'full', args: ['--quick'], checks };
}

/** JSON pointer set (RFC 6901, plus "[key=value]" to pick an array element by a field). Creates objects on the way. */
export function setPointer(doc, pointer, value) {
  const toks = pointer.split('/').slice(1).map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!toks.length) throw new Error('a patch cannot replace the whole file');
  let o = doc;
  const step = (cur, t, make) => {
    const sel = /^\[(\w+)=(.*)\]$/.exec(t);
    if (sel) {
      if (!Array.isArray(cur)) throw new Error(`${pointer}: ${t} needs an array`);
      const i = cur.findIndex(x => x && String(x[sel[1]]) === sel[2]);
      if (i < 0) throw new Error(`${pointer}: no element with ${sel[1]} = ${sel[2]}`);
      return i;
    }
    if (Array.isArray(cur)) { if (t === '-') return cur.length; const i = Number(t); if (!Number.isInteger(i) || i < 0 || i > cur.length) throw new Error(`${pointer}: bad index ${t}`); return i; }
    if (make && (cur[t] === undefined || cur[t] === null)) cur[t] = {};
    return t;
  };
  for (const t of toks.slice(0, -1)) { const k = step(o, t, true); o = o[k]; if (o === null || typeof o !== 'object') throw new Error(`${pointer}: ${t} is not an object or array`); }
  const k = step(o, toks.at(-1), false);
  if (value === undefined) { if (Array.isArray(o)) o.splice(k, 1); else delete o[k]; } else o[k] = value;
  return doc;
}

/**
 * Build an example into `dir` (created; should be empty): rules.js first (so create vendors what the rules import),
 * then create from the spec, then the example's files and patches, the library model of every catalog prop the game
 * lacks (a saved config/props.json may name props today's template no longer uses), and assets.json from the slots.
 * → {dir, ms, steps}
 */
export async function buildExample(ex, dir) {
  const t0 = performance.now();
  const { create } = await import('../create.mjs');
  const { slots } = await import('../slots.mjs');
  const at = f => join(ex.folder, f);
  const steps = [];
  await mkdir(dir, { recursive: true });
  if (ex.build.rules) { await copyFile(at(ex.build.rules), join(dir, 'rules.js')); steps.push(`rules.js ← ${ex.build.rules}`); }
  const c = await create(at(ex.build.spec), dir, { force: true });
  if (!c.ok) throw new Error(`create failed: ${(c.problems ?? []).join('; ')}`);
  steps.push(`create ${ex.build.spec} (${c.slots} slots)`);
  for (const [to, from] of Object.entries(ex.build.files ?? {})) {
    await mkdir(dirname(join(dir, to)), { recursive: true });
    await copyFile(at(from), join(dir, to)); steps.push(`${to} ← ${from}`);
  }
  const byFile = new Map();
  for (const p of ex.build.patches ?? []) {
    if (!byFile.has(p.file)) byFile.set(p.file, JSON.parse(await readFile(join(dir, p.file), 'utf8')));
    setPointer(byFile.get(p.file), p.pointer, p.value);
    steps.push(`${p.file}${p.pointer} = ${JSON.stringify(p.value)}`);
  }
  for (const [f, doc] of byFile) await writeFile(join(dir, f), json(doc));
  const catalog = JSON.parse(await readFile(join(dir, 'config/props.json'), 'utf8').catch(() => '{"props":[]}'));
  const copied = [];
  for (const p of catalog.props ?? []) {
    const to = join(dir, 'assets/models', `${p.id}.glb`);
    if (existsSync(to) || !p.file || !existsSync(join(LIBRARY, p.file))) continue;
    await mkdir(dirname(to), { recursive: true }); await copyFile(join(LIBRARY, p.file), to); copied.push(p.id);
  }
  if (copied.length) steps.push(`library models for ${copied.join(', ')}`);
  const s = await slots(dir, { write: true });
  steps.push(`assets.json: ${s.slotCount} slots${s.wrote ? ' (rewritten)' : ''}`);
  return { dir, ms: Math.round(performance.now() - t0), steps };
}

/** A pass-rule example: every case's expected verdict against tools/lib/verdict.mjs. → {ok, rows} */
export function judgeUnit(ex, rule = passes) {
  const rows = ex.cases.map(c => { const got = rule(c.checks); return { name: c.name, want: c.pass, got, ok: got === c.pass }; });
  return { ok: rows.every(r => r.ok), rows, surprises: rows.filter(r => !r.ok).map(r => `case "${r.name}": the rule says ${r.got ? 'pass' : 'fail'}, it should ${r.want ? 'pass' : 'fail'}`) };
}

/**
 * Judge a verdict (verify's verdict.json) against an example. Every mustFail check must have run and failed (and its
 * details match), every mustPass check must have passed, and a verdict with a mustFail check failing must not pass.
 * → {ok, surprises, got: {n: true|false|null|undefined}, others: [checks that failed beyond mustFail]}
 */
export function judge(ex, verdict) {
  const got = {}, detail = {};
  for (const c of verdict?.checks ?? []) { got[c.n] = c.ok; detail[c.n] = c.detail ?? ''; }
  const say = v => (v === undefined ? 'did not run' : v === null ? 'was skipped' : v ? 'passed' : 'failed');
  const surprises = [];
  for (const n of ex.mustFail) if (got[n] !== false) surprises.push(`check ${n} must fail; it ${say(got[n])}`);
  for (const n of ex.mustPass ?? []) if (got[n] !== true) surprises.push(`check ${n} must pass; it ${say(got[n])}${got[n] === false ? `: ${detail[n].slice(0, 200)}` : ''}`);
  for (const [n, res] of Object.entries(ex.details ?? {})) for (const re of res) if (!new RegExp(re, 'i').test(detail[n] ?? '')) surprises.push(`check ${n}'s detail must match /${re}/: ${(detail[n] ?? '(none)').slice(0, 200)}`);
  if (verdict && ex.mustFail.some(n => got[n] === false) && verdict.pass !== false) surprises.push('the verdict passed although a check failed (the pass rule)');
  const others = Object.keys(got).map(Number).filter(n => got[n] === false && !ex.mustFail.includes(n));
  return { ok: surprises.length === 0, surprises, got, others };
}
