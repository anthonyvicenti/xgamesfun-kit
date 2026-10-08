// gf-three controller: camera rigs. 'third' (an orbit behind the shoulder, pulled in front of walls), 'first' (at the
// eyes) and 'top' (a fixed high angle that follows). Look input comes from kit/core/input.js (mouse with pointer lock
// or drag, touch on the right half); this file adds no listeners.
//
// The third-person rig started from games.fun's third-person-adventure trial (src/camera-rig.js, authored for it;
// ecctrl uses drei CameraControls, which was not ported): pivot smoothing, a Rapier sphere cast from the pivot that
// pulls the camera in front of walls (fast in, slow out). Yaw convention: forward = (sin yaw, 0, cos yaw).
import * as THREE from 'three';
import { SOLID_QUERY } from '../core/util.js';

// third: over the right shoulder. The middle of the screen (the crosshair) sits at head height, `shoulder` metres right
// of the player, so the player's own body never covers it and a shot or stream that lands there is in plain view
// (until 2026-10-07 it was 0.45 m at chest height: the crosshair sat on the body and the stream landed behind it).
export const RIG_DEFAULTS = {
  third: { distance: 5.2, minDistance: 1.6, height: 1.7, shoulder: 0.85, pitchDeg: 16, minPitchDeg: -30, maxPitchDeg: 65, fov: 60, collisionRadius: 0.22, sensitivity: 0.0026 },
  first: { height: 1.55, pitchDeg: 0, minPitchDeg: -75, maxPitchDeg: 75, fov: 72, sensitivity: 0.0024 },
  top: { distance: 15, height: 0.8, pitchDeg: 58, fov: 50, yawDeg: 0, sensitivity: 0 },
};
const DEG = Math.PI / 180;

export function createCameraRig({ camera, mode = 'third', physics = null, exclude = null, settings = {}, yaw = 0 }) {
  const C = { ...RIG_DEFAULTS[mode] ?? RIG_DEFAULTS.third, ...settings };
  const st = { mode, yaw: mode === 'top' ? (C.yawDeg ?? 0) * DEG : yaw, pitch: C.pitchDeg * DEG, current: C.distance ?? 0, pivot: new THREE.Vector3(), first: true, collided: false };
  camera.fov = C.fov; camera.updateProjectionMatrix();
  const ball = physics ? new physics.RAPIER.Ball(C.collisionRadius ?? 0.2) : null;
  const rot0 = { x: 0, y: 0, z: 0, w: 1 };
  const target = new THREE.Vector3(), dir = new THREE.Vector3(), pivot = new THREE.Vector3(), aim = new THREE.Vector3(0, 0, 1), fwd = new THREE.Vector3(0, 0, 1);

  function look(dx, dy) {
    if (mode === 'top' || !C.sensitivity) return;
    st.yaw -= dx * C.sensitivity;
    st.pitch = Math.max(C.minPitchDeg * DEG, Math.min(C.maxPitchDeg * DEG, st.pitch + dy * C.sensitivity));
  }

  /** feet: the followed player's feet {x, y, z}; onGround smooths vertical motion. */
  function update(dt, feet, { onGround = true } = {}) {
    target.set(feet.x, feet.y + C.height, feet.z);
    if (st.first) { st.pivot.copy(target); st.first = false; }
    const kh = 1 - Math.exp(-dt * 18), kv = 1 - Math.exp(-dt * (onGround ? 10 : 5));
    st.pivot.x += (target.x - st.pivot.x) * kh; st.pivot.z += (target.z - st.pivot.z) * kh; st.pivot.y += (target.y - st.pivot.y) * kv;
    const cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    if (mode === 'first') {
      camera.position.set(feet.x, feet.y + C.height, feet.z);
      aim.set(Math.sin(st.yaw) * cp, -sp, Math.cos(st.yaw) * cp).normalize();
      camera.lookAt(camera.position.x + aim.x, camera.position.y + aim.y, camera.position.z + aim.z);
      fwd.copy(aim);
      return;
    }
    // the camera sits behind the pivot: opposite the look direction, raised by the pitch
    dir.set(-Math.sin(st.yaw) * cp, sp, -Math.cos(st.yaw) * cp).normalize();
    pivot.copy(st.pivot);
    if (mode === 'third' && C.shoulder) { pivot.x += -Math.cos(st.yaw) * C.shoulder * Math.min(1, st.current / C.distance); pivot.z += Math.sin(st.yaw) * C.shoulder * Math.min(1, st.current / C.distance); }
    let allowed = C.distance;
    if (physics && mode === 'third') {
      const hit = physics.world.castShape({ x: pivot.x, y: pivot.y, z: pivot.z }, rot0, { x: dir.x, y: dir.y, z: dir.z }, ball, 0, C.distance, true, undefined, SOLID_QUERY, exclude ?? undefined);
      st.collided = !!hit;
      if (hit) allowed = Math.max(C.minDistance, hit.time_of_impact - 0.05);
    }
    st.current = allowed < st.current ? allowed : st.current + (allowed - st.current) * (1 - Math.exp(-dt * 2.5));
    camera.position.copy(pivot).addScaledVector(dir, st.current);
    if (camera.position.y < feet.y + 0.3) camera.position.y = feet.y + 0.3;
    camera.lookAt(pivot.x, pivot.y, pivot.z);
    // where the player aims: through the middle of the screen (third), or the way the camera faces on the ground (top)
    camera.getWorldDirection(fwd);
    if (mode === 'top') aim.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    else aim.copy(fwd);
  }

  return {
    state: st, settings: C, look, update,
    /** The camera's heading: movement input is relative to it. */
    get yaw() { return st.yaw; },
    set yaw(v) { st.yaw = v; },
    /** A normalised aim direction (THREE.Vector3, reused): the camera's forward (third, first), the heading (top). */
    aim: () => aim,
    /** The crosshair ray: from the camera through the middle of the screen ({from, dir}, reused vectors); null for 'top'
     *  (no crosshair). The controller casts it into the world for the aim point (kit/core/aim.js). */
    ray: () => (mode === 'top' ? null : { from: camera.position, dir: fwd }),
    reset(yawValue) { if (mode !== 'top') st.yaw = yawValue ?? st.yaw; st.pitch = C.pitchDeg * DEG; st.current = C.distance ?? 0; st.first = true; },
  };
}
