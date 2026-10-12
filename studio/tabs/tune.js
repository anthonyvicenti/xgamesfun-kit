// Settings: every number, switch, choice and colour a game exposes as a value slot, as controls you read at a glance.
// One card per slot group (an icon, its name; a card folds). A number is a slider with its ends in words, its value
// in words with its unit, a tick at the game's default and a "Reset" once moved; how else it is drawn follows its type
// and unit only (studio/lib/tune.js visualOf): a count as dots, degrees as a dial, a 0–1 fraction as a fill bar, a
// switch as a toggle, a choice as pills, a colour as swatches. Slot ids sit behind each row's "Details".
// Every change writes the slot's config file and the dev server reloads the preview, so edits are staged and one
// "Apply" writes them all at once (one reload). The advanced tier is under each card's "More settings".
import {
  APPLIES, cardsOf, defaultOf, endLabels, formatValue, fractionOf, fromSlider, isColourText, optionsOf, pendingChanges,
  sameValue, sliderRange, snapValue, tunables, unitOf, visualOf,
} from '../lib/tune.js';
import { el, swatchRow, useStyles } from '../lib/editors/ui.js';

const ICONS = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M9 17h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  move: '<circle cx="12" cy="12" r="2"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
};
const icon = (name, cls = 'ico') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) s.setAttribute(k, v);
  s.innerHTML = ICONS[name] ?? ICONS.sliders;
  return s;
};
// the empty state's picture: three sliders waiting for something to tune
const EMPTY_ART = `<svg viewBox="0 0 160 96" class="set-empty-art" aria-hidden="true" fill="none" stroke-linecap="round">
  <rect x="6" y="6" width="148" height="84" rx="12" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="4 5"/>
  <path d="M28 30h104M28 50h104M28 70h104" stroke="currentColor" stroke-opacity=".35" stroke-width="5"/>
  <path d="M28 30h40M28 50h72M28 70h22" stroke="var(--lime)" stroke-width="5"/>
  <circle cx="68" cy="30" r="8" fill="var(--surface)" stroke="var(--lime)" stroke-width="3"/>
  <circle cx="100" cy="50" r="8" fill="var(--surface)" stroke="var(--lime)" stroke-width="3"/>
  <circle cx="50" cy="70" r="8" fill="var(--surface)" stroke="var(--lime)" stroke-width="3"/>
  <path d="M132 18v8M128 22h8" stroke="var(--lav)" stroke-width="2.5"/></svg>`;

function useOwnStyles() {
  useStyles();   // the editors' shared pieces (the swatch row)
  if (!document.querySelector('link[data-settings]')) document.head.append(el('link', { rel: 'stylesheet', href: '/studio/tabs/tune.css', 'data-settings': '1' }));
}
const canPaint = v => isColourText(v) || (typeof v === 'string' && /^[a-z]+$/i.test(v) && typeof CSS !== 'undefined' && CSS.supports?.('color', v));

export default {
  id: 'tune',
  label: 'Settings',
  group: 'Build',
  order: 12,
  async mount(root, ctx) {
    useOwnStyles();
    root.classList.add('settings');
    let slots = [], groups = [], staged = {}, busy = false;
    const opened = {};                 // each setting's value when the tool first saw it: its default tick and its Reset
    const folded = new Map();          // a card's open/closed, kept across redraws
    const rows = new Map();            // id → { sync() } for the settings drawn now
    const intro = el('p', { className: 'intro' }, 'How the game plays and looks. Move anything, then Apply: the preview reloads once with all of it.');
    const body = el('div', { className: 'set-cards' });
    const status = el('span', { className: 'set-status', 'aria-live': 'polite' });
    const undo = el('button', { type: 'button', className: 'ghost', disabled: true }, 'Undo my edits');
    const apply = el('button', { type: 'button', className: 'set-apply', disabled: true }, 'Apply');
    const dock = el('div', { className: 'set-dock' }, status, el('div', { className: 'set-dock-buttons' }, undo, apply));
    root.append(intro, body, dock);

    const shown = s => (s.id in staged ? staged[s.id] : s.value);
    function refreshButtons() {
      const n = pendingChanges(slots, staged).length;
      apply.disabled = undo.disabled = !n || busy;
      apply.textContent = busy ? 'Applying…' : n ? `Apply ${n} change${n === 1 ? '' : 's'}` : 'Apply';
      status.textContent = busy ? 'Saving: the preview reloads in a moment' : n ? `${n} change${n === 1 ? '' : 's'} waiting` : 'No changes yet';
      status.dataset.state = n ? 'waiting' : 'clean';
      dock.dataset.state = n ? 'waiting' : 'clean';
      for (const c of body.querySelectorAll('.set-card')) {
        const k = [...c.querySelectorAll('.set[data-changed]')].length;
        const chip = c.querySelector('.set-card-changed');
        if (chip) { chip.hidden = !k; chip.textContent = `${k} changed`; }
      }
    }
    function stage(s, value) {
      if (sameValue(s.value, value)) delete staged[s.id]; else staged[s.id] = value;
      rows.get(s.id)?.sync();
      refreshButtons();
    }

    // ---- one setting
    function row(s) {
      const { name } = unitOf(s);
      const range = sliderRange(s, opened[s.id]);
      const visual = visualOf(s, range);
      const def = defaultOf(s, opened[s.id]);
      const value = el('span', { className: 'set-value' });
      const reset = el('button', { type: 'button', className: 'ghost small set-reset', title: `Back to ${formatValue(s, def)}` }, icon('reset', 'ico sm'), 'Reset');
      reset.addEventListener('click', () => stage(s, def));
      const head = el('div', { className: 'set-head' },
        el('span', { className: 'set-name' }, name),
        s.applies === 'live' ? el('span', { className: 'set-live', title: APPLIES.live }, 'Live') : null,
        reset, value);
      const wrap = el('div', { className: 'set', 'data-visual': visual, 'data-type': s.type }, head);
      const syncs = [];
      const sync = () => {
        const v = shown(s);
        value.textContent = formatValue(s, v);
        wrap.toggleAttribute('data-changed', s.id in staged);
        reset.hidden = sameValue(v, def);
        for (const f of syncs) f(v);
      };

      if (visual === 'switch') {
        const sw = el('button', { type: 'button', role: 'switch', className: 'set-switch', 'aria-label': name }, el('span', { className: 'knob' }));
        sw.addEventListener('click', () => stage(s, !(shown(s) === true || shown(s) === 'true')));
        syncs.push(v => sw.setAttribute('aria-checked', String(v === true || v === 'true')));
        head.insertBefore(sw, value); value.classList.add('sr-only');
      } else if (visual === 'pills') {
        const opts = optionsOf(s), painted = opts.length && opts.every(o => canPaint(String(o.value)));
        const pills = el('div', { className: 'set-pills', role: 'radiogroup', 'aria-label': name });
        for (const o of opts) {
          const b = el('button', { type: 'button', role: 'radio', className: 'set-pill', title: o.label },
            painted ? el('span', { className: 'pill-swatch', style: { background: String(o.value) } }) : null, el('span', {}, o.label));
          b.addEventListener('click', () => stage(s, o.value));
          syncs.push(v => b.setAttribute('aria-checked', String(sameValue(o.value, v))));
          pills.append(b);
        }
        wrap.append(pills);
      } else if (visual === 'swatches') {
        const chip = el('button', { type: 'button', className: 'set-colour', 'aria-expanded': 'false', 'aria-label': `${name}: change colour` }, el('span', { className: 'set-colour-dot' }), el('span', { className: 'set-colour-word' }, 'Change'));
        const tray = el('div', { className: 'set-tray', hidden: true });
        const drawTray = () => tray.replaceChildren(swatchRow(String(shown(s)).toLowerCase(), c => { stage(s, c.toLowerCase()); drawTray(); }, { label: name }));
        chip.addEventListener('click', () => { tray.hidden = !tray.hidden; chip.setAttribute('aria-expanded', String(!tray.hidden)); if (!tray.hidden) drawTray(); });
        syncs.push(v => { chip.querySelector('.set-colour-dot').style.background = String(v); if (!tray.hidden) drawTray(); });
        head.insertBefore(chip, value); value.classList.add('set-hex');
        wrap.append(tray);
      } else {
        // a number: the slider (every one), with a dial, dots or a fill bar as its type and unit say
        const sl = el('input', { type: 'range', min: range.min, max: range.max, step: range.step, 'aria-label': name, className: visual === 'fill' ? 'fill' : '' });
        sl.addEventListener('input', () => stage(s, fromSlider(s, range, sl.value)));
        const tick = el('span', { className: 'set-tick', title: `Default: ${formatValue(s, def)}` });
        tick.style.setProperty('--at', fractionOf(range, def));
        const ends = endLabels(s, range);
        const track = el('div', { className: 'set-track' }, sl, tick);
        syncs.push(v => {
          if (document.activeElement !== sl || Number(sl.value) !== Number(v)) sl.value = v;
          sl.style.setProperty('--p', fractionOf(range, v));
          sl.setAttribute('aria-valuetext', formatValue(s, v));
          tick.hidden = !(Number(def) >= range.min && Number(def) <= range.max);
        });
        const line = el('div', { className: 'set-line' });
        if (visual === 'dial') line.append(dial(s, range, name, syncs));
        line.append(el('div', { className: 'set-slide' }, track, el('div', { className: 'set-ends' }, el('span', {}, ends.min), el('span', {}, ends.max))));
        wrap.append(line);
        if (visual === 'dots') wrap.append(dots(s, range, name, syncs));
      }
      if (s.description) wrap.append(el('p', { className: 'set-desc' }, s.description));
      wrap.append(details(s, range));
      rows.set(s.id, { sync });
      sync();
      return wrap;
    }

    // a count: one dot per step of its range, filled up to the value; a dot sets it
    function dots(s, range, name, syncs) {
      const box = el('div', { className: 'set-dots', role: 'group', 'aria-label': `${name}: pick a number` });
      for (let i = range.min; i <= range.max; i++) {
        const d = el('button', { type: 'button', className: i === 0 ? 'set-dot zero' : 'set-dot', title: String(i), 'aria-label': String(i) });
        d.addEventListener('click', () => stage(s, i));
        syncs.push(v => { d.dataset.on = String(i > 0 && i <= Number(v)); d.setAttribute('aria-pressed', String(i === Number(v))); });
        box.append(d);
      }
      return box;
    }
    // degrees: a small dial whose needle points at the value; drag it round
    function dial(s, range, name, syncs) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('class', 'set-dial'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = '<circle cx="24" cy="24" r="20" class="face"/><path d="M4 24h40" class="flat"/><line x1="24" y1="24" x2="24" y2="6" class="needle"/><circle cx="24" cy="24" r="3" class="hub"/>';
      const needle = svg.querySelector('.needle');
      syncs.push(v => { const a = Number(v) * Math.PI / 180; needle.setAttribute('x2', String(24 + 18 * Math.cos(a))); needle.setAttribute('y2', String(24 - 18 * Math.sin(a))); });
      const at = e => {
        const r = svg.getBoundingClientRect();
        let deg = Math.atan2(-(e.clientY - r.top - r.height / 2), e.clientX - r.left - r.width / 2) * 180 / Math.PI;
        while (deg < range.min) deg += 360;
        while (deg > range.max) deg -= 360;
        stage(s, snapValue(s, Math.round(deg / range.step) * range.step, range));
      };
      svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); at(e); });
      svg.addEventListener('pointermove', e => { if (svg.hasPointerCapture(e.pointerId)) at(e); });
      return svg;
    }
    // for the curious and for an agent: the slot's id, where it lives, and an exact number box
    function details(s, range) {
      const kids = [el('div', {}, el('span', { className: 'muted' }, 'Slot '), el('code', {}, s.id))];
      if (s.file) kids.push(el('div', {}, el('span', { className: 'muted' }, 'In '), el('code', {}, `${s.file}${s.pointer ?? ''}`)));
      kids.push(el('div', { className: 'muted' }, APPLIES[s.applies]));
      if (range) {
        const num = el('input', { type: 'number', value: shown(s), step: s.type === 'integer' ? 1 : 'any', 'aria-label': `${unitOf(s).name}: exact value` });
        if (!range.soft.min) num.min = range.min;
        if (!range.soft.max) num.max = range.max;
        num.addEventListener('change', () => { if (num.value.trim() !== '') stage(s, snapValue(s, num.value, range)); });
        kids.push(el('label', { className: 'set-exact' }, 'Exact value ', num, unitOf(s).unit ? el('span', { className: 'muted' }, unitOf(s).unit === 'deg' ? '°' : unitOf(s).unit) : null));
      }
      return el('details', { className: 'set-details' }, el('summary', {}, 'Details'), el('div', { className: 'set-details-body' }, ...kids));
    }

    // ---- one card per slot group
    function card(c) {
      const key = c.id, open = folded.has(key) ? folded.get(key) : c.main.length > 0;
      const total = c.main.length || c.more.length;   // what the card shows open; its "More settings" says its own count
      const summary = el('summary', { className: 'set-card-head' },
        el('span', { className: 'set-card-icon' }, icon(c.icon)),
        el('span', { className: 'set-card-name' }, c.label),
        el('span', { className: 'set-card-changed', hidden: true }),
        el('span', { className: 'set-card-count', title: `${total} setting${total === 1 ? '' : 's'}${c.main.length && c.more.length ? `, ${c.more.length} more inside` : ''}` }, `${total}`),
        el('span', { className: 'set-card-fold', 'aria-hidden': 'true' }));
      const inner = el('div', { className: 'set-card-body' });
      const box = el('details', { className: 'set-card', open, 'data-group': c.id }, summary, inner);
      let drawn = false;
      const draw = () => {
        if (drawn) return; drawn = true;
        for (const s of c.main) inner.append(row(s));
        if (c.more.length) {
          // the advanced tier: drawn when opened (a game can have hundreds)
          const list = el('div', { className: 'set-more-list' });
          const more = el('details', { className: 'set-more', open: !c.main.length && folded.get(`${key}:more`) !== false }, el('summary', {}, c.main.length ? `More settings (${c.more.length})` : `Fine settings (${c.more.length})`), list);
          let moreDrawn = false;
          const drawMore = () => { if (moreDrawn || !more.open) return; moreDrawn = true; for (const s of c.more) list.append(row(s)); refreshButtons(); };
          more.addEventListener('toggle', () => { folded.set(`${key}:more`, more.open); drawMore(); });
          inner.append(more);
          drawMore();
        }
      };
      box.addEventListener('toggle', () => { folded.set(key, box.open); if (box.open) { draw(); refreshButtons(); } });
      if (open) draw();
      return box;
    }

    function emptyState() {
      const ask = el('button', { type: 'button' }, 'Ask my session to add settings');
      ask.addEventListener('click', () => {
        const compose = words => `Expose this game's main numbers, switches and choices as value slots (main tier, with a min, a max and a unit where one fits) so I can change them in the studio's Settings. ${words}`;
        if (ctx.chat?.ask) ctx.chat.ask({ label: 'Add settings', placeholder: 'What should be adjustable? e.g. "how fast players run, how long a round lasts"', compose, button: 'Ask my session' });
        else ctx.toast?.('Open the conversation on the left and ask your session to add settings.', 'info');
      });
      const box = el('div', { className: 'set-empty' }, el('div', { className: 'set-empty-pic' }), el('p', {}, 'This game has nothing to adjust here yet. Your session can add settings like speed, round length or colours.'), ask);
      box.querySelector('.set-empty-pic').innerHTML = EMPTY_ART;
      return box;
    }

    async function render() {
      try {
        const r = await ctx.api('game/slots?all=1');
        slots = r.slots; groups = r.groups ?? [];
        const list = tunables(slots, { all: true });
        for (const s of list) if (!(s.id in opened)) opened[s.id] = s.value;
        for (const id of Object.keys(staged)) if (!list.some(s => s.id === id)) delete staged[id];
        rows.clear();
        body.replaceChildren();
        dock.hidden = !list.length;
        intro.hidden = !list.length;
        if (!list.length) { body.append(emptyState()); refreshButtons(); return; }
        const cards = cardsOf(list, groups);
        const fine = cards.filter(c => !c.main.length);
        for (const c of cards.filter(c => c.main.length)) body.append(card(c));
        if (fine.length) body.append(el('h3', { className: 'set-fine-head' }, 'Fine-tuning'), ...fine.map(card));
        refreshButtons();
      } catch (e) { body.replaceChildren(el('p', { className: 'error-box' }, e.message)); }
    }
    apply.addEventListener('click', async () => {
      const changes = pendingChanges(slots, staged);
      if (!changes.length) return;
      busy = true; refreshButtons();
      let done = 0;
      try {
        for (const c of changes) { await ctx.api('game/slots/value', c); done++; delete staged[c.id]; }
        ctx.toast(`Applied ${done}: the preview reloads`, 'ok');
      } catch (e) { ctx.toast(done ? `Applied ${done}, then: ${e.message}` : e.message, 'error'); }
      busy = false; await render();
    });
    undo.addEventListener('click', () => { staged = {}; for (const r of rows.values()) r.sync(); refreshButtons(); });
    await render();
    let t = null;
    return ctx.on('game', ({ files = [] }) => {
      if (files.length && files.every(f => f.startsWith('evidence/'))) return;
      clearTimeout(t); t = setTimeout(() => { if (!Object.keys(staged).length && !busy) render(); }, 250);
    });
  },
};
