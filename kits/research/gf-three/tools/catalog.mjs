#!/usr/bin/env node
// gf-three catalog: what the kit offers, for the pitch agent and for builders.
//
//   node research/gf-three/tools/catalog.mjs [--json]
//
// mechanics  kit/mechanics/<id>/index.js: id, `examples` (the `as` lines), the params JSON Schema (wave-1 ids that
//            have no module yet are listed as planned, with PLAN §2.1's one-line description)
// worlds     the world module's templates (kit/world/templates/*.json recipes, expanded by kit/world/generate.js): label,
//            describe, indoor or outdoor, the set-pieces, and per size class (spec world.size) the footprint, rooms or
//            areas, entries (where enemies come in) and zones
// bodies     library/bodies.json (or library/bodies/*.glb while that list does not exist)
// looks      the look module's presets (id, label, describe), else the stand-in presets
// props      library/props.json (id, describe, tags, size)
// clips      the character module's CLIPS
// cameras, players and round limits from the game spec schema
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT, LIBRARY, KIT_VERSION, SPEC_SCHEMA } from './lib/paths.mjs';
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
  '* the creator attached an image and asks for a character to look like it: that role is {from: "reference"}; describe keeps outfit, accessories, colours, proportions and art style; an enemy (a mechanic\'s enemyRole) never takes a group\'s ethnic features',
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
};
const readJson = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
const summarizeParams = schema => Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([k, s]) => [k, { type: s.type ?? (s.enum ? 'enum' : '?'), ...(s.enum ? { enum: s.enum } : {}), ...('default' in s ? { default: s.default } : {}), ...(s.minimum !== undefined ? { min: s.minimum } : {}), ...(s.maximum !== undefined ? { max: s.maximum } : {}), ...(s.description ? { describe: s.description } : {}) }]));

export async function catalog() {
  const found = await kitModuleFiles();
  const out = { kit: { name: 'gf-three', version: KIT_VERSION }, fair: { defaults: { ...FAIR_DEFAULTS }, does: FAIR_DESCRIBE, config: 'config/game.json → fair (fair.* slots); off only when the creator asks' }, mechanics: [], worlds: [], bodies: [], looks: [], props: [], clips: [], spec: {} };
  // mechanics
  for (const id of Object.keys(PLANNED)) {
    if (!found.mechanics.includes(id)) { out.mechanics.push({ id, status: 'planned (track K2)', describe: PLANNED[id], examples: [], params: {} }); continue; }
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
  if (bodies) for (const b of (Array.isArray(bodies) ? bodies : bodies.bodies ?? [])) out.bodies.push({ id: b.id, label: b.label ?? b.id, describe: b.describe ?? '', from: b.from ?? null, tags: b.tags ?? [], height: b.height ?? null, playerColour: (b.tint ?? []).length > 0, file: b.file });
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
  // what a spec can say
  const schema = await readJson(SPEC_SCHEMA);
  out.spec = { cameras: schema.properties.camera.enum, players: { min: 1, max: schema.properties.players.properties.max.maximum }, roundSeconds: [schema.properties.round.properties.seconds.minimum, schema.properties.round.properties.seconds.maximum], bodyFrom: schema.properties.characters.items.properties.body.properties.from.enum, propFrom: ['library', 'generate'] };
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const c = await catalog();
  // no process.exit: piped output larger than the pipe buffer must drain first
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(c, null, 2) + '\n');
  else print(c);
}
function print(c) {
  console.log(`gf-three ${c.kit.version}: what the kit offers\n`);
  console.log(`FAIR PLAY (every game, on by default; ${c.fair.config})\n  ${Object.entries(c.fair.defaults).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}\n${c.fair.does.map(d => `  - ${d}`).join('\n')}\n`);
  console.log('MECHANICS');
  for (const m of c.mechanics) console.log(`  ${m.id.padEnd(11)} ${m.status === 'ready' ? '' : `[${m.status}] `}${m.describe}${m.examples.length ? `\n${' '.repeat(14)}as: ${m.examples.join(' · ')}` : ''}${Object.keys(m.params).length ? `\n${' '.repeat(14)}params: ${Object.entries(m.params).map(([k, p]) => `${k}${'default' in p ? `=${JSON.stringify(p.default)}` : ''}`).join(', ')}` : ''}`);
  console.log('\nWORLDS');
  for (const w of c.worlds) {
    console.log(`  ${w.id.padEnd(11)} ${w.label ? `${w.label}: ` : ''}${w.describe}${w.kind ? ` [${w.kind}]` : ''}`);
    for (const [k, z] of Object.entries(w.sizes ?? {})) console.log(`${' '.repeat(14)}${k.padEnd(7)} ${z.size.join(' x ')} m${z.rooms.length ? `, rooms: ${z.rooms.join(', ')}` : ''}${z.entries.length ? `; enemies come in at ${z.entries.join(', ')}` : ''}`);
    if (w.setPieces?.length) console.log(`${' '.repeat(14)}set-pieces: ${w.setPieces.join('; ')}`);
  }
  if (c.worldSizes) console.log(`  world.size: ${Object.entries(c.worldSizes).map(([k, v]) => `${k} ${v.area[0]}–${v.area[1]} m² (${v.describe})`).join(' · ')}`);
  console.log('\nLOOKS');
  for (const l of c.looks) console.log(`  ${l.id.padEnd(14)} ${l.label}${l.describe ? `: ${l.describe}` : ''} (${l.times.join(', ')})`);
  console.log('\nBODIES');
  for (const b of c.bodies) console.log(`  ${b.id.padEnd(28)} ${b.describe}${b.tags?.length ? `\n${' '.repeat(31)}tags: ${b.tags.join(', ')}` : ''}`);
  if (c.bodyGuide) console.log(`  how to pick (* the checker enforces):\n${c.bodyGuide.map(g => `    ${g}`).join('\n')}`);
  console.log(`\nPROPS (${c.props.length})\n  ${c.props.map(p => p.id).join(', ')}`);
  console.log(`\nCLIPS\n  ${c.clips.join(', ')}`);
  console.log(`\nSPEC  cameras ${c.spec.cameras.join('/')} · players 1–${c.spec.players.max} · round ${c.spec.roundSeconds.join('–')} s · body from ${c.spec.bodyFrom.join('/')}`);
}
