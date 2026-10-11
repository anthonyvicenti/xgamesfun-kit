// games.fun watch relay: the channel rules as pure logic (MIT). No I/O of its own: the host (node.mjs, or the
// Cloudflare Durable Object in cloudflare/channel.mjs) injects sockets, the clock, one wake-up timer and storage, so both
// behave the same. Contract: research/watch/PLAN.md §3.2. The relay reads only a frame's `k` and its size; it forwards
// the streamer's text as it came and never looks inside key frames or deltas.
//
// A connection (`conn`) is the host's wrapper of one WebSocket, stable for that socket:
//   { state: {role: 'pub' | 'viewer', authed?, t0?, gone?}, send(text), close(code, reason), buffered?(), persist?() }
// `state` is plain JSON (the Durable Object keeps it in the socket's attachment and persist() writes it back).
// io: { sockets(role) → conns, schedule(atMs | null) } (one wake-up; the host calls channel.tick() when it fires).
// storage: { load() → record | null, save(record | null) } (synchronous).

export const WATCH_PATH = '/watch/v1/';
export const ID_RE = /^[a-z0-9]{12}$/;
export const LIMITS = {
  helloMs: 5000, graceMs: 10000, expiryMs: 30 * 86400e3, maxViewers: 200, maxPerIp: 8, slowBytes: 1 << 20, countMs: 1000,
  rate: 40, burst: 80, maxFrame: 65536, cacheFrames: 120, cacheBytes: 512 * 1024,
  sizes: { hello: 4096, key: 65536, d: 16384, meta: 2048, bye: 1024 },
};
// Close codes (PLAN §3.2). 4000 (bad, binary or late hello) and 1009 (frame too big) are ours: the plan names no code for them.
export const CLOSE = { readOnly: 1008, tooBig: 1009, hello: 4000, key: 4003, rate: 4008, replaced: 4009, slow: 4010, full: 4029 };

const te = new TextEncoder();
const byteLength = s => te.encode(s).length;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- HTTP helpers shared by the Node server and the Worker -------------------------------------------------------
export function parseOrigins(s) {
  const list = (Array.isArray(s) ? s : String(s ?? '').split(',')).map(x => String(x).trim()).filter(Boolean);
  return list.length ? list : null;                      // null = allow all (local use)
}
export const originOk = (origin, list) => !origin || !list || list.includes(origin);
/** pathname → null (not ours) | {health: true} | {id} | {bad: true}. `base` is the mount path with a trailing slash. */
export function route(pathname, base = WATCH_PATH) {
  if (!pathname.startsWith(base)) return null;
  const rest = pathname.slice(base.length);
  if (rest === 'health') return { health: true };
  return ID_RE.test(rest) ? { id: rest } : { bad: true };
}
export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
/** The HTTP answer for a routed request: {status, headers, body (object | null)}. `info()` gives the channel's presence. */
export function httpAnswer(method, r, info) {
  if (method === 'OPTIONS') return { status: 204, headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-max-age': '86400' }, body: null };
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, headers: { ...JSON_HEADERS, allow: 'GET, HEAD, OPTIONS' }, body: { error: 'GET only' } };
  if (r.bad) return { status: 400, headers: JSON_HEADERS, body: { error: 'bad id: 12 characters a-z0-9' } };
  return { status: 200, headers: JSON_HEADERS, body: r.health ? { ok: true } : info() };
}

// ---- the channel ---------------------------------------------------------------------------------------------------
export class Channel {
  constructor({ id, io, storage = null, now = Date.now, limits = {} }) {
    Object.assign(this, { id, io, store: storage, now });
    this.lim = { ...LIMITS, ...limits, sizes: { ...LIMITS.sizes, ...limits.sizes } };
    this.rec = { hash: null, meta: null, live: false, since: null, lastLive: null, graceUntil: null, ...(storage?.load() ?? {}) };
    this.cache = { key: null, d: [], bytes: 0, stale: true };      // lost on hibernation: viewers then wait for the next key frame
    this.count = { at: 0, dirty: false, last: -1 };
    this.buckets = new WeakMap(); this.chain = new WeakMap();
  }

  // -- views
  viewers() { return this.io.sockets('viewer').filter(c => !c.state.gone); }
  pubs() { return this.io.sockets('pub').filter(c => !c.state.gone); }
  activePub() { return this.pubs().find(c => c.state.authed) ?? null; }
  info() {
    this.reconcile();
    const r = this.rec;
    return { v: 1, id: this.id, live: r.live, viewers: this.viewers().length, meta: r.meta ?? null, since: r.live ? r.since : null };
  }
  /** True when nothing is left to remember (no key bound, not live): the host may drop the channel. */
  forgotten() { return !this.rec.hash && !this.rec.live; }

  // -- helpers
  save() { this.store?.save(this.rec); }
  put(conn, obj) { try { conn.send(JSON.stringify(obj)); } catch {} }
  fail(conn, code, closeCode) { this.put(conn, { k: 'error', code }); try { conn.close(closeCode, code); } catch {} conn.state.gone = true; }
  fanout(text) {
    let slow = false;
    for (const v of this.viewers()) {
      if ((v.buffered?.() ?? 0) > this.lim.slowBytes) { try { v.close(CLOSE.slow, 'slow'); } catch {} v.state.gone = true; slow = true; continue; }
      try { v.send(text); } catch {}
    }
    if (slow) this.markCount();
  }
  state(extra) { return { k: 'state', live: this.rec.live, meta: this.rec.meta ?? null, viewers: this.viewers().length, since: this.rec.live ? this.rec.since : null, ...extra }; }
  resetCache() { this.cache = { key: null, d: [], bytes: 0, stale: true }; }
  /** A live channel whose streamer socket is gone with no grace running (the object restarted): start the grace. */
  reconcile() {
    const r = this.rec;
    if (r.live && !r.graceUntil && !this.activePub()) { r.graceUntil = this.now() + this.lim.graceMs; this.save(); }
  }
  forget() { this.rec = { hash: null, meta: null, live: false, since: null, lastLive: null, graceUntil: null }; this.resetCache(); this.store?.save(null); }

  // -- connection lifecycle
  connect(conn) {
    const s = conn.state;
    if (s.role === 'pub') { s.t0 = this.now(); s.authed = false; conn.persist?.(); this.wake(); return; }
    this.expireIfOld();
    const others = this.viewers().filter(c => c !== conn).length;
    if (others >= this.lim.maxViewers) { this.put(conn, this.state({ full: true, viewers: others })); try { conn.close(CLOSE.full, 'full'); } catch {} s.gone = true; return; }
    // one network can't fill the audience (play-test 1, 2026-10-09: 199 scripted sockets read as "200 watching" and
    // turned real people away): at most maxPerIp viewers of a channel from one address
    if (s.ip && this.lim.maxPerIp > 0 && this.viewers().filter(c => c !== conn && c.state.ip === s.ip).length >= this.lim.maxPerIp) {
      this.put(conn, this.state({ full: true, viewers: others, why: 'network' })); try { conn.close(CLOSE.full, 'full'); } catch {} s.gone = true; return;
    }
    this.put(conn, this.state());
    const c = this.cache;
    if (this.rec.live && c.key && !c.stale) { conn.send(c.key); for (const d of c.d) conn.send(d); }
    this.markCount();
  }
  closed(conn) {
    const was = conn.state.gone; conn.state.gone = true;
    if (conn.state.role === 'viewer') { if (!was) this.markCount(); return; }
    this.chain.delete(conn);
    if (conn.state.authed && this.rec.live && !this.activePub()) { this.rec.graceUntil = this.now() + this.lim.graceMs; this.save(); this.wake(); }
  }

  // -- messages. `text` is the frame, or null for a binary one. Returns a promise only while a hello is being checked.
  message(conn, text) {
    const s = conn.state;
    if (s.gone) return;
    if (text === 'ping') { try { conn.send('pong'); } catch {} return; }
    if (s.role === 'viewer') { try { conn.close(CLOSE.readOnly, 'read-only'); } catch {} s.gone = true; this.markCount(); return; }
    const queued = this.chain.get(conn);
    if (queued) { const q = queued.then(() => this.pubFrame(conn, text)).catch(() => {}); this.chain.set(conn, q); return q; }
    const r = this.pubFrame(conn, text);
    if (r?.then) { const q = r.catch(() => {}).then(() => { if (this.chain.get(conn) === q) this.chain.delete(conn); }); this.chain.set(conn, q); return q; }
  }

  pubFrame(conn, text) {
    const s = conn.state, t = this.now();
    let b = this.buckets.get(conn); if (!b) this.buckets.set(conn, b = { n: this.lim.burst, at: t });
    b.n = Math.min(this.lim.burst, b.n + (t - b.at) * this.lim.rate / 1000); b.at = t;
    if (b.n < 1) return this.fail(conn, 'rate', CLOSE.rate);
    b.n -= 1;
    if (text === null) return this.fail(conn, 'text', CLOSE.hello);
    const size = byteLength(text);
    if (size > this.lim.maxFrame) return this.fail(conn, 'size', CLOSE.tooBig);
    let f = null; try { f = JSON.parse(text); } catch {}
    const k = isObj(f) ? f.k : null;
    if (!s.authed) return k === 'hello' && size <= this.lim.sizes.hello ? this.hello(conn, f) : this.fail(conn, 'hello', CLOSE.hello);
    const max = this.lim.sizes[k];
    if (max === undefined || k === 'hello') return;                                  // unknown k: ignored
    if (size > max) return this.fail(conn, 'size', CLOSE.tooBig);
    if (!this.rec.live) return;
    const c = this.cache;
    switch (k) {
      case 'key': this.cache = { key: text, d: [], bytes: 0, stale: false }; this.fanout(text); break;
      case 'd':
        if (!c.stale) {
          c.d.push(text); c.bytes += size;
          if (c.d.length > this.lim.cacheFrames || c.bytes > this.lim.cacheBytes) { c.d = []; c.bytes = 0; c.stale = true; }
        }
        this.fanout(text); break;
      case 'meta':
        if (!isObj(f.meta)) return;
        this.rec.meta = f.meta; this.rec.lastLive = t; this.save(); this.fanout(text); break;
      case 'bye': this.end('bye'); try { conn.close(1000, 'bye'); } catch {} break;
    }
  }

  async hello(conn, f) {
    if (f.v !== 1 || typeof f.key !== 'string' || f.key.length < 16 || f.key.length > 128) return this.fail(conn, 'hello', CLOSE.hello);
    const hash = await sha256hex(f.key);
    if (conn.state.gone) return;
    this.expireIfOld();
    const r = this.rec, t = this.now();
    if (r.hash && r.hash !== hash) return this.fail(conn, 'key', CLOSE.key);
    r.hash = hash;
    for (const o of this.pubs()) if (o !== conn && o.state.authed) {                  // the right key replaces the old streamer
      o.state.authed = false; o.persist?.(); this.put(o, { k: 'error', code: 'replaced' }); try { o.close(CLOSE.replaced, 'replaced'); } catch {}
    }
    conn.state.authed = true; conn.persist?.();
    const before = JSON.stringify(r.meta), wasLive = r.live;
    if (isObj(f.meta) && byteLength(JSON.stringify(f.meta)) <= this.lim.sizes.meta) r.meta = f.meta;
    r.graceUntil = null; r.lastLive = t;
    if (!wasLive) { r.live = true; r.since = t; this.resetCache(); }
    this.save();
    this.count.last = this.viewers().length;
    this.put(conn, { k: 'ok', viewers: this.count.last });
    if (!wasLive) this.fanout(JSON.stringify(this.state()));
    else if (JSON.stringify(r.meta) !== before) this.fanout(JSON.stringify({ k: 'meta', meta: r.meta }));
    this.wake();
  }

  end(why) {
    const r = this.rec;
    if (!r.live) return;
    r.live = false; r.since = null; r.graceUntil = null; r.lastLive = this.now(); this.save();
    this.resetCache();
    this.fanout(JSON.stringify({ k: 'end', why }));
    this.wake();
  }

  // -- viewer counts: at most once a second, to the streamer and the viewers
  markCount() { this.count.dirty = true; if (this.now() - this.count.at >= this.lim.countMs) this.flushCount(); else this.wake(); }
  flushCount() {
    const c = this.count, n = this.viewers().length;
    c.dirty = false; c.at = this.now();
    if (n === c.last) return;
    c.last = n;
    if (!this.rec.live) return;
    const text = JSON.stringify({ k: 'viewers', n });
    const p = this.activePub(); if (p) try { p.send(text); } catch {}
    this.fanout(text);
  }

  // -- time: one wake-up at the earliest deadline; the host calls tick() when it fires
  expireIfOld() {
    const r = this.rec;
    if (!r.live && r.lastLive && this.now() - r.lastLive >= this.lim.expiryMs) this.forget();
  }
  tick() {
    const t = this.now();
    for (const p of this.pubs()) if (!p.state.authed && p.state.t0 + this.lim.helloMs <= t) this.fail(p, 'hello', CLOSE.hello);
    this.reconcile();
    if (this.rec.graceUntil && t >= this.rec.graceUntil) this.end('lost');
    if (this.count.dirty && t - this.count.at >= this.lim.countMs) this.flushCount();
    this.expireIfOld();
    this.wake();
  }
  wake() {
    const r = this.rec, due = [];
    for (const p of this.pubs()) if (!p.state.authed) due.push(p.state.t0 + this.lim.helloMs);
    if (r.graceUntil) due.push(r.graceUntil);
    if (this.count.dirty) due.push(this.count.at + this.lim.countMs);
    if (!r.live && r.lastLive) due.push(r.lastLive + this.lim.expiryMs);
    this.io.schedule(due.length ? Math.min(...due) : null);
  }
}
