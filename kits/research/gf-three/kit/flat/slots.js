// gf-three flat: the declarations of a flat (2D) game. Pure: Node imports it (create, tools/slots.mjs, the catalog) and
// so does the page. A flat game is the same kit with four parts swapped and everything else kept:
//
//   the look        an orthographic camera, unlit pictures, one of two art STYLES (pixel, drawn)        look.js
//   the world       a tile map (tilemap.js): `field` seen from above, `stage` seen from the side        world.js
//   the body        a picture: a sheet of frames by the gf-flat-1 standard (ART-STANDARD.md)             character.js
//   the controller  the kit's own capsule and controller, with a flat camera rig in place of its rig    controller.js
//
//   plane 'top'   the ground is X-Z, the camera looks straight down, screen up is -Z, nobody jumps
//   plane 'side'  the ground is along X, gravity pulls down Y, every body stays at Z = 0, Space jumps
import { humanize } from '../core/slots.js';
import { lookSlots as valueSlots } from '../core/standins/slots.js';
import { FORMAT, KINDS, LEGENDS, SIZES, generateMap, readMap, reachOf, jumpReach } from './tilemap.js';

export const STANDARD = 'gf-flat-1';
export const PLANES = ['top', 'side'];
export const templates = { top: ['field'], side: ['stage'] };
export const cameras = { top: 'top', side: 'side' };
/** The two art styles (ART-STANDARD.md §1). ppm: texels per metre, the same for every picture of a game. */
export const STYLES = {
  pixel: { ppm: 16, cell: 32, tile: 16, cells: [16, 24, 32, 48, 64], tiles: [8, 32], props: [8, 64], hard: true },
  drawn: { ppm: 128, cell: 256, tile: 128, cells: [128, 512], tiles: [64, 256], props: [64, 512], hard: false },
};
/** A body sheet: 6 frames across, and 1 row (`turn`) or 3 (`down`, `side`, `up`). */
export const FRAMES = ['idle', 'walk1', 'walk2', 'air', 'act', 'down'];
export const ROWS = { 1: ['turn'], 3: ['down', 'side', 'up'] };
/** A standing figure fills at most this share of its cell's height, so a cell is height / FILL metres square. */
export const FILL = 0.85;
/** Side-on, what a body does (config/game.json → controller): a jump that clears two cells with room to spare. */
export const SIDE = { jump: 10.5, speed: 5.2, sprint: 7.4, fallScale: 1.7 };

// The flat looks. Each names its style. view: metres across the SHORTER side of a wide screen; portrait: metres across
// a phone held upright (side-on only: see controller.js for the rule).
export const presets = {
  'pixel-day': { label: 'Pixel day', describe: 'Pixel art under a clear sky: hard pixels, every texel a whole number of screen pixels', style: 'pixel', values: { background: '#8fd3ff', ground: '#6fb65c', view: 12, portrait: 11 } },
  'pixel-night': { label: 'Pixel night', describe: 'Pixel art at night: the same hard pixels on a deep blue', style: 'pixel', values: { background: '#1b1c3a', ground: '#23264d', view: 12, portrait: 11 } },
  'drawn-day': { label: 'Drawn day', describe: 'Drawn art, smooth at any size, on a warm paper sky', style: 'drawn', values: { background: '#cdeaf5', ground: '#84c76f', view: 12, portrait: 11 } },
  'drawn-dusk': { label: 'Drawn dusk', describe: 'Drawn art at dusk: smooth shapes on a peach and violet sky', style: 'drawn', values: { background: '#f3b9a0', ground: '#7d6aa8', view: 12, portrait: 11 } },
};
export const DEFAULT_LOOK = 'pixel-day';
export const styleOf = lookCfg => (lookCfg?.style in STYLES ? lookCfg.style : presets[lookCfg?.preset]?.style ?? 'pixel');
export const presetValues = id => JSON.parse(JSON.stringify((presets[id] ?? presets[DEFAULT_LOOK]).values));
/** config/look.json of a flat game: the preset, its style, and its values (each number and colour a look.* slot). */
export function lookConfig(id, { plane = 'top' } = {}) {
  const key = id in presets ? id : DEFAULT_LOOK, values = presetValues(key);
  // from above the picture is the ground itself: what shows past the map's edge is the ground colour, not the sky
  if (plane === 'top') { values.background = values.ground; delete values.portrait; }
  delete values.ground;
  return { preset: key, flat: plane, style: presets[key].style, standard: STANDARD, values };
}

const ART = 'tools/lib/standin-assets/flat';
export const ART_LICENSE = { spdx: 'CC0-1.0', author: 'games.fun (stand-in, research/gf-three/tools/flat-art.mjs)', url: 'https://games.fun' };
const PROP_ART = ['coin', 'gem', 'crate', 'heart', 'key', 'star'];
/** A prop's stand-in picture (kit-parent-relative): by name when the bake has it, else by what the name sounds like. */
export const propArt = (name, style = 'pixel') => `${ART}/${style}/${PROP_ART.includes(name) ? name : /coin|gold|token/.test(name) ? 'coin' : /star|point/.test(name) ? 'star' : /heart|health|heal|life/.test(name) ? 'heart' : /key/.test(name) ? 'key' : /crate|box|chest/.test(name) ? 'crate' : 'gem'}.png`;
export const bodyArt = (plane, style = 'pixel') => `${ART}/${style}/body-${plane === 'side' ? 'side' : 'top'}.png`;
export const tileArt = (kind, style = 'pixel') => `${ART}/${style}/tile-${kind}.png`;
/** The tile kinds the bake has a picture for; a kind a spec's map invents gets the nearest by what it does. */
export const TILE_ART = ['grass', 'path', 'wall', 'water', 'ground', 'brick', 'ledge'];
const tileFor = (kind, k, plane) => (TILE_ART.includes(kind) ? kind : k.solid === 'top' ? 'ledge' : k.solid ? (plane === 'side' ? 'brick' : 'wall') : plane === 'side' ? 'ledge' : 'path');

// a spec's own random numbers: the same spec gives the same map, whoever asks (create's refusal and its config)
function specRng(spec) {
  let h = 2166136261; for (const ch of `${spec.title ?? ''}|${spec.plane}|${spec.world?.size ?? 'small'}|flat`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => ((h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296);
}

/**
 * The tile map of a spec: spec.world.map when the spec wrote one (rows, and any of tile, base, kinds, legend: what it
 * leaves out is the plane's default), else a generated map of the asked size. → the map (gf-tilemap-1)
 */
export function mapFor(spec) {
  const plane = spec.plane === 'side' ? 'side' : 'top', given = spec.world?.map;
  if (given?.rows) {
    return { format: FORMAT, plane, tile: given.tile ?? 1, ...(plane === 'top' ? { base: given.base ?? 'grass' } : {}),
      kinds: { ...KINDS[plane], ...(given.kinds ?? {}) }, legend: { ...LEGENDS[plane], ...(given.legend ?? {}) }, rows: given.rows };
  }
  const marks = (spec.world?.props ?? []).map(p => p.name).filter(n => /^[a-z][a-z0-9-]{0,23}$/.test(n)).slice(0, 3);
  return generateMap({ plane, size: spec.world?.size ?? 'small', seats: Math.max(2, spec.players?.max ?? 4), rng: specRng(spec), marks, reach: jumpReach(SIDE) });
}

/** What is wrong with a flat spec, in words (create refuses with these before anything is written). */
export function refuse(spec) {
  const plane = spec.plane, bad = [];
  if (!PLANES.includes(plane)) return [`plane: a flat game says how it is seen: "plane": "top" (from above) or "side" (from the side, with gravity)${plane === undefined ? '' : `, not "${plane}"`}`];
  const T = spec.world?.template, L = spec.look?.preset;
  if (!templates[plane].includes(T)) bad.push(`world.template "${T}" is not the flat ${plane} world (${templates[plane].join(', ')})`);
  if (!(L in presets)) bad.push(`look.preset "${L}" is not a flat look (${Object.keys(presets).join(', ')})`);
  if (spec.camera !== cameras[plane]) bad.push(`camera "${spec.camera}" is not the flat ${plane} camera ("${cameras[plane]}")`);
  for (const c of spec.characters ?? []) if (c.body?.from !== 'sprite') bad.push(`characters: "${c.role}" has a body from "${c.body?.from}"; a flat game's body is a picture sheet: {"from": "sprite"}`);
  if (spec.round?.mode === 'world') bad.push('round.mode world: the block world is not a flat world');
  const M = readMap(mapFor(spec));
  for (const p of M.problems) bad.push(`world.map: ${p}`);
  if (M.ok && plane === 'side') for (const p of reachOf(M, jumpReach(SIDE)).problems) bad.push(`world.map: ${p}`);
  if (M.ok && M.spawns.length < Math.max(2, spec.players?.max ?? 4)) bad.push(`world.map: ${M.spawns.length} spawns for ${Math.max(2, spec.players?.max ?? 4)} seats`);
  return bad;
}
/** What a spec that is NOT flat may not name (so a flat world or look never lands in a 3D game by a slip). */
export function refuseNotFlat(spec) {
  const bad = [], T = spec.world?.template, L = spec.look?.preset;
  if (Object.values(templates).flat().includes(T)) bad.push(`world.template "${T}" is a flat (2D) world: the spec needs "engine": "flat" and a "plane"`);
  if (L in presets) bad.push(`look.preset "${L}" is a flat (2D) look: the spec needs "engine": "flat" and a "plane"`);
  if (spec.camera === 'side') bad.push('camera "side" is the flat side-on camera: the spec needs "engine": "flat" and "plane": "side"');
  if ((spec.characters ?? []).some(c => c.body?.from === 'sprite')) bad.push('characters: a body from "sprite" is a flat (2D) picture body: the spec needs "engine": "flat" and a "plane"');
  if (spec.world?.map) bad.push('world.map is a flat (2D) world\'s tile map: the spec needs "engine": "flat" and a "plane"');
  if (spec.plane !== undefined) bad.push(`plane "${spec.plane}" is a flat (2D) game's: the spec needs "engine": "flat"`);
  return bad;
}

/**
 * config/world.json of a flat game (create calls it in Node; the call shape of the scenic world's worldConfig,
 * CONTRACT §8). opts.assets gets the tile pictures to copy ({to, from, license}); opts.repoFile makes `from` absolute.
 */
export function worldConfig(spec, { assets = [], notes = [], repoFile = f => f } = {}) {
  const plane = spec.plane === 'side' ? 'side' : 'top', style = presets[spec.look?.preset]?.style ?? 'pixel';
  const map = mapFor(spec), M = readMap(map), tiles = {};
  for (const [kind, k] of Object.entries(map.kinds)) {
    const to = `assets/tiles/${kind}.png`;
    tiles[kind] = to;
    if (!assets.some(a => a.to === to)) assets.push({ to, from: repoFile(tileArt(tileFor(kind, k, plane), style)), license: ART_LICENSE });
  }
  notes.push(`world: a flat ${templates[plane][0]} seen from ${plane === 'side' ? 'the side' : 'above'}, a tile map of ${M.cols} x ${M.rows} cells (${spec.world?.map?.rows ? 'the spec\'s own' : 'generated'}), ${Object.keys(map.kinds).length} tile kinds, ${M.spawns.length} spawns`);
  // `spawns` is the world contract's field (CONTRACT §4.3: tools read a world's spawns there). In a flat world the MAP
  // is what the game reads; this list is the map's spawn cells as points, written beside it (spawnsOf), and the world's
  // own report says so when the two no longer agree (tools/flat-map.mjs <game> --sync writes it again).
  return { template: templates[plane][0], plane, size: spec.world?.size ?? 'small', half: Math.round((M.cols * M.tile) / 2), style, map, tiles, spawns: spawnsOf(map),
    zones: { centre: { shape: 'circle', at: [0, 0, 0], size: [2.5] } }, ...(spec.world?.notes ? { notes: spec.world.notes } : {}) };
}

/** A map's spawn cells as points [[x, y, z]], seats in reading order: what config/world.json → spawns holds. */
export function spawnsOf(map) { const M = readMap(map); return M.spawns.map(s => { const p = M.feet(s.c, s.r); return [p.x, p.y, p.z]; }); }

/** A flat game's prop: a picture. → the record create keeps (gf-three.json → props) */
export function propFor(p, { style = 'pixel', assets = [], repoFile = f => f } = {}) {
  const to = `assets/sprites/${p.name}.png`, art = propArt(p.name, style);
  assets.push({ to, from: repoFile(art), license: ART_LICENSE });
  return { file: to, from: `standin:flat/${style}/${art.split('/').pop()}`, license: ART_LICENSE };
}
/** A flat game's body: a picture sheet. → { role (config/characters.json → roles[role]), record, note } */
export function bodyFor(c, { plane = 'top', style = 'pixel', assets = [], repoFile = f => f } = {}) {
  const to = `assets/sprites/body-${c.role}.png`;
  assets.push({ to, from: repoFile(bodyArt(plane, style)), license: ART_LICENSE });
  return {
    role: { body: to, height: 1.7, ...(c.describe ? { describe: c.describe } : {}), license: ART_LICENSE },
    record: { file: to, from: `standin:flat/${style}/body-${plane}`, license: ART_LICENSE },
    note: `character "${c.role}": a picture body (${STANDARD}: ${FRAMES.length} frames ${FRAMES.join(', ')}; ${style}), the flat stand-in until one is drawn or made`,
  };
}
/** What a flat game adds to or changes in config/game.json. */
export function gameFor(spec, game) {
  const side = spec.plane === 'side';
  return {
    plane: spec.plane,
    // side-on the jump is the flat part's (two cells with room to spare); from above nobody jumps
    controller: { ...game.controller, ...(side ? { jump: SIDE.jump } : {}) },
    controls: side ? { jump: 'jump', ...(game.controls ?? {}) } : Object.fromEntries(Object.entries(game.controls ?? {}).filter(([k]) => k !== 'jump')),
  };
}

const L = 'config/look.json', W = 'config/world.json', C = 'config/characters.json';
const PICTURE = { colorSpace: 'srgb', layout: '2d', maxBytes: 2097152 };
const styleLine = style => (style === 'drawn' ? 'drawn 2D game art, clean shapes, soft shading, transparent background' : 'pixel art, hard pixels, a dark 1 pixel outline, transparent background');

/** look: every number and colour in config/look.json → values (the stand-in look's walk does exactly this). */
export const lookSlots = cfg => valueSlots(cfg).map(s => (s.id === 'look.view' ? { ...s, label: 'View (metres across the short side)', tier: 'main', rank: 60, constraints: { min: 6, max: 40, unit: 'm' } }
  : s.id === 'look.portrait' ? { ...s, label: 'View on a phone held upright (metres across)', constraints: { min: 6, max: 30, unit: 'm' } } : s.id === 'look.background' ? { ...s, label: 'Background', tier: 'main', rank: 70 } : s));

/** world: the tile map (one value: the file a painter edits), a picture per tile kind, and a picture per prop. */
export function worldSlots(cfg) {
  const w = cfg.world ?? {}, style = w.style ?? 'pixel', S = STYLES[style] ?? STYLES.pixel, out = [];
  out.push({ id: 'world.map', group: 'world', label: 'Tile map', type: 'json', source: { file: W, pointer: '/map' }, tier: 'main', facet: 'gameplay', rank: 92,
    constraints: { format: FORMAT, editor: 'tilemap' },
    description: `The whole level as a grid (${FORMAT}): rows of characters, one a cell, read through the legend; kinds say what is solid. Row 1 is the ${w.plane === 'side' ? 'top' : 'far side'}. Each kind's picture is the slot world.tiles.<kind>.` });
  for (const [kind, file] of Object.entries(w.tiles ?? {})) {
    const k = w.map?.kinds?.[kind] ?? {};
    out.push({ id: `world.tiles.${kind}`, group: 'world', label: `${humanize(kind)} tile`, type: 'image', source: { file }, constraints: { ...PICTURE, tile: { standard: STANDARD, style, size: S.tile, solid: k.solid ?? false } }, tier: 'main', facet: 'look', rank: 88, license: ART_LICENSE,
      description: `One square tile, ${S.tile} x ${S.tile} px (1 m), or two side by side: cap, fill. ${k.solid === 'top' ? 'A ledge: landed on from above, jumped through from below.' : k.solid ? 'Solid.' : 'Drawn only: bodies walk over it.'}`,
      generate: { prompt: `a seamless ${kind} tile`, style: `${styleLine(style)}, ${S.tile}x${S.tile}, tiles on every side` } });
  }
  out.push({ id: 'world.zones', group: 'world', label: 'Zones', type: 'json', source: { file: W, pointer: '/zones' }, tier: 'advanced', facet: 'gameplay', rank: 18 });
  for (const p of cfg.game?.props ?? []) {
    const rec = cfg.propFiles?.[p.name] ?? {};
    out.push({ id: `prop.${p.name}`, group: 'props', label: humanize(p.name), type: 'image', source: { file: rec.file ?? `assets/sprites/${p.name}.png` }, constraints: { ...PICTURE, picture: { standard: STANDARD, style } }, tier: 'main', facet: 'look', rank: 94,
      description: p.describe ? `${p.describe}${p.role ? ` (${p.role})` : ''}` : undefined, generate: { prompt: p.describe ?? p.name, style: styleLine(style) }, ...(rec.license ? { license: rec.license } : {}) });
  }
  return out;
}

/** character: a body PICTURE per role (a gf-flat-1 sheet), its height, the seat colours. */
export function characterSlots(cfg) {
  const c = cfg.characters ?? {}, style = cfg.world?.style ?? 'pixel', S = STYLES[style] ?? STYLES.pixel, out = [];
  for (const [role, r] of Object.entries(c.roles ?? {})) {
    // the player role's body and colour are player looks (CONTRACT §6e): each player's loadout may replace them
    const look = role === 'player' ? { scope: 'player' } : {};
    out.push({ id: `character.body.${role}`, group: 'characters', label: role === 'player' ? 'Player character' : `${humanize(role)} character`, type: 'image',
      source: { file: r.body, pathRef: { file: C, pointer: `/roles/${role}/body` } }, constraints: { ...PICTURE, sheet: { standard: STANDARD, style, frames: FRAMES, rows: [1, 3], cell: S.cell } },
      tier: 'main', facet: 'look', rank: 98, ...look,
      description: `${r.describe ? `${r.describe}. ` : ''}A sheet of square cells (${S.cell} px), ${FRAMES.length} across: ${FRAMES.join(', ')}; 1 row, or 3 (down, side, up) for a top-down game. Feet at the bottom middle of a cell. Light parts take the player's colour.`,
      generate: { prompt: r.describe ?? 'a friendly game character', style: `${styleLine(style)}, a sprite sheet of ${FRAMES.length} frames in a row` }, ...(r.license ? { license: r.license } : {}) });
    if (typeof r.height === 'number') out.push({ id: `character.height.${role}`, group: 'characters', label: `${role === 'player' ? 'Player' : humanize(role)} height`, type: 'number', source: { file: C, pointer: `/roles/${role}/height` }, constraints: { min: 0.6, max: 3, unit: 'm' }, tier: 'advanced', facet: 'look', rank: 30 });
  }
  if (Object.keys(c.roles ?? {}).length && !Array.isArray(cfg.look?.palette?.players)) out.push({ id: 'character.tint.player', group: 'characters', label: 'Player colours (one per seat)', type: 'colors', source: { file: C, pointer: '/palette' }, constraints: { min: 1, max: 8 }, tier: 'main', facet: 'look', rank: 86, scope: 'player', description: 'Each player\'s body colour (it multiplies the picture), ring and nameplate colour' });
  return out;
}

export { SIZES };
