#!/usr/bin/env node
// gf-three upgrade: bring an existing gf-three game onto the current kit. This is how kit fixes (fair play, aim at the
// crosshair, interact that works) reach games that were already delivered.
//
//   node research/gf-three/tools/upgrade.mjs <game> [--out <dir>] [--world] [--json]
//   node research/gf-three/tools/upgrade.mjs <game> --plan [--json]
//
//   --plan       change nothing; say whether the game is behind the current kit and whether --world is for it
//                (upgradePlan). The Studio worker asks this before a change job's agent starts, then upgrades.
//   --out <dir>  upgrade a copy (the game folder is copied there first, without evidence/; the original is not touched)
//   --world      also re-lay the world from the current template (config/world.json and config/props.json from the
//                game's spec, as create would write them today; the old files are kept in evidence/upgrade-N/, which
//                assets.json ignores and nothing ever edits).
//                Only for a game whose world is the stock template: the set-dressing fixes live in the templates.
//                The world is generated at the spec's size class (kit/world/generate.js); the game's own props the
//                old layout placed (its config/game.json props, e.g. a token on a pedestal) are carried over, at the
//                same offset from the zone they stood nearest.
//
// What it does (and nothing else):
//   - refreshes the vendored copies verify check 2 compares: gf/three (the kit and its kit.js hashes), gf/mp
//     (gf-multiplayer via adopt), gf/gf-assets.js, audio/ (gf-audio), vendor/ (three addons the kit now imports);
//     index.html and main.js are regenerated (they are create's, never the agent's);
//   - keeps rules.js, multiplayer.json, assets/ and every config/*.json value the game set; a live multiplayer.json gets
//     the kit's own keys it lacks (gf-multiplayer 1.4.0: live.backdrop "gf-backdrop=1" and live.hud "game"), as create
//     writes them;
//   - adds what the current kit expects and the game lacks: new config blocks and keys (e.g. `fair`, `ui.crosshair`)
//     and new mechanic params, with the kit's defaults; arrays (layouts, props, mechanics lists) are never merged;
//   - holds waves to the hits rule create applies (tools/lib/spec-config.mjs enemyToughness): when the game's weapon
//     kills a wave-1 enemy in one hit, its hp goes up to three hits' worth, unless waves `oneHitKills` (Hang Up On Them
//     shipped projectile damage 2 against waves hp 2);
//   - refreshes a library bean body the game never replaced (the file is still tools/bean.mjs's bean of the id its
//     record names) to the current one (e.g. its hurt face, RIG.md §3); any other body file is kept;
//   - regenerates assets.json from the slot declarations (the sound list is kept);
//   - records the upgrade in gf-three.json (`upgrades`), and prints what changed.
// Exit 0 ok, 1 failed, 2 bad usage.
import { isMain } from './lib/main.mjs';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, KIT, KIT_VERSION, SPEC_SCHEMA, GF_AUDIO, LIBRARY, FORGE, FORGE_KIT, FORGE_VERSION, importPart, json, walk, sha256 } from './lib/paths.mjs';
import { put, vendorLibraries, vendorKit, vendorGfAssets, kitFiles, forgeFiles } from './lib/vendor.mjs';
import { importKitModule } from './lib/kit-import.mjs';
import { specToConfig, libraryPicture, specParams, enemyToughness, FORGE_GATE_QUERY } from './lib/spec-config.mjs';
import { assembleManifest } from './lib/slots-lib.mjs';
import { withDefaults, check } from './lib/schema.mjs';
import { loadWorldSubject, checkWorld } from './lib/world-check.mjs';
import { decideModules, AUDIO_FILES, indexHtml, mainJs, attribution, forgeModules } from './create.mjs';
import { adopt } from '../../multiplayer/party/adopt.mjs';
import { checkKitReleased } from '../../multiplayer/party/manifest.mjs';

/** The gf_body node's extras of a GLB (its JSON chunk), or null. */
function glbBodyExtras(buf) {
  try {
    if (buf.readUInt32LE(0) !== 0x46546c67) return null;
    const j = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    return j.nodes?.find(n => n.name === 'gf_body')?.extras ?? null;
  } catch { return null; }
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));

/**
 * Add to `cur` every key of `def` it lacks (deep through plain objects; arrays and values the game set are kept).
 * skip: JSON pointers left alone. → the pointers added.
 */
export function fillMissing(cur, def, { path = '', skip = new Set(), deep = true, added = [] } = {}) {
  if (!isObj(cur) || !isObj(def)) return added;
  for (const [k, v] of Object.entries(def)) {
    const p = `${path}/${k}`;
    if (skip.has(p)) continue;
    if (!(k in cur)) { cur[k] = clone(v); added.push(p); continue; }
    if (deep && isObj(cur[k]) && isObj(v)) fillMissing(cur[k], v, { path: p, skip, deep, added });
  }
  return added;
}

// game.json blocks that belong to the game (the agent's or the creator's words and rules): never filled from defaults
const GAME_SKIP = new Set(['/controls', '/rules', '/props', '/mechanics']);

export async function upgrade(gameDir, { out = null, world = false, log = () => {} } = {}) {
  const t0 = performance.now();
  const src = resolve(gameDir);
  if (!existsSync(join(src, 'gf-three.json')) || !existsSync(join(src, 'config/game.json'))) return { ok: false, code: 2, problems: [`${src} is not a gf-three game (no gf-three.json or config/game.json)`] };
  const dir = out ? resolve(out) : src;
  if (out) {
    if (existsSync(dir) && (await walk(dir)).length) return { ok: false, code: 2, problems: [`--out ${dir} exists and is not empty`] };
    await mkdir(dir, { recursive: true });
    await cp(src, dir, { recursive: true, filter: f => !/[\\/](evidence|node_modules|\.git)([\\/]|$)/.test(relative(src, f) ? `/${relative(src, f)}` : '') });
  }
  const readJson = async rel => JSON.parse(await readFile(join(dir, rel), 'utf8'));
  const record = await readJson('gf-three.json');
  // a forge game (CONTRACT §8 forge): its own way (upgradeForge: gf/forge and its pinned wasm, the forge configs)
  if (record.kit?.engine === 'forge') return upgradeForge(dir, { src, out, record, t0 });
  const before = { kit: await kitHashes(dir), slots: await slotIds(dir), files: new Set(await walk(dir)) };
  const changes = { kit: [], vendor: [], config: [], bodies: [], slots: { added: [], removed: [] }, world: null, notes: [] };

  // ---- the spec and the modules (as create would decide them today, with the game's own options) ----
  const specBytes = await readFile(join(dir, 'spec.json')).catch(() => null);
  const spec = specBytes ? JSON.parse(specBytes.toString('utf8')) : null;
  if (spec) { const probs = check(JSON.parse(await readFile(SPEC_SCHEMA, 'utf8')), spec); if (probs.length) changes.notes.push(`spec.json no longer validates against the current schema (${probs.slice(0, 2).join('; ')}); config defaults come from the kit modules only`); }
  const options = record.options ?? {};
  const { modules, mods } = await decideModules({ standins: !!options.standins, standinMechanics: !!options.standinMechanics });

  // ---- configs: add what the current kit expects ----
  const mechanicDefaults = {};
  for (const [id, m] of Object.entries(mods.mechanics ?? {})) if (m.params) mechanicDefaults[id] = withDefaults(m.params, {});
  let fresh = null;
  if (spec && !changes.notes.length) {
    const lookMod = modules.look ? mods.look : null;
    const standinLook = await importKitModule(join(KIT, 'core/standins/look.js'));
    const lookPreset = lookMod ? (id, time) => { const v = lookMod.presetValues?.(id, time) ?? lookMod.presets?.[id]; return v ? clone(v) : null; } : null;
    const lookConfig = lookMod?.lookConfig ? (id, time) => { const c = clone(lookMod.lookConfig(id, { time })); delete c.id; return c; } : null;
    fresh = await specToConfig(spec, { modules, lookPreset, lookConfig, standinPresetValues: standinLook.presetValues, mechanicDefaults });
  }
  const game = await readJson('config/game.json');
  if (fresh) changes.config.push(...fillMissing(game, fresh.game, { skip: GAME_SKIP }).map(p => `config/game.json${p}`));
  for (const [i, m] of (game.mechanics ?? []).entries()) {
    let d = mechanicDefaults[m.id]; if (!d) continue;
    m.params ??= {};
    d = { ...d, ...specParams(spec, m) };            // e.g. a pee stream from the hips
    changes.config.push(...fillMissing(m.params, d, { deep: false }).map(p => `config/game.json/mechanics/${i}/params${p}`));
  }
  // the hits rule create applies: a basic enemy takes 2–4 hits from the game's weapon (verify check 16), never one
  const tough = enemyToughness(game.mechanics ?? []);
  if (tough) { changes.config.push(`config/game.json/mechanics/${game.mechanics.findIndex(m => m.id === 'waves')}/params/hp`); changes.notes.push(tough); }
  await writeConfig(dir, 'config/game.json', game);
  // the kit draws the screen's real pixels within a budget since 2026-10-09 (kit/core/resolution.js): a look's fixed
  // quality.<tier>.pixelRatio (1 on the low tier: a third of a phone's resolution) is no longer read, so it leaves the
  // game's look and its Studio slot
  const lookNow = await readJson('config/look.json').catch(() => null);
  if (lookNow?.quality && typeof lookNow.quality === 'object') {
    const gone = Object.entries(lookNow.quality).filter(([, q]) => q && typeof q === 'object' && 'pixelRatio' in q).map(([t, q]) => { delete q.pixelRatio; return `config/look.json/quality/${t}/pixelRatio (removed: the kit sizes the canvas to the screen)`; });
    if (gone.length) { changes.config.push(...gone); await writeConfig(dir, 'config/look.json', lookNow); }
  }
  if (fresh) {
    for (const [name, deep] of [['look', true], ['characters', true], ['world', false]]) {
      const cur = await readJson(`config/${name}.json`).catch(() => null);
      if (!cur || !fresh[name]) continue;
      const added = fillMissing(cur, fresh[name], { deep });
      if (added.length) { changes.config.push(...added.map(p => `config/${name}.json${p}`)); await writeConfig(dir, `config/${name}.json`, cur); }
    }
  }

  // ---- --world: the current template's layout (the set-dressing fixes live there) ----
  if (world) {
    if (!fresh) return { ok: false, code: 1, problems: ['--world needs a valid spec.json'] };
    const w = { replaced: [], copied: [], kept: null, carried: [] };
    // the game's own placed props (the build agent stood the token on its pedestal in the middle): carried into the new
    // layout, at the same offset from the zone they stood nearest (that zone in the new world, else its centre)
    const oldWorld = await readJson('config/world.json').catch(() => null), oldCatalog = await readJson('config/props.json').catch(() => null);
    const own = new Set((game.props ?? []).map(p => p.name));
    if (oldWorld && fresh.world) for (const p of oldWorld.props ?? []) {
      if (!own.has(p.prop) || fresh.world.props.some(q => q.prop === p.prop)) continue;
      let near = null, nd = Infinity;
      for (const [n, z] of Object.entries(oldWorld.zones ?? {})) { const d = Math.hypot(z.at[0] - p.at[0], z.at[2] - p.at[2]); if (d < nd) { nd = d; near = n; } }
      const oz = oldWorld.zones?.[near], nz = fresh.world.zones?.[near] ?? fresh.world.zones?.centre;
      const at = oz && nz ? [+(nz.at[0] + p.at[0] - oz.at[0]).toFixed(2), p.at[1] ?? 0, +(nz.at[2] + p.at[2] - oz.at[2]).toFixed(2)] : p.at;
      fresh.world.props.push({ ...p, at });
      w.carried.push(`${p.prop} (near ${near ?? 'nothing'})`);
      const e = oldCatalog?.props?.find(q => q.id === p.prop);
      if (e && fresh.props && !fresh.props.props.some(q => q.id === p.prop)) fresh.props.props.push(e);
    }
    // catalog entries the game uses outside its layout stay: its own props and every mechanic's `prop` (the pickup's
    // coffee mug came from the old office template, and without its entry the pickups would draw the stand-in gem)
    const used = new Set([...own, ...(game.mechanics ?? []).map(m => m.params?.prop).filter(x => typeof x === 'string' && x)]);
    if (fresh.props && oldCatalog) for (const e of oldCatalog.props ?? []) if (used.has(e.id) && !fresh.props.props.some(q => q.id === e.id)) { fresh.props.props.push(e); w.carried.push(`${e.id} (catalog)`); }
    let keep = null;      // evidence/upgrade-N/: the files the new layout replaced (a record; never served as a slot)
    for (const [name, value] of [['world', fresh.world], ['props', fresh.props]]) {
      if (!value) continue;
      const rel = `config/${name}.json`, cur = await readFile(join(dir, rel)).catch(() => null), next = json(value);
      if (cur && cur.toString('utf8') === next) continue;
      if (cur) {
        if (!keep) { const taken = new Set(await readdir(join(dir, 'evidence')).catch(() => [])); let n = 1; while (taken.has(`upgrade-${n}`)) n++; keep = `evidence/upgrade-${n}`; await mkdir(join(dir, keep), { recursive: true }); w.kept = keep; }
        await writeFile(join(dir, keep, `${name}.json`), cur);
      }
      await writeFile(join(dir, rel), next); w.replaced.push(rel);
    }
    // every model the new layout uses that the game lacks (a file the game has is kept: it may be a swapped model)
    for (const a of fresh.assets) if (a.to.startsWith('assets/models/') && !existsSync(join(dir, a.to))) { await put(join(dir, a.to), await readFile(a.from)); w.copied.push(a.to); }
    for (const [n, p] of Object.entries(fresh.propFiles ?? {})) if (!record.props?.[n]) (record.props ??= {})[n] = p;
    for (const [n, id] of Object.entries(fresh.named ?? {})) if (!record.named?.[n]) (record.named ??= {})[n] = id;
    changes.world = w;
    changes.config = changes.config.filter(p => !w.replaced.some(r => p.startsWith(`${r}/`)));   // keys filled into a file since replaced

  }

  // ---- library beans the game never replaced come back as the current bean (a swapped body is another file: kept) ----
  for (const b of Object.values(record.bodies ?? {})) {
    const id = /^library:(.+)$/.exec(b?.from ?? '')?.[1], src = id && join(LIBRARY, 'bodies', `${id}.glb`);
    if (!src || !b.file || !existsSync(src)) continue;
    const cur = await readFile(join(dir, b.file)).catch(() => null), ex = cur && glbBodyExtras(cur);
    if (ex?.gfGenerator !== 'research/gf-three/tools/bean.mjs' || ex.gfBody !== id) continue;
    const next = await readFile(src);
    if (!cur.equals(next)) { await writeFile(join(dir, b.file), next); changes.bodies.push(b.file); }
  }

  // ---- the kit and everything vendored (what verify check 2 compares) ----
  const kit = await vendorKit(dir, modules); changes.kit.push(...kit.wrote);
  changes.vendor.push(...(await vendorGfAssets(dir)).wrote);
  for (const f of AUDIO_FILES) await put(join(dir, 'audio', f), await readFile(join(GF_AUDIO, 'source', f)), changes.vendor, `audio/${f}`);
  // the multiplayer kit's own keys a live game lacks (gf-multiplayer 1.4.0): the world behind the waiting room, and the
  // game's own HUD and room menu in a round. Values the game set are kept.
  try {
    const mp = await readJson('multiplayer.json');
    if (mp?.mode === 'live' && isObj(mp.live)) {
      const add = [];
      if (mp.live.backdrop === undefined) { mp.live.backdrop = 'gf-backdrop=1'; add.push('backdrop'); }
      if (mp.live.hud === undefined) { mp.live.hud = 'game'; add.push('hud'); }
      if (typeof mp.live.shares === 'string' && /, the bots(?= and)/.test(mp.live.shares)) { mp.live.shares = mp.live.shares.replace(/, the bots(?= and)/, ''); add.push('shares'); }
      if (add.length) { await writeFile(join(dir, 'multiplayer.json'), json(mp)); changes.config.push(...add.map(k => `multiplayer.json/live/${k}`)); }
    }
  } catch {}
  const ad = await adopt(dir, { log: () => {} });
  if (!ad.ok) return { ok: false, code: 1, problems: ad.problems };
  changes.vendor.push(...ad.wrote);
  const rulesText = await readFile(join(dir, 'rules.js'), 'utf8').catch(() => '');
  changes.vendor.push(...(await vendorLibraries(dir, [...kit.sourceTexts, rulesText])).wrote);
  if (spec) {
    await put(join(dir, 'index.html'), indexHtml(spec.title), changes.vendor, 'index.html');
    await put(join(dir, 'main.js'), "import { boot } from './gf/three/core/boot.js';\nimport rules from './rules.js';\nboot({ rules });\n", changes.vendor, 'main.js');
  }

  // ---- the build record and assets.json ----
  const oldRecord = clone(record);
  record.kit = { name: 'gf-three', version: KIT_VERSION };
  record.modules = modules;
  if (changes.world && spec) {
    // the credits follow the new layout: rewritten when they are still create's, else the new art is appended
    const cur = await readFile(join(dir, 'ATTRIBUTION.md'), 'utf8').catch(() => null);
    if (cur === null || cur === attribution(spec, oldRecord)) await writeFile(join(dir, 'ATTRIBUTION.md'), attribution(spec, record));
    else {
      const add = Object.entries(record.props ?? {}).filter(([n]) => !oldRecord.props?.[n]).map(([n, p]) => `| ${p.file} | prop "${n}" (${p.from}) | ${p.license?.spdx ?? 'see library/LICENSES.json'}${p.license?.author ? `, ${p.license.author}` : ''} |`);
      if (add.length) await writeFile(join(dir, 'ATTRIBUTION.md'), `${cur.trimEnd()}\n\n## Art added by tools/upgrade.mjs --world (${new Date().toISOString().slice(0, 10)})\n\n| File | What | Licence |\n|---|---|---|\n${add.join('\n')}\n`);
    }
  }
  let sounds = null;
  try { sounds = (await readJson('assets.json')).sounds ?? null; } catch {}
  // a kit sound a mechanic plays now that the game's list lacks (waves' enemy-down, CONTRACT §6f): added, the rest kept
  for (const id of ['enemy-down']) { const s = fresh?.sounds?.sounds?.[id]; if (s && sounds?.sounds && !sounds.sounds[id]) { sounds.sounds[id] = s; changes.notes.push(`sound ${id}: added (${s.label})`); } }
  let A = await assembleManifest(dir, { sounds, modules });
  let filled = 0;
  for (const s of A.manifest.slots) {
    if (!['image', 'texture'].includes(s.type) || existsSync(join(dir, s.source.file))) continue;
    const pic = await libraryPicture(s);
    if (pic) { await put(join(dir, s.source.file), await readFile(pic.from)); filled++; changes.notes.push(`${s.source.file}: from the library (${relative(KIT, pic.from)})`); }
    else if (!s.optional) changes.notes.push(`slot ${s.id}: ${s.source.file} is missing and the library has no match`);
  }
  if (filled) A = await assembleManifest(dir, { sounds, modules });
  await put(join(dir, 'assets.json'), json(A.manifest), changes.vendor, 'assets.json');
  const afterSlots = new Set(A.manifest.slots.map(s => s.id));
  changes.slots.added = [...afterSlots].filter(id => !before.slots.has(id));
  changes.slots.removed = [...before.slots].filter(id => !afterSlots.has(id));
  const after = await kitHashes(dir);
  const kitDiff = { added: [...after.keys()].filter(k => !before.kit.has(k)), removed: [...before.kit.keys()].filter(k => !after.has(k)), changed: [...after.keys()].filter(k => before.kit.has(k) && before.kit.get(k) !== after.get(k)) };
  const entry = { at: new Date().toISOString(), kit: KIT_VERSION, from: out ? relative(dirname(dir), src) : null, kitFiles: { added: kitDiff.added.length, changed: kitDiff.changed.length, removed: kitDiff.removed.length }, config: changes.config, bodies: changes.bodies.length ? changes.bodies : undefined, world: changes.world ? changes.world.replaced : undefined };
  record.upgrades = [...(record.upgrades ?? []), entry];
  await writeFile(join(dir, 'gf-three.json'), json(record));
  return { ok: true, code: 0, dir, src, ms: Math.round(performance.now() - t0), modules, kit: kitDiff, vendor: changes.vendor.filter(f => !f.startsWith('gf/three/')), config: changes.config, bodies: changes.bodies, slots: changes.slots, world: changes.world, notes: changes.notes, warnings: A.warnings, slotCount: A.slotCount, main: A.mainCount };
}

// ---- forge games (CONTRACT §8 forge; research/rust-engine/PLAN.md §4 track S) ----

/** What a forge game's gf/three/kit.js records against what create would vendor today. */
async function forgeBehind(dir) {
  const { modules } = await decideModules({ engine: 'forge' });
  const want = await kitFiles(modules), wantForge = await forgeFiles();
  let have = {}, haveForge = {}, haveWasm = null;
  try { const t = await readFile(join(dir, 'gf/three/kit.js'), 'utf8'); const r = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); have = r.files ?? {}; haveForge = r.forge?.files ?? {}; haveWasm = r.forge?.wasm ?? null; } catch {}
  let wasm = null; try { wasm = JSON.parse(await readFile(join(FORGE_KIT, 'BUILD.json'), 'utf8')).wasm?.sha256 ?? null; } catch {}
  const diff = (w, h) => ({ added: Object.keys(w).filter(k => !(k in h)), changed: Object.keys(w).filter(k => k in h && h[k] !== w[k]), removed: Object.keys(h).filter(k => !(k in w)) });
  return { modules, kit: diff(want, have), forge: diff(wantForge, haveForge), wasm: { have: haveWasm, want: wasm, behind: !!wasm && haveWasm !== wasm } };
}

/** --plan for a forge game. */
async function forgePlan(dir) {
  const b = await forgeBehind(dir), why = [];
  const n = k => k.added.length + k.changed.length + k.removed.length;
  if (n(b.kit)) why.push(`gf/three is ${n(b.kit)} file${n(b.kit) > 1 ? 's' : ''} behind the kit (${b.kit.changed.length} changed, ${b.kit.added.length} added, ${b.kit.removed.length} removed since create)`);
  if (n(b.forge)) why.push(`gf/forge is ${n(b.forge)} file${n(b.forge) > 1 ? 's' : ''} behind research/gf-forge/kit (${b.forge.changed.length} changed, ${b.forge.added.length} added, ${b.forge.removed.length} removed)`);
  if (b.wasm.behind) why.push(`the core's wasm is ${String(b.wasm.have ?? 'none').slice(0, 12)}, the kit's release is ${String(b.wasm.want).slice(0, 12)}`);
  const mp = await checkKitReleased(dir);
  if (!mp.ok || !mp.latest) why.push(mp.ok ? `gf/mp is gf-multiplayer ${mp.version}, not the current one` : 'gf/mp is not an unedited gf-multiplayer release');
  return { ok: true, code: 0, dir, engine: 'forge', behind: why.length > 0, why, kit: b.kit, forge: b.forge, wasm: b.wasm, mp: { version: mp.version ?? null, latest: !!mp.latest }, world: { relay: false, why: 'a forge room is the spec\'s (create re-lays it); --world is for gf-three\'s stock templates' } };
}

/**
 * Upgrade a forge game: gf/three (the forge closure), gf/forge and its pinned release wasm, gf/mp, gf-assets and audio
 * re-copied; index.html and main.js regenerated (the forge boot); the configs get what the current forge kit expects
 * and the game lacks (fillMissing: e.g. characters.json → forge, the body friends see) and the files those name that
 * the game lacks (the co-op body, its clips, each held weapon: a file the game has is kept, it may be a Studio swap);
 * multiplayer.json keeps the game's values (create's own old forge sentences become the current ones); assets.json from
 * the declarations (the sound list kept, the tables' sounds added); the upgrade recorded in gf-three.json.
 */
async function upgradeForge(dir, { src, out, record, t0 }) {
  const readJson = async rel => JSON.parse(await readFile(join(dir, rel), 'utf8'));
  const changes = { kit: [], vendor: [], config: [], files: [], notes: [] };
  const before = await forgeBehind(dir);
  const { modules, mods } = await decideModules({ engine: 'forge' });
  const specBytes = await readFile(join(dir, 'spec.json')).catch(() => null);
  const spec = specBytes ? JSON.parse(specBytes.toString('utf8')) : null;
  let fresh = null;
  if (spec) {
    const probs = check(JSON.parse(await readFile(SPEC_SCHEMA, 'utf8')), spec);
    if (probs.length) changes.notes.push(`spec.json no longer validates against the current schema (${probs.slice(0, 2).join('; ')}); only the kit's files are refreshed`);
    else {
      const forgeLib = await (await importPart(join(FORGE, 'tools/library.mjs'), 'the forge engine (research/gf-forge)')).forgeLibrary();
      const lookConfig = mods.look?.lookConfig ? (id, time) => { const c = clone(mods.look.lookConfig(id, { time })); delete c.id; return c; } : null;
      const standinLook = await importKitModule(join(KIT, 'core/standins/look.js'));
      fresh = await specToConfig(spec, { modules, lookPreset: null, lookConfig, standinPresetValues: standinLook.presetValues, mechanicDefaults: {}, worldConfig: (s, o) => mods.world.worldConfig(s, { ...o, library: forgeLib }) });
    }
  }
  if (fresh) {
    for (const [name, skip] of [['game', GAME_SKIP], ['look', new Set()], ['characters', new Set()]]) {
      const cur = await readJson(`config/${name}.json`).catch(() => null);
      if (!cur || !fresh[name]) continue;
      const added = fillMissing(cur, fresh[name], { skip });
      if (added.length) { changes.config.push(...added.map(p => `config/${name}.json${p}`)); await writeConfig(dir, `config/${name}.json`, cur); }
    }
    // the files the current forge kit names that the game lacks (a file the game has is kept: it may be a Studio swap)
    for (const a of fresh.assets) if (!existsSync(join(dir, a.to))) { await put(join(dir, a.to), await readFile(a.from)); changes.files.push(a.to); }
    for (const [k, b] of Object.entries(fresh.bodies ?? {})) if (!record.bodies?.[k]) (record.bodies ??= {})[k] = b;
  }
  // multiplayer.json: the kit's keys the game lacks; create's own old forge sentences become the current ones
  try {
    const mp = await readJson('multiplayer.json');
    if (mp?.mode === 'live' && isObj(mp.live)) {
      const add = [];
      if (mp.live.backdrop === undefined) { mp.live.backdrop = 'gf-backdrop=1'; add.push('backdrop'); }
      if (mp.live.hud === undefined) { mp.live.hud = 'game'; add.push('hud'); }
      // the friends page in the forge theme's colours (research/gf-forge/hud/create.mjs), when the game set none
      if (mp.theme === undefined && fresh?.multiplayer?.theme) { mp.theme = fresh.multiplayer.theme; await writeFile(join(dir, 'multiplayer.json'), json(mp)); changes.config.push('multiplayer.json/theme'); }
      const OLD = 'Each player sees the others as their character, in their seat colour, with a ring at their feet and their name above.';
      if (mp.live.sees === OLD && fresh?.multiplayer?.live?.sees) { mp.live.sees = fresh.multiplayer.live.sees; mp.live.shares = fresh.multiplayer.live.shares; add.push('sees', 'shares'); }
      // the gate's query for a forge game (spec-config.mjs FORGE_GATE_QUERY): added when the game has none of its own
      const gq = fresh?.multiplayer?.check?.query ?? FORGE_GATE_QUERY;
      const addCheck = isObj(mp.check ??= {}) && mp.check.query === undefined;
      if (addCheck) mp.check.query = gq;
      if (add.length || addCheck) { await writeFile(join(dir, 'multiplayer.json'), json(mp)); changes.config.push(...add.map(k => `multiplayer.json/live/${k}`), ...(addCheck ? ['multiplayer.json/check/query'] : [])); }
    }
  } catch {}
  // the kit and everything vendored (verify check 2): gf/three's forge closure, gf/forge with its pinned wasm
  const kit = await vendorKit(dir, modules); changes.kit.push(...kit.wrote);
  changes.vendor.push(...(await vendorGfAssets(dir)).wrote);
  for (const f of AUDIO_FILES) await put(join(dir, 'audio', f), await readFile(join(GF_AUDIO, 'source', f)), changes.vendor, `audio/${f}`);
  const ad = await adopt(dir, { log: () => {} });
  if (!ad.ok) return { ok: false, code: 1, problems: ad.problems };
  changes.vendor.push(...ad.wrote);
  const rulesText = await readFile(join(dir, 'rules.js'), 'utf8').catch(() => '');
  changes.vendor.push(...(await vendorLibraries(dir, [...kit.sourceTexts, rulesText], { engine: 'forge' })).wrote);
  const title = spec?.title ?? (await readJson('config/game.json').catch(() => ({}))).title ?? 'A forge game';
  await put(join(dir, 'main.js'), mainJs('forge'), changes.vendor, 'main.js');
  // the page after main.js and the kit's copies are in place: its preload list is read from them (as create does)
  await put(join(dir, 'index.html'), indexHtml(title, 'forge', { preload: await forgeModules(dir) }), changes.vendor, 'index.html');
  // the build record and assets.json (the sound list kept; the sounds the current tables name added)
  const oldRecord = clone(record);
  const slotsBefore = await slotIds(dir);
  record.kit = { name: 'gf-three', version: KIT_VERSION, engine: 'forge', forge: FORGE_VERSION };
  record.modules = modules;
  let sounds = null;
  try { sounds = (await readJson('assets.json')).sounds ?? null; } catch {}
  // a sound the game lacks is added; one still on the untouched preset create used to list takes the forge library's
  // file (research/gf-forge/hud/create.mjs records that preset in fresh.sounds.replaced); anything else is the game's
  for (const [id, snd] of Object.entries(fresh?.sounds?.sounds ?? {})) if (sounds?.sounds && (!sounds.sounds[id] || fresh.sounds.replaced?.[id] === JSON.stringify(sounds.sounds[id].src))) { const had = !!sounds.sounds[id]; sounds.sounds[id] = snd; changes.notes.push(`sound ${id}: ${had ? 'the library\'s sound in place of the preset' : 'added'} (${snd.label})`); }
  const A = await assembleManifest(dir, { sounds, modules });
  await put(join(dir, 'assets.json'), json(A.manifest), changes.vendor, 'assets.json');
  if (spec) {
    const cur = await readFile(join(dir, 'ATTRIBUTION.md'), 'utf8').catch(() => null);
    if (cur === null || cur === attribution(spec, oldRecord)) await writeFile(join(dir, 'ATTRIBUTION.md'), attribution(spec, record));
    else if (changes.files.length) {
      const rows = fresh.assets.filter(a => changes.files.includes(a.to)).map(a => `| ${a.to} | ${relative(REPO, a.from)} | ${a.license?.spdx ?? 'see the library\'s LICENSES.json'}${a.license?.author ? `, ${a.license.author}` : ''} |`);
      await writeFile(join(dir, 'ATTRIBUTION.md'), `${cur.trimEnd()}\n\n## Art added by tools/upgrade.mjs (${new Date().toISOString().slice(0, 10)})\n\n| File | From | Licence |\n|---|---|---|\n${rows.join('\n')}\n`);
    }
  }
  const after = new Set(A.manifest.slots.map(s => s.id));
  const slots = { added: [...after].filter(id => !slotsBefore.has(id)), removed: [...slotsBefore].filter(id => !after.has(id)) };
  const entry = { at: new Date().toISOString(), kit: KIT_VERSION, forge: FORGE_VERSION, from: out ? relative(dirname(dir), src) : null, wasm: { from: before.wasm.have, to: before.wasm.want }, gfForge: before.forge, config: changes.config, files: changes.files };
  record.upgrades = [...(record.upgrades ?? []), entry];
  await writeFile(join(dir, 'gf-three.json'), json(record));
  return { ok: true, code: 0, dir, src, engine: 'forge', ms: Math.round(performance.now() - t0), modules, kit: before.kit, forge: before.forge, wasm: before.wasm, vendor: changes.vendor.filter(f => !f.startsWith('gf/three/') && !f.startsWith('gf/forge/')), config: changes.config, files: changes.files, slots, notes: changes.notes, warnings: A.warnings, slotCount: A.slotCount, main: A.mainCount };
}

/**
 * --plan (read-only): is the game behind the current kit, and is --world for it? The Studio worker asks before a change
 * job's agent starts (research/foundations/studio-worker/lib/v2.mjs upgradeBase; Hang Up On Them, 2026-10-07: a change to
 * version 1 kept the open-roof office, the bean zombie and one-hit kills, because nothing upgraded the recovered game).
 *   behind  gf/three is not what create would vendor today for the game's modules (the version string stays 0.1.0-dev,
 *           so the files are compared: gf/three/kit.js's hashes against the kit's; verify check 2's "N file(s) have
 *           changed in research/gf-three/kit since"), or gf/mp is an older gf-multiplayer
 *   world   check 17 (tools/lib/world-check.mjs) on the world as it is; `relay` when it fails and the world is still a
 *           stock template layout (stockWorld) and spec.json validates: the one case --world is for
 * → { ok, code, behind, why: [..], kit: {added, changed, removed}, mp: {version, latest}, world: {template, complete,
 *     errors: [rule], stock, why, relay} }
 */
export async function upgradePlan(gameDir) {
  const dir = resolve(gameDir);
  if (!existsSync(join(dir, 'gf-three.json')) || !existsSync(join(dir, 'config/game.json'))) return { ok: false, code: 2, problems: [`${dir} is not a gf-three game (no gf-three.json or config/game.json)`] };
  const record = JSON.parse(await readFile(join(dir, 'gf-three.json'), 'utf8'));
  const why = [];
  // forge (CONTRACT §8 forge): behind when gf/three, gf/forge or its pinned wasm is not what create would vendor today,
  // or gf/mp is an older gf-multiplayer; --world is not for forge (its room comes from the spec, not a stock template)
  if (record.kit?.engine === 'forge') return forgePlan(dir);
  const { modules } = await decideModules({ standins: !!record.options?.standins, standinMechanics: !!record.options?.standinMechanics });
  const want = await kitFiles(modules);
  let have = {};
  try { const t = await readFile(join(dir, 'gf/three/kit.js'), 'utf8'); have = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).files ?? {}; } catch {}
  const kit = { added: Object.keys(want).filter(k => !(k in have)), changed: Object.keys(want).filter(k => k in have && have[k] !== want[k]), removed: Object.keys(have).filter(k => !(k in want)) };
  const n = kit.added.length + kit.changed.length + kit.removed.length;
  if (n) why.push(`gf/three is ${n} file${n > 1 ? 's' : ''} behind the kit (${kit.changed.length} changed, ${kit.added.length} added, ${kit.removed.length} removed since create)`);
  const mp = await checkKitReleased(dir);
  if (!mp.ok || !mp.latest) why.push(mp.ok ? `gf/mp is gf-multiplayer ${mp.version}, not the current one` : 'gf/mp is not an unedited gf-multiplayer release');
  // --world needs the spec as create reads it today
  let specOk = false;
  try { specOk = !check(JSON.parse(await readFile(SPEC_SCHEMA, 'utf8')), JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8'))).length; } catch {}
  let world;
  try {
    const subject = await loadWorldSubject(dir), r = checkWorld(subject);
    world = { template: subject.world.template ?? null, complete: r.ok, errors: [...new Set(r.problems.filter(p => p.severity === 'error').map(p => p.rule))] };
    if (r.ok) Object.assign(world, { stock: null, why: 'check 17 passes', relay: false });
    else if (!specOk) Object.assign(world, { stock: null, why: 'spec.json is missing or does not validate, so --world cannot re-lay it', relay: false });
    else { const s = await stockWorld(dir, subject); Object.assign(world, s, { relay: s.stock === true }); }
  } catch (e) { world = { template: null, complete: null, errors: [], stock: null, why: `no world to check (${String(e.message).split('\n')[0]})`, relay: false }; }
  return { ok: true, code: 0, dir, behind: why.length > 0, why, kit, mp: { version: mp.version, latest: !!mp.latest }, world };
}

/** A placement as the fixed template layouts wrote it: the prop, where and which way. */
const placeKey = p => `${p.prop}@${(p.at ?? []).map(v => (+v).toFixed(2)).join(',')}@${+(p.rot ?? 0)}`;

/**
 * Is the game's world still a stock template layout, the case --world is for (the set-dressing and world fixes live in
 * the templates; a world the game's agent laid out is its own)? Stock: a layout from before the world generator
 * (kit/world/generate.js writes sizeClass) whose placements, apart from the game's own props and its mechanics' props
 * (create placed or removed those), are all the template's own at some commit of kit/world/templates/<template>.json,
 * nothing added, moved or turned, and at most a tenth of the template's left out. The old fixed layouts are only in git
 * history, so no history means unknown (null), never a guess. → { stock: true | false | null, why }
 */
export async function stockWorld(dir, subject = null) {
  subject ??= await loadWorldSubject(dir);
  const w = subject.world, t = w.template;
  const file = t ? join(KIT, 'world/templates', `${t}.json`) : null;
  if (!file || !existsSync(file)) return { stock: false, why: `its template "${t ?? '(none)'}" is not a kit template` };
  if (w.sizeClass) return { stock: false, why: `made by the world generator (${t}, ${w.sizeClass}): any change since is the game's own` };
  const own = new Set([...(subject.game?.props ?? []).map(p => p.name), ...(subject.game?.mechanics ?? []).map(m => m.params?.prop).filter(x => typeof x === 'string' && x)]);
  const mine = (w.props ?? []).filter(p => !own.has(p.prop)).map(placeKey), mineSet = new Set(mine);
  const rel = relative(REPO, file).split('\\').join('/');
  const git = args => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
  let commits;
  try { commits = git(['log', '--format=%H', '--', rel]).split('\n').filter(Boolean); } catch { return { stock: null, why: `no git history of ${rel} to compare with` }; }
  let best = null;
  for (const h of commits) {
    let layout; try { layout = JSON.parse(git(['show', `${h}:${rel}`])); } catch { continue; }
    if (!Array.isArray(layout.props)) continue;          // a recipe (the generator's), not a fixed layout
    const theirs = new Set(layout.props.filter(p => !own.has(p.prop)).map(placeKey));
    const added = mine.filter(k => !theirs.has(k)).length, left = [...theirs].filter(k => !mineSet.has(k)).length;
    const row = { h: h.slice(0, 9), added, left, of: theirs.size };
    if (!added && left <= theirs.size / 10) return { stock: true, why: `the ${t} template's layout as of ${row.h} (${mine.length} of its ${theirs.size} placements, none added, moved or turned)` };
    if (!best || added + left < best.added + best.left) best = row;
  }
  return { stock: false, why: best ? `not a stock ${t} layout: closest is ${best.h}, with ${best.added} placement(s) added, moved or turned and ${best.left} of ${best.of} left out` : `no fixed ${t} layout in the history of ${rel}` };
}

/** Write a config only when a value changed (a file the game wrote in its own style is left byte for byte otherwise). */
async function writeConfig(dir, rel, value) {
  const cur = await readFile(join(dir, rel), 'utf8').catch(() => null);
  let same = false; try { same = cur !== null && JSON.stringify(JSON.parse(cur)) === JSON.stringify(value); } catch {}
  if (!same) await writeFile(join(dir, rel), json(value));
}
async function kitHashes(dir) {
  const out = new Map();
  for (const rel of await walk(join(dir, 'gf/three'))) out.set(rel, sha256(await readFile(join(dir, 'gf/three', rel))));
  return out;
}
async function slotIds(dir) { try { return new Set(JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8')).slots.map(s => s.id)); } catch { return new Set(); } }

if (isMain(import.meta)) {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const dir = a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--out');
  if (!dir) { console.error('usage: upgrade.mjs <game> [--out <dir>] [--world] [--json] | <game> --plan [--json]'); process.exit(2); }
  if (a.includes('--plan')) {
    const p = await upgradePlan(dir);
    process.exitCode = p.code;
    if (a.includes('--json')) process.stdout.write(JSON.stringify(p, null, 2) + '\n');
    else if (!p.ok) { for (const x of p.problems) console.error(`problem: ${x}`); console.error('upgrade --plan: FAILED'); }
    else {
      console.log(`kit     ${p.behind ? `behind: ${p.why.join('; ')}` : `current (gf/three${p.engine === 'forge' ? ', gf/forge and its wasm' : ''} and gf/mp are what create would write today)`}`);
      const w = p.world;
      console.log(`world   ${w.complete ? 'complete (check 17 passes)' : w.complete === false ? `NOT COMPLETE (${w.errors.join(', ')}); ${w.stock ? 'stock' : w.stock === false ? 'not stock' : 'unknown'}: ${w.why}` : w.why}`);
      console.log(`upgrade --plan: ${p.behind || w.relay ? `run node research/gf-three/tools/upgrade.mjs ${relative(process.cwd(), p.dir) || '.'}${w.relay ? ' --world' : ''}` : 'nothing to do'}`);
    }
    process.exit();
  }
  const r = await upgrade(dir, { out: opt('--out'), world: a.includes('--world') });
  process.exitCode = r.code;
  if (a.includes('--json')) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else if (!r.ok) { for (const p of r.problems) console.error(`problem: ${p}`); console.error('upgrade: FAILED'); }
  else {
    const list = (xs, n = 8) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}`;
    console.log(`kit     gf/three: ${r.kit.changed.length} changed, ${r.kit.added.length} added, ${r.kit.removed.length} removed${r.kit.changed.length + r.kit.added.length ? ` (${list([...r.kit.added.map(f => `+${f}`), ...r.kit.changed])})` : ''}`);
    if (r.engine === 'forge') console.log(`forge   gf/forge: ${r.forge.changed.length} changed, ${r.forge.added.length} added, ${r.forge.removed.length} removed; the core's wasm ${r.wasm.behind ? `${String(r.wasm.have ?? 'none').slice(0, 12)} → ${String(r.wasm.want).slice(0, 12)}` : 'already the kit\'s release'}${r.files?.length ? `; copied ${list(r.files)}` : ''}`);
    if (r.vendor.length) console.log(`vendor  ${list(r.vendor)}`);
    console.log(`config  ${r.config.length ? `added ${list(r.config, 12)}` : 'nothing added (every value the game set is kept)'}`);
    if (r.bodies?.length) console.log(`bodies  refreshed ${list(r.bodies)} (the current library bean)`);
    if (r.world) console.log(`world   replaced ${r.world.replaced.join(', ') || 'nothing (already the current template)'}${r.world.kept ? ` (the old files are in ${r.world.kept})` : ''}${r.world.copied.length ? `; copied ${list(r.world.copied)}` : ''}${r.world.carried?.length ? `; carried the game's own ${r.world.carried.join(', ')}` : ''}`);
    console.log(`slots   ${r.slotCount} (${r.main} main)${r.slots.added.length ? `; added ${list(r.slots.added)}` : ''}${r.slots.removed.length ? `; removed ${list(r.slots.removed)}` : ''}`);
    for (const n of r.notes) console.log(`note    ${n}`);
    for (const w of r.warnings) console.log(`warning ${w}`);
    console.log(`upgrade: OK ${relative(process.cwd(), r.dir) || '.'}${r.dir !== r.src ? ` (from ${relative(process.cwd(), r.src)})` : ''} in ${(r.ms / 1000).toFixed(1)} s · rules.js and the game's config values kept · next: node research/gf-three/tools/verify.mjs ${relative(process.cwd(), r.dir) || '.'}`);
  }
}
