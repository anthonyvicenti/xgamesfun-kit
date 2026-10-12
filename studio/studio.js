// The studio shell: the game preview, the wallet, live reload, and the tabs seam.
// A tab is studio/tabs/<id>.js exporting `default { id, label, order, mount(el, ctx) }` (docs/ARCHITECTURE.md). mount
// may return a function, called when the studio page goes away. ctx holds:
//   game                 /api/game/info: title, hook, mechanics, controls, network, gamesfun (gamesfun.json), latestVerify
//   api(path, body?, method?)  the dev server's API: GET without a body, POST with one (JSON, or raw for a Blob/ArrayBuffer);
//                        a third argument sets the method (PATCH with a JSON body, DELETE with none);
//                        path "game/slots" or "/api/game/slots"; resolves to the parsed JSON, rejects with the error text
//                        (an Error whose `problems` holds the kit's words, one a line, when a slot write was refused)
//   wallet               the Wallet Standard connection the studio owns (studio/wallet.js): list(), connect(name?),
//                        disconnect(), account, address, feature(name), onChange(fn)
//   toast(msg, kind?)    a short message; kind 'ok' | 'error'
//   preview              { reload(), show(path), overlay(node|null), frame, send(msg, {reply, timeout}), hold(files, ms) } the game
//                        frame on the left ("/game/?gf-show=prop.ball"); overlay lays an editor's own view over the game (one
//                        at a time); send posts a message to the game and resolves to its answer of type `reply` (null when
//                        none comes in time: gf:slot → gf:slot-applied, gf:loadout → gf:loadout-applied); hold keeps the
//                        next live reload away when only these files change (a value the game already took live)
//   selection            { get(), set(sel|null), onChange(fn) } what the person picked (a slot or object, {id, label}); it travels
//                        with their next change request. A game frame may post { gf: 'select', id, label } to pick one.
//   on(event, fn)        dev-server events: 'game' (the game's files changed: { files }), 'verify' (a run finished)
import { hostBridge, inside } from './host-bridge.js';
import { createWallet } from './wallet.js';

const $ = sel => document.querySelector(sel);

async function api(path, body, method) {
  const url = path.startsWith('/api/') ? path : `/api/${String(path).replace(/^\/+/, '')}`;
  const raw = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
  const init = body === undefined ? (method ? { method } : {}) : method ? { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : raw
    ? { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } }
    : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
  const res = await fetch(url, { cache: 'no-store', ...init });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error((data && data.error) || `${res.status} ${res.statusText}`); if (Array.isArray(data?.problems)) e.problems = data.problems; throw e; }
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = String(msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4000);
}

const store = {
  get(k) { try { return localStorage.getItem(`gamesfun.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`gamesfun.${k}`, v); } catch {} },
};

// ---- the preview ----
const frame = $('#preview');
const preview = {
  frame,                      // the iframe element (same origin: a tab may read the game's page, never write it)
  path: store.get('preview') || '/game/',
  show(path) { this.path = path; frame.src = path; const opt = [...$('#preview-mode').options].find(o => o.value === path); $('#preview-mode').value = opt ? path : $('#preview-mode').value; },
  reload() { try { frame.contentWindow.location.reload(); } catch { frame.src = this.path; } },
  // an editor's own view laid over the game (the map painter, the layout's top view); null takes it away
  overlay(node) { const wrap = frame.parentElement; wrap.querySelector(':scope > .preview-overlay')?.remove(); if (node) { node.classList.add('preview-overlay'); wrap.append(node); } },
  // a message to the game (same origin), and its answer of type `reply` from that frame, or null after `timeout` ms
  send(msg, { reply = null, timeout = 1500 } = {}) {
    const win = frame.contentWindow;
    if (!win) return Promise.resolve(null);
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; window.removeEventListener('message', on); clearTimeout(t); resolve(v); };
      const on = e => { if (e.source === win && e.origin === location.origin && e.data?.type === reply && (msg.id === undefined || e.data.id === msg.id)) finish(e.data); };
      if (reply) window.addEventListener('message', on);
      const t = setTimeout(() => finish(null), reply ? timeout : 0);
      try { win.postMessage(msg, location.origin); } catch { finish(null); }
    });
  },
  // the next file change that touches only `files` (within ms) does not reload the game: it already took the value live
  hold(files, ms = 4000) { held = { files: new Set(files), until: Date.now() + ms }; },
};
let held = null;
$('#preview-mode').addEventListener('change', e => { store.set('preview', e.target.value); preview.show(e.target.value); });
$('#preview-reload').addEventListener('click', () => preview.reload());

// ---- the host bridge: a game with a live economy gets its buttons from this page (studio/host-bridge.js) ----
// It answers only the preview frame (or a frame inside it, the friends lobby's game) and only when gamesfun.json has a
// live economy; otherwise it says nothing and the game looks as it always did.
const bridge = hostBridge({ win: window, accept: src => inside(frame.contentWindow, src) });
window.__gamesfunHostBridge = bridge;

// ---- the selection chip ----
let selected = null;
const selListeners = new Set();
const selection = {
  get: () => selected,
  set(sel) { selected = sel && sel.id ? { id: String(sel.id), label: String(sel.label ?? sel.id) } : null; for (const fn of selListeners) { try { fn(selected); } catch (e) { console.error(e); } } },
  onChange(fn) { selListeners.add(fn); return () => selListeners.delete(fn); },
};
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;      // only the game frame, on this origin
  const d = e.data;
  if (d && d.gf === 'select' && typeof d.id === 'string') selection.set({ id: d.id.slice(0, 120), label: String(d.label ?? d.id).slice(0, 120) });
});

// ---- events from the dev server (live reload) ----
const handlers = new Map();
const on = (event, fn) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return () => handlers.get(event).delete(fn); };
const fire = (event, data) => { for (const fn of handlers.get(event) ?? []) { try { fn(data); } catch (e) { console.error(e); } } };
const es = new EventSource('/__gamesfun/events');
let reloadTimer = null;
es.addEventListener('game', e => {
  const data = JSON.parse(e.data || '{}');
  clearTimeout(reloadTimer);
  const files = Array.isArray(data.files) ? data.files : [];
  const live = held && Date.now() < held.until && files.length && files.every(f => held.files.has(f));
  if (live) held = null;
  reloadTimer = setTimeout(() => { if (!live) { bridge.forget(); preview.reload(); } fire('game', { ...data, live: !!live }); showTitle(); }, 120);
});
// The title in the bar follows the game's files: a change by the session or a roll-back may rename the game.
function showTitle() {
  api('game/info').then(g => { $('#game-title').textContent = g.title; $('#game-title').title = g.hook || ''; }).catch(() => {});
}
es.addEventListener('verify', e => fire('verify', JSON.parse(e.data || '{}')));
es.addEventListener('studio', () => location.reload());

// ---- the wallet ----
const wallet = createWallet();
const walletBtn = $('#wallet-btn');
const short = a => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
function paintWallet() {
  const list = wallet.list();
  walletBtn.hidden = !list.length && !wallet.account;
  walletBtn.textContent = wallet.account ? `Wallet ${short(wallet.address)}` : 'Connect wallet';
  walletBtn.title = wallet.account ? `${wallet.wallet?.name}: ${wallet.address} (click to disconnect)` : list.map(w => w.name).join(', ');
}
wallet.onChange(paintWallet);
walletBtn.addEventListener('click', async () => {
  try {
    if (wallet.account) { await wallet.disconnect(); toast('Wallet disconnected'); }
    else { const a = await wallet.connect(); toast(`Connected ${short(a?.address)}`, 'ok'); }
  } catch (e) { toast(e.message, 'error'); }
});
setTimeout(paintWallet, 500);

// ---- tabs ----
// The network badge belongs to the web3 side: hidden until the game has web3 settings or the person opens a web3 tab.
const WEB3_TABS = new Set(['economy']);
let networkShown = false;
const paintNetwork = id => { $('#network').hidden = !(networkShown || WEB3_TABS.has(id)); };

async function loadTabs(ctx) {
  const list = await api('studio/tabs');
  const tabs = [];
  for (const t of list) {
    try {
      const mod = await import(`${t.url}?v=${Date.now()}`);
      const d = mod.default;
      if (!d || typeof d.id !== 'string' || typeof d.label !== 'string' || typeof d.mount !== 'function') throw new Error('must export default { id, label, order, mount(el, ctx) }');
      tabs.push({ ...d, order: Number.isFinite(d.order) ? d.order : 100, file: t.file });
    } catch (e) {
      tabs.push({ id: `broken-${t.file}`, label: `${t.file} ⚠`, order: 999, file: t.file, mount: el => { el.innerHTML = '<p class="error-box"></p>'; el.firstChild.textContent = `studio/tabs/${t.file} did not load: ${e.message}`; } });
    }
  }
  tabs.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const bar = $('#tabs'), panels = $('#panels');
  const mounted = new Map(), cleanups = [];
  async function select(id) {
    store.set('tab', id);
    paintNetwork(id);
    for (const b of bar.children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    for (const p of panels.children) p.hidden = p.dataset.id !== id;
    if (!mounted.has(id)) {
      const tab = tabs.find(t => t.id === id), el = panels.querySelector(`[data-id="${CSS.escape(id)}"]`);
      mounted.set(id, true);
      try { const off = await tab.mount(el, ctx); if (typeof off === 'function') cleanups.push(off); }
      catch (e) { el.innerHTML = '<p class="error-box"></p>'; el.firstChild.textContent = `${tab.label}: ${e.message}`; console.error(e); }
    }
  }
  for (const t of tabs) {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.dataset.id = t.id; b.textContent = t.label;
    b.addEventListener('click', () => select(t.id));
    bar.append(b);
    const p = document.createElement('div');
    p.className = 'panel'; p.dataset.id = t.id; p.hidden = true; p.role = 'tabpanel';
    panels.append(p);
  }
  window.addEventListener('pagehide', () => { for (const off of cleanups) { try { off(); } catch {} } });
  // a link to a tab (#economy, or #economy?flow=economy from an agent's tool) wins over the remembered tab
  const linked = () => decodeURIComponent(location.hash.slice(1).split('?')[0]);
  const want = tabs.some(t => t.id === linked()) ? linked() : store.get('tab');
  if (tabs.length) await select(tabs.some(t => t.id === want) ? want : tabs[0].id);
  window.addEventListener('hashchange', () => { if (tabs.some(t => t.id === linked())) select(linked()); });
  return tabs;
}

async function main() {
  window.__gamesfunStudio = true;
  let game;
  try { game = await api('game/info'); } catch (e) { $('#game-title').textContent = `Could not reach the dev server: ${e.message}`; return; }
  document.title = `${game.title} · gamesfun studio`;
  $('#game-title').textContent = game.title;
  $('#game-title').title = game.hook || '';
  $('#network').textContent = game.network || 'devnet';
  networkShown = !!game.gamesfun;       // only a game with web3 settings (gamesfun.json) shows its network up front
  // a live economy: "Open game in its own tab" opens it hosted (studio/play.html), so its economy's buttons come along
  if (game.gamesfun?.economy?.live?.game) $('#open-game').href = '/studio/play.html';
  paintNetwork(store.get('tab'));
  preview.show(preview.path);
  const ctx = { game, api, wallet, toast, preview, on, selection };
  window.__gamesfunStudioTabs = await loadTabs(ctx);
}
main();
