// gf-three net: a live round over gf/mp/net.js (gf-multiplayer 1.2.3), and the same code alone with bots.
//
// What each copy owns:
//   every copy   its local player (movement, aim, actions; sends its pose 15 a second through net.pose)
//   the host     the round (phase, clock, end, winners), scores, `alive`, the bots, and ctx.shared: all in one
//                net.world message (12 a second, under 3.5 KB), which every other copy shows instead of simulating
// Events (ctx.net.send/on) are edges, never per frame; they travel as one kit message type 'g' {n, d}.
// Loadouts (CONTRACT §6e, kit/net/looks.js): the pose carries the player's loadout key (`lk`); the loadout itself goes
// as kit messages 'lo' (the loadout) and 'lq' (asking for one), on a change and when a copy lacks it.
// The genex traps (PLAN §2.6): the frame never pauses (net.loop, also in a background tab); hit-pause or any card
// never stops the net pump; reactions to remote things fire on edges (changes in the world), not per frame.
//
// Round flow: lobby → countdown → playing → results → (replay). Alone the kit draws the lobby and the countdown;
// in a live round the party page does (it counts everyone in and starts them together through net.onStart), and
// Play again loads a fresh page, so the in-game replay is for playing alone.
import { net } from '../../mp/net.js';
import { createShared } from './shared.js';
import { createPlayers } from './players.js';
import { createLooks } from './looks.js';
import { spawnOf } from '../core/util.js';

const r2 = v => Math.round(v * 100) / 100;

export function createSession(ctx, { rules, spawnCharacter, characterFor, rng, botCount, onPhase = () => {} }) {
  const live = net.active;
  const cfg = ctx.config;
  const R = cfg.round ?? {};
  const listeners = new Map();
  const round = { phase: 'lobby', number: 1, clock: 0, total: 0, countdown: 0, winners: null, reason: null, rows: null, finishedAt: 0, endedByNet: false };
  let hostTime = 0, lastWorldPhase = null, finishTimer = null;

  ctx.host = !live || net.host;
  const localId = live ? net.you.id : 'p1';
  const shared = createShared({ isHost: () => ctx.host });
  ctx.shared = shared;

  // ---- events ----
  function dispatch(name, data, from) {
    const i = name.indexOf(':');
    if (i > 0) { const m = ctx.mechanics?.get(name.slice(0, i)); if (m?.event) { try { m.event(name.slice(i + 1), data, from); } catch (e) { console.error(e); } return; } }
    for (const fn of listeners.get(name) ?? []) { try { fn(data, from); } catch (e) { console.error(e); } }
    try { rules.event?.(ctx, name, data, from); } catch (e) { console.error(e); }
  }
  ctx.net = {
    active: live,
    get you() { return live ? net.you.id : localId; },
    /** Send a gameplay event: to 'all' (everyone else), 'host', or a player id. Alone it goes nowhere: the local copy is the host. */
    send(name, data = {}, to = 'all') { if (live && typeof name === 'string') net.send('g', { n: name, d: data }, to); },
    on(name, fn) { if (typeof fn === 'function') (listeners.get(name) ?? listeners.set(name, []).get(name)).push(fn); },
    blend: net.blend,
  };
  net.on('g', (m, from) => { if (m && typeof m.n === 'string') dispatch(m.n, m.d, from); });
  // the kit's own routed calls: a knock or teleport for a player this copy owns
  net.on('k', m => {
    const p = ctx.players.get(m?.id); if (!p?.owned || !p.controller) return;
    if (m.t === 'knock') p.controller.knock({ x: m.i[0], y: m.i[1], z: m.i[2] }, m.s, { budget: ctx.fair?.on && !m.o ? ctx.fair.split : null });
    else if (m.t === 'push') p.controller.push({ x: m.i[0], y: m.i[1], z: m.i[2] });
    else if (m.t === 'teleport') p.controller.teleport({ x: m.p[0], y: m.p[1], z: m.p[2] }, m.y);
  });
  const ownerOf = p => (p.isBot ? 'host' : p.id);
  const players = createPlayers(ctx, { spawnCharacter, characterFor, routeToOwner: (p, t, d) => { if (live) net.send('k', { t, id: p.id, ...d }, ownerOf(p)); } });
  ctx.players = players;
  // player looks (CONTRACT §6e): this player's loadout from the page, everyone's over the net (kit/net/looks.js)
  const looks = createLooks(ctx, { live, net, localId });
  ctx.looks = looks;

  // ---- who plays ----
  // seat colours: character.tint.<role> (config/characters.json → palette), else the look's player palette
  const palette = ctx.assets.config('characters').palette ?? ctx.assets.config('look').palette?.players ?? ['#4f7cff', '#ff5ea8', '#3ddc84', '#ffd166'];
  const botNames = cfg.players?.botNames ?? ['Pip', 'Bo', 'Moss', 'Juno', 'Rex', 'Ivy', 'Tam'];
  const colorOf = seat => palette[seat % palette.length];
  const max = Math.max(1, cfg.players?.max ?? 4);
  async function syncHumans(list) {
    for (const h of list) {
      if (!players.get(h.id)) await players.add({ id: h.id, name: h.name, seat: h.seat, color: colorOf(h.seat), local: h.id === localId, owned: h.id === localId });
      const p = players.get(h.id); if (p) { p.connected = h.connected !== false; p.name = h.name ?? p.name; }
    }
    for (const p of players.humans()) if (!list.some(h => h.id === p.id)) players.remove(p.id);
  }
  async function syncBots() {
    if (!ctx.host) return;
    const humans = players.humans().length;
    const want = Math.max(0, Math.min(botCount, max - humans));
    const have = players.bots();
    for (let i = have.length; i < want; i++) {
      const seat = humans + i, id = `b${i + 1}`;
      const p = await players.add({ id, name: botNames[i % botNames.length], seat, color: colorOf(seat), isBot: true, owned: true });
      p.bot = ctx.makeBot?.(p) ?? null;
    }
    for (const p of have.slice(want)) players.remove(p.id);
  }

  async function start() {
    if (live) await syncHumans(net.players.length ? net.players : [{ id: localId, name: net.you?.name, seat: net.you?.seat ?? 0 }]);
    else await players.add({ id: localId, name: cfg.text?.you ?? 'You', seat: 0, color: colorOf(0), local: true, owned: true });
    await syncBots();
    ctx.me = players.get(localId);
  }
  /** After rules.setup: the round can start (a late or reloaded copy gets net.onStart at once, so not before). */
  function arm() {
    if (!live) return;
    looks.start();
    net.onPlayers(list => { syncHumans(list).then(syncBots).catch(e => console.error(e)); });
    net.onStart(() => { if (round.phase === 'lobby') beginPlaying(); });
    net.onEnd(() => { round.endedByNet = true; if (round.phase !== 'results') enterResults(null, 'ended'); });
  }

  // ---- the round ----
  function setPhase(ph) { if (round.phase === ph) return; round.phase = ph; onPhase(ph); }
  function resetPlayers() {
    for (const p of players.list()) {
      p.score = 0; p.alive = true; for (const k of Object.keys(p.data)) delete p.data[k];   // the same object every round
      if (p.owned && p.controller) { const s = spawnOf(ctx.world, p.seat); p.controller.teleport(s, s.yaw); }
    }
  }
  function beginCountdown() {
    if (live) return beginPlaying();
    round.countdown = Math.max(0, R.countdown ?? 3);
    setPhase(round.countdown > 0 ? 'countdown' : 'playing');
    if (round.countdown <= 0) beginPlaying();
  }
  function beginPlaying() {
    round.clock = 0; round.winners = null; round.reason = null; round.rows = null;
    setPhase('playing');
    try { rules.roundStart?.(ctx); } catch (e) { console.error(e); }
  }
  function topScorers() {
    const list = players.list(); if (!list.length) return [];
    const best = Math.max(...list.map(p => p.score));
    return best > 0 || list.length === 1 ? list.filter(p => p.score === best).map(p => p.id) : [];
  }
  function enterResults(winners, reason) {
    if (round.phase === 'results') return;
    round.winners = winners ?? topScorers(); round.reason = reason ?? 'time';
    setPhase('results');
    try { round.rows = rules.results?.(ctx) ?? players.list().map(p => ({ id: p.id, name: p.name, value: p.score })); } catch (e) { console.error(e); round.rows = []; }
    // The result goes in the world first; the party's finish a moment later, so a friend sees the reason before "round over".
    if (live && !net.over) {
      clearTimeout(finishTimer);
      finishTimer = setTimeout(() => { const me = ctx.me; net.finish({ won: round.winners.length ? round.winners.includes(me.id) : null, value: me.score }); }, 450);
    }
  }
  /** Host: end the round now ({winners, reason} as check() returns, or a reason string). */
  function end(reason = 'ended', winners = null) { if (ctx.host && round.phase === 'playing') enterResults(winners, reason); }
  /** Alone: play again in the same page. */
  function replay() {
    if (live || round.phase !== 'results') return false;
    round.number++;
    shared.reset();
    for (const m of ctx.mechanicsList ?? []) { try { m.reset?.(); } catch (e) { console.error(e); } }
    resetPlayers();
    beginCountdown();
    return true;
  }

  let checkAcc = 0;
  /** Every frame, before the physics steps: the round clock and, on other copies, the host's world. */
  function tick(dt) {
    hostTime += dt;
    if (ctx.host) {
      if (round.phase === 'countdown') { round.countdown -= dt; if (round.countdown <= 0) beginPlaying(); }
      else if (round.phase === 'playing') {
        round.clock += dt;
        if ((R.seconds ?? 120) - round.clock <= 0) enterResults(null, 'time');
        else if ((checkAcc += dt) >= 0.1) {
          checkAcc = 0;
          let r = null; try { r = rules.check?.(ctx) ?? null; } catch (e) { console.error(e); }
          if (r) enterResults(Array.isArray(r.winners) ? r.winners : null, r.reason ?? 'won');
        }
      }
    } else {
      const w = net.shared();
      if (w) {
        const k = w.latest.k ?? {}, ks = w.state.k ?? {};
        shared.receive(w.latest.s ?? null, w.state.s ?? null);
        for (const p of players.list()) { if (k.sc && p.id in k.sc) p.score = k.sc[p.id]; if (k.al && p.id in k.al) p.alive = !!k.al[p.id]; }
        round.clock = (k.t ?? 0) + (k.ph === 'playing' ? Math.min(w.age, 500) / 1000 : 0);
        round.number = k.n ?? round.number;
        hostTime = Math.max(hostTime, k.T ?? 0);
        syncRemoteBots(ks.b ?? [], dt);
        if (k.ph !== lastWorldPhase) {
          lastWorldPhase = k.ph;
          if (k.ph === 'playing' && round.phase !== 'playing' && round.phase !== 'results') beginPlaying();
          if (k.ph === 'results' && round.phase !== 'results') enterResults(k.w ?? null, k.why ?? 'time');
        }
      }
    }
    // friends: from their poses
    if (live) {
      const seen = new Set();
      for (const peer of net.peers()) {
        seen.add(peer.id);
        const p = players.get(peer.id); if (!p || p.owned) continue;
        p.connected = peer.connected !== false;
        players.place(p, peer.state, dt);
      }
    }
    // looks: ask for a friend's loadout their pose says this copy lacks; put on whatever arrived or changed
    looks.tick(dt);
    players.updateLooks();
  }
  const remoteBotSeen = new Set();
  function syncRemoteBots(list, dt) {
    remoteBotSeen.clear();
    for (const b of list) {
      if (!b || typeof b.id !== 'string') continue;
      remoteBotSeen.add(b.id);
      let p = players.get(b.id);
      if (!p) { if (!pendingBots.has(b.id)) { pendingBots.add(b.id); players.add({ id: b.id, name: b.n, seat: b.s, color: colorOf(b.s ?? 0), isBot: true, owned: false }).finally(() => pendingBots.delete(b.id)); } continue; }
      players.place(p, { x: b.x, y: b.y, z: b.z, yaw: b.yaw, anim: b.a, aim: b.aim, ...(Number.isFinite(b.ad) ? { ad: b.ad } : {}), ...(b.e ? { extra: b.e } : {}) }, dt);
    }
    for (const p of players.bots()) if (!p.owned && !remoteBotSeen.has(p.id) && !pendingBots.has(p.id)) players.remove(p.id);
  }
  const pendingBots = new Set();

  /** Every frame, after everything moved: send this copy's pose and, on the host, the world. */
  function send() {
    if (!live) return;
    const me = ctx.me;
    if (me?.controller) { const pose = me.controller.pose(); if (looks.key) pose.lk = looks.key; net.pose(pose); }   // lk: this player's loadout key (§6e)
    if (ctx.host) {
      const sc = {}, al = {};
      for (const p of players.list()) { sc[p.id] = p.score; al[p.id] = p.alive ? 1 : 0; }
      const b = players.bots().filter(p => p.controller).map(p => { const q = p.controller.pose(); return { id: p.id, n: p.name, s: p.seat, x: q.x, y: q.y, z: q.z, yaw: q.yaw, a: q.anim, ...(q.aim ? { aim: q.aim } : {}), ...(Number.isFinite(q.ad) ? { ad: q.ad } : {}), ...(q.extra ? { e: q.extra } : {}) }; });
      net.world({ k: { ph: round.phase, n: round.number, t: r2(round.clock), T: r2(hostTime), sc, al, b, w: round.winners, why: round.reason }, s: shared.outgoing() });
    }
  }

  function ready() { if (live) net.ready(); }

  /** The block the multiplayer gate reads (research/multiplayer/party/gate-live.mjs). */
  function gateBlock(covered) {
    if (!live) return null;
    const me = ctx.me;
    const peers = players.humans().filter(p => !p.local).map(p => ({ id: p.id, name: p.name, x: p.drawn ? r2(p.position.x) : null, y: p.drawn ? r2(p.position.y) : null, z: p.drawn ? r2(p.position.z) : null, onScreen: players.visible(p, covered) }));
    return {
      you: net.you.id, host: net.host, started: net.started,
      me: me ? { x: r2(me.position.x), y: r2(me.position.y), z: r2(me.position.z) } : null,
      peers, over: net.over, clock: r2(hostTime), shared: digest(),
    };
  }
  /** A short string equal on every copy when the shared world agrees: the phase, the round and the scores. */
  function digest() {
    const sc = players.list().map(p => `${p.id}:${p.score}`).join(',');
    let extra = ''; try { extra = rules.digest?.(ctx) ?? ''; } catch { extra = '?'; }
    return `${round.phase}|${round.number}|${sc}${extra ? `|${extra}` : ''}`;
  }

  return { live, round, start, arm, ready, tick, send, beginCountdown, end, replay, gateBlock, digest, get hostTime() { return hostTime; }, loop: fn => net.loop(fn), get over() { return net.over; } };
}
