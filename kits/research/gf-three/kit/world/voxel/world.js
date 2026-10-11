// gf-three voxel world (research/worlds/PLAN.md; CONTRACT §9): a block world that players change and the play host
// keeps. config/world.json → { template: 'voxel', voxel: { size, blocks, textures, paint, terrain, protect, floor, ... } }.
//
//   loadWorld(ctx, cfg)   generates the island (kit/world/voxel/terrain.mjs, deterministic from the seed), lays the
//                         saved world over it (kit/net/persist.js: the play host's snapshot and the edits after it),
//                         meshes it in 16³ chunks (one texture array for every block face), and gives it one Rapier
//                         voxel collider that follows every edit. → ctx.world, with the kit's world API (spawn, zone,
//                         bounds, raycast, update) plus world.voxel (below)
//   slotsFor(cfg)         the world's slots: one image slot per block texture, the paint colours, water and sign ink
//
// world.voxel:
//   grid, table           the cells (grid.mjs VoxelGrid) and the block table (blocks.mjs)
//   apply(x, y, z, v, {text, face})   change one cell everywhere this copy shows it (mesh, collider, sign) → the old
//                         {v, sign}; the build mechanic decides who may (kit/mechanics/build)
//   pick(from, dir, max)  the cell and face a ray meets first (any block, plants and signs included)
//   protectedAt(x, y, z)  inside a protect box or below the floor
//   remeshNow(x, y, z)    re-mesh the chunk of a cell this frame (a player's own edit shows at once)
//   store                 the world store client (kit/net/persist.js); loaded: {seq, mode, missing, error}
//   onApply(fn)           fn(x, y, z, v, old) after every apply
// Terrain is generator version `voxel.terrain.generator` (1): the play host keeps only the cells players changed, so
// the same seed and version must give the same island forever. A change to terrain.mjs's output is a new version.
import * as THREE from 'three';
import { VoxelGrid, CHUNK, chunkKey } from './grid.mjs';
import { blockTable, FACE_SIZES } from './blocks.mjs';
import { generateTerrain } from './terrain.mjs';
import { createSigns } from './signs.js';
import { material } from '../../look/materials.js';
import { WORLD_GROUPS } from '../../core/util.js';
import { createWorldStore } from '../../net/persist.js';

export const templates = ['voxel'];
// The size every block face is drawn at, by quality tier (blocks.mjs FACE_SIZES: 512 high, 256 low). 32 faces at 512
// with their mipmaps are about 43 MB of GPU memory, at 256 about 11 MB.
const TEX_SIZES = FACE_SIZES;
const texSizeOf = quality => TEX_SIZES[quality?.name ?? quality] ?? TEX_SIZES.high;
const DBG = typeof location !== 'undefined' && /gf-voxdbg=1/.test(location.search);
const BUCKETS = ['solid', 'cutout', 'glass', 'glow', 'plant'];

export function slotsFor(cfg) {
  const V = cfg.voxel ?? {};
  const out = [];
  const names = Object.keys(V.textures ?? {});
  names.forEach((name, i) => out.push({
    id: `world.voxel.texture.${name}`, label: `Block texture: ${name.replace(/-/g, ' ')}`, group: 'world', type: 'image', facet: 'look',
    tier: i < 12 ? 'main' : 'advanced', rank: 20 + i,
    source: { file: V.textures[name] }, constraints: { colorSpace: 'srgb', formats: ['png', 'jpg', 'webp'], square: true, tile: true },
    description: `A square block face (${TEX_SIZES.high}×${TEX_SIZES.high} is drawn, ${TEX_SIZES.low}×${TEX_SIZES.low} on low graphics; other sizes are resampled, so give ${TEX_SIZES.high} or more for a sharp face). Faces with transparency (leaves, glass, plants) keep it.`,
    generate: { prompt: `a square, seamless, flat-shaded stylised voxel block face: ${name.replace(/-/g, ' ')}`, style: 'flat colours, soft shapes, no perspective, no lighting' },
  }));
  out.push(
    { id: 'world.voxel.blocks', label: 'Block list', group: 'world', type: 'json', facet: 'gameplay', tier: 'advanced', source: { file: 'config/world.json', pointer: '/voxel/blocks' }, description: 'Every block: id, label, kind, textures. Ids are numbered in order and saved worlds keep the numbers, so only add at the end.' },
    { id: 'world.voxel.paint', label: 'Paint colours', group: 'world', type: 'colors', facet: 'look', tier: 'main', rank: 40, source: { file: 'config/world.json', pointer: '/voxel/paint' } },
    { id: 'world.voxel.sign-ink', label: 'Sign writing colour', group: 'world', type: 'color', facet: 'look', tier: 'advanced', source: { file: 'config/world.json', pointer: '/voxel/signInk' } },
    { id: 'world.voxel.sign-paper', label: 'Sign panel colour', group: 'world', type: 'color', facet: 'look', tier: 'advanced', source: { file: 'config/world.json', pointer: '/voxel/signPaper' } },
    { id: 'world.voxel.terrain', label: 'Island shape', group: 'world', type: 'json', facet: 'gameplay', tier: 'advanced', source: { file: 'config/world.json', pointer: '/voxel/terrain' }, description: 'The generated island (seed, size, hills, trees). Changing it changes the island under every saved build: only before a world is played.' },
  );
  return out;
}

export async function loadWorld(ctx, cfg) {
  const V = cfg.voxel;
  if (!V?.size) throw new Error('gf-three voxel: config/world.json needs voxel.size');
  const table = blockTable(V);
  const grid = new VoxelGrid({ size: V.size, info: table.info, tints: table.tints });
  const [sx, sy, sz] = grid.size;
  const T = generateTerrain(grid, table, { ...(V.terrain ?? {}), blocks: V.terrain?.blocks });
  const signN = V.signBlock ? table.byId.get(V.signBlock)?.n ?? 0 : 0;
  const floor = V.floor ?? 1;
  const protect = (V.protect ?? []).map(b => ({ min: b.min, max: b.max, why: b.why ?? '' }));
  const root = new THREE.Group(); root.name = 'gf-voxel-world';
  ctx.scene?.add(root);

  // ---- the saved world: the play host's snapshot, then every edit after it ----
  const signsData = new Map();
  if (T.sign && signN && V.terrain?.plaza?.signText) {
    grid.put(...T.sign.cell, signN);
    signsData.set(grid.index(...T.sign.cell), { text: V.terrain.plaza.signText, face: T.sign.face });
  }
  const store = createWorldStore({ fetchFn: ctx.worldFetch ?? globalThis.fetch?.bind(globalThis), slug: ctx.worldSlug !== undefined ? ctx.worldSlug : undefined });
  const loaded = { seq: 0, mode: store.mode, missing: false, error: null, cells: 0, edits: 0, ms: 0 };
  const welcome = new Map(signsData);
  /** Lay the play host's world over the generated island: its snapshot's cells and signs, then the edits after it. */
  async function loadSaved() {
    const t0 = performance.now();
    try {
      const w = await store.load();
      loaded.mode = w.mode; loaded.missing = !!w.missing; loaded.seq = w.seq;
      for (const [i, v] of w.cells) { if (i >= 0 && i < grid.data.length) { grid.data[i] = v; if (v !== signN || !signN) signsData.delete(i); } }
      for (const [i, s] of w.signs) if (signN && (grid.data[i] & 255) === signN) signsData.set(i, s);
      for (const e of w.edits) {
        const [, , x, y, z, v, text, face] = e;
        if (!grid.inBounds(x, y, z)) continue;
        const i = grid.index(x, y, z);
        grid.data[i] = v;
        if (signN && (v & 255) === signN && typeof text === 'string') signsData.set(i, { text, face: face ?? 5 }); else signsData.delete(i);
      }
      loaded.cells = w.cells.length; loaded.edits = w.edits.length; loaded.error = null;
    } catch (e) {
      loaded.error = String(e.message ?? e);
      console.warn(`gf-three voxel: the saved world did not load (${loaded.error}); showing the island as generated`);
    }
    loaded.ms = Math.round(performance.now() - t0);
  }
  await loadSaved();

  // ---- textures: every block face in one texture array (no atlas bleeding at a distance) ----
  const { texture: arrayTex, images: textureImages, averages } = await buildTextureArray(ctx, table.textures);
  const signTex = signN ? await ctx.assets?.texture?.(`world.voxel.texture.${table.list[signN - 1].tex.side}`).catch(() => null) : null;

  // ---- materials: one per kind; the house 'prop' lighting with the texture array sampled in ----
  const mats = Object.fromEntries(BUCKETS.map(k => [k, voxelMaterial(k, arrayTex, V)]));

  // ---- chunk meshes ----
  const chunks = new Map();
  const blockSlot = 'world.voxel.blocks';
  function buildChunk(cx, cy, cz) {
    const key = chunkKey(cx, cy, cz);
    const old = chunks.get(key);
    if (old) for (const m of old) { m.geometry.dispose(); m.removeFromParent(); }
    const buckets = grid.meshChunk(cx, cy, cz);
    const meshes = [];
    for (const k of BUCKETS) {
      const b = buckets[k]; if (!b?.indices.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
      g.setAttribute('gfUvl', new THREE.Float32BufferAttribute(b.uvl, 3));
      g.setAttribute('gfTint', new THREE.Float32BufferAttribute(b.tints, 3));
      g.setIndex(b.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.indices, 1) : new THREE.Uint16BufferAttribute(b.indices, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, mats[k]);
      m.name = `chunk ${key} ${k}`;
      m.castShadow = k !== 'glass' && k !== 'plant'; m.receiveShadow = true;
      if (k === 'glass') m.renderOrder = 1;
      m.userData.gfSlot = blockSlot;
      m.userData.gfChunk = key;
      root.add(m); meshes.push(m);
    }
    if (meshes.length) chunks.set(key, meshes); else chunks.delete(key);
    grid.dirty.delete(key);
  }
  const tm = performance.now();
  for (let cx = 0; cx < grid.cx; cx++) for (let cy = 0; cy < grid.cy; cy++) for (let cz = 0; cz < grid.cz; cz++) buildChunk(cx, cy, cz);
  const meshMs = Math.round(performance.now() - tm);

  // ---- signs ----
  const signs = createSigns(ctx, { grid, boardTexture: signTex, boardSlot: signN ? `world.voxel.texture.${table.list[signN - 1].tex.side}` : blockSlot, ink: V.signInk ?? '#2b1d12', paper: V.signPaper ?? '#f6ecd6' });
  root.add(signs.group);
  for (const [i, s] of signsData) signs.set(i, s);

  // ---- water: the sea's surface (the kit's water material) ----
  const waterY = T.water - 0.12;
  // (its colours are the look's water slots: look.materials.water.shallow / deep)
  const water = new THREE.Mesh(new THREE.PlaneGeometry(sx * 6, sz * 6).rotateX(-Math.PI / 2), material('water', { transparent: true, opacity: 0.88 }));
  water.position.set(sx / 2, waterY, sz / 2); water.receiveShadow = true; water.renderOrder = 1; water.name = 'water';
  water.userData.gfSlot = 'look.materials.water.shallow';
  root.add(water);

  // ---- physics: one voxel collider for every solid cell, kept in step with every edit; walls round the world ----
  const RAPIER = ctx.RAPIER;
  const phys = ctx.physics;
  let collider = null; const colliders = [];
  // the sea's edge: an island's open sea (columns 2 or more below the water line, reached from the world's edge; not
  // a lake) is fenced where it meets the land, in the physics only (three cells from the water line up), so a player
  // wades into the shallows but never walks off down the seabed and out of sight (play-test 2026-10-09). Blocks still
  // go there; breaking one leaves the fence.
  const fence = new Set(), sea = new Uint8Array(sx * sz);
  if ((V.terrain?.kind ?? 'island') === 'island' && Number.isFinite(T.water) && T.heights) {
    const deep = (x, z) => T.heights[z * sx + x] <= T.water - 2, q = [];
    const visit = (x, z) => { if (x < 0 || z < 0 || x >= sx || z >= sz) return; const k = z * sx + x; if (sea[k] || !deep(x, z)) return; sea[k] = 1; q.push(k); };
    for (let x = 0; x < sx; x++) { visit(x, 0); visit(x, sz - 1); }
    for (let z = 0; z < sz; z++) { visit(0, z); visit(sx - 1, z); }
    while (q.length) { const k = q.pop(), x = k % sx, z = (k - x) / sx; visit(x + 1, z); visit(x - 1, z); visit(x, z + 1); visit(x, z - 1); }
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      if (!sea[z * sx + x]) continue;
      const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const X = x + dx, Z = z + dz; return X >= 0 && Z >= 0 && X < sx && Z < sz && !sea[Z * sx + X]; });
      if (shore) for (let y = T.water; y < Math.min(sy, T.water + 3); y++) fence.add(grid.index(x, y, z));
    }
  }
  const solidCells = () => {
    const cells = [];
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (grid.solidAt(x, y, z) || fence.has(grid.index(x, y, z))) cells.push(x, y, z);
    return cells;
  };
  if (RAPIER && phys?.createRigidBody) {
    const body = phys.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const cells = solidCells();
    collider = phys.createCollider(RAPIER.ColliderDesc.voxels(new Int32Array(cells), { x: 1, y: 1, z: 1 }).setFriction(0.8).setCollisionGroups(WORLD_GROUPS), body);
    collider.__gf = { tag: 'voxels' };
    colliders.push(collider);
    const H = sy + 20, t = 2;
    for (const [hx, hy, hz, px, py, pz] of [[sx / 2 + t, H, t / 2, sx / 2, H, -t / 2], [sx / 2 + t, H, t / 2, sx / 2, H, sz + t / 2], [t / 2, H, sz / 2 + t, -t / 2, H, sz / 2], [t / 2, H, sz / 2 + t, sx + t / 2, H, sz / 2]]) {
      const c = phys.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(px, py, pz).setCollisionGroups(WORLD_GROUPS), body);
      c.__gf = { tag: 'bounds' }; colliders.push(c);
    }
  }

  // ---- the look: shadows over the island ----
  let topY = 0; for (let i = 0; i < T.heights.length; i++) topY = Math.max(topY, T.heights[i]);
  const shadowBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx, topY + 10, sz));
  ctx.look?.fitShadows?.(shadowBox);
  const lampPoints = [];

  // ---- the world API ----
  const listeners = [];
  const protectedAt = (x, y, z) => y < floor || protect.some(b => x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]);
  function apply(x, y, z, v, { text, face } = {}) {
    if (!grid.inBounds(x, y, z)) return null;
    const i = grid.index(x, y, z), was = grid.data[i], wasSign = signs.get(i);
    const isSign = signN && (v & 255) === signN;
    if (was === v && !isSign) return { v: was, sign: wasSign };
    grid.set(x, y, z, v);
    const solidNow = !!table.info[v & 255]?.solid, solidBefore = !!table.info[was & 255]?.solid;
    if (collider && solidNow !== solidBefore) collider.setVoxel(x, y, z, solidNow || fence.has(i));
    if (isSign) signs.set(i, { text: String(text ?? wasSign?.text ?? ''), face: face ?? wasSign?.face ?? 5 }); else if (wasSign) signs.set(i, null);
    // a sign hangs on the block behind it: when that block comes or goes, the sign goes flat ↔ onto a post
    if (solidNow !== solidBefore) for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) { const j = grid.inBounds(x + d[0], y, z + d[2]) ? grid.index(x + d[0], y, z + d[2]) : -1; if (j >= 0 && signs.has(j)) signs.refresh(j); }
    for (const fn of listeners) { try { fn(x, y, z, v, { v: was, sign: wasSign }); } catch (e) { console.error(e); } }
    return { v: was, sign: wasSign };
  }
  function remeshNow(x, y, z) {
    const C = CHUNK, keys = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (grid.inBounds(nx, ny, nz)) keys.add(chunkKey(Math.floor(nx / C), Math.floor(ny / C), Math.floor(nz / C)));
    }
    for (const k of keys) if (grid.dirty.has(k)) { const [a, b, c] = k.split(',').map(Number); buildChunk(a, b, c); }
  }
  const camPos = new THREE.Vector3();
  function update() {
    if (!grid.dirty.size) return;
    // the nearest dirty chunks first, at most ~4 ms a frame (a boom or a late joiner's catch-up spreads over frames)
    const cam = ctx.look?.activeCamera ?? ctx.camera; if (cam) camPos.copy(cam.position);
    const list = [...grid.dirty].map(k => { const [a, b, c] = k.split(',').map(Number); return [a, b, c, (a * CHUNK + 8 - camPos.x) ** 2 + (b * CHUNK + 8 - camPos.y) ** 2 + (c * CHUNK + 8 - camPos.z) ** 2]; }).sort((p, q) => p[3] - q[3]);
    const start = performance.now();
    for (const [a, b, c] of list) { buildChunk(a, b, c); if (performance.now() - start > 4) break; }
  }
  const pick = (from, dir, max = 64) => grid.raycast(from, dir, max);

  const spawns = T.spawns.map(s => { const p = new THREE.Vector3(s.x, s.y, s.z); p.yaw = Math.atan2(T.plaza.at[0] + 0.5 - s.x, T.plaza.at[1] + 0.5 - s.z) + Math.PI; return p; });
  const bounds = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx, sy, sz));
  bounds.half = Math.max(sx, sz) / 2;
  const zonePlaza = { name: 'plaza', shape: 'box', at: new THREE.Vector3(T.plaza.at[0] + 0.5, T.plaza.y, T.plaza.at[1] + 0.5), size: [T.plaza.max[0] - T.plaza.min[0] + 1, 4, T.plaza.max[2] - T.plaza.min[2] + 1],
    contains: p => p.x >= T.plaza.min[0] && p.x <= T.plaza.max[0] + 1 && p.z >= T.plaza.min[2] && p.z <= T.plaza.max[2] + 1,
    random: (r = Math.random) => new THREE.Vector3(T.plaza.min[0] + 1 + r() * (T.plaza.max[0] - T.plaza.min[0] - 1), T.plaza.y, T.plaza.min[2] + 1 + r() * (T.plaza.max[2] - T.plaza.min[2] - 1)) };
  const zones = { plaza: zonePlaza };

  const world = {
    template: 'voxel', kind: 'outdoor', layout: cfg, root, group: root, bounds, shadowBounds: shadowBox, lampPoints,
    sizeClass: null, rooms: [], doors: [], entries: [], roomAt: () => null, via: () => null, entry: () => null,
    shapes: [], colliders, isWorld: c => colliders.includes(c), props: new Map(), catalog: {},
    spawns, spawn(i = 0) { const s = spawns[((i % spawns.length) + spawns.length) % spawns.length]; const p = s.clone(); p.yaw = s.yaw; return p; },
    zones, zone: name => zones[name] ?? null,
    raycast(from, dir, max = 100) {
      if (!RAPIER || !phys) return null;
      const d = dir.clone().normalize();
      const hit = phys.castRayAndGetNormal(new RAPIER.Ray(from, d), max, true, undefined, undefined, undefined, undefined, c => colliders.includes(c));
      if (!hit) return null;
      const t = hit.timeOfImpact ?? hit.toi;
      return { distance: t, point: new THREE.Vector3().copy(from).addScaledVector(d, t), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider };
    },
    update,
    voxel: {
      grid, table, signs, store, loaded, apply, pick, protectedAt, remeshNow, floor, protect, signN, terrain: T, water: T.water,
      /** Is the column at (x, z) the open sea (outside the fence)? */
      seaAt: (x, z) => x >= 0 && z >= 0 && x < sx && z < sz && !!sea[Math.floor(z) * sx + Math.floor(x)],
      textureImages, textureAverage: name => averages[name] ?? null,
      /** The operator restored the world (a reset on the play host): the island again, the saved world over it. */
      async reload() {
        grid.data.fill(0); signsData.clear();
        generateTerrain(grid, table, { ...(V.terrain ?? {}), blocks: V.terrain?.blocks });
        for (const [i, s] of welcome) { grid.data[i] = signN; signsData.set(i, s); }
        await loadSaved();
        for (const s of signs.list()) signs.set(s.index, null);
        for (const [i, s] of signsData) signs.set(i, s);
        grid.markAll();
        if (collider) {
          const body = collider.parent();
          phys.removeCollider(collider, false);
          const cells = solidCells();
          const c = phys.createCollider(RAPIER.ColliderDesc.voxels(new Int32Array(cells), { x: 1, y: 1, z: 1 }).setFriction(0.8).setCollisionGroups(WORLD_GROUPS), body);
          c.__gf = { tag: 'voxels' };
          colliders[colliders.indexOf(collider)] = c; collider = c;
        }
      },
      onApply(fn) { if (typeof fn === 'function') listeners.push(fn); },
      stats: () => ({ chunks: chunks.size, dirty: grid.dirty.size, meshMs, signs: signs.size, fence: fence.size, loaded: { ...loaded }, store: { mode: store.mode, seq: store.seq, queued: store.queued, ...store.stats } }),
    },
    dispose() { for (const list of chunks.values()) for (const m of list) m.geometry.dispose(); signs.dispose(); root.removeFromParent(); arrayTex.dispose(); },
  };
  ctx.world = world;
  return world;
}

/** Every block texture slot, drawn at TEX×TEX (by the quality tier) into one THREE.DataArrayTexture (row order flipped:
 *  v = 0 at the bottom). */
async function buildTextureArray(ctx, names) {
  const TEX = texSizeOf(ctx.quality);
  const L = names.length, data = new Uint8Array(TEX * TEX * 4 * L), images = {}, averages = {};
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = TEX;
  const c2 = canvas.getContext('2d', { willReadFrequently: true });
  for (let l = 0; l < L; l++) {
    let img = null;
    try { img = (await ctx.assets.texture(`world.voxel.texture.${names[l]}`))?.image ?? null; }
    catch (e) { console.warn(`gf-three voxel: texture ${names[l]}: ${e.message}`); }
    c2.clearRect(0, 0, TEX, TEX);
    if (img) { c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high'; c2.drawImage(img, 0, 0, TEX, TEX); }
    else { c2.fillStyle = '#ff00ff'; c2.fillRect(0, 0, TEX, TEX); }
    const px = c2.getImageData(0, 0, TEX, TEX).data;
    for (let y = 0; y < TEX; y++) data.set(px.subarray((TEX - 1 - y) * TEX * 4, (TEX - y) * TEX * 4), (l * TEX * TEX + y * TEX) * 4);
    images[names[l]] = img;
    // the face's average colour (its opaque pixels): debris and the like
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < px.length; k += 16) if (px[k + 3] > 128) { r += px[k]; g += px[k + 1]; b += px[k + 2]; n++; }
    averages[names[l]] = n ? `#${[r, g, b].map(c => Math.round(c / n).toString(16).padStart(2, '0')).join('')}` : '#999999';
  }
  const t = new THREE.DataArrayTexture(data, TEX, TEX, L);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  t.needsUpdate = true;
  return { texture: t, images, averages };
}

/** A house 'prop' material that samples the block texture array (attribute gfUvl = u, v, layer). */
function voxelMaterial(kind, arrayTex, V) {
  const opts = { vertexColors: true };
  if (kind === 'cutout' || kind === 'plant') { opts.alphaTest = 0.45; opts.side = kind === 'plant' ? THREE.DoubleSide : THREE.FrontSide; }
  if (kind === 'glass') { opts.transparent = true; opts.opacity = 1; }
  const m = material('prop', opts);
  if (kind === 'glass') m.depthWrite = false;
  const glow = kind === 'glow' ? (V.glow ?? 1.4) : 0;
  const house = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    house(sh, r);
    sh.uniforms.uGfBlocks = { value: arrayTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 gfUvl;\nattribute vec3 gfTint;\nvarying vec3 vGfUvl;\nvarying vec3 vGfTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGfUvl = gfUvl; vGfTint = gfTint;');
    // paint keeps the texture's light and dark under the colour (a pink brick wall still reads as brick)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uGfBlocks;\nvarying vec3 vGfUvl;\nvarying vec3 vGfTint;')
      .replace('#include <map_fragment>', `\tvec4 gfTex = texture( uGfBlocks, vec3( vGfUvl.xy, floor( vGfUvl.z + 0.5 ) ) );
\tif ( vGfTint.r + vGfTint.g + vGfTint.b > 0.0 ) { float gfL = dot( gfTex.rgb, vec3( 0.299, 0.587, 0.114 ) ); gfTex.rgb = vGfTint * ( 0.42 + 0.95 * gfL ); }
\tdiffuseColor *= gfTex;${DBG ? '\n\tgl_FragColor = vec4( gfTex.rgb, 1.0 ); return;' : ''}`);
    if (glow) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(3)};`);
  };
  const houseKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${houseKey()}-voxel-${kind}`;
  m.name = `gf-voxel-${kind}`;
  return m;
}
