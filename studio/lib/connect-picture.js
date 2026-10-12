// The start page's and the conversation's shared pieces (DOM): the stylesheet both use (studio/talk.css), the small
// element helper, and the connect picture: the studio ⇄ your agent's terminal with a status light between them, one
// line, and the one command in a box with a Copy button (session.js connectView says what each state shows).
import { connectView } from './session.js';

export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    (k in e && k !== 'list' && !k.startsWith('aria-') && !k.startsWith('data-')) ? (e[k] = v) : e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(k => k != null && k !== false));
  return e;
};
/** Inline SVG markup the module wrote itself (icons from fixed path data, never text from a game or a session). */
export const svg = markup => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

/** The start page's and the conversation's stylesheet, linked once. */
export function useTalkStyles() {
  if (document.querySelector('link[data-talk]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: '/studio/talk.css', 'data-talk': '1' }));
}

const STUDIO_ICON = '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="3"/><path d="M3 11h26"/><circle cx="7" cy="8.5" r=".6" fill="currentColor"/><circle cx="10" cy="8.5" r=".6" fill="currentColor"/><path d="M8 16h9M8 20h6"/><rect x="20" y="15" width="5" height="7" rx="1"/></svg>';
const AGENT_ICON = '<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="3"/><path d="M8 13l4 3-4 3M15 20h7"/></svg>';

/** Copy text to the clipboard (the Clipboard API on this page's own origin; a selection copy when it is refused). */
export async function copyText(text, from) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* below */ }
  try {
    const r = document.createRange(); r.selectNodeContents(from);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const ok = document.execCommand('copy'); s.removeAllRanges(); return ok;
  } catch { return false; }
}

/**
 * The connect picture for a connection() result. → an element with class `conn session-pic`, data-state (the
 * connection's state) and data-light; its first <strong> is the title and its first .small the line.
 *   compact: the start page's size (the diagram smaller, beside the words)
 */
export function connectPicture(c, { setup = null, waiting = false, compact = false, part = null } = {}) {
  const v = connectView(c, { setup, waiting });
  const code = v.command ? el('code', { className: 'sp-code' }, v.command) : null;
  const copy = v.command ? el('button', { type: 'button', className: 'ghost small sp-copy', 'aria-label': 'Copy the command', on: { click: async e => {
    const b = e.currentTarget;
    const ok = await copyText(v.command, code);
    b.textContent = ok ? 'Copied' : 'Select and copy it';
    b.dataset.copied = ok ? '1' : '0';
    setTimeout(() => { b.textContent = 'Copy'; delete b.dataset.copied; }, 1800);
  } } }, 'Copy') : null;
  const lightWords = { off: 'not connected', on: 'listening', busy: 'working', warn: 'needs a nudge' }[v.light];
  return el('div', { className: `conn session-pic${compact ? ' compact' : ''}`, 'data-state': c?.state ?? 'none', 'data-light': v.light, 'data-part': part, role: 'group', 'aria-label': `Your session: ${lightWords}` },
    el('div', { className: 'sp-diagram', 'aria-hidden': 'true' },
      el('span', { className: 'sp-node' }, svg(STUDIO_ICON), el('span', { className: 'sp-label' }, 'Studio')),
      el('span', { className: 'sp-wire' }, el('span', { className: 'sp-light' }), el('span', { className: 'sp-spark' })),
      el('span', { className: 'sp-node' }, svg(AGENT_ICON), el('span', { className: 'sp-label' }, 'Your agent'))),
    el('div', { className: 'sp-words' },
      el('strong', {}, v.title),
      v.line ? el('div', { className: 'small' }, v.line) : null,
      v.command ? el('div', { className: 'sp-cmd' }, code, copy) : null));
}
