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
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, KIT, LIBRARY, KIT_VERSION, SPEC_SCHEMA, GF_AUDIO, json, sha256 } from './lib/paths.mjs';
import { check, withDefaults } from './lib/schema.mjs';
import { put, vendorLibraries, vendorKit, vendorGfAssets, kitModuleFiles } from './lib/vendor.mjs';
import { importKitModule } from './lib/kit-import.mjs';
import { specToConfig, libraryPicture } from './lib/spec-config.mjs';
import { assembleManifest } from './lib/slots-lib.mjs';
import { adopt } from '../../multiplayer/party/adopt.mjs';
import { KIT_VERSION as MP_KIT_VERSION } from '../../multiplayer/party/manifest.mjs';

export const AUDIO_FILES = ['audio.js', 'zzfx.mjs', 'sounds.mjs', 'meter.mjs', 'presets.json', 'code-sounds.js', 'LICENSE-zzfx', 'ATTRIBUTION.md', 'VERSION'];

/** Which real modules to use: present in the kit source AND importable with the contract's exports. */
export async function decideModules({ standins = false, standinMechanics = false } = {}) {
  const found = await kitModuleFiles(), out = { look: false, world: false, character: false, mechanics: [] }, why = [];
  if (standins) return { modules: out, why: ['--standins: every module is a stand-in'], mods: {} };
  const mods = {};
  const tryMod = async (key, rel, names) => {
    if (!found[key]) { why.push(`${key}: not in the kit yet (stand-in)`); return; }
    const m = await importKitModule(join(KIT, rel));
    const missing = names.filter(n => !(n in m));
    if (m.error || missing.length) { why.push(`${key}: ${rel} ${m.error ? `does not import (${m.error.message.split('\n')[0]})` : `lacks ${missing.join(', ')}`} (stand-in)`); return; }
    out[key] = true; mods[key] = m; why.push(`${key}: the real module`);
  };
  await tryMod('look', 'look/look.js', ['createRenderer', 'applyLook']);
  await tryMod('world', 'world/world.js', ['loadWorld']);
  await tryMod('character', 'character/character.js', ['spawnCharacter']);
  // the real character plays the shared clips on gf-humanoid-1 bodies: without both in the library it can't run
  if (out.character && !(existsSync(join(LIBRARY, 'clips/gf-humanoid-1.glb')) && existsSync(join(LIBRARY, 'bodies')))) { out.character = false; why.push('character: library/clips/gf-humanoid-1.glb or library/bodies/ missing (stand-in)'); }
  mods.mechanics = {};
  if (standinMechanics) { why.push('mechanics: left out (--standin-mechanics: the rules do their part)'); return { modules: out, why, mods }; }
  for (const id of found.mechanics) {
    const m = await importKitModule(join(KIT, `mechanics/${id}/index.js`));
    if (m.error || typeof m.create !== 'function' || m.id !== id) { why.push(`mechanic ${id}: ${m.error ? 'does not import' : 'lacks id/create'} (its params stay in config)`); continue; }
    out.mechanics.push(id); mods.mechanics[id] = m;
  }
  return { modules: out, why, mods };
}

export async function create(specPath, outDir, { force = false, newRules = false, standins = null, standinMechanics = null, log = () => {} } = {}) {
  const t0 = performance.now();
  const dir = resolve(outDir);
  // a re-run makes the choices the first run made, unless told otherwise
  const prev = JSON.parse(await readFile(join(dir, 'gf-three.json'), 'utf8').catch(() => '{}')).options ?? {};
  const options = { standins: standins ?? prev.standins ?? false, standinMechanics: standinMechanics ?? prev.standinMechanics ?? false };
  const specBytes = await readFile(resolve(specPath));
  let spec;
  try { spec = JSON.parse(specBytes.toString('utf8')); } catch (e) { return { ok: false, code: 2, problems: [`spec is not JSON: ${e.message}`] }; }
  const schema = JSON.parse(await readFile(SPEC_SCHEMA, 'utf8'));
  const problems = check(schema, spec);
  if (problems.length) return { ok: false, code: 2, problems: problems.map(p => `spec ${p}`) };

  const { modules, why, mods } = await decideModules(options);
  // the spec's mechanics in the modules that exist: their params checked against each module's schema, defaults filled
  const warnings = [], mechanicDefaults = {};
  for (const m of spec.mechanics) {
    const mod = mods.mechanics?.[m.id];
    if (!mod?.params) continue;
    for (const p of check(mod.params, m.params ?? {})) warnings.push(`mechanic ${m.id}: params ${p}`);
    mechanicDefaults[m.id] = withDefaults(mod.params, {});
  }
  const lookMod = modules.look ? mods.look : null;
  const standinLook = await importKitModule(join(KIT, 'core/standins/look.js'));
  const lookPreset = lookMod ? (id, time) => { const v = lookMod.presetValues?.(id, time) ?? lookMod.presets?.[id]; return v ? JSON.parse(JSON.stringify(v)) : null; } : null;
  // the real look's config/look.json is its whole preset (lookConfig), id dropped: every value a look.* slot
  const lookConfig = lookMod?.lookConfig ? (id, time) => { const c = JSON.parse(JSON.stringify(lookMod.lookConfig(id, { time }))); delete c.id; return c; } : null;
  const C = await specToConfig(spec, { modules, lookPreset, lookConfig, standinPresetValues: standinLook.presetValues, mechanicDefaults });

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
  await own('rules.js', rulesStub(spec));
  await gen('index.html', indexHtml(spec.title));
  await gen('main.js', "import { boot } from './gf/three/core/boot.js';\nimport rules from './rules.js';\nboot({ rules });\n");

  // the kit and everything vendored
  const kit = await vendorKit(dir, modules); wrote.push(...kit.wrote);
  wrote.push(...(await vendorGfAssets(dir)).wrote);
  for (const f of AUDIO_FILES) await put(join(dir, 'audio', f), await readFile(join(GF_AUDIO, 'source', f)), wrote, `audio/${f}`);
  const ad = await adopt(dir, { log: () => {} });
  if (!ad.ok) return { ok: false, code: 1, problems: ad.problems };
  wrote.push(...ad.wrote);
  const rulesText = await readFile(join(dir, 'rules.js'), 'utf8').catch(() => '');
  const libs = await vendorLibraries(dir, [...kit.sourceTexts, rulesText]); wrote.push(...libs.wrote);

  // the build record, then assets.json from the declarations (keeping the sound list a game already has)
  const record = {
    kit: { name: 'gf-three', version: KIT_VERSION }, game: slugOf(spec.title), spec: { file: 'spec.json', sha256: sha256(specBytes) },
    options, modules, named: C.named, props: C.propFiles, bodies: C.bodies, notes: C.notes,
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

export function indexHtml(title) {
  const map = { imports: { three: './vendor/three/build/three.module.js', 'three/addons/': './vendor/three/examples/jsm/', 'three/examples/jsm/': './vendor/three/examples/jsm/', '@dimforge/rapier3d-compat': './vendor/rapier/rapier.mjs', postprocessing: './vendor/postprocessing/postprocessing.module.js', n8ao: './vendor/n8ao/N8AO.js' } };
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

function rulesStub(spec) {
  const mech = spec.mechanics.map(m => `//   ${m.id}${m.as ? ` — "${m.as}"` : ''} ${JSON.stringify(m.params ?? {})}`).join('\n');
  const controls = Object.entries(spec.controls ?? {}).map(([k, v]) => `//   ${k}: ${v}`).join('\n') || '//   (none named)';
  return `// rules.js: THE GAME AGENT'S FILE. ${spec.title}: what makes this game this game (research/gf-three/CONTRACT.md §3).
// Written by create.mjs as a stub from the spec; the kit already runs the lobby, players, bots, the round and replay.
//
// Hook: ${spec.hook ?? ''}
// Rules:
${comment(spec.rules.summary)}
// Scoring: ${spec.rules.scoring ?? '(see the rules)'}
// Win: ${spec.round.winBy ?? 'most points when time runs out'}${spec.round.loseBy ? `\n// Lose: ${spec.round.loseBy}` : ''}
// Round: ${spec.round.seconds} s · players ${spec.players.min}–${spec.players.max}${spec.players.bots !== false ? ', bots fill empty seats' : ''}
// Tuning numbers (config/game.json → rules.params, each a rules.* slot): ${JSON.stringify(spec.rules.params ?? {})}
// Mechanics (ctx.mechanics.get(id); params in config/game.json → mechanics):
${mech}
// Controls (ctx.me.actions.<name>.pressed / .down):
${controls}
// Not in v1: ${(spec.notInV1 ?? []).join('; ') || '—'}
// The creator will judge: ${(spec.accept ?? []).join('; ') || '—'}

export default {
  // Once on every copy, after the world, players and mechanics exist: register shared state, UI, listeners.
  setup(ctx) {},
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
  art.push('| assets/textures/ground.ktx2 | ground (stand-in: Poly Haven leafy_grass, converted to KTX2) | CC0-1.0, Poly Haven |');
  return `# ${spec.title}: credits

Made with gf-three ${KIT_VERSION} (research/gf-three) by create.mjs from spec.json. Licences travel with the code: each library's licence sits beside its copy.

## Code

| What | Where | Licence |
|---|---|---|
| three.js 0.186.0 | vendor/three/ (build and the addons the game imports, byte-identical to the npm tarball) | MIT |
| Draco decoder, Basis Universal transcoder (from three.js) | vendor/three/examples/jsm/libs/{draco,basis}/ | Apache-2.0 |
| @dimforge/rapier3d-compat 0.19.2 | vendor/rapier/ | Apache-2.0 |
| pmndrs postprocessing 6.39.5 | vendor/postprocessing/ | Zlib |
| N8AO | vendor/n8ao/ | MIT |
| pmndrs/ecctrl (floating-capsule logic, ported) | gf/three/controller/capsule.mjs; LICENSE-ecctrl and NOTICE-ecctrl beside it | MIT |
| gf-three, gf-multiplayer ${MP_KIT_VERSION}, gf-assets 1.3.0, gf-audio 1.5.0 (ZzFX, MIT) | gf/three/, gf/mp/, gf/gf-assets.js, audio/ | games.fun |

## Art

| File | What | Licence |
|---|---|---|
${art.join('\n')}

Sounds are gf-audio presets (synthesised, no files).
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
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
  // the set-dressing lint as notes (verify check 11 fails on its errors; the build agent fixes them in config/world.json)
  try {
    const { loadSubject, lintDressing, lines } = await import('./lib/dressing.mjs');
    const dr = lintDressing(await loadSubject(r.dir));
    console.log(`dressing ${dr.errors} errors, ${dr.warnings} warnings (node research/gf-three/tools/dressing.mjs <game>)`);
    for (const l of lines(dr)) console.log(`dressing ${l}`);
  } catch (e) { console.log(`dressing lint did not run: ${e.message}`); }
  for (const k of r.kept) console.log(`kept    ${k} (yours; ${k === 'rules.js' ? '--new-rules' : '--force'} replaces it)`);
  console.log(`create: OK ${relative(process.cwd(), r.dir) || '.'} in ${(r.ms / 1000).toFixed(1)} s · ${r.wrote.length} files written, ${r.kept.length} kept · ${r.slots} slots (${r.main} main)`);
}
