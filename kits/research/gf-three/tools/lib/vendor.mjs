// Vendoring for `create`: the pinned third-party libraries into <game>/vendor/, the kit into <game>/gf/three/, and
// gf-assets into <game>/gf/. Every copy is byte for byte; a file is written only when it differs (so a re-run of
// create reports 0 written and leaves mtimes alone).
//
// three.js addons are resolved, not copied wholesale: every `three/addons/…` (or `three/examples/jsm/…`) the kit, the
// look/world/character/mechanics modules and the game's rules.js import, plus each one's relative imports, plus the
// Draco and Basis decoders the loaders fetch at run time. A new addon in a module needs no list change here.
//
// Engines (CONTRACT §8): `modules.engine` is 'party' (absent in older records) or 'scenic'. A scenic game gets three.js
// 0.186.0's WebGPU build instead of the WebGL one, no postprocessing or N8AO, and research/gf-scenic/kit as gf/scenic/
// (its look and world); gf/three/ then leaves out this kit's own look/ and world/. A forge game (CONTRACT §8 forge) gets
// research/gf-forge/kit as gf/forge/ (the core's release wasm, its host, look, world and players), no vendor/ at all (no
// three.js, no Rapier), and of gf/three/ only what core/boot-forge.js imports (the shared system without three.js).
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { VENDOR, KIT, SCENIC_KIT, FORGE_KIT, GF_ASSETS, KIT_VERSION, SCENIC_VERSION, FORGE_VERSION, walk, sha256 } from './paths.mjs';

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

/** vendor/: three (build + resolved addons), Rapier, postprocessing, N8AO, each with its licence. → {files, wrote}
 *  engine 'scenic': three's WebGPU build (three.webgpu.js, three.tsl.js, three.core.js) and Rapier only. */
export async function vendorLibraries(gameDir, sourceTexts, { engine = 'party' } = {}) {
  const wrote = [], files = [];
  const add = async (from, rel) => { files.push(rel); await copy(from, join(gameDir, rel), wrote, rel); };
  // a forge game draws with the Rust core: no third-party library is vendored (anything left from an earlier run goes)
  if (engine === 'forge') { for (const rel of await walk(join(gameDir, 'vendor'))) { await rm(join(gameDir, 'vendor', rel)); wrote.push(`-vendor/${rel}`); } return { files, wrote }; }
  const scenic = engine === 'scenic';
  if (scenic) for (const f of ['build/three.webgpu.js', 'build/three.tsl.js', 'build/three.core.js', 'LICENSE']) await add(join(VENDOR.threeWebgpu, f), `vendor/three/${f}`);
  else for (const f of ['build/three.module.js', 'build/three.core.js', 'LICENSE']) await add(join(VENDOR.threeBuild, f), `vendor/three/${f}`);
  // the vendored libraries import addons too (N8AO: three/examples/jsm/postprocessing/Pass.js)
  const libTexts = scenic ? [] : await Promise.all([join(VENDOR.n8ao, 'N8AO.js'), join(VENDOR.postprocessing, 'postprocessing.module.js')].map(f => readFile(f, 'utf8')));
  const addons = [...new Set([...(await addonClosure([...sourceTexts, ...libTexts])), ...RUNTIME_ADDONS])].sort();
  for (const rel of addons) await add(addonPath(rel), `vendor/three/examples/jsm/${rel}`);
  for (const f of ['rapier.mjs', 'LICENSE', 'package.json']) await add(join(VENDOR.rapier, f), `vendor/rapier/${f}`);
  if (!scenic) {
    for (const f of ['postprocessing.module.js', 'LICENSE.md']) await add(join(VENDOR.postprocessing, f), `vendor/postprocessing/${f}`);
    for (const f of ['N8AO.js', 'LICENSE']) await add(join(VENDOR.n8ao, f), `vendor/n8ao/${f}`);
  }
  // anything left in vendor/ from an earlier run that is no longer needed goes
  const keep = new Set(files);
  for (const rel of await walk(join(gameDir, 'vendor'))) if (!keep.has(`vendor/${rel}`)) { await rm(join(gameDir, 'vendor', rel)); wrote.push(`-vendor/${rel}`); }
  return { files, wrote };
}

/** The scenic engine's files a game gets as gf/scenic/ (CONTRACT §8): its code and licences, not its docs or tests. */
export async function scenicFiles() {
  const files = {};
  if (!existsSync(SCENIC_KIT)) return files;
  for (const rel of await walk(SCENIC_KIT, { skip: kitSkip })) files[rel] = sha256(await readFile(join(SCENIC_KIT, rel)));
  return files;
}

/** The forge engine's files a game gets as gf/forge/ (CONTRACT §8 forge): the host, look, world, players, show, the
 *  meshopt decoder and the release wasm with its BUILD.json; not its docs or tests. */
export async function forgeFiles() {
  const files = {};
  if (!existsSync(FORGE_KIT)) return files;
  for (const rel of await walk(FORGE_KIT, { skip: kitSkip })) files[rel] = sha256(await readFile(join(FORGE_KIT, rel)));
  return files;
}

/** The shared kit files a forge game carries: what core/boot-forge.js imports inside the kit, followed through every
 *  relative import, plus the slot declarations tools/slots.mjs reads from the game's copy. Nothing that imports three. */
export async function forgeKitClosure() {
  const need = new Set(), queue = ['core/boot-forge.js', 'ui/slots.js', 'core/slots.js', 'controller/slots.js'];
  while (queue.length) {
    const rel = queue.shift();
    if (need.has(rel) || !existsSync(join(KIT, rel))) continue;
    need.add(rel);
    if (!/\.m?js$/.test(rel)) continue;
    for (const spec of importsOf(await readFile(join(KIT, rel), 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const to = posix.normalize(posix.join(posix.dirname(rel), spec));
      if (!to.startsWith('..')) queue.push(to);
    }
  }
  return [...need].sort();
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

// a scenic game's look and world are gf/scenic's, so gf/three/ leaves this kit's own out (CONTRACT §8)
// a forge game's gf/three/ is the forge closure alone (forgeKitClosure); a three.js game never carries the forge boot
const dropModule = (modules, rel, closure = null) => (modules.engine === 'forge' ? !closure?.includes(rel) : rel === 'core/boot-forge.js')
  || ((!modules.look || modules.engine === 'scenic') && rel.startsWith('look/')) || ((!modules.world || modules.engine === 'scenic') && rel.startsWith('world/')) || (!modules.character && rel.startsWith('character/'))
  || (rel.startsWith('mechanics/') && !(modules.mechanics ?? []).includes(rel.split('/')[1]));

/** What vendorKit would put in gf/three/ for these modules, without writing: { rel: sha256 } (kit.js aside). */
export async function kitFiles(modules) {
  const files = {}, closure = modules.engine === 'forge' ? await forgeKitClosure() : null;
  for (const rel of (await walk(KIT, { skip: kitSkip })).filter(r => r !== 'kit.js')) if (!dropModule(modules, rel, closure)) files[rel] = sha256(await readFile(join(KIT, rel)));
  return files;
}

/**
 * gf/three/: the kit, plus gf/three/kit.js (generated: version, which real modules are in, a hash per file) that boot
 * reads and verify checks the copy against. modules: {look, world, character, mechanics: [ids]} as create decided.
 */
export async function vendorKit(gameDir, modules) {
  const wrote = [], files = {};
  const rels = (await walk(KIT, { skip: kitSkip })).filter(r => r !== 'kit.js');
  const closure = modules.engine === 'forge' ? await forgeKitClosure() : null;
  for (const rel of rels) {
    if (dropModule(modules, rel, closure)) continue;
    const buf = await readFile(join(KIT, rel));
    files[rel] = sha256(buf);
    await put(join(gameDir, 'gf/three', rel), buf, wrote, `gf/three/${rel}`);
  }
  // the scenic engine (CONTRACT §8): research/gf-scenic/kit as gf/scenic/, hashed in kit.js beside gf/three's own files
  const engine = ['scenic', 'forge'].includes(modules.engine) ? modules.engine : 'party';
  const scenic = engine === 'scenic' ? await scenicFiles() : null;
  for (const rel of Object.keys(scenic ?? {})) await put(join(gameDir, 'gf/scenic', rel), await readFile(join(SCENIC_KIT, rel)), wrote, `gf/scenic/${rel}`);
  for (const rel of await walk(join(gameDir, 'gf/scenic'))) if (!scenic || !(rel in scenic)) { await rm(join(gameDir, 'gf/scenic', rel)); wrote.push(`-gf/scenic/${rel}`); }
  // the forge engine (CONTRACT §8 forge): research/gf-forge/kit as gf/forge/, hashed in kit.js like gf/scenic
  const forge = engine === 'forge' ? await forgeFiles() : null;
  for (const rel of Object.keys(forge ?? {})) await put(join(gameDir, 'gf/forge', rel), await readFile(join(FORGE_KIT, rel)), wrote, `gf/forge/${rel}`);
  for (const rel of await walk(join(gameDir, 'gf/forge'))) if (!forge || !(rel in forge)) { await rm(join(gameDir, 'gf/forge', rel)); wrote.push(`-gf/forge/${rel}`); }
  let wasm = null;
  if (forge) { try { wasm = JSON.parse(await readFile(join(FORGE_KIT, 'BUILD.json'), 'utf8')).wasm?.sha256 ?? null; } catch {} }
  const record = { name: 'gf-three', version: KIT_VERSION, engine, modules, files, ...(scenic ? { scenic: { name: 'gf-scenic', version: SCENIC_VERSION, files: scenic } } : {}),
    ...(forge ? { forge: { name: 'gf-forge', version: FORGE_VERSION, wasm, main: 'core/boot-forge.js', files: forge } } : {}) };
  const kitJs = `// Generated by research/gf-three/tools/create.mjs: the kit version, which real modules this copy carries, and a\n// hash of every file (tools/verify.mjs check 2). Part of the kit copy: never edited.\nexport default ${JSON.stringify(record, null, 1)};\n`;
  await put(join(gameDir, 'gf/three/kit.js'), kitJs, wrote, 'gf/three/kit.js');
  for (const rel of await walk(join(gameDir, 'gf/three'))) if (rel !== 'kit.js' && !(rel in files)) { await rm(join(gameDir, 'gf/three', rel)); wrote.push(`-gf/three/${rel}`); }
  const texts = await Promise.all(Object.keys(files).filter(r => /\.m?js$/.test(r)).map(r => readFile(join(KIT, r), 'utf8')));
  for (const rel of Object.keys(scenic ?? {}).filter(r => /\.m?js$/.test(r))) texts.push(await readFile(join(SCENIC_KIT, rel), 'utf8'));
  return { files, wrote, sourceTexts: texts };
}

export async function vendorGfAssets(gameDir) {
  const wrote = [];
  await copy(GF_ASSETS, join(gameDir, 'gf/gf-assets.js'), wrote, 'gf/gf-assets.js');
  return { wrote };
}
