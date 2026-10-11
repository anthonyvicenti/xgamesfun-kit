// gf-three flat: the world of a flat (2D) game (CONTRACT §4.3's runtime shape: spawn, zone, raycast, bounds, props,
// root, update). It is built from ONE value, the tile map (config/world.json → map, the slot world.map; tilemap.js has
// the format), and one picture per tile kind (the slots world.tiles.<kind>):
//
//   field (plane 'top')   seen from above: the base kind under every cell, other kinds over it, solid kinds are walls
//   stage (plane 'side')  seen from the side: solid kinds are ground and blocks, "top" kinds are ledges you land on from
//                         above and jump up through, an empty cell is sky; every body is held at Z = 0
//
// What is drawn is pictures on quads. What is solid is Rapier's 3D boxes, so the kit's capsule, bots, knocks, pickups
// and rays work on them untouched: a top-down wall is a 3 m tall box seen from above; a side-on block is a box 2 m
// deep that nobody can walk round, because every body's Z is locked (controller.js). Past the map's edge the picture
// continues (the edge cells repeat), so no screen shape shows a void.
import * as THREE from 'three';
import { WORLD_GROUPS, GROUPS } from '../core/util.js';
import { pictureMaterial } from './look.js';
import { readMap, rects, boxOf, reachOf, jumpReach } from './tilemap.js';
import { SIDE } from './slots.js';
export { templates, worldConfig } from './slots.js';

/** The collision group of a ledge: nothing collides with it by default; a body's ground probe sees it only while that
 *  body is above it and not rising (controller.js). */
export const ONEWAY = 0x10;
const PAD = 12;       // cells the picture continues past the map's edge

export async function loadWorld(ctx, cfg) {
  const { scene, assets } = ctx, W = ctx.physics, RAPIER = ctx.RAPIER;
  const side = cfg.plane === 'side', T = cfg.template ?? (side ? 'stage' : 'field');
  const style = ctx.flat?.style ?? cfg.style ?? 'pixel';
  const M = readMap(assets.has('world.map') ? assets.value('world.map', cfg.map) : cfg.map);
  if (!M.ok) console.error(`gf-three flat world: the tile map has problems: ${M.problems.join('; ')}`);
  const tile = M.tile, group = new THREE.Group(); group.name = `gf-world-${T}`; scene.add(group);
  const fixed = W.createRigidBody(RAPIER.RigidBodyDesc.fixed()), colliders = [], shapes = [];
  const box = (hx, hy, hz, x, y, z, tag, groups = WORLD_GROUPS) => {
    const c = W.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(1).setCollisionGroups(groups), fixed);
    c.__gf = { tag }; colliders.push(c); return c;
  };
  const A = M.area, w = M.size.w, h = M.size.h, ledges = [];
  if (side) {
    for (const q of rects(M, true)) { const b = boxOf(M, q); box(b.w / 2, b.h / 2, 1, b.x, b.y, 0, 'block'); }
    for (const q of rects(M, 'top')) {
      const b = boxOf(M, q), top = b.y + tile / 2, thick = tile * 0.25;
      box(b.w / 2, thick / 2, 1, b.x, top - thick / 2, 0, 'ledge', ((ONEWAY << 16) | 0xffff) >>> 0);
      ledges.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, top });
    }
    // the map is closed: a floor under its bottom row, a wall past each end, however the rows were drawn
    box(w / 2 + 4, 2, 1, 0, A.minY - 2, 0, '#floor');
    for (const s of [-1, 1]) box(2, h + 20, 1, s * (w / 2 + 2), h / 2, 0, '#edge');
  } else {
    box(w / 2 + 8, 0.5, h / 2 + 8, 0, -0.5, 0, 'ground');
    for (const q of rects(M, true)) { const b = boxOf(M, q); box(b.w / 2, 1.5, b.d / 2, b.x, 1.5, b.z, 'wall'); shapes.push({ shape: 'box', prop: 'wall', position: [b.x, 0, b.z], size: [b.w, 3, b.d] }); }
    for (const [x, z, hx, hz] of [[w / 2 + 2, 0, 2, h / 2 + 4], [-w / 2 - 2, 0, 2, h / 2 + 4], [0, h / 2 + 2, w / 2 + 4, 2], [0, -h / 2 - 2, w / 2 + 4, 2]]) box(hx, 3, hz, x, 3, z, '#edge');
  }

  // ---- the picture: one mesh per kind, a quad a cell. Past the edge the nearest edge cell repeats. ----
  const clampAt = (c, r) => (side && r < 0 ? null : M.at(Math.max(0, Math.min(M.cols - 1, c)), Math.max(0, Math.min(M.rows - 1, r))));
  const quads = new Map();      // kind → { pos: [], uv: [], cap: [] (which quads want the cap frame) }
  const want = kind => { if (!quads.has(kind)) quads.set(kind, { cells: [] }); return quads.get(kind); };
  for (let r = side ? 0 : -PAD; r < M.rows + PAD; r++) for (let c = -PAD; c < M.cols + PAD; c++) {
    const kind = clampAt(c, r), inside = r < M.rows;
    if (!side && M.base) want(M.base).cells.push({ c, r, cap: false, base: true });
    if (!kind || (!side && kind === M.base)) continue;
    // the cap: where the cell above (side-on) or on the far side (from above) is not this kind. Below the map it is all fill.
    want(kind).cells.push({ c, r, cap: inside && clampAt(c, r - 1) !== kind, base: false });
  }
  const tileSlots = cfg.tiles ?? {};
  for (const [kind, q] of quads) {
    const slot = `world.tiles.${kind}`;
    if (!tileSlots[kind] || !assets.has(slot)) { console.error(`gf-three flat world: the map uses the kind "${kind}", which has no picture (slot ${slot})`); continue; }
    const tex = await assets.texture(slot);
    const map = tex.clone(); map.userData.gfSlot = slot; map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping; map.needsUpdate = true;
    const iw = tex.image?.width || 1, ih = tex.image?.height || 1, frames = iw >= ih * 2 ? 2 : 1, inset = style === 'pixel' ? 0 : 0.5 / iw, insetV = style === 'pixel' ? 0 : 0.5 / ih;
    const solid = M.kinds[kind]?.solid ?? false, n = q.cells.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = new Uint32Array(n * 6);
    // how far toward the eye a kind sits: the base, then what lies on it, then what stands
    const lift = side ? (solid === true ? -0.3 : -0.35) : solid === true ? 0.03 : 0.015;
    q.cells.forEach((cell, i) => {
      const p = M.centre(cell.c, cell.r), t2 = tile / 2, f = frames === 2 && !cell.cap ? 1 : 0, u0 = f / frames + inset, u1 = (f + 1) / frames - inset, v0 = insetV, v1 = 1 - insetV;
      const y = cell.base ? 0 : lift;
      const corners = side ? [[p.x - t2, p.y - t2, lift], [p.x + t2, p.y - t2, lift], [p.x + t2, p.y + t2, lift], [p.x - t2, p.y + t2, lift]]
        : [[p.x - t2, y, p.z + t2], [p.x + t2, y, p.z + t2], [p.x + t2, y, p.z - t2], [p.x - t2, y, p.z - t2]];
      corners.forEach((k, j) => pos.set(k, i * 12 + j * 3));
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const isBase = !side && kind === M.base, mesh = new THREE.Mesh(geo, pictureMaterial(map, { style, order: isBase ? 0 : 1 }));
    mesh.name = `tiles:${kind}`; mesh.renderOrder = isBase ? 0 : 1; mesh.frustumCulled = false;
    assets.tag(mesh, slot); group.add(mesh);
  }

  const mid = side ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0, z: 0 };
  const spawns = (M.spawns.length ? M.spawns : [{ c: M.cols >> 1, r: M.rows >> 1 }]).map(s => { const p = M.feet(s.c, s.r); return { x: p.x, y: p.y, z: p.z, yaw: side ? (p.x <= mid.x ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(mid.x - p.x, mid.z - p.z) }; });
  const zones = {};
  for (const [name, z] of Object.entries((assets.has('world.zones') ? assets.value('world.zones', cfg.zones) : cfg.zones) ?? {})) {
    const at = z.at ?? [0, 0, 0], sz = [].concat(z.size ?? 2);
    zones[name] = {
      name, shape: z.shape ?? 'circle', at, size: sz,
      contains: p => (z.shape === 'box' ? Math.abs(p.x - at[0]) <= sz[0] / 2 && Math.abs(p.z - at[2]) <= (sz[2] ?? sz[0]) / 2 : Math.hypot(p.x - at[0], p.z - at[2]) <= sz[0]),
      random: rng => { if (z.shape === 'box') return { x: at[0] + (rng() - 0.5) * sz[0], y: at[1], z: side ? 0 : at[2] + (rng() - 0.5) * (sz[2] ?? sz[0]) }; const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * sz[0]; return { x: at[0] + Math.cos(a) * r, y: at[1], z: side ? 0 : at[2] + Math.sin(a) * r }; },
    };
  }
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const isWorld = c => c.parent()?.handle === fixed.handle && !(c.__gf?.tag === 'ledge');
  // the play area. Side-on it is a strip: nothing is ever placed off Z = 0.
  const bounds = side ? new THREE.Box3(new THREE.Vector3(A.minX, 0, -0.05), new THREE.Vector3(A.maxX, A.maxY, 0.05)) : new THREE.Box3(new THREE.Vector3(A.minX, 0, A.minZ), new THREE.Vector3(A.maxX, 4, A.maxZ));
  const world = {
    template: T, plane: side ? 'side' : 'top', flat: true, root: group, group, bounds, half: w / 2, colliders, shapes, props: new Map(), spawns, map: M, ledges, tile,
    // the whole picture, edge to edge: what the camera may show (the map itself; the repeated edge is only for odd screens)
    view: side ? { minX: A.minX, maxX: A.maxX, minY: A.minY, maxY: A.maxY } : { minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ },
    spawn: i => spawns[((i % spawns.length) + spawns.length) % spawns.length],
    zone: name => zones[name] ?? null,
    zones,
    /** The places the map marks with a name (legend "mark:<name>"): [{x, y, z}], where a thing would stand. */
    marks: name => (M.marks[name] ?? []).map(m => M.feet(m.c, m.r)),
    /** The cell a point is in, and what is there: { c, r, kind, solid }. */
    cell: p => { const q = M.cellAt(p), kind = M.at(q.c, q.r) ?? null; return { ...q, kind, solid: kind ? M.kinds[kind]?.solid ?? false : false }; },
    /** Side-on: what a jump reaches with this game's numbers, and what the map needs of it (tilemap.js reachOf). */
    reach() { const C = ctx.config?.controller ?? {}, R = jumpReach({ gravity: ctx.config?.gravity ?? 20, jump: C.jump ?? SIDE.jump, speed: C.speed ?? SIDE.speed, fallScale: SIDE.fallScale }); return side ? { ...R, ...reachOf(M, R) } : R; },
    raycast(from, dir, max = 50) {
      const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
      ray.origin = { x: from.x, y: from.y, z: from.z }; ray.dir = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
      const hit = W.castRayAndGetNormal(ray, max, true, undefined, undefined, undefined, undefined, isWorld);
      if (!hit) return null;
      const d = hit.timeOfImpact;
      return { point: { x: from.x + ray.dir.x * d, y: from.y + ray.dir.y * d, z: from.z + ray.dir.z * d }, distance: d, normal: hit.normal, collider: hit.collider, tag: hit.collider.__gf?.tag ?? null };
    },
  };
  return world;
}
export { GROUPS };
