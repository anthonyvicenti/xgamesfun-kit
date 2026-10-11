// Shared by gate.mjs (race rounds) and gate-live.mjs (live rounds): waiting, the party page's observation, and the
// proxy that sends DOM work to the game's frame and real input to the page.
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, ms, label) {
  const t0 = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await sleep(120); }
}
export const snap = page => page.evaluate(() => window.__party?.snapshot() ?? null).catch(() => null);
export const p2p = page => page.evaluate(() => window.__p2p?.snapshot() ?? null).catch(() => null);
/**
 * What both pages show while a joiner is joining, as one line: for a wait that ran out, so the record says where the
 * join stood and not only that the gate waited (the party page's phase and players, the kit's own connection state).
 */
export async function joinState(H, J) {
  const [h, j, hp, jp] = [await snap(H.page), await snap(J.page), await p2p(H.page), await p2p(J.page)];
  const jt = await J.page.evaluate(() => window.__p2p?.transport?.() ?? null).catch(() => null);
  const peers = await H.page.evaluate(() => window.__p2p?.peers?.() ?? null).catch(() => null);
  const party = s => (s ? `${s.phase}, ${s.racers?.length ?? 0} player${s.racers?.length === 1 ? '' : 's'}` : 'no answer from the page');
  const kit = s => (s ? `${s.phase}${s.connected ? ', connected' : ''}${s.reason ? ` ("${String(s.reason).slice(0, 60)}")` : ''}` : 'no answer');
  return `host page: ${party(h)}; host kit: ${kit(hp)}, peers ${peers ? JSON.stringify(peers.map(x => `${x.state}${x.open ? ' open' : ''}`)) : '?'}; joiner page: ${party(j)}; joiner kit: ${kit(jp)}${jt ? `, channel ${jt.dc ?? 'none'}, connection ${jt.pc ?? 'none'}` : ''}`;
}

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

/**
 * The host ends the round, as a player would. A game whose rail is out (kit 1.4.0, live.hud "game") carries End round
 * in its own menu: the HUD's menu button, then #gf-end-round (the host's copy ends its round, so every player's real
 * score reaches the results). Otherwise the rail's End round (#stop). → true when a button was clicked.
 */
export async function endRound(page) {
  try { await page.evaluate(() => { try { document.getElementById('game').contentDocument.exitPointerLock(); } catch {} try { document.exitPointerLock(); } catch {} }); } catch {}
  if (await page.isVisible('#stop').catch(() => false)) { await page.click('#stop', { timeout: 4000 }).catch(() => {}); return true; }
  const frame = page.frames().find(f => f.parentFrame() === page.mainFrame());
  if (!frame) return false;
  for (let i = 0; i < 3; i++) {
    if (await frame.isVisible('#gf-end-round').catch(() => false)) { await frame.click('#gf-end-round', { timeout: 4000 }).catch(() => {}); return true; }
    if (await frame.isVisible('#gf-menu-button').catch(() => false)) await frame.click('#gf-menu-button', { timeout: 3000 }).catch(() => {});
    else { await frame.focus('canvas').catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); }
    await sleep(500);
  }
  return false;
}
