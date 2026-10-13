#!/usr/bin/env node
// gf-three catalog: what the kit offers, for the pitch agent and for builders.
//
//   node research/gf-three/tools/catalog.mjs [--json] [--engine party|scenic|forge|flat|vista]
//
// loops      how a game is played (spec.loop; open builder M4-B): a timed round, a level run, a world that stays, and the
//            ones the session cannot run yet, each `ready` or planned, with how a pitch picks one (loopGuide)
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
import { KIT, LIBRARY, KIT_VERSION, SPEC_SCHEMA, SCENIC, SCENIC_KIT, SCENIC_VERSION, FORGE_KIT, FORGE_VERSION, VISTA_KIT, VISTA_VERSION } from './lib/paths.mjs';
import { importKitModule } from './lib/kit-import.mjs';
import { withDefaults } from './lib/schema.mjs';
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

// ---------------------------------------------------------------------------------------------------------------------
// Parts carry their own (open builder M2-B). A mechanic is one folder, kit/mechanics/<id>/, and everything the tools
// know about it is `export const manifest` in its index.js: adding a mechanic adds a folder and changes no tool.
// The shape follows GDevelop's behaviour declarations (research/open-builder/findings/gdevelop-behaviours-2026-10-10.md):
// needs as parts and capabilities, a resource a part claims in place of a hand-written conflicts list, the state a
// check reads derived from the part's own declaration.
// ---------------------------------------------------------------------------------------------------------------------
export const MANIFEST = {
  id: 'the folder\'s name', examples: 'the `as` lines a pitch may use', params: 'JSON Schema of config/game.json → mechanics[…].params, with defaults',
  describe: 'one line for the catalog', rank: '(optional) where the catalog lists it: lower first; a part without one comes after, by id',
  engines: 'the engines it runs on (party, scenic); create refuses it on another',
  needs: '{parts: [{id, why}], world: [{id, why}]} or params => that: other mechanics and world capabilities it cannot work without; create refuses a spec that lacks one, with the why',
  uses: 'mechanics it works with when the game has them (never refused)',
  owns: 'params => [{res, why, free, shared?}]: the resources it claims (input.<action>, player.socket.<name>, player.control, round.end, hud.scoreboard); create refuses two owners of one resource unless every claim on it is shared, and says how each lets go (free)',
  state: '{key, fields}: its key in window.__game.snapshot().shared (null when it keeps none) and how to read each field',
  events: '[{name, on, args, when}]: the callbacks rules.js can hook, who hears them and with what',
  sync: '{owner: host | copy | none, how}: which copy decides',
  note: 'at most three lines for the build agent, read only by builds whose spec uses the part',
  stub: '{as, worked, traps}: its variable in rules.js, one worked line, its own traps; create writes rules.js from these and `events`',
  asks: '(optional) [{about: "body" | "together", why}]: what a pitch must ask the creator when their words do not settle it and a card uses this part (a board with no player body asks how each player is shown); held by the pitch step (loop/pitch-rules.mjs), never by a build',
  signs: '{sample: (shared, stats) => {key: compact} | null, judge: view => void, reportOnly?}: verify check 15\'s sign of life. sample runs in the page 4 times a second (an arrow function that uses nothing outside itself); judge reads the samples in Node and adds its items',
  items: '(optional) [declaration]: its things as data (kit/assets/items.js; open builder wave 10). A table: {key (the param holding the list), noun, nouns, min, max, id, name, schema (JSON Schema of ONE entry: each field\'s title, type, minimum, maximum, unit, default), front (the fields a card shows first), picture: {field, file, slot, library}, defaults: {party, scenic}}; its slot mechanic.<id>.<key> is a json slot carrying the declaration. A single item: {single: true, noun, fields: [param keys], front, picture: params => slot id}',
};
/** The kit an engine id runs on: a flat (2D) game is the party kit on a plane (kit/flat), so a mechanic or a flow that
 *  runs on party runs there as far as the kit is concerned; which mechanics have been RUN on a plane is the flat part's
 *  own list (kit/flat/index.js manifest.runs), held by create. */
export const kitEngineOf = e => (e === 'flat' || e == null ? 'party' : e);
const RESOURCE_RE = /^(input\.(key\.)?[A-Za-z0-9]+|player\.socket\.[a-z_]+|player\.control|round\.end|hud\.[a-z]+)$/;

/** The mechanic folders of a kit: every kit/mechanics/<id>/index.js, sorted. */
export async function mechanicIds(kit = KIT) {
  const dir = join(kit, 'mechanics');
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() && /^[a-z0-9-]+$/.test(e.name) && existsSync(join(dir, e.name, 'index.js'))).map(e => e.name).sort();
}

/** What is wrong with a manifest's shape (empty when it is whole). */
export function manifestProblems(id, m) {
  const bad = [], isFn = f => typeof f === 'function', lines = a => Array.isArray(a) && a.every(s => typeof s === 'string' && s.trim());
  if (!m || typeof m !== 'object') return [`mechanic ${id}: index.js exports no manifest`];
  if (m.id !== id) bad.push(`manifest.id is "${m.id}", the folder is "${id}"`);
  if (typeof m.describe !== 'string' || !m.describe.trim()) bad.push('describe: one line');
  if (!Array.isArray(m.engines) || !m.engines.length || m.engines.some(e => !['party', 'scenic', 'forge', 'vista'].includes(e))) bad.push('engines: a list of party, scenic, forge, vista');
  if (!(isFn(m.needs) || (m.needs && typeof m.needs === 'object'))) bad.push('needs: {parts, world} or params => that');
  if (!Array.isArray(m.uses)) bad.push('uses: a list of mechanic ids');
  if (!isFn(m.owns)) bad.push('owns: params => [{res, why, free}]');
  if (!m.state || typeof m.state !== 'object' || !('key' in m.state) || typeof m.state.fields !== 'object') bad.push('state: {key, fields}');
  if (!Array.isArray(m.events) || m.events.some(e => !/^on[A-Z]\w*$/.test(e?.name ?? '') || !e.on || typeof e.args !== 'string')) bad.push('events: [{name: "onX", on, args, when}]');
  if (!['host', 'copy', 'none'].includes(m.sync?.owner) || typeof m.sync?.how !== 'string') bad.push('sync: {owner: host | copy | none, how}');
  if (!lines(m.note) || m.note.length < 1 || m.note.length > 3) bad.push('note: one to three lines');
  if (!/^[a-z][A-Za-z0-9]*$/.test(m.stub?.as ?? '') || typeof m.stub?.worked !== 'string' || /\n/.test(m.stub.worked) || !lines(m.stub?.traps) || !m.stub.traps.length) bad.push('stub: {as, worked (one line), traps}');
  if (!isFn(m.signs?.sample) || !isFn(m.signs?.judge)) bad.push('signs: {sample, judge}');
  else { try { new Function(`return (${m.signs.sample.toString()});`); } catch { bad.push('signs.sample: an arrow function that stands alone (it is sent to the page as text)'); } }
  if (m.items !== undefined) for (const [k, it] of (Array.isArray(m.items) ? m.items : [null]).entries()) {
    const at = `items[${k}]`;
    if (!it || typeof it !== 'object' || typeof it.noun !== 'string') { bad.push(`${at}: {noun, ...}`); continue; }
    if (it.single) { if (!Array.isArray(it.fields) || it.fields.some(f => !(f in (m.params?.properties ?? {})))) bad.push(`${at}.fields: param keys of this mechanic`); continue; }
    if (typeof it.key !== 'string' || !m.params?.properties?.[it.key]) bad.push(`${at}.key: the param that holds the table`);
    if (!it.schema || typeof it.schema !== 'object') bad.push(`${at}.schema: the JSON Schema of one entry`);
    if (it.front !== undefined && !Array.isArray(it.front)) bad.push(`${at}.front: a list of fields`);
  }
  if (isFn(m.owns) && m.params) { try { for (const o of m.owns(withDefaults(m.params, {})) ?? []) if (!RESOURCE_RE.test(o?.res ?? '') || !o.why || !o.free) bad.push(`owns: "${o?.res}" needs a known resource name, why and free`); } catch (e) { bad.push(`owns throws: ${e.message}`); } }
  return bad.map(b => `mechanic ${id}: manifest ${b}`);
}

/**
 * Every mechanic of a kit with its module and manifest: [{id, status, module, manifest, problems}]. status is 'ready',
 * or why it is not (does not import; no manifest; the manifest's faults). `kit` is a kit folder (the default is this one).
 */
export async function mechanicParts({ kit = KIT } = {}) {
  const out = [];
  for (const id of await mechanicIds(kit)) {
    const m = await importKitModule(join(kit, `mechanics/${id}/index.js`));
    if (m.error) { out.push({ id, status: `module does not import: ${m.error.message.split('\n')[0]}`, module: null, manifest: null, problems: [] }); continue; }
    const problems = m.manifest ? manifestProblems(id, m.manifest) : [];
    out.push({ id, status: typeof m.create !== 'function' || m.id !== id ? 'lacks id/create' : !m.manifest ? 'ready (no manifest: create composes it unchecked and check 15 has no sign for it)' : problems.length ? `manifest: ${problems.join('; ')}` : 'ready', module: m, manifest: m.manifest ?? null, problems });
  }
  const rank = p => (Number.isFinite(p.manifest?.rank) ? p.manifest.rank : Infinity);
  return out.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
}

/** A part's needs and claims for one game's params (defaults filled): {needs: {parts, world}, owns: [{res, why, free, shared}]}. */
export function partFor(part, params = {}) {
  const m = part?.manifest; if (!m) return { needs: { parts: [], world: [] }, owns: [] };
  const p = withDefaults(m.params ?? part.module?.params ?? {}, params ?? {});
  const needs = typeof m.needs === 'function' ? m.needs(p) : m.needs ?? {};
  const norm = l => (l ?? []).map(x => (typeof x === 'string' ? { id: x, why: '' } : x));
  return { needs: { parts: norm(needs.parts), world: norm(needs.world) }, owns: (m.owns?.(p) ?? []).map(o => ({ shared: false, ...o })) };
}

/**
 * Does this set of mechanics compose? spec.mechanics ([{id, params}]) against the parts' manifests, the engine and what
 * the world provides (a list of capabilities, or null when the world is not known: then no world need is judged).
 * → the refusals, each with its cause and the way out. A mechanic without a manifest is not judged.
 */
export function composeProblems(mechanics = [], parts = [], { engine: asked = 'party', world = null, worldId = '' } = {}) {
  const engine = kitEngineOf(asked);
  const byId = new Map(parts.map(p => [p.id, p])), ids = new Set(mechanics.map(m => m.id)), out = [], claims = new Map();
  for (const m of mechanics) {
    const part = byId.get(m.id); if (!part?.manifest) continue;
    const man = part.manifest, f = partFor(part, m.params);
    if (Array.isArray(man.engines) && !man.engines.includes(engine)) out.push(`mechanics: "${m.id}" does not run on the ${engine} engine (it runs on ${man.engines.join(', ')}): pick one of those engines or leave it out`);
    for (const n of f.needs.parts) if (!ids.has(n.id)) out.push(`mechanics: "${m.id}" needs the "${n.id}" mechanic${n.why ? ` (${n.why})` : ''}: add {"id": "${n.id}"} to mechanics, or change ${m.id}'s params`);
    if (world) for (const n of f.needs.world) if (!world.includes(n.id)) out.push(`mechanics: "${m.id}" needs a world that provides "${n.id}"${n.why ? ` (${n.why})` : ''}, and world.template "${worldId}" provides ${world.length ? world.join(', ') : 'none of the capabilities it lists'}: pick a world that does, or leave ${m.id} out`);
    for (const o of f.owns) { if (!claims.has(o.res)) claims.set(o.res, []); if (!claims.get(o.res).some(c => c.id === m.id)) claims.get(o.res).push({ id: m.id, ...o }); }
  }
  for (const [res, list] of claims) {
    if (list.length < 2 || list.every(c => c.shared)) continue;
    out.push(`mechanics: ${list.map(c => `"${c.id}"`).join(' and ')} both own ${res} (${list.map(c => `${c.id}: ${c.why}`).join('; ')}). One must let go: ${list.map(c => `${c.id}: ${c.free}`).join('; or ')}`);
  }
  return out;
}

/** A part as the catalog lists it (JSON): the manifest without its functions; needs and owns at the default params. */
function partEntry(part) {
  const m = part.manifest, mod = part.module;
  const base = { id: part.id, status: part.status, describe: m?.describe ?? mod?.describe ?? '', examples: m?.examples ?? mod?.examples ?? [], params: summarizeParams(m?.params ?? mod?.params) };
  if (!m) return base;
  const f = partFor(part, {});
  return { ...base, engines: m.engines ?? [], needs: f.needs, uses: m.uses ?? [], owns: f.owns.map(o => ({ res: o.res, ...(o.shared ? { shared: true } : {}), why: o.why, free: o.free })),
    state: { key: m.state?.key ?? null, fields: m.state?.fields ?? {}, ...(m.state?.stats ? { stats: m.state.stats } : {}) }, events: m.events ?? [], sync: m.sync ?? null, note: m.note ?? [],
    stub: m.stub ?? null, ...(Array.isArray(m.asks) && m.asks.length ? { asks: m.asks } : {}), sign: typeof m.signs?.judge === 'function' ? (m.signs.reportOnly ? 'reported' : 'checked') : 'none' };
}

/**
 * What each world template provides to the mechanics (its capabilities): the party recipes' zones and entries (read
 * from the recipe itself, kit/world/templates/<id>.json, expanded), the voxel world's `voxel`, a scenic template's own
 * templateInfo (research/gf-scenic/kit/world/generate.js). → { id: {engine, provides: [capability]} }
 */
export async function worldParts({ kit = KIT, scenicKit = SCENIC_KIT } = {}) {
  const out = {};
  const tdir = join(kit, 'world/templates');
  if (existsSync(tdir)) {
    const gen = await importKitModule(join(kit, 'world/generate.js'));
    for (const f of (await readdir(tdir)).filter(x => x.endsWith('.json')).sort()) {
      const t = await readJson(join(tdir, f)); if (!t || gen.error) continue;
      const L = gen.generateLayout(t, { size: 'small' });
      out[t.template ?? f.replace(/\.json$/, '')] = { engine: 'party', provides: [...Object.keys(L.zones ?? {}).map(z => `zone:${z}`), ...((L.entries ?? []).length ? ['entries'] : []), ...((L.rooms ?? []).length ? ['rooms'] : [])] };
    }
  }
  if (existsSync(join(kit, 'world/voxel/default.json'))) out.voxel = { engine: 'any', provides: ['voxel'] };
  const sw = existsSync(join(scenicKit, 'world/generate.js')) ? await importKitModule(join(scenicKit, 'world/generate.js')) : null;
  if (sw && !sw.error) for (const id of sw.templates ?? []) out[id] = { engine: 'scenic', provides: sw.templateInfo?.[id]?.provides ?? [] };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Loops: how a game is played (open builder M4-B). Apart from the engine (which draws it) and the mechanics (what you
// do): how things move and who acts when. The list is what the kit's session can run today (kit/net/session.js: the
// round, and round.mode "world"; the levels mechanic's run inside a round) plus what M4-C (session flow as data) adds.
// No status is written here: each loop's `ready` looks at the kit it is given. A loop whose flow is a part (M4-C,
// session flow as data: kit/loops/<id>/index.js with a manifest, LOOP_MANIFEST below) is ready when the kit carries
// that part whole, planned when it does not carry it, and says the manifest's faults otherwise (flowParts, flowStatus).
// The timed round is the first such part (kit/loops/round), which `round` and `run` play; a world is a mode of the
// session, not a flow.
// The pitch step holds a pitch to the loops (research/gf-three/loop/pitch-rules.mjs); `create` refuses a spec on a loop
// that is not ready or whose shape is another loop's (loopProblems).
// ---------------------------------------------------------------------------------------------------------------------
const mechReady = (parts, id) => /^ready/.test(parts.find(p => p.id === id)?.status ?? '');
const hasMech = (spec, id) => (spec?.mechanics ?? []).some(m => m?.id === id);
const flowPart = (kit, id) => existsSync(join(kit, 'loops', id, 'index.js'));

// A flow carries its own, like a mechanic (MANIFEST above), in kit/loops/<id>/index.js → `export const manifest`.
export const LOOP_MANIFEST = {
  id: 'the folder\'s name', params: 'JSON Schema of config/game.json → round.params (spec.round.params), with defaults; each is a round.* value slot',
  describe: 'one line for the catalog', engines: 'the engines it runs on; create refuses it on another',
  seconds: '"required" (round.seconds is the length of a round) or "cap" (round.seconds is optional: a cap on the whole session)',
  seats: '{alone: "fill" | "min", late: "join" | "wait", why}: how many bots play with one person (every seat up to players.max, or the fewest the game needs: players.min - 1), and what happens to a seat that arrives mid-game',
  needs: '{parts: [{id, why}], world: [{id, why}]}: mechanics and world capabilities it cannot work without',
  uses: '(optional) mechanics it joins when the game has them (turns joins a board: kit/loops/turns/board.js)',
  refuse: '(optional) spec => [reason with the way out]: what create refuses in a spec on this loop (two owners of one clock)',
  state: '{key, fields}: its key in window.__game.snapshot().shared (null when it keeps none) and how to read each field',
  events: '[{name, on, args, when}]: the rules.js hooks it calls (a hook\'s name, not onX: they are hooks of the rules object)',
  sync: '{owner: host | copy | none, how}: which copy decides',
  note: 'at most three lines for the build agent, read only by builds whose spec uses the loop',
  stub: 'null (the six hooks every rules.js has are its own), or {as, worked, traps, joined?}: (joined: the one line the stub carries instead when the spec has a mechanic the flow `uses`) ctx.<as> in rules.js, one worked line, its own traps; create writes its hooks into rules.js from these and `events`',
  signs: '{sample, judge}: verify check 15\'s sign of life, as a mechanic\'s; pulse: null or {what, min, of: snapshot => number, fix}: what "something happens" is for check 12 (null: a score that moves); pressed: (before, after) => boolean, optional: what a press that reached the flow looks like, for check 13 when no mechanic exposes anything to walk to; short: seconds => [patch]: what a check changes beside round.seconds for its short run',
};
/** What is wrong with a flow manifest's shape (empty when it is whole). */
export function flowProblems(id, m) {
  const bad = [], isFn = f => typeof f === 'function', lines = a => Array.isArray(a) && a.every(x => typeof x === 'string' && x.trim());
  if (!m || typeof m !== 'object') return [`loop ${id}: index.js exports no manifest`];
  if (m.id !== id) bad.push(`manifest.id is "${m.id}", the folder is "${id}"`);
  if (typeof m.describe !== 'string' || !m.describe.trim()) bad.push('describe: one line');
  if (!Array.isArray(m.engines) || !m.engines.length || m.engines.some(e => !['party', 'scenic', 'forge', 'vista'].includes(e))) bad.push('engines: a list of party, scenic, forge, vista');
  if (!['required', 'cap'].includes(m.seconds)) bad.push('seconds: "required" or "cap"');
  if (!['fill', 'min'].includes(m.seats?.alone) || !['join', 'wait'].includes(m.seats?.late) || typeof m.seats?.why !== 'string') bad.push('seats: {alone: fill | min, late: join | wait, why}');
  if (!m.needs || typeof m.needs !== 'object') bad.push('needs: {parts, world}');
  if (!m.state || typeof m.state !== 'object' || !('key' in m.state) || typeof m.state.fields !== 'object') bad.push('state: {key, fields}');
  if (!Array.isArray(m.events) || m.events.some(e => !/^[a-z]\w*$/.test(e?.name ?? '') || !e.on || typeof e.args !== 'string')) bad.push('events: [{name: a rules hook, on, args, when}]');
  if (!['host', 'copy', 'none'].includes(m.sync?.owner) || typeof m.sync?.how !== 'string') bad.push('sync: {owner: host | copy | none, how}');
  if (!lines(m.note) || m.note.length < 1 || m.note.length > 3) bad.push('note: one to three lines');
  if (m.stub !== null && (!/^[a-z][A-Za-z0-9]*$/.test(m.stub?.as ?? '') || typeof m.stub?.worked !== 'string' || /\n/.test(m.stub.worked) || !lines(m.stub?.traps) || !m.stub.traps.length)) bad.push('stub: null, or {as, worked (one line), traps}');
  if (!isFn(m.signs?.sample) || !isFn(m.signs?.judge)) bad.push('signs: {sample, judge}');
  else { try { new Function(`return (${m.signs.sample.toString()});`); } catch { bad.push('signs.sample: an arrow function that stands alone (it is sent to the page as text)'); } }
  if (m.signs && m.signs.pulse != null && (!isFn(m.signs.pulse.of) || !Number.isFinite(m.signs.pulse.min) || typeof m.signs.pulse.what !== 'string' || typeof m.signs.pulse.fix !== 'string')) bad.push('signs.pulse: null, or {what, min, of, fix}');
  if (m.signs && !isFn(m.signs.short)) bad.push('signs.short: seconds => [patch]');
  if (m.signs?.pressed != null && !isFn(m.signs.pressed)) bad.push('signs.pressed: (before, after) => boolean');
  return bad.map(b => `loop ${id}: manifest ${b}`);
}
/** The flow folders of a kit: every kit/loops/<id>/index.js, with its module and manifest: [{id, status, module, manifest, problems}]. */
export async function flowParts({ kit = KIT } = {}) {
  const dir = join(kit, 'loops'), out = [];
  if (!existsSync(dir)) return out;
  for (const e of (await readdir(dir, { withFileTypes: true })).filter(x => x.isDirectory() && /^[a-z0-9-]+$/.test(x.name) && flowPart(kit, x.name)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const m = await importKitModule(join(dir, e.name, 'index.js'));
    if (m.error) { out.push({ id: e.name, status: `module does not import: ${m.error.message.split('\n')[0]}`, module: null, manifest: null, problems: [] }); continue; }
    const problems = flowProblems(e.name, m.manifest);
    out.push({ id: e.name, status: typeof m.create !== 'function' || m.id !== e.name ? 'lacks id/create' : problems.length ? `manifest: ${problems.join('; ')}` : 'ready', module: m, manifest: m.manifest ?? null, problems });
  }
  return out;
}
/** The flow a loop is played by: its own part, the timed round's (round, run), or none (a world is a mode of the session). */
export const flowOf = loop => (loop === 'world' ? null : loop === 'run' || loop == null ? 'round' : loop);
/** A flow part as the catalog lists it (JSON): the manifest without its functions. */
function flowEntry(part) {
  const m = part?.manifest; if (!m) return null;
  return { id: part.id, params: summarizeParams(m.params), seconds: m.seconds, seats: m.seats, needs: m.needs, state: m.state, events: m.events, sync: m.sync, note: m.note, stub: m.stub,
    sign: { alive: 'checked', pulse: m.signs?.pulse ? m.signs.pulse.what : 'a score that moves', pressed: typeof m.signs?.pressed === 'function' ? 'the flow\'s own' : 'any change of state' } };
}
const PLANNED = 'planned (the kit carries no flow for it: kit/loops/<id>)';
const PLANNED_SAVED = 'planned (it needs the play host to keep each player\'s progress: kit/loops/README.md, "saved")';
/** A loop whose flow is a part: ready when the kit carries that part whole. */
const flowStatus = (flows, id) => { const f = flows.find(x => x.id === id); return !f ? PLANNED : f.status === 'ready' ? null : `not ready: the ${id} flow (kit/loops/${id}): ${f.status}`; };
const LOOP_DEFS = [
  { id: 'round', label: 'a timed round', describe: 'everyone plays at once in one timed round: lobby, countdown, play, results, play again',
    pick: 'things move all the time and every player acts at the same moment; one clock for everyone, then a winner',
    spec: 'round.seconds (30-900), round.winBy; the mechanics are what you do during it', engines: ['party', 'scenic', 'forge', 'vista'],
    ready: ({ kit, flows }) => (!existsSync(join(kit, 'net/session.js')) ? 'not ready: the kit has no session (kit/net/session.js)' : flows.some(f => f.id === 'round') ? flowStatus(flows, 'round') : null),
    shape: spec => (spec.round?.mode === 'world' ? 'round.mode is "world", which is the loop "world"' : hasMech(spec, 'levels') ? 'the spec has the levels mechanic, which is the loop "run"' : null) },
  { id: 'run', label: 'a level run', describe: 'a run through levels in order: clear one and a portal takes everyone to the next; the last level, or a boss, ends it (one clock for the whole run)',
    pick: 'the players go through places in order and the game is over at the end of the last one',
    spec: 'the levels mechanic (boss for a boss at the end, loot between levels); a world with a place per level (isles, dungeon); round.seconds for the whole run', engines: ['party', 'scenic'],
    ready: ({ parts }) => (mechReady(parts, 'levels') ? null : 'not ready: the levels mechanic is not ready'),
    shape: spec => (spec.round?.mode === 'world' ? 'round.mode is "world", which is the loop "world"' : hasMech(spec, 'levels') ? null : 'a run needs the levels mechanic in the spec') },
  { id: 'world', label: 'a world that stays', describe: 'no rounds: one shared place, saved on the play host, that players drop in and out of; no clock, no score, no bots, no results',
    pick: 'nothing ends and nobody wins: people come back to what they left (a block sandbox, a hangout)',
    spec: 'round.mode "world", world.template "voxel", the build mechanic (shove beside it); camera first or orbit', engines: ['party'],
    ready: ({ kit, parts }) => (!existsSync(join(kit, 'world/voxel/default.json')) ? 'not ready: the kit has no voxel world' : mechReady(parts, 'build') ? null : 'not ready: the build mechanic is not ready'),
    shape: spec => (spec.round?.mode !== 'world' ? 'a world needs round.mode "world" (and world.template "voxel")' : spec.world?.template !== 'voxel' ? `a world needs world.template "voxel" (this one is "${spec.world?.template}")` : null) },
  { id: 'turns', label: 'taking turns', describe: 'one player acts at a time, in order; nothing moves between turns; a clock for each turn',
    pick: 'only one player may act at a time: board and card games, puzzles played in moves',
    spec: 'round.params {turnSeconds, first, late}; round.seconds is optional (a cap on the whole game); the rules give move(ctx, player, move), or a mechanic that plays its own moves (board) joins the flow', flow: true,
    shape: spec => (spec.round?.mode === 'world' ? 'round.mode is "world", which is the loop "world"' : hasMech(spec, 'levels') ? 'the spec has the levels mechanic, which is the loop "run"' : null) },
  { id: 'match', label: 'a match of several rounds', describe: 'short rounds that reset, with the wins counted: first to N, or best of N',
    pick: 'the same short round is played again and again and the rounds won are the score',
    spec: 'round.seconds is one round\'s length (30-900); round.params {rounds, winsToWin, between}', flow: true,
    shape: spec => (spec.round?.mode === 'world' ? 'round.mode is "world", which is the loop "world"' : hasMech(spec, 'levels') ? 'the spec has the levels mechanic, which is the loop "run"' : null) },
  { id: 'endless', label: 'a session with no end', describe: 'no clock and no last level: it goes on until everyone has fallen or leaves, and the score only grows',
    pick: 'it ends only when the players lose or stop',
    spec: 'no round.seconds (it is a cap when given); the rules end it in check(ctx)', flow: true,
    shape: spec => (spec.round?.mode === 'world' ? 'round.mode is "world", which is the loop "world"' : hasMech(spec, 'levels') ? 'the spec has the levels mechanic, which is the loop "run"' : null) },
  { id: 'saved', label: 'progress that is saved', describe: 'what a player earned is still there next time: pets, money, upgrades, a town',
    pick: 'the fun is coming back to what you built up: idle, tycoon, collecting and life-sim games', planned: PLANNED_SAVED },
];
/** How a pitch picks the loop. The pitch step (loop/pitch-rules.mjs) enforces the starred lines. */
const LOOP_GUIDE = [
  'pick the loop before the engine and the cards, by how things move and who acts when in the creator\'s idea, not by its theme',
  '* every card\'s spec says its loop, and it is a ready one; the spec has that loop\'s shape (loops[].spec)',
  '* the pitch says which loop the idea needs (play.loop.wants): a ready one, a planned one, or "none" when none of them is how the idea is played',
  '* when that loop is planned or none fits: play.loop.closest is the ready loop card 1 uses, play.loop.lost says what the creator loses, the reply starts with it and names the closest loop in plain words, and card 1 lists it in v1.notYet. A planned loop is never pitched as if it were ready',
];

/**
 * The loops of a kit, each with its status ('ready', or why not): [{id, label, status, describe, pick, spec, engines,
 * flow, part}]. `flow` is the flow part that plays it (kit/loops/<flow>; none for a world) and `part` that part as the
 * catalog lists it (its params, seats, hooks, note, stub and signs), when the kit carries it.
 */
export async function loopParts({ kit = KIT, parts = null, flows = null } = {}) {
  const P = parts ?? await mechanicParts({ kit }), F = flows ?? await flowParts({ kit });
  return LOOP_DEFS.map(d => {
    const why = d.ready ? d.ready({ kit, parts: P, flows: F }) : d.planned ?? flowStatus(F, d.id);
    const flow = d.planned ? null : flowOf(d.id), part = flow ? F.find(f => f.id === flow && f.manifest) ?? null : null;
    const engines = d.engines ?? (d.flow ? part?.manifest?.engines : null);
    return { id: d.id, label: d.label, status: why ?? 'ready', describe: d.describe, pick: d.pick, ...(d.spec ? { spec: d.spec } : {}), ...(engines ? { engines } : {}),
      ...(flow && part ? { flow, part: flowEntry(part) } : {}) };
  });
}
/** The loop a spec plays: the one it names, else the one its shape is (a spec written before the field existed). */
export const loopOf = spec => spec?.loop ?? (spec?.round?.mode === 'world' ? 'world' : hasMech(spec, 'levels') ? 'run' : 'round');
/**
 * A spec's loop against the kit's loops (loopParts, or catalog.json → loops): a loop the catalog does not have, one that
 * is not ready, one its engine cannot run, a spec shaped like another loop. `require`: the spec must name its loop (a
 * pitch card); without it a spec that names none is not judged. → ['loop: …']
 */
export function loopProblems(spec, loops, { require = false } = {}) {
  if (!Array.isArray(loops) || !loops.length || !spec) return [];
  const isReady = l => /^ready/.test(l.status ?? ''), ready = loops.filter(isReady).map(l => l.id);
  const list = `ready: ${ready.join(', ')}; not built yet: ${loops.filter(l => !isReady(l)).map(l => l.id).join(', ') || 'none'}`;
  if (spec.loop == null) return require ? [`loop: say how this game is played, one of the kit's loops (${list}; catalog.json → loops, loopGuide)`] : [];
  const L = loops.find(l => l.id === spec.loop);
  if (!L) return [`loop: "${spec.loop}" is not a loop in the catalog (${list})`];
  if (!isReady(L)) return [`loop: "${L.id}" (${L.label}) is ${String(L.status).split(/[:(]/)[0].trim()}, not built yet: a spec uses a ready loop (${ready.join(', ')}). Pick the closest one and say what is lost (in a pitch: play.loop.closest and lost, and card 1's v1.notYet)`];
  const out = [], engine = kitEngineOf(spec.engine);
  if (Array.isArray(L.engines) && !L.engines.includes(engine)) out.push(`loop: "${L.id}" (${L.label}) does not run on the ${engine} engine (it runs on ${L.engines.join(', ')})`);
  const shape = LOOP_DEFS.find(d => d.id === L.id)?.shape?.(spec);
  if (shape) out.push(`loop: "${L.id}" (${L.label}), but ${shape}. Its shape: ${L.spec}`);
  return out;
}

// How a pitch picks the engine (research/gf-scenic/PLAN.md §0; creator, 2026-10-08: "I think the current kit has its
// charm for silly games. I think we should keep this for more serious and scenic type games"). The checker
// (studio-worker/tools/check-v2.mjs) enforces the starred lines.
const ENGINE_GUIDE = [
  'party (gf-three): silly party games with friends: pranks, chaos, slapstick, friendslop, crude humour; jelly-bean or toon looks, flat lots and buildings',
  'scenic (gf-scenic): serious, scenic or action games: adventure, roguelite, brawler, dungeon crawler, hack and slash, exploration, survival, RPG-like; anything that names a serious game; reference images that look like polished 3D art',
  'forge (gf-forge): first-person or close-camera action with weight: a shooter, a dark roguelite run, survival nights, arena fights; the feel of a modern FPS (a Rust core on WebGPU); co-op for 2-4. Its play is the data tables (spec.forge: weapons, enemies, waves, cards) and rules.js, not mechanic modules',
  'flat (gf-three on a plane, kit/flat): a 2D game: the creator says 2D, pixel art, sprite, retro, side-scroller, platformer or top-down, or names a 2D game; also a grid or board seen from above with a cursor each. Pick its `plane` (engines.flat.planes: top or side) and a look in the art style asked for (pixel unless they say drawn, cartoon, hand-drawn or vector)',
  '* a flat spec says its `plane`; its camera is that plane\'s (top or side), its world is field (top) or stage (side), every body is {from: "sprite"}, and it lists only mechanics run on that plane (engines.flat.mechanics.<plane>): create refuses anything else, and what the idea needs beyond them goes in v1.notYet',
  'when unsure, scenic for anything that is not silly',
  'vista (gf-vista): calm games where the place is the point: a coast, the sea, the sky, light and weather; fishing, sailing, exploring, cozy co-op for 1-4 who see each other on one island. The engine for a creator who asks for a photoreal, realistic, lifelike or beautiful world, real water, a real sky or sunset, or names a game known for its sea and light, when the game is calm (no combat): vista over scenic then. A vendored WebGPU core (WebGPU only, a desktop browser). Its play is the core\'s walking, swimming, boat and fishing, the data tables (spec.vista: species, gear, vendors, economy, start) and rules.js, not mechanic modules',
  '* vista is never a card for a game meant to open inside a post on X (or another in-app browser), or for a phone: it draws only with WebGPU on a desktop graphics card',
  '* a vista spec lists no mechanic and no world.props; its world.template is palm-isle (the core\'s island, the only vista world), its camera first, its look one of engines.vista.looks; its `characters` is one role, the player, with body {from: "bean"} (friends see the kit\'s bodies); a vista card promises only what engines.vista.has lists and puts what the idea needs beyond it (engines.vista.cannot) in v1.notYet',
  '* a vista game is our own design in our own words: no vista card\'s spec names an existing game (not even the one the creator named) or its people and places; the buyer and the shop get generic names of our own (spec.vista.vendors)',
  '* forge is never a card for a game meant to open inside a post on X (or another in-app browser) yet: it draws with WebGPU, or with its WebGL2 build where there is none (since wave 3), and that build has not been run inside an in-app browser or on a phone (research/rust-engine/PLAN.md §10)',
  '* a forge spec lists no mechanic; a forge card promises only what its tables run today (catalog.json → engines.forge.tables: a table whose `runs` is null goes in v1.notYet)',
  '* a forge game is our own design in our own words: no forge card\'s spec or conceptPrompt names an existing game, not even the one the creator named (leave the spec\'s `prompt` out), and nothing in it is named after that game\'s places, weapons, enemies or cards; the name stays in `research` and `similar`',
  '* a forge spec\'s `characters` is one role, the player, with body {from: "bean", why: "the forge engine draws its own hunters"}: friends see the kit\'s hunters and the enemies are spec.forge.enemies rows; no generated, reference or library body, and no generated prop (engines.forge.spec, .props, .cannot)',
  'a forge card says what forge cannot do yet in v1.notYet when the idea needs it (engines.forge.cannot), and never promises it',
  '* every card\'s spec says its engine; its world.template, look.preset and camera are that engine\'s (engines.<id>)',
  '* a prompt that names a serious genre (roguelike, brawler, dungeon crawler, hack and slash, RPG, adventure, survival …) and nothing silly gets scenic on card 1, or forge when it is first-person action',
];
// The scenic worlds in words, for a scenic kit whose world module does not describe its own yet (templateInfo in
// research/gf-scenic/kit/world/generate.js, which the catalog reads first).
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
  'town-street': { label: 'Town street', kind: 'outdoor', describe: 'a gaslit old-town street at night generated from world.seed: wet cobbles 9 m wide and 30, 36 or 42 m long that open into a small square at the middle (21 by 12, 27 by 18 or 33 by 18 m), timber-framed and brick house fronts on both sides with lit windows and shop signs, gas lamps, four side alleys, a barricade at one end and iron railings in fog at the other, roofs and a church tower past the houses; carts, barrels, crates and a market stall for cover; enemies come up from cellar hatches and street drains. The thing to guard stands in the middle of the square: name it "pump" for the town pump' },
};
const FORGE_LOOKS = {
  'moonlit-ruins': { label: 'Moonlit ruins', describe: 'a cold moon with shadows, teal fog, warm fires and bloom, square texels and grain: the ruins arena\'s look' },
  'ember-crypt': { label: 'Ember crypt', describe: 'dark red fog and red-orange fire light: the crypt room\'s look' },
  'ash-storm': { label: 'Ash storm', describe: 'a dim sun through falling ash, thick warm fog' },
  'gaslit-street': { label: 'Gaslit street', describe: 'warm, nearly steady gas light in pools on wet cobbles under a cold high moon, slate-blue fog that thins the far end of a street, lit windows that glow, square texels and grain: the town street\'s look' },
};
const readJson = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
const summarizeParams = schema => Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([k, s]) => [k, { type: s.type ?? (s.enum ? 'enum' : '?'), ...(s.enum ? { enum: s.enum } : {}), ...('default' in s ? { default: s.default } : {}), ...(s.minimum !== undefined ? { min: s.minimum } : {}), ...(s.maximum !== undefined ? { max: s.maximum } : {}), ...(s.description ? { describe: s.description } : {}) }]));

export async function catalog({ kit = KIT } = {}) {
  const found = await kitModuleFiles();
  const out = { kit: { name: 'gf-three', version: KIT_VERSION }, fair: { defaults: { ...FAIR_DEFAULTS }, does: FAIR_DESCRIBE, config: 'config/game.json → fair (fair.* slots); off only when the creator asks' }, mechanics: [], worlds: [], bodies: [], looks: [], props: [], clips: [], spec: {} };
  // mechanics: every folder under kit/mechanics, each as its own manifest describes it (no table here)
  for (const part of await mechanicParts({ kit })) out.mechanics.push(partEntry(part));
  out.mechanicFields = MANIFEST;
  // worlds
  const provides = await worldParts({ kit });
  const tdir = join(kit, 'world/templates');
  const templates = existsSync(tdir) ? (await readdir(tdir)).filter(f => f.endsWith('.json')).sort() : [];
  const gen = await import('../kit/world/generate.js');
  for (const f of templates) {
    const t = await readJson(join(tdir, f)); if (!t) continue;
    // each size class as a game of that size gets it (the spec's world.size); the seed is the title's, so rooms vary
    const sizes = Object.fromEntries(gen.SIZES.map(k => { const L = gen.generateLayout(t, { size: k }); return [k, { size: L.size, area: L.size[0] * L.size[1], rooms: (L.rooms ?? []).map(r => r.label), entries: (L.entries ?? []).map(e => e.name), zones: Object.keys(L.zones ?? {}), ceiling: L.ceiling?.height ?? null }]; }));
    const small = gen.generateLayout(t, { size: 'small' });
    out.worlds.push({ id: t.template ?? f.replace(/\.json$/, ''), label: t.label ?? '', describe: t.describe ?? '', kind: t.kind ?? 'outdoor', setPieces: t.setPieces ?? [], size: small.size, spawns: small.spawns?.length ?? 0, zones: Object.keys(small.zones ?? {}), props: [...new Set((small.props ?? []).map(p => p.prop))].length, sizes, provides: provides[t.template ?? f.replace(/\.json$/, '')]?.provides ?? [] });
  }
  // the block world (CONTRACT §9): a catalog world since M4-B (the build mechanic needs "a world with voxel" and no engine
  // listed one: research/open-builder/findings/gauntlet-2026-10-11.md, finding 2). Party only: create refuses it on scenic.
  if (provides.voxel) out.worlds.push({ id: 'voxel', label: 'Block world', describe: 'a generated block island everyone shares and changes (place, break and paint blocks), saved on the play host. Only for the loop "world" (round.mode "world", the build mechanic): never a timed round. world.voxel tunes the terrain (seed, radius, hills, trees, lake)', kind: 'outdoor', setPieces: [], size: null, spawns: 0, zones: [], props: 0, sizes: {}, provides: provides.voxel.provides, loop: 'world' });
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
    party: { id: 'party', kit: `gf-three ${KIT_VERSION}`, for: 'silly party games with friends', look: 'jelly-pastel, toon-lowpoly or soft-stylised; flat lots and buildings', camera: 'third', cameras: ['third', 'first', 'top', 'follow', 'orbit'], worlds: out.worlds.filter(w => w.engine === 'party').map(w => w.id), looks: out.looks.filter(l => l.engine === 'party').map(l => l.id), status: 'ready' },
    scenic: { id: 'scenic', kit: `gf-scenic ${SCENIC_VERSION}`, bodies: scenic.bodies.map(b => b.id), props: scenic.props.map(p => p.id), for: 'serious, scenic and action games: adventure, roguelite, brawler, exploration, survival, RPG-like', look: 'stylised scenic 3D: living grass and trees, water, fog, day and night, bloom; a three-quarter diorama camera', camera: 'follow', cameras: ['follow', 'third'], worlds: scenic.worlds.map(w => w.id), looks: scenic.looks.map(l => l.id), status: scenic.status, ...(scenic.note ? { note: scenic.note } : {}) },
  };
  // the forge engine (research/rust-engine/PLAN.md, CONTRACT §8 forge): its own world, look and data tables
  const forge = await forgeCatalog();
  out.worlds.push(...forge.worlds); out.looks.push(...forge.looks);
  out.engines.forge = forge.engine;
  // the flat (2D) engine (kit/flat): the party kit on a plane. Its planes, worlds, looks, cameras and the mechanics run
  // on each plane are the part's own manifest; nothing about it is listed here by hand.
  const flat = await flatCatalog({ kit });
  if (flat) { out.worlds.push(...flat.worlds); out.looks.push(...flat.looks); out.engines.flat = flat.engine; }
  // the vista engine (research/super-scenic/PLAN.md, CONTRACT §8 vista): the core's island, its looks, its data tables
  const vista = await vistaCatalog();
  out.worlds.push(...vista.worlds); out.looks.push(...vista.looks);
  out.engines.vista = vista.engine;
  out.engineGuide = ENGINE_GUIDE;
  // how a game is played, apart from the engine (M4-B): what the session runs today, and what is planned
  out.loops = await loopParts({ kit });
  out.loopGuide = LOOP_GUIDE;
  // a world (CONTRACT §9): not a round but a place that stays; either engine's look draws it
  out.worldGames = {
    for: 'a place people build in or hang out in, not a match: a block sandbox players change together and come back to; it opens straight from a post on X',
    spec: { loop: 'world', engine: 'party', round: { mode: 'world' }, camera: 'first', world: { template: 'voxel', voxel: '(optional) terrain: {seed, radius, hills, trees, lake, plaza: {signText}}, hotbar, paint' }, mechanics: ['build', 'shove'] },
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
    out.worlds.push({ id, engine: 'scenic', label: info.label ?? id, describe: info.describe ?? '', kind: info.kind ?? 'outdoor', levels: info.levels ?? (id === 'isles' || id === 'dungeon' ? 'one island or room set per level (the levels mechanic)' : 'one place'), provides: info.provides ?? [], sizes: Object.fromEntries(Object.entries(world.SIZE_RADIUS ?? {}).map(([k, r]) => [k, { radius: r, area: Math.round(Math.PI * r * r) }])) });
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
  const engine = { id: 'forge', kit: `gf-forge ${FORGE_VERSION}`, for: 'first-person and close-camera action with weight: shooters, dark roguelite runs, survival nights, arena fights; co-op for 2-4 friends who see each other', look: 'dark retro first person: a cold moon, fog and fire light, bloom, square texels and grain (moonlit-ruins, ember-crypt, ash-storm, gaslit-street); every model, texture and value a slot', camera: 'first', cameras: ['first'], worlds: [], looks: [], status: FORGE_OPEN ? 'ready' : FORGE_CLOSED,
    note: 'WebGPU where the browser has it (Chrome, Edge, Chrome on Android, Safari 26+), else its WebGL2 build (wave 3; not yet run on a phone or inside an in-app browser); not inside a post on X yet. No mechanic modules: its play is spec.forge (the data tables) and rules.js (commands in, events out; prompts/build.md)',
    multiplayer: 'live co-op for 2-4: the host\'s core owns the world and replays each friend\'s inputs; each player moves at once on their own screen (predicted) and sees the others as a hunter in their colour (one body a seat), holding their weapon',
    tables: {}, bodies: ['the four co-op hunters, one a seat: hooded, templar, rogue, witchfinder (what friends see; their cloth takes the player\'s colour)', 'enemies: two sets by archetype, chosen by each enemy row\'s `body`: the grim skeletons (skeleton-grim-chaser, skeleton-grim-caster, skeleton-grim-soldier, skeleton-grim-brute, skeleton-grim-lord; the default) and the risen townsfolk, zombie-like (zombie-shambler for a chaser, zombie-sprinter for a runner, zombie-spitter for a caster, zombie-bulwark for a shield, zombie-butcher for a brute, zombie-mayor for a boss), each holding its own things'],
    // what a forge spec looks like beside the tables (the worked example: research/gf-forge/specs/vigil.spec.json), and
    // what the engine cannot do yet, so no pitch promises it (wave 3, track S3; the checker holds the starred guide lines)
    spec: {
      players: '{min: 1, max: 2-4, bots: false, teams: 0, mode: "coop"}: co-op only; a friends round has no bots',
      round: 'seconds: the longest a run may last (600-900 for three waves and a boss; the rules end it when the run is won or everyone has fallen); winBy and loseBy in plain words',
      controls: '{jump, primary: "fire"} and, for 2-4 players, interact: "raise a fallen friend (hold)". Nothing else: create adds the engine\'s own keys to How to play (Shift evades, R reloads, V is a quick melee, the number keys pick a weapon); secondary (right click) does nothing yet, so never list it',
      characters: '[{role: "player", describe: …, body: {from: "bean", why: "the forge engine draws its own hunters"}}] and no other role',
      props: 'world.props: one, the thing the players guard, named "chest" ({name: "chest", describe, role: "what you guard"}); in a town-street name it "pump" (the town pump in the middle of the square)',
      example: 'research/gf-forge/specs/vigil.spec.json',
    },
    props: ['chest (the forge library\'s iron-bound reliquary: the thing to guard; verify looks for it on screen at the start)', 'pump (the forge library\'s town pump: a stone pillar with an iron handle, a trough and a bucket; the thing to guard in a town-street)'],
    cannot: [
      'more than one place: no levels, rooms to clear, doors, portals, a second map or a shop (one arena a game: crypt-room, ruins-arena or town-street)',
      'any camera but first person; versus or teams (players cannot hurt each other: co-op for 2-4 only)',
      'the party and scenic mechanics (pickups to carry, stations, paint, races, a base with health to defend): the play is the tables and rules.js',
      'new bodies or props made for the game: the players are the kit\'s four hunters, the enemies one of the library\'s two sets in six archetypes, the grim skeletons or the risen townsfolk (a row renames and retunes one and names its `body`), the prop a library piece',
      'an alternate fire (right click), thrown things, grenades, vehicles, mounts, building',
      'spending coins (they are counted, nothing is sold); a reward after the last wave (cards are dealt after any earlier wave marked "reward")',
      'playing inside a post on X (its WebGL2 build has not been run in an in-app browser yet)',
    ] };
  const worlds = [], looks = [];
  try {
    const world = await importKitModule(join(FORGE_KIT, 'world.js')), look = await importKitModule(join(FORGE_KIT, 'look.js')), tables = await importKitModule(join(FORGE_KIT, 'tables/index.js'));
    for (const id of world.templates ?? []) { const info = FORGE_WORLDS[id] ?? {}; worlds.push({ id, engine: 'forge', label: info.label ?? id, describe: info.describe ?? '', kind: info.kind ?? 'indoor', sizes: Object.fromEntries(Object.entries(world.WORLD_SIZES?.[id] ?? world.SIZES ?? {}).map(([k, n]) => [k, { size: world.WORLD_FOOTPRINTS?.[id]?.[k] ?? [n * (world.TILE ?? 3), n * (world.TILE ?? 3)] }])) }); }
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

/**
 * The vista engine (research/gf-vista; research/super-scenic/THIN_E2E.md): the core's island, its six looks, first
 * person, its data tables (spec.vista) and what it has and cannot do yet, so no pitch promises more.
 */
// Offered to creators' pitches only once the creator opens it (the same rule as forge: research/super-scenic/PLAN.md §10,
// THIN_E2E "closed to creators behind GF_VISTA_OPEN=1"). Until then its status is not `ready`, which the pitch checker
// refuses with this reason. GF_VISTA_OPEN=1 offers it (the tests, the evals and our own runs); read at each call, so a
// test can open and close it. `create`, `verify` and `upgrade` never read it.
export const vistaOpen = (env = process.env) => env.GF_VISTA_OPEN === '1';
const VISTA_CLOSED = 'not open yet (gf-vista is still being built: never a card until the catalog says ready)';
export async function vistaCatalog({ env = process.env } = {}) {
  const engine = { id: 'vista', kit: `gf-vista ${VISTA_VERSION}`, for: 'calm games where the place is the point: a coast, the sea, the sky, light and weather; fishing, sailing, exploring, cozy co-op for 1-4 friends who see each other on one island',
    look: 'a physical sky and light over a simulated ocean with volumetric clouds, seen in first person: six named looks from a clear morning to a storm swell (the hour, the sea state, the exposure and the clouds, each a slot)', camera: 'first', cameras: ['first'], worlds: [], looks: [], status: vistaOpen(env) ? 'ready' : VISTA_CLOSED,
    note: 'WebGPU only, on a desktop browser with a graphics card (a browser without WebGPU shows the kit\'s "open in a browser with WebGPU" screen); the first visit compiles its shaders (about 10 s); never inside a post on X. No mechanic modules: its play is the core\'s, spec.vista (the data tables) and rules.js (events in: bite, hooked, catch, lost, sold, bought, board, leave; ctx.finish ends the session)',
    multiplayer: 'live co-op for 1-4 on one island: each player walks, swims, sails and fishes on their own copy, and sees the others as people (a gf-humanoid-1 body, one a seat, in their colour) where they really are; the host\'s copy owns the time of day, the sea state, the clock and the results',
    tables: {
      species: 'what bites, where and what it is worth: {<id>: {name, habitat: [shallows | reef | pier | bay | deep], minKg, maxKg, value}}; the ids are the core\'s swimming fish (silverside, mullet, needlefish, sergeant, grunt, yellowtail, chromis, tang, wrasse, parrot, angel, jack, barracuda, grouper, redSnapper, tuna, mahi, tarpon), the names our own',
      gear: 'what the shop sells: {<id>: {name, kind, price, <its stat>}}; kinds and their stat: line lineKg (breaking strain, kg), reel reelSpeed (how fast the line comes in), rod castM (longest cast, m), hold holdKg (cooler, kg), tank fuelL, engine speedMul, finder and lights (no stat). A spec\'s gear replaces the defaults whole, so list a price-0 starter of each kind the player needs (a line, a reel, a rod, a hold) and the upgrades above it',
      vendors: '{buyer: {name, greeting}, shop: {name, greeting}}: generic names of our own',
      economy: '{startMoney, fuelPrice}',
      start: 'pier (the pier\'s foot on the beach, looking out along the pier: the best first view, the default) | pier-head (the end of the pier, facing open sea) | beach | boat: where players begin',
    },
    tablesHow: 'spec.vista = {species, gear, vendors, economy, start}; every value a slot; research/gf-vista/kit/tables check() refuses what the core cannot do (create refuses the spec)',
    spec: {
      players: '{min: 1, max: 1-4, bots: false, mode: "coop"}: no bots; friends play together',
      round: 'seconds: the longest a session lasts (300-900); winBy in plain words (a calm goal: land N kinds of fish, earn an amount); the rules end it at the goal with ctx.finish, the clock otherwise',
      controls: '{primary: "cast, strike and reel", interact: "board the boat, trade at a stall"}: the core\'s own keys (R takes out the rod; How to play lists them)',
      characters: '[{role: "player", describe, body: {from: "bean"}}] and no other role',
      world: '{template: "palm-isle"} and no props',
    },
    has: ['one island in the open sea (palm-isle): a sandy bay, a long pier, a fishing village, palms, rocks, a reef and open ocean', 'walking, swimming, diving and a boat to take out', 'wildlife that lives on its own: a humpback whale that cruises the deep water, blows and breaches, fish on the reef, gulls, crabs', 'fishing: casting, bites, the catch, a cooler, a fish buyer and a tackle shop (spec.vista)', 'six looks from a clear morning to a storm swell', 'friends on the same island who see each other'],
    cannot: [
      'any world but the core\'s island (no coast of our own, no second map, no levels or rooms)',
      'any camera but first person',
      'enemies, combat, weapons, health, building, crafting or farming: it is a calm game',
      'a boat friends ride together (each player\'s boat is their own copy\'s)',
      'progress saved between sessions on the play host',
      'phones, and playing inside a post on X (WebGPU on a desktop only)',
      'new bodies or props made for the game: friends are the kit\'s bodies; the island\'s things are the core\'s',
    ],
    bodies: ['friends see each other as gf-humanoid-1 bodies from research/gf-vista/kit/bodies.json (realistic bodies, track C), else four library bodies, one a seat, in each player\'s colour'] };
  const worlds = [], looks = [];
  try {
    const C = await importKitModule(join(VISTA_KIT, 'config.js'));
    if (C.error) throw C.error;
    for (const id of C.templates ?? []) { const info = C.TEMPLATE_INFO?.[id] ?? {}; worlds.push({ id, engine: 'vista', label: info.label ?? id, describe: info.describe ?? '', kind: info.kind ?? 'outdoor', starts: Object.keys(C.PLACES ?? {}),
      // one island at every size class (spec world.size changes nothing yet: the coast generator is PLAN wave 3)
      sizes: Object.fromEntries(['small', 'medium', 'large'].map(k => [k, { size: [2048, 2048], note: 'the core\'s one island' }])) }); }
    for (const [id, p] of Object.entries(C.presets ?? {})) looks.push({ id, engine: 'vista', label: p.label ?? id, describe: p.describe ?? '', times: [p.hour < 7 || p.hour > 20 ? 'night' : p.hour > 16.5 ? 'golden' : 'day'] });
  } catch (e) { engine.status = `does not import: ${String(e?.message ?? e).split('\n')[0]}`; }
  engine.worlds = worlds.map(w => w.id); engine.looks = looks.map(l => l.id);
  return { engine, worlds, looks };
}

/** The flat (2D) engine, from kit/flat/index.js → manifest; null when the kit has no flat part. */
export async function flatCatalog({ kit = KIT } = {}) {
  if (!existsSync(join(kit, 'flat/index.js'))) return null;
  const mod = await importKitModule(join(kit, 'flat/index.js')), M = mod.manifest;
  if (mod.error || !M) return { engine: { id: 'flat', kit: `gf-three ${KIT_VERSION} (kit/flat)`, for: '2D games', status: `does not import: ${mod.error?.message.split('\n')[0] ?? 'no manifest'}`, worlds: [], looks: [], cameras: [], camera: 'top' }, worlds: [], looks: [] };
  const worlds = Object.entries(M.worlds).map(([id, w]) => ({ id, engine: 'flat', plane: w.plane, label: w.label, describe: w.describe, kind: 'outdoor', sizes: Object.fromEntries(Object.entries(w.sizes).map(([k, [c, r]]) => [k, { size: [c, r], cells: true }])) }));
  const looks = Object.entries(M.looks).map(([id, l]) => ({ id, engine: 'flat', label: l.label, describe: l.describe, style: l.style, times: ['day'] }));
  const engine = {
    id: 'flat', kit: `gf-three ${KIT_VERSION} (kit/flat, ${M.standard})`, for: '2D games: seen from above or from the side, in pixel art or drawn art, on a tile map; friends see each other as picture characters',
    look: 'pictures on a plane through a fixed camera: pixel art (hard pixels) or drawn art (smooth), chosen by the look', camera: 'top', cameras: Object.values(M.cameras), worlds: worlds.map(w => w.id), looks: looks.map(l => l.id), status: 'ready',
    planes: M.planes, styles: M.styles, mechanics: M.runs, body: M.body, map: M.map, side: M.side,
    spec: { engine: 'flat', plane: 'top | side', camera: 'the plane\'s (top | side)', world: '{template: field (top) | stage (side), size, props: pictures, map?: the level as rows of text}', characters: '[{role, describe, body: {from: "sprite"}}]', look: '{preset: one of looks}' },
    loops: 'the party kit\'s (round, turns, endless, match): a flat game is played by the same flows',
    cannot: ['a mechanic not in mechanics.<plane> (not run on a plane yet: melee, waves, boss, projectile, carry, tag, race, teams, health, shove, station, loot, levels, paint, build, panels)', 'generated or library 3D bodies and props (every body and prop is a picture slot)', 'slopes, moving platforms, more than one screen-depth layer, a camera that turns', 'bots that plan a route up the ledges (they hop)'],
  };
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
/** A mechanic's composition in words: what it needs, works with and owns, and its note. */
function partLines(m) {
  const out = [];
  if (m.needs?.parts?.length || m.needs?.world?.length) out.push(`needs: ${[...m.needs.parts.map(n => `the ${n.id} mechanic`), ...m.needs.world.map(n => `a world with ${n.id}`)].join(', ')}`);
  if (m.uses?.length) out.push(`works with: ${m.uses.join(', ')}`);
  if (m.owns?.length) out.push(`owns: ${m.owns.map(o => `${o.res}${o.shared ? ' (shared)' : ''}`).join(', ')}`);
  for (const n of m.note ?? []) out.push(`note: ${n}`);
  return out;
}
function print(c) {
  console.log(`gf-three ${c.kit.version}: what the kit offers\n`);
  console.log(`FAIR PLAY (every game, on by default; ${c.fair.config})\n  ${Object.entries(c.fair.defaults).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}\n${c.fair.does.map(d => `  - ${d}`).join('\n')}\n`);
  if (c.engines) {
    console.log('ENGINES (spec.engine; how to pick: engineGuide below)');
    for (const e of Object.values(c.engines)) console.log(`  ${e.id.padEnd(8)} ${e.kit}${e.status === 'ready' ? '' : ` [${e.status}]`}: ${e.for}\n${' '.repeat(11)}look: ${e.look}\n${' '.repeat(11)}worlds ${e.worlds.join(', ')} · looks ${e.looks.join(', ')} · cameras ${e.cameras.join(', ')} (usually ${e.camera})`);
    console.log(`  how to pick (* the checker enforces):\n${c.engineGuide.map(g => `    ${g}`).join('\n')}\n`);
  }
  if (c.loops) {
    console.log('LOOPS (spec.loop: how the game is played)');
    for (const l of c.loops) console.log(`  ${l.id.padEnd(8)} ${l.status === 'ready' ? '' : `[${l.status}] `}${l.label}: ${l.describe}\n${' '.repeat(11)}pick it when ${l.pick}${l.spec ? `\n${' '.repeat(11)}spec: ${l.spec}` : ''}`);
    console.log(`  how to pick (* the pitch step enforces):\n${c.loopGuide.map(g => `    ${g}`).join('\n')}\n`);
  }
  console.log('MECHANICS');
  for (const m of c.mechanics) console.log(`  ${m.id.padEnd(11)} ${m.status === 'ready' ? '' : `[${m.status}] `}${m.describe}${m.examples.length ? `\n${' '.repeat(14)}as: ${m.examples.join(' · ')}` : ''}${Object.keys(m.params).length ? `\n${' '.repeat(14)}params: ${Object.entries(m.params).map(([k, p]) => `${k}${'default' in p ? `=${JSON.stringify(p.default)}` : ''}`).join(', ')}` : ''}${partLines(m).map(l => `\n${' '.repeat(14)}${l}`).join('')}`);
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
