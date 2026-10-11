// Items: the things players pick up, carry, swing or shoot, as cards. Each card is a picture, a name, what it does, and
// a few numbers as sliders with plain words and the slot's own limits (the rest behind "More"). A change is saved when
// the slider is let go and the game reloads with it; "See it" shows the thing in the preview. Adding an item, or
// balancing one, is a request to the person's own session: no slot covers a new entry in a mechanic's table yet.
import { addRequest, balanceRequest, itemsOf, peersOf } from '../lib/editors/items.js';
import { askBox, el, slider, swatchRow, useStyles } from '../lib/editors/ui.js';

const KIND_WORD = { pickup: 'pickup', carry: 'carry', weapon: 'weapon', drops: 'drops' };
const ICON = { pickup: '◆', carry: '▣', weapon: '➶', drops: '✦' };

export default {
  id: 'items',
  label: 'Items',
  order: 8,
  async mount(root, ctx) {
    useStyles();
    const panel = root.closest('.panel') ?? root;
    // undo: each saved change is a step { id, before, after }; undo writes `before` back through the slot (a change
    // here is saved at once, so undo is a write too, not a staged state)
    const steps = [], redos = [];
    const undoBtn = el('button', { type: 'button', className: 'ghost', title: 'Undo the last change', disabled: true }, '↶ Undo');
    const redoBtn = el('button', { type: 'button', className: 'ghost', title: 'Redo', disabled: true }, '↷ Redo');
    const refresh = () => { undoBtn.disabled = !steps.length; redoBtn.disabled = !redos.length; };
    async function walk(from, to, side) {
      const s = from.pop(); if (!s) return;
      try { await ctx.api('game/slots/value', { id: s.id, value: s[side] }); to.push(s); ctx.toast(`${s.label}: ${s[side]}`, 'ok'); }
      catch (e) { from.push(s); ctx.toast(e.message, 'error'); }
      refresh();
    }
    undoBtn.addEventListener('click', () => walk(steps, redos, 'before'));
    redoBtn.addEventListener('click', () => walk(redos, steps, 'after'));
    const keys = e => {
      if (panel.hidden || !(e.ctrlKey || e.metaKey) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); walk(steps, redos, 'before'); } else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); walk(redos, steps, 'after'); }
    };
    window.addEventListener('keydown', keys);
    const list = el('div', { className: 'cards' });
    root.append(el('p', { className: 'muted' }, 'The things players pick up, carry, swing or shoot. Slide a number and let go: the game reloads with it. Every number stays inside what the game allows.'), el('div', { className: 'toolbar' }, undoBtn, redoBtn), list);

    let cards = [], open = null;
    async function save(s, value, label) {
      try {
        const r = await ctx.api('game/slots/value', { id: s.id, value });
        steps.push({ id: s.id, label, before: r.before, after: r.after }); redos.length = 0; refresh();
      } catch (e) { ctx.toast(e.message, 'error'); }
    }

    function card(c) {
      // a picture slot shows its picture; a model or a stand-in shows its kind, in the item's own colour when it has one
      const colour = [...c.main, ...c.more].find(s => s.type === 'color' && /^#[0-9a-f]{6}$/i.test(s.value))?.value;
      const pic = c.picture?.type === 'image' ? el('img', { className: 'pic', src: `/game/${c.picture.file}?t=${Date.now()}`, alt: '' })
        : el('div', { className: 'pic', 'aria-hidden': 'true', style: colour ? { color: colour } : {} }, ICON[c.kind] ?? '•');
      const field = s => {
        if (s.type === 'boolean') return el('div', { className: 'field' }, el('label', { className: 'field-label' }, el('input', { type: 'checkbox', checked: !!s.value, on: { change: e => save(s, e.target.checked, s.label) } }), ' ', s.label));
        if (s.type === 'color') return el('div', { className: 'field' }, el('label', { className: 'field-label' }, s.label), swatchRow(s.value, v => save(s, v, s.label), { label: s.label }));
        if (s.type === 'enum' || (s.type === 'text' && Array.isArray(s.constraints?.enum))) {
          const opts = s.type === 'enum' ? (s.constraints.options ?? []).map(o => (o && typeof o === 'object' ? o.value : o)) : s.constraints.enum;
          return el('div', { className: 'field' }, el('label', { className: 'field-label' }, s.label), el('select', { on: { change: e => save(s, e.target.value, s.label) } }, ...opts.map(o => el('option', { value: o, selected: String(o) === String(s.value) }, String(o)))));
        }
        return slider(s, s.value, (v, done) => { if (done) save(s, v, `${c.name}: ${s.label}`); }, { compare: peersOf(cards, c, s.id) });
      };
      const showBtn = c.show ? el('button', { type: 'button', className: 'ghost small', on: { click: () => ctx.preview.show(`/game/?gf-show=${c.show}`) } }, 'See it') : null;
      const playBtn = el('button', { type: 'button', className: 'ghost small', on: { click: () => ctx.preview.show('/game/') } }, 'Play with it');
      const pickBtn = el('button', { type: 'button', className: 'ghost small', title: 'Pick this card to ask your session about it', on: { click: () => ctx.selection.set({ id: c.picture?.slot ?? c.main[0]?.id ?? c.id, label: c.name }) } }, 'Ask about it');
      const replace = c.picture?.slot ? el('button', { type: 'button', className: 'ghost small', title: `Replace its ${c.picture.type} (the slot ${c.picture.slot})`, on: { click: () => pickFile(c) } }, `New ${c.picture.type === 'model' ? 'model' : 'picture'}…`) : null;
      const more = c.more.length ? el('details', { className: 'more', open: open === c.id, on: { toggle: e => { if (e.target.open) open = c.id; } } }, el('summary', {}, `More (${c.more.length})`), ...c.more.map(field)) : null;
      return el('div', { className: 'card' },
        el('div', { className: 'card-head' }, pic, el('div', {}, el('h4', {}, c.name), el('div', { className: 'what' }, c.what)), el('span', { className: 'kind' }, KIND_WORD[c.kind] ?? c.kind)),
        ...c.main.map(field), more,
        el('div', { className: 'card-actions' }, showBtn, playBtn, replace, pickBtn));
    }
    async function pickFile(c) {
      const input = el('input', { type: 'file', accept: c.picture.type === 'model' ? '.glb' : '.png,.jpg,.jpeg,.webp' });
      input.addEventListener('change', async () => {
        const f = input.files[0]; if (!f) return;
        try { await ctx.api(`game/slots/file?id=${encodeURIComponent(c.picture.slot)}&name=${encodeURIComponent(f.name)}`, f); ctx.toast(`${c.name}: replaced. Record its licence in ATTRIBUTION.md.`, 'ok'); }
        catch (e) { ctx.toast(e.message, 'error'); }
      });
      input.click();
    }

    // add one like an existing card, or balance one: the person's session does it (no slot holds a new entry yet)
    const addFrom = el('select', { 'aria-label': 'Start from' });
    const addName = el('input', { type: 'text', placeholder: 'its name, e.g. Golden bucket', 'aria-label': 'The new item\'s name', maxLength: 40 });
    const addBox = askBox(ctx, {
      label: 'Add an item like…',
      placeholder: 'what it should be like, e.g. rarer, refills twice as much, gold',
      button: 'Ask my session to add it',
      compose: idea => addRequest(cards.find(c => c.id === addFrom.value) ?? cards[0], { name: addName.value.trim() || 'New item', idea }),
    });
    addBox.insertBefore(el('div', { className: 'toolbar' }, addFrom, addName), addBox.children[1]);
    const balanceFrom = el('select', { 'aria-label': 'Which item' });
    const balanceBox = askBox(ctx, {
      label: 'Balance…',
      placeholder: 'the aim, e.g. buckets should matter more than aim',
      button: 'Ask my session to balance it',
      compose: goal => balanceRequest(cards.find(c => c.id === balanceFrom.value) ?? cards[0], goal),
    });
    balanceBox.insertBefore(el('div', { className: 'toolbar' }, balanceFrom), balanceBox.children[1]);
    root.append(el('h3', {}, 'Ask your session'), addBox, el('div', { style: { height: '10px' } }), balanceBox,
      el('p', { className: 'muted small' }, 'Adding an item changes the game\'s mechanics, which no slot covers yet: your session adds it, and its card shows here when it lands.'));

    async function render() {
      const r = await ctx.api('game/slots?all=1');
      cards = itemsOf(r.slots, { mechanics: ctx.game.mechanics ?? [] });
      list.replaceChildren(...(cards.length ? cards.map(card) : [el('div', { className: 'card muted' }, 'This game has no items the studio recognises yet (pickups, things to carry, weapons, drops).')]));
      for (const sel of [addFrom, balanceFrom]) { const was = sel.value; sel.replaceChildren(...cards.map(c => el('option', { value: c.id }, c.name))); if (cards.some(c => c.id === was)) sel.value = was; }
    }
    await render();
    let t = null;
    const offGame = ctx.on('game', ({ files = [] }) => { if (files.length && files.every(f => f.startsWith('evidence/'))) return; clearTimeout(t); t = setTimeout(render, 250); });
    return () => { offGame(); window.removeEventListener('keydown', keys); };
  },
};
