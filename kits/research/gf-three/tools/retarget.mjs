#!/usr/bin/env node
// retarget.mjs: the shared gf-humanoid-1 clip file, from the Quaternius Universal Animation Library (CC0), plus the
// UAL mannequin as a body on the standard.
//
//   node research/gf-three/tools/retarget.mjs [--clips <out.glb>] [--body <out.glb>] [--no-body]
//
// Clips UAL lacks (carry, emote_wave, emote_cheer, getup, getup_front) are authored here from a few key poses
// (tools/lib/char-pose.mjs), on the same standard skeleton. Every clip carries a rotation track for every standard
// bone and a translation track for the hips, so any clip can be blended with any other.
import './lib/char-node.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, gltfCore, gltfFn, MeshoptEncoder, THREE } from './lib/char-deps.mjs';
import { ualBytes, loadUAL, SOURCE } from './lib/char-ual.mjs';
import { bake } from './lib/char-pose.mjs';
import { normalizeBody } from './lib/char-gltf.mjs';
import { optimizeDoc } from './lib/char-optimize.mjs';

const rig = await import('../kit/character/rig.js');
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT_CLIPS = resolve(arg('--clips', resolve(here, '../library/clips/gf-humanoid-1.glb')));
const OUT_BODY = resolve(arg('--body', resolve(here, '../library/bodies/ual-mannequin.glb')));
const FPS = 30;

/** gf clip ← UAL clip. layer: which layer character.js plays it on by default; loop; speed is measured below. */
export const FROM_UAL = {
  idle: ['Idle_Loop', { loop: true }],
  walk: ['Walk_Loop', { loop: true, gait: true }],
  run: ['Jog_Fwd_Loop', { loop: true, gait: true }],
  sprint: ['Sprint_Loop', { loop: true, gait: true }],
  jump: ['Jump_Start', {}],
  fall: ['Jump_Loop', { loop: true }],
  land: ['Jump_Land', {}],
  hit: ['Hit_Chest', { layer: 'upper' }],
  hit_head: ['Hit_Head', { layer: 'upper' }],
  knockdown: ['Death01', {}],
  aim: ['Pistol_Aim_Neutral', { loop: true, layer: 'upper' }],
  aim_up: ['Pistol_Aim_Up', { loop: true, layer: 'upper' }],
  aim_down: ['Pistol_Aim_Down', { loop: true, layer: 'upper' }],
  interact: ['Interact', { layer: 'upper' }],
  throw: ['Spell_Simple_Shoot', { layer: 'upper' }],
  punch: ['Punch_Jab', { layer: 'upper' }],
  pickup: ['PickUp_Table', {}],
  push: ['Push_Loop', { loop: true }],
  crouch: ['Crouch_Idle_Loop', { loop: true }],
  crouch_walk: ['Crouch_Fwd_Loop', { loop: true, gait: true }],
  roll: ['Roll', {}],
  sit: ['Sitting_Idle_Loop', { loop: true }],
  swim: ['Swim_Fwd_Loop', { loop: true }],
  swim_idle: ['Swim_Idle_Loop', { loop: true }],
  emote_dance: ['Dance_Loop', { loop: true }],
  emote_talk: ['Idle_Talking_Loop', { loop: true }],
};

const U = await loadUAL(await ualBytes());
const { std } = U;
const clips = new Map();       // name → { times, frames, meta }
for (const [gf, [src, meta]] of Object.entries(FROM_UAL)) {
  const c = U.convert(src, { fps: FPS });
  clips.set(gf, { ...c, meta: { ...meta, source: `UAL ${src}` } });
}

// ------------------------------------------------------------------ authored clips
const V = (...a) => new THREE.Vector3(...a);
const idleAt = t => U.sample('Idle_Loop', t);
const mirror = ([x, y, z]) => [-x, y, z];
function arms(p, l, r = l && l.map(mirror)) {
  if (l) { std.point(p, 'LeftArm', l[0]); std.point(p, 'LeftForeArm', l[1]); }
  if (r) { std.point(p, 'RightArm', r[0]); std.point(p, 'RightForeArm', r[1]); }
  return p;
}

// carry: hold something in both hands in front of the chest; idle's breathing kept underneath (upper layer)
{
  const keys = [];
  for (let t = 0; t <= 2.5001; t += 0.5) keys.push({ t, pose: arms(idleAt(t % 2.5), [[0.22, -0.5, 0.84], [-0.32, 0.18, 0.93]]), ease: 'linear' });
  clips.set('carry', { ...bake(std, keys, FPS), meta: { loop: true, layer: 'upper', source: 'authored on UAL Idle_Loop' } });
}
// emote_wave: right arm up, forearm waves over the head, back down
{
  const up = (t, side) => { const p = idleAt(t); std.point(p, 'RightArm', [-0.5, 0.82, 0.12]); std.point(p, 'RightForeArm', side ? [-0.55, 0.8, 0.22] : [0.15, 0.95, 0.22]); std.turn(p, 'Head', [0, -12, 6]); return p; };
  const keys = [{ t: 0, pose: idleAt(0) }, { t: 0.32, pose: up(0.3, 1) }];
  let t = 0.32; for (let i = 0; i < 6; i++) { t += 0.22; keys.push({ t, pose: up(t, i % 2) }); }
  keys.push({ t: t + 0.18, pose: up(t, 1) }, { t: t + 0.55, pose: idleAt(t + 0.55) });
  clips.set('emote_wave', { ...bake(std, keys, FPS), meta: { source: 'authored on UAL Idle_Loop' } });
}
// emote_cheer: both arms shoot up in a V and pump, with a little bounce
{
  const V_ = (t, high) => {
    const p = idleAt(t);
    arms(p, high ? [[0.5, 0.86, 0.12], [0.3, 0.95, 0.1]] : [[0.75, 0.5, 0.2], [-0.15, 0.9, 0.3]]);
    std.turn(p, 'Head', [high ? -14 : -6, 0, 0]);
    p.hips.y += high ? 0.045 : -0.02;
    return p;
  };
  const keys = [{ t: 0, pose: idleAt(0) }];
  let t = 0.22; keys.push({ t, pose: V_(t, true) });
  for (let i = 0; i < 4; i++) { t += 0.24; keys.push({ t, pose: V_(t, i % 2 === 1) }); }
  keys.push({ t: t + 0.35, pose: V_(t + 0.35, true) }, { t: t + 0.75, pose: idleAt(t + 0.75) });
  clips.set('emote_cheer', { ...bake(std, keys, FPS), meta: { source: 'authored on UAL Idle_Loop' } });
}
// getup (from lying on the back, head toward -Z) and getup_front (face down, head toward +Z). Root motion: the
// character ends standing at the origin; it starts with the hips where the ragdoll's pelvis is (meta.start).
function lying(onBack) {
  const p = idleAt(0);
  const r = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(onBack ? -90 : 90), 0, 0));
  p.q.set('Hips', r.multiply(p.q.get('Hips')));
  const toFeet = onBack ? 1 : -1;   // on the back the feet are toward +Z; face down, toward -Z
  arms(p, [[0.28, -0.12, 0.95 * toFeet], [0.12, -0.1, toFeet]]);
  return p;
}
function pose({ hips, rot, spine, feet, hands, head, kneeHint = [0, 0, 1], elbowHint = [0, -0.3, -1] }) {
  const p = idleAt(0);
  std.hips(p, rot, hips);
  if (spine) for (const n of ['Spine02', 'Spine01', 'Spine']) std.point(p, n, spine);
  if (head) std.point(p, 'neck', head, 'Head');
  if (feet) {
    std.ik(p, 'LeftUpLeg', 'LeftLeg', 'LeftFoot', feet, kneeHint);
    std.ik(p, 'RightUpLeg', 'RightLeg', 'RightFoot', mirror(feet), kneeHint);
    std.point(p, 'LeftFoot', [0, -0.45, 1], 'LeftToeBase'); std.point(p, 'RightFoot', [0, -0.45, 1], 'RightToeBase');
  }
  if (hands) {
    std.ik(p, 'LeftArm', 'LeftForeArm', 'LeftHand', hands, [0.4, elbowHint[1], elbowHint[2]]);
    std.ik(p, 'RightArm', 'RightForeArm', 'RightHand', mirror(hands), [-0.4, elbowHint[1], elbowHint[2]]);
  }
  return p;
}
{
  const start = [0, 0.11, -0.5];
  const k0 = lying(true); k0.hips.set(...start);
  const k1 = pose({ hips: [0, 0.13, -0.46], rot: [-55, 0, 0], spine: [0, 0.6, 0.8], head: [0, 0.4, 0.9], feet: [0.12, 0.08, 0.45], hands: [0.32, 0.06, -0.7], kneeHint: [0, 1, 0.2] });
  const k2 = pose({ hips: [0, 0.18, -0.35], rot: [-15, 0, 0], spine: [0, 0.75, 0.65], head: [0, 0.6, 0.8], feet: [0.13, 0.06, 0.08], hands: [0.34, 0.05, -0.62], kneeHint: [0, 1, 0.4] });
  const k3 = pose({ hips: [0, 0.42, -0.2], rot: [30, 0, 0], spine: [0, 0.65, 0.76], head: [0, 0.5, 0.85], feet: [0.13, 0.06, 0.02], hands: [0.3, 0.45, 0.3], kneeHint: [0, 0.3, 1] });
  const k4 = pose({ hips: [0, 0.7, -0.1], rot: [12, 0, 0], spine: [0, 0.9, 0.42], head: [0, 0.85, 0.5], feet: [0.12, 0.06, 0.0], hands: [0.3, 0.75, 0.15], kneeHint: [0, 0.2, 1] });
  const k5 = idleAt(0);
  const keys = [{ t: 0, pose: k0 }, { t: 0.42, pose: k1 }, { t: 0.82, pose: k2 }, { t: 1.2, pose: k3 }, { t: 1.55, pose: k4 }, { t: 1.95, pose: k5 }];
  clips.set('getup', { ...bake(std, keys, FPS), meta: { source: 'authored (UAL Idle_Loop limbs)', start, from: 'back' } });
}
{
  const start = [0, 0.11, -0.62];
  const k0 = lying(false); k0.hips.set(...start);
  const k1 = pose({ hips: [0, 0.2, -0.6], rot: [70, 0, 0], spine: [0, 0.45, 0.9], head: [0, 0.6, 0.8], feet: [0.12, 0.05, -1.4], hands: [0.26, 0.03, -0.12], kneeHint: [0, -1, 0.1], elbowHint: [0, 0.2, -1] });
  const k2 = pose({ hips: [0, 0.48, -0.42], rot: [55, 0, 0], spine: [0, 0.55, 0.84], head: [0, 0.4, 0.9], feet: [0.13, 0.08, -0.85], hands: [0.27, 0.03, -0.05], kneeHint: [0, -1, 0.6] });
  const k3 = pose({ hips: [0, 0.5, -0.18], rot: [35, 0, 0], spine: [0, 0.6, 0.8], head: [0, 0.6, 0.8], feet: [0.13, 0.06, -0.05], hands: [0.27, 0.05, 0.12], kneeHint: [0, 0.3, 1] });
  const k4 = pose({ hips: [0, 0.72, -0.1], rot: [12, 0, 0], spine: [0, 0.9, 0.42], head: [0, 0.85, 0.5], feet: [0.12, 0.06, 0.0], hands: [0.3, 0.75, 0.15], kneeHint: [0, 0.2, 1] });
  const k5 = idleAt(0);
  const keys = [{ t: 0, pose: k0 }, { t: 0.42, pose: k1 }, { t: 0.85, pose: k2 }, { t: 1.25, pose: k3 }, { t: 1.6, pose: k4 }, { t: 2.0, pose: k5 }];
  clips.set('getup_front', { ...bake(std, keys, FPS), meta: { source: 'authored (UAL Idle_Loop limbs)', start, from: 'front' } });
}

// ------------------------------------------------------------------ measured metadata
// gait speed: how fast the planted foot slides back under the hips (m/s at the standard's size). A foot counts as
// planted in the frames where it is in the lowest quarter of its own height range.
function gaitSpeed(c) {
  const speeds = [];
  for (const side of ['Left', 'Right']) {
    const pts = c.frames.map(f => std.fk(f).X.get(side + 'Foot'));
    const ys = pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].y > lo + 0.25 * (hi - lo) || pts[i - 1].y > lo + 0.25 * (hi - lo)) continue;
      const dz = (pts[i].z - c.frames[i].hips.z) - (pts[i - 1].z - c.frames[i - 1].hips.z);
      const dt = c.times[i] - c.times[i - 1];
      if (dt > 0) speeds.push(-dz / dt);
    }
  }
  speeds.sort((a, b) => a - b);
  return speeds.length ? +speeds[Math.floor(speeds.length / 2)].toFixed(3) : 0;
}
// The foot-slide estimate is good for the walk; the jog and sprint push off the toes and read high, so they use the
// speeds third-person-adventure tuned by eye for these same UAL clips (worlds/golden-cove.json).
const TUNED_SPEED = { run: 3.9, sprint: 6.6 };
for (const [name, c] of clips) {
  c.meta.duration = +c.times.at(-1).toFixed(4);
  c.meta.layer ??= 'base';
  c.meta.loop ??= false;
  if (c.meta.gait) { c.meta.measured = gaitSpeed(c); c.meta.speed = TUNED_SPEED[name] ?? c.meta.measured; delete c.meta.gait; }
}
const missingClips = rig.CLIPS.filter(n => !clips.has(n));
if (missingClips.length) throw new Error(`clip file would lack ${missingClips}`);

// ------------------------------------------------------------------ write the clip file
const doc = new gltfCore.Document();
doc.setLogger(new gltfCore.Logger(gltfCore.Logger.Verbosity.SILENT));
const buf = doc.createBuffer();
const meta = Object.fromEntries([...clips].map(([n, c]) => [n, c.meta]));
const top = doc.createNode('gf_humanoid_1').setExtras({
  gfRig: rig.RIG, gfGround: 0, gfVersion: 1, gfClips: meta,
  gfSource: { ...SOURCE, note: 'retargeted onto gf-humanoid-1 by research/gf-three/tools/retarget.mjs; authored clips listed in gfClips[*].source' },
});
const nodes = new Map();
for (const n of std.names) {
  const node = doc.createNode(n).setTranslation(std.offset.get(n).toArray());
  nodes.set(n, node);
  const p = std.parent.get(n);
  (p ? nodes.get(p) : top).addChild(node);
}
doc.createScene('gf-humanoid-1').addChild(top);
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const order = [...rig.CLIPS, ...[...clips.keys()].filter(n => !rig.CLIPS.includes(n))];
for (const name of order) {
  const c = clips.get(name);
  const anim = doc.createAnimation(name);
  const input = acc('SCALAR', c.times);
  for (const n of std.names) {
    const out = new Float32Array(c.frames.length * 4);
    let prev = null;
    c.frames.forEach((f, i) => { const q = f.q.get(n).clone().normalize(); if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); q.toArray(out, i * 4); prev = q; });
    const s = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC4', out)).setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(n)).setTargetPath('rotation').setSampler(s));
  }
  const hp = new Float32Array(c.frames.length * 3);
  c.frames.forEach((f, i) => f.hips.toArray(hp, i * 3));
  const s = doc.createAnimationSampler().setInput(input).setOutput(acc('VEC3', hp)).setInterpolation('LINEAR');
  anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get('Hips')).setTargetPath('translation').setSampler(s));
}
await MeshoptEncoder.ready;
await doc.transform(gltfFn.resample({ tolerance: 2e-4 }), gltfFn.dedup(), gltfFn.prune({ keepLeaves: true, keepAttributes: true }));
// rotation keys as normalised int16 (core glTF allows it for rotation outputs; three's GLTFLoader reads it): half size
for (const a of doc.getRoot().listAnimations()) for (const ch of a.listChannels()) {
  if (ch.getTargetPath() !== 'rotation') continue;
  const out = ch.getSampler().getOutput();
  if (out.getComponentType() !== gltfCore.Accessor.ComponentType.FLOAT) continue;
  const f = out.getArray(), q = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
  ch.getSampler().setOutput(doc.createAccessor().setType('VEC4').setArray(q).setNormalized(true).setBuffer(buf));
}
await doc.transform(gltfFn.prune({ keepLeaves: true, keepAttributes: true }), gltfFn.meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const nio = await io();
mkdirSync(dirname(OUT_CLIPS), { recursive: true });
const bin = await nio.writeBinary(doc);
writeFileSync(OUT_CLIPS, bin);
console.log(`clips  ${OUT_CLIPS}  ${(bin.length / 1024).toFixed(0)} KB  ${order.length} clips: ${order.join(', ')}`);
for (const n of order) if (meta[n].speed) console.log(`  ${n} gait speed ${meta[n].speed} m/s`);

// ------------------------------------------------------------------ the mannequin body
if (!process.argv.includes('--no-body')) {
  const body = await nio.readBinary(await ualBytes());
  const report = normalizeBody(body);
  for (const m of body.getRoot().listMaterials()) {
    if (m.getName() === 'M_Main') m.setName('tint_main').setBaseColorFactor([0.92, 0.55, 0.22, 1]);
    if (m.getName() === 'M_Joints') m.setName('joints').setBaseColorFactor([0.18, 0.17, 0.22, 1]);
    m.setRoughnessFactor(0.55).setMetallicFactor(0);
  }
  body.getRoot().listNodes().find(n => n.getName() === 'gf_body')?.setExtras({ gfRig: rig.RIG, gfBody: 'ual-mannequin', gfTint: ['tint_main'] });
  await optimizeDoc(body, {});
  mkdirSync(dirname(OUT_BODY), { recursive: true });
  const b = await nio.writeBinary(body);
  writeFileSync(OUT_BODY, b);
  console.log(`body   ${OUT_BODY}  ${(b.length / 1024).toFixed(0)} KB  ${JSON.stringify(report.fix)} height ${report.height} m; dropped ${report.dropped.join(',') || '-'}; merged ${report.merged.join(',') || '-'}`);
}
