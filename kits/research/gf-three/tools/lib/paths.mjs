// gf-three tools: where things are. Every path is absolute; nothing depends on the working directory.
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const GF3 = join(REPO, 'research/gf-three');
export const KIT = join(GF3, 'kit');
export const LIBRARY = join(GF3, 'library');
export const TOOLS = join(GF3, 'tools');
export const TOOLS_LIB = join(TOOLS, 'lib');
export const STANDIN_ASSETS = join(TOOLS_LIB, 'standin-assets');
export const SPEC_SCHEMA = join(REPO, 'research/studio-v2/game-spec.schema.json');
export const KIT_VERSION = '0.1.0-dev';

// Pinned third-party sources (research/gf-three/README.md "Pinned"), copied byte for byte into a game's vendor/.
const T = 'research/foundations/trials';
export const VENDOR = {
  // three 0.186.0: the build from fps-arena (byte-identical to the npm tarball); addons resolve from the curated copy
  threeBuild: join(REPO, `${T}/fps-arena/source/vendor/three`),
  threeAddons: [join(TOOLS_LIB, 'vendor/three'), join(REPO, `${T}/fps-arena/source/vendor/three`)],
  rapier: join(REPO, `${T}/third-person-adventure/source/vendor/rapier`),
  postprocessing: join(REPO, `${T}/fps-arena/source/vendor/postprocessing`),
  n8ao: join(REPO, `${T}/fps-arena/source/vendor/n8ao`),
};
export const GF_ASSETS = join(REPO, 'research/foundations/kits/gf-assets/1.3.0/source/gf-assets.js');
export const GF_AUDIO = join(REPO, 'research/foundations/kits/gf-audio/1.5.0');
export const PARTY = join(REPO, 'research/multiplayer/party');

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const sha256File = async p => sha256(await readFile(p));

/** Every file under dir (relative paths with /), sorted, skipping node_modules and .git. */
export async function walk(dir, { skip = () => false } = {}, base = dir, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name), rel = p.slice(base.length + 1).split('\\').join('/');
    if (skip(rel, e)) continue;
    if (e.isDirectory()) await walk(p, { skip }, base, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Stable JSON: two-space indent, a trailing newline (the same input always gives the same bytes). */
export const json = v => JSON.stringify(v, null, 2) + '\n';
