#!/usr/bin/env node
// Homes: where every rule lives (research/open-builder/HANDOFF.md section 4). One data file, tools/lib/homes.json,
// gives each verify check and each rule line of the build brief exactly one home:
//
//   invariant  true of every game whatever its kind; read by every build
//   part       belongs to one mechanic, world, loop, panel or engine (homes.json names which); read only by builds
//              whose spec uses that part
//   game       a promise this one game makes; held by that game's own tests
//   nowhere    taste, an accident, or something the kit now prevents; nobody reads it
//
// tests/h-homes.test.mjs fails when a check or a brief line has no home, when a tag names a line the brief no longer
// has, and when the brief's invariant lines pass their budget. verify reads each check's `rule` and `fix` from here
// and prints them with a failing check, so the rule reaches the build agent when it applies.
//
//   node research/gf-three/tools/lib/homes.mjs            the summary, and every problem (exit 1 when there is one)
//   node research/gf-three/tools/lib/homes.mjs --lines    every rule line of the brief with its hash and its home
//   node research/gf-three/tools/lib/homes.mjs --json
//
// A brief line is identified by a hash of its own text (sha256 of the trimmed line, 12 hex characters), so the brief
// is never edited to carry a tag, and a reworded line is a new line that needs a home.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './main.mjs';
import { REQUIRED, REQUIRED_WORLD, REQUIRED_FORGE, REQUIRED_VISTA, RELEASE_ONLY } from './verdict.mjs';

export const HOMES_FILE = fileURLToPath(new URL('./homes.json', import.meta.url));
export const HOMES = ['invariant', 'part', 'game', 'nowhere'];
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

export const loadHomes = () => JSON.parse(readFileSync(HOMES_FILE, 'utf8'));
let cached = null;
/** A check's entry in homes.json ({name, home, part?, run, rule, fix}), or null. */
export function checkHome(n) { cached ??= loadHomes(); return cached.checks?.[String(n)] ?? null; }

/** Every check verify can require, in any flow: a round's, a world's, a forge game's and a vista game's, and 9 (the contact sheet). */
export const allChecks = () => [...new Set([...REQUIRED, ...REQUIRED_WORLD, ...REQUIRED_FORGE, ...REQUIRED_VISTA, 9])].sort((a, b) => a - b);

export const lineHash = text => createHash('sha256').update(text.trim()).digest('hex').slice(0, 12);

/**
 * The rule lines of a brief: every line that tells the build agent something. Left out: blank lines, headings, code
 * fences and what is inside them, and a line that is only a {{PLACEHOLDER}} (filled per job, not a rule of ours).
 * → [{line (1-based), hash, text}]
 */
export function ruleLines(markdown) {
  const out = [];
  let fenced = false;
  for (const [i, raw] of markdown.split(/\r?\n/).entries()) {
    const text = raw.trim();
    if (text.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced || !text || text.startsWith('#') || /^\{\{[A-Z_]+\}\}$/.test(text)) continue;
    out.push({ line: i + 1, hash: lineHash(text), text });
  }
  return out;
}

/**
 * Hold homes.json against the checks verify requires and the brief as it is now.
 * → {ok, problems, summary: {checks: {home: count}, brief: {home: count}, budget, invariantLines}, lines}
 */
export function checkHomes(homes, briefText, { checks = allChecks() } = {}) {
  const problems = [];
  const count = () => Object.fromEntries(HOMES.map(h => [h, 0]));
  const sum = { checks: count(), brief: count() };
  const tagOk = (t, what) => {
    if (!t) { problems.push(`${what} has no home (add it to tools/lib/homes.json: invariant, part, game or nowhere)`); return false; }
    if (!HOMES.includes(t.home)) { problems.push(`${what}: home "${t.home}" is not one of ${HOMES.join(', ')}`); return false; }
    if (t.home === 'part' && !t.part) { problems.push(`${what}: a part needs to say which part`); return false; }
    return true;
  };
  for (const n of checks) {
    const t = homes.checks?.[String(n)];
    if (!tagOk(t, `check ${n}`)) continue;
    sum.checks[t.home]++;
    for (const k of ['name', 'rule', 'fix']) if (!t[k]) problems.push(`check ${n} has no ${k} (verify prints the rule and the fix with a failing check)`);
    const run = RELEASE_ONLY.includes(n) ? 'release' : 'build';
    if (n !== 9 && t.run !== run) problems.push(`check ${n}: run is "${t.run}", and tools/lib/verdict.mjs RELEASE_ONLY says "${run}"`);
  }
  for (const k of Object.keys(homes.checks ?? {})) if (!checks.includes(Number(k))) problems.push(`homes.json tags check ${k}, which verify does not require`);

  const lines = ruleLines(briefText);
  const tags = new Map();
  for (const t of homes.brief?.lines ?? []) { if (tags.has(t.hash)) problems.push(`homes.json tags the brief line ${t.hash} twice`); tags.set(t.hash, t); }
  const seen = new Set();
  const rows = lines.map(l => {
    const t = tags.get(l.hash) ?? null;
    seen.add(l.hash);
    if (tagOk(t, `brief line ${l.line} (${l.hash}: "${l.text.slice(0, 70)}…")`)) sum.brief[t.home]++;
    return { ...l, home: t?.home ?? null, part: t?.part ?? null };
  });
  for (const [hash, t] of tags) if (!seen.has(hash)) problems.push(`homes.json tags a brief line that is no longer in ${homes.brief.file} (${hash}: "${t.starts ?? ''}"): remove the tag, or give the reworded line its home`);
  const budget = homes.brief?.budget?.invariantLines;
  if (!Number.isInteger(budget)) problems.push('homes.json → brief.budget.invariantLines is missing');
  else if (sum.brief.invariant > budget) problems.push(`the brief has ${sum.brief.invariant} invariant lines; the budget is ${budget}. A new rule goes in the part it concerns, or an older invariant line moves out first`);
  for (const c of homes.brief?.corrections ?? []) if (!lines.some(l => l.hash === c.hash)) problems.push(`homes.json → brief.corrections names a line that is no longer in the brief (${c.hash}): the correction was applied or the line changed; remove it`);
  return { ok: problems.length === 0, problems, summary: { ...sum, budget, invariantLines: sum.brief.invariant, ruleLines: lines.length, checks: sum.checks, checkCount: checks.length }, lines: rows };
}

export async function readBrief(homes = loadHomes()) { return readFile(join(REPO, homes.brief.file), 'utf8'); }

if (isMain(import.meta)) {
  const a = process.argv.slice(2);
  const homes = loadHomes();
  const r = checkHomes(homes, await readBrief(homes));
  if (a.includes('--json')) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else {
    if (a.includes('--lines')) for (const l of r.lines) console.log(`${String(l.line).padStart(3)} ${l.hash} ${(l.home ?? 'NO HOME').padEnd(9)} ${(l.part ?? '').padEnd(22)} ${l.text.slice(0, 90)}`);
    const s = r.summary, row = o => HOMES.map(h => `${h} ${o[h]}`).join(' · ');
    console.log(`checks (${s.checkCount}): ${row(s.checks)}`);
    console.log(`brief rule lines (${s.ruleLines}): ${row(s.brief)} · invariant budget ${s.invariantLines}/${s.budget}`);
    for (const p of r.problems) console.log(`PROBLEM ${p}`);
    console.log(r.ok ? 'homes: OK' : `homes: ${r.problems.length} problems`);
  }
  process.exitCode = r.ok ? 0 : 1;
}
