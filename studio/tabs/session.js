// Session: what your own coding-agent session is doing, and a box to ask it for changes. The page never talks to a model:
// requests wait in a queue the session collects (gamesfun_requests), and permission cards answer the session's own prompt.
import { TERMINAL_NOTE, connection, describeEvent, modeNote, readQueue } from '../lib/session.js';
import { openEvents, sessionApi } from '../lib/session-client.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) (k in e && k !== 'list') ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.filter(k => k != null));
  return e;
};
const clock = at => { const d = at ? new Date(at) : null; return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''; };
const call = sessionApi;

export default {
  id: 'session',
  label: 'Session',
  order: 1,
  async mount(root, ctx) {
    const events = [], answered = new Set(), removed = new Set();
    let queueRaw = null, timer = null, closeEvents = null;

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
      const r = await call('request', { text, ...(selection ? { selection } : {}) });
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
      const list = readQueue(queueRaw, removed).requests;
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
            save.addEventListener('click', async () => { try { await call(`request/${encodeURIComponent(r.id)}`, { text: ta.value.trim() }, 'PATCH'); await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } });
            cancel.addEventListener('click', paintQueue);
            text.replaceWith(ta); acts.replaceChildren(save, cancel); ta.focus();
          });
          acts.append(edit);
        }
        if (r.words.editable || r.words.again) {
          // only a waiting request can be removed on the bridge (409 otherwise); a dropped one is just hidden here
          const rm = el('button', { type: 'button', className: 'ghost' }, 'Remove');
          rm.addEventListener('click', async () => {
            removed.add(r.id);
            if (!r.words.editable) { paintQueue(); return; }
            try { await call(`request/${encodeURIComponent(r.id)}`, undefined, 'DELETE'); await refreshQueue(); } catch (e) { removed.delete(r.id); ctx.toast(e.message, 'error'); }
          });
          acts.append(rm);
        }
        if (r.words.again) {
          const again = el('button', { type: 'button' }, 'Send again');
          again.addEventListener('click', async () => { try { await submit(r.text, r.selection); removed.add(r.id); await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } });
          acts.prepend(again);
        }
        row.append(acts);
        queue.append(row);
      }
    }

    function paintPerms() {
      perms.replaceChildren();
      for (const p of readQueue(queueRaw).permissions.filter(x => !answered.has(x.id))) {
        const decide = async decision => {
          answered.add(p.id);
          try { await call(`permission/${encodeURIComponent(p.id)}`, { decision }); ctx.toast(decision === 'allow' ? 'Allowed' : 'Denied', 'ok'); }
          catch (e) { answered.delete(p.id); ctx.toast(e.message, 'error'); }
          await refreshQueue();
        };
        const allow = el('button', { type: 'button' }, 'Allow'), deny = el('button', { type: 'button', className: 'ghost' }, 'Deny');
        allow.addEventListener('click', () => decide('allow')); deny.addEventListener('click', () => decide('deny'));
        perms.append(el('div', { className: 'perm', role: 'group', 'aria-label': 'Permission request' },
          el('strong', {}, `Your session asks to use ${p.tool ?? 'a tool'}`),
          p.line ? el('pre', { className: 'log' }, p.line) : null,
          el('div', { className: 'toolbar' }, allow, deny),
          el('p', { className: 'muted small' }, TERMINAL_NOTE)));
      }
    }

    function paintBanner() {
      const c = connection(readQueue(queueRaw));
      const words = { listening: 'Your session is listening', working: 'Your session is working', idle: 'Your session is idle', none: 'No session connected yet' }[c.state];
      banner.dataset.state = c.state;
      banner.replaceChildren(el('span', { className: `dot ${c.state === 'idle' ? 'warn' : c.state === 'none' ? 'wait' : 'ok'}` }), el('strong', {}, words),
        el('div', { className: `small${c.state === 'idle' ? '' : ' muted'}` }, c.hint),
        ...(c.mode ? [el('div', { className: 'small muted' }, modeNote(c.mode))] : []),
        ...(c.guard ? [el('div', { className: 'small' }, `The build is waiting for you${c.guard.why ? `: ${c.guard.why}` : ''}`)] : []));
    }

    function paintLine() {
      line.replaceChildren(...events.map(e => [e, describeEvent(e)]).filter(([, w]) => w).slice(-40).reverse()
        .map(([e, w]) => el('li', { 'data-type': e.kind }, el('span', { className: 'time mono' }, clock(e.at)), ' ', w)));
      if (!line.children.length) line.append(el('li', { className: 'muted' }, 'Nothing yet.'));
    }
    const paintAll = () => { paintBanner(); paintPerms(); paintLine(); };

    async function refreshQueue() {
      try { queueRaw = await call('queue'); } catch (e) { queueRaw = null; }
      paintQueue(); paintBanner(); paintPerms();
    }

    // ---- the event stream ----
    function take(e) {
      if (e.seq != null && events.some(x => x.seq === e.seq)) return;
      events.push(e); if (events.length > 300) events.splice(0, events.length - 300);
      paintLine();
      if (e.kind !== 'tool-start' && e.kind !== 'tool-end' && e.kind !== 'hello') refreshQueue();
    }
    closeEvents = openEvents(take, () => {}, () => { events.length = 0; answered.clear(); removed.clear(); queueRaw = null; paintLine(); });
    paintAll(); paintQueue();
    await refreshQueue();
    timer = setInterval(refreshQueue, 3000);
    return () => { closeEvents?.(); clearInterval(timer); offSel(); };
  },
};
