// How the Economy tab looks, with no DOM: an icon and a colour for every kind of part (the same in the money-flow
// picture, the part cards and the "Add" buttons), the "Add" buttons in groups with their plain words, each part's key
// number ("0.1 SOL a roll"), the wallet's chip, what putting it live costs as receipt lines, and where a day of the
// players' money goes (the bar under "A day"). Pure, so tests import it in Node (tests/economy-look.test.mjs).
import { SECTIONS, fmt, nameOf, symbolOf } from './economy-parts.js';

/**
 * Inline SVG icons (24×24, stroke currentColor, like the studio's tool bar). By the kind of a part, and by the kind of
 * a box in the picture that is not a part (players, winners, the treasury, burned…).
 */
export const ICONS = {
  players: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1"/><path d="M16 5.5a3 3 0 0 1 0 5M18 14a5.5 5.5 0 0 1 3 5v1"/>',
  token: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
  'token-curve': '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  'token-existing': '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  'token-game': '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  pool: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  item: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  box: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8C10 4 6.5 4 6.5 6.2S10 8 12 8zM12 8c2-4 5.5-4 5.5-1.8S14 8 12 8z"/>',
  payment: '<path d="M14 4h5v16h-5"/><path d="M3 12h11M10 8l4 4-4 4"/>',
  recipe: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
  lottery: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M12 9.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z"/>',
  stake: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><path d="M12 15v2"/>',
  contest: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>',
  hold: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2"/>',
  schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  decision: '<path d="M14 13l-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="M16 16l6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  winners: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  places: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11L6 3h4l2 5 2-5h4l-2.5 8"/><path d="M12 13v4"/>',
  stakers: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  treasury: '<path d="M3 21h18M5 21V11M19 21V11M9.5 21V11M14.5 21V11M2 10l10-6 10 6z"/>',
  burn: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>',
  account: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M12 21L8 9l2-6M12 21l4-12-2-6"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5-2 1.5-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.3"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  cross: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};

/**
 * Each kind's colour, as a tone the stylesheet knows (economy.css: .tone-<name> → a studio token and its soft fill).
 * The picture's lines keep their own colours (economy-view.js): paid in, paid out, treasury, burned.
 */
export const TONES = {
  players: 'ink', token: 'warn', pool: 'lav', item: 'lime', box: 'lav', payment: 'info', recipe: 'lav', lottery: 'warn',
  stake: 'good', contest: 'bad', hold: 'muted', schedule: 'info', decision: 'muted', winners: 'good', places: 'good',
  stakers: 'good', treasury: 'warn', burn: 'bad', account: 'muted', gem: 'lime', settings: 'muted',
};

/** The icon and tone of a box in the picture (flowGraph's node), or of a part (by its section's kind). */
export function lookOf(kind, id = '') {
  const icon = id === 'collectibles' ? 'gem' : kind;
  return { icon: ICONS[icon] ? icon : 'token', tone: TONES[icon] ?? 'muted' };
}
export const kindOfSection = (section) => SECTIONS.find((s) => s.section === section)?.kind ?? section;

/** What each "Add" button says: the picture buttons under the money flow, in four groups. testid: econ-add-<id>. */
export const ADD_GROUPS = [
  {
    title: 'Players pay for',
    parts: [
      { id: 'item', kind: 'item', label: 'Item', hint: 'a thing to buy' },
      { id: 'box', kind: 'box', label: 'Loot box', hint: 'a paid roll' },
      { id: 'payment', kind: 'payment', label: 'Entry fee', hint: 'pay to play' },
      { id: 'lottery', kind: 'lottery', label: 'Lottery', hint: 'tickets, a draw' },
    ],
  },
  {
    title: 'Players do',
    parts: [
      { id: 'stake', kind: 'stake', label: 'Stake', hint: 'lock and earn' },
      { id: 'contest', kind: 'contest', label: 'Contest', hint: 'back a side' },
      { id: 'recipe', kind: 'recipe', label: 'Recipe', hint: 'merge, salvage' },
      { id: 'hold', kind: 'hold', label: 'Quest', hint: 'send one away' },
    ],
  },
  {
    title: 'The game runs',
    parts: [
      { id: 'pool', kind: 'pool', label: 'Pool', hint: 'holds prize money' },
      { id: 'schedule', kind: 'schedule', label: 'Timer', hint: 'mint, burn, move' },
      { id: 'decision', kind: 'decision', label: 'Game rule', hint: 'only it knows' },
    ],
  },
  {
    title: 'Money',
    parts: [
      { id: 'token-curve', kind: 'token', variant: 'curve', icon: 'token-curve', label: 'Launch a token', hint: 'for this game', once: 'curve' },
      { id: 'token-existing', kind: 'token', variant: 'existing', icon: 'token-existing', label: 'My token', hint: 'one I have' },
      { id: 'token-game', kind: 'token', variant: 'game', icon: 'token-game', label: 'Points', hint: 'the game mints' },
    ],
  },
];

/** True when nothing takes the players' money yet: only tokens (or nothing at all). */
export const isEmpty = (spec) => SECTIONS.every((s) => s.section === 'tokens' || !(spec?.[s.section] ?? []).length);

/** A part's one number for its card and its box: "0.1 SOL a roll", "0.01 SOL a ticket · every 7d". */
export function keyNumber(spec, section, part) {
  const sym = (k) => symbolOf(spec, k);
  const n = (v) => fmt(Number(v));
  switch (section) {
    case 'tokens':
      return part.source === 'sol' ? 'Solana’s own coin' : part.source === 'game' ? `$${sym(part.key)} · the game mints it` : `$${sym(part.key)}`;
    case 'pools':
      return Number(part.seed) > 0 ? `starts with ${n(part.seed)} ${sym(part.currency)}` : `holds ${sym(part.currency)}`;
    case 'items':
      return Number(part.price) > 0 ? `${n(part.price)} ${sym()}` : 'won, not sold';
    case 'boxes':
      return `${n(part.price)} ${sym(part.currency)} a roll`;
    case 'payments':
      return `${n(part.amount)} ${sym(part.currency)}`;
    case 'recipes':
      return `${(part.in ?? []).length} in → ${(part.out ?? []).length} out`;
    case 'lotteries': {
      const potSym = sym((spec.pools ?? []).find((p) => p.key === part.pot)?.currency);
      return `${n(part.price)} ${part.ticketCurrency ? sym(part.ticketCurrency) : potSym} a ticket${part.every ? ` · every ${part.every}` : ''}`;
    }
    case 'stakes':
      return `lock ${sym(part.stakes)}${part.lock ? ` ≥ ${part.lock}` : ''}`;
    case 'contests':
      return `${part.sides ?? 2} sides`;
    case 'holds':
      return part.for ? `for ${part.for}` : 'hand one in';
    case 'schedules':
      return part.does === 'issue' ? `mints ${n(part.amount)} ${sym(part.currency)} every ${part.every}` : `${part.does === 'burn' ? 'burns' : 'moves'} ${n(part.percent)}% every ${part.every}`;
    case 'decisions':
      return { payout: 'pays out', burn: 'burns', issue: 'mints', make: 'gives a collectible', unmake: 'takes one back', set: 'writes on one', award: 'awards a place', decide: 'names a winner', roll: 'rolls a box', open_contest: 'opens a contest' }[part.does] ?? part.does ?? '';
    default:
      return '';
  }
}

/** An amount for a tile: fmt() up to a million, then 1.2M, 661T (a token with six decimals runs to big numbers). */
export function shortAmount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) < 1e6) return fmt(n);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** A part's title on its card. */
export const titleOf = (section, part) => (section === 'pools' ? nameOf(part) : section === 'decisions' ? part.when || 'A rule' : section === 'tokens' && part.source === 'sol' ? 'SOL' : nameOf(part) || part.symbol || part.key);

/**
 * The wallet's chip. address: the connected wallet's (or null); wallets: how many the browser has (null: not known).
 * → { tone: 'ok' | 'warn' | 'bad', text }
 */
export function walletLook(address, wallets = null) {
  if (address) return { tone: 'ok', text: `Wallet ${String(address).slice(0, 4)}…${String(address).slice(-4)}` };
  if (wallets === 0) return { tone: 'bad', text: 'No wallet in this browser' };
  return { tone: 'warn', text: 'Wallet not connected' };
}

/** What putting it live costs, as receipt lines: [{ label, amount }] (amounts in SOL unless the line says). */
export function receiptLines(setup) {
  if (!setup) return [];
  const lines = [{ label: `Rent for ${setup.accounts?.length ?? 0} account${setup.accounts?.length === 1 ? '' : 's'}`, amount: `${fmt(setup.rentSol)} SOL` }];
  for (const [k, v] of Object.entries(setup.seeds ?? {})) lines.push({ label: 'Seeds the pools', amount: `${fmt(v)} ${k}` });
  lines.push({ label: 'Fees', amount: `${fmt((setup.programFeesSol ?? 0) + (setup.networkFeesSol ?? 0))} SOL` });
  return lines;
}

/**
 * Where a day of the players' money goes, per currency they pay in: back to players, to your treasury, burned, and
 * what stays in the pools. perDay: the quick simulation's `perDay`. → [{ token, pay, parts: [{ key, amount, percent }] }]
 * (percent of what players pay; the parts never add up to more than 100).
 */
export function daySplit(perDay) {
  const out = [];
  for (const [token, pay] of Object.entries(perDay?.players?.pay ?? {})) {
    if (!(pay > 0)) continue;
    const want = [
      ['back', perDay.players?.getBack?.[token] ?? 0],
      ['treasury', perDay.creator?.treasury?.[token] ?? 0],
      ['burned', perDay.burned?.[token] ?? 0],
    ].map(([key, amount]) => [key, Math.max(0, Number(amount) || 0)]);
    const sum = want.reduce((a, [, v]) => a + v, 0);
    const scale = sum > pay ? pay / sum : 1;
    const parts = want.filter(([, v]) => v > 0).map(([key, amount]) => ({ key, amount: amount * scale, percent: ((amount * scale) / pay) * 100 }));
    const kept = pay - parts.reduce((a, p) => a + p.amount, 0);
    if (kept > pay * 0.0005) parts.push({ key: 'kept', amount: kept, percent: (kept / pay) * 100 });
    out.push({ token, pay, parts });
  }
  return out;
}
export const SPLIT_WORDS = { back: 'won back by players', treasury: 'to your treasury', burned: 'burned', kept: 'stays in the pools' };
