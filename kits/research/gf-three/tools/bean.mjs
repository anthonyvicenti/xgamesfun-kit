#!/usr/bin/env node
// bean.mjs: the default player body. A procedural jelly-bean / chunky-toon character, skinned to gf-humanoid-1 and
// baked to GLB (R2: generated offline, played as a file slot). Needs no generation credits.
//
//   node research/gf-three/tools/bean.mjs [--variant <id>|all] [--out <dir>] [--color #hex]
//
// Variants share one recipe (body blob or torso+head, stubby limbs, mitten hands, shoes, big eyes) and differ in
// proportions. The body material is named `tint_body`, so the kit tints it per player; eyes and shoes keep colour.
import './lib/char-node.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, gltfCore, THREE } from './lib/char-deps.mjs';
import { optimizeDoc } from './lib/char-optimize.mjs';

const rig = await import('../kit/character/rig.js');
const here = dirname(fileURLToPath(import.meta.url));
const { Vector3 } = THREE;

/** Proportions in metres. x is the character's left. */
export const VARIANTS = {
  'bean-classic': {
    label: 'Jelly bean', color: '#ff7eb3', shoe: '#3d3a52',
    body: { bottom: 0.27, top: 1.32, width: 0.62, depth: 0.54, p: 2.3, taper: 0.1 },
    legs: { hipY: 0.36, apart: 0.12, r: 0.075 }, arms: { y: 0.8, len: 0.36, r: 0.064, hand: 0.078 },
    feet: { len: 0.2, w: 0.1, h: 0.085 },
    face: { y: 1.04, eyes: 0.115, eye: 0.088, mouthY: 0.9, blush: true },
  },
  'bean-chunky': {
    label: 'Chunky toon', color: '#4fc7c0', shoe: '#2b2f3a',
    body: { bottom: 0.3, top: 0.9, width: 0.6, depth: 0.48, p: 3.6, taper: -0.06 },
    head: { y: 1.12, r: 0.27, depth: 0.92 },
    legs: { hipY: 0.38, apart: 0.14, r: 0.095 }, arms: { y: 0.76, len: 0.4, r: 0.085, hand: 0.095 },
    feet: { len: 0.23, w: 0.12, h: 0.1 },
    face: { y: 1.15, eyes: 0.1, eye: 0.075, mouthY: 1.03, blush: false },
  },
  'bean-tall': {
    label: 'Tall bean', color: '#a98bff', shoe: '#2c2840',
    body: { bottom: 0.46, top: 1.62, width: 0.5, depth: 0.44, p: 2.2, taper: 0.06 },
    legs: { hipY: 0.55, apart: 0.1, r: 0.068 }, arms: { y: 1.08, len: 0.52, r: 0.058, hand: 0.07 },
    feet: { len: 0.2, w: 0.095, h: 0.08 },
    face: { y: 1.38, eyes: 0.1, eye: 0.075, mouthY: 1.25, blush: true },
  },
  'bean-gumdrop': {
    label: 'Gumdrop', color: '#ffc94a', shoe: '#4a3a2c',
    body: { bottom: 0.18, top: 1.0, width: 0.74, depth: 0.64, p: 2.0, taper: 0.28 },
    legs: { hipY: 0.26, apart: 0.15, r: 0.08 }, arms: { y: 0.55, len: 0.3, r: 0.066, hand: 0.08 },
    feet: { len: 0.21, w: 0.11, h: 0.085 },
    face: { y: 0.74, eyes: 0.13, eye: 0.095, mouthY: 0.6, blush: true },
  },
};

// ------------------------------------------------------------------ the skeleton (T-pose, identity frames)
function skeleton(v) {
  const B = v.body, L = v.legs, A = v.arms, F = v.feet;
  const span = (v.head ? v.head.y : B.top) - L.hipY;
  const top = v.head ? v.head.y - v.head.r * 0.55 : B.top - 0.26 * (B.top - B.bottom);
  const P = {
    Hips: [0, L.hipY, 0],
    Spine02: [0, L.hipY + span * 0.18, 0], Spine01: [0, L.hipY + span * 0.36, 0], Spine: [0, A.y - 0.02, 0],
    neck: [0, Math.max(A.y + 0.06, top - 0.12), 0], Head: [0, top, 0], head_end: [0, v.head ? v.head.y + v.head.r : B.top, 0],
  };
  const half = halfWidthAt(v, A.y);
  for (const [s, x] of [['Left', 1], ['Right', -1]]) {
    P[`${s}Shoulder`] = [x * 0.06, A.y, 0];
    P[`${s}Arm`] = [x * (half - A.r * 1.2), A.y, 0];
    P[`${s}ForeArm`] = [x * (half - A.r * 1.2 + A.len * 0.5), A.y, 0];
    P[`${s}Hand`] = [x * (half - A.r * 1.2 + A.len), A.y, 0];
    P[`${s}UpLeg`] = [x * L.apart, L.hipY, 0];
    P[`${s}Leg`] = [x * L.apart, (L.hipY + F.h) * 0.5, 0.005];
    P[`${s}Foot`] = [x * L.apart, F.h, 0];
    P[`${s}ToeBase`] = [x * L.apart, F.h * 0.35, F.len * 0.55];
  }
  return Object.fromEntries(Object.entries(P).map(([k, p]) => [k, new Vector3(...p)]));
}
/** The body's half-width at height y (0 outside the blob). */
function profile(v, y) {
  const B = v.body; const t = (y - B.bottom) / (B.top - B.bottom);
  if (t <= 0 || t >= 1) return 0;
  const r = Math.pow(1 - Math.pow(Math.abs(2 * t - 1), B.p), 1 / B.p);
  return r * (1 + B.taper * (0.5 - t)) * B.width / 2;
}
const halfWidthAt = (v, y) => profile(v, y) || v.body.width / 2;

// ------------------------------------------------------------------ parts: geometry + weights
// A part is { pos: [], nor: [], idx: [], j: [], w: [], mat }. Weights are lists of [bone, weight].
function part(mat) { return { pos: [], nor: [], idx: [], jw: [], mat }; }
function addGeometry(pt, geo, matrix, weigh) {
  geo = geo.index ? geo : geo;
  geo.applyMatrix4(matrix);
  const p = geo.attributes.position, n = geo.attributes.normal, base = pt.pos.length / 3;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    pt.pos.push(v.x, v.y, v.z);
    pt.nor.push(n.getX(i), n.getY(i), n.getZ(i));
    pt.jw.push(weigh(v));
  }
  const ix = geo.index ? geo.index.array : [...Array(p.count).keys()];
  for (const i of ix) pt.idx.push(base + i);
}
const lerpW = (a, b, t) => (t <= 0 ? [[a, 1]] : t >= 1 ? [[b, 1]] : [[a, 1 - t], [b, t]]);
/** Weight by height along a chain of [bone, y] (sorted bottom to top). */
function chainY(chain, y) {
  if (y <= chain[0][1]) return [[chain[0][0], 1]];
  for (let i = 0; i < chain.length - 1; i++) {
    const [a, ya] = chain[i], [b, yb] = chain[i + 1];
    if (y <= yb) { const t = (y - ya) / (yb - ya); return lerpW(a, b, t); }
  }
  return [[chain.at(-1)[0], 1]];
}
/** Weight along a limb segment list [[bone, from, to]] by projection, blending around the joints. */
function chainSeg(segs, v, blend = 0.3) {
  let best = 0, bestD = Infinity, bestT = 0;
  segs.forEach(([, a, b], i) => {
    const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, v.clone().sub(a).dot(ab) / ab.lengthSq()));
    const d = a.clone().addScaledVector(ab, t).distanceTo(v);
    if (d < bestD - 1e-6) { bestD = d; best = i; bestT = t; }
  });
  const [bone] = segs[best];
  if (best < segs.length - 1 && bestT > 1 - blend) return lerpW(bone, segs[best + 1][0], (bestT - (1 - blend)) / (2 * blend));
  if (best > 0 && bestT < blend) return lerpW(segs[best - 1][0], bone, 0.5 + bestT / (2 * blend));
  return [[bone, 1]];
}

function build(id, v) {
  const P = skeleton(v);
  const parts = { tint_body: part('tint_body'), shoe: part('shoe'), eye_white: part('eye_white'), eye_dark: part('eye_dark'), mouth: part('mouth'), blush: part('blush'),
    face_hurt: part('face_hurt'), mouth_hurt: part('mouth_hurt') };
  const M = (x, y, z, sx = 1, sy = 1, sz = 1, rot) => { const m = new THREE.Matrix4().compose(new Vector3(x, y, z), rot ?? new THREE.Quaternion(), new Vector3(sx, sy, sz)); return m; };
  const B = v.body, A = v.arms, L = v.legs, F = v.feet, FC = v.face;

  // body blob: a lathe with an elliptical cross-section (depth/width)
  const prof = [];
  const rings = 40;
  for (let i = 0; i <= rings; i++) { const t = i / rings; const y = B.bottom + t * (B.top - B.bottom); prof.push(new THREE.Vector2(Math.max(1e-4, profile(v, y + (i === 0 ? 1e-4 : i === rings ? -1e-4 : 0))), y)); }
  prof[0].x = 1e-4; prof[rings].x = 1e-4;
  const body = new THREE.LatheGeometry(prof, 48);
  body.computeVertexNormals();
  const spineChain = [['Hips', P.Hips.y], ['Spine02', P.Spine02.y], ['Spine01', P.Spine01.y], ['Spine', P.Spine.y], ['neck', P.neck.y], ['Head', P.Head.y]];
  addGeometry(parts.tint_body, body, M(0, 0, 0, 1, 1, B.depth / B.width), p => chainY(spineChain, p.y));
  if (v.head) {
    const h = new THREE.SphereGeometry(v.head.r, 40, 28);
    addGeometry(parts.tint_body, h, M(0, v.head.y, 0, 1, 0.96, v.head.depth), p => chainY([['neck', P.neck.y], ['Head', P.Head.y]], p.y));
    const nk = new THREE.CylinderGeometry(v.head.r * 0.45, v.head.r * 0.55, 0.16, 20);
    addGeometry(parts.tint_body, nk, M(0, (B.top + v.head.y - v.head.r) / 2, 0), p => chainY([['Spine', P.Spine.y], ['neck', P.neck.y], ['Head', P.Head.y]], p.y));
  }
  // limbs: capsules from joint to joint, a mitten at the hand, a shoe at the foot
  for (const [s, x] of [['Left', 1], ['Right', -1]]) {
    const a0 = P[`${s}Arm`].clone().add(new Vector3(-x * A.r * 0.8, 0, 0)), a1 = P[`${s}Hand`];
    const armLen = a0.distanceTo(a1);
    const arm = new THREE.CapsuleGeometry(A.r, armLen, 6, 16, 12);
    const q = new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(x, 0, 0));
    const armSegs = [[`${s}Arm`, P[`${s}Arm`], P[`${s}ForeArm`]], [`${s}ForeArm`, P[`${s}ForeArm`], P[`${s}Hand`]]];
    addGeometry(parts.tint_body, arm, M(...a0.clone().add(a1).multiplyScalar(0.5).toArray(), 1, 1, 1, q), p => chainSeg(armSegs, p, 0.22));
    const hand = new THREE.SphereGeometry(A.hand, 20, 14);
    addGeometry(parts.tint_body, hand, M(a1.x + x * A.hand * 0.55, a1.y, a1.z, 1.05, 0.85, 0.95), () => [[`${s}Hand`, 1]]);
    const l0 = P[`${s}UpLeg`], l1 = P[`${s}Foot`];
    const leg = new THREE.CapsuleGeometry(L.r, l0.distanceTo(l1), 6, 16, 12);
    const legSegs = [[`${s}UpLeg`, P[`${s}UpLeg`], P[`${s}Leg`]], [`${s}Leg`, P[`${s}Leg`], P[`${s}Foot`]]];
    addGeometry(parts.tint_body, leg, M(...l0.clone().add(l1).multiplyScalar(0.5).toArray()), p => p.y > P[`${s}UpLeg`].y ? [['Hips', 1]] : chainSeg(legSegs, p, 0.25));
    const shoe = new THREE.SphereGeometry(1, 24, 16);
    addGeometry(parts.shoe, shoe, M(l1.x, F.h * 0.5, F.len * 0.22, F.w, F.h * 0.62, F.len * 0.62), p => p.z > F.len * 0.35 ? lerpW(`${s}Foot`, `${s}ToeBase`, (p.z - F.len * 0.35) / (F.len * 0.3)) : [[`${s}Foot`, 1]]);
  }
  // face: eyes (white, pupil, highlight), a smile, blush; all on the Head bone
  const head = () => [['Head', 1]];
  const surfZ = (x, y) => {
    if (v.head) { const dy = (y - v.head.y) / 0.96; const r2 = v.head.r * v.head.r - x * x - dy * dy; return Math.sqrt(Math.max(0, r2)) * v.head.depth; }
    const r = profile(v, y); return Math.sqrt(Math.max(0, r * r - x * x)) * B.depth / B.width;
  };
  for (const x of [FC.eyes, -FC.eyes]) {
    const z = surfZ(x, FC.y);
    const n = new Vector3(x * 0.6, 0.05, z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
    const e = new THREE.SphereGeometry(FC.eye, 24, 18);
    addGeometry(parts.eye_white, e, M(x, FC.y, z - FC.eye * 0.35, 0.82, 1, 0.5, q), head);
    const pu = new THREE.SphereGeometry(FC.eye * 0.56, 20, 14);
    const pz = z - FC.eye * 0.35 + FC.eye * 0.5 * 0.82;
    addGeometry(parts.eye_dark, pu, M(x * 0.97, FC.y - FC.eye * 0.05, pz, 0.85, 1, 0.42, q), head);
    const hl = new THREE.SphereGeometry(FC.eye * 0.17, 12, 8);
    addGeometry(parts.eye_white, hl, M(x * 0.97 + FC.eye * 0.18, FC.y + FC.eye * 0.2, pz + FC.eye * 0.2, 1, 1, 0.5, q), head);
    if (FC.blush) {
      const bx = x * 1.55, by = FC.y - FC.eye * 1.25, bz = surfZ(bx, by);
      const bn = new Vector3(bx * 0.7, 0, bz).normalize();
      addGeometry(parts.blush, new THREE.SphereGeometry(FC.eye * 0.72, 16, 10), M(bx, by, bz - 0.004, 1, 0.58, 0.16, new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), bn)), head);
    }
  }
  // smile: a short tube along an arc that hugs the surface
  const pts = [];
  const mr = FC.eye * 0.2;
  for (let i = 0; i <= 16; i++) { const a = (i / 16 - 0.5) * 1.7; const x = Math.sin(a) * FC.eyes * 0.78, y = FC.mouthY + (1 - Math.cos(a)) * FC.eyes * 0.42; pts.push(new Vector3(x, y, surfZ(x, y) + mr * 0.35)); }
  const smile = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, mr, 10, false);
  addGeometry(parts.mouth, smile, new THREE.Matrix4(), head);
  // the hurt face (RIG.md §3, gfFaces): eyes squeezed shut as > <, a wide open mouth. The kit keeps it hidden and swaps
  // it in for the eyes and the smile while the body is being hit or is knocked down.
  const hr = FC.eye * 0.17, hw = FC.eye * 0.62, hh = FC.eye * 0.5;
  for (const x of [FC.eyes, -FC.eyes]) {
    const tip = x - Math.sign(x) * hw, out = x + Math.sign(x) * hw * 0.85;        // the point aims at the nose
    const ch = [[out, FC.y + hh], [tip, FC.y], [out, FC.y - hh]].map(([cx, cy]) => new Vector3(cx, cy, surfZ(cx, cy) + hr * 0.6));
    addGeometry(parts.face_hurt, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ch, false, 'catmullrom', 0.1), 24, hr, 8, false), new THREE.Matrix4(), head);
    for (const end of [ch[0], ch[2]]) addGeometry(parts.face_hurt, new THREE.SphereGeometry(hr, 10, 8), M(end.x, end.y, end.z), head);
  }
  const my = FC.mouthY + FC.eyes * 0.12, mz = surfZ(0, my);
  const mq = new THREE.Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 0.12, 1).normalize());
  addGeometry(parts.mouth_hurt, new THREE.SphereGeometry(1, 24, 14), M(0, my, mz - 0.006, FC.eyes * 0.62, FC.eyes * 0.5, FC.eye * 0.22, mq), head);
  return { P, parts };
}

// ------------------------------------------------------------------ write the GLB
const hex = c => { const col = new THREE.Color(c); return [col.r, col.g, col.b, 1]; };   // three converts sRGB hex to linear
export async function makeBean(id, { color } = {}) {
  const v = VARIANTS[id];
  if (!v) throw new Error(`no bean variant ${id} (have ${Object.keys(VARIANTS)})`);
  const { P, parts } = build(id, color ? { ...v, color } : v);
  const doc = new gltfCore.Document();
  doc.setLogger(new gltfCore.Logger(gltfCore.Logger.Verbosity.SILENT));
  const buf = doc.createBuffer();
  const names = rig.BONE_NAMES.filter(n => P[n]);
  const nodes = new Map();
  const root = doc.createNode('gf_body').setExtras({ gfRig: rig.RIG, gfBody: id, gfTint: ['tint_body'], gfSpineBend: 0.4, gfGenerator: 'research/gf-three/tools/bean.mjs',
    gfFaces: { hurt: { show: ['face_hurt', 'mouth_hurt'], hide: ['eye_white', 'eye_dark', 'mouth'] } } });
  for (const n of names) {
    const par = rig.canonicalParent(n, x => !!P[x]);
    const t = P[n].clone().sub(par ? P[par] : new Vector3());
    const node = doc.createNode(n).setTranslation(t.toArray());
    nodes.set(n, node);
    (par ? nodes.get(par) : root).addChild(node);
  }
  const ibm = doc.createAccessor('ibm').setType('MAT4').setBuffer(buf).setArray(new Float32Array(names.flatMap(n => new THREE.Matrix4().makeTranslation(-P[n].x, -P[n].y, -P[n].z).toArray())));
  const skin = doc.createSkin('gf_skin').setInverseBindMatrices(ibm).setSkeleton(nodes.get('Hips'));
  names.forEach(n => skin.addJoint(nodes.get(n)));
  const MAT = {
    tint_body: { color: (color ?? v.color), rough: 0.42 }, shoe: { color: v.shoe, rough: 0.6 }, eye_white: { color: '#fbfbff', rough: 0.25 },
    eye_dark: { color: '#17141f', rough: 0.2 }, mouth: { color: '#5b2238', rough: 0.5 }, blush: { color: '#ff8fa8', rough: 0.6 },
    face_hurt: { color: '#17141f', rough: 0.3 }, mouth_hurt: { color: '#4a1428', rough: 0.55 },
  };
  const mesh = doc.createMesh(id);
  const jIndex = new Map(names.map((n, i) => [n, i]));
  for (const [name, pt] of Object.entries(parts)) {
    if (!pt.idx.length) continue;
    const n = pt.pos.length / 3;
    const J = new Uint8Array(n * 4), W = new Float32Array(n * 4);
    pt.jw.forEach((list, i) => {
      const ent = list.filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const s = ent.reduce((a, [, w]) => a + w, 0);
      ent.forEach(([b, w], k) => { J[i * 4 + k] = jIndex.get(b); W[i * 4 + k] = w / s; });
    });
    const mat = doc.createMaterial(name).setBaseColorFactor(hex(MAT[name].color)).setRoughnessFactor(MAT[name].rough).setMetallicFactor(0);
    const prim = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(pt.pos)))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(pt.nor)))
      .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setBuffer(buf).setArray(J))
      .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setBuffer(buf).setArray(W))
      .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(n > 65535 ? new Uint32Array(pt.idx) : new Uint16Array(pt.idx)));
    mesh.addPrimitive(prim);
  }
  root.addChild(doc.createNode(id).setMesh(mesh).setSkin(skin));
  doc.createScene(id).addChild(root);
  await optimizeDoc(doc, {});
  return { bytes: await (await io()).writeBinary(doc), label: v.label, color: color ?? v.color };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const which = a('--variant', 'all');
  const out = resolve(a('--out', resolve(here, '../library/bodies')));
  mkdirSync(out, { recursive: true });
  for (const id of which === 'all' ? Object.keys(VARIANTS) : [which]) {
    const r = await makeBean(id, { color: a('--color') });
    writeFileSync(resolve(out, `${id}.glb`), r.bytes);
    console.log(`${id}.glb  ${(r.bytes.length / 1024).toFixed(0)} KB  ${r.label}`);
  }
}
