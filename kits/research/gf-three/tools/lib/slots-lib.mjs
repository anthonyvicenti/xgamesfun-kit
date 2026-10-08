// assets.json from slot declarations (CONTRACT §2.2): the kit's own modules (core, ui, controller), the look, world
// and character modules (real or stand-in), each mechanic, config/*.json and the files under assets/.
//
//   const m = await assembleManifest(gameDir, { sounds });   // → the gf-assets/1 object (not written)
//
// Declarations are read from the game's own kit copy (gf/three/) when it has one, else from the kit source.
// Main tier: at most MAIN_MAX slots stay "main", by each declaration's `rank` (the rest become "advanced").
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, LIBRARY, walk } from './paths.mjs';
import { importKitModule } from './kit-import.mjs';

export const MAIN_MAX = 40;
export const GROUPS = [
  ['text', 'Title & text'], ['characters', 'Characters'], ['props', 'Props'], ['world', 'World'], ['look', 'Look & light'], ['look-times', 'Look: times of day'], ['look-quality', 'Look: quality tiers'],
  ['rules', 'Rules & scoring'], ['mechanics', 'How it plays'], ['controls', 'Movement & camera'], ['ui', 'Menus & HUD'], ['models', 'Other models'],
];
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

/** A module file from the game's kit copy, else the kit source. */
const kitFile = (gameDir, rel) => { const g = join(gameDir, 'gf/three', rel); return existsSync(g) ? g : join(KIT, rel); };

async function provider(gameDir, rel) {
  const mod = await importKitModule(kitFile(gameDir, rel));
  if (mod.error) throw new Error(`${rel}: could not be imported in Node (${mod.error.message}); a module must not touch the DOM at import`);
  return mod;
}
// A module's declarations: slotsFor(<its own config>, ...extra) when it has one (look: config/look.json; world:
// config/world.json, the prop catalog and the library's licences; character: config/characters.json), else `slots`.
function fromModule(mod, own, ...extra) {
  if (typeof mod.slotsFor === 'function') return mod.slotsFor(own, ...extra) ?? [];
  if (Array.isArray(mod.slots)) return mod.slots;
  return [];
}

/** Fill {placeholders} in a template from vars (deep). Unknown placeholders are left and reported. */
export function fill(template, vars, missing = new Set()) {
  if (typeof template === 'string') return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : (missing.add(k), m)));
  if (Array.isArray(template)) return template.map(t => fill(t, vars, missing));
  if (template && typeof template === 'object') return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, vars, missing)]));
  return template;
}

const CONFIG_FILES = { 'config/game.json': 'game', 'config/look.json': 'look', 'config/world.json': 'world', 'config/characters.json': 'characters', 'config/props.json': 'catalog' };
function valueAt(cfg, source) {
  const doc = cfg[CONFIG_FILES[source.file]];
  if (!doc) return undefined;
  let v = doc;
  for (const k of source.pointer.split('/').slice(1).map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'))) { if (v == null || typeof v !== 'object') return undefined; v = v[k]; }
  return v;
}

export async function readConfig(gameDir) {
  const c = n => readJson(join(gameDir, `config/${n}.json`));
  const [game, look, world, characters] = await Promise.all([c('game'), c('look'), c('world'), c('characters')]);
  const record = existsSync(join(gameDir, 'gf-three.json')) ? await readJson(join(gameDir, 'gf-three.json')) : {};
  const catalog = existsSync(join(gameDir, 'config/props.json')) ? await readJson(join(gameDir, 'config/props.json')) : null;
  const licences = existsSync(join(LIBRARY, 'LICENSES.json')) ? await readJson(join(LIBRARY, 'LICENSES.json')) : null;
  const files = (await walk(join(gameDir, 'assets'))).map(r => `assets/${r}`);
  return { game, look, world, characters, record, files, catalog, licences };
}

export async function assembleManifest(gameDir, { sounds = null, modules = null } = {}) {
  const cfg = await readConfig(gameDir);
  const rec = cfg.record;
  const mods = modules ?? rec.modules ?? { look: false, world: false, character: false, mechanics: [] };
  cfg.propFiles = rec.props ?? {};
  const warnings = [];
  const slots = [];
  const push = (list, from) => { for (const s of list ?? []) slots.push({ ...s, __from: from }); };

  // mechanics with their own module declare their own slots; the rest get param slots from core
  cfg.mechanicSlots = new Set();
  const mechSlots = [];
  for (const [i, m] of (cfg.game.mechanics ?? []).entries()) {
    if (!mods.mechanics?.includes(m.id)) continue;
    const mod = await provider(gameDir, `mechanics/${m.id}/index.js`);
    const templates = typeof mod.slotsFor === 'function' ? mod.slotsFor({ ...m, index: i, base: `/mechanics/${i}/params` }, cfg) : (mod.slots ?? []);
    if (!templates.length) continue;
    cfg.mechanicSlots.add(m.id);
    const missing = new Set();
    const vars = { ...(m.params ?? {}), id: m.id, i, index: i, base: `/mechanics/${i}/params`, as: m.as ?? m.id };
    for (const t of templates) { const s = fill(t, vars, missing); s.source ??= { file: 'config/game.json' }; s.source.file ??= 'config/game.json'; mechSlots.push(s); }
    if (missing.size) warnings.push(`mechanic ${m.id}: unfilled placeholders ${[...missing].join(', ')}`);
  }

  push((await provider(gameDir, 'ui/slots.js')).slotsFor(cfg), 'ui');
  const standins = await provider(gameDir, 'core/standins/slots.js');
  push(mods.character ? fromModule(await provider(gameDir, 'character/character.js'), cfg) : standins.characterSlots(cfg), 'character');   // track C's slotsFor takes {characters, …}
  push(mods.world ? fromModule(await provider(gameDir, 'world/world.js'), cfg.world, cfg.catalog, cfg.licences) : standins.worldSlots(cfg), 'world');
  push(mods.look ? fromModule(await provider(gameDir, 'look/look.js'), cfg.look) : standins.lookSlots(cfg), 'look');
  // the props the spec names are the game's own: main tier, with the game's description; a gameplay prop the world
  // does not place still needs its model slot
  // (rec.named: the spec's prop name → its slot id; scenery the world template brings stays advanced)
  const named = new Map(Object.values(rec.named ?? {}).map(id => [id.slice(5), { name: id.slice(5) }]));
  for (const p of cfg.game.props ?? []) named.set(p.name, p);
  // a mechanic's own prop (the pickup's coffee mug, an enemy prop) is the game's too, wherever its model came from
  for (const m of cfg.game.mechanics ?? []) { const n = m.params?.prop; if (typeof n === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(n) && !named.has(n)) named.set(n, { name: n }); }
  for (const s of slots) if (s.type === 'model' && s.id.startsWith('prop.') && named.has(s.id.slice(5))) { s.tier = 'main'; s.rank = 94; const d = named.get(s.id.slice(5)).describe; if (d) s.description = d; }
  for (const [n, p] of named) {
    if (slots.some(s => s.id === `prop.${n}`)) continue;
    const f = rec.props?.[n]?.file ?? `assets/models/${n}.glb`;
    if (!cfg.files.includes(f)) continue;
    slots.push({ id: `prop.${n}`, group: 'props', label: n.replace(/^./, c => c.toUpperCase()), type: 'model', source: { file: f }, constraints: { maxBytes: 8388608, scale: 1 }, tier: 'main', facet: 'look', rank: 94, __from: 'game',
      ...(p.describe ? { description: p.describe, generate: { prompt: p.describe, style: 'stylised low-poly game prop, soft colours, clean silhouette' } } : {}), ...(rec.props?.[n]?.license ? { license: rec.props[n].license } : {}) });
  }
  push((await provider(gameDir, 'core/slots.js')).slotsFor(cfg), 'core');
  push(mechSlots, 'mechanics');
  push((await provider(gameDir, 'controller/slots.js')).slotsFor(cfg), 'controller');

  // files under assets/ that no declaration covers still become slots (coverage rule 1)
  const covered = new Set(slots.map(s => s.source?.file));
  for (const f of cfg.files) {
    if (covered.has(f) || /\/(LICEN[CS]E|ATTRIBUTION|README)[^/]*$/i.test(f)) continue;
    const base = f.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const ext = f.split('.').pop().toLowerCase();
    const type = ['glb', 'gltf'].includes(ext) ? 'model' : ['ktx2', 'hdr'].includes(ext) ? 'texture' : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? 'image' : ['ogg', 'mp3', 'wav'].includes(ext) ? 'audio' : ['json', 'txt', 'csv'].includes(ext) ? 'data' : null;
    if (!type) { warnings.push(`${f}: not a slot type; left out`); continue; }
    const id = f.startsWith('assets/clips/') ? `character.clips.${base}` : `${type}.${base}`;
    slots.push({ id, group: f.startsWith('assets/clips/') ? 'characters' : 'models', label: base.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()), type, source: { file: f }, tier: 'advanced', rank: 5, __from: 'files',
      ...(f.startsWith('assets/clips/') ? { editable: false, readonlyReason: 'The shared animation clips every body plays; replaced as part of the character standard' } : {}) });
  }

  // one idea, one main slot: seat colours are character.tint.<role> (CONTRACT §2.2); the look's own player palette
  // only seeds them at create time, so it is not offered beside them
  if (slots.some(s => s.id.startsWith('character.tint.'))) for (const s of slots) if (s.id === 'look.palette.players') { s.tier = 'advanced'; s.rank = 5; s.description = 'The look preset\'s suggestion for player colours; the game uses "Player colours" (character.tint)'; }
  // slot ids are lowercase (gf-assets/1: ^[a-z0-9][a-z0-9_.-]{0,79}$); a module's camelCase id is turned to kebab case
  const ID = /^[a-z0-9][a-z0-9_.-]{0,79}$/, fixed = new Set();
  for (const s of slots) if (typeof s.id === 'string' && !ID.test(s.id)) {
    const id = s.id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 80);
    fixed.add(`${s.__from}: ${s.id} → ${id}`); s.id = id;
  }
  if (fixed.size) warnings.push(`slot ids made lowercase (declare them so): ${[...fixed].slice(0, 6).join(', ')}${fixed.size > 6 ? ` and ${fixed.size - 6} more` : ''}`);
  // one slot per id (the first declaration wins)
  const seen = new Map(), out = [];
  for (const s of slots) {
    if (seen.has(s.id)) { warnings.push(`slot ${s.id} declared by ${seen.get(s.id)} and ${s.__from}; kept the first`); continue; }
    seen.set(s.id, s.__from); out.push(s);
  }
  // player looks (CONTRACT §6e): the kit's declarations mark the defaults (`scope: "player"`); config/game.json →
  // loadout: { slots: [ids a player's loadout may also set], off: [ids that stay the game's for everyone] }
  const lo = cfg.game.loadout && typeof cfg.game.loadout === 'object' ? cfg.game.loadout : {};
  const loAdd = new Set(Array.isArray(lo.slots) ? lo.slots : []), loOff = new Set(Array.isArray(lo.off) ? lo.off : []);
  for (const s of out) {
    if (loOff.has(s.id)) delete s.scope;
    else if (loAdd.has(s.id)) { if (['text', 'json'].includes(s.type)) warnings.push(`config/game.json loadout.slots: ${s.id} is a ${s.type} slot; text and JSON are never part of a look`); else s.scope = 'player'; }
  }
  for (const id of [...loAdd, ...loOff]) if (!seen.has(id)) warnings.push(`config/game.json loadout: there is no slot "${id}"`);
  // main tier within MAIN_MAX, by rank
  const main = out.filter(s => (s.tier ?? 'main') === 'main').sort((a, b) => (b.rank ?? 50) - (a.rank ?? 50));
  for (const s of main.slice(MAIN_MAX)) s.tier = 'advanced';
  const groupIds = GROUPS.map(g => g[0]);
  const finalSlots = out.map(({ __from, rank, ...s }) => {
    // a declared range must hold the slot's own value (a module's generic range can miss a negative default)
    if ((s.type === 'number' || s.type === 'integer') && s.source?.pointer && s.constraints) {
      const v = valueAt(cfg, s.source);
      if (typeof v === 'number') {
        if (typeof s.constraints.min === 'number' && v < s.constraints.min) { warnings.push(`slot ${s.id}: value ${v} is under its declared min ${s.constraints.min}; min widened`); s.constraints = { ...s.constraints, min: v }; }
        if (typeof s.constraints.max === 'number' && v > s.constraints.max) { warnings.push(`slot ${s.id}: value ${v} is over its declared max ${s.constraints.max}; max widened`); s.constraints = { ...s.constraints, max: v }; }
      }
    }
    if (!groupIds.includes(s.group)) { warnings.push(`slot ${s.id}: group "${s.group}" is not a kit group; put in "models"`); s.group = 'models'; }
    if (s.tier === undefined) s.tier = 'main';
    for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
    return s;
  }).sort((a, b) => groupIds.indexOf(a.group) - groupIds.indexOf(b.group));
  const used = new Set(finalSlots.map(s => s.group));

  const roles = Object.keys(cfg.characters.roles ?? {});
  const propNames = [...named.keys()].filter(n => seen.has(`prop.${n}`));   // the game's own props (scenery has no preview view of its own)
  const has = id => seen.has(id);
  const showcase = [
    ...roles.map(r => ({ id: `character.${r}`, label: r === 'player' ? 'Player character' : `${r} character`, query: `?gf-show=character.${r}`, slots: [`character.body.${r}`, `character.tint.${r}`, `character.height.${r}`].filter(has) })),
    ...propNames.map(n => ({ id: `prop.${n}`, label: n.replace(/^./, c => c.toUpperCase()), query: `?gf-show=prop.${n}`, slots: [`prop.${n}`, `prop.${n}.size`].filter(has) })),
    { id: 'world', label: 'The world', query: '?gf-show=world', groups: ['world'] },
    { id: 'look', label: 'Look and light', query: '?gf-show=look', groups: ['look'] },
  ];

  const manifest = {
    schema: 'gf-assets/1',
    game: rec.game ?? 'gf-three-game',
    title: cfg.game.text?.title ?? cfg.game.title ?? 'A gf-three game',
    editing: 'live',
    groups: GROUPS.filter(([id]) => used.has(id)).map(([id, label]) => ({ id, label })),
    showcase,
    slots: finalSlots,
    sounds: sounds ?? { version: 1, sounds: {} },
    ...(cfg.catalog ? { embed: [{ path: 'config/props.json', reason: 'the prop catalog entries the world module reads (sizes, colliders, materials)' }] } : {}),
    check: {
      steps: [{ waitFor: "window.__game && window.__game.phase === 'lobby'", timeout: 90000 }, { wait: 500 }],
      play: { steps: [{ clickSelector: '#gf-play' }, { wait: 4500 }, { hold: 'KeyW', ms: 1200 }, { key: 'KeyE' }, { click: 'centre' }, { wait: 800 }], avoidKeys: [] },
    },
    ignore: [
      { path: 'vendor/**', reason: 'pinned library code: three.js 0.186.0, Rapier 0.19.2, postprocessing, N8AO (licences beside each copy)' },
      { path: 'gf/**', reason: 'kit copies: gf-three, gf-multiplayer, gf-assets (vendored by create, never edited)' },
      { path: 'audio/**', reason: 'gf-audio 1.5.0 kit' },
      { path: 'evidence/**', reason: 'QA evidence (verify runs), append-only' },
      { path: 'spec.json', reason: 'the game spec this project was made from (research/studio-v2/game-spec.schema.json)' },
      { path: 'gf-three.json', reason: 'build record from create: kit version, modules, where each asset came from' },
      { path: 'generated.json', reason: 'record of the models the spec asked to generate and what happened (the Studio worker writes it; verify check 14 reads it)' },
      { path: 'multiplayer.json', reason: 'multiplayer manifest (research/multiplayer/STANDARD.md)' },
    ],
  };
  return { manifest, warnings, mainCount: finalSlots.filter(s => s.tier === 'main').length, slotCount: finalSlots.length };
}
