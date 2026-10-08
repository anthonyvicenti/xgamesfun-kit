// Poses on the gf-humanoid-1 *standard* skeleton (identity rest rotations, UAL T-pose rest, character axes:
// +X left, +Y up, +Z forward). A pose is { q: Map(name → Quaternion local), hips: Vector3 }.
// Used by retarget.mjs to author the clips UAL lacks (carry, emotes, get-ups) from a few key poses.
import './char-node.mjs';
import { THREE } from './char-deps.mjs';

const rig = await import('../../kit/character/rig.js');
const { Quaternion, Vector3 } = THREE;

export class Standard {
  /** rest: Map(name → Vector3) rest positions in character space (from the converted UAL skeleton). */
  constructor(rest) {
    this.rest = rest;
    this.names = rig.BONE_NAMES.filter(n => rest.has(n));
    this.parent = new Map(this.names.map(n => [n, rig.canonicalParent(n, x => rest.has(x))]));
    this.offset = new Map(this.names.map(n => { const p = this.parent.get(n); return [n, p ? rest.get(n).clone().sub(rest.get(p)) : rest.get(n).clone()]; }));
  }
  identity() { return { q: new Map(this.names.map(n => [n, new Quaternion()])), hips: this.rest.get('Hips').clone() }; }
  clone(p) { return { q: new Map([...p.q].map(([n, q]) => [n, q.clone()])), hips: p.hips.clone() }; }
  /** World rotations and positions of every bone. */
  fk(p) {
    const W = new Map(), X = new Map();
    for (const n of this.names) {
      const par = this.parent.get(n);
      if (!par) { W.set(n, p.q.get(n).clone()); X.set(n, p.hips.clone()); continue; }
      W.set(n, W.get(par).clone().multiply(p.q.get(n)));
      X.set(n, this.offset.get(n).clone().applyQuaternion(W.get(par)).add(X.get(par)));
    }
    return { W, X };
  }
  /** Sets bone `n`'s world rotation (keeping its descendants' locals). */
  setWorld(p, n, wq) {
    const par = this.parent.get(n);
    const pw = par ? this.fk(p).W.get(par) : new Quaternion();
    p.q.set(n, pw.invert().multiply(wq));
    return p;
  }
  /** Turns bone `n` so its rest direction (toward `child`) points along `dir` (character space), shortest swing. */
  point(p, n, dir, child = this.childOf(n)) {
    const ds = this.rest.get(child).clone().sub(this.rest.get(n)).normalize();
    const w = new Quaternion().setFromUnitVectors(ds, new Vector3(...[].concat(dir.toArray ? dir.toArray() : dir)).normalize());
    return this.setWorld(p, n, w);
  }
  childOf(n) { return rig.SWING[n] ?? this.names.find(c => this.parent.get(c) === n); }
  /** Rotates bone `n` locally by Euler degrees [x, y, z] (in its parent's frame, which is character-aligned at rest). */
  turn(p, n, deg) { p.q.get(n).premultiply(new Quaternion().setFromEuler(new THREE.Euler(...deg.map(THREE.MathUtils.degToRad)))); return p; }
  /** Sets the hips' world rotation from Euler degrees and position. */
  hips(p, deg, pos) { if (deg) p.q.set('Hips', new Quaternion().setFromEuler(new THREE.Euler(...deg.map(THREE.MathUtils.degToRad)))); if (pos) p.hips.set(...pos); return p; }
  /** Two-bone IK: upper (thigh/arm) and lower (shin/forearm) reach `target`; the middle joint bends toward `hint`. */
  ik(p, upper, lower, end, target, hint) {
    const { X } = this.fk(p);
    const a = X.get(upper), t = new Vector3(...target);
    const l1 = this.offset.get(lower).length(), l2 = this.offset.get(end).length();
    const d = Math.min(t.clone().sub(a).length(), l1 + l2 - 1e-4);
    const dir = t.clone().sub(a).normalize();
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const h = new Vector3(...hint).sub(dir.clone().multiplyScalar(dir.dot(new Vector3(...hint)))).normalize();
    const mid = a.clone().add(dir.clone().multiplyScalar(Math.cos(ang) * l1)).add(h.multiplyScalar(Math.sin(ang) * l1));
    this.point(p, upper, mid.clone().sub(a), lower);
    const tt = a.clone().add(dir.multiplyScalar(d));
    this.point(p, lower, tt.sub(mid), end);
    return p;
  }
  /** Blend of two poses (slerp / lerp). */
  mix(a, b, w) {
    const out = this.clone(a);
    for (const n of this.names) out.q.get(n).slerp(b.q.get(n), w);
    out.hips.lerp(b.hips, w);
    return out;
  }
}

const smooth = x => x * x * (3 - 2 * x);
/**
 * Bakes key poses into dense frames: keys = [{t, pose, ease?}] → { times: Float32Array, frames: [pose] } at `fps`.
 * Between keys the motion eases in and out (smoothstep) unless ease === 'linear'.
 */
export function bake(std, keys, fps = 30) {
  const dur = keys.at(-1).t, n = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(n), frames = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(dur, i / fps); times[i] = t;
    let k = 0; while (k < keys.length - 2 && keys[k + 1].t <= t) k++;
    const a = keys[k], b = keys[k + 1];
    const x = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    frames.push(std.mix(a.pose, b.pose, b.ease === 'linear' ? x : smooth(x)));
  }
  return { times, frames };
}
