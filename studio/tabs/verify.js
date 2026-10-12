// Health check: the checks every game must pass (gf-three's verify, run with real input in Chrome), as a scorecard a
// person reads at a glance: a ring (checks passed of run), a headline in words, the run's screenshots, the checks in a
// few plain categories with failures first (each with "Ask my session to fix it"), the run history as dots. The
// command line, check numbers and the raw log sit behind Details. The words and grouping: studio/tabs/verify/checks.js.
import { fixRequest, groupChecks, headline, historyChips, progress, shotCaption } from './verify/checks.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    (k in e && !k.startsWith('aria-') && !k.startsWith('data-')) ? (e[k] = v) : e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (inner, { size = 18, cls = 'ico', width = 1.8 } = {}) => {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, class: cls, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  s.innerHTML = inner;
  return s;
};
const ICON = {
  pass: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  fail: '<path d="M7 7l10 10M17 7 7 17"/>',
  skip: '<path d="M7 12h10"/>',
  play: '<polygon points="7 4 19 12 7 20 7 4"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  ask: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M9 10h6"/>',
};

function useStyles() {
  if (document.querySelector('link[data-health]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: '/studio/tabs/verify/verify.css', 'data-health': '1' }));
}

/** The ring: a share of a circle, with words in its middle. */
function ring(share, tone, big, small) {
  const r = 42, c = 2 * Math.PI * r, s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'hc-ring-svg'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<circle cx="50" cy="50" r="${r}" class="hc-ring-track"/><circle cx="50" cy="50" r="${r}" class="hc-ring-fill" stroke-dasharray="${(c * Math.max(0, Math.min(1, share))).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>`;
  return el('div', { className: 'hc-ring', 'data-tone': tone }, s, el('div', { className: 'hc-ring-words' }, el('b', {}, big), small ? el('small', {}, small) : null));
}

/** The empty state's picture: a game screen with a check mark on a clipboard beside it. */
const EMPTY_ART = `<svg viewBox="0 0 220 120" class="hc-empty-art" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <rect x="14" y="16" width="120" height="78" rx="8" class="a-screen"/><path d="M14 80 L48 54 L70 70 L96 46 L134 76" class="a-hill"/>
  <circle cx="108" cy="34" r="7" class="a-sun"/><path d="M60 102h28M74 94v8" class="a-line"/>
  <rect x="146" y="26" width="60" height="80" rx="8" class="a-card"/><rect x="164" y="20" width="24" height="10" rx="3" class="a-clip"/>
  <path d="M158 50l5 5 9-9M158 70l5 5 9-9M158 90l5 5 9-9" class="a-tick"/><path d="M180 51h16M180 71h16M180 91h12" class="a-line"/>
</svg>`;

export default {
  id: 'verify',
  label: 'Health check',
  group: 'Test',
  order: 20,
  async mount(root, ctx) {
    useStyles();
    root.classList.add('health');

    // ---- the parts that stay: the score, the buttons, the progress, the shots, the categories, Details ----
    const score = el('div', { className: 'hc-score', 'aria-live': 'polite' });
    const quick = el('button', { type: 'button', 'data-testid': 'health-quick', title: 'About 2 minutes' }, svg(ICON.play, { size: 14 }), 'Check my game');
    const full = el('button', { type: 'button', className: 'ghost', 'data-testid': 'health-full', title: 'About 5 minutes: also the overview pictures and speed' }, 'Full check');
    const time = el('span', { className: 'muted small hc-time' }, 'about 2 min');
    const actions = el('div', { className: 'toolbar hc-actions' }, quick, full, time);
    const bar = el('div', { className: 'hc-progress', hidden: true }, el('div', { className: 'hc-progress-track' }, el('div', { className: 'hc-progress-fill' })), el('div', { className: 'hc-progress-words muted small' }));
    const strip = el('section', { className: 'hc-shots', hidden: true });
    const cats = el('div', { className: 'hc-cats' });
    const cmd = el('code', {}, 'npx gamesfun verify --quick');
    const log = el('pre', { className: 'log', hidden: true });
    const raw = el('div', { className: 'hc-raw' });
    const details = el('details', { className: 'more hc-details' },
      el('summary', {}, 'Details for your agent'),
      el('p', { className: 'muted small' }, 'The same check your agent runs: ', cmd, '. Evidence is saved in the game folder under ', el('code', {}, 'evidence/'), '.'),
      raw, log);
    root.append(score, actions, bar, strip, cats, details);

    let state = { running: false, runs: [], log: [] }, selected = null, timer = null, tick = null, lastQuick = true;
    const verdicts = new Map();   // run → its verdict.json (the rule and the fix of a failing check)

    async function start(isQuick) {
      try {
        lastQuick = isQuick;
        await ctx.api('game/verify', { quick: isQuick });
        ctx.toast(isQuick ? 'Checking your game: about 2 minutes' : 'Full check started: about 5 minutes');
        selected = null; poll();
      } catch (e) { ctx.toast(e.message, 'error'); }
    }
    quick.addEventListener('click', () => start(true));
    full.addEventListener('click', () => start(false));

    async function verdictOf(run) {
      if (!run) return null;
      if (!verdicts.has(run)) verdicts.set(run, fetch(`/game/evidence/${encodeURIComponent(run)}/verdict.json`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null));
      return verdicts.get(run);
    }
    async function askFix(c, run) {
      const v = await verdictOf(run);
      const full = v?.checks?.find(x => x.n === c.n) ?? null;
      const label = `Fix: ${c.title}`;
      const compose = words => fixRequest(c, { run, rule: full?.rule ?? null, fix: full?.fix ?? null, words });
      if (ctx.chat?.ask) ctx.chat.ask({ label, text: 'Please fix this.', placeholder: 'Add what you noticed, then Send', button: 'Ask to fix', compose });
      else if (ctx.chat?.send) { await ctx.chat.send(compose('')); ctx.toast('Sent to your session'); }
      else ctx.toast('Open the conversation on the left to ask your session', 'error');
    }

    // ---- painting ----
    function paintScore() {
      const runs = state.runs, run = runs.find(r => r.run === selected) ?? runs[0] ?? null;
      const stopped = !state.running && state.finished && state.code !== 0 && state.code != null && state.started && (!runs[0] || new Date(runs[0].started ?? 0) < new Date(state.started));
      score.replaceChildren();
      score.dataset.state = state.running ? 'running' : run ? (run.pass ? 'good' : 'bad') : 'idle';
      if (state.running) {
        const p = progress({ log: state.log, started: state.started, quick: lastQuick, runs });
        score.append(ring(p.pct, 'run', `${Math.round(p.pct * 100)}%`, p.counted ? `${p.done} of ${p.total}` : null),
          el('div', { className: 'hc-head' }, el('h3', { className: 'hc-words' }, p.words), el('p', { className: 'hc-sub' }, p.sub),
            p.fails.length ? el('p', { className: 'hc-sub bad' }, `${p.fails.length} found so far: ${p.fails.map(f => f.title).join(', ')}`) : null));
        bar.hidden = false;
        bar.querySelector('.hc-progress-fill').style.width = `${Math.round(p.pct * 100)}%`;
        bar.querySelector('.hc-progress-words').textContent = p.last ? `Just checked: ${p.last}` : p.sub;
        return;
      }
      bar.hidden = true;
      const h = headline(run, { stopped });
      if (!run && !stopped) {
        score.append(el('div', { className: 'hc-empty' }, (() => { const d = el('div'); d.innerHTML = EMPTY_ART; return d.firstElementChild; })(),
          el('div', { className: 'hc-head' }, el('h3', { className: 'hc-words' }, h.words), el('p', { className: 'hc-sub' }, h.sub))));
        return;
      }
      const chips = historyChips(runs);
      score.append(
        ring(h.ran ? h.passed / h.ran : 0, h.tone, h.ran ? `${h.passed}/${h.ran}` : '!', h.ran ? 'passed' : null),
        el('div', { className: 'hc-head' },
          el('h3', { className: 'hc-words', 'data-tone': h.tone }, h.words),
          el('p', { className: 'hc-sub' }, h.sub, run && run !== runs[0] ? el('span', {}, ' (an earlier run)') : null),
          chips.length > 1 ? el('div', { className: 'hc-history', role: 'group', 'aria-label': 'Earlier checks, newest first' },
            el('span', { className: 'muted small' }, 'History'),
            chips.map(c => el('button', { type: 'button', className: 'hc-chip', 'data-tone': c.tone, title: c.title, 'aria-label': c.title, 'aria-pressed': String(c.run === (run?.run ?? null)),
              on: { click: () => { selected = c.run === runs[0]?.run ? null : c.run; paint(); } } }, el('i', {}), c.label))) : null));
    }

    function paintShots(run) {
      const shots = run?.shots ?? [];
      strip.replaceChildren();
      strip.hidden = !shots.length || state.running;
      if (strip.hidden) return;
      const big = el('figure', { className: 'hc-large', hidden: true });
      let at = -1;
      const show = i => {
        at = (i + shots.length) % shots.length;
        for (const [j, b] of [...row.children].entries()) b.setAttribute('aria-pressed', String(j === at));
        big.hidden = false;
        big.replaceChildren(
          el('img', { src: shots[at], alt: shotCaption(shots[at]), title: 'Click to close', on: { click: () => { big.hidden = true; for (const b of row.children) b.setAttribute('aria-pressed', 'false'); } } }),
          el('figcaption', {}, el('button', { type: 'button', className: 'icon ghost', 'aria-label': 'Previous picture', on: { click: () => show(at - 1) } }, svg(ICON.left)),
            el('span', {}, `${shotCaption(shots[at])} · ${at + 1} of ${shots.length}`),
            el('a', { href: shots[at], target: '_blank', rel: 'noopener', className: 'muted small' }, 'Full size ↗'),
            el('button', { type: 'button', className: 'icon ghost', 'aria-label': 'Next picture', on: { click: () => show(at + 1) } }, svg(ICON.right)),
            el('button', { type: 'button', className: 'icon ghost', 'aria-label': 'Close the picture', on: { click: () => { big.hidden = true; } } }, svg(ICON.close))));
        row.children[at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      };
      const row = el('div', { className: 'hc-strip', role: 'list' }, shots.map((s, i) =>
        el('button', { type: 'button', className: 'hc-shot', role: 'listitem', title: shotCaption(s), 'aria-label': `See ${shotCaption(s)}`, on: { click: () => show(i) } },
          el('img', { src: s, alt: '', loading: 'lazy' }))));
      strip.append(el('div', { className: 'hc-strip-head' }, el('span', {}, 'What the check saw'), el('span', { className: 'muted small' }, `${shots.length} pictures`)), big, row);
    }

    function paintCats(run) {
      cats.replaceChildren();
      if (!run || state.running) return;
      for (const g of groupChecks(run.checks)) {
        const dots = el('span', { className: 'hc-dots', 'aria-hidden': 'true' }, g.checks.map(c => el('i', { 'data-state': c.state })));
        const body = el('ul', { className: 'hc-list' }, g.checks.map(c => {
          if (c.state !== 'fail') return el('li', { className: 'hc-check', 'data-state': c.state }, el('span', { className: 'hc-st' }, svg(ICON[c.state], { size: 14, width: 2.4 })), el('span', { className: 'hc-title' }, c.title), c.state === 'skip' ? el('span', { className: 'muted small' }, 'skipped') : null);
          return el('li', { className: 'hc-check', 'data-state': 'fail', 'data-n': c.n },
            el('span', { className: 'hc-st' }, svg(ICON.fail, { size: 14, width: 2.4 })),
            el('div', { className: 'hc-fail' },
              el('span', { className: 'hc-title' }, c.title),
              el('p', { className: 'hc-means' }, c.fail),
              el('div', { className: 'hc-fix' },
                el('button', { type: 'button', className: 'ghost small', 'data-testid': 'health-fix', on: { click: () => askFix(c, run.run) } }, svg(ICON.ask, { size: 14 }), 'Ask my session to fix it'),
                c.detail ? el('details', { className: 'more hc-saw' }, el('summary', {}, 'What the check saw'), el('p', { className: 'small' }, c.detail), el('p', { className: 'muted small' }, `Check ${c.n}: ${c.name}`)) : null)));
        }));
        const card = el('details', { className: 'hc-cat', 'data-state': g.state, open: g.failed > 0 },
          el('summary', {}, el('span', { className: 'hc-cat-ico' }, svg(g.icon, { size: 18 })),
            el('span', { className: 'hc-cat-name' }, g.label),
            dots,
            el('span', { className: 'hc-cat-count' }, g.failed ? `${g.failed} to fix` : g.passed ? `${g.passed}/${g.passed + g.skipped}` : 'skipped')),
          body);
        cats.append(card);
      }
    }

    function paintDetails(run) {
      cmd.textContent = `npx gamesfun verify ${state.args?.length ? state.args.filter(a => a.startsWith('--')).join(' ') : '--quick'}`.trim();
      log.hidden = !state.log?.length;
      log.textContent = (state.log ?? []).join('\n');
      log.scrollTop = log.scrollHeight;
      raw.replaceChildren();
      if (!run) return;
      raw.append(el('p', { className: 'muted small' }, `${run.run}: ${run.pass ? 'PASS' : 'FAIL'} ${run.passed}/${run.ran}${run.skipped?.length ? ` (skipped ${run.skipped.join(', ')})` : ''}${run.quick ? ' · quick' : ''}${run.seconds ? ` · ${run.seconds} s` : ''}`),
        el('div', { className: 'hc-raw-list' }, (run.checks ?? []).map(c => {
          const st = c.ok === null ? 'skip' : c.ok ? 'pass' : 'fail';
          return el('div', { className: 'check' }, el('span', { className: `st ${st}` }, st.toUpperCase()), el('span', { className: 'mono' }, String(c.n)), el('div', {}, c.name, el('div', { className: 'detail' }, c.detail ?? '')));
        })));
    }

    function paint() {
      const run = state.runs.find(r => r.run === selected) ?? state.runs[0] ?? null;
      quick.disabled = full.disabled = !!state.running;
      time.textContent = state.running ? 'checking…' : 'about 2 min';
      paintScore();
      paintShots(run);
      paintCats(run);
      paintDetails(run);
    }

    async function poll() {
      clearTimeout(timer);
      try {
        const v = await ctx.api('game/verify');
        const was = state.running;
        state = { ...v, log: v.log ?? [], runs: v.runs ?? [] };
        if (v.running && v.args) lastQuick = v.args.includes('--quick');
        if (was && !v.running) selected = null;
        paint();
        if (v.running) timer = setTimeout(poll, 2000);
      } catch (e) { score.replaceChildren(el('p', { className: 'error-box' }, `Could not read the checks: ${e.message}`)); }
    }
    // while a run is going, the estimate moves every second between polls
    tick = setInterval(() => { if (state.running && !root.closest('[hidden]')) paintScore(); }, 1000);
    await poll();
    const off = ctx.on('verify', () => poll());
    return () => { off(); clearTimeout(timer); clearInterval(tick); };
  },
};

