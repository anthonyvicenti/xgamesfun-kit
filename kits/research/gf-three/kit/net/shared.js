// gf-three net: ctx.shared, host-owned state replicated to every copy (CONTRACT §3, §4.6).
//
//   const S = ctx.shared.register('balls', { list: [] });   // every copy, in setup(); the same key and initial value
//   if (ctx.host) S.list.push({ id: 1, x: 0, z: 0 });        // the host writes (plain mutation)
//   S.list                                                   // other copies read the host's latest values
//   ctx.shared.smooth('balls')                               // other copies: blended between the last two snapshots
//                                                            // (positions of moving things); numbers that must not
//                                                            // blend are read through the proxy (latest), never smooth()
//
// Everything registered goes out in one net.world message with the kit's own state (12 a second, under 3.5 KB:
// keep keys short and numbers rounded). Alone, the local copy is the host and nothing is sent.
// On a replay every registered value goes back to a copy of its initial value (the proxy stays the same object).

const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function createShared({ isHost }) {
  const initial = new Map(), live = {}, proxies = new Map();
  let latest = null, smoothState = null, warned = false;
  const host = () => isHost();
  const source = key => (host() || !latest ? live[key] : (latest[key] ?? live[key]));

  function proxyFor(key) {
    if (proxies.has(key)) return proxies.get(key);
    const handler = {
      get(_t, prop) { const src = source(key); return src == null ? undefined : src[prop]; },
      set(_t, prop, value) {
        if (!host()) { if (!warned) { warned = true; console.warn(`gf-three shared: only the host writes shared state ("${key}.${String(prop)}" ignored on this copy)`); } return true; }
        live[key][prop] = value; return true;
      },
      deleteProperty(_t, prop) { if (host()) delete live[key][prop]; return true; },
      has(_t, prop) { const src = source(key); return src != null && prop in src; },
      ownKeys() { const src = source(key); return src ? Reflect.ownKeys(src) : []; },
      getOwnPropertyDescriptor(_t, prop) { const src = source(key); if (!src || !(prop in src)) return undefined; return { value: src[prop], writable: true, enumerable: true, configurable: true }; },
    };
    const p = new Proxy({}, handler);
    proxies.set(key, p); return p;
  }

  return {
    /** Register a key (an object value: its fields are what the host writes). Returns a live proxy. */
    register(key, init = {}) {
      if (typeof key !== 'string' || !/^[a-zA-Z_][\w]*$/.test(key)) throw new Error(`gf-three shared: bad key "${key}"`);
      if (!init || typeof init !== 'object' || Array.isArray(init)) throw new Error(`gf-three shared: register("${key}", {...}) takes an object`);
      if (!initial.has(key)) { initial.set(key, clone(init)); live[key] = clone(init); }
      return proxyFor(key);
    },
    /** The blended (interpolated) value of a key on a copy that is not the host; the live value on the host. */
    smooth(key) { return host() || !smoothState ? live[key] : (smoothState[key] ?? live[key]); },
    /** What the host sends (the live object; net.js serialises it when it goes out). */
    outgoing: () => live,
    /** A copy that is not the host: the newest world from the host ({latest, state} of the rules' part). */
    receive(latestPart, statePart) { latest = latestPart ?? latest; smoothState = statePart ?? smoothState; },
    get hasWorld() { return latest !== null; },
    /** Back to the initial values (a replay). */
    reset() { for (const [k, v] of initial) live[k] = clone(v); latest = null; smoothState = null; },
    /** A plain copy of everything (for snapshot()). */
    snapshot() { const out = {}; for (const k of initial.keys()) out[k] = clone(source(k)); return out; },
    keys: () => [...initial.keys()],
  };
}
