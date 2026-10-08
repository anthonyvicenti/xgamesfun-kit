// Examples: complete games to start from. templates/examples/<id>/ holds spec.json (the locked game spec), rules.js
// (the game's own rules), README.md, example.json ({ title, summary, verified }) and optionally files/ (config or
// asset files laid over what create made).
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EXAMPLES } from './paths.mjs';

async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }

export async function listExamples(root = EXAMPLES) {
  let names = [];
  try { names = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
  const out = [];
  for (const id of names) {
    const dir = path.join(root, id);
    if (!existsSync(path.join(dir, 'spec.json'))) continue;
    const spec = await readJson(path.join(dir, 'spec.json'), {});
    const meta = await readJson(path.join(dir, 'example.json'), {});
    out.push({ id, dir, title: meta.title ?? spec.title ?? id, summary: meta.summary ?? spec.hook ?? '', mechanics: (spec.mechanics ?? []).map(m => m.id), world: spec.world?.template ?? null, verified: meta.verified ?? null });
  }
  return out;
}

/** An example by id (a folder under templates/examples) or by path to such a folder. */
export async function resolveExample(idOrPath, { cwd = process.cwd() } = {}) {
  const all = await listExamples();
  const hit = all.find(e => e.id === idOrPath);
  if (hit) return hit;
  const dir = path.resolve(cwd, idOrPath);
  if (existsSync(path.join(dir, 'spec.json'))) {
    const spec = await readJson(path.join(dir, 'spec.json'), {});
    return { id: path.basename(dir), dir, title: spec.title ?? path.basename(dir), summary: spec.hook ?? '', mechanics: (spec.mechanics ?? []).map(m => m.id) };
  }
  throw new Error(`no example "${idOrPath}". Examples: ${all.map(e => e.id).join(', ') || '(none)'}`);
}
