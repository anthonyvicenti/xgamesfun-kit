// The conversation: the left half of the studio. One thread with the person's own agent session: what they asked, what
// their session did, where the build loop is (the pitch's concepts and questions, the steps, verify's verdicts, the
// play-tester's notes, the delivery), the session's permission questions, and ONE box to ask for anything. The editors'
// "Ask my session" boxes are this box (ctx.chat.ask): a tool on the right hands it a context, the person types here.
// The page never talks to a model: a request waits in the bridge's queue until the session collects it
// (bridge/CONTRACT.md), exactly as the Session tab's box did. It reads:
//   /api/session/queue and the event stream   requests, permissions, sessions, what the session did (lib/session.js)
//   /api/build/state                           the loop's state, the newest verdict, roll-back points, the idea and
//                                              the concepts (server/routes/build.mjs)
import { NONE_HINT, RELOAD_HINT, TERMINAL_NOTE, connection, describeEvent, modeNote, readQueue } from './lib/session.js';
import { openEvents, sessionApi } from './lib/session-client.js';
import { loopView } from './lib/loop-state.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    (k in e && k !== 'list' && !k.startsWith('aria-') && !k.startsWith('data-')) ? (e[k] = v) : e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat().filter(k => k != null && k !== false));
  return e;
};
const clock = at => { const d = at ? new Date(at) : null; return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };
const when = at => { const t = typeof at === 'number' ? at : Date.parse(at ?? ''); return Number.isFinite(t) ? t : 0; };

/** A request carries the person's words, then the line for their session after this mark: the thread shows the words. */
export const MARK = '\n\n---\n';
export const wordsOf = text => String(text ?? '').split(MARK)[0];
export const compose = (words, forSession) => (forSession ? `${words}${MARK}${forSession}` : words);

/** What the session is told with a new idea from the start page: the build loop, on the folder the studio opened. */
export function ideaRequest(idea, folder) {
  return compose(idea, `New game from the studio's start page. Make it with the build loop in ${folder}: call gamesfun_step_pitch {"game": "${folder}", "idea": <the words above>} and follow its rounds (concepts through gamesfun_step_spec). The studio page shows the person each step, your concepts and questions, and the game once it is made.`);
}
/** The person picked a concept (and answered the questions): the way back into a build that waits on them. */
export function choiceRequest(card, answers, folder) {
  const said = answers.map(a => `${a.question} ${a.answer}`).join(' ');
  return compose(`Let's make "${card.title}".${said ? ` ${said}` : ''}`,
    `The person chose card "${card.id}" of your concepts for ${folder}${answers.length ? ` and answered: ${answers.map(a => `${a.id} = ${a.option}`).join(', ')}` : ''}. The build waits on this answer: call gamesfun_step_pitch {"game": "${folder}", "idea": <the words above>}, write the locked spec from that card, then gamesfun_step_spec and gamesfun_step_create.`);
}

// The stages a person follows, and which loop steps belong to each.
export const STAGES = [
  { id: 'pitch', label: 'Pitch' }, { id: 'spec', label: 'Spec' }, { id: 'create', label: 'Create' }, { id: 'build', label: 'Build' },
  { id: 'verify', label: 'Verify' }, { id: 'playtest', label: 'Play-test' }, { id: 'deliver', label: 'Deliver' },
];
/** Where a loop state stands among STAGES: { index, waiting, done } (index -1: nothing has started). */
export function stageOf(loop, { made = false, pitch = null } = {}) {
  if (!loop) return { index: -1, waiting: false, done: made };          // no build loop here (an example, a game made by hand)
  const talk = loop.kind === 'pitch' || loop.kind === 'refine';
  if (talk) {
    if (loop.status === 'waiting-on-question') return { index: 0, waiting: true, done: false };
    if (loop.outcome === 'locked' || (loop.step === 'done' && loop.status === 'building')) return { index: 2, waiting: false, done: false };
    return { index: loop.kind === 'refine' || pitch ? 1 : 0, waiting: false, done: false };
  }
  const by = { create: 2, agent: 3, fix: 3, repair: 3, verify: 4, playtest: 5, deliver: 6, done: 6 };
  const index = by[loop.step] ?? 3;
  return { index, waiting: loop.status === 'waiting-on-question', done: loop.status === 'delivered' };
}

export function mountChat(root, ctx) {
  const events = [], answered = new Set(), removed = new Set();
  let queueRaw = null, build = null, setup = null, context = null, lastKey = '';

  // ---- the parts ----
  const status = el('div', { className: 'chat-status', role: 'status', 'aria-live': 'polite' });
  const head = el('div', { className: 'chat-head' }, el('h2', {}, 'Conversation'), status);
  const feed = el('div', { className: 'chat-feed', 'aria-label': 'The conversation with your session' });
  const live = el('div', { className: 'chat-live' });
  const scroller = el('div', { className: 'chat-scroll' }, feed, live);
  const ctxChip = el('div', { className: 'chat-context', hidden: true });
  const selChip = el('span', { className: 'chip', hidden: true });
  const box = el('textarea', { id: 'chat-input', className: 'ask', rows: 3, maxLength: 4000, placeholder: 'Ask for a change: "make the pillows bigger", "add a second arena"…', 'aria-label': 'Ask your session' });
  const send = el('button', { id: 'chat-send', type: 'button' }, 'Send');
  const state = el('div', { className: 'ask-state muted small', 'aria-live': 'polite' });
  const foot = el('div', { className: 'chat-foot muted small' }, 'Your session picks this up when it next waits for you. Nothing is sent to a model from this page.');
  const input = el('div', { className: 'chat-input' }, ctxChip, selChip, box, el('div', { className: 'chat-send-row' }, state, send), foot);
  root.replaceChildren(head, scroller, input);

  const folder = () => (ctx.project()?.name ? `games/${ctx.project().name}` : null);

  // ---- the selection (something picked in the game or a slot) travels with the next message ----
  function paintSel(sel) {
    selChip.hidden = !sel;
    selChip.replaceChildren();
    if (!sel) return;
    selChip.append(el('span', {}, `About: ${sel.label}`), el('button', { type: 'button', className: 'chip-x', title: 'Do not send the selection', 'aria-label': `Remove selection ${sel.label}`, on: { click: () => ctx.selection.set(null) } }, '×'));
  }
  const offSel = ctx.selection.onChange(paintSel);
  paintSel(ctx.selection.get());

  // ---- a tool's context (an editor's "Ask my session"): its label, its placeholder, how it words the request ----
  function setContext(c) {
    context = c;
    ctxChip.hidden = !c;
    ctxChip.replaceChildren();
    box.placeholder = c?.placeholder || 'Ask for a change: "make the pillows bigger", "add a second arena"…';
    send.textContent = c?.button || 'Send';
    if (!c) return;
    ctxChip.append(el('span', { className: 'chat-context-label' }, c.label), el('button', { type: 'button', className: 'chip-x', title: 'Ask about the whole game instead', 'aria-label': `Stop asking about ${c.label}`, on: { click: () => setContext(null) } }, '×'));
  }

  async function submit(text, { selection = ctx.selection.get(), onSent = null } = {}) {
    const r = await sessionApi('request', { text, ...(selection ? { selection } : {}) });
    state.textContent = r.session ? 'Sent: your session has it.' : 'Waiting for your agent session: it gets this as soon as one is connected (see above).';
    state.dataset.state = 'sent';
    onSent?.(r);
    await refreshQueue();
    return r;
  }
  async function onSend() {
    const words = box.value.trim();
    if (!words) { box.focus(); return; }
    send.disabled = true;
    try {
      const c = context, sel = c?.selection ? c.selection() : ctx.selection.get();
      const forSession = c ? c.compose(words) : '';           // a plain message goes as typed (the bridge knows the open game)
      await submit(compose(words, forSession), { selection: sel, onSent: c?.onSent });
      box.value = ''; ctx.selection.set(null); setContext(null);
    } catch (e) { state.textContent = `Not sent: ${e.message}`; state.dataset.state = 'error'; }
    finally { send.disabled = false; }
  }
  send.addEventListener('click', onSend);
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); } });

  // ---- the thread ----
  const bubble = (who, kids, extra = {}) => el('div', { className: `msg ${who}`, ...extra }, ...kids);
  const line = (text, at, extra = {}) => el('div', { className: 'msg-line', ...extra }, el('span', { className: 'time' }, clock(at)), ' ', text);
  function requestView(r) {
    const acts = el('div', { className: 'req-acts' });
    const words = el('div', { className: 'req-text' }, wordsOf(r.text));
    if (r.words.editable) {
      // a waiting request can still be changed (only the person's words; the line for the session stays)
      acts.append(el('button', { type: 'button', className: 'ghost small', on: { click: () => {
        const rest = r.text.slice(wordsOf(r.text).length);
        const ta = el('textarea', { className: 'ask', rows: 2, value: wordsOf(r.text), 'aria-label': 'Edit your request' });
        const save = el('button', { type: 'button', className: 'small', on: { click: async () => { try { await sessionApi(`request/${encodeURIComponent(r.id)}`, { text: ta.value.trim() + rest }, 'PATCH'); lastKey = ''; await refreshQueue(); } catch (e) { ctx.toast(e.message, 'error'); } } } }, 'Save');
        const cancel = el('button', { type: 'button', className: 'ghost small', on: { click: () => { lastKey = ''; paint(); } } }, 'Cancel');
        words.replaceWith(ta); acts.replaceChildren(save, cancel); ta.focus();
      } } }, 'Edit'));
    }
    if (r.words.editable || r.words.again) {
      // only a waiting request can be removed on the bridge (409 otherwise); a dropped one is just hidden here
      acts.append(el('button', { type: 'button', className: 'ghost small', on: { click: async () => {
        removed.add(r.id);
        if (!r.words.editable) { lastKey = ''; paint(); return; }
        try { await sessionApi(`request/${encodeURIComponent(r.id)}`, undefined, 'DELETE'); } catch (e) { removed.delete(r.id); ctx.toast(e.message, 'error'); }
        refreshQueue();
      } } }, 'Remove'));
    }
    if (r.words.again) acts.append(el('button', { type: 'button', className: 'small', on: { click: async () => { try { await submit(r.text, { selection: r.selection }); removed.add(r.id); } catch (e) { ctx.toast(e.message, 'error'); } } } }, 'Send again'));
    const kids = [
      words,
      r.selection?.label || r.selection?.id ? el('span', { className: 'chip small' }, `About: ${r.selection.label ?? r.selection.id}`) : null,
      el('div', { className: 'req-state' }, el('span', { className: `dot ${r.words.tone}` }), r.words.label, el('span', { className: 'time' }, clock(r.created))),
      acts.children.length ? acts : null,
    ];
    const out = [{ at: when(r.created), node: bubble('me req', kids, { 'data-request': r.id, 'data-state': r.state }) }];
    if (r.note && r.state === 'done') out.push({ at: when(r.done) || when(r.created) + 1, node: bubble('them', [el('div', { className: 'req-text' }, String(r.note))]) });
    return out;
  }

  function verdictView(v) {
    if (!v) return null;
    return bubble('them card', [
      el('div', { className: 'msg-title' }, el('span', { className: `st ${v.pass ? 'pass' : 'fail'}` }, v.pass ? 'PASS' : 'FAIL'), ` Verify ${String(v.run ?? '').replace('verify-', '')}: ${v.passed}/${v.ran} checks${v.quick ? ' · quick' : ''}${v.seconds ? ` · ${v.seconds} s` : ''}`),
      ...(v.failed ?? []).slice(0, 6).map(f => el('div', { className: 'fail-card' }, el('strong', {}, `${f.n} ${f.name}`), f.detail ? el('div', { className: 'detail small' }, f.detail) : null)),
    ], { 'data-part': 'verdict' });
  }

  function pitchView(p, v) {
    if (!p?.cards?.length) return null;
    // the pick is made: the concepts fold into one line of the thread (open it to read them again)
    if (v?.status !== 'waiting-on-question') {
      return bubble('them', [el('details', { className: 'concepts-done' },
        el('summary', {}, `Pitched ${p.cards.length} concept${p.cards.length === 1 ? '' : 's'}: ${p.cards.map(c => c.title).join(' · ')}`),
        ...p.cards.map(c => el('p', { className: 'small' }, el('b', {}, `${c.title}. `), c.hook)))], { 'data-part': 'pitch' });
    }
    const answers = new Map((p.questions ?? []).map(q => [q.id, q.default]));
    const qs = (p.questions ?? []).map(q => el('div', { className: 'question' },
      el('div', { className: 'question-text' }, q.text),
      el('div', { className: 'seg', role: 'group', 'aria-label': q.text }, ...q.options.map(o => el('button', { type: 'button', className: 'ghost small', 'aria-pressed': String(o.id === q.default), 'data-option': o.id, on: { click: e => {
        answers.set(q.id, o.id);
        for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b.dataset.option === o.id));
      } } }, o.label)))));
    const waiting = v?.status === 'waiting-on-question';
    const cards = p.cards.map(c => el('article', { className: 'concept', 'data-card': c.id },
      el('h3', {}, c.title), el('p', { className: 'concept-hook' }, c.hook),
      el('p', { className: 'concept-how' }, c.howItPlays),
      el('p', { className: 'muted small' }, c.players),
      c.v1?.has?.length ? el('div', { className: 'concept-v1' }, el('b', {}, 'In v1: '), c.v1.has.join(' · ')) : null,
      c.v1?.notYet?.length ? el('div', { className: 'concept-v1 muted' }, el('b', {}, 'Not yet: '), c.v1.notYet.join(' · ')) : null,
      waiting ? el('button', { type: 'button', className: 'concept-go', on: { click: async e => {
        e.currentTarget.disabled = true;
        const list = (p.questions ?? []).map(q => { const o = q.options.find(x => x.id === answers.get(q.id)) ?? q.options[0]; return { id: q.id, question: q.text, option: o?.id, answer: o?.label }; });
        try { await submit(choiceRequest(c, list, folder()), { selection: null }); ctx.toast(`Sent: make "${c.title}"`, 'ok'); }
        catch (err) { ctx.toast(err.message, 'error'); e.currentTarget.disabled = false; }
      } } }, 'Make this one') : null));
    return bubble('them card wide', [
      el('div', { className: 'msg-title' }, waiting ? 'Your session pitched these. Pick one:' : 'The concepts'),
      p.reply ? el('p', { className: 'small' }, p.reply) : null,
      el('div', { className: 'concepts' }, ...cards),
      qs.length && waiting ? el('div', { className: 'questions' }, el('div', { className: 'msg-title small' }, 'And a few choices (the defaults are picked):'), ...qs) : null,
    ], { 'data-part': 'pitch' });
  }

  function progressView(v, made) {
    const s = stageOf(build?.loop ?? null, { made, pitch: build?.pitch });
    if (s.index < 0) return null;
    return el('ol', { className: 'stages', 'aria-label': 'Where the build is' }, ...STAGES.map((st, i) => el('li', {
      className: i < s.index || (s.done && i === s.index) ? 'done' : i === s.index ? (s.waiting ? 'now waiting' : 'now') : '',
      'aria-current': i === s.index ? 'step' : null,
    }, st.label)));
  }

  function permissionViews() {
    return readQueue(queueRaw).permissions.filter(x => !answered.has(x.id)).map(p => {
      const decide = async decision => {
        answered.add(p.id);
        try { await sessionApi(`permission/${encodeURIComponent(p.id)}`, { decision }); ctx.toast(decision === 'allow' ? 'Allowed' : 'Denied', 'ok'); }
        catch (e) { answered.delete(p.id); ctx.toast(e.message, 'error'); }
        refreshQueue();
      };
      return el('div', { className: 'perm', role: 'group', 'aria-label': 'Permission request' },
        el('strong', {}, `Your session asks to use ${p.tool ?? 'a tool'}`),
        p.line ? el('pre', { className: 'log' }, p.line) : null,
        el('div', { className: 'toolbar' }, el('button', { type: 'button', on: { click: () => decide('allow') } }, 'Allow'), el('button', { type: 'button', className: 'ghost', on: { click: () => decide('deny') } }, 'Deny')),
        el('p', { className: 'muted small' }, TERMINAL_NOTE));
    });
  }

  function paintStatus() {
    const c = connection(readQueue(queueRaw));
    const words = { listening: 'Your session is listening', working: 'Your session is working', idle: 'Your session is idle', none: 'No session connected' }[c.state];
    const tone = c.state === 'idle' ? 'warn' : c.state === 'none' ? 'wait' : 'ok';
    status.dataset.state = c.state;
    status.replaceChildren(el('span', { className: `dot ${tone}` }), el('span', {}, words));
    status.title = c.hint;
    return c;
  }
  /** The words for "no session yet": only the step that is left (connect has run here: reload the plugins). */
  function noneHint() {
    if (setup?.connected && setup.plugin) return RELOAD_HINT;
    if (setup?.connected) return 'Your agent has the kit\'s tools. Start a new session of it in the kit folder and say hi: it appears here.';
    return NONE_HINT;
  }

  function paint() {
    const c = paintStatus();
    const q = readQueue(queueRaw, removed);
    const v = loopView(build?.loop ?? null, build?.verdict ?? null, build?.said ?? null);
    const made = !!build?.made;
    const items = [];
    if (build?.idea) items.push({ at: 0, node: bubble('me idea', [el('div', { className: 'req-text' }, wordsOf(build.idea))], { 'data-part': 'idea' }) });
    const ideaShown = build?.idea ? wordsOf(build.idea).trim() : null;
    for (const r of q.requests) { if (ideaShown && wordsOf(r.text).trim() === ideaShown) continue; items.push(...requestView(r)); }
    for (const e of events) { const w = describeEvent(e); if (w) items.push({ at: when(e.at), node: line(w, e.at, { 'data-type': e.kind }) }); }
    if (v.present) for (const h of v.history) items.push({ at: when(h.at), node: line(`${h.step} → ${h.next}${h.why ? `: ${h.why}` : ''}`, h.at, { className: 'msg-line step' }) });
    for (const cp of build?.checkpoints ?? []) items.push({ at: when(cp.at), node: line(el('span', {}, cp.label ?? `Round ${cp.round ?? cp.id}`, ' ', el('button', { type: 'button', className: 'linkish', on: { click: () => rollback(cp) } }, 'Roll back to this')), cp.at, { className: 'msg-line checkpoint' }) });
    if (v.status !== 'waiting-on-question') { const folded = pitchView(build?.pitch, v); if (folded) items.push({ at: 1, node: folded }); }
    items.sort((a, b) => a.at - b.at);
    const key = JSON.stringify([q.requests.map(r => [r.id, r.state, r.note, r.text]), c.guard?.why ?? null, c.mode, events.length, build?.loop?.updated ?? build?.loop?.step, build?.loop?.status, (build?.checkpoints ?? []).length, build?.verdict?.run, !!build?.pitch, made, c.state, setup?.connected, removed.size, answered.size, q.permissions.length]);
    if (key === lastKey) return;
    lastKey = key;
    const stick = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40;

    feed.replaceChildren(...items.slice(-120).map(i => i.node));
    if (!items.length) {
      feed.append(el('div', { className: 'empty chat-empty' }, ctx.project()
        ? el('span', {}, 'Nothing here yet. Ask for a change below; your session\'s steps and answers show up here.')
        : el('span', {}, 'Describe a game to start.')));
    }

    // what is happening now, under the thread
    live.replaceChildren();
    if (c.state === 'none') live.append(el('div', { className: 'conn', 'data-state': 'none', 'data-part': 'connect' }, el('span', { className: 'dot wait' }), el('strong', {}, 'No session connected yet'), el('div', { className: 'small' }, noneHint())));
    else if (c.state === 'idle') live.append(el('div', { className: 'conn', 'data-state': 'idle' }, el('span', { className: 'dot warn' }), el('strong', {}, 'Your session is idle'), el('div', { className: 'small' }, c.hint)));
    if (c.guard) live.append(el('div', { className: 'conn', 'data-tone': 'warn' }, el('span', { className: 'dot warn' }, ''), el('strong', {}, `The build is waiting for you${c.guard.why ? `: ${c.guard.why}` : ''}`)));
    if (c.mode) live.append(el('p', { className: 'muted small' }, modeNote(c.mode)));
    if (build?.elsewhere) live.append(el('p', { className: 'error-box' }, `Your session is working on another game: ${build.elsewhere.name}. The studio shows ${ctx.project()?.name ?? 'this one'}; open that one from All games to follow it.`));
    const prog = progressView(v, made);
    if (prog) live.append(prog);
    if (v.present) {
      live.append(el('div', { className: 'conn', 'data-tone': v.status === 'failed' ? 'bad' : v.status === 'delivered' ? (v.issues ? 'warn' : 'ok') : v.status === 'waiting-on-question' ? 'warn' : 'go', 'data-part': 'loop' },
        el('span', { className: 'dot go' }), el('strong', {}, `${v.statusWords}: ${v.stepWords}`), v.why ? el('div', { className: 'small muted' }, v.why) : null));
      if (v.issues) live.append(el('p', { className: 'error-box', 'data-outcome': 'delivered-with-issues' }, v.issuesWords));
    }
    const pv = pitchView(build?.pitch, v);
    if (pv && v.status === 'waiting-on-question') live.append(pv);
    if (build?.verdict) live.append(verdictView(build.verdict));
    else if (v.present && v.verify) live.append(bubble('them card', [   // the loop's own verify run (its verdict is in the loop's folder)
      el('div', { className: 'msg-title' }, el('span', { className: `st ${v.verify.ok ? 'pass' : 'fail'}` }, v.verify.ok ? 'PASS' : 'FAIL'), ` Verify ${v.verify.n ?? ''}${v.verify.ok || v.verify.playable ? '' : ' · not playable yet'}`, el('span', { className: 'time' }, clock(v.verify.at))),
      ...v.failures.slice(0, 6).map(f => el('div', { className: 'fail-card' }, el('strong', {}, `${f.n} ${f.name}`), f.rule ? el('div', { className: 'small' }, el('b', {}, 'Rule: '), f.rule) : null, f.fix ? el('div', { className: 'small' }, el('b', {}, 'Fix: '), f.fix) : null, f.detail ? el('div', { className: 'detail small' }, f.detail) : null)),
    ], { 'data-part': 'verdict' }));
    if (v.present && v.playtest) live.append(bubble('them card', [el('div', { className: 'msg-title' }, el('span', { className: `st ${v.playtest.ok ? 'pass' : 'fail'}` }, String(v.playtest.verdict).toUpperCase()), ' The play-tester'), v.playtest.notes.length ? el('ul', { className: 'notes' }, ...v.playtest.notes.map(n => el('li', {}, n))) : null], { 'data-part': 'playtest' }));
    if (build?.said?.firstWords && !v.issues) live.append(bubble('them', [el('div', { className: 'req-text' }, build.said.firstWords)]));
    live.append(...permissionViews());
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  }

  async function rollback(cp) {
    if (!confirm(`Put the game back to ${cp.label ?? `round ${cp.round ?? cp.id}`}? Changes since then are lost.`)) return;
    try { await ctx.api('build/rollback', { id: String(cp.id) }); ctx.toast('Rolled back', 'ok'); refreshBuild(); } catch (e) { ctx.toast(e.message, 'error'); }
  }

  // ---- reading ----
  async function refreshQueue() { try { queueRaw = await sessionApi('queue'); } catch { queueRaw = null; } paint(); }
  async function refreshBuild() {
    try {
      const b = await ctx.api('build/state');
      build = b;
      if (b.made && ctx.project() && !ctx.project().made) ctx.onMade?.();   // the folder became a game: the page opens it
    } catch { build = null; }
    paint();
  }
  async function refreshSetup() { try { setup = await ctx.api('studio/setup'); } catch { setup = null; } paint(); }
  function take(e) {
    if (e.seq != null && events.some(x => x.seq === e.seq)) return;
    events.push(e); if (events.length > 300) events.splice(0, events.length - 300);
    paint();
    if (e.kind !== 'tool-start' && e.kind !== 'tool-end' && e.kind !== 'hello') refreshQueue();
    if (e.kind === 'tool-end' || e.kind === 'stop') refreshBuild();
  }
  const closeEvents = openEvents(take, () => {}, () => { events.length = 0; answered.clear(); removed.clear(); queueRaw = null; paint(); });
  refreshQueue(); refreshBuild(); refreshSetup();
  const t1 = setInterval(refreshQueue, 3000), t2 = setInterval(refreshBuild, 2000), t3 = setInterval(refreshSetup, 15000);
  const off = ctx.on('verify', refreshBuild);

  return {
    /** An editor's box, folded into this one: label, placeholder, compose(words) → the request, button, selection, onSent. */
    ask(c) { setContext(c); box.focus(); },
    /** Send words as they are (the start page's idea, a concept picked): → the bridge's answer. */
    send: (text, opts) => submit(text, opts),
    refresh: () => { lastKey = ''; refreshBuild(); refreshQueue(); },
    close() { closeEvents(); clearInterval(t1); clearInterval(t2); clearInterval(t3); off(); offSel(); },
  };
}
