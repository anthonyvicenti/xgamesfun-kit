// The item editor's logic, with no DOM: a game's items as cards, made from the slots it already has. Nothing here
// adds a slot or a format: a card is a view over slots (CONTRACT §2), and every number on it is written through
// POST /api/game/slots/value with the slot's own min and max.
//
// What counts as an item is read from the slot ids, by the mechanics that own them (each mechanic's own slots,
// kit/mechanics/<id>/index.js): the long-term home of this table is each mechanic's manifest (an `item` entry), not
// this file; see the findings (editors-2026-10-11.md, requests).
//
//   a prop a mechanic uses     prop.<name> (its model or picture) + prop.<name>.* + the numbers of the mechanic whose
//                              `prop` param names it (pickup, carry, projectile)                      → a pickup card
//   a melee weapon             mechanic.melee.<weapon>.*                                                → a weapon card
//   an aimed mechanic          mechanic.projectile.* when it shoots no prop                            → a weapon card
//   loot drops                 mechanic.loot.*                                                         → a drops card

const MECHANIC_ITEMS = {
  pickup: { kind: 'pickup', noun: 'pickup' },
  carry: { kind: 'carry', noun: 'thing to carry' },
  projectile: { kind: 'weapon', noun: 'shot' },
  loot: { kind: 'drops', noun: 'drops' },
};
const PER_CARD = 4;               // numbers shown before "More"

const isNumber = s => s.kind === 'value' && (s.type === 'number' || s.type === 'integer');
const isEditable = s => s.kind === 'value' && ['number', 'integer', 'boolean', 'color', 'enum'].includes(s.type) || (s.kind === 'value' && s.type === 'text' && Array.isArray(s.constraints?.enum));
// what a person most wants to change first, by the last part of a slot id (then everything else, behind "More")
const PREFER = ['damage', 'count', 'value', 'respawn-seconds', 'reach', 'knockback', 'windup', 'speed', 'cooldown', 'size', 'heal'];
const order = s => {
  const tail = s.id.split('.').at(-1), p = PREFER.indexOf(tail);
  return (isNumber(s) ? 0 : 200) + (p < 0 ? 50 : p) + (/\.(heavy|dash-strike|combo-[2-9])\./.test(s.id) ? 100 : 0) + (s.tier === 'main' ? 0 : 60);
};
const cap = t => t.replace(/^./, c => c.toUpperCase());
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = id => String(id).replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());

/** The game's items as cards. `mechanics` is /api/game/info → mechanics ([{id, as}]): its words name a card. */
export function itemsOf(slots, { mechanics = [] } = {}) {
  const byId = new Map(slots.map(s => [s.id, s])), cards = [], used = new Set();
  const asOf = id => mechanics.find(m => m.id === id)?.as ?? null;
  const fields = list => {
    const sorted = list.filter(isEditable).sort((a, b) => order(a) - order(b));
    for (const s of sorted) used.add(s.id);
    // the card's first few: main-tier fields, then advanced ones until there are three; one field per meaning (a
    // prop's count and its mechanic's "spots at the start" are both "count": the main one is shown, the other is More)
    const main = [], seen = new Set(), mains = sorted.filter(s => s.tier === 'main').length;
    for (const s of sorted) {
      const tail = s.id.split('.').at(-1);
      if (main.length >= PER_CARD || seen.has(tail) || (s.tier !== 'main' && main.length >= Math.max(3, mains))) continue;
      main.push(s); seen.add(tail);
    }
    return { main, more: sorted.filter(s => !main.includes(s)) };
  };

  // props a mechanic uses
  for (const [mid, info] of Object.entries(MECHANIC_ITEMS)) {
    const propSlot = byId.get(`mechanic.${mid}.prop`);
    const name = typeof propSlot?.value === 'string' ? propSlot.value : '';
    if (!name || !byId.has(`prop.${name}`)) continue;
    const picture = byId.get(`prop.${name}`);
    const own = slots.filter(s => s.id.startsWith(`prop.${name}.`));
    const mech = slots.filter(s => s.id.startsWith(`mechanic.${mid}.`) && s.id !== `mechanic.${mid}.prop`);
    used.add(picture.id); if (propSlot) used.add(propSlot.id);
    cards.push({ id: `prop:${name}`, kind: info.kind, name: picture.label ?? words(name), what: asOf(mid) ?? `a ${info.noun}`, mechanic: mid, prop: name,
      picture: { slot: picture.id, type: picture.type, file: picture.file ?? null }, show: `prop.${name}`, ...fields([...own, ...mech]) });
  }
  // melee weapons, one card each
  const melee = slots.filter(s => /^mechanic\.melee\.[a-z0-9-]+\./.test(s.id));
  const weapons = [...new Set(melee.map(s => s.id.split('.')[2]))].filter(w => melee.some(s => s.id.startsWith(`mechanic.melee.${w}.`) && s.id.split('.').length > 3));
  for (const w of weapons) {
    const nameOf = melee.find(s => s.id.startsWith(`mechanic.melee.${w}.`))?.label?.split(/[,:]/)[0] ?? words(w);
    // inside its own card a field drops the weapon's name: "Pillow, swing 1: damage" reads "Swing 1: damage"
    const mine = melee.filter(s => s.id.startsWith(`mechanic.melee.${w}.`)).map(s => ({ ...s, label: cap(String(s.label ?? s.id).replace(new RegExp(`^${esc(nameOf)}[,:]\\s*`), '')) }));
    const model = mine.find(s => s.type === 'model');
    cards.push({ id: `weapon:${w}`, kind: 'weapon', name: nameOf, what: asOf('melee') ?? 'a weapon', mechanic: 'melee', weapon: w,
      picture: model ? { slot: model.id, type: 'model', file: model.file } : null, show: null, ...fields(mine.filter(s => s.type !== 'model')) });
  }
  // an aimed mechanic with no prop (a stream, a spell): the "weapon" is its numbers and its colour
  for (const [mid, info] of Object.entries(MECHANIC_ITEMS)) {
    if (info.kind !== 'weapon' || cards.some(c => c.mechanic === mid)) continue;
    const mine = slots.filter(s => s.id.startsWith(`mechanic.${mid}.`) && !used.has(s.id));
    if (!mine.length) continue;
    cards.push({ id: `mechanic:${mid}`, kind: 'weapon', name: firstWords(asOf(mid)) ?? words(mid), what: asOf(mid) ?? `a ${info.noun}`, mechanic: mid, picture: null, show: null, ...fields(mine) });
  }
  // loot drops
  const loot = slots.filter(s => s.id.startsWith('mechanic.loot.') && !used.has(s.id));
  if (loot.length) {
    const model = loot.find(s => s.type === 'model');
    cards.push({ id: 'mechanic:loot', kind: 'drops', name: 'Drops', what: asOf('loot') ?? 'what enemies and chests drop', mechanic: 'loot', picture: model ? { slot: model.id, type: 'model', file: model.file } : null, show: null, ...fields(loot.filter(s => s.type !== 'model')) });
  }
  return cards;
}
/** "your water soaker, limited by its tank" → "Water soaker" */
export function firstWords(as) {
  if (!as) return null;
  const head = String(as).split(/[,;:(]/)[0].replace(/^(your|a|an|the)\s+/i, '').trim();
  return head ? head.replace(/^./, c => c.toUpperCase()) : null;
}

/** A slider's range for a number field: the slot's own min and max; a step that suits the range. Null: a number box. */
export function fieldRange(s) {
  const c = s.constraints ?? {};
  if (typeof c.min !== 'number' || typeof c.max !== 'number' || !(c.max > c.min)) return null;
  const span = c.max - c.min, step = s.type === 'integer' ? 1 : span <= 1 ? 0.01 : span <= 10 ? 0.1 : span <= 100 ? 0.5 : 1;
  return { min: c.min, max: c.max, step };
}
/** A number held inside its slot's range and step (what the slider shows and the save sends). */
export function clampField(s, v) {
  const r = fieldRange(s), n = Number(v);
  if (!Number.isFinite(n)) return s.value;
  if (!r) return s.type === 'integer' ? Math.round(n) : n;
  const k = Math.round((Math.min(r.max, Math.max(r.min, n)) - r.min) / r.step) * r.step + r.min;
  return s.type === 'integer' ? Math.round(k) : Math.round(k * 1000) / 1000;
}

/** The same number on the other cards of a kind (HearthCards' balance helper: see your item beside the others).
 *  Fields match by the slot id with the card's own part taken out (mechanic.melee.<weapon>.combo-1.damage matches
 *  across weapons). → [{ name, value }] (empty when no other card has it) */
export function peersOf(cards, card, slotId) {
  const key = id => id.replace(/^mechanic\.melee\.[a-z0-9-]+\./, 'melee.').replace(/^prop\.[a-z0-9-]+\./, 'prop.');
  const want = key(slotId), out = [];
  for (const c of cards) {
    if (c === card || c.kind !== card.kind) continue;
    const s = [...c.main, ...c.more].find(x => key(x.id) === want && isNumber(x));
    if (s) out.push({ name: c.name, value: s.value });
  }
  return out;
}

/** The words of a request to the person's own session to add an item like an existing one. The page cannot add one by
 *  itself: an item is an entry in a mechanic's table or the game's props, which no slot covers yet. */
export function addRequest(card, { name, idea = '' } = {}) {
  const what = card.kind === 'weapon' && card.weapon ? `a new melee weapon in config/game.json (the melee mechanic's params.weapons), copied from "${card.name}"`
    : card.prop ? `a new prop "${slug(name)}" used like "${card.prop}" (config/game.json → props, and its mechanic), copied from "${card.name}"`
      : `a new item like "${card.name}"`;
  return `Add ${what}, named "${name}". ${idea ? `What it should be like: ${idea}. ` : ''}Keep the numbers inside their slots' ranges, give it a picture or model through its slot (the art tool), then run \`npx gamesfun slots\` so it shows in the studio's Items tab, and verify.`;
}
/** The words of a request to balance one card's numbers. */
export function balanceRequest(card, goal = '') {
  const nums = [...card.main, ...card.more].filter(isNumber).map(s => `${s.label} (${s.id}) = ${s.value}${s.constraints?.unit ? ` ${s.constraints.unit}` : ''} [${s.constraints?.min ?? '?'}..${s.constraints?.max ?? '?'}]`).join('; ');
  return `Balance "${card.name}" (${card.what}). ${goal ? `The aim: ${goal}. ` : ''}Its numbers now: ${nums}. Change only these slots (npx gamesfun slots set), each inside its range, say why for each change, then play a round and verify.`;
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
