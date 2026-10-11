// gf-three voxel world: the grid. Dense storage, chunk meshing with per-vertex ambient occlusion and paint, and a
// voxel ray walk. Pure: no three.js, no DOM, so Node tests import it (research/gf-three/tests/w-voxel.test.mjs).
//
// Adapted from games.fun's Blockhaven (research/foundations/trials/voxel-builder/source/src/voxel-world.mjs), which
// is adapted from the three.js r186 manual example `manual/examples/voxel-geometry-culled-faces-ui.html` (repo
// mrdoob/three.js, tag r186, commit 148ef33ecb6d2502ff796d4554abd1549c95d519; the repo is MIT and the example is
// BSD-3-Clause, Copyright 2018 Google Inc., from threejsfundamentals). The upstream file and both licence texts are in
// research/foundations/trials/voxel-builder/upstream/three-r186/; LICENSE-three-voxel beside this file.
// Kept from upstream: the per-face culled loop, the face table's corner positions and uvs, the Amanatides & Woo walk.
// Changed for gf-three: one dense Uint16Array (a cell's value is block | tint << 8, the world store's format, PLAN §4.1),
// fixed world size, cells indexed (y * sz + z) * sx + x (the snapshot's index), per-block face layers in a texture
// array instead of an atlas, buckets per block kind (solid, cutout, glass, glow), plants as crossed quads, paint as a
// vertex colour, AO with the quad-diagonal flip (from Blockhaven), dirty-chunk tracking, and a walk that returns the
// face it entered by.

export const CHUNK = 16;
export const blockOf = v => v & 255;
export const tintOf = v => v >> 8;
export const valueOf = (block, tint = 0) => ((tint & 255) << 8) | (block & 255);

// Brightness per AO level (0 = a fully closed corner, 3 = open), as in Blockhaven.
export const AO_CURVE = [0.5, 0.68, 0.85, 1];

// Faces: dir, the two in-plane axes for AO, which texture layer they take (side, top, bottom), and the four corners
// (position offsets in the cell, uv). Upstream's table, with the layer name in place of its atlas row.
export const FACES = [
  { name: 'left', dir: [-1, 0, 0], tangents: [1, 2], layer: 'side', corners: [{ pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { name: 'right', dir: [1, 0, 0], tangents: [1, 2], layer: 'side', corners: [{ pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { name: 'bottom', dir: [0, -1, 0], tangents: [0, 2], layer: 'bottom', corners: [{ pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { name: 'top', dir: [0, 1, 0], tangents: [0, 2], layer: 'top', corners: [{ pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { name: 'back', dir: [0, 0, -1], tangents: [0, 1], layer: 'side', corners: [{ pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { name: 'front', dir: [0, 0, 1], tangents: [0, 1], layer: 'side', corners: [{ pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];
// face index (0-5) → the world store's `face` (PLAN §4.1: −x, +x, −y, +y, −z, +z): the same order
export const FACE_DIRS = FACES.map(f => f.dir);
export const faceOfNormal = n => FACE_DIRS.findIndex(d => d[0] === n[0] && d[1] === n[1] && d[2] === n[2]);

/**
 * A block table entry the mesher reads (built by kit/world/voxel/blocks.mjs from config/world.json):
 *   { kind: 'solid'|'cutout'|'glass'|'glow'|'plant'|'sign'|'none', opaque (culls neighbours, darkens AO),
 *     solid (collides), layers: {top, side, bottom} (texture-array layers), color: [r, g, b] (linear multiplier) }
 */
export class VoxelGrid {
  constructor({ size, info = [], tints = [] }) {
    const [sx, sy, sz] = size;
    this.size = [sx, sy, sz];
    this.sx = sx; this.sy = sy; this.sz = sz;
    this.data = new Uint16Array(sx * sy * sz);
    this.info = info;               // info[block id]
    this.tints = tints;             // tints[tint index] = [r, g, b] linear (0: none)
    this.cx = Math.ceil(sx / CHUNK); this.cy = Math.ceil(sy / CHUNK); this.cz = Math.ceil(sz / CHUNK);
    this.dirty = new Set();         // chunk keys to re-mesh
    this.version = 0;
  }
  inBounds(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
  index(x, y, z) { return (y * this.sz + z) * this.sx + x; }
  cellOf(i) { const x = i % this.sx, r = (i - x) / this.sx, z = r % this.sz, y = (r - z) / this.sz; return [x, y, z]; }
  get(x, y, z) { return this.inBounds(x, y, z) ? this.data[this.index(x, y, z)] : 0; }
  block(x, y, z) { return this.get(x, y, z) & 255; }
  /** Set a cell (no dirty marking): terrain generation and bulk loads. */
  put(x, y, z, v) { if (this.inBounds(x, y, z)) this.data[this.index(x, y, z)] = v; }
  /** Set a cell and mark the chunks whose meshes change (its own, and a neighbour's when it sits on a border). → changed */
  set(x, y, z, v) {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    if (this.data[i] === v) return false;
    this.data[i] = v; this.version++;
    this.touch(x, y, z);
    return true;
  }
  /** Mark the chunk of (x, y, z) and the neighbours its faces and AO reach. */
  touch(x, y, z) {
    const C = CHUNK;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!this.inBounds(nx, ny, nz)) continue;
      this.dirty.add(chunkKey(Math.floor(nx / C), Math.floor(ny / C), Math.floor(nz / C)));
    }
  }
  markAll() { for (let x = 0; x < this.cx; x++) for (let y = 0; y < this.cy; y++) for (let z = 0; z < this.cz; z++) this.dirty.add(chunkKey(x, y, z)); }
  /** Opaque: culls a neighbour's face and darkens AO. */
  opaque(v) { const b = v & 255; if (!b) return false; return !!this.info[b]?.opaque; }
  solidAt(x, y, z) { const b = this.block(x, y, z); return !!b && !!this.info[b]?.solid; }
  /** The highest solid cell's top in column (x, z), or 0. */
  top(x, z) { for (let y = this.sy - 1; y >= 0; y--) if (this.solidAt(x, y, z)) return y + 1; return 0; }

  /**
   * One chunk's geometry: buckets by kind ({solid, cutout, glass, glow, plant}), each {positions, normals, uvl, colors,
   * indices} (plain arrays; uvl = u, v, texture layer). Signs are drawn by the world module, not here.
   */
  meshChunk(cx, cy, cz) {
    const C = CHUNK, info = this.info, tints = this.tints;
    const buckets = {};
    const bucket = k => (buckets[k] ??= { positions: [], normals: [], uvl: [], colors: [], tints: [], indices: [] });
    const x0 = cx * C, y0 = cy * C, z0 = cz * C;
    const x1 = Math.min(this.sx, x0 + C), y1 = Math.min(this.sy, y0 + C), z1 = Math.min(this.sz, z0 + C);
    const ao = [0, 0, 0, 0];
    const o = [0, 0, 0], s1 = [0, 0, 0], s2 = [0, 0, 0], cc = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const v = this.data[this.index(x, y, z)];
      if (!v) continue;
      const b = v & 255, I = info[b];
      if (!I || I.kind === 'none' || I.kind === 'sign') continue;
      // paint is its own attribute (the shader keeps the texture's detail under it); a block's own colour multiplies
      const tc = tints[v >> 8] ?? null, bc = I.color ?? null;
      const r0 = bc ? bc[0] : 1, g0 = bc ? bc[1] : 1, b0 = bc ? bc[2] : 1;
      const pr = tc ? tc[0] : 0, pg = tc ? tc[1] : 0, pb = tc ? tc[2] : 0;   // paint (never ta/tb: those are the AO tangents)
      if (I.kind === 'plant') { plantQuads(bucket('plant'), x, y, z, I.layers.side, [r0, g0, b0], [pr, pg, pb]); continue; }
      const out = bucket(I.kind);
      for (const F of FACES) {
        const nx = x + F.dir[0], ny = y + F.dir[1], nz = z + F.dir[2];
        if (ny < 0) continue;                       // the underside of the bottom layer is never seen
        const nv = this.get(nx, ny, nz), nb = nv & 255;
        if (nb) {
          const N = info[nb];
          // a face is hidden by an opaque neighbour, or by the same see-through block (glass beside glass, leaves beside leaves)
          if (N?.opaque || (nb === b && I.kind !== 'solid')) continue;
        }
        // AO: the three cells touching each corner on the face's side (Blockhaven)
        const [ta, tb] = F.tangents;
        for (let k = 0; k < 4; k++) {
          const pos = F.corners[k].pos, sa = pos[ta] ? 1 : -1, sb = pos[tb] ? 1 : -1;
          o[0] = nx; o[1] = ny; o[2] = nz;
          s1[0] = nx; s1[1] = ny; s1[2] = nz; s1[ta] += sa;
          s2[0] = nx; s2[1] = ny; s2[2] = nz; s2[tb] += sb;
          cc[0] = nx; cc[1] = ny; cc[2] = nz; cc[ta] += sa; cc[tb] += sb;
          const a = this.opaque(this.get(s1[0], s1[1], s1[2])) ? 1 : 0;
          const c2 = this.opaque(this.get(s2[0], s2[1], s2[2])) ? 1 : 0;
          const k3 = this.opaque(this.get(cc[0], cc[1], cc[2])) ? 1 : 0;
          ao[k] = a && c2 ? 0 : 3 - (a + c2 + k3);
        }
        const layer = I.layers[F.layer];
        const base = out.positions.length / 3;
        for (let k = 0; k < 4; k++) {
          const { pos, uv } = F.corners[k];
          out.positions.push(x + pos[0], y + pos[1], z + pos[2]);
          out.normals.push(F.dir[0], F.dir[1], F.dir[2]);
          out.uvl.push(uv[0], uv[1], layer);
          const shade = I.kind === 'glow' ? 1 : AO_CURVE[ao[k]];
          out.colors.push(r0 * shade, g0 * shade, b0 * shade);
          out.tints.push(pr, pg, pb);
        }
        // flip the quad's diagonal so AO interpolates without the classic anisotropy artefact (Blockhaven)
        if (ao[0] + ao[3] > ao[1] + ao[2]) out.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
        else out.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    return buckets;
  }

  /**
   * Walk the grid from `from` along `dir` (unit) for at most `max`: the first cell whose block `stop(block)` accepts
   * (default: any block but air and plants... plants count too, so a flower can be picked). → {cell, normal (the face
   * entered by, pointing back at `from`), face (0-5, FACES order), v, t} or null. Amanatides & Woo, as upstream.
   */
  raycast(from, dir, max = 64, stop = null) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    let ix = Math.floor(from.x), iy = Math.floor(from.y), iz = Math.floor(from.z);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    let tmx = Number.isFinite(tdx) ? tdx * (stepX > 0 ? ix + 1 - from.x : from.x - ix) : Infinity;
    let tmy = Number.isFinite(tdy) ? tdy * (stepY > 0 ? iy + 1 - from.y : from.y - iy) : Infinity;
    let tmz = Number.isFinite(tdz) ? tdz * (stepZ > 0 ? iz + 1 - from.z : from.z - iz) : Infinity;
    let t = 0, axis = -1;
    while (t <= max) {
      if (this.inBounds(ix, iy, iz)) {
        const v = this.data[this.index(ix, iy, iz)];
        if (v && (stop ? stop(v & 255, v) : true)) {
          const normal = [axis === 0 ? -stepX : 0, axis === 1 ? -stepY : 0, axis === 2 ? -stepZ : 0];
          return { cell: [ix, iy, iz], normal, face: axis < 0 ? -1 : faceOfNormal(normal), v, t };
        }
      }
      if (tmx < tmy) { if (tmx < tmz) { ix += stepX; t = tmx; tmx += tdx; axis = 0; } else { iz += stepZ; t = tmz; tmz += tdz; axis = 2; } }
      else if (tmy < tmz) { iy += stepY; t = tmy; tmy += tdy; axis = 1; } else { iz += stepZ; t = tmz; tmz += tdz; axis = 2; }
    }
    return null;
  }
}

export const chunkKey = (x, y, z) => `${x},${y},${z}`;

// a plant: two crossed quads through the cell, both sides drawn (the material is double-sided)
function plantQuads(out, x, y, z, layer, c, t = [0, 0, 0]) {
  const quads = [[[0.15, 0, 0.15], [0.85, 0, 0.85]], [[0.85, 0, 0.15], [0.15, 0, 0.85]]];
  for (const [a, b] of quads) {
    const base = out.positions.length / 3;
    const corners = [[a[0], 0, a[2], 0, 0], [b[0], 0, b[2], 1, 0], [a[0], 0.9, a[2], 0, 1], [b[0], 0.9, b[2], 1, 1]];
    for (const [px, py, pz, u, vv] of corners) {
      out.positions.push(x + px, y + py, z + pz);
      out.normals.push(0, 1, 0);       // lit like the ground it stands on, from either side
      out.uvl.push(u, vv, layer);
      out.colors.push(c[0], c[1], c[2]);
      out.tints.push(t[0], t[1], t[2]);
    }
    out.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}
