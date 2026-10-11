// gf-three voxel world: the generated terrain. Deterministic from config/world.json → voxel.terrain (the same seed
// always gives the same island, so the world store only keeps the cells players changed). Pure (no three.js, no DOM).
//
//   voxel.terrain {
//     kind: 'island', seed, water (the sea's surface: cells below it are under water), ground (the island's base
//     height), radius (blocks), hills (how tall the highest hill rises over the ground), coast (how much the coast
//     wobbles, 0-1), beach (blocks of sand at the shore), lake ({at: [x, z], radius, depth} or null), trees (count),
//     plants (count), plaza: {at: [x, z], half, floor: '<block>', edge: '<block>', sign: [x, z] | null}
//     blocks: {grass, dirt, stone, sand, seabed, bedrock, log, leaves, plant, plants: [...]}   (block ids)
//   }
// → { heights (Int16Array sx*sz: the top of each column), spawns [{x, y, z}], plaza {min, max, y}, sign {cell, face} }

import { blockN } from './blocks.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value noise on an integer lattice, smoothed (seeded): enough for a coastline and rolling hills
function noise2(seed) {
  const h = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const s = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(n, x, y, oct = 4) { let a = 0, amp = 0.5, f = 1, sum = 0; for (let i = 0; i < oct; i++) { a += n(x * f, y * f) * amp; sum += amp; amp *= 0.5; f *= 2; } return a / sum; }

export const TERRAIN_DEFAULTS = {
  kind: 'island', seed: 1, water: 12, ground: 15, radius: 50, hills: 9, coast: 0.22, beach: 2, lake: null, trees: 40, plants: 300,
  plaza: { at: null, half: 6, floor: 'cobble', edge: 'stone-brick', sign: true },
};

export function generateTerrain(grid, table, cfg = {}) {
  const T = { ...TERRAIN_DEFAULTS, ...cfg, plaza: { ...TERRAIN_DEFAULTS.plaza, ...(cfg.plaza ?? {}) } };
  const B = cfg.blocks ?? {};
  const id = name => blockN(table, B[name] ?? name);
  const g = { grass: id('grass'), dirt: id('dirt'), stone: id('stone'), sand: id('sand'), seabed: id(B.seabed ? 'seabed' : 'sand'), bedrock: id('bedrock'), log: id('log'), leaves: id('leaves') };
  const plants = (B.plants ?? []).map(n => blockN(table, n));
  const [sx, sy, sz] = grid.size;
  const rnd = mulberry32(T.seed);
  const coastN = noise2(T.seed * 7 + 1), hillN = noise2(T.seed * 13 + 5), detailN = noise2(T.seed * 31 + 9);
  const cx = sx / 2, cz = sz / 2;
  const plazaAt = T.plaza.at ?? [Math.floor(cx), Math.floor(cz)];
  const heights = new Int16Array(sx * sz);
  const H = (x, z) => heights[z * sx + x];
  const water = T.water;

  // ---- the island's height field ----
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
    const ang = Math.atan2(dz, dx);
    const wob = 1 + T.coast * (coastN(Math.cos(ang) * 2.2 + 3, Math.sin(ang) * 2.2 + 3) * 2 - 1) * 1.6;
    const d = Math.hypot(dx, dz) / (T.radius * wob);          // 0 at the middle, 1 at the coast
    let h;
    if (d >= 1) {
      // the sea floor falls away from the coast
      h = Math.max(2, Math.round(water - 1 - Math.min(5, (d - 1) * 18)));
    } else {
      const rise = Math.min(1, (1 - d) * 4.5);               // a short slope up from the shore
      const hill = fbm(hillN, x / 26, z / 26) ** 1.7 * T.hills * Math.min(1, (1 - d) * 2.2);
      const detail = (fbm(detailN, x / 7, z / 7, 2) - 0.5) * 1.6;
      h = Math.round(water - 1 + (T.ground - water + 1) * rise + hill * rise + detail * rise);
    }
    // the lake: a bowl below the water line, its banks easing down to it (no cliff round the water)
    if (T.lake) {
      const ld = Math.hypot(x + 0.5 - T.lake.at[0], z + 0.5 - T.lake.at[1]) / T.lake.radius;
      if (ld < 1) h = Math.min(h, Math.round(water - (T.lake.depth ?? 3) * (1 - ld * ld) + ld * 1.4));
      else if (ld < 2.2) { const k = (ld - 1) / 1.2, s = k * k * (3 - 2 * k); h = Math.min(h, Math.round(water + 1 + (h - water - 1) * s)); }
    }
    heights[z * sx + x] = Math.max(1, Math.min(sy - 8, h));
  }

  // ---- the spawn plaza: level ground at the plaza's height, a floor of `floor` with an `edge` border ----
  const P = T.plaza, half = P.half;
  let plazaY = 0, n = 0;
  for (let z = plazaAt[1] - half; z <= plazaAt[1] + half; z++) for (let x = plazaAt[0] - half; x <= plazaAt[0] + half; x++) { plazaY += H(x, z); n++; }
  plazaY = Math.max(water + 2, Math.round(plazaY / n));
  for (let z = plazaAt[1] - half - 3; z <= plazaAt[1] + half + 3; z++) for (let x = plazaAt[0] - half - 3; x <= plazaAt[0] + half + 3; x++) {
    const ring = Math.max(Math.abs(x - plazaAt[0]), Math.abs(z - plazaAt[1])) - half;   // ≤ 0 inside, then 1, 2, 3 out
    const i = z * sx + x;
    if (ring <= 0) heights[i] = plazaY;
    else heights[i] = Math.round(plazaY + (heights[i] - plazaY) * (ring / 4));      // blend the land round it
  }

  // ---- fill the columns ----
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const h = H(x, z);
    for (let y = 0; y < h; y++) {
      const depth = h - 1 - y;
      let b;
      if (y === 0) b = g.bedrock;
      else if (h <= water + T.beach - 1) b = depth < 3 ? (h < water - 1 ? g.seabed : g.sand) : g.stone;
      else if (depth === 0) b = g.grass;
      else if (depth < 3 + (x * 7 + z * 3) % 2) b = g.dirt;
      else b = g.stone;
      grid.put(x, y, z, b);
    }
  }
  const floor = blockN(table, P.floor), edge = blockN(table, P.edge);
  for (let z = plazaAt[1] - half; z <= plazaAt[1] + half; z++) for (let x = plazaAt[0] - half; x <= plazaAt[0] + half; x++) {
    const border = Math.abs(x - plazaAt[0]) === half || Math.abs(z - plazaAt[1]) === half;
    grid.put(x, plazaY - 1, z, border ? edge : floor);
  }

  // ---- trees: away from the plaza and the water, not touching each other ----
  const plazaClear = (x, z, m) => Math.abs(x - plazaAt[0]) <= half + m && Math.abs(z - plazaAt[1]) <= half + m;
  const trees = [];
  for (let tries = 0; trees.length < T.trees && tries < T.trees * 40; tries++) {
    const x = 3 + Math.floor(rnd() * (sx - 6)), z = 3 + Math.floor(rnd() * (sz - 6));
    const h = H(x, z);
    if (h <= water + T.beach || plazaClear(x, z, 4) || grid.block(x, h - 1, z) !== g.grass) continue;
    if (trees.some(t => Math.abs(t[0] - x) < 5 && Math.abs(t[1] - z) < 5)) continue;
    if (T.lake && Math.hypot(x - T.lake.at[0], z - T.lake.at[1]) < T.lake.radius + 2) continue;
    trees.push([x, z]);
    const trunk = 4 + Math.floor(rnd() * 3);
    for (let y = h; y < h + trunk; y++) grid.put(x, y, z, g.log);
    const top = h + trunk;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 2 : dy === 0 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy !== -1 || rnd() < 0.5)) continue;   // round the corners
        if (dx === 0 && dz === 0 && dy < 0) continue;                                             // the trunk
        const yy = top + dy;
        if (!grid.block(x + dx, yy, z + dz)) grid.put(x + dx, yy, z + dz, g.leaves);
      }
    }
  }

  // ---- plants: tufts and flowers on grass ----
  if (plants.length) for (let k = 0; k < T.plants; k++) {
    const x = Math.floor(rnd() * sx), z = Math.floor(rnd() * sz), h = H(x, z);
    if (h <= water || plazaClear(x, z, 1) || grid.block(x, h - 1, z) !== g.grass || grid.block(x, h, z)) continue;
    grid.put(x, h, z, plants[Math.floor(rnd() * plants.length) % plants.length]);
  }

  // ---- spawns: round the plaza's middle; the welcome sign at its back edge ----
  const spawns = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, r = Math.max(1.5, half * 0.45);
    spawns.push({ x: plazaAt[0] + 0.5 + Math.cos(a) * r, y: plazaY, z: plazaAt[1] + 0.5 + Math.sin(a) * r });
  }
  const plaza = { min: [plazaAt[0] - half, 0, plazaAt[1] - half], max: [plazaAt[0] + half, sy - 1, plazaAt[1] + half], y: plazaY, at: plazaAt };
  const sign = P.sign ? { cell: [plazaAt[0], plazaY, plazaAt[1] - half + 1], face: 5 } : null;   // faces +z, into the plaza
  return { heights, spawns, plaza, sign, water, trees: trees.length };
}
