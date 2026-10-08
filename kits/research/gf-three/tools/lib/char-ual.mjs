// The Quaternius Universal Animation Library (CC0) as shipped in pmndrs/ecctrl at a pinned commit: fetch (sha-checked,
// cached in research/gf-three/.cache/ual/), and convert its clips onto the gf-humanoid-1 standard skeleton.
import './char-node.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { io, THREE } from './char-deps.mjs';
import { loadGLB } from './char-three.mjs';
import { Standard } from './char-pose.mjs';

const rig = await import('../../kit/character/rig.js');

export const SOURCE = {
  pack: 'Universal Animation Library', author: 'Quaternius', license: 'CC0-1.0',
  licenseUrl: 'https://quaternius.itch.io/universal-animation-library',
  repo: 'https://github.com/pmndrs/ecctrl', commit: 'e2cab804f9f15661a642e76f52d09f0b2db63f35', path: 'public/AnimationLibrary.glb',
  url: 'https://raw.githubusercontent.com/pmndrs/ecctrl/e2cab804f9f15661a642e76f52d09f0b2db63f35/public/AnimationLibrary.glb',
  sha256: '1b7bf67866360665426bb99e4c71bd619f19b408453c24e30f0c3071601eee5c',
};
export const CACHE = fileURLToPath(new URL('../../.cache/ual/AnimationLibrary.glb', import.meta.url));

/** The pinned UAL file's bytes (downloads once into .cache, checks sha256 every time). */
export async function ualBytes(path = CACHE) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const r = await fetch(SOURCE.url);
    if (!r.ok) throw new Error(`UAL download ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  const buf = readFileSync(path);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE.sha256) throw new Error(`UAL sha256 ${sha} != pinned ${SOURCE.sha256}`);
  return new Uint8Array(buf);
}

/**
 * Loads UAL in three (Node) and returns a converter:
 *   { std: Standard, rest, clips: Map(name → AnimationClip), sample(clipName, t) → pose (standard space),
 *     convert(clipName, {fps}) → { times, frames: [pose], duration } }
 */
export async function loadUAL(bytes) {
  const raw = await (await io()).readBinary(bytes);
  const rawNames = raw.getRoot().listNodes().map(n => n.getName());
  const canon = rig.canonicalNames(rawNames);
  const g = await loadGLB(bytes);
  let skinned; g.scene.traverse(o => { if (o.isSkinnedMesh && !skinned) skinned = o; });
  const sk = skinned.skeleton;
  const bone = new Map();
  for (const [r, c] of canon) { const b = g.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(r)); if (b) bone.set(c, b); }
  const U = new Map(), rest = new Map();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const [c, b] of bone) {
    const i = sk.bones.indexOf(b);
    sk.boneInverses[i].clone().invert().decompose(p, q, s);
    U.set(c, q.clone().invert()); rest.set(c, p.clone());
  }
  const std = new Standard(rest);
  // the rest pose of every animated node, to reset between clips
  const restLocal = new Map();
  g.scene.traverse(o => restLocal.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const clips = new Map(g.animations.map(a => [a.name, a]));
  const bound = new Map();
  function bind(clip) {
    if (bound.has(clip)) return bound.get(clip);
    const out = clip.tracks.map(tr => {
      const pn = THREE.PropertyBinding.parseTrackName(tr.name);
      const node = g.scene.getObjectByName(pn.nodeName);
      return node ? { node, prop: pn.propertyName, interp: tr.createInterpolant() } : null;
    }).filter(Boolean);
    bound.set(clip, out);
    return out;
  }
  function sample(name, t) {
    const clip = clips.get(name);
    if (!clip) throw new Error(`UAL has no clip ${name}`);
    for (const [o, [P, Q, S]] of restLocal) { o.position.copy(P); o.quaternion.copy(Q); o.scale.copy(S); }
    for (const { node, prop, interp } of bind(clip)) {
      const v = interp.evaluate(Math.min(t, clip.duration));
      if (prop === 'quaternion') node.quaternion.fromArray(v).normalize();
      else if (prop === 'position') node.position.fromArray(v);
      else if (prop === 'scale') node.scale.fromArray(v);
    }
    g.scene.updateMatrixWorld(true);
    const D = new Map(), pose = std.identity();
    for (const c of std.names) {
      bone.get(c).matrixWorld.decompose(p, q, s);
      D.set(c, q.clone().multiply(U.get(c)));
      if (c === 'Hips') pose.hips.copy(p);
    }
    for (const c of std.names) {
      const par = std.parent.get(c);
      pose.q.set(c, par ? D.get(par).clone().invert().multiply(D.get(c)) : D.get(c).clone());
    }
    return pose;
  }
  function convert(name, { fps = 30 } = {}) {
    const clip = clips.get(name);
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n), frames = [];
    for (let i = 0; i < n; i++) { const t = i === n - 1 ? clip.duration : i / fps; times[i] = t; frames.push(sample(name, t)); }
    return { times, frames, duration: clip.duration };
  }
  return { std, rest, clips, sample, convert, gltf: g, rawDoc: raw, canon };
}
