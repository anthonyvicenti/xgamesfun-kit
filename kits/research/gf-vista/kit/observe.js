// gf-vista's observation interface (research/super-scenic/PLAN.md §3, contract addition 2), with forge's names so
// verify reads every engine the same way: window.__game.{snapshot, camera, screen, looks, controls, coverage, sight}.
// Read-only: nothing here changes the game. Wave 1 has camera, screen, snapshot, looks and controls; coverage and
// sight (the slot-ID pass) are wave 2 track S, and say so instead of answering wrongly.
import { LOOKS } from './look.js';

/** The keys the core's player reads (core/src/player, core/src/App.js), for check 15's new-player hand. */
export const CONTROLS = [
  { keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], does: 'move (on foot, swimming, steering the boat)' },
  { keys: ['mouse'], does: 'look (click to capture the mouse)' },
  { keys: ['ShiftLeft'], does: 'sprint, boat boost' },
  { keys: ['Space'], does: 'jump, swim up' },
  { keys: ['KeyC'], does: 'crouch, dive' },
  { keys: ['KeyE'], does: 'interact: board the boat, take or leave the helm, step ashore, trade' },
  { keys: ['KeyR'], does: 'take out or put away the fishing rod' },
  { keys: ['mouse-left'], does: 'hold to wind up, release to cast; strike; hold to reel' },
];

const r3 = v => Math.round(v * 1000) / 1000;

export function createObserve(vista) {
  const { app } = vista;
  const cam = app.camera;
  const players = () => vista.players?.list?.() ?? [];
  const o = {
    engine: 'vista',
    version: vista.VERSION,
    /** the camera the core drew this frame */
    camera() {
      const e = cam.matrixWorld.elements;   // column 2 is +Z; the camera looks down −Z
      const fx = -e[8], fy = -e[9], fz = -e[10];
      return { x: r3(cam.position.x), y: r3(cam.position.y), z: r3(cam.position.z), yaw: r3(Math.atan2(-fx, -fz)), pitch: r3(Math.asin(Math.max(-1, Math.min(1, fy)))), fov: cam.fov, near: cam.near, far: cam.far, underwater: (app.cameraWaterHeight ?? 0) > cam.position.y };
    },
    /** what the canvas is and how fast it draws */
    screen() {
      const c = app.engine.canvas;
      return { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight, dpr: devicePixelRatio, backend: 'webgpu', fps: app.fps ? Math.round(app.fps * 10) / 10 : null, cpuMs: app.cpuMs ? r3(app.cpuMs) : null, renderScale: app.settings.renderScale, gpu: vista.gpu };
    },
    /** the world state a check needs: the local player, the boat, the look, the other players */
    snapshot() {
      const p = app.player, b = app.boatCtl;
      return {
        t: performance.now(),
        mode: app.freeCam ? 'free' : p.mode,   // walk | swim | boat | deck | free
        player: { x: r3(p.position.x), y: r3(p.position.y), z: r3(p.position.z), yaw: r3(p.yaw ?? 0), grounded: !!p.grounded },
        boat: { x: r3(b.position.x), y: r3(b.position.y), z: r3(b.position.z), speed: r3(b.velocity.length()), driven: !!b.driven },
        look: vista.look.state,
        players: players(),
        started: vista.started,
      };
    },
    looks: LOOKS,
    controls: CONTROLS,
    coverage() { return { ok: false, why: 'not yet for vista (wave 2, track S)' }; },
    sight() { return { ok: false, why: 'not yet for vista (wave 2, track S)' }; },
  };
  return o;
}
