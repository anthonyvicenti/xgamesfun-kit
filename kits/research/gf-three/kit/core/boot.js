// gf-three core: boot({rules}) — everything a game needs around its rules.js (CONTRACT §3).
//
//   import { boot } from './gf/three/core/boot.js'; import rules from './rules.js'; boot({ rules });
//
// Order: configs and assets.json → quality tier → renderer and look → Rapier → world → audio → UI → mechanics →
// players (and bots) → rules.setup(ctx) → the lobby (alone) or net.ready() (live) → the frame loop through net.loop,
// which never pauses. Real modules (look, world, character, mechanics) are used when gf/three/kit.js lists them;
// until tracks L, C and K2 land, the stand-ins in core/standins/ take their place.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import * as gf from '../../gf-assets.js';
import { createAudio } from '../../../audio/audio.js';
import audioPresets from '../../../audio/presets.json' with { type: 'json' };
import KIT from '../kit.js';
import { assets } from '../assets/assets.js';
import { createRng, seedOf } from './rng.js';
import { pickQuality, deviceFacts } from './quality.js';
import { createInput } from './input.js';
import { runShow } from './show.js';
import { createUI } from '../ui/ui.js';
import { createSession } from '../net/session.js';
import { listenForLoadout, pageLoadout } from '../net/looks.js';
import { createBrain, createBots, defaultBot } from '../bots/bots.js';
import { createFair } from './fair.js';
import { rayCylinder, BODY_RADIUS } from './aim.js';
import { sight } from './sight.js';
import { net } from '../../mp/net.js';

export const VERSION = KIT.version;
const H = 1 / 60;

async function loadModules() {
  const m = KIT.modules ?? {};
  const [look, world, character] = await Promise.all([
    m.look ? import('../look/look.js') : import('./standins/look.js'),
    m.world ? import('../world/world.js') : import('./standins/world.js'),
    m.character ? import('../character/character.js') : import('./standins/character.js'),
  ]);
  const mechanics = new Map();
  for (const id of m.mechanics ?? []) mechanics.set(id, await import(`../mechanics/${id}/index.js`));
  return { look, world, character, mechanics, standins: { look: !m.look, world: !m.world, character: !m.character } };
}

export async function boot({ rules = {} } = {}) {
  listenForLoadout(window);        // the page's loadout for this player (CONTRACT §6e): listen before anything loads
  const params = new URLSearchParams(location.search);
  const calm = Number(params.get('gf-calm') ?? 0) || 0;   // QA only (verify's walk test); never set in real play
  const subject = params.get('gf-show');
  const ctx = { THREE, kit: { name: 'gf-three', version: VERSION }, onFrame: [], time: { now: 0, dt: 0, round: 0, left: 0 } };
  let ui = null;
  try {
    await assets.init({ configs: ['game', 'look', 'world', 'characters', ...(KIT.modules?.world ? ['props'] : [])] });
    const game = assets.config('game'), lookCfg = assets.config('look'), charsCfg = assets.config('characters');
    ctx.config = game; ctx.assets = assets;
    // fair play (CONTRACT §6c): kit-owned and on by default; mechanics, players and bots ask it before a hit counts
    ctx.fair = createFair(ctx);
    ctx.bots = createBots(ctx);
    document.title = game.text?.title ?? game.title ?? document.title;
    await gf.applyCss();
    // the look's palette, when it has one, owns the accent colour (one slot per idea)
    if (lookCfg.palette?.accent) document.documentElement.style.setProperty('--gf-accent', lookCfg.palette.accent);
    const mods = await loadModules();
    ctx.modules = mods;

    // ---- seed, quality, renderer, scene, camera ----
    const seed = seedOf(params.get('seed') ?? net.seed ?? params.get('gf_seed') ?? (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 1));
    const rng = createRng(seed);
    ctx.rng = rng.fork('rules'); ctx.seed = seed;
    const quality = pickQuality(params.get('quality'), deviceFacts());
    ctx.quality = quality;
    const canvas = document.createElement('canvas'); canvas.id = 'gf-canvas'; canvas.tabIndex = 0;
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none';
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    document.body.append(canvas);
    const lookValues = lookCfg.values ?? lookCfg;
    const renderer = mods.look.createRenderer(canvas, lookValues, quality);
    assets.setRenderer(renderer);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
    Object.assign(ctx, { scene, camera, renderer });
    const look = mods.look.applyLook(ctx, lookValues) ?? {};
    ctx.look = look;
    const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix(); look.resize?.(innerWidth, innerHeight); };
    addEventListener('resize', resize); resize();

    // ---- physics and the world ----
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -(game.gravity ?? 20), z: 0 });
    world.timestep = H;
    ctx.physics = world; ctx.RAPIER = RAPIER;     // CONTRACT §3: physics is the Rapier world (the kit steps it)
    ctx.world = await mods.world.loadWorld(ctx, assets.config('world'));

    const characterFor = role => ({ bodySlot: `character.body.${role}`, height: charsCfg.roles?.[role]?.height ?? 1.7 });
    // a preview subject wears the page's loadout, so Studio can render an item's look (?gf-show=character.player)
    if (subject) { if (pageLoadout().loadout != null) assets.setLoadout('show', pageLoadout().loadout); return await showMode(ctx, subject, mods, characterFor, look); }

    // ---- audio, input, UI ----
    const audio = createAudio(await gf.sounds(), { presets: audioPresets.presets, storageKey: `gf3-${assets.manifest.game ?? 'game'}`, listen: true, fileUrl: gf.url });
    const v1 = new THREE.Vector3();
    ctx.audio = {
      raw: audio,
      /** play(soundId, {at: {x, y, z}, gainDb, pitch, optional}): at → panned and quieter with distance from the camera. */
      play(id, opts = {}) {
        const o = { ...opts };
        if (o.at) {
          v1.set(o.at.x, o.at.y ?? 0, o.at.z).applyMatrix4(camera.matrixWorldInverse);
          const d = v1.length();
          o.pan = Math.max(-0.8, Math.min(0.8, v1.x / Math.max(3, d)));
          o.gainDb = (o.gainDb ?? 0) - Math.min(18, Math.max(0, (d - 4) * 0.6));
          delete o.at;
        }
        if (!audio.has(id)) { if (!o.optional) console.warn(`gf-three audio: no sound "${id}"`); return null; }
        return audio.play(id, o);
      },
      has: id => audio.has(id), stop: id => audio.stop(id),
    };
    const input = createInput(canvas);
    ctx.input = input;
    ui = createUI(ctx, { text: game.text ?? {}, controls: game.controls ?? {} });
    ctx.ui = ui;

    // ---- mechanics: the real module when present, else its params alone (the rules read them) ----
    const list = [];
    ctx.mechanics = { get: id => list.find(m => m.id === id) ?? null, list: () => list.slice() };
    for (const spec of game.mechanics ?? []) {
      const mod = mods.mechanics.get(spec.id);
      const inst = mod ? mod.create(ctx, spec.params ?? {}) : {};
      inst.id = spec.id; inst.as = spec.as; inst.params = { ...(spec.params ?? {}) }; inst.standin = !mod;
      list.push(inst);
    }
    ctx.mechanicsList = list;
    // an aimed mechanic (projectile; carry with a throw action) means a crosshair, and the shooter turns to the aim while
    // firing (CONTRACT §6d); rules may still call ui.crosshair themselves
    ctx.aimed = list.some(m => !m.standin && m.aimed === true);

    // ---- players, bots and the round ----
    const botParam = params.get('bots');
    const max = game.players?.max ?? 4;
    const botCount = botParam !== null ? Math.max(0, Math.min(7, Number(botParam) || 0)) : game.players?.bots === false ? 0 : max - 1;
    const T = game.text ?? {};
    ctx.makeBot = p => createBrain(ctx, p, rng.fork(`bot:${p.id}`));
    const session = createSession(ctx, { rules, spawnCharacter: mods.character.spawnCharacter, characterFor, rng, botCount, onPhase: ph => onPhase(ph) });
    ctx.round = {
      get phase() { return session.round.phase; }, get number() { return session.round.number; },
      get winners() { return session.round.winners; }, get reason() { return session.round.reason; },
      end: (reason = 'ended', winners = null) => session.end(reason, winners),
    };
    await session.start();
    const me = ctx.me;
    me.actions = input.actions;              // the local player's actions are the input's (edges included)
    if ((game.camera ?? 'third') === 'first') me.character.object3d.visible = false;
    ui.crosshair((game.camera ?? 'third') !== 'top' && ctx.aimed);
    // mechanics that need players, ctx.shared or ctx.me get them here (create() runs before the session exists)
    ctx.fair.setup();
    for (const m of list) { try { await m.setup?.(ctx); } catch (e) { console.error(e); } }
    try { await rules.setup?.(ctx); } catch (e) { console.error(e); throw e; }

    function onPhase(ph) {
      for (const p of ctx.players.owned()) if (p.controller) p.controller.enabled = ph === 'playing';
      if (ph === 'countdown') ctx.audio.play('round-countdown', { optional: true });
      if (ph === 'playing') { ui.hideCard(); ui.banner(T.go ?? 'Go!', 1.2); ctx.audio.play('round-go', { optional: true }); canvas.focus(); }
      if (ph === 'results') {
        const w = session.round.winners ?? [];
        const names = w.map(id => ctx.players.get(id)?.name ?? id);
        const title = names.length ? (T.wins ?? '{name} wins!').replace('{name}', names.join(' & ')) : (T.draw ?? 'Round over');
        ui.results({ title, rows: session.round.rows ?? [], winners: w, onAgain: session.live || game.round?.replay === false ? null : () => { ctx.audio.play('ui-click', { optional: true }); session.replay(); } });
        ctx.audio.play(w.includes(ctx.me?.id) ? 'round-win' : 'round-end', { optional: true });
        try { document.exitPointerLock?.(); } catch {}
      }
    }
    const lobby = () => ui.lobby({ title: T.title ?? game.title, hook: T.hook ?? game.hook ?? '', players: ctx.players.list(), onPlay: () => { ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); } });
    // QA and capture only (never in real play): ?gf-autoplay=1 skips the lobby alone; ?gf-ui=0 hides the HUD; ?gf-calm=N stills bots for N s
    if (params.get('gf-ui') === '0') ui.root.style.display = 'none';
    if (session.live) { ui.waiting(); session.arm(); session.ready(); }
    else if (params.get('gf-autoplay') === '1') session.beginCountdown();
    else {
      lobby();
      addEventListener('keydown', e => { if ((e.code === 'Enter' || e.code === 'Space') && session.round.phase === 'lobby' && ui.view === 'lobby') { e.preventDefault(); ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); } });
    }

    // ---- the observation (CONTRACT §5): read-only ----
    const r2 = v => Math.round(v * 100) / 100;
    const observe = () => ({
      kit: 'gf-three', version: VERSION, phase: session.round.phase, round: session.round.number, seed, quality: quality.name,
      time: { now: r2(ctx.time.now), round: r2(ctx.time.round), left: r2(ctx.time.left) },
      me: me.id, host: ctx.host, live: session.live, view: ui.view,
      players: ctx.players.list().map(p => ({ id: p.id, name: p.name, score: p.score, alive: p.alive, bot: p.isBot, local: p.local, x: r2(p.position.x), y: r2(p.position.y), z: r2(p.position.z), anim: p.anim, ...ctx.fair.observe(p) })),
      fair: ctx.fair.summary(),
      winners: session.round.winners, reason: session.round.reason, results: session.round.rows,
      shared: ctx.shared.snapshot(),
      rules: (() => { try { return rules.observe?.(ctx) ?? null; } catch { return null; } })(),
      modules: { standins: mods.standins, mechanics: list.map(m => ({ id: m.id, standin: m.standin })) },
      net: session.gateBlock(ui.covered),
    });
    window.__game = Object.freeze({
      kit: 'gf-three', version: VERSION, seed, quality: quality.name,
      get phase() { return session.round.phase; },
      get ready() { return true; },
      get players() { return observe().players; },
      snapshot: () => JSON.parse(JSON.stringify(observe())),
      coverage: () => coverageReport(scene),
      slots: () => assets.stats(scene, camera),
      controls: () => JSON.parse(JSON.stringify(controlsReport())),
      looks: () => JSON.parse(JSON.stringify(looksReport())),
      sight: ids => sight({ renderer, scene, camera }, ids),       // verify check 15: a slot's share of this player's view
    });

    // ---- the looks observation (CONTRACT §6e; verify check 5's loadout leg): what this copy draws each player in ----
    function looksReport() {
      const prj = list.find(m => m.id === 'projectile' && !m.standin);
      return {
        me: me.id, local: ctx.looks?.observe?.() ?? null, slots: assets.playerLooks(),
        players: ctx.players.list().map(p => {
          const r = assets.loadout(p.id), look = p.character?.look ?? null;
          return {
            id: p.id, name: p.name, bot: p.isBot, local: p.local, seat: p.seat, color: p.color,
            key: r?.key ?? '', advertised: r?.advertised ?? '', values: r?.loadout.values ?? {}, files: r?.loadout.files ?? {},
            dropped: [...(r?.dropped ?? []), ...[...(r?.rejected ?? new Map())].map(([slot, why]) => ({ slot, why }))],
            drawn: look ? { ...look, visible: !!p.character.object3d.visible } : null,
            shots: prj?.lookOf?.(p) ?? null,
          };
        }),
      };
    }

    // ---- the controls observation (verify check 13): what the local player's own screen shows of each control ----
    const sv = new THREE.Vector3();
    const screenOf = q => { if (!q) return null; sv.set(q.x, q.y, q.z).project(camera); return { x: r2((sv.x * 0.5 + 0.5) * innerWidth), y: r2((-sv.y * 0.5 + 0.5) * innerHeight), front: sv.z < 1 && sv.z > -1 }; };
    const hiddenBySelf = q => {
      if (!q || (game.camera ?? 'third') !== 'third') return false;
      const from = camera.position, dx = q.x - from.x, dy = q.y - from.y, dz = q.z - from.z, d = Math.hypot(dx, dy, dz) || 1;
      const t = rayCylinder(from, { x: dx / d, y: dy / d, z: dz / d }, me.position, me.character?.height ?? 1.7, BODY_RADIUS);
      return t !== null && t < d - 0.3;
    };
    function controlsReport() {
      const pt = q => (q ? { x: r2(q.x), y: r2(q.y), z: r2(q.z) } : null);
      const prj = list.find(m => m.id === 'projectile' && !m.standin);
      const land = prj?.landing?.(me) ?? null, aimP = me.aimPoint ?? null;
      const inter = [];
      for (const m of list) { if (m.standin || typeof m.interactables !== 'function') continue; try { for (const it of m.interactables()) inter.push({ ...it, x: r2(it.x), y: r2(it.y ?? 0), z: r2(it.z), d: r2(Math.hypot(it.x - me.position.x, it.z - me.position.z)) }); } catch (e) { console.error(e); } }
      inter.sort((a, b) => a.d - b.d);
      return {
        camera: game.camera ?? 'third', crosshair: ui.crosshairOn, aimed: !!ctx.aimed, controls: game.controls ?? {}, prompt: ui.promptText,
        viewport: { w: innerWidth, h: innerHeight },
        aim: { dir: (me.aim ?? []).map(r2), dist: Number.isFinite(me.aimDist) ? r2(me.aimDist) : null, point: pt(aimP), hit: me.aimHit ?? null, onSelf: !!me.aimOnSelf, screen: screenOf(aimP) },
        landing: land ? { point: pt(land), age: r2(ctx.time.now - (land.at ?? ctx.time.now)), screen: screenOf(land), hiddenBySelf: hiddenBySelf(land), fromAim: aimP ? r2(Math.hypot(land.x - aimP.x, land.z - aimP.z)) : null } : null,
        interactables: inter,
        mechanics: list.filter(m => !m.standin).map(m => ({ id: m.id, aimed: !!m.aimed, interacts: !!m.interacts, ...(m.stats ? { stats: m.stats } : {}) })),
        me: { x: r2(me.position.x), y: r2(me.position.y), z: r2(me.position.z), alive: me.alive !== false, holding: list.find(m => m.id === 'carry' && !m.standin)?.heldCount?.(me) ?? 0 },
      };
    }

    // ---- the frame ----
    let last = null, acc = 0;
    const plate = new THREE.Vector3();
    session.loop(t => {
      const dt = last === null ? 0 : Math.max(0, Math.min(0.1, (t - last) / 1000)); last = t;
      ctx.time.now += dt; ctx.time.dt = dt;
      const phase = session.round.phase;
      input.enabled = phase === 'playing' && !ui.covered;
      input.update();
      if (phase === 'countdown') ui.countdown(Math.max(1, Math.ceil(session.round.countdown)));
      session.tick(dt);
      const R = game.round ?? {};
      ctx.time.round = session.round.clock; ctx.time.left = Math.max(0, (R.seconds ?? 120) - session.round.clock);
      // bots (the host's)
      if (ctx.host) for (const p of ctx.players.bots()) {
        if (!p.owned || !p.bot) continue;
        p.bot.begin();
        // QA only: ?gf-calm=<seconds> keeps bots still at the start of each round, so a scripted walk can't be knocked over
        if (session.round.phase === 'playing' && !(calm > 0 && session.round.clock < calm)) { try { if (rules.bot) rules.bot(ctx, p, dt); else defaultBot(ctx, p); } catch (e) { console.error(e); } }
        else p.bot.stop();
        p.bot.finish(dt);
      }
      // physics at a fixed 60 Hz
      acc += dt; let steps = 0;
      const owned = ctx.players.owned().filter(p => p.controller);
      while (acc >= H && steps < 6) { for (const p of owned) p.controller.fixedStep(); world.step(); for (const p of owned) p.controller.postStep(); acc -= H; steps++; }
      if (acc > H) acc = 0;
      for (const p of owned) { p.controller.update(dt, acc / H); p.position.copy(p.controller.feet); p.yaw = p.controller.state.facing; p.anim = p.controller.anim; }
      try { ctx.fair.update(dt); } catch (e) { console.error(e); }      // who is down or protected, before any hit this frame
      for (const m of list) { try { m.update?.(dt); } catch (e) { console.error(e); } }
      try { rules.update?.(ctx, dt); } catch (e) { console.error(e); }
      for (const fn of ctx.onFrame) fn(dt);
      session.send();
      ctx.world.update?.(dt);
      look.update?.(dt, me.position);
      // nameplates over everyone else
      const w = innerWidth, h = innerHeight, plates = [];
      for (const p of ctx.players.list()) {
        if (p.local) continue;
        const shown = (p.owned || p.drawn) && p.character?.object3d.visible;
        plate.set(p.position.x, p.position.y + (p.character?.height ?? 1.7) + 0.3, p.position.z).project(camera);
        const vis = !!shown && plate.z > -1 && plate.z < 1 && Math.abs(plate.x) < 1.05 && Math.abs(plate.y) < 1.05;
        plates.push({ id: p.id, text: p.name, color: p.color, x: (plate.x * 0.5 + 0.5) * w, y: (-plate.y * 0.5 + 0.5) * h, visible: vis });
      }
      ui.update(dt, { left: phase === 'playing' ? ctx.time.left : null, players: ctx.players.list(), plates });
      if (look.render) look.render(camera); else renderer.render(scene, camera);
    });
    return ctx;
  } catch (e) {
    console.error(e);
    fatal(e);
    throw e;
  }
}

/** R3 plus: every slot id in the scene must exist in assets.json. */
function coverageReport(scene) {
  const r = assets.coverage(scene);
  const unknown = new Set();
  scene.traverse(o => { const id = o.userData?.gfSlot; if (id && !assets.has(id)) unknown.add(id); });
  return { ...r, unknownSlots: [...unknown] };
}

async function showMode(ctx, subject, mods, characterFor, look) {
  const state = await runShow(ctx, subject, { spawnCharacter: mods.character.spawnCharacter, characterFor, mechanics: new Map() });
  window.__game = Object.freeze({
    kit: 'gf-three', version: VERSION, phase: 'show', subject,
    get ready() { return state.ready; },
    snapshot: () => ({ kit: 'gf-three', version: VERSION, phase: 'show', subject, ready: state.ready }),
    coverage: () => coverageReport(ctx.scene),
    slots: () => assets.stats(ctx.scene, ctx.camera),
  });
  let last = null;
  net.loop(t => {
    const dt = last === null ? 0 : Math.max(0, Math.min(0.1, (t - last) / 1000)); last = t;
    for (const fn of ctx.onFrame) fn(dt);
    ctx.world.update?.(dt);
    look.update?.(dt, { x: 0, y: 0, z: 0 });
    if (look.render) look.render(ctx.camera); else ctx.renderer.render(ctx.scene, ctx.camera);
  });
  return ctx;
}

function fatal(e) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;padding:12px 16px;background:#3a1020;color:#fff;font:14px system-ui;border-radius:10px;z-index:9';
  d.textContent = `The game could not start: ${e?.message ?? e}`;
  document.body.append(d);
}
