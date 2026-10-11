// Session: what your own coding-agent session is doing, and a box to ask it for changes. The page never talks to a model:
// requests wait in a queue the session collects (gamesfun_requests), and permission cards answer the session's own prompt.
import { IDLE_HINT, EVENT_TYPES, connection, describeEvent, normalizeEvent, normalizeQueue, pendingPermissions } from '../lib/session.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) (k in e && k !== 'list') ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.filter(k => k != null));
  return e;
};
const clock = at => { const d = at ? new Date(at) : null; return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; };

export default {
  id: 'session',
  label: 'Session',
  order: 1,
  async mount(root, ctx) {
    const events = [], answered = new Set();
    let queueRaw = null, timer = null, es = null;

    const banner = el('div', { className: 'conn', role: 'status' });
    const perms = el('div', { className: 'perms' });
    const box = el('textarea', { className: 'ask', rows: 3, placeholder: 'Ask for a change: "make the enemies faster", "swap the ground for sand"…', maxLength: 2000, 'aria-label': 'Ask your session for a change' });
    const chip = el('span', { className: 'chip', hidden: true });
    const send = el('button', { type: 'button' }, 'Send to your session');
    const queue = el('div', { className: 'queue' });
    const line = el('ol', { className: 'timeline', 'aria-label': 'What your session did' });

    root.append(banner, perms,
      el('h3', {}, 'Ask for a change'),
      box, el('div', { className: 'toolbar' }, send, chip),
      el('p', { className: 'muted small' }, 'Your session picks this up when it next waits for you. Nothing is sent to a model from this page.'),
      el('h3', {}, 'Your requests'), queue,
      el('h3', {}, 'What your session did'), line);

    // ---- the selection chip ----
    function paintChip(sel) {
      chip.hidden = !sel;
      chip.replaceChildren();
      if (!sel) return;
      const x = el('button', { type: 'button', className: 'chip-x', title: 'Do not send the selection', 'aria-label': `Remove selection ${sel.label}` }, '×');
      x.addEventListener('click', () => ctx.selection.set(null));
      chip.append(el('span', {}, `About: ${sel.label}`), x);
    }
    const offSel = ctx.selection.onChange(paintChip);
    paintChip(ctx.selection.get());

    // ---- sending, editing, removing ----
    async function submit(text, selection) {
      const r = await ctx.api('session/request', { text, ...(selection ? { selection } : {}) });
      return r;
    }
    async function onSend() {
      const text = box.value.trim();
      if (!text) { box.focus(); return; }
      send.disabled = true;
      try { await submit(text, ctx.selection.get()); box.value = ''; ctx.selection.set(null); await refreshQueue(); }
      catch (e) { ctx.toast(e.message, 'error'); }
      finally { send.disabled = false; }
    }
    send.addEventListener('click', onSend);
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); } });

    function paintQueue() {
      const list = normalizeQueue(queueRaw);
      queue.replaceChildren();
      if (!list.length) { queue.append(el('p', { className: 'muted' }, 'Nothing asked yet.')); return; }
      for (const r of list) {
        const text = el('div', { className: 'req-text' }, r.text);
        const head = el('div', { className: 'req-state' }, el('span', { className: `dot ${r.words.tone}` }), r.words.label);
        const row = el('div', { className: 'req', 'data-state': r.state }, head, text);
        if (r.selection?.label || r.selection?.id) row.append(el('span', { className: 'chip small' }, `About: ${r.selection.label ?? r.selection.id}`));
        const acts = el('div', { className: 'req-acts' });
        if (r.words.editable) {
          const edit = el('button', { type: 'button', className: 'ghost' }, 'Edit');
          edit.addEventListener('click', () => {
            const ta = el('textarea', { className: 'ask', rows: 2, value: r.text, 'aria-label': 'Edit your request' });
            const save = el('button', { type: 'button' }, 'Save'), cancel = el('button', { type: 'button', className: 'ghost' }, 'Cancel');
            save.addEventListener('click', async () => { try { await ctx.api(`session/request/${encodeURIComponent(r.id)}`, { text: ta.value.trim() }, 'PATCH'); await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } });
            cancel.addEventListener('click', paintQueue);
            text.replaceWith(ta); acts.replaceChildren(save, cancel); ta.focus();
          });
          acts.append(edit);
        }
        if (r.words.editable || r.words.again) {
          const rm = el('button', { type: 'button', className: 'ghost' }, r.words.again ? 'Remove' : 'Remove');
          rm.addEventListener('click', async () => { try { await ctx.api(`session/request/${encodeURIComponent(r.id)}`, undefined, 'DELETE'); await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } });
          acts.append(rm);
        }
        if (r.words.again) {
          const again = el('button', { type: 'button' }, 'Send again');
          again.addEventListener('click', async () => { try { await submit(r.text, r.selection); await ctx.api(`session/request/${encodeURIComponent(r.id)}`, undefined, 'DELETE'); await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } });
          acts.prepend(again);
        }
        row.append(acts);
        queue.append(row);
      }
    }

    function paintPerms() {
      perms.replaceChildren();
      for (const p of pendingPermissions(events, answered)) {
        const decide = async decision => {
          answered.add(p.id);
          try { await ctx.api(`session/permission/${encodeURIComponent(p.id)}`, { decision }); ctx.toast(decision === 'allow' ? 'Allowed' : 'Denied', 'ok'); }
          catch (e) { answered.delete(p.id); ctx.toast(e.message, 'error'); }
          paintPerms();
        };
        const allow = el('button', { type: 'button' }, 'Allow'), deny = el('button', { type: 'button', className: 'ghost' }, 'Deny');
        allow.addEventListener('click', () => decide('allow')); deny.addEventListener('click', () => decide('deny'));
        perms.append(el('div', { className: 'perm', role: 'group', 'aria-label': 'Permission request' },
          el('strong', {}, 'Your session asks to ' + (p.tool ? `use ${p.tool}` : 'do something')),
          p.text ? el('pre', { className: 'log' }, p.text) : null,
          el('div', { className: 'toolbar' }, allow, deny),
          el('p', { className: 'muted small' }, 'The same question is also live in your terminal: answer it in either place.')));
      }
    }

    function paintBanner() {
      const c = connection(events, queueRaw);
      const words = { listening: 'Your session is listening', working: 'Your session is working', idle: 'Your session is idle', none: 'No session connected yet' }[c];
      banner.dataset.state = c;
      banner.replaceChildren(el('span', { className: `dot ${c === 'idle' ? 'warn' : c === 'none' ? 'wait' : 'ok'}` }), el('strong', {}, words),
        c === 'idle' ? el('div', { className: 'small' }, IDLE_HINT) : c === 'none' ? el('div', { className: 'small muted' }, 'Start your coding agent in this folder; its events appear here.') : null);
    }

    function paintLine() {
      line.replaceChildren(...events.filter(e => e.type !== 'permission-resolved').slice(-40).reverse()
        .map(e => el('li', { 'data-type': e.type }, el('span', { className: 'time mono' }, clock(e.at)), ' ', describeEvent(e))));
      if (!line.children.length) line.append(el('li', { className: 'muted' }, 'Nothing yet.'));
    }
    const paintAll = () => { paintBanner(); paintPerms(); paintLine(); };

    async function refreshQueue() {
      try { queueRaw = await ctx.api('session/queue'); } catch (e) { queueRaw = null; }
      paintQueue(); paintBanner();
    }

    // ---- the event stream ----
    function take(raw, type) {
      const e = normalizeEvent(raw?.data ?? raw, type);
      if (!e) return;
      if (e.id && events.some(x => x.id === e.id && x.type === e.type)) return;
      events.push(e); if (events.length > 300) events.splice(0, events.length - 300);
      paintAll();
      if (['prompt', 'stop', 'session-start', 'session-end'].includes(e.type)) refreshQueue();
    }
    try {
      es = new EventSource('/api/session/events');
      es.onmessage = m => take(m);
      for (const t of EVENT_TYPES) es.addEventListener(t, m => take(m, t));
    } catch {}
    paintAll(); paintQueue();
    await refreshQueue();
    timer = setInterval(refreshQueue, 3000);
    return () => { es?.close(); clearInterval(timer); offSel(); };
  },
};
