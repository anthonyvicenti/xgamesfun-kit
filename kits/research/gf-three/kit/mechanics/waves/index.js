// mechanic: waves (track K2). Host-owned enemies that come in waves, chase players or a target that has health, and can
// be hit by projectiles. Every copy draws them (a character body when the game has one, else a prop, else a capsule).
// README.md has ownership and API.
//
//   const waves = ctx.mechanics.get('waves');
//   waves.onKill(k => { if (k.from) k.from.score += 1; });        // host only
//   waves.state();                                                // every copy: { wave, alive, kills, targetHp, targetMax }
//
// Hits read (creator, live Studio "Hang Up On Them", 2026-10-07: "The zombies are instant killed to I couldn't even tell
// what was happened. There was no healthbar or anything."). On every copy, from the shared hit points alone:
//   - a hit that does not kill: the enemy flashes (flashColor over its own materials), flinches (the gf-humanoid-1 `hit`
//     clip and the hurt face, or a squash for a stand-in), is pushed back `hitKnock` m and staggers `stagger` s (host),
//     and a health bar shows over it (the kit's UI, like nameplates: never a model) from then on;
//   - a kill: the body falls (the `knockdown` clip, or a stand-in tips over), then sinks into the floor over
//     `deathSeconds`, with the `soundKill` sound; the killer's own screen shows "+killPoints" over it.
// A basic enemy takes 2–4 hits from the game's weapon (defaults: hp 2, projectile damage 1; tools/lib/spec-config.mjs
// keeps the spec's damage below hp). One-hit kills only when the spec asks for them (`oneHitKills`). verify check 16
// (tools/lib/hits-check.mjs) shoots enemies from the player's own screen and fails a game whose enemies drop in one hit.
//
// QA only: `?gf-demo=waves.hit` stages the moment check 16 photographs: no waves, one enemy at a time standing still
// 6 m in front of the local player (the game's own wave-1 hit points), a new one shortly after each kill.
import * as THREE from 'three';
import { createDirector, waveStats, edgePoint, nearestOf, steer, rotate, clampTo, hurtEnemy, knockOf, flashAt, deathPose, demoSpot } from './logic.js';
import { areaOf, physicsOf } from '../../core/util.js';

export const id = 'waves';
export const examples = ['zombies in waves', 'defend the core', 'enemy blobs chase the players'];

const D = {
  enemyRole: 'enemy', prop: '', color: '#7a5cff', height: 1.5, startCount: 3, growth: 2, maxAlive: 14, hp: 2, hpGrowth: 0.5, speed: 2.6, speedGrowth: 0.12,
  firstDelay: 3, restSeconds: 4, spawnEvery: 0.6, nextWave: 'clear', interval: 20, maxWaves: 0, aggro: 'nearest', attackRange: 1.2, attackInterval: 1.0, damage: 1, contactKnock: 5, hittable: true,
  target: '', targetHp: 20, killPoints: 1, banner: true, bannerText: 'Wave {n}', targetLabel: 'Core',
  oneHitKills: false, barColor: '#ff4d5e', flashColor: '#ffffff', hitKnock: 0.35, stagger: 0.3, deathSeconds: 1.6, soundKill: 'enemy-down',
};
const kebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const num = (description, minimum, maximum) => ({ type: 'number', description, minimum, maximum });
export const params = {
  type: 'object', additionalProperties: true,
  properties: {
    enemyRole: { type: 'string', default: D.enemyRole, description: 'Character role whose body (character.body.<role>) draws the enemies when the game has one' },
    prop: { type: 'string', default: D.prop, description: 'Prop slot to draw enemies with when there is no character body ("": a coloured capsule)' },
    color: { type: 'string', default: D.color, description: 'Colour of the stand-in capsule and of the character tint' },
    height: { ...num('Enemy height in metres', 0.4, 4), default: D.height },
    startCount: { type: 'integer', minimum: 1, maximum: 30, default: D.startCount, description: 'Enemies in wave 1' },
    growth: { ...num('Extra enemies each wave', 0, 20), default: D.growth },
    maxAlive: { type: 'integer', minimum: 1, maximum: 24, default: D.maxAlive, description: 'Enemies alive at once (each costs about 25 bytes of the world message)' },
    hp: { type: 'integer', minimum: 1, maximum: 200, default: D.hp, description: 'Hit points in wave 1. Keep it above the weapon\'s damage: a basic enemy takes 2–4 hits (verify check 16 fails one-hit kills unless the spec sets oneHitKills)' },
    hpGrowth: { ...num('Extra hit points each wave', 0, 20), default: D.hpGrowth },
    speed: { ...num('Enemy speed in wave 1 (m/s)', 0.5, 8), default: D.speed },
    speedGrowth: { ...num('Speed gained each wave (fraction)', 0, 1), default: D.speedGrowth },
    firstDelay: { ...num('Seconds before wave 1', 0, 60), default: D.firstDelay },
    restSeconds: { ...num('Seconds between waves', 0, 60), default: D.restSeconds },
    spawnEvery: { ...num('Seconds between enemies of a wave coming out', 0.05, 10), default: D.spawnEvery },
    nextWave: { type: 'string', enum: ['clear', 'timer'], default: D.nextWave, description: 'clear: the next wave comes when all are dead; timer: after `interval` seconds either way' },
    interval: { ...num('Seconds a wave lasts at most in timer mode', 5, 300), default: D.interval },
    maxWaves: { type: 'integer', minimum: 0, maximum: 99, default: D.maxWaves, description: 'Waves in the round (0: endless); state().cleared is true after the last is beaten' },
    aggro: { type: 'string', enum: ['nearest', 'players', 'target'], default: D.aggro, description: 'Who enemies go for: the nearest of players and target, only players, or only the target' },
    attackRange: { ...num('Reach of an enemy attack (m)', 0.3, 4), default: D.attackRange },
    attackInterval: { ...num('Seconds between one enemy\'s attacks', 0.2, 10), default: D.attackInterval },
    damage: { ...num('Damage of an attack to a player or the target', 0, 100), default: D.damage },
    contactKnock: { ...num('Knock an attack gives a player (m/s)', 0, 20), default: D.contactKnock },
    hittable: { type: 'boolean', default: D.hittable, description: 'The projectile mechanic\'s shots and streams hit enemies' },
    target: { type: 'string', default: D.target, description: 'World zone that holds the thing to defend ("": no target, enemies only chase players)' },
    targetHp: { ...num('Hit points of the target', 1, 1000), default: D.targetHp },
    targetLabel: { type: 'string', default: D.targetLabel, description: 'HUD label of the target\'s health bar' },
    killPoints: { ...num('Score a player gets for a kill they caused', 0, 100), default: D.killPoints },
    banner: { type: 'boolean', default: D.banner, description: 'Show a banner when a wave starts' },
    bannerText: { type: 'string', default: D.bannerText, description: 'Banner text; {n} is the wave number' },
    oneHitKills: { type: 'boolean', default: D.oneHitKills, description: 'Any hit kills. Only when the creator asked for enemies that drop in one hit: verify check 16 honours it only when the game\'s locked spec sets it' },
    barColor: { type: 'string', default: D.barColor, description: 'Colour of the health bar over a hit enemy' },
    flashColor: { type: 'string', default: D.flashColor, description: 'Colour a hit enemy flashes' },
    hitKnock: { ...num('How far a hit pushes an enemy back (m)', 0, 3), default: D.hitKnock },
    stagger: { ...num('Seconds a hit enemy stops before it comes on again', 0, 2), default: D.stagger },
    deathSeconds: { ...num('Seconds a downed enemy takes to fall and sink away', 0.6, 4), default: D.deathSeconds },
    soundKill: { type: 'string', default: D.soundKill, description: 'Sound id played where an enemy goes down ("" for none)' },
  },
};
const vs = (name, label, type, extra = {}) => ({ id: `mechanic.waves.${kebab(name)}`, label, group: 'mechanics', type, source: { pointer: `{base}/${name}` }, tier: 'advanced', facet: type === 'color' ? 'look' : 'gameplay', ...extra });
export const slots = [
  vs('startCount', 'Enemies in the first wave', 'integer', { tier: 'main', rank: 62, constraints: { min: 1, max: 30 } }),
  vs('growth', 'Extra enemies per wave', 'number', { tier: 'main', rank: 58, constraints: { min: 0, max: 20 } }),
  vs('speed', 'Enemy speed', 'number', { tier: 'main', rank: 56, constraints: { min: 0.5, max: 8, unit: 'm/s' } }),
  vs('hp', 'Enemy hit points', 'integer', { rank: 50, constraints: { min: 1, max: 200 } }),
  vs('color', 'Stand-in enemy colour', 'color', { rank: 30 }),
  vs('targetHp', 'Target hit points', 'number', { rank: 44, constraints: { min: 1, max: 1000 } }),
  vs('bannerText', 'Wave banner text', 'text', { facet: 'text', constraints: { maxLength: 40 } }),
  vs('targetLabel', 'Target health label', 'text', { facet: 'text', constraints: { maxLength: 24 } }),
  vs('height', 'Enemy height', 'number', { constraints: { min: 0.4, max: 4, unit: 'm' } }),
  vs('damage', 'Enemy attack damage', 'number', { constraints: { min: 0, max: 100 } }),
  vs('restSeconds', 'Rest between waves', 'number', { constraints: { min: 0, max: 60, unit: 's' } }),
  vs('maxAlive', 'Most enemies alive', 'integer', { constraints: { min: 1, max: 24 } }),
  vs('maxWaves', 'Waves in the round (0 endless)', 'integer', { constraints: { min: 0, max: 99 } }),
  vs('interval', 'Wave length in timer mode', 'number', { constraints: { min: 5, max: 300, unit: 's' } }),
  vs('contactKnock', 'Attack knock', 'number', { constraints: { min: 0, max: 20, unit: 'm/s' } }),
  vs('prop', 'Enemy prop', 'text', { constraints: { maxLength: 40 } }),
  vs('barColor', 'Enemy health bar colour', 'color', { rank: 28 }),
  vs('flashColor', 'Enemy hit flash colour', 'color', { rank: 26 }),
  vs('hitKnock', 'Enemy push-back on a hit', 'number', { constraints: { min: 0, max: 3, unit: 'm' } }),
  vs('stagger', 'Enemy stagger on a hit', 'number', { constraints: { min: 0, max: 2, unit: 's' } }),
  vs('deathSeconds', 'Enemy fall and sink time', 'number', { constraints: { min: 0.6, max: 4, unit: 's' } }),
  vs('soundKill', 'Enemy down sound id', 'text', { constraints: { maxLength: 40 } }),
];

const r2 = v => Math.round(v * 100) / 100;
const unsub = (arr, fn) => () => { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); };
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const qaParam = name => { try { return new URLSearchParams(globalThis.location?.search ?? '').get(name); } catch { return null; } };
function rayFixed(ctx, a, b) {
  const { RAPIER: R, world: W } = physicsOf(ctx);   // ctx.physics is the bare World (K1) or {RAPIER, world}
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
  if (!R || !W || d < 1e-6) return null;
  const ray = new R.Ray({ x: a.x, y: a.y, z: a.z }, { x: dx / d, y: dy / d, z: dz / d });
  const h = W.castRay(ray, d, true, undefined, undefined, undefined, undefined, c => { const p = c.parent(); return !p || p.isFixed(); });
  return h ? (h.timeOfImpact ?? h.toi) : null;
}
/** A stand-in's own copies of its materials (so one enemy's flash never lights the others), with their base emissive. */
function ownMaterials(obj) {
  const out = [], own = new Map();
  obj.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map(m => {
      if (!m || !m.emissive) return m;
      if (!own.has(m)) { const c = m.clone(); c.userData = { ...m.userData, gfFlashBase: m.emissive.clone() }; own.set(m, c); out.push(c); }
      return own.get(m);
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  return out;
}

export function create(ctx, params = {}) {
  const P = { ...D, ...params };
  const V = k => { const sid = `mechanic.waves.${kebab(k)}`; try { return ctx.assets?.has(sid) ? ctx.assets.value(sid, P[k]) : P[k]; } catch { return P[k]; } };
  const A = areaOf(ctx.world);
  const demo = qaParam('gf-demo') === 'waves.hit';
  const stats = () => ({ startCount: V('startCount'), growth: V('growth'), maxAlive: V('maxAlive'), hp: V('hp'), hpGrowth: V('hpGrowth'), speed: V('speed'), speedGrowth: V('speedGrowth') });
  const director = createDirector({ firstDelay: V('firstDelay'), restSeconds: V('restSeconds'), interval: V('interval'), mode: V('nextWave'), spawnEvery: V('spawnEvery'), maxWaves: V('maxWaves'), stats: stats() });
  const L = { kill: [], spawn: [], playerHit: [], targetHit: [], targetDown: [] };
  const root = new THREE.Group(); root.name = 'gf-waves'; ctx.scene.add(root);
  const enemies = new Map();        // host: id → {id, x, z, hp, max, speed, wave, atk, side, hits, shots, stun}
  const view = new Map();           // every copy: id → {x, z, tx, tz, hp, max, yaw, obj, character, ...}
  const dying = [];
  const killLog = [];               // host: the last kills {id, hits, shots, max, from, t} (QA: verify check 16)
  const recentKills = [];           // host: [enemy id, killer id] of the last kills (shared as `k`: the "+1" on the killer's screen)
  let S = null, nextId = 1, kills = 0, targetHp = V('targetHp'), targetDownFired = false, started = false, lastWave = 0, lastList = null, meter = null, ring = null;
  let templ = null, loading = false, demoT = 0, hitsSeen = 0, deathsSeen = 0, lastHit = null, aimSrc = null;
  const now = () => ctx.time.now;
  const targetPos = () => { const z = V('target') && ctx.world.zone?.(V('target')); if (!z) return null; const a = z.at; return { x: a.x ?? a[0], z: a.z ?? a[2] }; };

  // ---------- drawing ----------
  const hasBody = () => ctx.assets.has(`character.body.${V('enemyRole')}`) && ctx.modules?.character?.spawnCharacter;
  async function loadTemplate() {
    if (loading || templ) return; loading = true;
    const name = V('prop');
    try { if (!hasBody() && name && ctx.assets.has(`prop.${name}`)) templ = { obj: await ctx.assets.model(`prop.${name}`, { fit: V('height'), fitAxis: 'y' }) }; } catch (e) { console.warn('waves: prop model failed', e); }
    if (!templ && !hasBody()) {
      const m = ctx.modules?.look?.material?.('prop', { tint: V('color') }) ?? new THREE.MeshStandardMaterial({ color: V('color'), roughness: 0.6 });
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(V('height') * 0.28, V('height') * 0.44, 6, 12).translate(0, V('height') * 0.5, 0), m); mesh.castShadow = true;
      ctx.assets.tag(mesh, 'mechanic.waves.color'); templ = { obj: mesh };
    }
    loading = false;
  }
  async function makeObj(v) {
    v.making = true;
    try {
      if (hasBody()) {
        const c = await ctx.modules.character.spawnCharacter(ctx, { player: { id: `enemy:${v.id}`, name: '', color: V('color') }, bodySlot: `character.body.${V('enemyRole')}`, tint: V('color'), local: false, height: V('height') });
        v.character = c; v.obj = c.object3d;
      } else if (templ) v.obj = templ.obj.clone(true);
      if (v.obj) { v.obj.rotation.order = 'YXZ'; root.add(v.obj); v.obj.position.set(v.x, 0, v.z); }
      if (v.gone && v.obj) { v.obj.removeFromParent(); v.character?.dispose?.(); }      // it died while its body loaded
    } catch (e) { console.warn('waves: enemy body failed', e); }
    v.making = false;
  }
  // a hit's flash over this enemy's own materials: the character's glow, or a stand-in's own material copies
  function flash(v, k) {
    if (v.character?.glow) { if (k > 0 || v.flashOn) v.character.glow(k > 0 ? V('flashColor') : null, k * 0.85); v.flashOn = k > 0; return; }
    if (!v.obj || (k <= 0 && !v.flashOn)) return;
    v.flashOn = k > 0;
    if (!v.mats) v.mats = ownMaterials(v.obj);
    const c = new THREE.Color(V('flashColor'));
    for (const m of v.mats) m.emissive.copy(m.userData.gfFlashBase).lerp(c, k * 0.85);
  }

  // ---------- host ----------
  const live = () => [...enemies.values()];
  function spawn(st, at = null) {
    // in through a real door when the world has entries (an indoor world's doors to the street, a park's gates)
    const p = at ?? ctx.world.entry?.(() => ctx.rng()) ?? edgePoint(A, () => ctx.rng());
    const e = { id: nextId++, x: p.x, z: p.z, hp: st.hp, max: st.hp, speed: at ? 0 : st.speed * (0.9 + ctx.rng() * 0.2), wave: director.wave, atk: 0, side: ctx.rng() < 0.5 ? 1 : -1, hits: 0, shots: 0, stun: 0, demo: !!at };
    enemies.set(e.id, e);
    for (const fn of L.spawn.slice()) try { fn({ enemy: pub(e) }); } catch (er) { console.error(er); }
  }
  const pub = e => ({ id: e.id, x: e.x, z: e.z, hp: e.hp, wave: e.wave });
  function kill(e, from) {
    if (!enemies.delete(e.id)) return;
    kills++;
    if (from && from.score !== undefined && V('killPoints')) from.score += V('killPoints');
    killLog.push({ id: e.id, hits: e.hits, shots: e.shots, max: e.max, from: from?.id ?? null, t: r2(now()) }); if (killLog.length > 24) killLog.shift();
    recentKills.push([e.id, from?.id ?? '']); if (recentKills.length > 6) recentKills.shift();
    for (const fn of L.kill.slice()) try { fn({ enemy: pub(e), from: from ?? null }); } catch (er) { console.error(er); }
  }
  function hostStep(dt) {
    const players = ctx.players.list().filter(p => p.alive !== false);
    const tp = targetPos();
    const list = live();
    for (const e of list) {
      if (e.demo) continue;                                           // QA's staged enemy stands still and never attacks
      if (e.stun > 0) { e.stun -= dt; continue; }                     // staggered by a hit
      const goals = [];
      if (V('aggro') !== 'target') for (const p of players) goals.push({ x: p.position.x, z: p.position.z, player: p });
      if (tp && targetHp > 0 && V('aggro') !== 'players') goals.push({ x: tp.x, z: tp.z, target: true });
      const n = nearestOf(e.x, e.z, goals);
      if (!n) continue;
      let goal = n.target;
      // a player who is in the way still gets attacked when the goal is the target
      if (goal.target && V('aggro') === 'target') { const q = nearestOf(e.x, e.z, players.map(p => ({ x: p.position.x, z: p.position.z, player: p }))); if (q && q.dist < V('attackRange')) goal = q.target; }
      // through the doors when the goal is in another room (world.via; null in one room or outdoors)
      const wp = ctx.world.via?.(e, goal) ?? null;
      let h = steer(e, wp ?? goal, list, { separation: 0.9 });
      const dGoal = wp ? Math.hypot(goal.x - e.x, goal.z - e.z) : h.dist;
      const reach = V('attackRange') * 0.8;
      if (dGoal > reach) {
        // look ahead for a wall or prop; turn away from it
        const ahead = { x: e.x + h.x * 0.9, y: 0.6, z: e.z + h.z * 0.9 };
        if (rayFixed(ctx, { x: e.x, y: 0.6, z: e.z }, ahead) !== null) { const t = rotate(h, 1.0 * e.side); const t2 = rotate(h, -1.0 * e.side); const a2 = { x: e.x + t.x * 0.9, y: 0.6, z: e.z + t.z * 0.9 }; h = rayFixed(ctx, { x: e.x, y: 0.6, z: e.z }, a2) === null ? t : t2; }
        const c = clampTo(A, e.x + h.x * e.speed * dt, e.z + h.z * e.speed * dt);
        e.x = c.x; e.z = c.z;
      }
      e.atk -= dt;
      if (dGoal <= V('attackRange') && e.atk <= 0) {
        e.atk = V('attackInterval');
        if (goal.player) attackPlayer(e, goal.player); else if (goal.target) attackTarget(e);
      }
    }
  }
  // QA's staged moment (?gf-demo=waves.hit): one enemy at a time, 6 m in front of the local player, standing still
  function demoStep(dt) {
    if (enemies.size > 0) return;
    demoT -= dt;
    const me = ctx.me;
    if (demoT > 0 || !me || me.alive === false) return;
    const a = me.aim, yaw = me.yaw ?? 0;
    const heading = a && Math.hypot(a[0] ?? a.x ?? 0, a[2] ?? a.z ?? 0) > 0.1 ? { x: a[0] ?? a.x, z: a[2] ?? a.z } : { x: Math.sin(yaw), z: Math.cos(yaw) };
    let dist = 6, at = demoSpot(me.position, heading, A, dist);
    const from = { x: me.position.x, y: 0.6, z: me.position.z };
    const wall = rayFixed(ctx, from, { x: at.x, y: 0.6, z: at.z });
    if (wall !== null) { dist = Math.max(3, wall - 0.8); at = demoSpot(me.position, heading, A, dist); }
    spawn(waveStats(1, stats()), at);
    demoT = 0.8;
  }
  function attackPlayer(e, p) {
    const hm = ctx.mechanics?.get('health'), away = { x: p.position.x - e.x, z: p.position.z - e.z }, l = Math.hypot(away.x, away.z) || 1;
    const imp = { x: away.x / l * V('contactKnock'), y: 2.5, z: away.z / l * V('contactKnock') };
    // fair play (CONTRACT §6c): contact damage is a continuous attack: it shoves and never knocks over (F6); a player who
    // is down, out or protected takes nothing, and onPlayerHit hears only of hits that counted (F2, F8)
    const F = ctx.fair?.on ? ctx.fair : null;
    let counted = true;
    if (hm?.damage && !hm.standin) counted = hm.damage(p, V('damage'), { from: null, impulse: imp, source: 'enemy', push: !!F }) !== false;
    else if (F) { const why = F.blocked(p); if (why) { F.refuse(why); counted = false; } else p.push?.(imp); }
    else p.knock?.(imp, 0.8);
    if (!counted) return;
    for (const fn of L.playerHit.slice()) try { fn({ enemy: pub(e), player: p }); } catch (er) { console.error(er); }
  }
  function attackTarget(e) {
    targetHp = Math.max(0, targetHp - V('damage'));
    for (const fn of L.targetHit.slice()) try { fn({ enemy: pub(e), hp: targetHp }); } catch (er) { console.error(er); }
    if (targetHp <= 0 && !targetDownFired) { targetDownFired = true; for (const fn of L.targetDown.slice()) try { fn({}); } catch (er) { console.error(er); } }
  }
  function damageEnemy(id, amount, opts = {}) {
    const e = enemies.get(id); if (!e) return false;
    const r = hurtEnemy(e, amount, { now: now(), oneHit: !!V('oneHitKills') });
    // a hit you can see: pushed back along the shot and a short stagger (a stream's ticks push a little, never stop it)
    if (r.hit && !r.dead) {
      const stream = opts.kind === 'stream';
      if (opts.impulse) { const k = knockOf(opts.impulse, V('hitKnock') * (stream ? 0.25 : 1)); const c = clampTo(A, e.x + k.x, e.z + k.z); e.x = c.x; e.z = c.z; }
      if (!stream) e.stun = Math.max(e.stun, V('stagger'));
    }
    if (r.dead) kill(e, opts.from ?? null);
    return true;
  }

  // ---------- every copy ----------
  const pv = new THREE.Vector3();
  /** Screen px of a world point on this copy's camera: {x, y, front}. */
  const screen = (x, y, z) => { pv.set(x, y, z).project(ctx.camera); const W = globalThis.innerWidth ?? 0, H = globalThis.innerHeight ?? 0; return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * H, front: pv.z > -1 && pv.z < 1, ndc: [pv.x, pv.y] }; };
  function hitEdge(v) {
    hitsSeen++;
    v.hitT = 0; v.barHit = true;
    let clip = null;
    if (v.character) { if (v.character.play?.('hit', { fade: 0.05 })) clip = 'hit'; v.character.express?.('hurt', 0.5); }
    else clip = 'squash';
    lastHit = { id: v.id, hp: v.hp, max: v.max, t: r2(now()), flash: true, clip };
  }
  function deathEdge(v) {
    deathsSeen++;
    const d = { v, t: 0 };
    dying.push(d);
    if (V('soundKill')) ctx.audio?.play(V('soundKill'), { at: { x: v.x, y: 1, z: v.z }, optional: true });
    // "+1" over it on the killer's own screen
    const k = (ctx.host ? recentKills : (S?.k ?? [])).find(x => x[0] === v.id);
    if (k && ctx.me && k[1] === ctx.me.id && V('killPoints') && ctx.ui?.pop && ctx.camera) {
      ctx.camera.updateMatrixWorld();
      const s = screen(v.x, V('height') + 0.5, v.z);
      if (s.front) ctx.ui.pop(`+${V('killPoints')}`, s.x, s.y, ctx.me.color ?? null);
    }
    if (v.character) {
      flash(v, 0);
      const kd = v.character.meta?.knockdown?.duration ?? 1.2, fallT = V('deathSeconds') * 0.55;
      v.character.locomotion?.(0, true);
      v.character.play?.('knockdown', { hold: true, rate: Math.max(1, kd / fallT), fade: 0.08 });
    }
  }
  function syncView(dt) {
    const list = ctx.host ? live().map(e => [e.id, e.x, e.z, e.hp, e.max]) : S.e;
    if (ctx.host || list !== lastList) {
      lastList = list;
      const seen = new Set();
      for (const e of list ?? []) {
        seen.add(e[0]);
        let v = view.get(e[0]);
        if (!v) { v = { id: e[0], x: e[1], z: e[2], yaw: 0, obj: null, character: null, making: false, born: 0, hitT: 9, hp: e[3], max: e[4] ?? e[3] }; view.set(e[0], v); }
        v.tx = e[1]; v.tz = e[2];
        const hp = e[3], max = e[4] ?? Math.max(v.max ?? hp, hp);
        if (hp < v.hp - 1e-6) { v.hp = hp; v.max = max; hitEdge(v); }        // a hit that did not kill (the same on every copy)
        v.hp = hp; v.max = max;
      }
      for (const [k, v] of view) if (!seen.has(k)) { view.delete(k); v.gone = true; deathEdge(v); }     // the edge: it is gone (killed)
    }
    const me = ctx.me;
    for (const v of view.values()) {
      if (!v.obj && !v.making && (templ || hasBody())) makeObj(v);
      const px = v.x, pz = v.z, k = ctx.host ? 1 : Math.min(1, dt * 9);
      v.x += (v.tx - v.x) * k; v.z += (v.tz - v.z) * k;
      const mx = v.x - px, mz = v.z - pz, sp = Math.hypot(mx, mz) / Math.max(dt, 1e-3);
      let face = null;
      if (sp > 0.3 && v.hitT > 0.25) face = Math.atan2(mx, mz);                      // a knock back does not turn it round
      else if (demo && me) face = Math.atan2(me.position.x - v.x, me.position.z - v.z);   // QA's staged enemy faces the player
      if (face !== null) { let d = face - v.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); v.yaw += d * Math.min(1, dt * 10); }
      v.hitT += dt;
      if (v.obj) {
        v.born = Math.min(1, v.born + dt * 4);
        const s = 0.3 + 0.7 * v.born, q = v.character ? 0 : Math.max(0, 1 - v.hitT / 0.22);      // a stand-in squashes on a hit
        v.obj.position.set(v.x, 0, v.z); v.obj.rotation.y = v.yaw;
        v.obj.scale.set(s * (1 + 0.14 * q), s * (1 - 0.2 * q), s * (1 + 0.14 * q));
        flash(v, flashAt(v.hitT));
        if (v.character) { v.character.locomotion?.(Math.min(sp, 6), true); v.character.update?.(dt); }
      }
    }
    // deaths: the fall (knockdown, or a stand-in tipping over), then a sink into the floor
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i]; d.t += dt;
      const pose = deathPose(d.t, V('deathSeconds'));
      const o = d.v.obj;
      if (o) {
        if (d.v.character) d.v.character.update?.(dt);
        else { o.rotation.x = -Math.PI / 2 * smooth(pose.fall); flash(d.v, 0); }
        o.position.y = -0.9 * smooth(pose.sink);
        if (pose.sink > 0.6) o.scale.setScalar((0.3 + 0.7 * d.v.born) * (1 - 0.4 * smooth((pose.sink - 0.6) / 0.4)));
      }
      if (pose.done || (!o && d.t > 0.3)) { o?.removeFromParent(); d.v.character?.dispose?.(); dying.splice(i, 1); }
    }
    // health bars over every enemy that has been hit, from the shared hit points (so the same on every copy)
    if (ctx.ui?.bars && ctx.camera) {
      ctx.camera.updateMatrixWorld();
      const rows = [];
      for (const v of view.values()) {
        if (!v.obj || !(v.hp < v.max - 1e-6) || v.hp <= 0) continue;
        const s = screen(v.x, V('height') + 0.32, v.z);
        rows.push({ id: v.id, x: s.x, y: s.y, value: v.hp, max: v.max, color: V('barColor'), visible: s.front && Math.abs(s.ndc[0]) < 1.05 && Math.abs(s.ndc[1]) < 1.05, hit: !!v.barHit });
        v.barHit = false;
      }
      ctx.ui.bars('waves', rows);
    }
  }

  const api = {
    id, params: P,
    /** Every copy: {wave, alive, kills, targetHp, targetMax, phase, cleared, hasTarget}. */
    state() {
      const w = ctx.host ? [director.wave, kills, Math.round(targetHp * 10) / 10, director.phase] : (S?.w ?? [0, 0, V('targetHp'), 'wait']);
      return { wave: w[0], kills: w[1], targetHp: w[2], targetMax: V('targetHp'), phase: w[3], alive: ctx.host ? enemies.size : (S?.e?.length ?? 0), cleared: w[3] === 'done' && (ctx.host ? enemies.size : (S?.e?.length ?? 0)) === 0, hasTarget: !!targetPos() };
    },
    /** Host: hurt enemy `id` (opts {from: player, impulse, kind}). A kill scores killPoints for `from`. */
    damageEnemy,
    /** Host: hurt every enemy within `radius` of {x, z}. → how many were hit. */
    damageNear(point, radius, amount, opts = {}) { let n = 0; for (const e of live()) if (Math.hypot(e.x - point.x, e.z - point.z) <= radius) { damageEnemy(e.id, amount, { ...opts, impulse: opts.impulse ?? { x: (e.x - point.x) * 4, z: (e.z - point.z) * 4 } }); n++; } return n; },
    /** Host: spawn one enemy now (outside the wave plan). */
    spawnOne() { if (ctx.host && enemies.size < V('maxAlive')) spawn(waveStats(Math.max(1, director.wave), stats())); },
    /** Host: skip to the next wave now. */
    nextWave() { if (ctx.host) { director.phase = 'rest'; director.t = 0; } },
    /** Enemies now on this copy: [{id, x, z, hp, max}] (for bots and rules). */
    enemies: () => (ctx.host ? live().map(e => ({ ...pub(e), max: e.max })) : (S?.e ?? []).map(e => ({ id: e[0], x: e[1], z: e[2], hp: e[3], max: e[4] ?? e[3] }))),
    /** Host: {enemy, from} / {enemy} / {enemy, player} / {enemy, hp} / {}. → unsubscribe */
    onKill(fn) { L.kill.push(fn); return unsub(L.kill, fn); },
    onSpawn(fn) { L.spawn.push(fn); return unsub(L.spawn, fn); },
    onPlayerHit(fn) { L.playerHit.push(fn); return unsub(L.playerHit, fn); },
    onTargetHit(fn) { L.targetHit.push(fn); return unsub(L.targetHit, fn); },
    onTargetDown(fn) { L.targetDown.push(fn); return unsub(L.targetDown, fn); },
    /** QA (verify check 16, through window.__game.controls()): what this copy shows of hits and kills. */
    get stats() {
      const cam = ctx.camera;
      if (cam) cam.updateMatrixWorld();
      return {
        demo, oneHitKills: !!V('oneHitKills'), hitsSeen, deathsSeen, dying: dying.length, lastHit,
        kills: killLog.slice(-16),
        enemies: [...view.values()].filter(v => v.obj).map(v => ({ id: v.id, x: r2(v.x), z: r2(v.z), hp: v.hp, max: v.max, bar: v.hp < v.max - 1e-6,
          ...(cam ? { body: (({ x, y, front }) => ({ x: r2(x), y: r2(y), front }))(screen(v.x, V('height') * 0.55, v.z)), head: (({ x, y, front }) => ({ x: r2(x), y: r2(y), front }))(screen(v.x, V('height') + 0.32, v.z)), feet: (({ x, y }) => ({ x: r2(x), y: r2(y) }))(screen(v.x, 0, v.z)) } : {}) })),
      };
    },
    reset() { enemies.clear(); director.reset(); kills = 0; targetHp = V('targetHp'); targetDownFired = false; started = false; view.forEach(v => { v.obj?.removeFromParent(); v.character?.dispose?.(); }); view.clear(); dying.forEach(d => { d.v.obj?.removeFromParent(); d.v.character?.dispose?.(); }); dying.length = 0; lastList = null; lastWave = 0; recentKills.length = 0; demoT = 0; ctx.ui?.bars?.('waves', []); },
    update(dt) {
      if (!S) {
        if (!(ctx.shared && ctx.players && ctx.me)) return;
        S = ctx.shared.register('waves', { e: [], w: [0, 0, V('targetHp'), 'wait'], k: [] });
        loadTemplate();
        const prj = ctx.mechanics.get('projectile');
        if (V('hittable') && prj && !prj.standin && prj.addTargets) prj.addTargets({ list: () => (ctx.host ? live().map(e => ({ id: `e${e.id}`, x: e.x, y: 0, z: e.z, radius: 0.45, height: V('height') })) : []), hit: h => { const id = Number(String(h.target ?? h.targetId).replace(/^e/, '')); const e = enemies.get(id); if (e) e.shots++; damageEnemy(id, h.damage ?? 1, { from: h.shooter, kind: h.kind, impulse: h.dir ? { x: h.dir[0] * 4, z: h.dir[2] * 4 } : null }); } });
        // the crosshair stops on an enemy where this copy draws it (kit/core/aim.js), so a shot lands on the one under it
        if (V('hittable') && prj && !prj.standin) { aimSrc = () => [...view.values()].filter(v => v.obj).map(v => ({ id: `e${v.id}`, x: v.x, z: v.z, height: V('height'), radius: 0.45 })); (ctx.aimBodies ??= []).push(aimSrc); }
      }
      if (!templ && !loading && !hasBody()) loadTemplate();
      if (ctx.host) {
        if (ctx.round?.phase === 'playing') {
          if (!started) { started = true; }
          if (demo) demoStep(dt);
          else { const n = director.update(dt, enemies.size); for (let i = 0; i < n; i++) spawn(director.stats); }
          hostStep(Math.min(dt, 0.05));
        }
        S.e = live().map(e => [e.id, r2(e.x), r2(e.z), e.hp, e.max]);
        S.w = [director.wave, kills, Math.round(targetHp * 10) / 10, director.phase];
        S.k = recentKills.slice();
      }
      syncView(dt);
      // edges every copy: the wave banner
      const w = api.state();
      if (w.wave !== lastWave) { if (w.wave > lastWave && w.wave > 0 && V('banner')) ctx.ui?.banner(V('bannerText').replace('{n}', w.wave), 1.6); lastWave = w.wave; }
      // the target: a ring on the ground and a HUD bar
      if (api.state().hasTarget) {
        const tp = targetPos();
        if (!ring) { ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: V('color'), transparent: true, opacity: 0.6, depthWrite: false })); ring.position.set(tp.x, 0.04, tp.z); ctx.assets.tag(ring, 'mechanic.waves.color'); root.add(ring); }
        if (ctx.ui?.meter) { if (!meter) meter = ctx.ui.meter('target', { label: V('targetLabel'), value: w.targetHp, max: V('targetHp'), color: V('color') }); meter.set(w.targetHp, V('targetHp')); }
      }
    },
    dispose() { root.removeFromParent(); meter?.remove(); ctx.ui?.bars?.('waves', []); if (aimSrc && ctx.aimBodies) { const i = ctx.aimBodies.indexOf(aimSrc); if (i >= 0) ctx.aimBodies.splice(i, 1); } },
  };
  return api;
}
