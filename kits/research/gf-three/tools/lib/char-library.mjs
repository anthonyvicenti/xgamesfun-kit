// The body libraries create resolves a spec character from (CONTRACT §8, two engines): gf-three's own
// (research/gf-three/library/bodies.json, the party bodies: beans, Quaternius, Meshy) and the scenic engine's
// (research/gf-scenic/library/bodies.json: KayKit adventurers and skeletons). Every body is on gf-humanoid-1 and plays
// the same clip file, so any game may wear any of them; a spec names one by id (`characters[].body.library`).
//
// gf-three's list comes first, so every id it has resolves exactly as before; a scenic id only adds what was missing.
// Plain JSON reads, no three.js (spec-config imports this).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIBRARIES = Object.freeze([
  { engine: 'party', root: fileURLToPath(new URL('../../library/', import.meta.url)) },
  { engine: 'scenic', root: fileURLToPath(new URL('../../../gf-scenic/library/', import.meta.url)) },
]);

const list = v => (Array.isArray(v) ? v : v?.bodies ?? []);
async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }

/**
 * Every library body, gf-three's first: [{...entry, library: 'party'|'scenic', root, path (absolute file)}].
 * `roots` overrides the libraries (tests).
 */
export async function libraryBodies({ roots = LIBRARIES } = {}) {
  const out = [], seen = new Set();
  for (const L of roots) {
    for (const b of list(await readJson(join(L.root, 'bodies.json')))) {
      if (!b?.id || seen.has(b.id) || typeof b.file !== 'string') continue;
      seen.add(b.id);
      out.push({ ...b, library: L.engine, root: L.root, path: join(L.root, b.file) });
    }
  }
  return out;
}

/** One body by id (the first library that has it), with its absolute `path`, or null. */
export async function libraryBodyById(id, opts) {
  return (await libraryBodies(opts)).find(b => b.id === id && existsSync(b.path)) ?? null;
}
