// gf-scenic world generation (CONTRACT §8), pure: no three.js, no DOM. create calls worldConfig(spec, opts) in Node to
// write config/world.json; the browser's world module (world.js) and the tests share every function here, and the same
// seed (the title's hash) always gives the same world.
//
// Templates (kind):
//   island   one grassy island (one per level) in a sea, a stone plaza in the middle, trees and lanterns round it
//   isles    floating islands over a void, one per level (default 3), with cliff skirts that taper to a hanging point,
//            streams that fall off the edge as waterfalls, glowing crystals, small islets drifting round each one
//   ruins    a stone arena among trees: a large paved floor, broken pillars and walls, braziers, a wood round it
//   dungeon  rooms joined by doorways (walls, torches, a dark stone floor), one room set per level, over the void
//
// A level (CONTRACT §8 "Levels") is {id, at, radius, half, last, spawns, zones: {arena, portal}, shape, plaza, paths,
// water, falls, cliff, rooms?, doors?}. Its play box (world.bounds for that level) is a square of half-size `half`
// inside the island: what the waves mechanic clamps enemies to; players walk the whole island inside its rim.
// Terrain data (folio-2025's terrain texture, Terrain.js: r paths and slabs, g grass, b water depth) is not stored:
// terrainData(cfg) computes it from the levels' shapes, plazas, paths and water, the same way in Node and the browser.

export const templates = ['island', 'isles', 'ruins', 'dungeon'];
// an island's outline radius at each size class (m)
export const SIZE_RADIUS = { small: 15, medium: 19, large: 24 };

export function hashString(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- shapes (pure) ----------
/** A level's outline radius at angle a (radians; 0 = +x, π/2 = +z): a superellipse with a seeded wobble. */
export function outlineRadius(shape, a) {
  const n = shape.n ?? 5, R = shape.radius;
  const c = Math.abs(Math.cos(a - (shape.rot ?? 0))), s = Math.abs(Math.sin(a - (shape.rot ?? 0)));
  const base = R * Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
  let w = 0;
  for (const [k, amp, ph] of shape.wobble ?? []) w += amp * Math.sin(k * a + ph);
  return base * (1 + w);
}
/** Signed distance (m, approximate) from (x, z) to a level's outline: negative inside. */
export function islandSdf(level, x, z) {
  const [cx, , cz] = level.at;
  const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
  return d - outlineRadius(level.shape, Math.atan2(dz, dx));
}
/** Distance outside a rounded rectangle {at:[x,z], half:[hx,hz], corner} (negative inside). */
export function roundRectSdf(rr, x, z) {
  const qx = Math.abs(x - rr.at[0]) - rr.half[0] + rr.corner, qz = Math.abs(z - rr.at[1]) - rr.half[1] + rr.corner;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rr.corner;
}
/** Distance from (x, z) to a polyline [[x, z], ...]. */
export function polylineDistance(pts, x, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}
// a cheap seeded value noise (for grass patches in the terrain data)
function valueNoise(seed) {
  const h = (i, j) => { let k = Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed; k = Math.imul(k ^ (k >>> 13), 1274126177); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return h(i, j) * (1 - u) * (1 - v) + h(i + 1, j) * u * (1 - v) + h(i, j + 1) * (1 - u) * v + h(i + 1, j + 1) * u * v;
  };
}

/** The walkable radius at angle a (inside the rim) and the play box half-size that fits inside it. */
export function walkRadius(level, a) { return outlineRadius(level.shape, a) - (level.rimInset ?? 1.2); }
export function playHalf(level) {
  let h = Infinity;
  for (let i = 0; i < 360; i++) { const a = (i / 360) * Math.PI * 2; h = Math.min(h, walkRadius(level, a) * Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)))); }
  return Math.max(4, h - 0.4);
}

// ---------- palettes: the world's colours (world.<t>.* slots), chosen to sit in each look ----------
const PALETTES = {
  'dusk-isle': { grass: '#2e5a33', grass2: '#4b8240', dirt: '#3b3a37', path: '#666a78', slabLow: '#454957', slabHigh: '#7f8496', cliff: '#5d5c70', cliff2: '#363546', moss: '#437a3a', water: '#2b8aa5', bed: '#13304c', foam: '#d9f4ff', fall: '#9fe9ff', sea: '#173d5c',
    leaves: { oak: ['#2f5a33', '#5c8c3f'], birch: ['#5f8a3a', '#8fb352'], cherry: ['#a35ad0', '#d796ff'], pine: ['#1f4634', '#356a43'], bush: ['#2c5530', '#4f8037'] }, flowers: ['#d9c8ff', '#ffffff', '#ffd27a', '#a8f0ff'], stone: '#6a647a', wood: '#5e4334', crystal: 'crystal' },
  'night-ruins': { grass: '#2c4a36', grass2: '#466b42', dirt: '#2f2b33', path: '#5e5a66', slabLow: '#45414c', slabHigh: '#7f7884', cliff: '#3e3f52', cliff2: '#25263a', moss: '#36573a', water: '#1e4f78', bed: '#0b1a33', foam: '#cfe0ff', fall: '#9fc4ff', sea: '#0d1d36',
    leaves: { oak: ['#23412f', '#3c6338'], birch: ['#45663a', '#6a8a4a'], cherry: ['#7a4aa0', '#a77ad0'], pine: ['#1a3a2c', '#2c5238'], bush: ['#213d2d', '#3a5e36'] }, flowers: ['#c9d4ff', '#ffffff', '#ffe0a0'], stone: '#5a5d72', wood: '#4a3a33', crystal: 'crystal' },
  'golden-meadow': { grass: '#a7a332', grass2: '#d0c346', dirt: '#8a5e3c', path: '#d9b48a', slabLow: '#a87762', slabHigh: '#ffcf8b', cliff: '#9c7a68', cliff2: '#6e5148', moss: '#9a9a35', water: '#4fb8b0', bed: '#1f4f6a', foam: '#ffffff', fall: '#c8f4ff', sea: '#2f7f95',
    leaves: { oak: ['#b4b536', '#d8cf3b'], birch: ['#ff4f2b', '#ff903f'], cherry: ['#ff6d6d', '#ff9990'], pine: ['#5f7a35', '#8a9a40'], bush: ['#b4b536', '#d8cf3b'] }, flowers: ['#ffffff', '#fff2c0', '#ffb0c8'], stone: '#c9a58a', wood: '#8a5a3c', crystal: 'crystal' },
  'storm-coast': { grass: '#4a6447', grass2: '#6a8057', dirt: '#4f4a46', path: '#8a8e96', slabLow: '#5a5e68', slabHigh: '#9aa0aa', cliff: '#5e6470', cliff2: '#3d424c', moss: '#4f6a48', water: '#3f7f95', bed: '#1a2f40', foam: '#e8f4ff', fall: '#cfe8ff', sea: '#2a4a5c',
    leaves: { oak: ['#3f5a3c', '#5f7a4a'], birch: ['#6a7f45', '#8f9f5a'], cherry: ['#a06a8a', '#c890aa'], pine: ['#2f4a3c', '#466246'], bush: ['#3a5238', '#566e45'] }, flowers: ['#e8eeff', '#ffffff'], stone: '#7a7f8a', wood: '#5e4a3e', crystal: 'crystal' },
  'clear-day': { grass: '#8fb33a', grass2: '#b8c84a', dirt: '#a07a52', path: '#e0c49a', slabLow: '#a87762', slabHigh: '#ffcf8b', cliff: '#8a7f8f', cliff2: '#5f5668', moss: '#7fa83a', water: '#5bc2b9', bed: '#13375f', foam: '#ffffff', fall: '#d4f6ff', sea: '#3fa6c0',
    leaves: { oak: ['#7fa52e', '#b4c83a'], birch: ['#ff4f2b', '#ff903f'], cherry: ['#ff6d6d', '#ff9990'], pine: ['#3f6a35', '#5f8a40'], bush: ['#7fa52e', '#a8bd3a'] }, flowers: ['#ffffff', '#fff2c0', '#ffc0d8'], stone: '#b8a79a', wood: '#8a5a3c', crystal: 'crystal' },
};
export const palettes = PALETTES;
// the looks whose plazas carry glowing rune lines (the creator's reference art); a world.<t>.runes slot turns them on or off
const RUNES = new Set(['dusk-isle', 'night-ruins']);
export function paletteFor(preset) { return JSON.parse(JSON.stringify(PALETTES[preset] ?? PALETTES['dusk-isle'])); }

/** How many levels the spec asks for: the levels mechanic's `count`, else rules.params.levels, else 1 (isles: 3). */
export function levelCount(spec) {
  const m = (spec.mechanics ?? []).find(x => x.id === 'levels');
  const n = Number(m?.params?.count ?? spec.rules?.params?.levels ?? (spec.world?.template === 'isles' ? 3 : 1));
  return Math.max(1, Math.min(8, Math.round(n) || 1));
}

// ---------- one island level ----------
const DIAG = [Math.SQRT1_2, Math.SQRT1_2];   // the follow camera looks along +x+z: "up the screen"

function islandLevel(i, L, T, R, at, rng, opts) {
  const n = T === 'ruins' ? 4.2 : 5;
  const wobble = Array.from({ length: 4 }, (_, k) => [2 + k * 2 + Math.floor(rng() * 2), r2((0.025 + rng() * 0.03) / (1 + k * 0.5)), r2(rng() * 6.28)]);
  const level = { id: `level-${i + 1}`, at, radius: R, last: i === L - 1, shape: { radius: R, n, rot: 0, wobble }, rimInset: 1.2 };
  const half = r2(playHalf(level));
  level.half = half;
  const [cx, , cz] = at;
  const next = opts.next ?? null;
  // the direction "on" (toward the next level, else up the screen) and "back" (where everyone arrives)
  let on = DIAG;
  if (next) { const dx = next[0] - cx, dz = next[2] - cz, d = Math.hypot(dx, dz) || 1; on = [dx / d, dz / d]; }
  const back = [-on[0], -on[1]], side = [-on[1], on[0]];
  // the stone plaza in the middle (the arena floor), a path from the back to it and from it to the portal
  const plazaHalf = r2(clamp(half * (T === 'ruins' ? 0.62 : 0.48), 4, 11));
  level.plaza = { at: [cx, cz], half: [plazaHalf, plazaHalf], corner: r2(plazaHalf * (T === 'ruins' ? 0.15 : 0.32)) };
  const portalD = Math.max(4, half - 2.6);
  const portal = [r2(cx + on[0] * portalD), 0, r2(cz + on[1] * portalD)];
  const spawnD = Math.max(3, Math.min(half - 2.5, plazaHalf + 1.5));
  const n0 = opts.players ?? 4;
  const spawns = Array.from({ length: n0 }, (_, k) => { const s = (k - (n0 - 1) / 2) * 1.6; return [r2(cx + back[0] * spawnD + side[0] * s), 0, r2(cz + back[1] * spawnD + side[1] * s)]; });
  const wr = walkRadius(level, Math.atan2(back[1], back[0]));
  level.paths = [
    { width: 2.2, points: [[r2(cx + back[0] * (wr + 0.6)), r2(cz + back[1] * (wr + 0.6))], [r2(cx + back[0] * plazaHalf * 0.6), r2(cz + back[1] * plazaHalf * 0.6)]] },
    { width: 2.4, points: [[r2(cx + on[0] * plazaHalf * 0.6), r2(cz + on[1] * plazaHalf * 0.6)], [portal[0], portal[2]]] },
  ];
  level.spawns = spawns;
  level.zones = {
    arena: { shape: 'circle', at: [cx, 0, cz], size: [r2(half - 1)] },
    portal: { shape: 'circle', at: portal, size: [2.2] },
    plaza: { shape: 'box', at: [cx, 0, cz], size: [plazaHalf * 2, 1, plazaHalf * 2] },
  };
  // water: a stream from a spring pond in a side band (outside the play box) to the edge, where it falls off
  level.water = [];
  level.falls = [];
  if (opts.water !== false) {
    const sgn = rng() < 0.5 ? 1 : -1;
    const a = Math.atan2(side[1] * sgn, side[0] * sgn) + (rng() - 0.5) * 0.5;
    const edge = outlineRadius(level.shape, a);
    const pondR = clamp((edge - half) * 0.45, 1.6, 3.2);
    const pondD = Math.max(half + pondR * 0.4, edge - pondR - 2.4);
    const pond = [r2(cx + Math.cos(a) * pondD), r2(cz + Math.sin(a) * pondD)];
    // the stream turns toward the camera's side of the island, so its waterfall faces the follow camera
    const back0 = Math.atan2(back[1], back[0]), toBack = Math.atan2(Math.sin(back0 - a), Math.cos(back0 - a));
    const b = a + Math.sign(toBack) * (0.55 + rng() * 0.25);
    const lip = outlineRadius(level.shape, b);
    const mid = [r2(cx + Math.cos((a + b) / 2) * (pondD + lip) / 2 + (rng() - 0.5)), r2(cz + Math.sin((a + b) / 2) * (pondD + lip) / 2 + (rng() - 0.5))];
    const out = [r2(cx + Math.cos(b) * (lip + 1.5)), r2(cz + Math.sin(b) * (lip + 1.5))];
    level.water.push({ pond: { at: pond, radius: r2(pondR) }, stream: { width: 2.3, points: [pond, mid, out] } });
    if (opts.void) level.falls.push({ at: [r2(cx + Math.cos(b) * (lip - 0.15)), -0.12, r2(cz + Math.sin(b) * (lip - 0.15))], angle: r2(b), width: 3.4, drop: r2(opts.depth * 0.95 + 6) });
  }
  level.cliff = { depth: opts.depth, kind: opts.void ? 'float' : 'shore' };
  return level;
}

// a prop's usual scale in a scenic world (folio's models are sized for its car)
const PROP_SCALE = { lantern: 0.8, 'pole-light': 0.8, bench: 0.62, crate: 0.8, fence: 1, brick: 0.85, bridge: 0.7 };
const ps = id => PROP_SCALE[id] ?? 1;
// a prop's half footprint at scale 1 (m; from library/props-folio.json sizes), so placements keep apart
const FOOT = { 'dungeon-column': 0.35, 'rock-1': 5.6, 'rock-2': 3.8, 'rock-3': 4.5, lantern: 0.45, 'pole-light': 0.37, bench: 1.3, crate: 0.56, fence: 1.1, brick: 0.8, bridge: 5.5, 'dungeon-pillar': 0.6, 'dungeon-wall-broken': 1.6, 'dungeon-rubble-small': 1.6 };

// ---------- dressing: vegetation, props, crystals, rocks, islets ----------
function dress(level, T, rng, out, pal, opts) {
  const [cx, , cz] = level.at;
  const half = level.half;
  const taken = [];
  const near = (x, z, r) => taken.some(t => Math.hypot(t[0] - x, t[1] - z) < r + t[2]);
  const inPlaza = (x, z, m = 0) => roundRectSdf(level.plaza, x, z) < m;
  const onPath = (x, z, m = 0) => level.paths.some(p => polylineDistance(p.points, x, z) < p.width / 2 + m);
  const inWater = (x, z, m = 0) => level.water.some(w => Math.hypot(x - w.pond.at[0], z - w.pond.at[1]) < w.pond.radius + m || polylineDistance(w.stream.points, x, z) < w.stream.width / 2 + m);
  const nearSpawn = (x, z, m) => level.spawns.some(s => Math.hypot(s[0] - x, s[2] - z) < m) || Math.hypot(level.zones.portal.at[0] - x, level.zones.portal.at[2] - z) < m + 1.5;
  const inBox = (x, z, m = 0) => Math.abs(x - cx) < half - m && Math.abs(z - cz) < half - m;
  const sdf = (x, z) => islandSdf(level, x, z);
  const pick = (test, tries = 60) => { for (let k = 0; k < tries; k++) { const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * level.radius; const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (test(x, z)) return [x, z]; } return null; };
  const ruins = T === 'ruins';

  // trees: mostly in the band outside the play box, a few at its edges; never on the plaza, a path, water or a spawn
  const kinds = ruins ? ['oak', 'pine', 'birch', 'oak'] : T === 'island' ? ['oak', 'birch', 'cherry', 'pine'] : ['pine', 'oak', 'pine', 'cherry'];
  const nTrees = Math.round(level.radius * (ruins ? 0.95 : T === 'isles' ? 0.62 : 0.8));
  for (let k = 0; k < nTrees; k++) {
    const p = pick((x, z) => sdf(x, z) < -1.6 && (T !== 'isles' || sdf(x, z) > -7) && !inPlaza(x, z, 2.5) && !onPath(x, z, 1.4) && !inWater(x, z, 1.2) && !nearSpawn(x, z, 3) && !near(x, z, 2.6) && (!inBox(x, z, 2.5) || rng() < 0.12));
    if (!p) continue;
    const kind = kinds[k % kinds.length];
    taken.push([p[0], p[1], 1.6]);
    out.vegetation.trees.push({ kind, at: [r2(p[0]), 0, r2(p[1])], rot: Math.round(rng() * 360), scale: r2((kind === 'pine' ? 0.75 : 0.55) + rng() * 0.35), level: level.id });
  }
  // bushes: along the edge and beside trees
  const nBush = Math.round(level.radius * 1.3);
  for (let k = 0; k < nBush; k++) {
    const p = pick((x, z) => sdf(x, z) < -0.6 && sdf(x, z) > -6 && !inPlaza(x, z, 1) && !onPath(x, z, 0.6) && !inWater(x, z, 0.4) && !nearSpawn(x, z, 2) && !near(x, z, 0.9));
    if (!p) continue;
    taken.push([p[0], p[1], 0.7]);
    out.vegetation.bushes.push([r2(p[0]), 0.35, r2(p[1]), r2(0.75 + rng() * 0.7)]);
  }
  // flowers: little clusters in the grass
  const nFlower = Math.round(level.radius * 1.4);
  for (let k = 0; k < nFlower; k++) {
    const p = pick((x, z) => sdf(x, z) < -1 && !inPlaza(x, z, 0.8) && !onPath(x, z, 0.4) && !inWater(x, z, 0.4));
    if (p) out.vegetation.flowers.push([r2(p[0]), 0, r2(p[1]), r2(0.7 + rng() * 0.5)]);
  }
  // lanterns: at the plaza's corners and along the paths (light points)
  const ph = level.plaza.half[0];
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [cx + sx * (ph + 0.8), cz + sz * (ph + 0.8)]);
  for (const [x, z] of corners) if (!onPath(x, z, 0.3) && !nearSpawn(x, z, 1.6)) { out.props.push({ prop: 'lantern', at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: ps('lantern'), level: level.id }); taken.push([x, z, 0.8]); }
  for (const p of level.paths) {
    const [a, b] = [p.points[0], p.points.at(-1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / (len || 1), nz = (b[0] - a[0]) / (len || 1);
    for (let t = 0.3; t < 0.95; t += 0.45) {
      const x = a[0] + (b[0] - a[0]) * t + nx * (p.width / 2 + 0.7), z = a[1] + (b[1] - a[1]) * t + nz * (p.width / 2 + 0.7);
      if (sdf(x, z) < -0.8 && !near(x, z, 0.8) && !inPlaza(x, z, 0.6)) { out.props.push({ prop: 'pole-light', at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: ps('pole-light'), level: level.id }); taken.push([x, z, 0.6]); }
    }
  }
  // glowing crystals just outside the arena's corners (the reference art's glowing arena), on looks with runes
  if (!ruins && T !== 'dungeon' && opts.runes) {
    const e = ph + 2.5;
    [[1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([sx, sz], k) => {
      const x = cx + sx * e, z = cz + sz * e;
      if (sdf(x, z) > -1 || onPath(x, z, 0.8) || near(x, z, 0.8) || nearSpawn(x, z, 1.6)) return;
      out.crystals.push({ at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: 1.15, glow: k % 2 ? 'rune' : 'crystal', level: level.id });
      taken.push([x, z, 0.9]);
    });
  }
  // the arena's border stones (KayKit stone posts): its corners and the middle of each side, never on a path
  if (!ruins && T !== 'dungeon') {
    const e = ph + 0.45;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + sx * e, z = cz + sz * e;
      if (onPath(x, z, 0.5) || near(x, z, 0.5) || nearSpawn(x, z, 1)) continue;
      out.props.push({ prop: 'dungeon-column', at: [r2(x), 0, r2(z)], rot: 0, scale: 1.25, level: level.id });
      taken.push([x, z, 0.5]);
    }
  }
  // benches (island, ruins) and rocks
  if (T !== 'isles') for (let k = 0; k < 2; k++) {
    const a = rng() * Math.PI * 2, x = cx + Math.cos(a) * (ph + 2.2), z = cz + Math.sin(a) * (ph + 2.2);
    if (!onPath(x, z, 1) && !near(x, z, 1.2) && !nearSpawn(x, z, 2)) { out.props.push({ prop: 'bench', at: [r2(x), 0, r2(z)], rot: Math.round((-a * 180) / Math.PI + 90), scale: ps('bench'), level: level.id }); taken.push([x, z, 1.2]); }
  }
  const nRock = Math.round(level.radius * 0.35);
  for (let k = 0; k < nRock; k++) {
    const id = `rock-${1 + Math.floor(rng() * 3)}`, sc = r2(0.22 + rng() * 0.22), foot = FOOT[id] * sc;
    const p = pick((x, z) => sdf(x, z) < -foot * 0.6 && sdf(x, z) > -6 && !inPlaza(x, z, foot + 0.5) && !onPath(x, z, foot) && !inWater(x, z, foot) && !nearSpawn(x, z, foot + 2) && !near(x, z, foot + 0.4));
    if (!p) continue;
    taken.push([p[0], p[1], foot]);
    out.props.push({ prop: id, at: [r2(p[0]), 0, r2(p[1])], rot: Math.round(rng() * 360), scale: sc, level: level.id });
  }
  // ruins: KayKit pillars round the plaza (some broken down to a stub), broken walls and rubble beyond, standing torches
  if (ruins) {
    const nP = 10;
    for (let k = 0; k < nP; k++) {
      const a = (k / nP) * Math.PI * 2 + 0.2, x = cx + Math.cos(a) * (ph + 1.6), z = cz + Math.sin(a) * (ph + 1.6);
      if (onPath(x, z, 0.8) || nearSpawn(x, z, 2) || near(x, z, 0.9)) continue;
      const id = rng() < 0.3 ? 'dungeon-column' : rng() < 0.4 ? 'dungeon-pillar-decorated' : 'dungeon-pillar';
      out.props.push({ prop: id, at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 4) * 90, scale: 1, level: level.id });
      taken.push([x, z, 1]);
    }
    for (let k = 0; k < 5; k++) {
      const p = pick((x, z) => sdf(x, z) < -2.2 && !inBox(x, z, -1) && !inPlaza(x, z, 2) && !onPath(x, z, 1.6) && !inWater(x, z, 1.5) && !near(x, z, 2.4));
      if (!p) continue;
      const id = ['dungeon-wall-broken', 'dungeon-wall-cracked', 'dungeon-rubble-small'][k % 3];
      out.props.push({ prop: id, at: [r2(p[0]), 0, r2(p[1])], rot: Math.round(rng() * 4) * 90 + (rng() - 0.5) * 20, scale: 1, level: level.id });
      taken.push([p[0], p[1], 2.2]);
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = cx + sx * (ph - 0.9), z = cz + sz * (ph - 0.9);
      if (!onPath(x, z, 0.4) && !near(x, z, 0.6) && !nearSpawn(x, z, 1.2)) { out.props.push({ prop: 'dungeon-torch', at: [r2(x), 0, r2(z)], rot: 0, scale: 1.4, level: level.id }); taken.push([x, z, 0.5]); }
    }
  }
  // a camp by the plaza on the islands: barrels and crates (KayKit) at one corner
  if (!ruins && T !== 'dungeon') {
    const sgn = rng() < 0.5 ? 1 : -1, x = cx + sgn * (ph + 2), z = cz - sgn * (ph * 0.4);
    if (sdf(x, z) < -2 && !onPath(x, z, 1) && !inWater(x, z, 1) && !near(x, z, 1.6) && !nearSpawn(x, z, 2)) {
      out.props.push({ prop: 'dungeon-barrel', at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: 0.75, level: level.id });
      out.props.push({ prop: 'dungeon-crates', at: [r2(x + 0.9), 0, r2(z + 1.1)], rot: Math.round(rng() * 360), scale: 0.75, level: level.id });
      taken.push([x, z, 1.8]);
    }
  }
  // crystals: glowing clusters at the edge of the play box and beside the portal (light points)
  const nC = T === 'isles' ? 6 : T === 'ruins' ? 4 : 3;
  for (let k = 0; k < nC; k++) {
    const p = pick((x, z) => sdf(x, z) < -0.8 && sdf(x, z) > -7 && !inPlaza(x, z, 1) && !onPath(x, z, 0.8) && !inWater(x, z, 0.6) && !near(x, z, 1.2) && !nearSpawn(x, z, 2.5), 120);
    if (!p) continue;
    taken.push([p[0], p[1], 1]);
    out.crystals.push({ at: [r2(p[0]), 0, r2(p[1])], rot: Math.round(rng() * 360), scale: r2(0.9 + rng() * 0.9), glow: k % 3 === 2 ? 'rune' : 'crystal', level: level.id });
  }
  // a pair flanking the portal (the levels mechanic draws the portal itself)
  {
    const pz = level.zones.portal.at, dx = pz[0] - cx, dz = pz[2] - cz, d = Math.hypot(dx, dz) || 1, sx = -dz / d, sz = dx / d;
    for (const s of [-1, 1]) { const x = pz[0] + sx * s * 3.1, z = pz[2] + sz * s * 3.1; if (sdf(x, z) < -0.6) { out.crystals.push({ at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: 1.35, glow: s < 0 ? 'crystal' : 'rune', level: level.id }); taken.push([x, z, 1]); } }
  }
  // islets: small floating rocks round a floating island, some with a tree or a crystal
  if (opts.void) {
    const nI = 4 + Math.floor(rng() * 3);
    for (let k = 0; k < nI; k++) {
      const a = (k / nI) * Math.PI * 2 + rng() * 0.8, d = outlineRadius(level.shape, a) + 5 + rng() * 9;
      const r = r2(1.2 + rng() * 2.2), y = r2(-3 + rng() * 6);
      const isl = { at: [r2(cx + Math.cos(a) * d), y, r2(cz + Math.sin(a) * d)], radius: r, depth: r2(r * (2.4 + rng() * 1.6)), seed: Math.floor(rng() * 1e6), level: level.id };
      const what = rng();
      if (what < 0.35) isl.crystal = rng() < 0.5 ? 'crystal' : 'rune';
      else if (what < 0.7 && r > 1.8) isl.tree = rng() < 0.5 ? 'pine' : 'oak';
      out.islets.push(isl);
    }
    // loose rocks hanging under and round the island
    for (let k = 0; k < 7; k++) {
      const a = rng() * Math.PI * 2, d = outlineRadius(level.shape, a) * (0.2 + rng() * 1.1);
      out.floaters.push({ at: [r2(cx + Math.cos(a) * d), r2(-opts.depth * (0.4 + rng() * 0.9)), r2(cz + Math.sin(a) * d)], scale: r2(0.4 + rng() * 1.1), rot: Math.round(rng() * 360), level: level.id });
    }
  }
}

// ---------- dungeon rooms (KayKit Dungeon Remastered's 3 m modules, research/gf-scenic/library/props.json) ----------
const M = 3;   // one wall or floor module
function dungeonLevel(i, L, at, rng, opts) {
  const [cx, , cz] = at;
  // the hall (15 x 15, the arena) in the middle of a 3 x 2 grid of 15 m cells, side rooms (9 x 9) round it; every edge
  // sits on the 1.5 m half-module grid and every doorway in the middle module of its wall
  // which side rooms: a seeded pick of the five cells round the hall (a back-row room needs the one in front of it)
  const cand = [[0, 0], [2, 0], [1, 1], [0, 1], [2, 1]];
  for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  const want = 3 + Math.floor(rng() * 2), order = [[1, 0]];
  for (let pass = 0; pass < 3 && order.length < want + 1; pass++) for (const c of cand) {
    if (order.length >= want + 1 || order.some(o => o[0] === c[0] && o[1] === c[1])) continue;
    if (c[1] === 1 && c[0] !== 1 && !order.some(o => o[0] === c[0] && o[1] === 0)) continue;
    order.push(c);
  }
  const count = order.length;
  const rooms = [];
  for (let k = 0; k < count; k++) {
    const [gx, gz] = order[k], main = k === 0, w = main ? 15 : 9;
    const x = cx + (gx - 1) * 15, z = cz + (gz === 0 ? 0 : 15);
    rooms.push({ id: main ? 'hall' : `room-${k}`, main, grid: [gx, gz], rect: [x - w / 2, z - w / 2, x + w / 2, z + w / 2] });
  }
  const byGrid = (gx, gz) => rooms.find(r => r.grid[0] === gx && r.grid[1] === gz);
  const centre = r => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
  const doors = [];
  for (const r of rooms.slice(1)) {
    const [gx, gz] = r.grid;
    const to = gz === 0 ? rooms[0] : (byGrid(gx, 0) ?? rooms[0]);
    const [ax, az] = centre(r), [bx, bz] = centre(to);
    doors.push({ rooms: [r.id, to.id], horiz: gz === to.grid[1], from: [ax, az], to: [bx, bz], width: M });
  }
  const xs = rooms.flatMap(r => [r.rect[0], r.rect[2]]), zs = rooms.flatMap(r => [r.rect[1], r.rect[3]]);
  const box = [Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1];
  const hall = rooms[0], [hx, hz] = centre(hall);
  const far = rooms.slice(1).reduce((b, r) => { const [x, z] = centre(r); const sc = (x - cx) * DIAG[0] + (z - cz) * DIAG[1]; return !b || sc > b.s ? { r, s: sc } : b; }, null)?.r ?? hall;
  const portal = centre(far);
  const n0 = opts.players ?? 4;
  const spawns = Array.from({ length: n0 }, (_, k) => [r2(hx - 4.2 + (k % 2) * 1.6), 0, r2(hz - 4.2 + Math.floor(k / 2) * 1.6)]);
  return {
    id: `level-${i + 1}`, at, radius: r2(Math.hypot(box[2] - box[0], box[3] - box[1]) / 2), half: r2(Math.max(box[2] - box[0], box[3] - box[1]) / 2), last: i === L - 1,
    box: box.map(r2), rooms, doors, spawns, tiles: true,
    zones: { arena: { shape: 'circle', at: [r2(hx), 0, r2(hz)], size: [6] }, portal: { shape: 'circle', at: [r2(portal[0]), 0, r2(portal[1])], size: [2.2] } },
    cliff: { depth: opts.depth, kind: 'float' },
  };
}

/** A dungeon level's KayKit pieces: floor tiles, walls with doorways (their doors open), low walls on the camera's
 *  side, corridors, wall torches, banners, and barrels, crates and chests in the corners. */
function dressDungeon(lv, rng, out) {
  const P = (prop, x, z, rot = 0, { y = 0, ...extra } = {}) => (/torch-wall|banner/.test(prop) ? out.fixtures : out.props).push({ prop, at: [r2(x), y, r2(z)], rot, scale: 1, level: lv.id, ...extra });
  const doorOn = (r, side) => lv.doors.find(d => d.rooms.includes(r.id) && (() => {
    const o = d.rooms[0] === r.id ? d.to : d.from, [x, z] = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2];
    return side === 'n' ? o[1] > z + 1 && d.horiz === false : side === 's' ? o[1] < z - 1 && d.horiz === false : side === 'e' ? o[0] > x + 1 && d.horiz : o[0] < x - 1 && d.horiz;
  })());
  const banners = ['dungeon-banner-green', 'dungeon-banner-blue', 'dungeon-banner-red'];
  const posts = new Set();
  const post = (x, z) => { const k = `${Math.round(x * 2)},${Math.round(z * 2)}`; if (!posts.has(k)) { posts.add(k); P('dungeon-column', x, z, 0); } };
  for (const r of lv.rooms) {
    const [x0, z0, x1, z1] = r.rect, w = x1 - x0, n = Math.round(w / M);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) P('dungeon-floor', x0 + M / 2 + a * M, z0 + M / 2 + b * M);
    // edges: s (z0, faces +z), n (z1, faces -z), w (x0, faces +x), e (x1, faces -x); s and w face the camera: low
    const edges = [['s', 0, (k) => [x0 + M / 2 + k * M, z0]], ['n', 180, (k) => [x0 + M / 2 + k * M, z1]], ['w', 90, (k) => [x0, z0 + M / 2 + k * M]], ['e', -90, (k) => [x1, z0 + M / 2 + k * M]]];
    for (const [side, rot, at] of edges) {
      const door = doorOn(r, side), low = side === 's' || side === 'w', mid = Math.floor(n / 2);
      for (let k = 0; k < n; k++) {
        const [x, z] = at(k);
        if (door && k === mid) { if (!low) P('dungeon-doorway', x, z, rot, { open: true }); continue; }
        if (low) { P('dungeon-barrier', x, z, rot); if (k > 0) post(...at(k - 0.5)); }
        else {
          P(rng() < 0.15 ? 'dungeon-wall-cracked' : 'dungeon-wall', x, z, rot);
          if (k % 2 === 1 && !(door && Math.abs(k - mid) === 1)) P('dungeon-torch-wall', x + (side === 'e' ? -0.375 : 0), z + (side === 'n' ? -0.375 : 0), rot, { y: 1.55 });
          else if (r.main && k % 2 === 0 && k !== mid) P(banners[k % banners.length], x, z, rot);
        }
      }
      // corner posts on the low sides
      if (low) { post(...at(-0.5)); post(...at(n - 0.5)); }
    }
    // the corners: a barrel, crates or a chest (not in the hall, where everyone fights)
    if (!r.main) {
      const corners = [[x1 - 1.2, z1 - 1.2], [x0 + 1.4, z1 - 1.2], [x1 - 1.2, z0 + 1.6]];
      const decor = ['dungeon-barrel', 'dungeon-crates', 'dungeon-keg', 'dungeon-crate', 'dungeon-barrels'];
      corners.forEach(([x, z], k) => { if (rng() < 0.7) P(decor[Math.floor(rng() * decor.length)], x, z, Math.round(rng() * 4) * 90); });
    }
  }
  // corridors: floor tiles and side walls across the gap between two rooms
  for (const d of lv.doors) {
    const ra = lv.rooms.find(r => r.id === d.rooms[0]), rb = lv.rooms.find(r => r.id === d.rooms[1]);
    if (d.horiz) {
      const [l, r] = ra.rect[2] < rb.rect[0] ? [ra.rect[2], rb.rect[0]] : [rb.rect[2], ra.rect[0]];
      for (let x = l + M / 2; x < r; x += M) { P('dungeon-floor', x, d.from[1]); P('dungeon-wall', x, d.from[1] + M / 2, 180); P('dungeon-barrier', x, d.from[1] - M / 2, 0); }
    } else {
      const [l, r] = ra.rect[3] < rb.rect[1] ? [ra.rect[3], rb.rect[1]] : [rb.rect[3], ra.rect[1]];
      for (let z = l + M / 2; z < r; z += M) { P('dungeon-floor', d.from[0], z); P('dungeon-wall', d.from[0] + M / 2, z, -90); P('dungeon-barrier', d.from[0] - M / 2, z, 90); }
    }
  }
  const last = lv.rooms.find(r => { const [x, z] = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2]; return Math.hypot(x - lv.zones.portal.at[0], z - lv.zones.portal.at[2]) < 1; });
  if (last) P('dungeon-chest-gold', last.rect[0] + 1.7, last.rect[1] + 1.9, 45);
}

/**
 * spec → config/world.json. opts (from gf-three's spec-config): {spawns, notes, assets, propFiles, named}; assets and
 * propFiles are filled with the folio models the layout uses (research/gf-scenic/library/folio/, MIT).
 */
export async function worldConfig(spec, opts = {}) {
  const { notes = [] } = opts;
  const T = templates.includes(spec.world?.template) ? spec.world.template : 'island';
  const size = spec.world?.size ?? 'medium';
  const R = SIZE_RADIUS[size] ?? SIZE_RADIUS.medium;
  const seed = hashString(`${spec.title}|world`);
  const preset = spec.look?.preset ?? 'dusk-isle';
  const cfg = generate({ template: T, size, seed, levels: levelCount(spec), players: Math.max(4, spec.players?.max ?? 4), preset });
  notes.push(`world: scenic ${T} at size ${size}, ${cfg.levels.length} level(s), island radius ${R} m, play box ${cfg.levels.map(l => (l.half * 2).toFixed(0)).join('/')} m (seed ${seed})`);
  if (spec.world?.props?.length) notes.push(`world: the scenic world dresses itself (trees, lanterns, crystals, rocks); the spec's props (${spec.world.props.map(p => p.name).join(', ')}) are placed by the game's mechanics or rules`);
  if (spec.world?.notes) cfg.notes = spec.world.notes;
  await attachCatalog(cfg, opts);
  return cfg;
}

/** The whole layout for a template, size, seed and level count. Pure. */
export function generate({ template = 'isles', size = 'medium', seed = 1, levels = null, players = 4, preset = 'dusk-isle' } = {}) {
  const T = templates.includes(template) ? template : 'island';
  const R = SIZE_RADIUS[size] ?? SIZE_RADIUS.medium;
  const rng = rngOf(seed);
  const L = Math.max(1, Math.min(8, levels ?? (T === 'isles' ? 3 : 1)));
  const isVoid = T !== 'island';
  const depth = T === 'dungeon' ? 9 : r2(R * 0.85);
  const pal = paletteFor(preset);
  // levels: the first at the origin, each next one on up the screen (+x+z) and a little to the side
  const gap = T === 'dungeon' ? 26 : 24;
  const step = (T === 'dungeon' ? 44 : R * 2) + gap;
  const ats = Array.from({ length: L }, (_, i) => [r2(i * step * 0.82), 0, r2(i * step * 0.57)]);
  const out = {
    template: T, kind: T, size, seed, preset, void: isVoid, sizeClass: size,
    ground: { grass: pal.grass, grass2: pal.grass2, dirt: pal.dirt, path: pal.path, slabLow: pal.slabLow, slabHigh: pal.slabHigh, cliff: pal.cliff, cliff2: pal.cliff2, moss: pal.moss, slabs: { file: 'assets/textures/slabs.png', size: 5.7 } },
    water: { color: pal.water, bed: pal.bed, foam: pal.foam, fall: pal.fall, depth: 0.45, ...(isVoid ? {} : { sea: pal.sea, seaLevel: -0.55 }) },
    foliage: { ...pal.leaves, texture: 'assets/textures/foliage-sdf.png' },
    flowers: pal.flowers,
    stone: pal.stone,
    wood: pal.wood,
    grass: { density: 1, height: 0.55, width: 0.1 },
    runes: RUNES.has(preset),
    levels: [], props: [], fixtures: [], structures: [], crystals: [], islets: [], floaters: [],
    vegetation: { trees: [], bushes: [], flowers: [] },
  };
  for (let i = 0; i < L; i++) {
    const lv = T === 'dungeon' ? dungeonLevel(i, L, ats[i], rng, { players, depth }) : islandLevel(i, L, T, R, ats[i], rng, { next: ats[i + 1] ?? null, players, void: isVoid, depth, water: T !== 'ruins' || i % 2 === 0 });
    out.levels.push(lv);
    if (T !== 'dungeon') dress(lv, T, rng, out, pal, { void: isVoid, depth, runes: RUNES.has(preset) });
    else {
      dressDungeon(lv, rng, out);
      const p = lv.zones.portal.at;
      out.crystals.push({ at: [r2(p[0] + 2.2), 0, r2(p[2] - 2.2)], rot: 0, scale: 1, glow: 'crystal', level: lv.id }, { at: [r2(p[0] - 2.2), 0, r2(p[2] + 2.2)], rot: 0, scale: 0.8, glow: 'rune', level: lv.id });
    }
  }
  const first = out.levels[0];
  out.radius = R; out.half = first.half;
  out.spawns = first.spawns;
  out.zones = { centre: { shape: 'circle', at: [first.at[0], 0, first.at[2]], size: [2] } };
  // the terrain data's extent (folio's terrain texture): every island, 0.25 m a texel
  out.terrain = terrainExtent(out);
  return out;
}

/** The world box the terrain data covers: [x0, z0, x1, z1] and the texel size. */
export function terrainExtent(cfg) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const lv of cfg.levels) {
    const r = lv.box ? 0 : lv.radius * 1.25 + 2;
    const b = lv.box ?? [lv.at[0] - r, lv.at[2] - r, lv.at[0] + r, lv.at[2] + r];
    x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[1]); x1 = Math.max(x1, b[2]); z1 = Math.max(z1, b[3]);
  }
  const span = Math.max(x1 - x0, z1 - z0);
  const texel = Math.max(0.25, span / 1024);
  return { box: [r2(x0), r2(z0), r2(x1), r2(z1)], texel: r2(texel) };
}

/**
 * folio-2025's terrain data, computed: an RGBA8 grid over cfg.terrain.box. r = path and slab (stone floor), g = grass,
 * b = water depth (0 dry, 1 deepest), a = 255 on an island (0 in the void or the sea). The glowing rune lines are drawn
 * by the floor shader from the levels' plazas and portals (terrain.js runeNode). → {data, width, height, box, texel}
 */
export function terrainData(cfg) {
  const { box, texel } = cfg.terrain ?? terrainExtent(cfg);
  const W = Math.max(2, Math.ceil((box[2] - box[0]) / texel)), H = Math.max(2, Math.ceil((box[3] - box[1]) / texel));
  const data = new Uint8Array(W * H * 4);
  const noise = valueNoise((cfg.seed ?? 1) | 0);
  for (const lv of cfg.levels) {
    const isl = !lv.box;
    const reach = isl ? lv.radius * 1.25 + 1 : 0;
    const bx = isl ? [lv.at[0] - reach, lv.at[2] - reach, lv.at[0] + reach, lv.at[2] + reach] : lv.box;
    const i0 = Math.max(0, Math.floor((bx[0] - box[0]) / texel)), i1 = Math.min(W - 1, Math.ceil((bx[2] - box[0]) / texel));
    const j0 = Math.max(0, Math.floor((bx[1] - box[1]) / texel)), j1 = Math.min(H - 1, Math.ceil((bx[3] - box[1]) / texel));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = box[0] + (i + 0.5) * texel, z = box[1] + (j + 0.5) * texel;
      let r = 0, g = 0, b = 0, a = 0;
      if (isl) {
        const sd = islandSdf(lv, x, z);
        if (sd > 0.6) continue;
        a = 1;
        // grass everywhere on the island, thinner in patches and toward the very edge
        const n = noise(x * 0.18, z * 0.18) * 0.65 + noise(x * 0.6 + 31, z * 0.6 + 7) * 0.35;
        g = smooth(0.08, 0.4, n) * smooth(0.4, -1.2, sd);
        // the plaza (crisp stone), paths (stone that breaks up at its sides)
        const pl = roundRectSdf(lv.plaza, x, z);
        r = Math.max(r, smooth(0.25, -0.25, pl));
        for (const p of lv.paths ?? []) { const d = polylineDistance(p.points, x, z) - p.width / 2; r = Math.max(r, smooth(0.45, -0.35, d + (n - 0.5) * 0.9)); }
        // water: the pond and the stream, deeper in the middle
        for (const w of lv.water ?? []) {
          const dp = Math.hypot(x - w.pond.at[0], z - w.pond.at[1]) - w.pond.radius;
          const ds = polylineDistance(w.stream.points, x, z) - w.stream.width / 2;
          const d = Math.min(dp, ds);
          b = Math.max(b, smooth(0.35, -1.4, d + (n - 0.5) * 0.5));
        }
        g *= 1 - r; g *= 1 - smooth(0.02, 0.2, b); r *= 1 - smooth(0.02, 0.15, b);
        a = 1;
      } else {
        // dungeon: stone floor in the rooms and the corridors, no grass
        const inRoom = lv.rooms.some(rm => x >= rm.rect[0] && x <= rm.rect[2] && z >= rm.rect[1] && z <= rm.rect[3]);
        const inDoor = (lv.doors ?? []).some(d => polylineDistance([d.from, d.to], x, z) < d.width / 2 + 0.2);
        if (!inRoom && !inDoor) continue;
        a = 1; r = 1;
      }
      const k = (j * W + i) * 4;
      data[k] = Math.max(data[k], Math.round(r * 255)); data[k + 1] = Math.max(data[k + 1], Math.round(g * 255)); data[k + 2] = Math.max(data[k + 2], Math.round(b * 255)); data[k + 3] = Math.max(data[k + 3], Math.round(a * 255));
    }
  }
  return { data, width: W, height: H, box, texel };
}

// ---------- the prop catalog (config/props.json) and the files a game gets ----------
// research/gf-scenic/library/props-folio.json is read in Node by attachCatalog (create); the browser reads the game's
// config/props.json. Kept out of the pure functions above so they stay importable anywhere.
let CATALOG = null;
async function readCatalog() {
  if (CATALOG) return CATALOG;
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const lib = path.resolve(here, '../../library');
  const read = f => (fs.existsSync(path.join(lib, f)) ? JSON.parse(fs.readFileSync(path.join(lib, f), 'utf8')) : null);
  const folio = read('props-folio.json'), kay = read('props.json'), lic = read('LICENSES.json');
  const flic = { spdx: folio.license.spdx, author: folio.license.author, url: folio.license.url };
  // folio-2025's models (MIT, this track) and track C's KayKit pieces (CC0, library/props.json + LICENSES.json)
  const entries = new Map();
  for (const p of folio.props) entries.set(p.id, { ...p, license: flic });
  for (const p of kay?.props ?? []) {
    const r = lic?.files?.[p.file];
    entries.set(p.id, { ...p, license: r ? { spdx: r.spdx, author: r.author, url: r.page ?? r.licenceFile } : { spdx: p.licence ?? 'CC0-1.0', author: 'Kay Lousberg (www.kaylousberg.com)', url: 'https://kaylousberg.itch.io/kaykit-dungeon-remastered' } });
  }
  CATALOG = { lib, folio, entries, flic };
  return CATALOG;
}
// the folio models every scenic world loads (trees and the shared textures), whatever it places
const ALWAYS = ['tree-oak', 'tree-birch', 'tree-cherry'];

/** create's half: config/props.json (the catalog entries the layout uses) and the model and texture files to copy. */
export async function attachCatalog(cfg, opts = {}) {
  cfg.__catalog = { schema: 'gf-scenic-props/1', about: 'The library entries this world uses (research/gf-scenic/library/props-folio.json: folio-2025, MIT; library/props.json: KayKit, CC0), each with its licence.', props: [] };
  {
    const { lib, entries, flic } = await readCatalog();
    const used = new Set([...ALWAYS, ...cfg.props.map(p => p.prop), ...(cfg.fixtures ?? []).map(p => p.prop)]);
    for (const id of [...used].sort()) {
      const e = entries.get(id);
      if (!e) { opts.notes?.push(`world: prop "${id}" is not in library/props-folio.json or library/props.json; left out`); cfg.props = cfg.props.filter(p => p.prop !== id); cfg.fixtures = (cfg.fixtures ?? []).filter(p => p.prop !== id); continue; }
      // a flat floor tile carries no collider of its own: the world puts one floor under each room and corridor
      const flat = (e.tags ?? []).some(t => t === 'floor' || t === 'tile') && (e.size?.[1] ?? 1) < 0.2;
      cfg.__catalog.props.push(flat ? { ...e, collider: 'none' } : e);
      const to = `assets/models/${id}.glb`, license = e.license;
      if (opts.assets && !opts.assets.some(a => a.to === to)) opts.assets.push({ to, from: `${lib}/${e.file}`, license });
      if (opts.propFiles) opts.propFiles[id] ??= { file: to, from: `library:folio/${id}`, license };
    }
    for (const [to, file] of [['assets/textures/slabs.png', 'folio/slabs.png'], ['assets/textures/foliage-sdf.png', 'folio/foliage-sdf.png']]) {
      if (opts.assets && !opts.assets.some(a => a.to === to)) opts.assets.push({ to, from: `${lib}/${file}`, license: flic });
    }
  }
  return cfg;
}
