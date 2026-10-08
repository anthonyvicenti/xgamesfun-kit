// Small DOM pieces the Token and Shop tabs share: an element helper, the tabs' styles (scoped under .gfw3, themed
// through the studio's --studio-* variables when it sets them), the wallet chip, the request banner, the picture
// picker and the approval panel that walks a flow in the creator's wallet.
import { apiOf, cancelled, pictureUrl, runFlow, short, walletOf } from './client.js';

/** Replace an element's children, skipping null, undefined and false (the DOM would print them as text). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

/** h('button', { class: 'x', onclick }, 'text', child…) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  return el;
}

const CSS = `
.gfw3{--bg:var(--studio-bg,#0d0f14);--panel:var(--studio-panel,#161a22);--line:var(--studio-line,#2a3140);--fg:var(--studio-fg,#e8ecf3);--dim:var(--studio-dim,#9aa4b5);--accent:var(--studio-accent,#8b7cff);--ok:#4fd18b;--err:#ff7a7a;--warn:#ffcf5a;color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;gap:14px;max-width:920px}
.gfw3 *{box-sizing:border-box}
.gfw3 h2{font-size:19px;margin:0}.gfw3 h3{font-size:15px;margin:0 0 8px}.gfw3 p{margin:4px 0}
.gfw3 .dim{color:var(--dim)}.gfw3 .mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;overflow-wrap:anywhere}
.gfw3 .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.gfw3 .badge{display:inline-block;padding:2px 9px;border-radius:999px;border:1px solid var(--line);color:var(--dim);font-size:12px}
.gfw3 .badge.dev{color:var(--warn);border-color:#ffcf5a55}
.gfw3 .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.gfw3 button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:#222836;color:var(--fg);cursor:pointer}
.gfw3 button.primary{background:var(--accent);border-color:var(--accent);color:#0d0f14;font-weight:600}
.gfw3 button.link{background:none;border:0;padding:0;color:var(--accent)}
.gfw3 button:disabled{opacity:.5;cursor:default}
.gfw3 input,.gfw3 textarea,.gfw3 select{font:inherit;width:100%;padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:#0f1218;color:var(--fg)}
.gfw3 label.field{display:grid;gap:4px;font-size:13px;color:var(--dim)}
.gfw3 .row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}.gfw3 .grow{flex:1 1 220px}
.gfw3 .choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.gfw3 .choice{text-align:left;display:grid;gap:4px;padding:16px;border-radius:14px}
.gfw3 .seg{display:flex;flex-wrap:wrap;gap:6px}.gfw3 .seg button{padding:6px 11px}.gfw3 .seg button.on{border-color:var(--accent);color:var(--accent)}
.gfw3 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.gfw3 .tile{display:grid;gap:6px;text-align:left;padding:12px;border-radius:12px}
.gfw3 .pic{width:100%;aspect-ratio:1;border-radius:10px;background:#0f1218;object-fit:contain;display:grid;place-items:center;color:var(--dim)}
.gfw3 .slot{width:96px;height:96px;flex:none}
.gfw3 .state{font-size:12px;color:var(--dim)}.gfw3 .state.published{color:var(--ok)}.gfw3 .state.changed{color:var(--warn)}
.gfw3 .note{padding:10px 12px;border-radius:10px;border:1px solid var(--line)}.gfw3 .note.ok{border-color:#4fd18b66}.gfw3 .note.error{border-color:#ff7a7a88;color:var(--err)}
.gfw3 .steps{margin:8px 0;padding-left:22px}.gfw3 .steps li.done{color:var(--ok)}.gfw3 .steps li.current{font-weight:600}
.gfw3 .details{border-left:3px solid var(--line);padding-left:10px;margin:8px 0;color:var(--dim)}
.gfw3 .results a{color:var(--accent)}
.gfw3.modal{position:fixed;inset:0;z-index:1000;background:#000a;display:grid;place-items:center;padding:16px;max-width:none}
.gfw3 .dialog{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;width:min(560px,100%);max-height:90vh;overflow:auto;display:grid;gap:12px}
.gfw3 .pickgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.gfw3 .pickgrid button{padding:6px;display:grid;gap:4px;font-size:11px;color:var(--dim);overflow:hidden}
.gfw3 .swatches{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.gfw3 .swatches button{width:24px;height:24px;padding:0;border-radius:50%}
.gfw3 .swatches button.on{outline:2px solid var(--fg)}
.gfw3 details summary{cursor:pointer;color:var(--dim)}
.gfw3 .rarity-0{color:#c9d1dc}.gfw3 .rarity-1{color:#7bd389}.gfw3 .rarity-2{color:#3a86ff}.gfw3 .rarity-3{color:#b388ff}.gfw3 .rarity-4{color:#ffb000}
`;
export function styles() {
  if (document.getElementById('gfw3-styles')) return;
  document.head.append(h('style', { id: 'gfw3-styles' }, CSS));
}

/** A modal dialog; returns { el, close }. */
export function modal(...children) {
  const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, ...children);
  const shade = h('div', { class: 'gfw3 modal' }, box);
  const close = () => shade.remove();
  shade.addEventListener('mousedown', (e) => e.target === shade && close());
  document.body.append(shade);
  return { el: box, close };
}

/** Pick one of the browser's wallets (only shown when it has more than one). */
export function pickWallet(list) {
  if (list.length === 1) return Promise.resolve(list[0]);
  return new Promise((resolve) => {
    const m = modal(h('h3', {}, 'Choose a wallet'), ...list.map((w) => h('button', { onclick: () => (m.close(), resolve(w)) }, w.name)), h('button', { class: 'link', onclick: () => (m.close(), resolve(null)) }, 'Cancel'));
  });
}

/** The tab's shared context: api, wallet, and a re-render hook. */
export function tabContext(ctx) {
  return { api: apiOf(ctx), wallet: walletOf(ctx, pickWallet), toast: ctx?.toast ?? (() => {}) };
}

/** "Connect a wallet" / the connected address. */
export function walletChip(t, onChange) {
  const address = t.wallet.address();
  if (address) return h('span', { class: 'badge mono', title: address, 'data-testid': 'wallet-address' }, `${t.wallet.name}: ${short(address)}`);
  return h(
    'button',
    {
      'data-testid': 'wallet-connect',
      onclick: async (e) => {
        e.target.disabled = true;
        try {
          await t.wallet.connect();
          onChange();
        } catch (error) {
          t.toast(error.message);
          onChange(error.message);
        } finally {
          e.target.disabled = false;
        }
      },
    },
    'Connect a wallet',
  );
}

/** Requests an agent left for this tab ("launch", "publish"): Review starts the approval, Dismiss drops it. */
export function requestBanner(t, state, kind, { onReview, onDone }) {
  const list = state.requests.filter((r) => r.kind === kind);
  return list.map((r) =>
    h('div', { class: 'card', 'data-testid': 'agent-request' },
      h('strong', {}, kind === 'launch' ? `Your agent asked to launch $${r.input?.symbol ?? 'a token'}` : 'Your agent asked to put the shop on sale'),
      r.summary ? h('p', { class: 'dim' }, r.summary) : null,
      h('p', { class: 'dim' }, `From ${r.from}, ${new Date(r.createdAt).toLocaleString()}. Nothing happens until you approve each step in your wallet.`),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => onReview(r) }, 'Review and approve'),
        h('button', { onclick: async () => (await t.api('/request/dismiss', { id: r.id }), onDone()) }, 'Dismiss'))));
}

/** A grid of the game's pictures; resolves the chosen path (or null). */
export function choosePicture(state, title = 'Pick a picture') {
  return new Promise((resolve) => {
    const pics = state.pictures;
    const m = modal(
      h('h3', {}, title),
      pics.length
        ? h('div', { class: 'pickgrid' }, pics.map((p) => h('button', { title: p, onclick: () => (m.close(), resolve(p)) }, h('img', { class: 'pic', src: pictureUrl(p), alt: '', loading: 'lazy' }), p.split('/').pop())))
        : h('p', { class: 'dim' }, 'No pictures in this game yet. Add a PNG, JPEG, WebP or GIF to its folder (for example assets/hat.png) and reopen this.'),
      h('button', { onclick: () => (m.close(), resolve(null)) }, 'Cancel'),
    );
  });
}

/**
 * The approval panel: the flow's steps, what the current one does, and "Approve in wallet". Calls onDone(view) when
 * the last step lands and onClose() when the creator cancels.
 */
export function approvalPanel(t, view, { onDone, onClose }) {
  const panel = h('div', { class: 'card', 'data-testid': 'approval' });
  let current = view;
  let busy = false;
  let error = '';
  let live = null;
  const render = () => {
    const steps = current.steps.map((title, i) => h('li', { class: i < current.next ? 'done' : i === current.next ? 'current' : '' }, title));
    fill(panel,
      h('h3', {}, current.title),
      ...current.lines.map((l) => h('p', { class: 'dim' }, l)),
      h('ol', { class: 'steps' }, steps),
      live?.details?.length ? h('div', { class: 'details' }, h('strong', {}, live.title), ...live.details.map((d) => h('p', {}, d))) : null,
      live?.waiting === 'wallet' ? h('p', { class: 'note', role: 'status' }, live.kind === 'message' ? 'Sign in your wallet (a signature for an upload: it moves no funds)…' : 'Approve in your wallet…') : null,
      live?.waiting === 'server' && busy ? h('p', { class: 'note', role: 'status' }, 'Working…') : null,
      error ? h('p', { class: 'note error', role: 'alert' }, error) : null,
      current.results.length ? h('ol', { class: 'results mono' }, current.results.map(linkify)) : null,
      current.done
        ? h('p', { class: 'note ok', role: 'status', 'data-testid': 'approval-done' }, 'Done.')
        : h('div', { class: 'row' },
            h('button', { class: 'primary', 'data-testid': 'approve', disabled: busy, onclick: go }, current.next > 0 || error ? 'Continue in wallet' : 'Approve in wallet'),
            h('button', { disabled: busy, onclick: cancel }, 'Cancel')),
    );
  };
  async function go() {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try {
      if (!t.wallet.address()) await t.wallet.connect();
      current = await runFlow(t.api, t.wallet, current, (u) => {
        live = u;
        if (u.view) current = u.view;
        render();
      });
      busy = false;
      live = null;
      render();
      onDone?.(current);
    } catch (e) {
      busy = false;
      error = cancelled(e) ? 'You cancelled in your wallet. Nothing was sent. Press Continue to try again.' : e.message;
      live = null;
      render();
    }
  }
  async function cancel() {
    try {
      await t.api('/flow/cancel', { flowId: current.id });
    } catch {}
    onClose?.();
  }
  render();
  return panel;
}

/** A result line whose links open in a new tab. */
function linkify(text) {
  const li = h('li');
  let rest = text;
  for (let m = /(https:\/\/\S+)/.exec(rest); m; m = /(https:\/\/\S+)/.exec(rest)) {
    li.append(rest.slice(0, m.index), h('a', { href: m[1], target: '_blank', rel: 'noreferrer' }, m[1].replace(/^https:\/\//, '').slice(0, 64)));
    rest = rest.slice(m.index + m[1].length);
  }
  li.append(rest);
  return li;
}

/** A short-lived note under the header. */
export function note(kind, text) {
  return text ? h('div', { class: `note ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text) : null;
}
