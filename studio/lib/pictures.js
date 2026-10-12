// Pictures for things that have none yet: a game with no verify screenshot, an example with no picture of its own, a
// concept the session pitched. A title card is a gradient from the thing's own colours (or colours its words name, or
// colours its words hash to) with a confetti pattern and one icon picked from its words. No DOM: everything here is
// strings (an SVG data URL for an <img>), so node tests read it and no text from a game or a session ever reaches
// markup (the SVG holds shapes and validated colours only).

/** Icons: 24x24, drawn with lines (stroke currentColor in the page; the title card strokes them dark). */
export const ICONS = {
  pillow: 'M3.5 5.5c3.5 1.5 13.5 1.5 17 0-1.5 4.3-1.5 8.7 0 13-3.5-1.5-13.5-1.5-17 0 1.5-4.3 1.5-8.7 0-13Z M9 10.5c1 .8 5 .8 6 0',
  coin: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M12 7v10 M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.8-2.5 2.2-2.5 1-2.5 2.3 1.1 2 2.5 2 2.5-.8 2.5-2',
  water: 'M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z M9 15a3 3 0 0 0 3 3',
  ghost: 'M6 20V10a6 6 0 0 1 12 0v10l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 20Z M10 10v1 M14 10v1',
  board: 'M4 4h16v16H4Z M4 9.3h16 M4 14.7h16 M9.3 4v16 M14.7 4v16',
  sword: 'M14.5 4H20v5.5L10 19.5 4.5 14 14.5 4Z M7 12l5 5 M4 20l2.5-2.5',
  island: 'M3 18c3-1.5 15-1.5 18 0 M7 17.5c1-4 3-6 5-6.5 M12 11l-4-2.5 M12 11l1.5-4.5 M12 11l4.5-1 M12 11l-.5 6.5',
  flag: 'M5 21V4 M5 4h12l-2.5 4L17 12H5',
  ball: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z M12 8l3.5 2.5-1.3 4h-4.4l-1.3-4L12 8Z M12 3v5 M15.5 10.5l4.8-1.5 M14.2 14.5l3 4 M9.8 14.5l-3 4 M8.5 10.5L3.7 9',
  skull: 'M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.2 3 5v3h8v-3c1.7-.8 3-2.4 3-5a7 7 0 0 0-7-7Z M9.5 10.5v.5 M14.5 10.5v.5 M10.5 18v2 M13.5 18v2',
  jump: 'M4 20h5v-5h5v-5h6 M14 4l3 3 3-3',
  block: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5L12 12l8-4.5 M12 12v9',
  star: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5Z',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0Z',
  car: 'M4 16v-4l2-5h12l2 5v4H4Z M4 12h16 M7 16v2 M17 16v2',
  pad: 'M7 8h10a4 4 0 0 1 4 4v2a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1 1.8A3 3 0 0 1 3 14v-2a4 4 0 0 1 4-4Z M7.5 10.5v3 M6 12h3 M15.5 11.5h.01 M17.5 13h.01',
};

/** Words → icon: the first rule whose word appears wins (the order is the tie-break: a ghost in a pool is a ghost). */
const ICON_WORDS = [
  ['ghost', /\b(ghosts?|haunted|spooky|hide|hiding|seek|tag)\b/],
  ['skull', /\b(zombies?|skeletons?|monsters?|undead|skulls?|boss)\b/],
  ['pillow', /\b(pillows?|feathers?|beds?|sleepover)\b/],
  ['coin', /\b(coins?|gold|treasure|loot|money|gems?)\b/],
  ['board', /\b(board|in a row|grid|chess|checkers|turns?|puzzle|tiles?)\b/],
  ['water', /\b(water|pool|soak|spray|splash|boats?|sea|lake|swim|rain|squirt)\b/],
  ['sword', /\b(swords?|knights?|fight|battle|duel|arena|melee|dungeon|brawl)\b/],
  ['island', /\b(isles?|islands?|beach|palm|portal)\b/],
  ['car', /\b(cars?|karts?|drive|driving|truck|road)\b/],
  ['flag', /\b(race|racing|finish|flag|checkpoint)\b/],
  ['ball', /\b(balls?|soccer|football|dodge|dodgeball|basket|goal)\b/],
  ['jump', /\b(platform|platformer|jump|jumps|ledges?|climb|parkour)\b/],
  ['block', /\b(blocks?|build|builder|craft|cubes?|voxel)\b/],
  ['music', /\b(dance|music|rhythm|beat|song|sing)\b/],
  ['star', /\b(stars?|space|galaxy|rocket|planet)\b/],
];
export function iconFor(words) {
  const w = String(words ?? '').toLowerCase();
  return ICON_WORDS.find(([, re]) => re.test(w))?.[0] ?? 'pad';
}

/** Colour words (and words that bring colours) → two colours each. */
const COLOUR_WORDS = [
  [/\b(sunset|dusk)\b/, ['#ff8a5c', '#7b5cff']],
  [/\b(night|dark|haunted|spooky|space)\b/, ['#3a2f8f', '#0f1430']],
  [/\b(backyard|garden|lawn|grass|forest|park)\b/, ['#3ddc84', '#ffd166']],
  [/\b(water|pool|sea|lake|ocean|boats?|soak|splash|beach)\b/, ['#38bdf8', '#4f7cff']],
  [/\b(snow|ice|winter|frozen)\b/, ['#bff4ff', '#7fb2ff']],
  [/\b(lava|fire|volcano|desert)\b/, ['#ff5a3c', '#ffb347']],
  [/\b(candy|pastel|jelly|cloud|pillows?|feathers?)\b/, ['#ff9ad5', '#a99cff']],
  [/\b(gold|coins?|treasure)\b/, ['#ffd23f', '#ff9f43']],
  [/\bred\b/, ['#ff5a5f']], [/\bpink\b/, ['#ff5ea8']], [/\bblue\b/, ['#4f7cff']], [/\bgreen\b/, ['#3ddc84']],
  [/\byellow\b/, ['#ffd166']], [/\borange\b/, ['#ff9f43']], [/\b(purple|violet)\b/, ['#a99cff']], [/\b(teal|cyan)\b/, ['#2dd4bf']],
];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A small stable hash of a string (FNV-1a). */
export function hashOf(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const hsl = (h, s, l) => {
  // → #rrggbb, so every colour in a card is one shape and can be checked with HEX
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
};
const full = c => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c).toLowerCase();

/**
 * Two colours for a card: the thing's own colours first (only #rgb / #rrggbb are taken), then colours its words name,
 * then two hues its words hash to. Very pale or very dark own colours are skipped when a better one follows.
 */
export function paletteOf(words, own = []) {
  const out = [];
  const add = c => { if (typeof c === 'string' && HEX.test(c.trim()) && !out.includes(full(c.trim())) && out.length < 2) out.push(full(c.trim())); };
  const lum = c => { const n = parseInt(full(c).slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const mine = (Array.isArray(own) ? own : []).filter(c => typeof c === 'string' && HEX.test(c.trim()));
  for (const c of [...mine.filter(c => lum(c) > 0.18 && lum(c) < 0.9), ...mine]) add(c);
  const w = String(words ?? '').toLowerCase();
  // the words lend one colour (the first they name), and a hue they hash to is the other: two concepts about the same
  // pillows still look different
  const named = COLOUR_WORDS.find(([re]) => re.test(w));
  if (named) add(named[1][0]);
  const h = hashOf(w);
  add(hsl(h % 360, 72, 62));
  add(hsl((h % 360 + 40 + (h >> 9) % 80) % 360, 70, 52));
  return out;
}

/** A tiny seeded random (mulberry32), so the same words always draw the same card. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A title card: { words, colours, icon?, shape? } → an SVG string (shapes only): shape 'card' is 320x180 (a game's
 * picture), 'banner' 320x110 (a concept's header, a smaller icon). words picks the icon, the pattern and (with
 * colours) the gradient.
 */
export function titleCardSvg({ words = '', colours = [], icon = null, shape = 'card' } = {}) {
  const H = shape === 'banner' ? 110 : 180, R = shape === 'banner' ? 30 : 44, S = shape === 'banner' ? 1.7 : 2.5;
  const [a, b] = paletteOf(words, colours);
  const name = ICONS[icon] ? icon : iconFor(words);
  const rnd = seeded(hashOf(`${words}|${a}|${b}`));
  const bits = [];
  for (let i = 0; i < 14; i++) {
    const x = (rnd() * 340 - 10).toFixed(1), y = (rnd() * (H + 20) - 10).toFixed(1), r = (4 + rnd() * 16).toFixed(1), o = (0.1 + rnd() * 0.22).toFixed(2);
    bits.push(rnd() < 0.55
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="${o}"/>`
      : `<rect x="${x}" y="${y}" width="${r * 1.6}" height="${r * 1.6}" rx="${(r / 2.5).toFixed(1)}" fill="#fff" fill-opacity="${o}" transform="rotate(${Math.round(rnd() * 90)} ${x} ${y})"/>`);
  }
  const cy = H / 2, t = (n => n.toFixed(1));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 ${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
    + `<radialGradient id="l" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="320" height="${H}" fill="url(#g)"/><rect width="320" height="${H}" fill="url(#l)"/>${bits.join('')}`
    + `<circle cx="160" cy="${cy}" r="${R}" fill="#fff" fill-opacity=".9"/><circle cx="160" cy="${cy}" r="${R}" fill="none" stroke="#0a0c16" stroke-opacity=".12" stroke-width="2"/>`
    + `<g transform="translate(${t(160 - 12 * S)} ${t(cy - 12 * S)}) scale(${S})" fill="none" stroke="#0a0c16" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></g></svg>`;
}
/** The same card as a URL an <img> takes. */
export const titleCardUrl = opts => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(titleCardSvg(opts))}`;

/** One icon as inline SVG markup for the page (stroke currentColor), from the ICONS above only. */
export function iconSvg(name, size = 16) {
  const d = ICONS[name] ?? ICONS.pad;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

/**
 * A game on the start page → its state chip: { label, tone } with tone ok (made), go (being made), warn (waiting on
 * the person), bad (stopped). listProjects' shape: { made, loop: { kind, status, step } | null }.
 */
export function cardState(g) {
  const l = g?.loop ?? null;
  const talk = l && (l.kind === 'pitch' || l.kind === 'refine');
  if (l?.status === 'failed') return { label: 'Stopped', tone: 'bad', note: 'The last build stopped' };
  if (talk && l.status === 'waiting-on-question') return { label: 'Being pitched', tone: 'warn', note: 'Waiting for your pick' };
  if (talk && l.status !== 'delivered' && l.status !== 'cancelled') return { label: 'Being pitched', tone: 'go', note: 'Your session is pitching' };
  if (l && l.status === 'waiting-on-question') return { label: 'Building', tone: 'warn', note: 'Waiting for your answer' };
  if (l && l.status === 'building') return { label: 'Building', tone: 'go', note: g?.made ? 'A change is being made' : 'Being made' };
  if (!g?.made) return { label: 'Being pitched', tone: 'go', note: '' };
  return { label: 'Made', tone: 'ok', note: '' };
}
