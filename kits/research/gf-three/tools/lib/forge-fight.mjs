// A new player's eyes and hand in a first-person fight (a forge game), for scripts that cannot see the screen:
// tools/play.mjs's "fight" step (the play-tester) and verify check 15's forge leg (lib/forge-first-wave-check.mjs).
//
// Why (the frozen forge case, 2026-10-11, research/gf-forge/evidence/eval-t6-full-2026-10-11): a play-tester whose
// scripts could only fire straight ahead killed nothing in three rounds, called every fight unwinnable, and two repair
// rounds diluted the game for it. Measured on Bone Vigil: with no up or down aim 20 of 68 rounds land; aimed at the
// chest, 55 of 69.
//
// One beat: the nearest living enemy inside the view (within `view` of where the player looks; the picture is about
// 100° wide at 16:9) → turn to its body (`body` of its height: the chest), off by about `off` each way as a hand is (two
// degrees, one standard deviation: at 10 m about one round in two lands on a body, at 4 m nearly all),
// and fire one round; a new enemy is looked at for `react` first; none in view → a look-around step of `sweep`. It
// reads only what the screen shows a player (the enemies in front of the camera, window.__game.enemies and camera)
// and turns with the core's own look (window.__game.forge.face, QA: as play.mjs's "face"). No walls are asked about:
// an enemy behind one is turned to and shot at, as a new player would.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RAD = Math.PI / 180;
export const FIGHT = { beat: 330, react: 250, off: 2 * RAD, view: 46 * RAD, sweep: 55 * RAD, body: 0.62 };

/** In the page: one beat. → {cannot} | {phase, alive: [net], looked} | {phase, alive, net} */
const BEAT = ({ offX, offY, view, sweep, body }) => {
  const g = window.__game, F = g?.forge;
  if (typeof g?.enemies !== 'function' || typeof F?.face !== 'function' || typeof g?.camera !== 'function') return { cannot: true };
  const c = g.camera(); if (!Array.isArray(c?.eye)) return { cannot: true };
  const [ex, ey, ez] = c.eye, yaw = (c.yaw ?? 0) + Math.PI;            // the kit's yaw faces +Z, the core's look −Z
  const turn = (x, z) => { let d = Math.atan2(-(x - ex), -(z - ez)) - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const alive = g.enemies().filter(e => !e.dead), out = { phase: g.phase, alive: alive.map(e => e.net) };
  const front = alive.map(e => ({ e, d: Math.hypot(e.at[0] - ex, e.at[2] - ez), a: turn(e.at[0], e.at[2]) })).filter(q => Math.abs(q.a) <= view && q.d > 0.2).sort((p, q) => p.d - q.d);
  if (!front.length) { const p = yaw + sweep; F.face(ex - Math.sin(p) * 5, ey, ez - Math.cos(p) * 5); return { ...out, looked: true }; }
  const q = front[0];
  let tall = 1.8; try { tall = (Number(F.value?.(`enemies.${q.e.typeId}.height`)) || 1.8) * (Number(F.value?.(`enemies.${q.e.typeId}.scale`)) || 1); } catch {}
  const y = Math.atan2(-(q.e.at[0] - ex), -(q.e.at[2] - ez)) + offX, p = Math.atan2(q.e.at[1] + tall * body - ey, q.d) + offY, far = Math.max(q.d, 1);
  F.face(ex - Math.sin(y) * Math.cos(p) * far, ey + Math.sin(p) * far, ez - Math.cos(y) * Math.cos(p) * far);
  return { ...out, net: q.e.net };
};

/**
 * Fight for `seconds`, or until `until()` (asked every beat) answers something. io: {frame() → a page or frame,
 * down(key), up(key)} with "Mouse" the fire button. keys: held meanwhile (a walk). seed: the hand's own dice.
 * → {shots, lookedAround, firedAt (enemies), fell (of those, while the round ran), cannot (no fight to have), stopped
 * (what until() answered)}
 */
export async function fightFor(io, { seconds, keys = [], seed = 1, until = null, L = FIGHT } = {}) {
  let s = (0x9e3779b9 ^ seed) | 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const did = { shots: 0, lookedAround: 0, firedAt: 0, fell: 0, cannot: false, stopped: null }, seen = new Set(), open = new Set();
  const end = Date.now() + seconds * 1000;
  let last = null;
  for (const k of keys) await io.down(k);
  try {
    while (Date.now() < end) {
      if (until) { const u = await until(did); if (u) { did.stopped = u; break; } }
      const r = await io.frame().evaluate(BEAT, { offX: gauss() * L.off, offY: gauss() * L.off, view: L.view, sweep: L.sweep, body: L.body }).catch(() => null);
      if (!r) break;                                                          // the game left the page
      if (r.cannot) { did.cannot = true; break; }
      // an enemy I fired at that is no longer among the living fell (only while the round runs: its end clears them all)
      if (r.phase === 'playing') for (const n of [...open]) if (!r.alive.includes(n)) { open.delete(n); did.fell++; }
      if (r.looked) { did.lookedAround++; last = null; await sleep(L.beat); continue; }
      if (r.net !== last) { last = r.net; await sleep(L.react); continue; }      // a new one: see it, then aim again where it is now
      seen.add(r.net); open.add(r.net);
      await sleep(70); await io.down('Mouse'); await sleep(60); await io.up('Mouse'); did.shots++;
      await sleep(L.beat - 130);
    }
    const r = await io.frame().evaluate(() => ({ phase: window.__game?.phase ?? null, alive: (window.__game?.enemies?.() ?? []).filter(e => !e.dead).map(e => e.net) })).catch(() => null);
    if (r?.phase === 'playing') for (const n of [...open]) if (!r.alive.includes(n)) { open.delete(n); did.fell++; }
  } finally { await io.up('Mouse').catch(() => {}); for (const k of [...keys].reverse()) await io.up(k).catch(() => {}); }
  did.firedAt = seen.size;
  return did;
}
