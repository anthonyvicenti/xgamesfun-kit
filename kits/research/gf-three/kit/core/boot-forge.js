// gf-three core: boot({rules}) for the forge engine (CONTRACT §8 forge; research/rust-engine/PLAN.md §3).
//
//   import { boot } from './gf/three/core/boot-forge.js'; import rules from './rules.js'; boot({ rules });   (main.js)
//
// The same system as boot.js, with the Rust core in place of three.js's look, world, characters and Rapier: the
// configs and assets.json (kit/assets/core.js, no three.js), the quality tier and the screen's pixels, the forge host
// (gf/forge/host.js: the wasm, its input, its state, its drawing), the forge look and world (gf/forge/look.js,
// world.js), audio, the input, the UI, the HUD and the home menu, the round and the net (kit/net/session.js with
// gf/forge/players.js), fair play, rules.setup(ctx), then the frame loop through net.loop. boot.js links three.js and
// Rapier statically, so a forge game (which vendors neither) starts here instead; everything below the renderer is the
// shared kit's.
//
// No WebGPU adapter (PLAN §3.4): the kit's own "open in your browser" screen, never a blank canvas.
// Wave 1a: the data tables (config/game.json → forge, gf/forge/tables) load into the core before the world; the core's
// events are routed by the host each frame (sounds to gf-audio by name, rule events to rules.event(ctx, name, data,
// 'forge')); the input's buttons go out as the core's BTN bits (fire, alt, interact, jump; Shift evades, R reloads,
// V melee, 1-4 and the wheel pick a weapon). No mechanics module runs on forge (their params stay in config for the
// rules) and no bots (tracks F and A fill these).
// Live co-op (track S; CONTRACT §8 forge "Live co-op"; forge-core net.rs): the host's core owns the world and replays
// each joiner's inputs (gf/forge/players.js spawns them); its snapshot rides in the round's own net.world message,
// taken only when that message is due so none of its events is lost; a joiner sends its inputs to the host about 20
// times a second ('fi'), predicts its own player, applies each new snapshot (replicas, reconciliation) and draws the
// others as their bodies (gf/forge/wear.js) with nameplates.
// Track F: gf/forge/feel.js draws the feel's DOM side (numbers, combo, red edge, low-health stages, crosshair,
// ammunition, the death recap) and verify reads it through window.__game.forge.feel().
// The wave 1b integration (research/gf-forge/INTEGRATION.md): one boot loads all four tracks' kit modules. ctx.render
// (gf/forge/render.js, track R) is made with the host, so the world's AI (gf/forge/ai.js, track A) and the players
// (gf/forge/players.js, track S) give their bodies to the renderer that skins them; gf/forge/fight.js registers the
// first-person arms and weapons, a kill's pieces, the coin and the effect pictures; the look is packed for the
// quality tier.
import * as gf from '../../gf-assets.js';
import { createAudio } from '../../../audio/audio.js';
import audioPresets from '../../../audio/presets.json' with { type: 'json' };
import KIT from '../kit.js';
import { assets } from '../assets/core.js';
import { createRng, seedOf } from './rng.js';
import { pickQuality, deviceFacts } from './quality.js';
import { pixelRatioFor, watchPixelRatio, createGovernor, PIXEL_BUDGET } from './resolution.js';
import { createInput } from './input.js';
import { createUI } from '../ui/ui.js';
import { createHud } from '../ui/hud.js';
import { createMenu, loadSettings } from '../ui/menu.js';
import { startLoading } from '../ui/loading.js';
import { listenForHost, host as pageHost } from '../net/host.js';
import { createSession } from '../net/session.js';
import { listenForLoadout, pageLoadout } from '../net/looks.js';
import { createFair } from './fair.js';
import * as refusals from './refusals.js';
import { net } from '../../mp/net.js';
import { createHost, BTN, KIND, ENTITY_FLAG, BUILD_SHA256, VERSION as FORGE_VERSION } from '../../forge/host.js';
import * as forgeTables from '../../forge/tables/index.js';
import * as forgeLook from '../../forge/look.js';
import * as forgeWorld from '../../forge/world.js';
import { createForgePlayers, project } from '../../forge/players.js';
import { runForgeShow } from '../../forge/show.js';
import { createFeel } from '../../forge/feel.js';
import { createRender } from '../../forge/render.js';
import { loadFight } from '../../forge/fight.js';
import { createCards } from '../../forge/cards.js';

export const VERSION = KIT.version;
export const ENGINE = 'forge';

export async function boot({ rules = {} } = {}) {
  startLoading({ theme: 'grim' });   // track U: the kit's loading view (ui/loading.js), up until window.__game exists
  listenForHost(window);
  listenForLoadout(window);
  const params = new URLSearchParams(location.search);
  const subject = params.get('gf-show');
  const backdrop = params.get('gf-backdrop') === '1' && !net.active;
  const ctx = { kit: { name: 'gf-three', engine: ENGINE, version: VERSION, forge: FORGE_VERSION }, onFrame: [], time: { now: 0, dt: 0, round: 0, left: 0 }, gf };
  let ui = null;
  try {
    await assets.init({ configs: ['game', 'look', 'world', 'characters'] });
    const game = assets.config('game'), lookCfg = assets.config('look'), worldCfg = assets.config('world');
    ctx.config = game; ctx.assets = assets;
    ctx.fair = createFair(ctx);
    document.title = game.text?.title ?? game.title ?? document.title;
    await gf.applyCss();
    const worldMode = game.round?.mode === 'world';
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
    // the pixels drawn (CONTRACT §6i): set before the engine starts, so its first frame is the screen's own size
    const budget = quality.pixelBudget ?? PIXEL_BUDGET[quality.name] ?? PIXEL_BUDGET.high;
    const governor = params.get('gf-res') === 'fixed' ? null : createGovernor();
    const res = { target: 1, ratio: 1, budget };
    let forge = null;
    const size = () => {
      const dpr = globalThis.devicePixelRatio || 1;
      res.target = pixelRatioFor({ dpr, width: innerWidth, height: innerHeight, budget });
      res.ratio = Math.max(Math.min(dpr, 1), res.target * (governor?.scale ?? 1));
      const max = forge?.maxDimension?.() ?? 8192;
      canvas.width = Math.max(1, Math.min(max, Math.round(innerWidth * res.ratio)));
      canvas.height = Math.max(1, Math.min(max, Math.round(innerHeight * res.ratio)));
      forge?.resize(canvas.width, canvas.height);
    };
    size();

    // ---- the engine: the Rust core on WebGPU, or the kit's own screen when the browser has none ----
    try { forge = await createHost(canvas); }
    catch (e) { if (e?.name === 'NoWebGPU') return unsupported(ctx, game, e); throw e; }
    ctx.forge = forge;
    // the renderer from JS (track R): bodies, held items, the first-person layer, effects
    ctx.render = createRender(forge);
    const resize = () => { governor?.reset(); size(); };
    addEventListener('resize', resize); watchPixelRatio(globalThis, resize); size();
    ctx.resolution = res;
    // the slot table: every slot an index the core draws with; coverage and sight read the indices back
    const slotIds = assets.ids(), slotIdx = new Map(slotIds.map((id, i) => [id, i]));
    ctx.slotIds = slotIds; ctx.slotIndex = id => slotIdx.get(id) ?? 0xffffffff;
    // the data tables (spec.forge, filled by create; every value a slot, so Studio's overrides are in `game` already)
    const tables = forgeTables.fill(game.forge ?? {});
    ctx.tables = tables;
    forge.loadTables(forgeTables.pack(tables));
    const camCfg = game.controller?.camera?.first ?? {};
    // packed for the quality tier (look.js TIERS: a low tier's shadow map, lights a frame, AA and particle budget)
    const applyLook = () => { forge.setLook(forgeLook.pack(lookCfg, quality.name)); forge.lens(Number(tables.player?.fov) || Number(camCfg.fov) || 68, 0.05, 200); };
    applyLook();
    const torch = forgeLook.torch(lookCfg);
    const lightsAt = t => (ctx.world?.lights ?? []).map(l => ({ x: l.at[0], y: l.at[1], z: l.at[2], range: torch.range, color: torch.color, intensity: torch.intensity * forgeLook.flicker(t, l.seed ?? 1, torch.flicker) }));

    if (subject) {
      if (pageLoadout().loadout != null) assets.setLoadout('show', pageLoadout().loadout);
      return await runForgeShow(ctx, subject, { worldCfg, lightsAt, observe: { coverage: () => coverageReport(), slots: () => slotsReport() } });
    }
    // the rules, for the world's AI (gf/forge/ai.js calls rules.bot and rules.reward; track A)
    ctx.rules = rules;
    ctx.world = await forgeWorld.loadWorld(ctx, worldCfg);
    // what a fight draws beside bodies and the world (gf/forge/fight.js): the first-person arms and weapons by row, a
    // kill's pieces, the coin, weapon pickups, target dummies, the effect pictures
    ctx.fight = await loadFight(ctx);
    const C = game.controller ?? {}, cam = C.camera?.first ?? {};

    // ---- audio, input, UI ----
    const audio = createAudio(await gf.sounds(), { presets: audioPresets.presets, storageKey: backdrop ? undefined : `gf3-${gameId}`, listen: !backdrop, fileUrl: gf.url });
    if (backdrop) audio.muted = true;
    ctx.audio = {
      raw: audio,
      /** play(soundId, {at: {x, y, z}, gainDb, pitch, optional}): at → quieter with distance from the eyes. */
      play(id, opts = {}) {
        const o = { ...opts };
        if (o.at) { const e = forge.eye(); const d = Math.hypot(o.at.x - e.x, (o.at.y ?? e.y) - e.y, o.at.z - e.z); o.gainDb = (o.gainDb ?? 0) - Math.min(18, Math.max(0, (d - 4) * 0.6)); delete o.at; }
        if (!audio.has(id)) { if (!o.optional) refusals.refuse('sound-unlisted', `ctx.audio.play("${id}"): no sound with that id in assets.json → sounds → sounds (list it there, or pass { optional: true })`, id); return null; }
        return audio.play(id, o);
      },
      has: id => audio.has(id), stop: id => audio.stop(id),
    };
    const input = createInput(canvas);
    ctx.input = input;
    ui = createUI(ctx, { text: game.text ?? {}, controls: game.controls ?? {}, theme: 'grim' });   // track U: the forge theme (ui/theme.js)
    ctx.ui = ui;
    if (worldMode) { ui.timer(false); ui.score([]); }
    let menu = null;
    const openPause = () => { if (!menu || menu.view || !['playing', 'countdown'].includes(ctx.round?.phase)) return; menu.pause(); try { document.exitPointerLock?.(); } catch {} };
    const hud = createHud(ctx, ui, { onMenu: () => openPause() });
    // the feel's DOM side (track F: damage numbers, combo, the red edge, low-health stages, crosshair, ammunition, the death recap)
    ctx.feel = createFeel(ctx);
    ctx.hud = hud; ui.goalTo = t => { if (refusals.goalCall(t)) hud.goal(t); };
    hud.setGoal(refusals.startGoal(game));

    // ---- mechanics: none runs on forge yet (track F/A); their params stay for the rules ----
    const list = [];
    ctx.mechanics = { get: id => list.find(m => m.id === id) ?? null, list: () => list.slice() };
    for (const spec of game.mechanics ?? []) list.push({ id: spec.id, as: spec.as, params: { ...(spec.params ?? {}) }, standin: true });
    ctx.mechanicsList = list;
    ctx.aimed = false;

    // ---- players and the round: the shared session over the core's players, bots among them (forge-ai) ----
    const T = game.text ?? {};
    const players = { api: null };
    // live co-op: the host's snapshot goes out with the round's world message at its rate (12 a second at most), and
    // only then is it taken; a joiner's page load is an epoch (the host restarts its input queue on a reload)
    const WORLD_MS = 1000 / 12 + 0.5;
    let lastSnap = -1e9;
    const engineWorld = () => { const t = performance.now(); if (t - lastSnap < WORLD_MS) return null; lastSnap = t; return { f: forge.snapshotB64() }; };
    const epoch = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? ((Math.random() * 2 ** 32) >>> 0);
    // bots fill seats when playing alone, as boot.js does (?bots=N, else players.max − 1 unless players.bots is false);
    // forge bots are core players driven by forge-ai (gf/forge/ai.js sets ctx.makeBot; track A). A friends round has
    // no bots (the session's rule)
    const botParam = params.get('bots'), maxPlayers = Math.max(1, game.players?.max ?? 4);
    const botCount = backdrop ? 0 : botParam !== null ? Math.max(0, Math.min(7, Number(botParam) || 0)) : game.players?.bots === false ? 0 : maxPlayers - 1;
    const session = createSession(ctx, { rules, spawnCharacter: null, characterFor: () => ({}), rng, botCount, onPhase: ph => onPhase(ph),
      createPlayers: c => (players.api = createForgePlayers(c, { host: forge, live: net.active, epoch })), engineWorld: net.active ? engineWorld : null });
    // QA only (the live gate: multiplayer.json check.query, which create writes for a forge game): with ?gf-gate=1 the
    // rules end no round, so the gate's later steps find it running; the clock and the host's End round still end it
    const gateRound = params.get('gf-gate') === '1';
    ctx.round = {
      get phase() { return session.round.phase; }, get number() { return session.round.number; },
      get winners() { return session.round.winners; }, get reason() { return session.round.reason; },
      end: (reason = 'ended', winners = null) => (gateRound ? undefined : session.end(reason, winners)),
    };
    await session.start();
    const me = ctx.me;
    me.actions = input.actions;
    ctx.fight?.sleeve?.();
    // the run (wave 2, track G; gf/forge/cards.js): the reward between waves with its inspector, over the core's cards
    ctx.cards = createCards(ctx);
    // the host replays each joiner's inputs (forge-core net.rs); a joiner's batches come as 'fi' (base64), to the host only
    if (net.active && ctx.host) net.on('fi', (b, from) => { const n = players.api.nid(from); if (n && typeof b === 'string') forge.net.pushInputs(n, b); });
    let lastLatest = null, lastInputs = -1e9;
    // the core's recent events for the observation (hits, kills, spawns, rule events): what F, A and R make, as verify sees it
    const eventLog = [];
    forge.on('*', e => { if (['sound', 'motion', 'camera', 'light', 'particles', 'ui'].includes(e.kind)) return; eventLog.push({ t: Math.round(ctx.time.now * 1000) / 1000, ...e }); if (eventLog.length > 256) eventLog.splice(0, eventLog.length - 256); });
    forge.tick(0); players.api.fromCore();
    ui.crosshair(false);
    ctx.fair.setup();
    try { await rules.setup?.(ctx); } catch (e) { console.error(e); throw e; }

    function onPhase(ph) {
      for (const p of ctx.players.owned()) if (p.controller) p.controller.enabled = ph === 'playing';
      if (ph === 'countdown') { menu?.close(); ctx.audio.play('round-countdown', { optional: true }); }
      if (ph === 'playing' && worldMode) { ui.hideCard(); if (menu?.view && !menu.paused) menu.close(); if (T.welcome) ui.banner(T.welcome, 2); canvas.focus(); return; }
      if (ph === 'playing') { ui.cover('results', false); ui.hideCard(); if (menu?.view && !menu.paused) menu.close(); ui.banner(T.go ?? 'Go!', 1.2); ctx.audio.play('round-go', { optional: true }); canvas.focus(); }
      if (ph === 'lobby') { ui.hideCard(); if (!session.live) menu?.home(); else if (worldMode) menu?.close(); try { document.exitPointerLock?.(); } catch {} }
      if (ph === 'results') {
        menu?.close();
        const w = session.round.winners ?? [];
        if (session.live) { ui.cover('results', true); ctx.audio.play(w.includes(ctx.me?.id) ? 'round-win' : 'round-end', { optional: true }); try { document.exitPointerLock?.(); } catch {} return; }
        const names = w.map(id => ctx.players.get(id)?.name ?? id);
        const title = names.length ? (T.wins ?? '{name} wins!').replace('{name}', names.join(' & ')) : session.round.reason === 'lost' ? (T.lost ?? 'Defeated') : (T.draw ?? 'Round over');
        ui.results({ title, rows: session.round.rows ?? [], winners: w,
          onAgain: session.live || game.round?.replay === false ? null : () => { ctx.audio.play('ui-click', { optional: true }); session.replay(); },
          onMenu: session.live ? null : () => { ctx.audio.play('ui-click', { optional: true }); session.toLobby(); } });
        ctx.audio.play(w.includes(ctx.me?.id) ? 'round-win' : 'round-end', { optional: true });
        try { document.exitPointerLock?.(); } catch {}
      }
    }
    const friendsPage = () => new URL('gf/mp/index.html', location.href).href;
    menu = createMenu(ctx, ui, {
      game, live: session.live, world: worldMode, gameId, host: pageHost, players: () => ctx.players.list(),
      onPlay: () => { if (session.round.phase === 'lobby') { ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); } },
      onFriends: () => { if (pageHost.present && pageHost.offers.friends) pageHost.friends(); else location.href = friendsPage(); },
      onResume: () => { menu.close(); canvas.focus(); },
      onLeave: () => { menu.close(); session.toLobby(); },
      onQuality: () => { if (!session.live) location.reload(); },
      room: session.live ? { info: () => net.room, leave: () => { menu.close(); net.leave(); }, end: worldMode ? null : () => { menu.close(); session.end('ended'); canvas.focus(); } } : null,
    });
    ctx.menu = menu;
    if (params.get('gf-ui') === '0' || backdrop) ui.root.style.display = 'none';
    if (backdrop) { input.enabled = false; canvas.tabIndex = -1; }
    if (session.live && worldMode) { session.arm(); session.ready(); }
    else if (session.live) { ui.waiting(); session.arm(); session.ready(); }
    else if (params.get('gf-autoplay') === '1') session.beginCountdown();
    else menu.home();
    addEventListener('keydown', e => {
      if (backdrop) return;
      const a = document.activeElement, onControl = a && (a.tagName === 'BUTTON' || a.tagName === 'INPUT');
      if ((e.code === 'Enter' || e.code === 'Space') && !onControl && session.round.phase === 'lobby' && menu.view === 'home') { e.preventDefault(); menu.close(); ctx.audio.play('ui-click', { optional: true }); session.beginCountdown(); }
      if (e.code === 'Escape' && !e.defaultPrevented && !menu.view && ['playing', 'countdown'].includes(session.round.phase)) { e.preventDefault(); openPause(); }
    });

    // ---- the observation (CONTRACT §5, §8 forge): the same names verify reads, from what the core drew ----
    const r2 = v => Math.round(v * 100) / 100;
    const forgeState = () => ({ version: FORGE_VERSION, wasm: BUILD_SHA256, frames: forge.frames(), draws: forge.draws(), ticks: Number(forge.forge.ticks()),
      hz: forge.hz, steps: Number(forge.forge.steps()), droppedSeconds: Math.round(forge.forge.dropped_seconds() * 1000) / 1000, plugins: forge.plugins(), tables: forge.forge.tables_version(),
      recoveries: forge.recoveries(), lost: forge.lost(), timing: forge.timing, info: forge.info(), render: ctx.render.stats(), fight: ctx.fight?.observe?.() ?? null });
    const observe = () => ({
      kit: 'gf-three', engine: ENGINE, version: VERSION, phase: session.round.phase, round: session.round.number, seed, quality: quality.name,
      time: { now: r2(ctx.time.now), round: r2(ctx.time.round), left: r2(ctx.time.left) },
      me: me.id, host: ctx.host, live: session.live, backdrop, view: menu.view ?? ui.view, paused: menu.paused && !session.live,
      players: ctx.players.list().map(p => ({ id: p.id, name: p.name, score: p.score, alive: p.alive, bot: p.isBot, local: p.local, x: r2(p.position.x), y: r2(p.position.y), z: r2(p.position.z), anim: p.anim, color: p.color, ring: null, ...ctx.fair.observe(p) })),
      fair: ctx.fair.summary(),
      refusals: refusals.list(),
      winners: session.round.winners, reason: session.round.reason, results: session.round.rows,
      shared: ctx.shared.snapshot(),
      rules: (() => { try { return rules.observe?.(ctx) ?? null; } catch { return null; } })(),
      modules: { standins: { look: false, world: false, character: !forge.drawsBodies() }, mechanics: list.map(m => ({ id: m.id, standin: true })) },
      net: session.gateBlock(ui.covered),
      world: null,
      forge: { ...forgeState(), net: forge.net.stats(), bodies: players.api.bodies() },
    });
    const cameraOf = () => ({ mode: 'first', yaw: me.yaw ?? null, pitch: me.pitch ?? null, cursorMode: !!input.cursorMode, cursor: input.cursorMode || null, aimFree: !!input.aimFree,
      eye: (({ x, y, z }) => [x, y, z].map(v => Math.round(v * 1000) / 1000))(forge.drawnCamera()), sensitivity: cam.sensitivity ?? 0.0024, lookScale: input.lookScale ?? 1, invertY: !!input.invertY,
      crosshair: !!ui.crosshairOn, lockRefused: !!input.lockRefused, locked: !!input.locked, fullscreen: hud.fullscreen?.() ?? null });
    window.__game = Object.freeze({
      kit: 'gf-three', engine: ENGINE, version: VERSION, seed, quality: quality.name,
      get phase() { return session.round.phase; },
      get ready() { return true; },
      get players() { return observe().players; },
      snapshot: () => JSON.parse(JSON.stringify(observe())),
      coverage: () => coverageReport(),
      slots: () => slotsReport(),
      controls: () => JSON.parse(JSON.stringify({
        camera: 'first', crosshair: !!ui.crosshairOn, aimed: false, controls: game.controls ?? {}, prompt: ui.promptText, viewport: { w: innerWidth, h: innerHeight },
        aim: { dir: (me.aim ?? []).map(r2), dist: null, point: null, hit: null, onSelf: false, screen: null }, landing: null, interactables: [], mechanics: [],
        me: { x: r2(me.position.x), y: r2(me.position.y), z: r2(me.position.z), alive: me.alive !== false, holding: 0 },
      })),
      menu: () => JSON.parse(JSON.stringify(menu.observe())),
      hud: () => JSON.parse(JSON.stringify({ phase: session.round.phase, covered: ui.covered, ...hud.observe() })),
      looks: () => JSON.parse(JSON.stringify({ me: me.id, local: ctx.looks?.observe?.() ?? null, slots: assets.playerLooks(),
        players: ctx.players.list().map(p => { const r = assets.loadout(p.id); return { id: p.id, name: p.name, bot: p.isBot, local: p.local, seat: p.seat, color: p.color, key: r?.key ?? '', advertised: r?.advertised ?? '', values: r?.loadout.values ?? {}, files: r?.loadout.files ?? {}, dropped: [...(r?.dropped ?? [])], drawn: players.api.drawnLook(p), shots: null }; }) })),
      camera: () => JSON.parse(JSON.stringify(cameraOf())),
      sight: ids => sightReport(ids),
      screen: () => ({ dpr: globalThis.devicePixelRatio || 1, css: [innerWidth, innerHeight], buffer: [canvas.width, canvas.height], ratio: res.ratio, target: res.target, budget: res.budget, quality: quality.name, slow: governor?.last ?? null, guard: !!governor }),
      // the observation interface v2 (CONTRACT §8 forge): what the core holds, under names tracks R, F and A fill
      bodies: () => JSON.parse(JSON.stringify(bodiesReport())),
      enemies: () => JSON.parse(JSON.stringify(enemiesReport())),
      hits: (since = 0) => JSON.parse(JSON.stringify(eventLog.filter(e => (e.kind === 'hit' || e.kind === 'kill') && e.t >= since))),
      wave: () => JSON.parse(JSON.stringify(waveReport())),
      forge: Object.freeze({ state: () => forgeState(), loseDevice: () => forge.loseDevice(), net: () => forge.net.stats(), events: (since = 0) => JSON.parse(JSON.stringify(eventLog.filter(e => e.t >= since))),
        entities: () => forge.entities(), players: () => forge.players(), project: (x, y, z) => project(forge.drawnCamera(), { x, y, z }, innerWidth / innerHeight),
        // track F: the feel's DOM side as shown, the core's stats and the death recap
        feel: () => JSON.parse(JSON.stringify({ shown: ctx.feel?.observe() ?? null, stats: ctx.feel?.stats() ?? null, recap: ctx.feel?.recap() ?? null })),
        // track R, as the wave 1b integration drives it: what the last frame drew (render.js STATS: actors, rigid
        // models, particles, flashes, the first-person layer and its muzzle flash), how one body was drawn (its hit
        // flash, eye glow and tint), and the first-person weapon's sockets
        drawn: () => JSON.parse(JSON.stringify(ctx.render.stats())),
        actor: net => JSON.parse(JSON.stringify(ctx.render.look(net))),
        fp: () => JSON.parse(JSON.stringify(ctx.render.fp.sockets())),
        // track G (wave 2): the run's facts (the reward, everyone's cards, who is down, the revive under way), the
        // reward screen as shown, down and revive as shown, a table value as this player's cards leave it, and how
        // many entities of each kind the core holds (resting debris among them)
        run: () => JSON.parse(JSON.stringify(ctx.cards?.facts() ?? null)),
        cards: () => JSON.parse(JSON.stringify(ctx.cards?.observe() ?? null)),
        down: () => JSON.parse(JSON.stringify(players.api.down?.() ?? null)),
        value: (path, player) => ctx.cards?.value(path, player) ?? null,
        counts: () => forge.entityCounts(),
        // QA only (like loseDevice): turn this copy's own player to look at a point, as a player would with the mouse
        face: (x, y, z) => { const e = forge.eye(), dx = x - e.x, dy = y - e.y, dz = z - e.z; forge.cmd.look(players.api.nid(me.id), Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); } }),
    });
    /** Every body the core animates: who, its slot, its colour, what it holds, drawn by whom (R's skinned renderer or the stand-in). */
    function bodiesReport() {
      const out = [];
      for (const e of forge.entities()) {
        if (!(e.flags & ENTITY_FLAG.ANIMATED)) continue;
        const w = forge.wearOf(e.net), p = e.kind === KIND.PLAYER ? players.api.byNid(e.net) : null;
        const sc = project(forge.drawnCamera(), { x: e.x, y: e.y + 1.0, z: e.z }, innerWidth / innerHeight);
        out.push({ net: e.net, kind: e.kind === KIND.PLAYER ? 'player' : e.kind === KIND.ENEMY ? 'enemy' : String(e.kind), player: p?.id ?? null, slot: w && w.body >= 0 ? ctx.slotIds[w.body] ?? null : null,
          color: w?.color ?? null, held: w && w.held < 255 ? (ctx.tables?.weapons?.[w.held]?.id ?? w.held) : null, hidden: !!w?.hidden, bones: e.boneCount, at: [r2(e.x), r2(e.y), r2(e.z)],
          onScreen: p ? players.api.visible(p, ui.covered) : !!sc && Math.abs(sc.x) < 1 && Math.abs(sc.y) < 1, renderer: forge.drawsBodies() ? 'skinned' : p ? 'standin' : 'none' });
      }
      return out;
    }
    /** Every enemy the core holds (forge-ai's on the host, replicas on a joiner). */
    function enemiesReport() {
      return forge.entities().filter(e => e.kind === KIND.ENEMY).map(e => ({ net: e.net, type: e.type, typeId: ctx.tables?.enemies?.[e.type]?.id ?? null, at: [r2(e.x), r2(e.y), r2(e.z)], hp: r2(e.hp), dead: !!(e.flags & ENTITY_FLAG.DEAD), replica: !!(e.flags & ENTITY_FLAG.REPLICA), speed: r2(e.speed) }));
    }
    /** The wave (forge-ai's director): its own forge-web `ai_wave()` (JSON) when it has one, else the last RULE "wave" (a: number, b: left, c: state). */
    function waveReport() {
      if (typeof forge.forge.ai_wave === 'function') { try { return JSON.parse(forge.forge.ai_wave()); } catch { return null; } }
      const w = [...eventLog].reverse().find(e => e.kind === 'rule' && e.name === 'wave');
      return w ? { number: w.a, left: w.b, state: w.c, t: w.t, from: 'rule' } : null;
    }

    // ---- the frame ----
    const forgeButtons = buttonMapper();
    let last = null, recovering = false;
    session.loop(t => {
      const raw = last === null ? 0 : Math.max(0, (t - last) / 1000);
      const dt = Math.min(0.1, raw); last = t;
      // device loss (a driver reset, a long background tab): a new device gets everything again; no frame meanwhile
      if (forge.lost()) {
        if (!recovering) { recovering = true; forge.recover().then(() => { size(); applyLook(); }).catch(e => console.error(`gf-forge: the device could not be recovered: ${e?.message ?? e}`)).finally(() => { recovering = false; }); }
        return;
      }
      if (governor) {
        const floor = Math.min(1, Math.min(globalThis.devicePixelRatio || 1, 1) / res.target);
        if (governor.frame(raw, { active: session.round.phase === 'playing' && !document.hidden && !menu.view, floor })) size();
      }
      if (menu.paused && !session.live && ['playing', 'countdown'].includes(session.round.phase)) {
        input.enabled = false; input.update();
        hud.update(0, { phase: session.round.phase, covered: true });
        ui.update(0, { left: session.round.phase === 'playing' ? ctx.time.left : null, players: ctx.players.list(), plates: [] });
        forge.setLights(lightsAt(ctx.time.now)); forge.render(ctx.time.now);
        return;
      }
      ctx.time.now += dt; ctx.time.dt = dt;
      const phase = session.round.phase;
      input.enabled = phase === 'playing' && !ui.covered && !backdrop;
      input.update();
      if (phase === 'countdown') ui.countdown(Math.max(1, Math.ceil(session.round.countdown)));
      session.tick(dt);
      // a joiner: each new world from the host carries the core's snapshot (replicas move toward it; its own player is
      // reconciled), applied before this frame's steps
      if (net.active && !ctx.host) {
        const w = net.shared();
        if (w?.latest && w.latest !== lastLatest) { lastLatest = w.latest; if (typeof w.latest.f === 'string') { try { forge.applyB64(w.latest.f); } catch (e) { console.warn(`gf-forge: a snapshot could not be applied (${e?.message ?? e})`); } } }
      }
      const R = game.round ?? {};
      ctx.time.round = session.round.clock; ctx.time.left = Math.max(0, (R.seconds ?? 120) - session.round.clock);
      // the local player's input → the core (looking in radians; the menu's sensitivity is the input's lookScale)
      const n = players.api.nid(me.id), k = cam.sensitivity ?? 0.0024;
      const { held, pressed } = forgeButtons(input), tb = ctx.feel?.touch?.() ?? { held: 0, pressed: 0 };   // track U: the touch buttons' bits (gf/forge/hud.js)
      forge.cmd.input(n, { mx: input.move.x, mz: input.move.y, dx: input.look.dx * k, dy: input.look.dy * k, held: held | tb.held, pressed: pressed | tb.pressed, enabled: !!me.controller?.enabled && input.enabled });
      forge.tick(dt);
      players.api.fromCore();
      // a joiner: this frame's steps of its own player's input, to the host about 20 times a second
      if (net.active && !ctx.host && t - lastInputs >= 50) { lastInputs = t; const b = forge.net.takeInputs(); if (b) net.send('fi', b, 'host'); }
      // the core's events: sounds by name (declared in assets.json from the tables), rule events to rules.event, the
      // rest to whoever listens (ctx.forge.on)
      forge.route(ctx, rules, { local: n });
      try { ctx.feel?.update(dt); } catch (e) { console.error(e); }
      try { ctx.cards?.update(dt); } catch (e) { console.error(e); }
      try { ctx.fair.update(dt); } catch (e) { console.error(e); }
      try { rules.update?.(ctx, dt); } catch (e) { console.error(e); }
      for (const fn of ctx.onFrame) fn(dt);
      session.send();
      ui.update(dt, { left: phase === 'playing' ? ctx.time.left : null, players: ctx.players.list(), plates: players.api.plates(ui.covered) });
      hud.update(dt, { phase, covered: ui.covered });
      forge.setLights(lightsAt(ctx.time.now));
      forge.render(ctx.time.now);
    });
    return ctx;
  } catch (e) {
    console.error(e);
    fatal(e);
    throw e;
  }

  // ---- what the core drew, under the observation's names ----
  function coverageReport() {
    const rep = ctx.forge.report().filter(r => r.visible), untagged = [], unknown = new Set();
    let tagged = 0;
    for (const r of rep) {
      if (r.slot < 0) { if (untagged.length < 50) untagged.push({ name: `instance ${r.i}`, path: `forge/instances/${r.i}`, type: 'forge-instance' }); continue; }
      const id = ctx.slotIds[r.slot];
      if (!id || !ctx.assets.has(id)) unknown.add(String(id ?? r.slot));
      tagged++;
    }
    return { meshes: rep.length, tagged, exempt: 0, untagged, unknownSlots: [...unknown], objects: rep.map(r => ({ slot: ctx.slotIds[r.slot] ?? null, area: Math.round(r.area), onScreen: r.onScreen })) };
  }
  function slotsReport() {
    const out = {};
    for (const r of ctx.forge.report()) {
      if (!r.visible || r.slot < 0) continue;
      const o = (out[ctx.slotIds[r.slot]] ??= { drawables: 0, triangles: 0, onScreen: false, area: 0 });
      o.drawables++; o.triangles += r.triangles; o.onScreen ||= r.onScreen; o.area += Math.round(r.area);
    }
    // a texture slot is drawn where the models it paints are (the world's stone over its walls, floor and pillars)
    const tx = ctx.world?.texture;
    if (tx?.slot && tx.id >= 0) for (const id of tx.on) {
      const m = out[id]; if (!m) continue;
      const o = (out[tx.slot] ??= { drawables: 0, triangles: 0, onScreen: false, area: 0, texture: true });
      o.drawables += m.drawables; o.triangles += m.triangles; o.onScreen ||= m.onScreen; o.area += m.area;
    }
    return out;
  }
  /** verify check 15 (CONTRACT §5): the share of the player's view the slots fill, from the core's slot-ID pass. */
  async function sightReport(ids) {
    const want = new Set(ids), idx = ids.map(id => ctx.slotIndex(id)).filter(i => i !== 0xffffffff);
    const mine = ctx.forge.report().filter(r => r.visible && want.has(ctx.slotIds[r.slot]));
    const w = 192, h = 108;
    if (!idx.length || !mine.length) return { share: 0, pixels: 0, open: 0, drawables: 0, rect: null, center: null, size: null, distance: null, w, h };
    const s = await ctx.forge.sight(idx);
    const hit = new Set(idx.map(i => i + 1));
    let n = 0, open = 0, x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const k = y * s.w + x;
      if (hit.has(s.only[k])) open++;
      if (!hit.has(s.all[k])) continue;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const lo = [0, 1, 2].map(a => Math.min(...mine.map(r => r.min[a]))), hi = [0, 1, 2].map(a => Math.max(...mine.map(r => r.max[a])));
    const center = { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 }, size = { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] };
    const e = ctx.forge.drawnCamera(), all = s.w * s.h, rr = v => Math.round(v * 100) / 100;
    return { share: n / all, pixels: n, open: open / all, drawables: mine.length, rect: n ? [rr(x0 / s.w), rr(y0 / s.h), rr((x1 + 1) / s.w), rr((y1 + 1) / s.h)] : null, center, size, distance: rr(Math.hypot(center.x - e.x, center.y - e.y, center.z - e.z)), w: s.w, h: s.h };
  }
}

/**
 * The shared input → the core's buttons (gf/forge/host.js BTN; forge-core cmd::BTN_*): held this frame, and pressed
 * (went down) this frame. primary fires, secondary is the alternate fire, interact, jump; Shift evades (its press), R
 * reloads, V is a quick melee, 1-4 pick a weapon slot, the wheel the next or previous weapon.
 */
function buttonMapper() {
  let prevSprint = false;
  return input => {
    const a = input.actions, kd = c => !!input.keyDown?.(c), kp = c => !!input.keyPressed?.(c);
    let held = 0, pressed = 0;
    const on = (bit, down, press) => { if (down) held |= bit; if (press) pressed |= bit; };
    on(BTN.JUMP, a.jump.down, a.jump.pressed);
    on(BTN.FIRE, a.primary.down, a.primary.pressed);
    on(BTN.ALT, a.secondary.down, a.secondary.pressed);
    on(BTN.INTERACT, a.interact.down, a.interact.pressed);
    on(BTN.EVADE, !!input.sprint, !!input.sprint && !prevSprint);
    prevSprint = !!input.sprint;
    on(BTN.RELOAD, kd('KeyR'), kp('KeyR'));
    on(BTN.MELEE, kd('KeyV'), kp('KeyV'));
    for (let s = 1; s <= 4; s++) on(BTN.SLOT1 << (s - 1), kd(`Digit${s}`), kp(`Digit${s}`));
    if (input.wheel > 0) pressed |= BTN.PREV;
    if (input.wheel < 0) pressed |= BTN.NEXT;
    return { held, pressed };
  };
}

/** No WebGPU (CONTRACT §8 forge, PLAN §3.4): the kit's own screen, saying where the game plays, never a blank canvas. */
function unsupported(ctx, game, e) {
  const title = game.text?.title ?? game.title ?? 'This game';
  const d = document.createElement('div');
  d.id = 'gf-forge-unsupported';
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0b0e18;color:#fff;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;z-index:20;text-align:center';
  const link = location.href;
  d.innerHTML = `<div style="max-width:440px"><h1 style="margin:0 0 10px;font-size:28px;font-weight:850"></h1><p style="margin:0 0 14px;opacity:.9">This game draws with WebGPU, which this browser does not offer here. Open it in Chrome or Edge on a computer, Chrome on Android, or Safari 26 or newer.</p><p style="margin:0 0 16px"><a id="gf-forge-open" style="color:#ffb27a;word-break:break-all"></a></p><button id="gf-forge-copy" style="font:700 16px system-ui;padding:12px 18px;border-radius:12px;border:0;background:#ff7a59;color:#fff;cursor:pointer">Copy the link</button></div>`;
  d.querySelector('h1').textContent = title;
  const a = d.querySelector('#gf-forge-open'); a.href = link; a.textContent = link; a.target = '_blank'; a.rel = 'noopener';
  d.querySelector('#gf-forge-copy').onclick = () => navigator.clipboard?.writeText(link).catch(() => {});
  document.body.append(d);
  const why = String(e?.message ?? e).slice(0, 300);
  console.warn(`gf-forge: ${why}`);
  window.__game = Object.freeze({
    kit: 'gf-three', engine: ENGINE, version: VERSION, phase: 'unsupported', ready: true,
    unsupported: { reason: why, shown: true, link },
    snapshot: () => ({ kit: 'gf-three', engine: ENGINE, version: VERSION, phase: 'unsupported', unsupported: { reason: why, link }, players: [] }),
    screen: () => { const c = document.getElementById('gf-canvas'); return { dpr: globalThis.devicePixelRatio || 1, css: [innerWidth, innerHeight], buffer: [c?.width ?? 0, c?.height ?? 0], unsupported: true }; },
  });
  return ctx;
}

function fatal(e) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;padding:12px 16px;background:#3a1020;color:#fff;font:14px system-ui;border-radius:10px;z-index:9';
  d.textContent = `The game could not start: ${e?.message ?? e}`;
  document.body.append(d);
}
