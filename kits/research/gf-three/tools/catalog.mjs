#!/usr/bin/env node
// gf-three catalog: what the kit offers, for the pitch agent and for builders.
//
//   node research/gf-three/tools/catalog.mjs [--json] [--engine party|scenic|forge]
//
// engines    the two engines (research/gf-scenic/PLAN.md, CONTRACT §8) and how a pitch picks one (engineGuide): each
//            engine's worlds, looks and cameras; mechanics, bodies and props are shared. Top-level `worlds` and `looks`
//            list both engines' (each with its `engine`); --engine keeps one engine's.
// mechanics  kit/mechanics/<id>/index.js: id, `examples` (the `as` lines), the params JSON Schema (wave-1 ids that
//            have no module yet are listed as planned, with PLAN §2.1's one-line description)
// worlds     the world module's templates (kit/world/templates/*.json recipes, expanded by kit/world/generate.js): label,
//            describe, indoor or outdoor, the set-pieces, and per size class (spec world.size) the footprint, rooms or
//            areas, entries (where enemies come in) and zones
// bodies     library/bodies.json (or library/bodies/*.glb while that list does not exist), then the scenic library's
//            (research/gf-scenic/library/bodies.json, marked library: 'scenic'); any game may wear any of them
// looks      the look module's presets (id, label, describe), else the stand-in presets
// props      library/props.json (id, describe, tags, size), then the scenic library's (weapons, dungeon pieces)
// clips      the character module's CLIPS
// cameras, players and round limits from the game spec schema
import { isMain } from './lib/main.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT, LIBRARY, KIT_VERSION, SPEC_SCHEMA, SCENIC, SCENIC_KIT, SCENIC_VERSION, FORGE_KIT, FORGE_VERSION } from './lib/paths.mjs';
import { importKitModule } from './lib/kit-import.mjs';
import { kitModuleFiles } from './lib/vendor.mjs';
import { FAIR_DEFAULTS } from '../kit/core/fair-logic.js';

// What fair play does for every game (kit/core/fair.js, CONTRACT §6c); pitch and build agents read it here.
const FAIR_DESCRIBE = [
  'a knock takes a player out of control for downSeconds at most (tumble and get-up included)',
  'nobody can hurt, knock or score on a player who is down or out',
  'protectSeconds of protection after getting up or respawning (the body shimmers)',
  'startGrace seconds after Go with no hits; bots hold fire',
  'streams and contact damage push, never knock over; discrete hits and splashes knock',
  'bots pick targets that can be hit, spread out (botsPerTarget), react and aim like people (botSkill); respawn far from others',
];

// How a pitch picks bodies (track E, 2026-10-07; the creator: "I am not sure if we should always make the players the
// same looking blobs"). The worker's checker (studio-worker/tools/check-characters.mjs) enforces the starred lines.
const BODY_GUIDE = [
  '* the creator attached an image and asks for a character to look like it: that role is {from: "reference"}; describe keeps outfit, accessories, colours, proportions and art style; no caricature of a group, and an enemy horde is not defined by an ethnic group',
  'players: a bean for a cute or party idea or when the creator asks; otherwise a library body whose tags fit the theme (tagged "player"; playerColour: true gives each seat its own colour), or {from: "generate"}',
  '* a bean player beside a non-bean enemy or NPC says why in body.why',
  '* every role has its own body (two roles on one bean or one library body look identical)',
  'enemies and NPCs: a library body tagged "enemy" or matching the theme, else generate or reference',
  'bodies differ in silhouette, not only colour: pick a different build or height for the enemies than for the players',
];

const PLANNED = {
  projectile: 'Discrete and continuous streams, arcs, hits, splash', paint: 'Surface coverage per player or team; territory score',
  pickup: 'Consumables that refill or modify a player\'s meters; respawn', health: 'Health, knockback, ragdoll and get-up, respawn',
  carry: 'Grab, carry and throw props or players', waves: 'Host-owned enemies, spawners, a target to defend',
  station: 'Interact with a prop: an in-world screen or panel UI, timed tasks, quotas', race: 'Checkpoints, laps, a finish order',
  tag: 'Roles that pass between players on contact, hide and seek', teams: 'Team assignment, team score',
  // research/gf-scenic/PLAN.md §3 (track M), either engine
  melee: 'Swords, axes and fists: combo chains (windup, active, recover), arc and reach, damage, knockback and hit-stop; a dash with invulnerable frames; slash trails',
  levels: 'A run of levels (one island or room set each): clear every enemy, the portal or door opens, everyone moves to the next; the last is the boss',
  boss: 'A boss with phases and telegraphed attacks (slam, charge, volley, summon) and its health bar on the HUD',
  loot: 'Drops, chests, coins, potions and weapons with rarity; pick one of three upgrades between levels',
};
const PLANNED_BY = { melee: 'track M', levels: 'track M', boss: 'track M', loot: 'track M' };

// How a pitch picks the engine (research/gf-scenic/PLAN.md §0; creator, 2026-10-08: "I think the current kit has its
// charm for silly games. I think we should keep this for more serious and scenic type games"). The checker
// (studio-worker/tools/check-v2.mjs) enforces the starred lines.
const ENGINE_GUIDE = [
  'party (gf-three): silly party games with friends: pranks, chaos, slapstick, friendslop, crude humour; jelly-bean or toon looks, flat lots and buildings',
  'scenic (gf-scenic): serious, scenic or action games: adventure, roguelite, brawler, dungeon crawler, hack and slash, exploration, survival, RPG-like; anything that names a serious game; reference images that look like polished 3D art',
  'forge (gf-forge): first-person or close-camera action with weight: a shooter, a dark roguelite run, survival nights, arena fights; the feel of a modern FPS (a Rust core on WebGPU); co-op for 2-4. Its play is the data tables (spec.forge: weapons, enemies, waves, cards) and rules.js, not mechanic modules',
  'when unsure, scenic for anything that is not silly',
  '* forge is never a card for a game meant to open inside a post on X (or another in-app browser): it needs WebGPU until its WebGL2 build (track W, research/rust-engine/PLAN.md §9)',
  '* a forge spec lists no mechanic; a forge card promises only what its tables run today (catalog.json → engines.forge.tables: a table whose `runs` is null goes in v1.notYet)',
  '* every card\'s spec says its engine; its world.template, look.preset and camera are that engine\'s (engines.<id>)',
  '* a prompt that names a serious genre (roguelike, brawler, dungeon crawler, hack and slash, RPG, adventure, survival …) and nothing silly gets scenic on card 1, or forge when it is first-person action',
];
// The scenic worlds in words, until the scenic world module describes its own (templateInfo).
const SCENIC_WORLDS = {
  island: { label: 'Island', describe: 'one island in the sea: cliffs, grass, trees, paths and water round it' },
  isles: { label: 'Floating isles', describe: 'floating islands over a void, one per level, joined by portals; cliff skirts below' },
  ruins: { label: 'Ruins', describe: 'a stone arena among ruins and trees' },
  dungeon: { label: 'Dungeon', describe: 'rooms joined by doors, one room set per level' },
};
// The forge world in words (research/gf-forge/kit/world.js), until it describes its own.
const FORGE_WORLDS = {
  'crypt-room': { label: 'Crypt room', kind: 'indoor', describe: 'a torch-lit stone room of KayKit dungeon pieces (3, 4 or 5 tiles of 3 m a side by size), barrels and crates, the spec\'s own props by the far wall' },
  'ruins-arena': { label: 'Ruins arena', kind: 'outdoor', describe: 'a moonlit ruined courtyard generated from world.seed (8, 10 or 12 tiles of 3 m a side by size): broken walls and a gate, braziers and torches, cover between a stone plaza and the walls, graves enemies rise from, dead trees past the walls; the spec\'s own props round the plaza' },
};
const FORGE_LOOKS = {
  'moonlit-ruins': { label: 'Moonlit ruins', describe: 'a cold moon with shadows, teal fog, warm fires and bloom, square texels and grain: the ruins arena\'s look' },
  'ember-crypt': { label: 'Ember crypt', describe: 'dark red fog and red-orange fire light: the crypt room\'s look' },
  'ash-storm': { label: 'Ash storm', describe: 'a dim sun through falling ash, thick warm fog' },
};
const readJson = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
const summarizeParams = schema => Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([k, s]) => [k, { type: s.type ?? (s.enum ? 'enum' : '?'), ...(s.enum ? { enum: s.enum } : {}), ...('default' in s ? { default: s.default } : {}), ...(s.minimum !== undefined ? { min: s.minimum } : {}), ...(s.maximum !== undefined ? { max: s.maximum } : {}), ...(s.description ? { describe: s.description } : {}) }]));

export async function catalog() {
  const found = await kitModuleFiles();
  const out = { kit: { name: 'gf-three', version: KIT_VERSION }, fair: { defaults: { ...FAIR_DEFAULTS }, does: FAIR_DESCRIBE, config: 'config/game.json → fair (fair.* slots); off only when the creator asks' }, mechanics: [], worlds: [], bodies: [], looks: [], props: [], clips: [], spec: {} };
  // mechanics
  for (const id of Object.keys(PLANNED)) {
    if (!found.mechanics.includes(id)) { out.mechanics.push({ id, status: `planned (${PLANNED_BY[id] ?? 'track K2'}; not built yet: never in a spec, list it in v1.notYet)`, describe: PLANNED[id], examples: [], params: {} }); continue; }
    const m = await importKitModule(join(KIT, `mechanics/${id}/index.js`));
    if (m.error) { out.mechanics.push({ id, status: `module does not import: ${m.error.message.split('\n')[0]}`, describe: PLANNED[id], examples: [], params: {} }); continue; }
    out.mechanics.push({ id, status: 'ready', describe: m.describe ?? PLANNED[id], examples: m.examples ?? [], params: summarizeParams(m.params) });
  }
  for (const id of found.mechanics) if (!PLANNED[id]) { const m = await importKitModule(join(KIT, `mechanics/${id}/index.js`)); out.mechanics.push({ id, status: m.error ? 'does not import' : 'ready', describe: m.describe ?? '', examples: m.examples ?? [], params: summarizeParams(m.params) }); }
  // worlds
  const tdir = join(KIT, 'world/templates');
  const templates = existsSync(tdir) ? (await readdir(tdir)).filter(f => f.endsWith('.json')).sort() : [];
  const gen = await import('../kit/world/generate.js');
  for (const f of templates) {
    const t = await readJson(join(tdir, f)); if (!t) continue;
    // each size class as a game of that size gets it (the spec's world.size); the seed is the title's, so rooms vary
    const sizes = Object.fromEntries(gen.SIZES.map(k => { const L = gen.generateLayout(t, { size: k }); return [k, { size: L.size, area: L.size[0] * L.size[1], rooms: (L.rooms ?? []).map(r => r.label), entries: (L.entries ?? []).map(e => e.name), zones: Object.keys(L.zones ?? {}), ceiling: L.ceiling?.height ?? null }]; }));
    const small = gen.generateLayout(t, { size: 'small' });
    out.worlds.push({ id: t.template ?? f.replace(/\.json$/, ''), label: t.label ?? '', describe: t.describe ?? '', kind: t.kind ?? 'outdoor', setPieces: t.setPieces ?? [], size: small.size, spawns: small.spawns?.length ?? 0, zones: Object.keys(small.zones ?? {}), props: [...new Set((small.props ?? []).map(p => p.prop))].length, sizes });
  }
  out.worldSizes = Object.fromEntries(gen.SIZES.map(k => [k, { area: gen.SIZE_CLASSES[k].area, describe: gen.SIZE_CLASSES[k].describe }]));
  for (const id of ['backyard', 'office', 'plaza', 'arena']) if (!out.worlds.some(w => w.id === id)) out.worlds.push({ id, label: id, describe: 'stand-in: a flat ground with the spec\'s props placed (track L\'s template is not in yet)', size: null, spawns: 0, zones: ['centre'], props: 0, standin: true });
  // bodies (track E: tags to match a game's theme; `playerColour` when the kit tints the body per seat)
  const bodies = await readJson(join(LIBRARY, 'bodies.json'));
  // a body the model judge fails (a clip distorts its hands, face, …; bodies.json → judge) is not offered
  if (bodies) for (const b of (Array.isArray(bodies) ? bodies : bodies.bodies ?? []).filter(b => b.judge?.ok !== false)) out.bodies.push({ id: b.id, label: b.label ?? b.id, describe: b.describe ?? '', from: b.from ?? null, tags: b.tags ?? [], height: b.height ?? null, playerColour: (b.tint ?? []).length > 0, file: b.file });
  else if (existsSync(join(LIBRARY, 'bodies'))) for (const f of (await readdir(join(LIBRARY, 'bodies'))).filter(x => x.endsWith('.glb')).sort()) out.bodies.push({ id: f.replace(/\.glb$/, ''), describe: '', file: `bodies/${f}`, note: 'library/bodies.json is not written yet' });
  out.bodies.push({ id: 'generate', describe: 'a new body from a sentence ({from: "generate", prompt}); tools/meshy-character.mjs, about 6 min and 41 credits, in parallel with the build', from: 'generate' });
  out.bodies.push({ id: 'reference', describe: 'a body from the creator\'s attached image ({from: "reference", reference: <revisionId>}; the character\'s describe says what to keep); same cost as generate', from: 'reference' });
  out.bodyGuide = BODY_GUIDE;
  // looks
  const look = found.look ? await importKitModule(join(KIT, 'look/look.js')) : null;
  const presets = look && !look.error ? look.presets : (await importKitModule(join(KIT, 'core/standins/look.js'))).presets;
  for (const [id, p] of Object.entries(presets ?? {})) out.looks.push({ id, label: p.label ?? id, describe: p.describe ?? (look ? '' : 'stand-in values (track L\'s preset is not in yet)'), times: look?.TIMES ?? ['day', 'golden', 'night'] });
  // props
  const props = await readJson(join(LIBRARY, 'props.json'));
  for (const p of props?.props ?? []) out.props.push({ id: p.id, describe: p.describe ?? '', tags: p.tags ?? [], size: p.size ?? null });
  // clips
  const ch = found.character ? await importKitModule(join(KIT, 'character/character.js')) : null;
  out.clips = (ch && !ch.error && ch.CLIPS) || (await importKitModule(join(KIT, 'core/standins/character.js'))).CLIPS;
  // the melee clips the standard clip file carries since 2026-10-08 (RIG.md §4; track C), for the melee mechanic
  const rig = await importKitModule(join(KIT, 'character/rig.js'));
  if (!rig.error && Array.isArray(rig.MELEE_CLIPS)) out.clips = [...new Set([...out.clips, ...rig.MELEE_CLIPS])];
  // the engines (CONTRACT §8): party is this kit's own look and world; scenic is research/gf-scenic/kit's
  for (const w of out.worlds) w.engine = 'party';
  for (const l of out.looks) l.engine = 'party';
  const scenic = await scenicCatalog();
  out.worlds.push(...scenic.worlds); out.looks.push(...scenic.looks);
  for (const b of scenic.bodies) if (!out.bodies.some(x => x.id === b.id)) out.bodies.splice(out.bodies.length - 2, 0, b);
  for (const p of scenic.props) if (!out.props.some(x => x.id === p.id)) out.props.push(p);
  out.engines = {
    party: { id: 'party', kit: `gf-three ${KIT_VERSION}`, for: 'silly party games with friends', look: 'jelly-pastel, toon-lowpoly or soft-stylised; flat lots and buildings', camera: 'third', cameras: ['third', 'first', 'top', 'follow'], worlds: out.worlds.filter(w => w.engine === 'party').map(w => w.id), looks: out.looks.filter(l => l.engine === 'party').map(l => l.id), status: 'ready' },
    scenic: { id: 'scenic', kit: `gf-scenic ${SCENIC_VERSION}`, bodies: scenic.bodies.map(b => b.id), props: scenic.props.map(p => p.id), for: 'serious, scenic and action games: adventure, roguelite, brawler, exploration, survival, RPG-like', look: 'stylised scenic 3D: living grass and trees, water, fog, day and night, bloom; a three-quarter diorama camera', camera: 'follow', cameras: ['follow', 'third'], worlds: scenic.worlds.map(w => w.id), looks: scenic.looks.map(l => l.id), status: scenic.status, ...(scenic.note ? { note: scenic.note } : {}) },
  };
  // the forge engine (research/rust-engine/PLAN.md, CONTRACT §8 forge): its own world, look and data tables
  const forge = await forgeCatalog();
  out.worlds.push(...forge.worlds); out.looks.push(...forge.looks);
  out.engines.forge = forge.engine;
  out.engineGuide = ENGINE_GUIDE;
  // a world (CONTRACT §9): not a round but a place that stays; either engine's look draws it
  out.worldGames = {
    for: 'a place people build in or hang out in, not a match: a block sandbox players change together and come back to; it opens straight from a post on X',
    spec: { round: { mode: 'world' }, camera: 'first', world: { template: 'voxel', voxel: '(optional) terrain: {seed, radius, hills, trees, lake, plaza: {signText}}, hotbar, paint' }, mechanics: ['build', 'shove'] },
    does: 'First person (camera "orbit" for third person). A generated island everyone shares; place, break and paint blocks, signs (filtered), boom blocks; saved on the play host; up to 8 at once, the host can change; no rounds, scores, bots or results',
    example: 'research/worlds/spec-blockhaven.json',
  };
  // what a spec can say
  const schema = await readJson(SPEC_SCHEMA);
  out.spec = { cameras: schema.properties.camera.enum, players: { min: 1, max: schema.properties.players.properties.max.maximum }, roundSeconds: [schema.properties.round.properties.seconds.minimum, schema.properties.round.properties.seconds.maximum], bodyFrom: schema.properties.characters.items.properties.body.properties.from.enum, propFrom: ['library', 'generate'] };
  return out;
}

/** The scenic engine's worlds, looks and bodies (research/gf-scenic): what its look and world modules export, its library. */
async function scenicCatalog() {
  const out = { worlds: [], looks: [], bodies: [], props: [], status: 'ready', note: null };
  const world = await importKitModule(join(SCENIC_KIT, 'world/world.js'));
  const look = await importKitModule(join(SCENIC_KIT, 'look/look.js'));
  if (world.error || look.error) { out.status = 'does not import'; out.note = (world.error ?? look.error).message.split('\n')[0]; return out; }
  for (const id of world.templates ?? []) {
    const info = world.templateInfo?.[id] ?? SCENIC_WORLDS[id] ?? {};
    out.worlds.push({ id, engine: 'scenic', label: info.label ?? id, describe: info.describe ?? '', kind: info.kind ?? 'outdoor', levels: id === 'isles' || id === 'dungeon' ? 'one island or room set per level (the levels mechanic)' : 'one place', sizes: Object.fromEntries(Object.entries(world.SIZE_RADIUS ?? {}).map(([k, r]) => [k, { radius: r, area: Math.round(Math.PI * r * r) }])) });
  }
  for (const [id, p] of Object.entries(look.presets ?? {})) out.looks.push({ id, engine: 'scenic', label: p.label ?? id, describe: p.describe ?? '', times: look.TIMES ?? ['day', 'golden', 'dusk', 'night'] });
  // the scenic art library (track C; tools/lib/char-library.mjs): KayKit bodies on gf-humanoid-1, which create resolves
  // by id on either engine, and its props (weapons with a grip, dungeon pieces)
  const lib = await readJson(join(SCENIC, 'library/bodies.json'));
  for (const b of (Array.isArray(lib) ? lib : lib?.bodies ?? []).filter(b => b.judge?.ok !== false)) out.bodies.push({ id: b.id, label: b.label ?? b.id, describe: b.describe ?? '', from: b.from ?? null, tags: b.tags ?? [], height: b.height ?? null, playerColour: (b.tint ?? []).length > 0, file: b.file, library: 'scenic' });
  const props = await readJson(join(SCENIC, 'library/props.json'));
  for (const p of props?.props ?? []) out.props.push({ id: p.id, describe: p.describe ?? '', tags: p.tags ?? [], size: p.size ?? null, ...(p.kind ? { kind: p.kind } : {}), ...(p.hands ? { hands: p.hands } : {}), library: 'scenic' });
  return out;
}

/**
 * The forge engine (research/gf-forge): its world, look, camera, the bodies friends see, and its data tables (spec.forge)
 * with what each runs today (tables/index.js RUNS, which tracks F and A update as their systems land).
 */
// The forge engine is offered to creators' pitches only once the creator opens it (research/rust-engine/PLAN.md §7: they
// play the wave 2 game first; §9: the WebGL2 build before any public forge game). Until then its status is not `ready`,
// which the pitch checker refuses with this reason (studio-worker/tools/check-honesty.mjs engineErrors). GF_FORGE_OPEN=1
// offers it: the tests, the evals and our own forge pitch runs set it. `create`, `verify` and `upgrade` never read this.
export const FORGE_OPEN = process.env.GF_FORGE_OPEN === '1';
const FORGE_CLOSED = 'not open yet (gf-forge is still being built: never a card until the catalog says ready)';
async function forgeCatalog() {
  const engine = { id: 'forge', kit: `gf-forge ${FORGE_VERSION}`, for: 'first-person and close-camera action with weight: shooters, dark roguelite runs, survival nights, arena fights; co-op for 2-4 friends who see each other', look: 'dark retro first person: a cold moon, fog and fire light, bloom, square texels and grain (moonlit-ruins, ember-crypt, ash-storm); every model, texture and value a slot', camera: 'first', cameras: ['first'], worlds: [], looks: [], status: FORGE_OPEN ? 'ready' : FORGE_CLOSED,
    note: 'WebGPU only until its WebGL2 build (track W): Chrome, Edge, Chrome on Android, Safari 26+; not inside a post on X yet. No mechanic modules: its play is spec.forge (the data tables) and rules.js (commands in, events out; prompts/build.md)',
    multiplayer: 'live co-op for 2-4: the host\'s core owns the world and replays each friend\'s inputs; each player moves at once on their own screen (predicted) and sees the others as a hunter in their colour (one body a seat), holding their weapon',
    tables: {}, bodies: ['the four co-op hunters, one a seat: hooded, templar, rogue, witchfinder (what friends see; their cloth takes the player\'s colour)', 'enemies: the grim skeletons by archetype (chaser, caster, soldier, brute, lord), holding their weapons'] };
  const worlds = [], looks = [];
  try {
    const world = await importKitModule(join(FORGE_KIT, 'world.js')), look = await importKitModule(join(FORGE_KIT, 'look.js')), tables = await importKitModule(join(FORGE_KIT, 'tables/index.js'));
    for (const id of world.templates ?? []) { const info = FORGE_WORLDS[id] ?? {}; worlds.push({ id, engine: 'forge', label: info.label ?? id, describe: info.describe ?? '', kind: info.kind ?? 'indoor', sizes: Object.fromEntries(Object.entries(world.WORLD_SIZES?.[id] ?? world.SIZES ?? {}).map(([k, n]) => [k, { size: [n * (world.TILE ?? 3), n * (world.TILE ?? 3)] }])) }); }
    for (const [id, p] of Object.entries(look.presets ?? {})) { const info = FORGE_LOOKS[id] ?? {}; looks.push({ id, engine: 'forge', label: p.label ?? info.label ?? id, describe: p.describe ?? info.describe ?? '', times: ['night'] }); }
    for (const [t, r] of Object.entries(tables.RUNS ?? {})) engine.tables[t] = { runs: r.now ?? null, notYet: r.notYet ?? null };
    const W = tables.weapons ?? {}, E = tables.enemies ?? {}, C = tables.cards ?? {};
    engine.tables.weapons && Object.assign(engine.tables.weapons, { kinds: W.KINDS ?? [], presets: ['pistol', 'shotgun', 'repeater', 'blade'] });
    engine.tables.enemies && Object.assign(engine.tables.enemies, { archetypes: E.ARCHETYPES ?? [] });
    engine.tables.cards && Object.assign(engine.tables.cards, { rarities: C.RARITIES ?? [] });
    engine.tablesHow = 'spec.forge = {player, weapons: [{id, preset | kind, …}], enemies: [{id, archetype, …}], waves: [{id, enemies: [{type, count}]}], cards: [{id, rarity, stat, add}]}; every value a slot; node research/gf-forge/tools/tables.mjs <spec> checks one (create refuses what the core cannot do)';
  } catch (e) { engine.status = `does not import: ${e.message.split('\n')[0]}`; }
  engine.worlds = worlds.map(w => w.id); engine.looks = looks.map(l => l.id);
  return { engine, worlds, looks };
}

/** One engine's catalog: the shared parts and that engine's worlds, looks and cameras. */
export function forEngine(c, engine) {
  if (!c.engines?.[engine]) throw new Error(`no engine "${engine}" (${Object.keys(c.engines ?? {}).join(', ')})`);
  return { ...c, engines: { [engine]: c.engines[engine] }, worlds: c.worlds.filter(w => w.engine === engine), looks: c.looks.filter(l => l.engine === engine), spec: { ...c.spec, cameras: c.engines[engine].cameras } };
}

if (isMain(import.meta)) {
  const ei = process.argv.indexOf('--engine');
  let c = await catalog();
  if (ei > 0) { try { c = forEngine(c, process.argv[ei + 1]); } catch (e) { console.error(`catalog: ${e.message}`); process.exit(2); } }
  // no process.exit: piped output larger than the pipe buffer must drain first
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(c, null, 2) + '\n');
  else print(c);
}
function print(c) {
  console.log(`gf-three ${c.kit.version}: what the kit offers\n`);
  console.log(`FAIR PLAY (every game, on by default; ${c.fair.config})\n  ${Object.entries(c.fair.defaults).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}\n${c.fair.does.map(d => `  - ${d}`).join('\n')}\n`);
  if (c.engines) {
    console.log('ENGINES (spec.engine; how to pick: engineGuide below)');
    for (const e of Object.values(c.engines)) console.log(`  ${e.id.padEnd(8)} ${e.kit}${e.status === 'ready' ? '' : ` [${e.status}]`}: ${e.for}\n${' '.repeat(11)}look: ${e.look}\n${' '.repeat(11)}worlds ${e.worlds.join(', ')} · looks ${e.looks.join(', ')} · cameras ${e.cameras.join(', ')} (usually ${e.camera})`);
    console.log(`  how to pick (* the checker enforces):\n${c.engineGuide.map(g => `    ${g}`).join('\n')}\n`);
  }
  console.log('MECHANICS');
  for (const m of c.mechanics) console.log(`  ${m.id.padEnd(11)} ${m.status === 'ready' ? '' : `[${m.status}] `}${m.describe}${m.examples.length ? `\n${' '.repeat(14)}as: ${m.examples.join(' · ')}` : ''}${Object.keys(m.params).length ? `\n${' '.repeat(14)}params: ${Object.entries(m.params).map(([k, p]) => `${k}${'default' in p ? `=${JSON.stringify(p.default)}` : ''}`).join(', ')}` : ''}`);
  console.log('\nWORLDS');
  for (const w of c.worlds) {
    console.log(`  ${w.id.padEnd(11)} ${w.label ? `${w.label}: ` : ''}${w.describe}${w.kind ? ` [${w.kind}]` : ''}${w.engine ? ` (${w.engine})` : ''}`);
    for (const [k, z] of Object.entries(w.sizes ?? {})) console.log(`${' '.repeat(14)}${k.padEnd(7)} ${z.size ? `${z.size.join(' x ')} m` : `radius ${z.radius} m`}${z.rooms?.length ? `, rooms: ${z.rooms.join(', ')}` : ''}${z.entries?.length ? `; enemies come in at ${z.entries.join(', ')}` : ''}`);
    if (w.setPieces?.length) console.log(`${' '.repeat(14)}set-pieces: ${w.setPieces.join('; ')}`);
  }
  if (c.worldSizes) console.log(`  world.size: ${Object.entries(c.worldSizes).map(([k, v]) => `${k} ${v.area[0]}–${v.area[1]} m² (${v.describe})`).join(' · ')}`);
  console.log('\nLOOKS');
  for (const l of c.looks) console.log(`  ${l.id.padEnd(14)} ${l.label}${l.describe ? `: ${l.describe}` : ''} (${l.times.join(', ')})${l.engine ? ` (${l.engine})` : ''}`);
  console.log('\nBODIES');
  for (const b of c.bodies) console.log(`  ${b.id.padEnd(28)} ${b.describe}${b.tags?.length ? `\n${' '.repeat(31)}tags: ${b.tags.join(', ')}` : ''}`);
  if (c.bodyGuide) console.log(`  how to pick (* the checker enforces):\n${c.bodyGuide.map(g => `    ${g}`).join('\n')}`);
  console.log(`\nPROPS (${c.props.length})\n  ${c.props.map(p => p.id).join(', ')}`);
  console.log(`\nCLIPS\n  ${c.clips.join(', ')}`);
  console.log(`\nSPEC  cameras ${c.spec.cameras.join('/')} · players 1–${c.spec.players.max} · round ${c.spec.roundSeconds.join('–')} s · body from ${c.spec.bodyFrom.join('/')}`);
}
