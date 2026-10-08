/*! games.fun multiplayer kit: net.js v1.2.1, the game's side of a LIVE round. MIT. research/multiplayer/party/kit/net.js
 *
 * Kit-owned and byte-identical in every game (never edit a copy). Standard: research/multiplayer/STANDARD.md
 *
 * A live round puts the players in one shared space. Each player's copy of the game:
 *   - sends its own player's pose and draws everyone else's (net.pose / net.peers): you SEE your friends;
 *   - if it is the HOST's copy, owns whatever is shared (enemies, pickups, waves, the clock) and sends it
 *     (net.world); every other copy shows the host's world instead of simulating its own (net.shared);
 *   - sends events to the host or to everyone (net.send / net.on): "I hit zombie 7", "you were hurt".
 * Outside the party page (played alone, in Studio, in QA) net.active is false and every call does nothing, so one
 * code path serves both.
 *
 *   import { net } from './gf/mp/net.js';              // an ES module; the path is relative to the importing file
 *
 *   if (net.active) {                                   // set at load; never changes
 *     net.onStart(() => startPlaying());                // everyone's round starts at the same moment
 *     net.ready();                                      // call once the game has loaded and can start
 *   }
 *   // every frame:
 *   net.pose({ x, y, z, yaw, anim: 'run', hp });        // small flat object; the kit sends at most 15 a second
 *   for (const p of net.peers()) drawFriend(p.id, p.name, p.color, p.state);   // interpolated; p.state is null until known
 *   if (net.host) net.world({ wave, zombies: [{ id, x, z, yaw, hp, s }] });    // at most 12 a second, under 3.5 KB
 *   else { const w = net.shared(); if (w) showWorld(w.state); }                // interpolated between the last two
 *   net.send('hit', { id: 7, dmg: 40 }, 'host');        // 'host' | 'all' (everyone else, the default) | a player id
 *   net.on('hit', (data, from) => { ... });
 *   net.finish({ won: true, value: 183.4 });            // the round's result (team rounds: only the host's counts)
 *   net.onEnd(() => stopEverything());                  // the round is over for everyone (a result, the host's End round, the time cap)
 *
 * Limits (the room on the host's machine enforces them): one message is at most 4096 bytes of JSON, and a player may
 * send 60 messages a second (pose 15 + world 12 leaves room for events; a burst of 120 is tolerated). Over the limit
 * the host's own messages are dropped silently and another player is disconnected, so never send an event per frame.
 * net.shared().state blends every number between two snapshots: read a number that must not be blended (a wave
 * index, a count, a state code) from net.shared().latest, or send it as a string.
 *
 * Rules for a game in a live round: never pause the shared world (not on blur, not on a key: show a menu over a
 * world that keeps running); draw every other player as a character with their name; take the seed from net.seed.
 * Run the frame function with net.loop(frame) instead of requestAnimationFrame: the host's tab has to stay open, and
 * net.loop keeps its simulation stepping when the tab is in the background.
 */
const noop = () => {};
const now = () => performance.now();
const ANGLE = /(^|[^a-z])(yaw|pitch|roll|angle|rot|rotation|heading|facing|dir)$/i;
const POSE_MS = 1000 / 15, WORLD_MS = 1000 / 12, DELAY_MS = 130, STALE_MS = 4000;

/** Blend two states for display. Numbers lerp (angles the short way), lists of {id} match by id, the rest steps at the half. */
export function blend(a, b, t, key = '') {
  if (a === undefined || a === null) return b;
  if (typeof a === 'number' && typeof b === 'number') {
    if (ANGLE.test(key)) { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * t; }
    return a + (b - a) * t;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (b.length && b[0] && typeof b[0] === 'object' && 'id' in b[0]) {
      const old = new Map(a.filter(x => x && typeof x === 'object').map(x => [x.id, x]));
      return b.map(x => blend(old.get(x.id), x, t, key));       // an entity the older state does not have appears as it is
    }
    return a.length === b.length ? b.map((x, i) => blend(a[i], x, t, key)) : b;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(b)) {
    const out = {};
    for (const k of Object.keys(b)) out[k] = blend(a[k], b[k], t, k);
    return out;
  }
  return t < 0.5 ? a : b;
}

// Two timestamped samples around (now - DELAY_MS) → the blended state. One sample: that sample.
function sample(buf) {
  if (!buf.length) return null;
  const at = now() - DELAY_MS;
  let i = buf.length - 1;
  while (i > 0 && buf[i].t > at) i--;
  const a = buf[i], b = buf[i + 1];
  if (!b) return a.s;
  const span = b.t - a.t;
  return span <= 0 ? b.s : blend(a.s, b.s, Math.max(0, Math.min(1, (at - a.t) / span)));
}
const push = (buf, s) => { buf.push({ t: now(), s }); if (buf.length > 6) buf.shift(); };

function create() {
  const handlers = {}, peers = new Map(), world = [], starts = [], ends = [], playerFns = [];
  let lastPose = 0, lastWorld = 0, pendingPose = null, pendingWorld = null, started = false, over = false, timer = null;
  const H = {
    onNet(t, from, d) {
      if (t === 'p') { let p = peers.get(from); if (!p) peers.set(from, p = { buf: [], seen: 0 }); push(p.buf, d); p.seen = now(); }
      else if (t === 'w') push(world, d);
      else if (t.charCodeAt(0) === 101 && t[1] === ':') { for (const fn of handlers[t.slice(2)] ?? []) { try { fn(d, from); } catch (e) { console.error(e); } } }
    },
    onPlayers(list) { for (const id of [...peers.keys()]) if (!list.some(p => p.id === id)) peers.delete(id); for (const fn of playerFns) { try { fn(list); } catch (e) { console.error(e); } } },
    onStart() { if (started) return; started = true; for (const fn of starts) { try { fn(); } catch (e) { console.error(e); } } },
    onEnd() { if (over) return; over = true; for (const fn of ends) { try { fn(); } catch (e) { console.error(e); } } },
  };
  let S = null;
  try { if (window.parent !== window && window.parent.__gfParty) S = window.parent.__gfParty.attach(window, H); } catch { S = null; }   // a parent on another origin: not the party page
  const active = !!S;

  // Whatever is due goes out on the call itself (the game calls pose and world every frame, and net.loop keeps frames
  // coming in a background tab, where a page timer fires only once a second). The timer is only there to send the last
  // value set inside the rate window if the game then stops calling.
  function flush() {
    const t = now();
    if (pendingPose && t - lastPose >= POSE_MS) { S.send('p', pendingPose); pendingPose = null; lastPose = t; }
    if (pendingWorld && t - lastWorld >= WORLD_MS) { S.send('w', pendingWorld); pendingWorld = null; lastWorld = t; }
    if ((pendingPose || pendingWorld) && !timer) timer = setTimeout(() => { timer = null; flush(); }, 30);
  }

  return {
    active,
    get you() { return active ? S.info().you : null; },
    get host() { return active ? !!S.info().you.host : false; },
    get players() { return active ? S.info().players : []; },
    get seed() { return active ? S.info().seed : null; },
    get round() { return active ? S.info().round : 0; },
    get started() { return started; },
    get over() { return over; },

    ready() { if (active) S.ready(); },
    onStart(fn) { if (typeof fn !== 'function') return; starts.push(fn); if (started) fn(); },
    onPlayers(fn) { if (typeof fn === 'function') { playerFns.push(fn); if (active) fn(S.info().players); } },
    onEnd(fn) { if (typeof fn !== 'function') return; ends.push(fn); if (over) fn(); },

    pose(state) { if (!active || !state || typeof state !== 'object') return; pendingPose = state; flush(); },
    /** Everyone else: [{id, name, color, host, connected, state, age}]. state is interpolated; null until a pose arrives. */
    peers() {
      if (!active) return [];
      const t = now(), you = S.info().you.id;
      return S.info().players.filter(p => p.id !== you).map(p => {
        const q = peers.get(p.id), age = q ? t - q.seen : Infinity;
        return { ...p, state: q && age < STALE_MS ? sample(q.buf) : null, age };
      });
    },

    world(state) { if (!active || !S.info().you.host || !state || typeof state !== 'object') return; pendingWorld = state; flush(); },
    /** A copy that is not the host's: {state (interpolated), latest, age in ms}, or null before the first one arrives. */
    shared() { return world.length ? { state: sample(world), latest: world[world.length - 1].s, age: now() - world[world.length - 1].t } : null; },

    send(type, data, to = 'all') { if (active && typeof type === 'string') S.send('e:' + type, data, to); },
    on(type, fn) { if (typeof fn === 'function') (handlers[type] ??= []).push(fn); },

    progress(share, value) { if (active) S.progress(typeof share === 'number' ? share : null, typeof value === 'number' ? value : null); },
    finish(result) { if (active && result && typeof result.value === 'number') S.finish(result.value, result.won === true ? true : result.won === false ? false : null); },

    /**
     * Run the game's frame function: net.loop(frame) INSTEAD of the game's own requestAnimationFrame chain (frame must
     * not schedule itself). Alone, this is exactly requestAnimationFrame. In a live round it also keeps the game
     * stepping when the browser stops animation frames (a hidden, covered or background tab; page timers there slow
     * to one a second), which would freeze the shared world for everyone if this copy is the host: a Web Worker's
     * timer is not slowed, and it calls frame about 30 times a second whenever frames have stalled.
     * The time handed to frame never goes backwards (an animation frame's own stamp can be older than the timer call
     * before it); a game should still clamp its step at zero.
     * Returns a function that stops the loop.
     */
    loop(frame) {
      if (typeof frame !== 'function') return noop;
      let lastRaf = now(), lastT = 0, raf = 0, stopped = false, w = null;
      const run = t => { lastT = t = Math.max(t, lastT); try { frame(t); } catch (e) { console.error(e); } };
      const tick = t => { if (stopped) return; lastRaf = now(); run(t); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      if (active) {
        // Animation frames have stalled when none has come for 100 ms. From then on every worker tick (30 ms, inside
        // the 50 ms step most games cap at) is a frame, so the world runs at full speed, until frames come back.
        try {
          w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 30)'], { type: 'text/javascript' })));
          w.onmessage = () => { if (!stopped && now() - lastRaf > 100) run(now()); };
        } catch { w = null; }
      }
      return () => { stopped = true; cancelAnimationFrame(raf); if (w) w.terminate(); };
    },
    blend,
  };
}

export const net = create();
export default net;
