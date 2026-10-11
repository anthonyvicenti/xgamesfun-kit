// gf-three core: boot({rules}) — everything a game needs around its rules.js (CONTRACT §3).
//
//   import { boot } from './gf/three/core/boot.js'; import rules from './rules.js'; boot({ rules });
//
// Order: configs and assets.json → quality tier → renderer and look → Rapier → world → audio → UI → mechanics →
// players (and bots) → rules.setup(ctx) → the home menu (alone: kit/ui/menu.js) or net.ready() (live) → the frame loop
// through net.loop,
// which never pauses. Real modules (look, world, character, mechanics) are used when gf/three/kit.js lists them;
// until tracks L, C and K2 land, the stand-ins in core/standins/ take their place.
// Engines (CONTRACT §8): kit.js `engine` is 'party' (this kit's own look and world) or 'scenic' (the look and world of
// research/gf-scenic, vendored beside this copy as gf/scenic/); everything else is this kit's, whichever the engine.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import * as gf from '../../gf-assets.js';
import { createAudio } from '../../../audio/audio.js';
import audioPresets from '../../../audio/presets.json' with { type: 'json' };
import KIT from '../kit.js';
import { assets } from '../assets/assets.js';
import { createRng, seedOf } from './rng.js';
import { pickQuality, deviceFacts } from './quality.js';
import { pixelRatioFor, watchPixelRatio, createGovernor, PIXEL_BUDGET } from './resolution.js';
import { createInput } from './input.js';
import { runShow } from './show.js';
import { createUI } from '../ui/ui.js';
import { createHud } from '../ui/hud.js';
import { createMenu, loadSettings } from '../ui/menu.js';
import { listenForHost, host } from '../net/host.js';
import { createSession } from '../net/session.js';
import { createPlayers } from '../net/players.js';
import { listenForLoadout, pageLoadout } from '../net/looks.js';
import { createBrain, createBots, defaultBot } from '../bots/bots.js';
import { createFair } from './fair.js';
import { rayCylinder, BODY_RADIUS } from './aim.js';
import { sight } from './sight.js';
import * as refusals from './refusals.js';
import { net } from '../../mp/net.js';
import { RIG_DEFAULTS } from '../controller/camera-rig.js';
import { AIM_HEIGHT } from './aim.js';

export const VERSION = KIT.version;
const H = 1 / 60;

export const ENGINE = KIT.engine ?? 'party';

async function loadModules(worldCfg = {}, used = null) {
  const m = KIT.modules ?? {};
  const scenic = ENGINE === 'scenic';
  // a voxel world (CONTRACT §9, worlds) is its own world module, whichever engine draws the rest
  const voxel = worldCfg?.template === 'voxel';
  const [look, world, character] = await Promise.all([
    scenic ? import('../../scenic/look/look.js') : m.look ? import('../look/look.js') : import('./standins/look.js'),
    voxel ? import('../world/voxel/world.js') : scenic ? import('../../scenic/world/world.js') : m.world ? import('../world/world.js') : import('./standins/world.js'),
    m.character ? import('../character/character.js') : import('./standins/character.js'),
  ]);
  const mechanics = new Map();
  // only the mechanics this game uses (kit.js lists every one the kit carries; a phone in a post loads less)
  for (const id of m.mechanics ?? []) if (!used || used.has(id)) mechanics.set(id, await import(`../mechanics/${id}/index.js`));
  return { look, world, character, mechanics, engine: ENGINE, voxel, standins: { look: !scenic && !m.look, world: !scenic && !voxel && !m.world, character: !m.character } };
}

export async function boot({ rules = {} } = {}) {
  listenForHost(window);           // the page hosting the game: wallet, items, friends (CONTRACT §6g)
  listenForLoadout(window);        // the page's loadout for this player (CONTRACT §6e): listen before anything loads
  const params = new URLSearchParams(location.search);
  const calm = Number(params.get('gf-calm') ?? 0) || 0;   // QA only (verify's walk test); never set in real play
  const subject = params.get('gf-show');
  // the friends lobby's backdrop (multiplayer.json live.backdrop, gf-multiplayer 1.4.0): this game's world behind the
  // waiting room, the camera circling a character; silent, no menu or HUD, no bots, nothing saved. Never in a round.
  const backdrop = params.get('gf-backdrop') === '1' && !net.active;
  const ctx = { THREE, kit: { name: 'gf-three', engine: ENGINE, version: VERSION }, onFrame: [], time: { now: 0, dt: 0, round: 0, left: 0 } };
  let ui = null;
  try {
    await assets.init({ configs: ['game', 'look', 'world', 'characters'] });
    // the prop catalog belongs to a layout world; a voxel world (CONTRACT §9) has none, so it is never asked for
    if (KIT.modules?.world && assets.config('world')?.template !== 'voxel') await assets.addConfig('props');
    const game = assets.config('game'), lookCfg = assets.config('look'), charsCfg = assets.config('characters');
    ctx.config = game; ctx.assets = assets;
    // fair play (CONTRACT §6c): kit-owned and on by default; mechanics, players and bots ask it before a hit counts
    ctx.fair = createFair(ctx);
    ctx.bots = createBots(ctx);
    document.title = game.text?.title ?? game.title ?? document.title;
    await gf.applyCss();
    // the look's palette, when it has one, owns the accent colour (one slot per idea)
    if (lookCfg.palette?.accent) document.documentElement.style.setProperty('--gf-accent', lookCfg.palette.accent);
    const mods = await loadModules(assets.config('world'), new Set((game.mechanics ?? []).map(x => x.id)));
    // a world (CONTRACT §9): no rounds; players drop in and out; the world is saved on the play host
    const worldMode = game.round?.mode === 'world';
    ctx.modules = mods;

    // ---- seed, quality, renderer, scene, camera ----
    const seed = seedOf(params.get('seed') ?? net.seed ?? params.get('gf_seed') ?? (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 1));
    const rng = createRng(seed);
    ctx.rng = rng.fork('rules'); ctx.seed = seed;
    const gameId = assets.manifest?.game ?? 'game', saved = loadSettings(gameId);
    const quality = pickQuality(params.get('quality') ?? (saved.quality !== 'auto' ? saved.quality : null), deviceFacts());
    ctx.quality = quality;
    const canvas = document.createElement('canvas'); canvas.id = 'gf-canvas'; canvas.tabIndex = 0;
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none';
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    document.body.append(canvas);
    const lookValues = lookCfg.values ?? lookCfg;
    const renderer = mods.look.createRenderer(canvas, lookValues, quality);
    // a look may need to finish setting up its renderer first (WebGPURenderer.init(): the scenic engine, CONTRACT §8)
    await mods.look.ready?.(renderer);
    assets.setRenderer(renderer);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
    Object.assign(ctx, { scene, camera, renderer });
    const look = mods.look.applyLook(ctx, lookValues) ?? {};
    ctx.look = look;
    // the pixels drawn (kit/core/resolution.js, CONTRACT §6i): the screen's real pixels within the tier's budget, again
    // on every resize and zoom; a game that cannot keep up draws fewer (the governor), never under one CSS pixel.
    // ?gf-res=fixed (QA) keeps the full ratio.
    const budget = quality.pixelBudget ?? PIXEL_BUDGET[quality.name] ?? PIXEL_BUDGET.high;
    const governor = params.get('gf-res') === 'fixed' ? null : createGovernor();
    const res = { target: 1, ratio: 1, budget };
    const applyRatio = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      res.target = pixelRatioFor({ dpr, width: innerWidth, height: innerHeight, budget });
      res.ratio = Math.max(Math.min(dpr, 1), res.target * (governor?.scale ?? 1));
      renderer.setPixelRatio(res.ratio);
    };
    const resize = () => { governor?.reset(); applyRatio(); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix(); look.resize?.(innerWidth, innerHeight); };
    addEventListener('resize', resize); watchPixelRatio(globalThis, resize); resize();
    ctx.resolution = res;

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
    const audio = createAudio(await gf.sounds(), { presets: audioPresets.presets, storageKey: backdrop ? undefined : `gf3-${assets.manifest.game ?? 'game'}`, listen: !backdrop, fileUrl: gf.url });
    if (backdrop) audio.muted = true;          // not saved: no storage key
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
        if (!audio.has(id)) { if (!o.optional) refusals.refuse('sound-unlisted', `ctx.audio.play("${id}"): no sound with that id in assets.json → sounds → sounds (list it there, or pass { optional: true })`, id); return null; }
        return audio.play(id, o);
      },
      has: id => audio.has(id), stop: id => audio.stop(id),
    };
    const input = createInput(canvas);
    ctx.input = input;
    ui = createUI(ctx, { text: game.text ?? {}, controls: game.controls ?? {} });
    ctx.ui = ui;
    if (worldMode) { ui.timer(false); ui.score([]); }      // a world has no clock and no scores
    // the kit's HUD (CONTRACT §6g): the player's own state from the mechanics; the rules add to it, never take it away
    let menu = null;
    const openPause = () => { if (!menu || menu.view || !['playing', 'countdown'].includes(ctx.round?.phase)) return; menu.pause(); try { document.exitPointerLock?.(); } catch {} };
    const hud = createHud(ctx, ui, { onMenu: () => openPause() });
    ctx.hud = hud; ui.goalTo = t => { if (refusals.goalCall(t)) hud.goal(t); };
    hud.setGoal(refusals.startGoal(game));

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
    const botCount = backdrop ? 0 : botParam !== null ? Math.max(0, Math.min(7, Number(botParam) || 0)) : game.players?.bots === false ? 0 : max - 1;
    const T = game.text ?? {};
    ctx.makeBot = p => createBrain(ctx, p, rng.fork(`bot:${p.id}`));
    const session = createSession(ctx, { rules, spawnCharacter: mods.character.spawnCharacter, characterFor, rng, botCount, onPhase: ph => onPhase(ph), createPlayers });
    ctx.round = {
      get phase() { return session.round.phase; }, get number() { return session.round.number; },
      get winners() { return session.round.winners; }, get reason() { return session.round.reason; },
      end: (reason = 'ended', winners = null) => session.end(reason, winners),
    };
    await session.start();
    const me = ctx.me;
    me.actions = input.actions;              // the local player's actions are the input's (edges included)
    if ((game.camera ?? 'third') === 'first') me.character.object3d.visible = false;
    // the reticle in the middle of the screen is for the third and first cameras; with 'follow' the mouse cursor itself
    // aims (CONTRACT §8), drawn as a crosshair cursor
    const camMode = game.camera ?? 'third';
    ui.crosshair((camMode === 'third' || camMode === 'first') && ctx.aimed);
    // first person in a world (CONTRACT §9): the reticle while the middle of the screen aims (the lock taken, or not yet
    // asked for); none while the cursor or a finger aims (a post on X, a phone), where the outline shows the block
    const firstWorld = worldMode && camMode === 'first';
    if (camMode === 'follow') canvas.style.cursor = 'crosshair';
    // mechanics that need players, ctx.shared or ctx.me get them here (create() runs before the session exists)
    ctx.fair.setup();
    for (const m of list) { try { await m.setup?.(ctx); } catch (e) { console.error(e); } }
    try { await rules.setup?.(ctx); } catch (e) { console.error(e); throw e; }

    function onPhase(ph) {
      for (const p of ctx.players.owned()) if (p.controller) p.controller.enabled = ph === 'playing';
      if (ph === 'countdown') { menu?.close(); ctx.audio.play('round-countdown', { optional: true }); }
      if (ph === 'playing' && worldMode) { ui.hideCard(); if (menu?.view && !menu.paused) menu.close(); if (T.welcome) ui.banner(T.welcome, 2); ctx.audio.play('world-enter', { optional: true }); canvas.focus(); return; }
      if (ph === 'playing') { ui.cover('results', false); ui.hideCard(); if (menu?.view && !menu.paused) menu.close(); ui.banner(T.go ?? 'Go!', 1.2); ctx.audio.play('round-go', { optional: true }); canvas.focus(); }
      if (ph === 'lobby') { ui.hideCard(); if (!session.live) menu?.home(); else if (worldMode) menu?.close(); try { document.exitPointerLock?.(); } catch {} }
      if (ph === 'results') {
        menu?.close();
        const w = session.round.winners ?? [];
        // with friends the party page's results card is the one result screen (gf-multiplayer 1.4.0): every player in
        // their colour with their own score, Play again for the host. Two cards that disagreed (one counting bots) was
        // the creator's "Final scores seem to always be the same regardless".
        if (session.live) { ui.cover('results', true); ctx.audio.play(w.includes(ctx.me?.id) ? 'round-win' : 'round-end', { optional: true }); try { document.exitPointerLock?.(); } catch {} return; }
        const names = w.map(id => ctx.players.get(id)?.name ?? id);
        // a run lost together (everyone down: the levels mechanic ends with 'lost') says so, not "nobody scored"
        const title = names.length ? (T.wins ?? '{name} wins!').replace('{name}', names.join(' & ')) : session.round.reason === 'lost' ? (T.lost ?? 'Defeated') : (T.draw ?? 'Round over');
        ui.results({ title, rows: session.round.rows ?? [], winners: w,
          onAgain: session.live || game.round?.replay === false ? null : () => { ctx.audio.play('ui-click', { optional: true }); session.replay(); },
          onMenu: session.live ? null : () => { ctx.audio.play('ui-click', { optional: true }); session.toLobby(); } });
        ctx.audio.play(w.includes(ctx.me?.id) ? 'round-win' : 'round-end', { optional: true });
        try { document.exitPointerLock?.(); } catch {}
      }
    }
    // the home menu (CONTRACT §6g): every game opens on it alone; in a live round the party page is the lobby, and the
    // menu is the pause menu (the round keeps going)
    const friendsPage = () => new URL('gf/mp/index.html', location.href).href;
    menu = createMenu(ctx, ui, {
      game, live: session.live, world: worldMode, gameId, host, players: () => ctx.players.list(),
      onPlay: () => { if (session.round.phase === 'lobby') { ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); } },
      onFriends: () => { if (host.present && host.offers.friends) host.friends(); else location.href = friendsPage(); },
      onResume: () => { menu.close(); canvas.focus(); },
      onLeave: () => { menu.close(); session.toLobby(); },
      onQuality: () => { if (!session.live) location.reload(); },
      // with friends the pause menu carries the room (gf-multiplayer 1.4.0, live.hud "game"): code, invite, leave, end round
      // End round goes through this game's own round end (the host owns it), so every copy reports its real score
      room: session.live ? { info: () => net.room, leave: () => { menu.close(); net.leave(); }, end: worldMode ? null : () => { menu.close(); session.end('ended'); canvas.focus(); },
        // watch then play (gf-multiplayer 1.6.0): Go live, and the stream's state while it is on
        // (net.live is undefined on a gf/mp older than 1.6.0: the menu then offers no Go live)
        live: () => net.live ?? null, goLive: () => { menu.close(); canvas.focus(); net.live?.start?.(); }, showLive: () => { menu.close(); canvas.focus(); net.live?.share?.(); } } : null,
    });
    ctx.menu = menu;
    if (session.live) net.live?.onChange?.(() => menu.redraw?.());
    // QA and capture only (never in real play): ?gf-autoplay=1 skips the menu alone; ?gf-ui=0 hides the HUD; ?gf-calm=N stills bots for N s
    if (params.get('gf-ui') === '0' || backdrop) ui.root.style.display = 'none';
    if (backdrop) { input.enabled = false; canvas.tabIndex = -1; }
    // a world with friends: the party page's world card is the home menu; the game shows its world behind it
    if (session.live && worldMode) { session.arm(); session.ready(); }
    else if (session.live) { ui.waiting(); session.arm(); session.ready(); }
    else if (params.get('gf-autoplay') === '1') session.beginCountdown();
    else menu.home();
    const watchStyle = document.createElement('style');
    // a viewer keeps what everyone in the round sees (names, bars, the clock, the scores, the banner, the goal, a boss),
    // never the streamer-less player's own card, prompts, menu or touch buttons (play-test 1: no clock, scores or winner)
    watchStyle.textContent = '#gf-ui.gf-watching > :not(.gf-plates):not(.gf-bars):not(.gf-fsbtn):not(.gf-top):not(.gf-scores):not(.gf-banner):not(.gf-goal):not(.gf-bossbar){display:none !important}';
    document.head.append(watchStyle);
    addEventListener('keydown', e => {
      if (backdrop || session.watching) return;
      const a = document.activeElement, onControl = a && (a.tagName === 'BUTTON' || a.tagName === 'INPUT');
      if ((e.code === 'Enter' || e.code === 'Space') && !onControl && session.round.phase === 'lobby' && menu.view === 'home') { e.preventDefault(); menu.close(); ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); }
      if (e.code === 'Escape' && !e.defaultPrevented && !menu.view && ['playing', 'countdown'].includes(session.round.phase)) { e.preventDefault(); openPause(); }
    });

    // ---- the observation (CONTRACT §5): read-only ----
    const r2 = v => Math.round(v * 100) / 100;
    // the colour a player's ring is drawn in (verify: one colour per player, the room's)
    const ringColor = p => { const m = p.character?.object3d.getObjectByName('ring')?.material; return m?.color ? `#${m.color.getHexString()}` : null; };
    const observe = () => ({
      kit: 'gf-three', engine: ENGINE, version: VERSION, phase: session.round.phase, round: session.round.number, seed, quality: quality.name,
      time: { now: r2(ctx.time.now), round: r2(ctx.time.round), left: r2(ctx.time.left) },
      me: me.id, host: ctx.host, live: session.live, backdrop, view: menu.view ?? ui.view, paused: menu.paused && !session.live,
      players: ctx.players.list().map(p => ({ id: p.id, name: p.name, score: p.score, alive: p.alive, bot: p.isBot, local: p.local, x: r2(p.position.x), y: r2(p.position.y), z: r2(p.position.z), anim: p.anim,
        color: p.color, ring: ringColor(p), ...ctx.fair.observe(p) })),
      fair: ctx.fair.summary(),
      refusals: refusals.list(),
      winners: session.round.winners, reason: session.round.reason, results: session.round.rows,
      shared: ctx.shared.snapshot(),
      rules: (() => { try { return rules.observe?.(ctx) ?? null; } catch { return null; } })(),
      modules: { standins: mods.standins, mechanics: list.map(m => ({ id: m.id, standin: m.standin })) },
      net: session.gateBlock(ui.covered),
      // watch then play (gf-multiplayer 1.6.0): a viewer's copy, who it follows and whether the camera has them
      watch: session.watching ? { follow: session.watch?.follow ?? null, live: !!session.watch?.live, target: watchCam.target, camera: camMode } : null,
      world: worldMode ? { status: net.status ?? null, voxel: ctx.world.voxel?.stats?.() ?? null } : null,
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
      menu: () => JSON.parse(JSON.stringify(menu.observe())),      // verify checks 20 and 22 (CONTRACT §6g)
      hud: () => JSON.parse(JSON.stringify({ phase: session.round.phase, covered: ui.covered, ...hud.observe() })),   // verify check 21
      looks: () => JSON.parse(JSON.stringify(looksReport())),
      // verify check 24 (a post's frame that refuses the pointer lock): the camera, its heading, the lock and full screen
      // (worlds' checks also read the pitch, the input's cursor mode by name and whether the aim follows the pointer)
      camera: () => JSON.parse(JSON.stringify({ mode: camMode, yaw: me.controller?.rig?.yaw ?? null, pitch: me.controller?.rig?.pitch ?? null, cursorMode: !!input.cursorMode,
        cursor: input.cursorMode || null, aimFree: !!input.aimFree, eye: [camera.position.x, camera.position.y, camera.position.z].map(v => Math.round(v * 1000) / 1000),
        dir: camera.getWorldDirection(new THREE.Vector3()).toArray().map(v => Math.round(v * 1000) / 1000),      // where the view looks (check 34: a viewer sees as the streamer does) sensitivity: me.controller?.rig?.settings?.sensitivity ?? null, lookScale: input.lookScale ?? 1, invertY: !!input.invertY,
        crosshair: !!ui.crosshairOn, lockRefused: !!input.lockRefused, locked: !!input.locked, fullscreen: hud.fullscreen?.() ?? null })),
      sight: ids => sight({ renderer, scene, camera }, ids),       // verify check 15: a slot's share of this player's view
      // where a world point is on this screen (verify check 34: a viewer's nameplates sit over the characters)
      project: (x, y, z) => screenOf({ x, y, z }),
      // verify check 31 (sharp on every screen, CONTRACT §6i): the screen, the canvas's drawing buffer, the ratio drawn
      // and the one the screen gets (they differ only when the frame-rate guard lowered it, and `slow` says why)
      screen: () => { const c = renderer.domElement; return JSON.parse(JSON.stringify({ dpr: globalThis.devicePixelRatio || 1, css: [innerWidth, innerHeight], buffer: [c.width, c.height],
        ratio: res.ratio, target: res.target, budget: res.budget, quality: quality.name, slow: governor?.last ?? null, guard: !!governor })); },
      // worlds (CONTRACT §9; verify's world checks): the cells, the build tools' state, and where a point is on screen
      ...(ctx.world.voxel ? {
        voxelAt: (x, y, z) => ctx.world.voxel.grid.get(x, y, z),
        topAt: (x, z) => ctx.world.voxel.grid.top(x, z),
        signAt: (x, y, z) => ctx.world.voxel.signs.get(ctx.world.voxel.grid.index(x, y, z)),
        protectedAt: (x, y, z) => ctx.world.voxel.protectedAt(x, y, z),
        build: () => JSON.parse(JSON.stringify(list.find(m => m.id === 'build')?.observe?.() ?? null)),
        shove: () => JSON.parse(JSON.stringify(list.find(m => m.id === 'shove')?.observe?.() ?? null)),
        world: () => JSON.parse(JSON.stringify(ctx.world.voxel.stats())),
        project: (x, y, z) => screenOf({ x, y, z }),
      } : {}),
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
    const orbit = { a: 0, v: new THREE.Vector3(), at: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
    session.loop(t => {
      const raw = last === null ? 0 : Math.max(0, (t - last) / 1000);
      const dt = Math.min(0.1, raw); last = t;
      // the frame-rate guard: sampled while playing in view; it lowers the ratio, never under one CSS pixel
      if (governor) {
        const floor = Math.min(1, Math.min(globalThis.devicePixelRatio || 1, 1) / res.target);
        if (governor.frame(raw, { active: session.round.phase === 'playing' && !document.hidden && !menu.view, floor })) {
          applyRatio(); renderer.setSize(innerWidth, innerHeight, false); look.resize?.(innerWidth, innerHeight);
        }
      }
      // alone, the pause menu stops the game where it is (with friends the round keeps going: CONTRACT §3)
      if (menu.paused && !session.live && ['playing', 'countdown'].includes(session.round.phase)) {
        input.enabled = false; input.update();
        hud.update(0, { phase: session.round.phase, covered: true });
        ui.update(0, { left: session.round.phase === 'playing' ? ctx.time.left : null, players: ctx.players.list(), plates: [] });
        if (look.render) look.render(camera); else renderer.render(scene, camera);
        return;
      }
      ctx.time.now += dt; ctx.time.dt = dt;
      const phase = session.round.phase;
      input.enabled = phase === 'playing' && !ui.covered && !backdrop && !session.watching;
      // a viewer (gf-multiplayer 1.6.x): no HUD and no menu of its own, only names and bars over the stream's players
      if (ui.root.classList.contains('gf-watching') !== session.watching) {
        ui.root.classList.toggle('gf-watching', session.watching);
        canvas.style.pointerEvents = session.watching ? 'none' : '';      // a viewer's click takes nothing (no pointer lock with nothing to look at)
      }
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
      if (firstWorld) { const on = session.round.phase === 'playing' && !input.aimFree && !menu?.view; if (on !== ui.crosshairOn) ui.crosshair(on); }
      try { ctx.fair.update(dt); } catch (e) { console.error(e); }      // who is down or protected, before any hit this frame
      for (const m of list) { try { m.update?.(dt); } catch (e) { console.error(e); } }
      try { rules.update?.(ctx, dt); } catch (e) { console.error(e); }
      for (const fn of ctx.onFrame) fn(dt);
      session.send();
      ctx.world.update?.(dt);
      // a viewer's camera goes where the streamer is before anything reads it (nameplates, the look's light and shadow):
      // the hidden player's own rig set it this frame already
      if (session.watching) { watchCam.was = true; watchCamera(dt); }
      const followed = session.watching && watchCam.target ? ctx.players.get(watchCam.target) : null;
      look.update?.(dt, followed?.position ?? me.position);
      // nameplates over everyone else
      const w = innerWidth, h = innerHeight, plates = [];
      for (const p of ctx.players.list()) {
        if (p.local || (p.id === watchCam.target && camMode === 'first')) continue;     // a viewer in first person sees from the streamer's eyes
        const shown = (p.owned || p.drawn) && p.character?.object3d.visible;
        plate.set(p.position.x, p.position.y + (p.character?.height ?? 1.7) + 0.3, p.position.z).project(camera);
        const vis = !!shown && plate.z > -1 && plate.z < 1 && Math.abs(plate.x) < 1.05 && Math.abs(plate.y) < 1.05;
        plates.push({ id: p.id, text: p.name, color: p.color, x: (plate.x * 0.5 + 0.5) * w, y: (-plate.y * 0.5 + 0.5) * h, visible: vis });
      }
      ui.update(dt, { left: phase === 'playing' ? ctx.time.left : null, players: ctx.players.list(), plates });
      hud.update(dt, { phase, covered: ui.covered });
      // the home menu: the camera circles the player's character, which stands right of the menu column; a world
      // drifts over the island instead (behind the kit's menu alone, behind the party page's world card with friends)
      if (session.watching) { /* the camera was set above */ }
      else {
        // a viewer who joined: their own body is theirs again (first person keeps it hidden), the streamer's too
        if (watchCam.was) { watchCam.was = false; watchCam.on = false; watchCam.target = null; if (camMode !== 'first' && me.character?.object3d) me.character.object3d.visible = true; if (watchCam.hidden?.character?.object3d) watchCam.hidden.character.object3d.visible = true; watchCam.hidden = null; }
        if (phase === 'lobby' && worldMode) worldCamera(dt);
        else if (phase === 'lobby' && menu.view && !session.live && (game.camera ?? 'third') !== 'first') homeCamera(dt);
      }
      if (look.render) look.render(camera); else renderer.render(scene, camera);
    });
    // Watch then play (gf-multiplayer 1.6.0): a viewer sees the stream as the streamer does, from their pose: their eyes
    // in first person, behind them along their aim in third, the game's fixed angle in follow or top. Its own player
    // stays hidden. Until the streamer is drawn, the world drifts (a world) or the camera circles the arena.
    const watchCam = { was: false, at: new THREE.Vector3(), pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), want: new THREE.Vector3(), wdir: new THREE.Vector3(), pivot: new THREE.Vector3(), back: new THREE.Vector3(), point: new THREE.Vector3(), cur: 0, on: false, target: null, hidden: null };
    function watchCamera(dt) {
      if (me.character?.object3d) me.character.object3d.visible = false;
      const f = session.watch?.follow;
      const id = f ? (worldMode ? f.cid ?? f.id : f.id) : null;
      const p = id ? ctx.players.get(id) : null;
      if (watchCam.hidden && watchCam.hidden !== p) { if (watchCam.hidden.character?.object3d && watchCam.hidden.drawn) watchCam.hidden.character.object3d.visible = true; watchCam.hidden = null; }
      if (!p || !p.drawn) { watchCam.target = null; watchCam.on = false; if (worldMode) worldCamera(dt); else { orbit.a += dt * 0.05; camera.position.set(Math.sin(orbit.a) * 18, 12, Math.cos(orbit.a) * 18); camera.lookAt(0, 0, 0); } return; }
      watchCam.target = p.id;
      const C = { ...(RIG_DEFAULTS[camMode] ?? RIG_DEFAULTS.third), ...(me.controller?.rig?.settings ?? {}) };
      const h = p.character?.height ?? 1.7, a = Array.isArray(p.aim) && p.aim.length === 3 ? p.aim : null;
      watchCam.wdir.set(a ? a[0] : Math.sin(p.yaw ?? 0), a ? a[1] : 0, a ? a[2] : Math.cos(p.yaw ?? 0));
      if (watchCam.wdir.lengthSq() < 1e-6) watchCam.wdir.set(Math.sin(p.yaw ?? 0), 0, Math.cos(p.yaw ?? 0));
      watchCam.wdir.normalize();
      // the pose's aim runs from the aim origin (kit/core/aim.js, below the eyes) to the point under the crosshair: look
      // from the eyes at that point, or a viewer near a wall looks at the sky (play-test 1: 0 against 48.8 degrees)
      const eyeY = p.position.y + (camMode === 'first' ? (C.height ?? 1.55) : (C.height ?? 1.6)) * (h / 1.7);
      let pointed = false;
      if (a && Number.isFinite(p.aimDist) && p.aimDist > 0.05) {
        watchCam.at.set(p.position.x + a[0] * p.aimDist, p.position.y + AIM_HEIGHT + a[1] * p.aimDist, p.position.z + a[2] * p.aimDist);
        watchCam.point.copy(watchCam.at); pointed = true;
        watchCam.at.sub(watchCam.want.set(p.position.x, eyeY, p.position.z));
        if (watchCam.at.lengthSq() > 1e-4) watchCam.wdir.copy(watchCam.at).normalize();
      }
      const k = watchCam.on ? 1 - Math.exp(-dt * 12) : 1;
      if (camMode === 'first') {
        if (p.character?.object3d) { p.character.object3d.visible = false; watchCam.hidden = p; }   // their eyes: their own body is not in view
        watchCam.want.set(p.position.x, eyeY, p.position.z);
        watchCam.pos.lerp(watchCam.want, k); watchCam.dir.lerp(watchCam.wdir, k).normalize();
        camera.position.copy(watchCam.pos);
        camera.lookAt(watchCam.pos.x + watchCam.dir.x, watchCam.pos.y + watchCam.dir.y, watchCam.pos.z + watchCam.dir.z);
      } else if (camMode === 'follow' || camMode === 'top') {
        const yaw = (C.yawDeg ?? 0) * Math.PI / 180, pitch = (C.pitchDeg ?? 50) * Math.PI / 180, d = C.distance ?? 20;
        watchCam.pivot.set(p.position.x, p.position.y + (C.height ?? 0.9), p.position.z);
        watchCam.want.set(watchCam.pivot.x + Math.sin(yaw) * Math.cos(pitch) * d, watchCam.pivot.y + Math.sin(pitch) * d, watchCam.pivot.z + Math.cos(yaw) * Math.cos(pitch) * d);
        watchCam.pos.lerp(watchCam.want, k);
        camera.position.copy(watchCam.pos); camera.lookAt(watchCam.pivot);
      } else if (camMode === 'third' && pointed) {
        // third: the streamer's own rig (kit/controller/camera-rig.js), found again from the point under their
        // crosshair. Their camera sits behind a pivot at head height, `shoulder` metres to their right, and looks
        // through it at that point: the head, the shoulder and the point give the view's yaw and pitch. (Until
        // 2026-10-10 the viewer looked from the head at the point, with no shoulder: about 10 degrees off across a
        // room, 44 with a desk in front of the streamer.)
        const D = C.distance ?? 5.2, lo = C.collisionMin ?? C.minDistance ?? 0.8;
        if (!watchCam.on || !(watchCam.cur > 0)) watchCam.cur = D;
        const s = (C.shoulder ?? 0) * Math.min(1, watchCam.cur / D), hy = p.position.y + (C.height ?? 1.7);
        const vx = watchCam.point.x - p.position.x, vz = watchCam.point.z - p.position.z;
        const L = Math.sqrt(Math.max(0.01, vx * vx + vz * vz - s * s));
        const wyaw = Math.atan2(vx, vz) + Math.atan2(s, L);
        const wpitch = Math.max((C.minPitchDeg ?? -30) * Math.PI / 180, Math.min((C.maxPitchDeg ?? 65) * Math.PI / 180, Math.atan2(hy - watchCam.point.y, L)));
        watchCam.wdir.set(Math.sin(wyaw) * Math.cos(wpitch), -Math.sin(wpitch), Math.cos(wyaw) * Math.cos(wpitch));
        watchCam.dir.lerp(watchCam.wdir, k).normalize();
        const flat = Math.hypot(watchCam.dir.x, watchCam.dir.z) || 1;
        watchCam.pivot.set(p.position.x - watchCam.dir.z / flat * s, hy, p.position.z + watchCam.dir.x / flat * s);
        watchCam.back.copy(watchCam.dir).negate();
        // a wall pulls the camera in at once and lets it out slowly, as the rig does (its ball stops 0.05 m short)
        let d = D;
        const hit = ctx.world?.raycast?.(watchCam.pivot, watchCam.back, D);
        if (hit && Number.isFinite(hit.distance)) d = Math.max(lo, hit.distance - (C.collisionRadius ?? 0.22) - 0.05);
        watchCam.cur = d < watchCam.cur ? d : watchCam.cur + (d - watchCam.cur) * (1 - Math.exp(-dt * 2.5));
        camera.position.copy(watchCam.pivot).addScaledVector(watchCam.back, watchCam.cur);
        if (camera.position.y < p.position.y + 0.3) camera.position.y = p.position.y + 0.3;
        camera.lookAt(watchCam.pivot);
      } else {
        // orbit, and third while the streamer has no crosshair point: behind them, along their aim, a little above; a
        // wall pulls the camera in
        watchCam.dir.lerp(watchCam.wdir, k).normalize();
        const pitch = Math.max(5, Math.min(45, (C.pitchDeg ?? 16) - Math.asin(Math.max(-1, Math.min(1, watchCam.dir.y))) * 180 / Math.PI * 0.6)) * Math.PI / 180;
        const flat = Math.hypot(watchCam.dir.x, watchCam.dir.z) || 1;
        watchCam.pivot.set(p.position.x, p.position.y + (C.height ?? 1.6) * (h / 1.7), p.position.z);
        watchCam.back.set(-watchCam.dir.x / flat * Math.cos(pitch), Math.sin(pitch), -watchCam.dir.z / flat * Math.cos(pitch)).normalize();
        let d = C.distance ?? 5;
        const hit = ctx.world?.raycast?.(watchCam.pivot, watchCam.back, d);
        if (hit && Number.isFinite(hit.distance)) d = Math.max(0.8, hit.distance - 0.3);
        camera.position.copy(watchCam.pivot).addScaledVector(watchCam.back, d);
        camera.lookAt(watchCam.pivot.x + watchCam.dir.x * 2, watchCam.pivot.y + watchCam.dir.y * 2, watchCam.pivot.z + watchCam.dir.z * 2);
      }
      watchCam.on = true;
      camera.updateMatrixWorld();         // nameplates are placed with it this frame (play-test 1: tags off the characters)
    }
    function worldCamera(dt) {
      orbit.a += dt * 0.05;
      const W = ctx.world, b = W.bounds, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const pz = W.zone?.('plaza')?.at, ty = pz ? pz.y : (W.voxel?.water ?? 0) + 3;
      const R = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.62;
      camera.position.set(cx + Math.sin(orbit.a) * R, ty + R * 0.42, cz + Math.cos(orbit.a) * R);
      camera.lookAt(pz ? pz.x : cx, ty + 2, pz ? pz.z : cz);
    }
    function homeCamera(dt) {
      orbit.a += dt * 0.16;
      const h = me.character?.height ?? 1.7;
      orbit.at.set(me.position.x, me.position.y + h * 0.62, me.position.z);
      const yaw = (me.yaw ?? 0) + Math.PI * 0.18 + Math.sin(orbit.a) * 0.55;
      orbit.dir.set(Math.sin(yaw), 0.32, Math.cos(yaw)).normalize();
      let r = 3.9 + h * 0.6;
      const hit = ctx.world?.raycast?.(orbit.at, orbit.dir, r);
      if (hit && Number.isFinite(hit.distance)) r = Math.max(1.6, hit.distance - 0.35);
      camera.position.copy(orbit.at).addScaledVector(orbit.dir, r);
      // look a little to the character's right, so it stands right of the menu column (centre on a narrow screen)
      orbit.right.crossVectors(orbit.dir, orbit.up).normalize();
      const side = innerWidth > 640 ? Math.min(1.5, r * 0.34) : 0;
      orbit.v.copy(orbit.at).addScaledVector(orbit.right, side);
      if (innerWidth <= 640) orbit.v.y += h * 0.32;
      camera.lookAt(orbit.v);
    }
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
    kit: 'gf-three', engine: ENGINE, version: VERSION, phase: 'show', subject,
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
