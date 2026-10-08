// Shared by gate.mjs (race rounds) and gate-live.mjs (live rounds): waiting, the party page's observation, and the
// proxy that sends DOM work to the game's frame and real input to the page.
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms, label) {
  const t0 = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await sleep(120); }
}
export const snap = page => page.evaluate(() => window.__party?.snapshot() ?? null).catch(() => null);
export const p2p = page => page.evaluate(() => window.__p2p?.snapshot() ?? null).catch(() => null);

/** Which signaling transport each player's kit used (gf.js 1.3.0+ reports it); with --signal, both must have used it. */
export async function checkTransport({ H, J, srv, signal, check, rec }) {
  const [h, j] = [await p2p(H.page), await p2p(J.page)];
  const st = srv.sig.stats();
  rec.transport = { host: h?.signal ?? 'ws (a kit before 1.3.0)', joiner: j?.signal ?? 'ws (a kit before 1.3.0)', why: h?.signalWhy ?? null,
    server: { webSockets: st.sockets, wsRooms: st.rooms, httpRequests: st.httpRequests, httpRooms: st.httpRooms, httpJoins: st.httpJoins, httpRelayed: st.httpRelayed } };
  if (!signal) return;
  const used = signal === 'http' ? st.httpRooms >= 1 && st.httpJoins >= 1 && st.rooms === 0 : st.rooms >= 1 && !st.httpRooms;
  check('signal-transport', h?.signal === signal && j?.signal === signal && used,
    `host ${h?.signal}, joiner ${j?.signal} (asked for ${signal}); the server saw ${st.httpRooms} HTTP room(s), ${st.httpJoins} HTTP join(s), ${st.httpRelayed} HTTP relay(s), ${st.rooms} WebSocket room(s)`);
}

// DOM work goes to the game's frame, input and screenshots to the page. The frame starts at the page's top-left
// corner (the rail is to its right), so the game's coordinates are the page's.
export const FRAME_METHODS = new Set(['evaluate', 'evaluateHandle', '$', '$$', '$eval', '$$eval', 'selectOption', 'click', 'dblclick', 'tap', 'fill', 'focus', 'hover', 'type', 'press', 'check', 'uncheck', 'waitForFunction', 'waitForSelector', 'locator', 'getByText', 'getByRole', 'getByTestId', 'textContent', 'innerText', 'innerHTML', 'getAttribute', 'isVisible', 'content', 'title', 'url']);
// The scripted player plays the GAME. A card of the shell (results, countdown) can appear over the game at any moment,
// under a click that was meant for the game: with random input that pressed "Play again" and played a whole extra
// round behind the gate's back (rhythm, 2026-10-05). So no scripted press lands while a shell card is showing.
export const inFrame = (page, frame, size) => {
  const covered = () => page.evaluate(() => { const c = document.getElementById('card'); return !!c && !c.hidden; }).catch(() => false);
  const mouse = new Proxy(page.mouse, { get(m, k) {
    const v = m[k];
    if (k === 'click' || k === 'dblclick' || k === 'down') return async (...a) => (await covered() ? undefined : v.apply(m, a));
    return typeof v === 'function' ? v.bind(m) : v;
  } });
  return new Proxy(page, { get(p, k) {
    if (k === 'viewportSize') return () => size;
    if (k === 'mouse') return mouse;
    const from = FRAME_METHODS.has(k) ? frame : p, v = from[k];
    return typeof v === 'function' ? v.bind(from) : v;
  } });
};
