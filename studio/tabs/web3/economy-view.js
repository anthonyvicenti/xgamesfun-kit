// The Economy tab's own pieces of page: the money-flow picture (inline SVG drawn from economy-parts.js's layout, in
// the studio's theme colours so it reads in light and dark), the icons the tab draws with, and its stylesheet
// (studio/tabs/economy.css, linked once). Every box has its kind's icon and colour (economy-look.js), the same as the
// part's card and its "Add" button below the picture.
import { flowGraph, layoutFlow } from './economy-parts.js';
import { ICONS, lookOf } from './economy-look.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

/** An icon as an <svg> for the page (a card, a button, a chip): 24×24, stroke currentColor. */
export function icon(name, size = 18, cls = 'econ-ico') {
  const s = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: cls, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  s.innerHTML = ICONS[name] ?? ICONS.token;
  return s;
}

/** The colour of each kind of line, as theme variables. */
// --econ-item is the second accent mixed half and half with the text colour (economy.css): the studio's lime alone is
// too pale on the light theme's white.
const EDGE = { pay: '--accent', payout: '--good', burn: '--bad', treasury: '--warn', lock: '--muted', item: '--econ-item', move: '--accent' };
const colour = (name, fallback = '#8b7cff') => `var(${name}, ${fallback})`;
const clip = (text, px, size) => {
  const max = Math.max(4, Math.floor(px / (size * 0.56)));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * The money flow as an SVG `width` wide. opts: { onPick(part), live: Map(partId → 'live' | 'changed'), selected,
 * flags: Map(partId → 'refusal' | 'warning') }. Every box that is a part is a button (click, Enter or Space) that
 * opens its card; a part the checker refuses is ringed red with a ✗, one with a warning gets an amber !.
 */
export function drawFlow(spec, width, { onPick = () => {}, live = new Map(), selected = null, flags = new Map() } = {}) {
  const graph = flowGraph(spec);
  const L = layoutFlow(graph, width);
  const root = svg('svg', { class: 'econ-flow', width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, role: 'img', 'aria-label': 'Where the money goes: players pay into the parts, the parts fill the pools, the pools pay out.', 'data-testid': 'econ-flow' });
  const defs = svg('defs');
  for (const [kind, v] of Object.entries(EDGE))
    defs.append(svg('marker', { id: `econ-arrow-${kind}`, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', style: `fill:${colour(v)}` })));
  root.append(defs);
  const lines = svg('g', { class: 'econ-edges' });
  const labels = svg('g', { class: 'econ-labels' });
  for (const e of L.edges) {
    lines.append(svg('path', { d: e.d, class: `econ-edge ${e.kind}`, style: `stroke:${colour(EDGE[e.kind])}`, 'marker-end': `url(#econ-arrow-${e.kind})`, 'data-from': e.from, 'data-to': e.to }));
    if (e.label) {
      labels.append(svg('g', { class: `econ-label ${e.kind}`, transform: `translate(${Math.round(e.lx)},${Math.round(e.ly)})` },
        svg('rect', { x: -e.lw / 2, y: -9, width: e.lw, height: 18, rx: 9, style: `stroke:${colour(EDGE[e.kind])}` }),
        svg('text', { x: 0, y: 4, 'text-anchor': 'middle' }, e.label)));
    }
  }
  root.append(lines);
  const boxes = svg('g', { class: 'econ-nodes' });
  const big = L.width < 480 ? 12 : 13; // a phone's narrower boxes take a smaller letter
  for (const n of L.nodes) {
    const id = n.part ? `${n.part.section}:${n.part.key}` : null;
    const state = id ? live.get(id) : null;
    const flag = id && n.id === id ? flags.get(id) : null; // the part's own box, not the winners it pays
    const look = lookOf(n.kind, n.id);
    const withIcon = n.w >= 130;
    const tx = withIcon ? 44 : 9;
    const g = svg('g', {
      class: `econ-node ${n.kind} tone-${look.tone}${n.part ? ' pick' : ''}${selected && id === selected ? ' on' : ''}${flag ? ` flag-${flag}` : ''}`,
      transform: `translate(${n.x},${n.y})`,
      ...(n.part ? { role: 'button', tabindex: 0, 'aria-label': `${n.label}: open its card`, 'data-part': id } : {}),
    },
    svg('title', {}, `${n.label}${n.sub ? `: ${n.sub}` : ''}`),
    svg('rect', { class: 'econ-node-box', width: n.w, height: n.h, rx: 10 }),
    withIcon ? svg('rect', { class: 'econ-node-tile', x: 8, y: (n.h - 28) / 2, width: 28, height: 28, rx: 7 }) : null,
    withIcon ? (() => {
      const ic = svg('g', { class: 'econ-node-icon', transform: `translate(${12},${(n.h - 20) / 2}) scale(${20 / 24})`, fill: 'none', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      ic.innerHTML = ICONS[look.icon];
      return ic;
    })() : null,
    svg('text', { x: tx, y: n.h / 2 - 3, class: 'econ-node-label', style: `font-size:${big}px` }, clip(n.label, n.w - tx - (state || flag ? 22 : 8), big)),
    svg('text', { x: tx, y: n.h / 2 + 13, class: 'econ-node-sub', style: `font-size:${big - 1}px` }, clip(n.sub, n.w - tx - 8, big - 1)),
    flag
      ? svg('g', { class: `econ-flag ${flag}`, transform: `translate(${n.w - 13},13)` }, svg('circle', { r: 8 }), svg('text', { y: 4, 'text-anchor': 'middle' }, flag === 'refusal' ? '✗' : '!'), svg('title', {}, flag === 'refusal' ? 'Needs a fix: open its card' : 'A note: open its card'))
      : state ? svg('circle', { cx: n.w - 13, cy: 13, r: 5, class: `econ-dot ${state}` }, svg('title', {}, state === 'live' ? 'Live' : 'Changed since it went live')) : null);
    if (n.part) {
      g.addEventListener('click', () => onPick(n.part));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(n.part);
        }
      });
    }
    boxes.append(g);
  }
  const captions = svg('g', { class: 'econ-captions' }, ...L.captions.map((c) => svg('text', { x: 8, y: c.y, class: 'econ-caption' }, c.text)));
  root.append(captions, boxes, labels);
  return root;
}

/** The legend over the picture: what each colour of line means. */
export const LEGEND = [
  ['pay', 'players pay in'],
  ['payout', 'paid out'],
  ['treasury', 'to your treasury'],
  ['burn', 'burned'],
  ['lock', 'locked or handed in'],
];
export const edgeColour = (kind) => colour(EDGE[kind]);

/**
 * The empty economy's picture: players, a dashed box waiting for a first part, a pool and a trophy, joined by arrows.
 * Decorative (the words and the buttons beside it say what to do).
 */
export function emptyPicture() {
  const s = svg('svg', { viewBox: '0 0 360 120', class: 'econ-empty-pic', 'aria-hidden': 'true' });
  const box = (x, name, tone, dashed = false) => {
    const g = svg('g', { class: `econ-node tone-${tone}${dashed ? ' ghost' : ''}`, transform: `translate(${x},30)` },
      svg('rect', { class: 'econ-node-box', width: 60, height: 60, rx: 14 }));
    const ic = svg('g', { class: 'econ-node-icon', transform: 'translate(16,16) scale(1.1667)', fill: 'none', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    ic.innerHTML = ICONS[name];
    g.append(ic);
    return g;
  };
  const arrow = (x) => svg('path', { class: 'econ-empty-arrow', d: `M${x},60 h26`, 'marker-end': 'url(#econ-empty-head)' });
  s.append(
    svg('defs', {}, svg('marker', { id: 'econ-empty-head', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'econ-empty-headpath' }))),
    box(8, 'players', 'ink'), arrow(74), box(104, 'plus', 'lime', true), arrow(170), box(200, 'pool', 'lav'), arrow(266), box(292, 'winners', 'good'),
  );
  return s;
}

/** The tab's stylesheet (studio/tabs/economy.css), once per page. */
export function econStyles() {
  if (document.querySelector('link[data-econ-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../economy.css', import.meta.url).href;
  link.dataset.econStyles = '1';
  document.head.append(link);
}
