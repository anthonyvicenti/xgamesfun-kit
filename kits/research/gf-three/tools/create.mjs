#!/usr/bin/env node
// gf-three create: a game spec → a runnable, multiplayer, slot-complete three.js project (CONTRACT §1). A script,
// no agent: the same spec always gives the same files.
//
//   node research/gf-three/tools/create.mjs <spec.json> <out-dir> [--force] [--new-rules] [--standins] [--standin-mechanics] [--json]
//
//   --force      also overwrite config/*.json, assets/* and multiplayer.json when they exist (without it an existing one
//                is kept as it is: re-running create refreshes the kit and the vendored code only)
//   --new-rules  replace rules.js with the stub too (never done otherwise: rules.js is the game agent's file)
//   --standins   use the kit's stand-in look, world and character even when the real modules exist
//   --standin-mechanics   leave the mechanics' modules out (the rules do their part; their params stay in config)
//   Options are kept in gf-three.json: a re-run without flags makes the same choices again.
//
// It validates the spec (research/studio-v2/game-spec.schema.json); vendors three, Rapier, postprocessing and N8AO
// (vendor/), the kit (gf/three/), gf-multiplayer (its current KIT_VERSION, gf/mp/, via research/multiplayer/party/adopt.mjs), gf-assets
// 1.3.0 (gf/gf-assets.js) and gf-audio 1.5.0 (audio/); writes config/*.json, assets/, assets.json (from the slot
// declarations), multiplayer.json (mode live), index.html, main.js, a rules.js stub carrying the spec's rules as
// comments, ATTRIBUTION.md, spec.json and gf-three.json (the build record). Exit 0 ok, 1 failed, 2 bad usage or spec.
//
// Parts carry their own (each mechanic's `manifest` in kit/mechanics/<id>/index.js; tools/catalog.mjs MANIFEST): the
// spec's mechanics are composed by their manifests and a set that cannot work is refused with the cause (a mechanic on
// an engine it does not run on, a part or a world capability it needs and the spec lacks, two owners of one resource);
// rules.js is assembled from the stubs of the spec's mechanics: each one's callbacks as empty named handlers, one
// worked line and its own traps.
import { isMain } from './lib/main.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, KIT, SCENIC_KIT, FORGE, FORGE_KIT, importPart, LIBRARY, KIT_VERSION, SCENIC_VERSION, FORGE_VERSION, SPEC_SCHEMA, GF_AUDIO, json, sha256, engineOf, walk } from './lib/paths.mjs';
import { check, withDefaults } from './lib/schema.mjs';
import { put, vendorLibraries, vendorKit, vendorGfAssets, kitModuleFiles } from './lib/vendor.mjs';
import { importKitModule } from './lib/kit-import.mjs';
import { specToConfig, libraryPicture } from './lib/spec-config.mjs';
import { assembleManifest } from './lib/slots-lib.mjs';
import { mechanicIds, mechanicParts, composeProblems, worldParts } from './catalog.mjs';
import { adopt } from '../../multiplayer/party/adopt.mjs';
import { KIT_VERSION as MP_KIT_VERSION } from '../../multiplayer/party/manifest.mjs';

export const AUDIO_FILES = ['audio.js', 'zzfx.mjs', 'sounds.mjs', 'meter.mjs', 'presets.json', 'code-sounds.js', 'LICENSE-zzfx', 'ATTRIBUTION.md', 'VERSION'];

/** Which real modules to use: present in the kit source AND importable with the contract's exports.
 *  engine 'scenic' (CONTRACT §8): the look and world are research/gf-scenic/kit's, never stand-ins. */
export async function decideModules({ standins = false, standinMechanics = false, engine = 'party', kit = KIT } = {}) {
  const found = await kitModuleFiles(), out = { look: false, world: false, character: false, mechanics: [] }, why = [];
  const scenic = engine === 'scenic';
  if (scenic) out.engine = 'scenic';
  // the forge engine (CONTRACT §8 forge): its look and world are research/gf-forge/kit's; no three.js character, and no
  // mechanic module runs on it yet (their params stay in config for the rules); never stand-ins
  if (engine === 'forge') {
    out.engine = 'forge';
    await importPart(join(FORGE_KIT, 'look.js'), 'the forge engine (research/gf-forge)');   // absent: the plain "not in this checkout" wording
    const mods = { mechanics: {} };
    for (const [key, rel, names] of [['look', 'look.js', ['presets', 'lookConfig', 'slotsFor', 'pack']], ['world', 'world.js', ['templates', 'worldConfig', 'slotsFor', 'loadWorld']]]) {
      const m = await importKitModule(join(FORGE_KIT, rel));
      const missing = names.filter(n => !(n in m));
      if (m.error || missing.length) throw new Error(`${key}: ${rel} ${m.error ? `does not import (${m.error.message.split('\n')[0]})` : `lacks ${missing.join(', ')}`} in research/gf-forge/kit: the forge engine has no stand-in`);
      out[key] = true; mods[key] = m; why.push(`${key}: the forge engine's (gf-forge ${FORGE_VERSION})`);
    }
    why.push('character: the forge engine\'s (first person: your own body is never drawn; friends and enemies are skinned by the Rust renderer, gf/forge/wear.js)', 'mechanics: no gf-three mechanic module runs on forge (the Rust core plays weapons, hits, enemies and waves from the forge tables); their params stay in config/game.json');
    return { modules: out, why, mods };
  }
  if (standins && !scenic) return { modules: out, why: ['--standins: every module is a stand-in'], mods: {} };
  const mods = {};
  const tryMod = async (key, rel, names, root = KIT, label = 'the real module') => {
    if (root === KIT && !found[key]) { why.push(`${key}: not in the kit yet (stand-in)`); return; }
    const m = await importKitModule(join(root, rel));
    const missing = names.filter(n => !(n in m));
    if (m.error || missing.length) {
      const what = `${key}: ${rel} ${m.error ? `does not import (${m.error.message.split('\n')[0]})` : `lacks ${missing.join(', ')}`}`;
      if (root !== KIT) throw new Error(`${what} in research/gf-scenic/kit: the scenic engine has no stand-in`);
      why.push(`${what} (stand-in)`); return;
    }
    out[key] = true; mods[key] = m; why.push(`${key}: ${label}`);
  };
  if (scenic) {
    await tryMod('look', 'look/look.js', ['createRenderer', 'applyLook', 'presets', 'lookConfig'], SCENIC_KIT, `the scenic engine's (gf-scenic ${SCENIC_VERSION})`);
    await tryMod('world', 'world/world.js', ['loadWorld', 'templates', 'worldConfig'], SCENIC_KIT, `the scenic engine's (gf-scenic ${SCENIC_VERSION})`);
  } else {
    await tryMod('look', 'look/look.js', ['createRenderer', 'applyLook']);
    await tryMod('world', 'world/world.js', ['loadWorld']);
  }
  if (standins) { why.push('--standins: the character and mechanics are stand-ins (a scenic game keeps its look and world)'); return { modules: out, why, mods }; }
  await tryMod('character', 'character/character.js', ['spawnCharacter']);
  // the real character plays the shared clips on gf-humanoid-1 bodies: without both in the library it can't run
  if (out.character && !(existsSync(join(LIBRARY, 'clips/gf-humanoid-1.glb')) && existsSync(join(LIBRARY, 'bodies')))) { out.character = false; why.push('character: library/clips/gf-humanoid-1.glb or library/bodies/ missing (stand-in)'); }
  mods.mechanics = {};
  if (standinMechanics) { why.push('mechanics: left out (--standin-mechanics: the rules do their part)'); return { modules: out, why, mods }; }
  // `kit` (tests): the mechanics' declarations read from another kit folder; vendoring (tools/lib/vendor.mjs) still copies this kit
  for (const id of kit === KIT ? found.mechanics : await mechanicIds(kit)) {
    const m = await importKitModule(join(kit, `mechanics/${id}/index.js`));
    if (m.error || typeof m.create !== 'function' || m.id !== id) { why.push(`mechanic ${id}: ${m.error ? 'does not import' : 'lacks id/create'} (its params stay in config)`); continue; }
    out.mechanics.push(id); mods.mechanics[id] = m;
  }
  return { modules: out, why, mods };
}

export async function create(specPath, outDir, { force = false, newRules = false, standins = null, standinMechanics = null, kitDir = KIT, log = () => {} } = {}) {
  const t0 = performance.now();
  const dir = resolve(outDir);
  // a re-run makes the choices the first run made, unless told otherwise
  const prev = JSON.parse(await readFile(join(dir, 'gf-three.json'), 'utf8').catch(() => '{}')).options ?? {};
  const options = { standins: standins ?? prev.standins ?? false, standinMechanics: standinMechanics ?? prev.standinMechanics ?? false };
  const specBytes = await readFile(resolve(specPath));
  let spec;
  try { spec = JSON.parse(specBytes.toString('utf8')); } catch (e) { return { ok: false, code: 2, problems: [`spec is not JSON: ${e.message}`] }; }
  const schema = JSON.parse(await readFile(SPEC_SCHEMA, 'utf8'));
  // which mechanics exist is the kit's to say (its folders), not a list to keep in step with it
  const kitIds = await mechanicIds(kitDir), idSchema = schema.properties?.mechanics?.items?.properties?.id;
  if (idSchema?.enum && kitIds.length) idSchema.enum = kitIds;
  const problems = check(schema, spec);
  // a round needs its length; a world (round.mode 'world', CONTRACT §9) has none, and needs the voxel world
  if (spec.round?.mode !== 'world' && !Number.isInteger(spec.round?.seconds)) problems.push('round.seconds: required (unless round.mode is world)');
  if (spec.round?.mode === 'world' && spec.world?.template !== 'voxel') problems.push('round.mode world: needs world.template voxel');
  // every game has a mechanic, except a forge game in wave 0, where none runs yet (CONTRACT §8 forge)
  if (engineOf(spec) !== 'forge' && !(spec.mechanics?.length >= 1)) problems.push('mechanics: at least 1 items');
  if (problems.length) return { ok: false, code: 2, problems: problems.map(p => `spec ${p}`) };

  const engine = engineOf(spec);
  let decided;
  try { decided = await decideModules({ ...options, engine, kit: kitDir }); } catch (e) { return { ok: false, code: 1, problems: [e.message] }; }
  const { modules, why, mods } = decided;
  // the spec's world and look must be ones its engine has (CONTRACT §8)
  if (engine === 'scenic' || engine === 'forge') {
    const T = spec.world?.template, L = spec.look?.preset;
    const bad = [];
    if (T && !mods.world.templates.includes(T)) bad.push(`world.template "${T}" is not a ${engine} world (${mods.world.templates.join(', ')})`);
    if (L && !(L in mods.look.presets)) bad.push(`look.preset "${L}" is not a ${engine} look (${Object.keys(mods.look.presets).join(', ')})`);
    // forge, wave 0 (CONTRACT §8 forge): first person only, rounds only (a voxel world is three.js's)
    if (engine === 'forge' && (spec.camera ?? 'first') !== 'first') bad.push(`camera "${spec.camera}" is not one the forge engine has yet (first)`);
    if (engine === 'forge' && spec.round?.mode === 'world') bad.push('round.mode world is not on the forge engine (the voxel world is three.js\'s)');
    if (bad.length) return { ok: false, code: 2, problems: bad.map(b => `spec ${b} (engine ${engine})`) };
  }
  // spec.forge, the forge data tables (CONTRACT §8 forge; research/gf-forge/kit/tables): a value the core can't do, a
  // field that does not exist or a wave naming a missing enemy is refused; what no system runs yet is a note
  const forgeNotes = [];
  if (spec.forge !== undefined && engine !== 'forge') return { ok: false, code: 2, problems: [`spec forge: the data tables are the forge engine's (engine is ${engine})`] };
  if (engine === 'forge') {
    const r = (await importPart(join(FORGE_KIT, 'tables/index.js'), 'the forge engine (research/gf-forge)')).check(spec.forge);
    if (r.problems.length) return { ok: false, code: 2, problems: r.problems.map(p => `spec ${p} (engine forge)`) };
    forgeNotes.push(...r.notes);
  }
  // the spec's mechanics in the modules that exist: their params checked against each module's schema, defaults filled
  const warnings = [], mechanicDefaults = {};
  for (const m of spec.mechanics) {
    const mod = mods.mechanics?.[m.id];
    if (!mod?.params) continue;
    for (const p of check(mod.params, m.params ?? {})) warnings.push(`mechanic ${m.id}: params ${p}`);
    mechanicDefaults[m.id] = withDefaults(mod.params, {});
  }
  // do the spec's mechanics compose? Each part's manifest says what it needs and what it owns; a set that cannot work
  // is refused here, with the cause and the way out, before anything is written. A mechanic whose module is not in
  // this game (a forge game, --standin-mechanics) is not judged.
  const parts = Object.entries(mods.mechanics ?? {}).map(([id, module]) => ({ id, module, manifest: module.manifest ?? null }));
  const worldPart = modules.world && spec.world?.template ? (await worldParts({ kit: kitDir }))[spec.world.template] ?? null : null;
  const refused = composeProblems(spec.mechanics, parts, { engine, world: worldPart?.provides ?? null, worldId: spec.world?.template ?? '' });
  if (refused.length) return { ok: false, code: 2, problems: refused.map(p => `spec ${p}`) };
  const lookMod = modules.look ? mods.look : null;
  const standinLook = await importKitModule(join(KIT, 'core/standins/look.js'));
  const lookPreset = lookMod ? (id, time) => { const v = lookMod.presetValues?.(id, time) ?? lookMod.presets?.[id]; return v ? JSON.parse(JSON.stringify(v)) : null; } : null;
  // the real look's config/look.json is its whole preset (lookConfig), id dropped: every value a look.* slot
  const lookConfig = lookMod?.lookConfig ? (id, time) => { const c = JSON.parse(JSON.stringify(lookMod.lookConfig(id, { time }))); delete c.id; return c; } : null;
  // the forge world reads no file itself: its library (the curated KayKit pieces and their licences) is passed in
  const forgeLib = engine === 'forge' ? await (await importPart(join(FORGE, 'tools/library.mjs'), 'the forge engine (research/gf-forge)')).forgeLibrary() : null;
  const worldConfig = engine === 'scenic' ? (s, o) => mods.world.worldConfig(s, o) : engine === 'forge' ? (s, o) => mods.world.worldConfig(s, { ...o, library: forgeLib }) : null;
  const C = await specToConfig(spec, { modules, lookPreset, lookConfig, standinPresetValues: standinLook.presetValues, mechanicDefaults, worldConfig });
  C.notes.push(...forgeNotes);

  const wrote = [], kept = [];
  const own = async (rel, buf) => {     // a file the game agent or Studio owns: kept when it exists, unless --force
    const p = join(dir, rel);
    if (existsSync(p) && !(rel === 'rules.js' ? newRules : force)) { const cur = await readFile(p); if (!cur.equals(Buffer.from(buf))) kept.push(rel); return; }
    await put(p, buf, wrote, rel);
  };
  const gen = (rel, buf) => put(join(dir, rel), buf, wrote, rel);   // generated: always the create output
  await mkdir(dir, { recursive: true });

  await gen('spec.json', specBytes);
  for (const n of ['game', 'look', 'world', 'characters']) await own(`config/${n}.json`, json(C[n]));
  if (C.props) await own('config/props.json', json(C.props));
  for (const a of C.assets) await own(a.to, await readFile(a.from));
  await own('multiplayer.json', json(C.multiplayer));
  await own('rules.js', rulesStub(spec, parts));
  await gen('index.html', indexHtml(spec.title, engine));
  await gen('main.js', mainJs(engine));

  // the kit and everything vendored
  const kit = await vendorKit(dir, modules); wrote.push(...kit.wrote);
  // `kitDir` (tests): vendoring is tools/lib/vendor.mjs's and copies this kit. A mechanic folder only the other kit
  // has is carried in beside it, so the game still runs; gf/three/kit.js does not list it (verify check 2 would say so).
  if (kitDir !== KIT) for (const id of modules.mechanics.filter(id => !existsSync(join(KIT, 'mechanics', id)))) {
    for (const rel of await walk(join(kitDir, 'mechanics', id))) { if (/(^|\/)(fixture|tests?)(\/|$)/.test(rel) || /\.md$/i.test(rel)) continue; await put(join(dir, 'gf/three/mechanics', id, rel), await readFile(join(kitDir, 'mechanics', id, rel)), wrote, `gf/three/mechanics/${id}/${rel}`); }
  }
  wrote.push(...(await vendorGfAssets(dir)).wrote);
  for (const f of AUDIO_FILES) await put(join(dir, 'audio', f), await readFile(join(GF_AUDIO, 'source', f)), wrote, `audio/${f}`);
  const ad = await adopt(dir, { log: () => {} });
  if (!ad.ok) return { ok: false, code: 1, problems: ad.problems };
  wrote.push(...ad.wrote);
  const rulesText = await readFile(join(dir, 'rules.js'), 'utf8').catch(() => '');
  const libs = await vendorLibraries(dir, [...kit.sourceTexts, rulesText], { engine }); wrote.push(...libs.wrote);

  // the build record, then assets.json from the declarations (keeping the sound list a game already has)
  const record = {
    kit: { name: 'gf-three', version: KIT_VERSION, engine, ...(engine === 'scenic' ? { scenic: SCENIC_VERSION } : {}), ...(engine === 'forge' ? { forge: FORGE_VERSION } : {}) }, game: slugOf(spec.title), spec: { file: 'spec.json', sha256: sha256(specBytes) },
    options, modules, named: C.named, props: C.propFiles, bodies: C.bodies, notes: C.notes, ...(C.worldArt ? { worldArt: C.worldArt } : {}),
  };
  await gen('gf-three.json', json(record));
  let sounds = C.sounds;
  if (existsSync(join(dir, 'assets.json')) && !force) { try { sounds = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8')).sounds ?? sounds; } catch {} }
  let A = await assembleManifest(dir, { sounds, modules });
  // a picture a module declares (the look's noise, a world texture) and the game lacks: from the library
  let filled = 0;
  for (const s of A.manifest.slots) {
    if (!['image', 'texture'].includes(s.type) || existsSync(join(dir, s.source.file))) continue;
    const pic = await libraryPicture(s);
    if (pic) { await own(s.source.file, await readFile(pic.from)); filled++; }
    else if (!s.optional) warnings.push(`slot ${s.id}: ${s.source.file} is missing and the library has no match`);
  }
  if (filled) A = await assembleManifest(dir, { sounds, modules });
  warnings.push(...A.warnings);
  await gen('assets.json', json(A.manifest));
  await gen('ATTRIBUTION.md', attribution(spec, record));
  return { ok: true, code: 0, dir, ms: Math.round(performance.now() - t0), wrote, kept, warnings, notes: C.notes, modules, why, slots: A.slotCount, main: A.mainCount };
}

const slugOf = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** main.js: the shared boot, or (forge, CONTRACT §8) the shared boot without three.js. */
export function mainJs(engine = 'party') {
  const boot = engine === 'forge' ? 'boot-forge.js' : 'boot.js';
  return `import { boot } from './gf/three/core/${boot}';\nimport rules from './rules.js';\nboot({ rules });\n`;
}

export function indexHtml(title, engine = 'party') {
  // forge (CONTRACT §8 forge): every import is relative (no three.js, no Rapier), so there is no import map
  if (engine === 'forge') return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(title)}</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;background:#07080a}</style>
<link rel="modulepreload" href="gf/forge/host.js">
<script type="module">import { startLoading } from './gf/three/ui/loading.js'; startLoading({ theme: 'grim' });</script>
<script type="module" src="main.js"></script>
</head>
<body></body>
</html>
`;
  // the scenic engine (CONTRACT §8): every module shares one three, the WebGPU build (WebGL2 fallback inside it)
  const map = engine === 'scenic'
    ? { imports: { three: './vendor/three/build/three.webgpu.js', 'three/webgpu': './vendor/three/build/three.webgpu.js', 'three/tsl': './vendor/three/build/three.tsl.js', 'three/addons/': './vendor/three/examples/jsm/', 'three/examples/jsm/': './vendor/three/examples/jsm/', '@dimforge/rapier3d-compat': './vendor/rapier/rapier.mjs' } }
    : { imports: { three: './vendor/three/build/three.module.js', 'three/addons/': './vendor/three/examples/jsm/', 'three/examples/jsm/': './vendor/three/examples/jsm/', '@dimforge/rapier3d-compat': './vendor/rapier/rapier.mjs', postprocessing: './vendor/postprocessing/postprocessing.module.js', n8ao: './vendor/n8ao/N8AO.js' } };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(title)}</title>
<link rel="icon" href="data:,">
<script type="importmap">
${JSON.stringify(map, null, 2)}
</script>
<script type="module" src="main.js"></script>
</head>
<body></body>
</html>
`;
}

const comment = (s, w = 110) => String(s ?? '').split(/\n/).flatMap(line => { const out = []; let cur = ''; for (const word of line.split(/\s+/)) { if ((cur + ' ' + word).trim().length > w) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim(); } out.push(cur); return out; }).map(l => `//   ${l}`.trimEnd()).join('\n');

/** A mechanic's block of setup(): what it is, its note, a worked line, its traps, then each callback it offers as an
 *  empty named handler (the manifest's `stub` and `events`). */
function stubBlock(part, as, spec) {
  const m = part.manifest, cap = x => x[0].toUpperCase() + x.slice(1), v = m.stub.as;
  const out = [`    // ---- ${part.id}${as ? ` — "${as}"` : ''}: ${m.describe}`];
  for (const n of m.note ?? []) out.push(`    //   ${n}`);
  if (m.state?.key) out.push(`    //   state: window.__game.snapshot().shared.${m.state.key} (what a test reads; the rules read it through ${v}'s own methods) → ${Object.entries(m.state.fields ?? {}).map(([k, d]) => `${k}: ${d}`).join('; ')}`);
  out.push(`    //   worked: ${m.stub.worked}`);
  for (const t of m.stub.traps ?? []) out.push(`    //   trap: ${t}`);
  if (!(m.events ?? []).length) { out.push(`    //   no callbacks: read it where the rules need it (const ${v} = ctx.mechanics.get('${part.id}');)`); return out.join('\n'); }
  out.push(`    const ${v} = ctx.mechanics.get('${part.id}');`);
  for (const e of m.events) out.push(`    ${v}?.${e.name}?.(function on${cap(part.id.replace(/-(.)/g, (_, c) => c.toUpperCase()))}${e.name.slice(2)}(e) {});   // ${e.on}: ${e.when ?? ''} · e = ${e.args}`);
  return out.join('\n');
}

/** rules.js for a new game: the spec's rules as comments, the six hooks, and in setup() the stub of each mechanic the
 *  spec uses (from its manifest). Nothing in it does anything yet: every handler is empty. */
export function rulesStub(spec, parts = []) {
  const mech = spec.mechanics.map(m => `//   ${m.id}${m.as ? ` — "${m.as}"` : ''} ${JSON.stringify(m.params ?? {})}`).join('\n');
  const controls = Object.entries(spec.controls ?? {}).map(([k, v]) => `//   ${k}: ${v}`).join('\n') || '//   (none named)';
  const byId = new Map(parts.filter(p => p.manifest?.stub && Array.isArray(p.manifest.events)).map(p => [p.id, p]));
  const seen = new Set(), blocks = [];
  for (const m of spec.mechanics) { if (seen.has(m.id) || !byId.has(m.id)) continue; seen.add(m.id); blocks.push(stubBlock(byId.get(m.id), m.as, spec)); }
  const setup = blocks.length
    ? `setup(ctx) {\n    // Each mechanic below offers these callbacks. Every handler is empty: write the ones this game needs and delete the\n    // rest. "host" handlers run on the host's copy only (it owns the shared world); never change scores elsewhere.\n${blocks.join('\n\n')}\n  },`
    : 'setup(ctx) {},';
  return `// rules.js: THE GAME AGENT'S FILE. ${spec.title}: what makes this game this game (research/gf-three/CONTRACT.md §3).
// Written by create.mjs as a stub from the spec; the kit already runs the home menu, the HUD, players, bots, the round and replay (CONTRACT §6g).
//
// Hook: ${spec.hook ?? ''}
// Rules:
${comment(spec.rules.summary)}
// Scoring: ${spec.rules.scoring ?? '(see the rules)'}
// Win: ${spec.round.winBy ?? 'most points when time runs out'}${spec.round.loseBy ? `\n// Lose: ${spec.round.loseBy}` : ''}
// Round: ${spec.round.mode === 'world' ? 'none (a world: players drop in and out)' : `${spec.round.seconds} s`} · players ${spec.players.min}–${spec.players.max}${spec.players.bots !== false ? ', bots fill empty seats' : ''}
// Tuning numbers (config/game.json → rules.params, each a rules.* slot): ${JSON.stringify(spec.rules.params ?? {})}
// Mechanics (ctx.mechanics.get(id); params in config/game.json → mechanics${blocks.length ? '; what each offers is in setup() below' : ''}):
${mech}
// Controls (ctx.me.actions.<name>.pressed / .down):
${controls}
// Not in v1: ${(spec.notInV1 ?? []).join('; ') || '—'}
// The creator will judge: ${(spec.accept ?? []).join('; ') || '—'}

export default {
  // Once on every copy, after the world, players and mechanics exist: register shared state, UI, listeners.
  ${setup}
  // Every copy, when the round starts (the same moment for everyone).
  roundStart(ctx) {},
  // Every frame on every copy. Keep host-only logic under \`if (ctx.host)\`.
  update(ctx, dt) {},
  // A gameplay event from another copy (ctx.net.send(name, data, to) on their side).
  event(ctx, name, data, from) {},
  // Host only: is the round over? null, or { winners: [playerId], reason }.
  check(ctx) { return null; },
  // Every copy, at round end: the rows of the results card.
  results(ctx) { return ctx.players.list().map(p => ({ id: p.id, name: p.name, value: p.score })); },
};
`;
}

export function attribution(spec, record) {
  const art = [];
  for (const [name, p] of Object.entries(record.props ?? {})) art.push(`| ${p.file} | prop "${name}" (${p.from}) | ${p.license?.spdx ?? 'see library/LICENSES.json'}${p.license?.author ? `, ${p.license.author}` : ''} |`);
  for (const [role, b] of Object.entries(record.bodies ?? {})) art.push(`| ${b.file} | body of "${role}" (${b.from}) | ${b.license?.spdx ?? 'see library/LICENSES.json'}${b.license?.author ? `, ${b.license.author}` : ''} |`);
  const scenic = record.kit?.engine === 'scenic', forge = record.kit?.engine === 'forge';
  if (forge) return forgeAttribution(spec, record, art);
  if (!scenic) art.push('| assets/textures/ground.ktx2 | ground (stand-in: Poly Haven leafy_grass, converted to KTX2) | CC0-1.0, Poly Haven |');
  for (const a of record.worldArt ?? []) art.push(`| ${a.file} | ${a.what} | ${a.license} |`);
  const libs = scenic
    ? ['| three.js 0.186.0 (WebGPU build, WebGL2 fallback) | vendor/three/ (three.webgpu.js, three.tsl.js, three.core.js and the addons the game imports, byte-identical to the npm tarball) | MIT |']
    : ['| three.js 0.186.0 | vendor/three/ (build and the addons the game imports, byte-identical to the npm tarball) | MIT |'];
  libs.push('| Draco decoder, Basis Universal transcoder (from three.js) | vendor/three/examples/jsm/libs/{draco,basis}/ | Apache-2.0 |', '| @dimforge/rapier3d-compat 0.19.2 | vendor/rapier/ | Apache-2.0 |');
  if (!scenic) libs.push('| pmndrs postprocessing 6.39.5 | vendor/postprocessing/ | Zlib |', '| N8AO | vendor/n8ao/ | MIT |');
  libs.push('| pmndrs/ecctrl (floating-capsule logic, ported) | gf/three/controller/capsule.mjs; LICENSE-ecctrl and NOTICE-ecctrl beside it | MIT |');
  if (scenic) libs.push('| folio-2025 by Bruno Simon (rendering, materials, lighting, terrain and vegetation, ported; brunosimon/folio-2025@41046b5) | gf/scenic/ (LICENSE-folio-2025 beside it) | MIT |');
  libs.push(`| gf-three${scenic ? `, gf-scenic ${record.kit.scenic}` : ''}, gf-multiplayer ${MP_KIT_VERSION}, gf-assets 1.3.0, gf-audio 1.5.0 (ZzFX, MIT) | gf/three/,${scenic ? ' gf/scenic/,' : ''} gf/mp/, gf/gf-assets.js, audio/ | games.fun |`);
  return `# ${spec.title}: credits

Made with gf-three ${KIT_VERSION}${scenic ? ` and the scenic engine gf-scenic ${record.kit.scenic} (research/gf-scenic)` : ''} (research/gf-three) by create.mjs from spec.json. Licences travel with the code: each library's licence sits beside its copy.

## Code

| What | Where | Licence |
|---|---|---|
${libs.join('\n')}

## Art

| File | What | Licence |
|---|---|---|
${art.join('\n')}

Sounds are gf-audio presets (synthesised, no files).
`;
}

/** A forge game's credits (CONTRACT §8 forge): the Rust core's crates (their licences in gf/forge/wasm/LICENSES.md),
 *  meshoptimizer's decoder, the shared kits, and the art. */
function forgeAttribution(spec, record, art) {
  const seen = new Set(art.map(r => r.split(' | ')[0]));
  for (const a of record.worldArt ?? []) if (!seen.has(`| ${a.file}`)) art.push(`| ${a.file} | ${a.what} | ${a.license} |`);
  return `# ${spec.title}: credits

Made with gf-three ${KIT_VERSION} and the forge engine gf-forge ${record.kit.forge} (research/gf-forge, research/rust-engine/PLAN.md) by create.mjs from spec.json. Licences travel with the code: each library's licence sits beside its copy.

## Code

| What | Where | Licence |
|---|---|---|
| the gf-forge core (Rust, compiled to gf/forge/wasm/forge_web_bg.wasm): wgpu, hecs, glam, gltf, bytemuck, wasm-bindgen and the crates they use | gf/forge/wasm/ (every crate, its version and licence, and the licence texts: gf/forge/wasm/LICENSES.md) | MIT, Apache-2.0, BSD, zlib |
| meshoptimizer's decoder (the copy three.js 0.186.0 ships) | gf/forge/vendor/meshopt_decoder.module.js (LICENSE-meshoptimizer beside it) | MIT |
| gf-three (the shared system, without three.js), gf-forge ${record.kit.forge}, gf-multiplayer ${MP_KIT_VERSION}, gf-assets 1.3.0, gf-audio 1.5.0 (ZzFX, MIT) | gf/three/, gf/forge/, gf/mp/, gf/gf-assets.js, audio/ | games.fun |

## Art

| File | What | Licence |
|---|---|---|
${art.join('\n')}

${art.some(r => r.startsWith('| assets/sounds/')) ? 'Sounds are the files above, played through gf-audio; an id the forge library has no file for is a gf-audio preset (synthesised).' : 'Sounds are gf-audio presets (synthesised, no files).'}
`;
}

if (isMain(import.meta)) {
  const a = process.argv.slice(2);
  const pos = a.filter(x => !x.startsWith('--'));
  if (pos.length < 2) { console.error('usage: create.mjs <spec.json> <out-dir> [--force] [--new-rules] [--standins] [--standin-mechanics] [--json]'); process.exit(2); }
  const r = await create(pos[0], pos[1], { force: a.includes('--force'), newRules: a.includes('--new-rules'), standins: a.includes('--standins') || null, standinMechanics: a.includes('--standin-mechanics') || null });
  process.exitCode = r.code;   // set, never process.exit(): a large --json must drain into a pipe first
  if (a.includes('--json')) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else if (!r.ok) { for (const p of r.problems) console.error(`problem: ${p}`); console.error('create: FAILED'); }
  else await report(r);
}
async function report(r) {
  for (const w of r.why) console.log(`module  ${w}`);
  for (const n of r.notes) console.log(`note    ${n}`);
  for (const w of r.warnings) console.log(`warning ${w}`);
  // the set-dressing lint as notes (verify check 11 fails on its errors; the build agent fixes them in config/world.json);
  // a voxel world (CONTRACT §9) has no prop layout: its own lint is verify's world lint (tools/lib/worlds-check.mjs)
  const worldJson = JSON.parse(await readFile(join(r.dir, 'config/world.json'), 'utf8').catch(() => '{}'));
  const voxel = worldJson.template === 'voxel';
  // a forge world (CONTRACT §8 forge): the forge world lint (gf/forge/arena.js lintWorld, track A), checks 11 and 17's
  if (/^forge-/.test(worldJson.kind ?? '')) try {
    const { lintWorld } = await import(pathToFileURL(join(r.dir, 'gf/forge/arena.js')).href);
    const game = JSON.parse(await readFile(join(r.dir, 'config/game.json'), 'utf8'));
    const en = game.forge?.enemies ?? [];
    const l = lintWorld(worldJson, { players: game.players?.max ?? 4, enemies: en.length > 0 && (game.forge?.waves ?? []).length > 0, casters: en.some(e => e.archetype === 'caster') });
    console.log(`dressing ${l.errors} errors, ${l.warnings} warnings (forge world lint, gf/forge/arena.js: verify checks 11 and 17)`);
    for (const p of l.problems) console.log(`dressing ${p.severity === 'error' ? 'ERROR' : 'warn '} ${p.check}/${p.rule}: ${p.message} → ${p.fix}`);
  } catch (e) { console.log(`dressing the forge world lint did not run: ${e.message}`); }
  else if (voxel) {
    const { lintWorld } = await import('./lib/worlds-check.mjs');
    const l = await lintWorld(r.dir, { kitDir: join(r.dir, 'gf/three') }).catch(e => ({ ok: false, errors: [e.message], notes: [] }));
    console.log(`world   ${l.ok ? 'lint clean' : `${l.errors.length} errors`}${l.notes.length ? `: ${l.notes.join('; ')}` : ''}`);
    for (const e of l.errors) console.log(`world   ERROR ${e}`);
  } else try {
    const { loadSubject, lintDressing, lines } = await import('./lib/dressing.mjs');
    const dr = lintDressing(await loadSubject(r.dir));
    console.log(`dressing ${dr.errors} errors, ${dr.warnings} warnings (node research/gf-three/tools/dressing.mjs <game>)`);
    for (const l of lines(dr)) console.log(`dressing ${l}`);
  } catch (e) { console.log(`dressing lint did not run: ${e.message}`); }
  for (const k of r.kept) console.log(`kept    ${k} (yours; ${k === 'rules.js' ? '--new-rules' : '--force'} replaces it)`);
  console.log(`create: OK ${relative(process.cwd(), r.dir) || '.'} in ${(r.ms / 1000).toFixed(1)} s · ${r.wrote.length} files written, ${r.kept.length} kept · ${r.slots} slots (${r.main} main)`);
}
