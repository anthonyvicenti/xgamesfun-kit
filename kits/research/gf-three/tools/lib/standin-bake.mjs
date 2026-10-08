#!/usr/bin/env node
// Bakes the STAND-IN prop models into tools/lib/standin-assets/*.glb: an offline generator (PLAN §2.2 R2: nothing
// visible is drawn in code at run time; a generator bakes to a file slot). They stand in for track L's curated CC0
// props until library/props.json has a match; `create` copies one into a game's assets/models/ as that prop's slot.
//
//   node research/gf-three/tools/lib/standin-bake.mjs      (needs research/asset-manifest's npm deps: @gltf-transform/core)
//
// Y up, +Z forward, metres, origin at the bottom centre. Deterministic: the same script gives the same bytes.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STANDIN_ASSETS, REPO } from './paths.mjs';

const { Document, NodeIO } = await import(join(REPO, 'research/asset-manifest/node_modules/@gltf-transform/core/dist/index.js'));

const hex = h => { const n = parseInt(h.slice(1), 16); const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1]; };

// ---- geometry (positions, normals, indices) ----
function box(sx, sy, sz, [cx, cy, cz] = [0, 0, 0], rotX = 0) {
  const P = [], N = [], I = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  const h = [sx / 2, sy / 2, sz / 2], c = Math.cos(rotX), s = Math.sin(rotX);
  const rot = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
  for (const [n, u, v] of faces) {
    const base = P.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map(k => n[k] * h[k] + u[k] * a * h[k] + v[k] * b * h[k]);
      const r = rot(p); P.push(r[0] + cx, r[1] + cy, r[2] + cz); N.push(...rot(n));
    }
    // winding: counter-clockwise seen from outside (cross(u, v) = n for every face above)
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { P, N, I };
}
function sphere(r, seg = 28, rings = 18, [cx, cy, cz] = [0, 0, 0]) {
  const P = [], N = [], I = [];
  for (let j = 0; j <= rings; j++) { const v = j / rings, th = v * Math.PI; for (let i = 0; i <= seg; i++) { const ph = (i / seg) * Math.PI * 2; const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; P.push(cx + n[0] * r, cy + n[1] * r, cz + n[2] * r); N.push(...n); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; I.push(a, a + 1, b, b, a + 1, b + 1); }
  return { P, N, I };
}
// the upper half of a sphere, squashed in y (a cap's crown)
function dome(r, sy = 0.7, seg = 24, rings = 8, [cx, cy, cz] = [0, 0, 0]) {
  const P = [], N = [], I = [];
  for (let j = 0; j <= rings; j++) { const th = (j / rings) * Math.PI / 2; for (let i = 0; i <= seg; i++) { const ph = (i / seg) * Math.PI * 2; const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; P.push(cx + n[0] * r, cy + n[1] * r * sy, cz + n[2] * r); const l = Math.hypot(n[0], n[1] / sy, n[2]); N.push(n[0] / l, n[1] / sy / l, n[2] / l); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; I.push(a, a + 1, b, b, a + 1, b + 1); }
  return { P, N, I };
}
function cylinder(r, h, [cx, cy, cz] = [0, 0, 0], seg = 16) {
  const P = [], N = [], I = [];
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); P.push(cx + x * r, cy - h / 2, cz + z * r, cx + x * r, cy + h / 2, cz + z * r); N.push(x, 0, z, x, 0, z); }
  for (let i = 0; i < seg; i++) { const a = i * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return { P, N, I };
}
const merge = parts => { const out = { P: [], N: [], I: [] }; for (const p of parts) { const b = out.P.length / 3; out.P.push(...p.P); out.N.push(...p.N); out.I.push(...p.I.map(i => i + b)); } return out; };

async function bake(name, meshes) {
  const doc = new Document(); doc.createBuffer();
  const scene = doc.createScene(name), root = doc.createNode(name);
  scene.addChild(root);
  for (const [i, m] of meshes.entries()) {
    const g = merge(m.parts);
    const mat = doc.createMaterial(m.name).setBaseColorFactor(hex(m.color)).setRoughnessFactor(m.rough ?? 0.75).setMetallicFactor(0);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.P)))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.N)))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.I)))
      .setMaterial(mat);
    root.addChild(doc.createNode(`${name}-${i}`).setMesh(doc.createMesh(m.name).addPrimitive(prim)));
  }
  const glb = await new NodeIO().writeBinary(doc);
  await mkdir(STANDIN_ASSETS, { recursive: true });
  await writeFile(join(STANDIN_ASSETS, `${name}.glb`), glb);
  return glb.length;
}

const sizes = {};
// a soft rubber ball, 0.44 m across
sizes.ball = await bake('ball', [{ name: 'rubber', color: '#e8483f', rough: 0.55, parts: [sphere(0.22, 28, 18, [0, 0.22, 0])] }]);
// a small playground slide: a deck on four posts, a ladder at the back, a chute down the front
{
  const H = 1.3, posts = [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([x, z]) => cylinder(0.05, H, [x, H / 2, z]));
  const rungs = [0.3, 0.6, 0.9, 1.2].map(y => box(0.9, 0.05, 0.06, [0, y, -0.55]));
  const len = Math.hypot(2.2, H), ang = Math.atan2(H, 2.2);
  sizes.slide = await bake('slide', [
    { name: 'frame', color: '#4f7cff', parts: [...posts, box(0.06, H + 0.2, 0.06, [-0.47, (H + 0.2) / 2, -0.55]), box(0.06, H + 0.2, 0.06, [0.47, (H + 0.2) / 2, -0.55]), ...rungs] },
    { name: 'deck', color: '#ffd166', parts: [box(1.0, 0.08, 1.0, [0, H, 0]), box(1.0, 0.3, 0.05, [0, H + 0.15, -0.5])] },
    { name: 'chute', color: '#ff7a59', rough: 0.45, parts: [box(0.8, 0.05, len, [0, H / 2, 0.5 + 1.1], ang), box(0.05, 0.18, len, [-0.42, H / 2 + 0.08, 0.5 + 1.1], ang), box(0.05, 0.18, len, [0.42, H / 2 + 0.08, 0.5 + 1.1], ang)] },
  ]);
}
// a wooden park bench, 1.6 m long
sizes.bench = await bake('bench', [
  { name: 'wood', color: '#c98b55', parts: [box(1.6, 0.07, 0.42, [0, 0.45, 0]), box(1.6, 0.3, 0.05, [0, 0.72, -0.2], -0.12)] },
  { name: 'legs', color: '#4a4a55', rough: 0.5, parts: [[-0.7, 0.16], [0.7, 0.16], [-0.7, -0.16], [0.7, -0.16]].map(([x, z]) => box(0.07, 0.45, 0.07, [x, 0.225, z])) },
]);
// a cap for the character.hat.<role> slot: origin on the crown's base (it sits on top of the head), +Z forward; brim
// forward, and a variant worn backwards
for (const [name, dir] of [['cap', 1], ['cap-backwards', -1]]) sizes[name] = await bake(name, [
  { name: 'crown', color: '#4f7cff', rough: 0.6, parts: [dome(0.15, 0.75, 24, 8, [0, -0.03, 0])] },
  { name: 'brim', color: '#3a5fd0', rough: 0.6, parts: [box(0.2, 0.018, 0.16, [0, -0.025, dir * 0.19])] },
  { name: 'button', color: '#ffffff', rough: 0.5, parts: [sphere(0.022, 10, 6, [0, 0.085, 0])] },
]);
// anything else: a crate
sizes.crate = await bake('crate', [{ name: 'crate', color: '#d9a066', parts: [box(0.8, 0.8, 0.8, [0, 0.4, 0])] }, { name: 'band', color: '#8a5a3a', parts: [box(0.84, 0.1, 0.84, [0, 0.4, 0])] }]);
console.log(Object.entries(sizes).map(([k, v]) => `${k}.glb ${v} B`).join(', '));
