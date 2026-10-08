// Vendoring for `create`: the pinned third-party libraries into <game>/vendor/, the kit into <game>/gf/three/, and
// gf-assets into <game>/gf/. Every copy is byte for byte; a file is written only when it differs (so a re-run of
// create reports 0 written and leaves mtimes alone).
//
// three.js addons are resolved, not copied wholesale: every `three/addons/…` (or `three/examples/jsm/…`) the kit, the
// look/world/character/mechanics modules and the game's rules.js import, plus each one's relative imports, plus the
// Draco and Basis decoders the loaders fetch at run time. A new addon in a module needs no list change here.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { VENDOR, KIT, GF_ASSETS, KIT_VERSION, walk, sha256 } from './paths.mjs';

/** Write `buf` to `path` unless it already holds exactly those bytes. → true when written. */
export async function put(path, buf, wrote = null, rel = null) {
  const cur = await readFile(path).catch(() => null);
  if (cur && cur.equals(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  if (wrote) wrote.push(rel ?? path);
  return true;
}
const copy = async (from, to, wrote, rel) => put(to, await readFile(from), wrote, rel);

const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
export function importsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(IMPORT_RE)) { const s = m[1] ?? m[2]; if (s) out.add(s); }
  return [...out];
}
const addonPath = rel => { for (const d of VENDOR.threeAddons) { const p = join(d, 'examples/jsm', rel); if (existsSync(p)) return p; } return null; };

/** The three.js addon files (paths under examples/jsm/) that the given source texts need, with their own imports. */
export async function addonClosure(texts) {
  const need = new Set(), queue = [];
  const want = rel => { rel = posix.normalize(rel); if (!need.has(rel)) { need.add(rel); queue.push(rel); } };
  for (const t of texts) for (const s of importsOf(t)) { const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(s); if (m) want(m[1]); }
  while (queue.length) {
    const rel = queue.shift(), file = addonPath(rel);
    if (!file) throw new Error(`three.js addon "${rel}" is not in the pinned copy (research/gf-three/tools/lib/vendor/three): add it from three 0.186.0`);
    for (const s of importsOf(await readFile(file, 'utf8'))) {
      if (s.startsWith('.')) want(posix.join(posix.dirname(rel), s));
      else { const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(s); if (m) want(m[1]); }
    }
  }
  return [...need].sort();
}

// Files the loaders fetch at run time (never imported): the Draco and Basis decoders.
const RUNTIME_ADDONS = ['libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js', 'libs/draco/README.md', 'libs/basis/basis_transcoder.js', 'libs/basis/basis_transcoder.wasm', 'libs/basis/README.md'];

/** vendor/: three (build + resolved addons), Rapier, postprocessing, N8AO, each with its licence. → {files, wrote} */
export async function vendorLibraries(gameDir, sourceTexts) {
  const wrote = [], files = [];
  const add = async (from, rel) => { files.push(rel); await copy(from, join(gameDir, rel), wrote, rel); };
  for (const f of ['build/three.module.js', 'build/three.core.js', 'LICENSE']) await add(join(VENDOR.threeBuild, f), `vendor/three/${f}`);
  // the vendored libraries import addons too (N8AO: three/examples/jsm/postprocessing/Pass.js)
  const libTexts = await Promise.all([join(VENDOR.n8ao, 'N8AO.js'), join(VENDOR.postprocessing, 'postprocessing.module.js')].map(f => readFile(f, 'utf8')));
  const addons = [...new Set([...(await addonClosure([...sourceTexts, ...libTexts])), ...RUNTIME_ADDONS])].sort();
  for (const rel of addons) await add(addonPath(rel), `vendor/three/examples/jsm/${rel}`);
  for (const f of ['rapier.mjs', 'LICENSE', 'package.json']) await add(join(VENDOR.rapier, f), `vendor/rapier/${f}`);
  for (const f of ['postprocessing.module.js', 'LICENSE.md']) await add(join(VENDOR.postprocessing, f), `vendor/postprocessing/${f}`);
  for (const f of ['N8AO.js', 'LICENSE']) await add(join(VENDOR.n8ao, f), `vendor/n8ao/${f}`);
  // anything left in vendor/ from an earlier run that is no longer needed goes
  const keep = new Set(files);
  for (const rel of await walk(join(gameDir, 'vendor'))) if (!keep.has(`vendor/${rel}`)) { await rm(join(gameDir, 'vendor', rel)); wrote.push(`-vendor/${rel}`); }
  return { files, wrote };
}

/** Which real modules the kit source holds, judged by their files (create confirms them by importing). */
export async function kitModuleFiles() {
  const has = rel => existsSync(join(KIT, rel));
  const mechanics = [];
  for (const rel of await walk(join(KIT, 'mechanics'), { skip: r => /(^|\/)(fixture|tests?)(\/|$)/.test(r) })) {
    const m = /^([a-z0-9-]+)\/index\.js$/.exec(rel); if (m) mechanics.push(m[1]);
  }
  return { look: has('look/look.js'), world: has('world/world.js'), character: has('character/character.js'), mechanics: mechanics.sort() };
}

// What a game's gf/three/ holds: the kit's code and licences, never its docs, tests or the mechanics' fixtures.
const kitSkip = rel => /(^|\/)(fixture|fixtures|tests?|evidence)(\/|$)/.test(rel) || /\.test\.m?js$/.test(rel) || (/\.md$/i.test(rel) && !/^(LICEN[CS]E|NOTICE|THIRD_PARTY)/i.test(rel.split('/').pop()));

const dropModule = (modules, rel) => (!modules.look && rel.startsWith('look/')) || (!modules.world && rel.startsWith('world/')) || (!modules.character && rel.startsWith('character/'))
  || (rel.startsWith('mechanics/') && !modules.mechanics.includes(rel.split('/')[1]));

/** What vendorKit would put in gf/three/ for these modules, without writing: { rel: sha256 } (kit.js aside). */
export async function kitFiles(modules) {
  const files = {};
  for (const rel of (await walk(KIT, { skip: kitSkip })).filter(r => r !== 'kit.js')) if (!dropModule(modules, rel)) files[rel] = sha256(await readFile(join(KIT, rel)));
  return files;
}

/**
 * gf/three/: the kit, plus gf/three/kit.js (generated: version, which real modules are in, a hash per file) that boot
 * reads and verify checks the copy against. modules: {look, world, character, mechanics: [ids]} as create decided.
 */
export async function vendorKit(gameDir, modules) {
  const wrote = [], files = {};
  const rels = (await walk(KIT, { skip: kitSkip })).filter(r => r !== 'kit.js');
  for (const rel of rels) {
    if (dropModule(modules, rel)) continue;
    const buf = await readFile(join(KIT, rel));
    files[rel] = sha256(buf);
    await put(join(gameDir, 'gf/three', rel), buf, wrote, `gf/three/${rel}`);
  }
  const kitJs = `// Generated by research/gf-three/tools/create.mjs: the kit version, which real modules this copy carries, and a\n// hash of every file (tools/verify.mjs check 2). Part of the kit copy: never edited.\nexport default ${JSON.stringify({ name: 'gf-three', version: KIT_VERSION, modules, files }, null, 1)};\n`;
  await put(join(gameDir, 'gf/three/kit.js'), kitJs, wrote, 'gf/three/kit.js');
  for (const rel of await walk(join(gameDir, 'gf/three'))) if (rel !== 'kit.js' && !(rel in files)) { await rm(join(gameDir, 'gf/three', rel)); wrote.push(`-gf/three/${rel}`); }
  return { files, wrote, sourceTexts: await Promise.all(Object.keys(files).filter(r => /\.m?js$/.test(r)).map(r => readFile(join(KIT, r), 'utf8'))) };
}

export async function vendorGfAssets(gameDir) {
  const wrote = [];
  await copy(GF_ASSETS, join(gameDir, 'gf/gf-assets.js'), wrote, 'gf/gf-assets.js');
  return { wrote };
}
