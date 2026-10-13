// gf-vista's seam to the shared system (research/super-scenic/THIN_E2E.md, track S): what a spec may name on the vista
// engine and how it becomes a game's config, with every value a slot (PLAN R1-R5). Pure and Node-safe (create, the
// catalog, the slot declarations and the tests import it; it touches no DOM and no GPU), and vendored into a game as
// gf/vista/kit/config.js, where the boot reads the same places.
//
//   templates            the worlds a vista spec may name: palm-isle (the core's island) is the only one
//   presets              the looks (kit/look.js PRESETS) with a label and a sentence each
//   CAMERAS              first person only
//   PLACES               where players start: pier, beach, boat; one seat each for up to four players
//   lookConfig(spec)     config/look.json: the preset's values, then the spec's own over them
//   worldConfig(spec)    config/world.json: the template and the start places
//   bodiesConfig(...)    config/characters.json → vista: the bodies friends see, one a seat, and the shared clips
//   slotsFor(cfg)        the slot declarations: the look values, the start place, each seat's body, the clips, the
//                        seat colours, and every value of the data tables (config/game.json → vista)
//   placeOf(world, start, seat)   where a seat stands at a start place: {x, z, yaw} (the core's walker yaw)
import { PRESETS, DEFAULT_PRESET, SEAS, LOOKS } from './look.js';

export const ENGINE = 'vista';
export const templates = ['palm-isle'];
export const TEMPLATE_INFO = {
  'palm-isle': { label: 'Palm isle', kind: 'outdoor', describe: 'one tropical island in the open sea, about 2 km across: a sandy bay with a long wooden pier and its T-shaped head, a small boat moored at the pier, a fishing village up the hill, palms and dunes, rocks, a reef to the west with fish and coral, open ocean to the south where a whale passes. A player walks, swims, dives, takes the boat out and fishes from the pier, the beach or the deck' },
};
export const CAMERAS = ['first'];

const LABELS = { 'clear-morning': 'Clear morning', 'bright-noon': 'Bright noon', 'golden-hour': 'Golden hour', 'sunset-glow': 'Sunset glow', 'moonlit-night': 'Moonlit night', 'storm-swell': 'Storm swell' };
/** The looks a spec may name: kit/look.js PRESETS, each with its words. */
export const presets = Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, { label: LABELS[id] ?? id, describe: p.why, hour: p.hour, sea: p.sea, exposure: p.exposure, ...(p.clouds !== undefined ? { clouds: p.clouds } : {}) }]));
export { DEFAULT_PRESET };

// The core's world (core/src/world/WorldLayout.js): the pier head is x 48..62, z 33..40 (its middle 55, 36.5), the boat
// is moored on its east side at x 64.5; the bay's beach runs along z ≈ -42 to -60. Walker yaw: forward is
// (-sin yaw, 0, -cos yaw), so yaw π faces +z (the sea, south).
const ring = (cx, cz, offsets, face) => offsets.map(([dx, dz]) => ({ x: cx + dx, z: cz + dz, yaw: face(cx + dx, cz + dz) }));
const facing = (tx, tz) => (x, z) => Math.atan2(-(tx - x), -(tz - z));
export const PLACES = {
  // the pier's foot: seat 1 at the island's own opening view (the core's WORLD.start: the boardwalk down to the pier
  // gate, the beach hut and boat, a stall, the surf); friends a few metres ahead on the boardwalk, facing seat 1, so each
  // sees the others the moment the round starts. Before 2026-10-12 a game started on the pier head looking at open sea
  // (the plainest view on the island; the creator: "visually this is much much worse than the original")
  pier: { label: 'The pier\'s foot', describe: 'on the beach where the boardwalk runs down to the pier, looking out along it to the sea; friends a few steps ahead, facing you', seats: [{ x: 53.6, z: -77, yaw: Math.PI }, ...[[55.6, -72], [51.6, -72], [53.6, -70]].map(([x, z]) => ({ x, z, yaw: Math.atan2(-(53.6 - x), -(-77 - z)) }))] },
  'pier-head': { label: 'The pier head', describe: 'on the T-shaped head at the end of the pier, everyone facing its middle', seats: ring(55, 36.5, [[0, -1.8], [0, 1.8], [-1.8, 0], [1.8, 0]], facing(55, 36.5)) },
  beach: { label: 'The beach', describe: 'on the sand of the bay, in a row facing the sea', seats: [-3, -1, 1, 3].map(dx => ({ x: 18 + dx, z: -60, yaw: Math.PI })) },
  boat: { label: 'Beside the boat', describe: 'on the pier head beside the moored boat (E boards it), facing the boat', seats: [[0, -1.6], [0, 0], [0, 1.6], [-1.6, 0]].map(([dx, dz]) => ({ x: 61.2 + dx, z: 36.5 + dz, yaw: -Math.PI / 2 })) },
};
export const START_DEFAULT = 'pier';

const r3 = v => Math.round(v * 1000) / 1000;
const clone = v => JSON.parse(JSON.stringify(v));

/** config/look.json: the named preset's values (hour, sea, exposure, clouds), then any the spec sets beside it. */
export function lookConfig(spec = {}) {
  const id = spec?.look?.preset ?? DEFAULT_PRESET;
  const p = PRESETS[id];
  if (!p) throw new Error(`look.preset "${id}" is not a vista look (${Object.keys(PRESETS).join(', ')})`);
  const out = { preset: id, hour: p.hour, sea: p.sea, exposure: p.exposure };
  if (p.clouds !== undefined) out.clouds = p.clouds;
  return out;
}

/** config/world.json: the one template and the start places (each seat's place: every number a slot). */
export function worldConfig(spec = {}) {
  const template = spec?.world?.template ?? templates[0];
  if (!templates.includes(template)) throw new Error(`world.template "${template}" is not a vista world (${templates.join(', ')})`);
  return { template, kind: 'vista-coast', places: Object.fromEntries(Object.entries(PLACES).map(([id, p]) => [id, { label: p.label, seats: p.seats.map(s => ({ x: r3(s.x), z: r3(s.z), yaw: r3(s.yaw) })) }])) };
}

/** Where seat `seat` stands at the start place `start` ({x, z, yaw}): the world config's, else the kit's. */
export function placeOf(world, start = START_DEFAULT, seat = 0) {
  const P = world?.places?.[start] ?? world?.places?.[START_DEFAULT] ?? clone(PLACES[start] ?? PLACES[START_DEFAULT]);
  const seats = P.seats?.length ? P.seats : PLACES[START_DEFAULT].seats;
  const s = seats[((seat % seats.length) + seats.length) % seats.length];
  // a fifth player and on: the same four seats one step further out
  const out = Math.floor(seat / seats.length) * 0.8;
  const cx = seats.reduce((a, q) => a + q.x, 0) / seats.length, cz = seats.reduce((a, q) => a + q.z, 0) / seats.length;
  const dx = s.x - cx, dz = s.z - cz, l = Math.hypot(dx, dz) || 1;
  return { x: s.x + (dx / l) * out, z: s.z + (dz / l) * out, yaw: s.yaw };
}

// ---- the bodies friends see (I4: kit/bodies.json, track C; the Quaternius bodies until it exists) ----
/** The bodies when kit/bodies.json is not there yet: the wave 1 pier sandbox's four Quaternius bodies (CC0). */
export const FALLBACK_BODIES = ['quaternius-casual-man', 'quaternius-casual-woman', 'quaternius-hoodie', 'quaternius-adventurer-woman'];
export const SEATS = 4;
export const BODY = 'character.body.player';
export const CLIPS = 'character.clips.player';
export const TINT = 'character.tint.player';
/** The body slot of a seat (0-based): seat 0 keeps `character.body.player` (forge's names). */
export const bodySlot = seat => (seat > 0 ? `${BODY}.${seat + 1}` : BODY);
export const CLIPS_FILE = 'assets/clips/gf-humanoid-1.glb';
export const bodyFile = id => `assets/bodies/${id}.glb`;

/**
 * config/characters.json → vista: {bodies: [{id, file, height}], clips} from the ids chosen for the seats (kit/bodies.json
 * `default`, else FALLBACK_BODIES) and what each body's record says (its height).
 */
export function bodiesConfig(ids, records = {}) {
  return { bodies: ids.slice(0, SEATS).map(id => ({ id, file: bodyFile(id), height: Number(records[id]?.height) > 1 ? Number(records[id].height) : 1.75 })), clips: CLIPS_FILE };
}

// ---- the slots ----
const LOOK_FILE = 'config/look.json', WORLD_FILE = 'config/world.json', GAME_FILE = 'config/game.json', CHAR_FILE = 'config/characters.json';
const esc = k => String(k).replace(/~/g, '~0').replace(/\//g, '~1');
const slotId = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const words = k => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();

/** The look values as slots (look.*): the preset's name, the hour, the sea state, the exposure and the cloud cover. */
export function lookSlots(look = {}) {
  const out = [
    { id: 'look.preset', group: 'look', label: 'Look', type: 'enum', source: { file: LOOK_FILE, pointer: '/preset' }, constraints: { options: Object.entries(presets).map(([value, p]) => ({ value, label: p.label })) }, tier: 'main', facet: 'look', rank: 80, description: 'The named look the hour, the sea and the light start from (a change here takes effect with the values below it)' },
    { id: 'look.hour', group: 'look', label: 'Time of day', type: 'number', source: { file: LOOK_FILE, pointer: '/hour' }, constraints: { min: LOOKS.hour.min, max: LOOKS.hour.max, step: 0.1, unit: 'h' }, tier: 'main', facet: 'look', rank: 79, description: 'The hour on a 24-hour clock: the sun, the sky and the light (6 dawn, 12.5 noon, 17.9 sunset, 21.5 night)' },
    { id: 'look.sea', group: 'look', label: 'Sea state', type: 'enum', source: { file: LOOK_FILE, pointer: '/sea' }, constraints: { options: Object.keys(SEAS) }, tier: 'main', facet: 'look', rank: 78, description: LOOKS.sea.why },
    { id: 'look.exposure', group: 'look', label: 'Exposure', type: 'number', source: { file: LOOK_FILE, pointer: '/exposure' }, constraints: { min: LOOKS.exposure.min, max: LOOKS.exposure.max, step: 0.1, unit: 'EV' }, tier: 'advanced', facet: 'look', rank: 30, description: LOOKS.exposure.why },
  ];
  if (look.clouds !== undefined) out.push({ id: 'look.clouds', group: 'look', label: 'Cloud cover', type: 'number', source: { file: LOOK_FILE, pointer: '/clouds' }, constraints: { min: 0, max: 1, step: 0.01 }, tier: 'advanced', facet: 'look', rank: 28, description: 'How much of the sky the cumulus fill (the most near 0.62; they thin above 0.7)' });
  return out;
}

/** The start places' seats as slots (world.place.<id>.<n>.x / z / yaw). */
export function worldSlots(world = {}) {
  const out = [];
  for (const [id, P] of Object.entries(world.places ?? {})) (P.seats ?? []).forEach((s, i) => {
    for (const k of ['x', 'z', 'yaw']) out.push({ id: `world.place.${slotId(id)}.${i + 1}.${k}`, group: 'world', label: `${P.label ?? id}, seat ${i + 1}: ${k === 'yaw' ? 'facing' : k}`, type: 'number', source: { file: WORLD_FILE, pointer: `/places/${esc(id)}/seats/${i}/${k}` }, constraints: k === 'yaw' ? { min: -6.3, max: 6.3, unit: 'rad' } : { min: -1000, max: 1000, unit: 'm' }, tier: 'advanced', facet: 'gameplay', rank: 6, description: `Where seat ${i + 1} starts ${P.label ? `at ${P.label.toLowerCase()}` : ''} (${k === 'yaw' ? 'the way they face, radians; π faces the open sea' : `metres on the island's ${k} axis`})` });
  });
  return out;
}

/** Each seat's body friends see, the clips they play and the seat colours (characters.*). */
export function bodySlots(characters = {}) {
  const out = [], v = characters.vista ?? null;
  if (Array.isArray(characters.palette)) out.push({ id: TINT, group: 'characters', label: 'Player colours (one per seat)', type: 'colors', scope: 'player', source: { file: CHAR_FILE, pointer: '/palette' }, constraints: { min: 1, max: 8 }, tier: 'main', facet: 'look', rank: 90, description: 'Each player\'s colour: their clothes as friends see them, their name tag and their name on the HUD and in the friends room' });
  if (!v) return out;
  (v.bodies ?? []).forEach((b, i) => out.push({ id: bodySlot(i), group: 'characters', label: i ? `Player body, seat ${i + 1}` : 'Player body (what friends see)', type: 'model', source: { file: b.file }, constraints: { maxBytes: 16777216, rig: 'gf-humanoid-1' }, tier: i ? 'advanced' : 'main', facet: 'look', rank: i ? 60 - i : 88,
    description: `The body other players see ${i ? `the player in seat ${i + 1}` : 'you'} as (first person: never on your own screen). A gf-humanoid-1 body; its tint materials take the player's colour`,
    generate: { prompt: 'a person in light summer clothes for a day by the sea, full body, standing', style: 'realistic proportions, natural materials, soft daylight' } }));
  if (v.clips) out.push({ id: CLIPS, group: 'characters', label: 'Player animations', type: 'model', source: { file: v.clips }, constraints: { maxBytes: 8388608, animations: ['idle', 'walk', 'run', 'sprint'] }, tier: 'advanced', facet: 'look', rank: 20, editable: false, readonlyReason: 'The shared gf-humanoid-1 clips every body plays; replaced as part of the character standard', description: 'The clips the others\' bodies play (idle, walk, run, sprint)' });
  return out;
}

/**
 * Every value of the data tables (config/game.json → vista) as a slot (vista.<path>): a word a text slot, a number a
 * number slot, a switch a boolean, a list a json slot. Names, prices and values of what a player sees first are main.
 */
export function tableSlots(vista = {}) {
  const out = [];
  const MAIN = /^(species\.[^.]+\.(name|value)|gear\.[^.]+\.(name|price)|vendors\.[^.]+\.name|economy\.startMoney)$/;
  const walk = (v, path) => {
    if (v === null || v === undefined) return;
    const dotted = path.join('.'), pointer = `/vista/${path.map(esc).join('/')}`, id = `vista.${path.map(slotId).join('.')}`.slice(0, 80);
    const label = path.map(words).join(' · ');
    const main = MAIN.test(dotted);
    const base = { id, group: 'mechanics', label: label.replace(/^./, c => c.toUpperCase()).slice(0, 80), source: { file: GAME_FILE, pointer }, tier: main ? 'main' : 'advanced', facet: typeof v === 'string' ? 'text' : 'gameplay', rank: main ? 70 : 10, description: `The game's ${label} (config/game.json → vista)` };
    if (typeof v === 'string') out.push({ ...base, type: 'text', constraints: { maxLength: path.at(-1) === 'greeting' ? 200 : 60 } });
    else if (typeof v === 'number') out.push({ ...base, type: 'number', constraints: {} });
    else if (typeof v === 'boolean') out.push({ ...base, type: 'boolean' });
    else if (Array.isArray(v)) out.push({ ...base, type: 'json' });
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  for (const [k, v] of Object.entries(vista ?? {})) walk(v, [k]);
  return out;
}

/** All of vista's slot declarations for a game's config ({look, world, characters, game}). */
export function slotsFor(cfg = {}) {
  return [...bodySlots(cfg.characters ?? {}), ...worldSlots(cfg.world ?? {}), ...lookSlots(cfg.look ?? {}), ...tableSlots(cfg.game?.vista ?? {})];
}

/** The look values a game boots with: config/look.json, with a preset's values under any the config leaves out. */
export function bootLook(look = {}) {
  const p = PRESETS[look.preset] ?? PRESETS[DEFAULT_PRESET];
  const out = { hour: look.hour ?? p.hour, sea: look.sea ?? p.sea, exposure: look.exposure ?? p.exposure };
  const clouds = look.clouds ?? p.clouds;
  if (clouds !== undefined && clouds !== null) out.clouds = clouds;
  return out;
}
