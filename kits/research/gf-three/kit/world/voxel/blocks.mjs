// gf-three voxel world: the block table, from config/world.json → voxel. Pure (no three.js, no DOM).
//
//   voxel.blocks[]  { id, label, kind: 'solid'|'cutout'|'glass'|'glow'|'plant'|'sign',
//                     tex: '<texture name>' | { top, side, bottom }, color: '#rrggbb' (multiplier, optional),
//                     solid (default: kind is solid, cutout, glass or glow), place (on the hotbar's block list;
//                     default true), break (default true), boom (a boom block), natural (terrain only) }
//   voxel.textures  { '<texture name>': 'assets/textures/blocks/<file>.png' }: every texture is an image slot
//                   world.voxel.texture.<name> (kit/world/voxel/world.js slotsFor)
//   voxel.paint     ['#rrggbb' x up to 15]: the paint colours; a cell's tint t (1..15) is paint[t - 1]
// Block ids are 1-based in blocks[] order (0 is air): the world store keeps them (PLAN §4.1), so a world's block list
// only ever grows at the end.

export const KINDS = ['solid', 'cutout', 'glass', 'glow', 'plant', 'sign'];
// The size every block face is drawn at, by quality tier (kit/world/voxel/world.js): 512 on high (on a 4K screen a
// block close by covers 600+ pixels, and a 128 px face stretched that far looked soft: the creator, 2026-10-09, "I am
// not sure why the game looks so blurry still"), 256 on low (phones; a quarter of the memory). Verify's world lint
// (check 11) wants every face at least FACE_SIZES.high.
export const FACE_SIZES = { high: 512, low: 256 };
const SOLID_KINDS = new Set(['solid', 'cutout', 'glass', 'glow']);

export const hexToLinear = hex => {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const s = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [s((n >> 16) & 255), s((n >> 8) & 255), s(n & 255)];
};

/**
 * → { list: [{id, n (1-based), label, kind, solid, opaque, place, break, boom, natural, tex: {top, side, bottom}}],
 *     byId: Map(id → entry), info: [null, ...{kind, opaque, solid, layers, color}], textures: [names in layer order],
 *     tints: [null, ...[r, g, b]], paint: ['#rrggbb', ...] }
 */
export function blockTable(voxel) {
  const blocks = voxel?.blocks ?? [];
  if (!blocks.length) throw new Error('gf-three voxel: config/world.json has no voxel.blocks');
  if (blocks.length > 255) throw new Error('gf-three voxel: at most 255 blocks');
  const textures = [], layerOf = new Map();
  const layer = name => {
    if (!voxel.textures?.[name]) throw new Error(`gf-three voxel: block texture "${name}" is not in voxel.textures`);
    if (!layerOf.has(name)) { layerOf.set(name, textures.length); textures.push(name); }
    return layerOf.get(name);
  };
  const list = [], byId = new Map(), info = [null];
  blocks.forEach((b, i) => {
    if (!b?.id || byId.has(b.id)) throw new Error(`gf-three voxel: block ${i + 1} needs a unique id`);
    const kind = b.kind ?? 'solid';
    if (!KINDS.includes(kind)) throw new Error(`gf-three voxel: block "${b.id}" has an unknown kind "${kind}"`);
    const t = typeof b.tex === 'string' ? { top: b.tex, side: b.tex, bottom: b.tex } : { side: b.tex?.side, top: b.tex?.top ?? b.tex?.side, bottom: b.tex?.bottom ?? b.tex?.side };
    const layers = { top: layer(t.top), side: layer(t.side), bottom: layer(t.bottom) };
    const solid = b.solid ?? SOLID_KINDS.has(kind);
    const e = {
      id: b.id, n: i + 1, label: b.label ?? b.id, kind, solid, opaque: kind === 'solid' || kind === 'glow',
      place: b.place ?? !b.natural, break: b.break ?? true, boom: !!b.boom, natural: !!b.natural, tex: t, color: b.color ?? null,
      light: !!b.light,
    };
    list.push(e); byId.set(e.id, e);
    info.push({ kind, opaque: e.opaque, solid, layers, color: b.color ? hexToLinear(b.color) : null });
  });
  const paint = (voxel.paint ?? []).slice(0, 15);
  const tints = [null, ...paint.map(hexToLinear)];
  return { list, byId, info, textures, layerOf, tints, paint };
}

/** The id number of a block id ('grass' → 1), or throws. */
export function blockN(table, id) { const e = table.byId.get(id); if (!e) throw new Error(`gf-three voxel: no block "${id}"`); return e.n; }
