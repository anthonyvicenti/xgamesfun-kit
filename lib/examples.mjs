// Examples: complete games to start from. templates/examples/<id>/ holds spec.json (the locked game spec), rules.js
// (the game's own rules), README.md, example.json ({ title, summary, verified, closed? }) and optionally files/ (config
// or asset files laid over what create made). An example on an engine that is not open to people's pitches yet says so
// in example.json → closed ({ env, why }): it is listed only when that variable is 1 (or with `all`), and `create --from`
// still finds it by id.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EXAMPLES } from './paths.mjs';

async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }

/** Is a closed example shown? Only when its variable is 1 (GF_VISTA_OPEN=1 for the vista engine's). */
export const exampleOpen = (e, env = process.env) => !e.closed?.env || env[e.closed.env] === '1';

export async function listExamples(root = EXAMPLES, { env = process.env, all = false } = {}) {
  let names = [];
  try { names = (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
  const out = [];
  for (const id of names) {
    const dir = path.join(root, id);
    if (!existsSync(path.join(dir, 'spec.json'))) continue;
    const spec = await readJson(path.join(dir, 'spec.json'), {});
    const meta = await readJson(path.join(dir, 'example.json'), {});
    out.push({ id, dir, title: meta.title ?? spec.title ?? id, summary: meta.summary ?? spec.hook ?? '', engine: spec.engine ?? 'party', mechanics: (spec.mechanics ?? []).map(m => m.id), world: spec.world?.template ?? null, verified: meta.verified ?? null, ...(meta.closed ? { closed: meta.closed } : {}) });
  }
  return all ? out : out.filter(e => exampleOpen(e, env));
}

/** An example by id (a folder under templates/examples) or by path to such a folder. */
export async function resolveExample(idOrPath, { cwd = process.cwd() } = {}) {
  const all = await listExamples(EXAMPLES, { all: true });
  const hit = all.find(e => e.id === idOrPath);
  if (hit) return hit;
  const dir = path.resolve(cwd, idOrPath);
  if (existsSync(path.join(dir, 'spec.json'))) {
    const spec = await readJson(path.join(dir, 'spec.json'), {});
    return { id: path.basename(dir), dir, title: spec.title ?? path.basename(dir), summary: spec.hook ?? '', mechanics: (spec.mechanics ?? []).map(m => m.id) };
  }
  throw new Error(`no example "${idOrPath}". Examples: ${all.filter(e => exampleOpen(e)).map(e => e.id).join(', ') || '(none)'}`);
}
