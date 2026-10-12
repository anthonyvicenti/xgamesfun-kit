// The Settings tool's logic (studio/tabs/tune.js), with no DOM. A setting is a value slot whose type a control can edit
// safely (number, integer, boolean, enum, colour): no free code, no file slots. EVERY change the kit allows today writes
// the config file the slot points at, and the dev server's file watcher then reloads the preview, so every change is
// "reload". (A live in-round hook does not exist in gf-three; when one does, set `live: true` in the slot's constraints.)
//
// How a setting is drawn is chosen by its TYPE and UNIT only, never by a slot's id (one rule for every game):
//   boolean → a switch · enum → pills (a swatch on each when the choices are colours) · colour → swatches
//   integer with no unit and a short range → a row of dots · degrees → a dial · a 0–1 fraction → a fill bar
//   every number → a slider with both ends labelled; its range is the slot's own, else inferred from the value.

export const TUNE_TYPES = ['number', 'integer', 'boolean', 'enum', 'color'];
export const APPLIES = { reload: 'Applies with a reload of the preview (automatic)', live: 'Applies at once, in the round' };

/** The settings among a game's slots. all: also the advanced tier (the "More settings" under each card). */
export function tunables(slots, { all = false } = {}) {
  return slots.filter(s => s.kind === 'value' && TUNE_TYPES.includes(s.type) && (all || (s.tier ?? 'main') === 'main'))
    .filter(s => s.type !== 'color' || typeof s.value === 'string')
    .map(s => ({ ...s, applies: s.constraints?.live === true ? 'live' : 'reload' }));
}

/** Staged edits → the changes to post (only those that differ from the slot's current value). */
export function pendingChanges(slots, staged) {
  const out = [];
  for (const [id, value] of Object.entries(staged)) {
    const s = slots.find(x => x.id === id);
    if (s && !sameValue(s.value, value)) out.push({ id, value });
  }
  return out;
}
export const sameValue = (a, b) => (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) : String(a).toLowerCase() === String(b).toLowerCase());

// ---------------------------------------------------------------- units

// a unit word as a slot may write it (constraints.unit, or a label's last "(…)") → one short code
const UNIT_WORDS = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  ms: 'ms', milliseconds: 'ms',
  m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  'm/s': 'm/s', 'metres per second': 'm/s', 'meters per second': 'm/s',
  deg: 'deg', '°': 'deg', degree: 'deg', degrees: 'deg',
  '%': '%', percent: '%', px: 'px', pixels: 'px', hz: 'Hz', x: '×', '×': '×',
};
/** The unit of a number slot and its label without a unit in brackets:
 *  "Sun height (degrees)" → { unit: 'deg', name: 'Sun height' }; constraints.unit wins over the label. */
export function unitOf(s) {
  const label = String(s.label ?? s.id ?? '');
  const m = label.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const fromLabel = m ? UNIT_WORDS[m[2].trim().toLowerCase()] : undefined;
  const own = s.constraints?.unit;
  const unit = own != null && own !== '' ? (UNIT_WORDS[String(own).trim().toLowerCase()] ?? String(own)) : (fromLabel ?? '');
  return { unit, name: fromLabel ? m[1] : label };
}

// ---------------------------------------------------------------- ranges

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
/** The smallest "round" number at or above x (6 → 6, 2.3 → 2.5, 520 → 600). */
export function niceCeil(x) {
  if (!(x > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const n of NICE) if (n * p >= x - 1e-9 * p) return +(n * p).toPrecision(12);
  return 10 * p;
}
const decimalsOf = x => { const t = String(x); return t.includes('e-') ? Number(t.split('e-')[1]) : (t.split('.')[1] ?? '').length; };
const roundTo = (x, step) => { const d = Math.min(10, decimalsOf(step)); return +(Math.round(x / step) * step).toFixed(d); };
/** A step that gives a slider about a hundred stops, on a round number (0.01, 0.05, 0.1, 1 …). */
function stepFor(span, integer) {
  if (integer) return 1;
  const raw = span / 100, p = 10 ** Math.floor(Math.log10(raw));
  return +(raw / p >= 5 ? 5 * p : p).toPrecision(6);
}
/** A step the value in hand sits on (from the range's low end), so the slider shows the game's own value exactly. */
function stepFitting(step, min, v, integer) {
  for (let i = 0; i < 4 && !integer; i++) {
    const k = (v - min) / step;
    if (Math.abs(k - Math.round(k)) < 1e-6) break;
    step = +(step / (i % 2 ? 2 : 5)).toPrecision(6);
  }
  return step;
}

/** True when a number slot reads as a 0–1 fraction: the slot says 0..1, or (no top given) its value sits between 0 and 1. */
export function isFraction(s) {
  const c = s.constraints ?? {}, v = Number(s.value);
  if (s.type !== 'number' || unitOf(s).unit) return false;
  if (typeof c.max === 'number') return c.max === 1 && (c.min ?? 0) === 0;
  return (c.min ?? 0) >= 0 && v > 0 && v < 1;
}

/**
 * The range of a number slot for a slider. Never null for a number or an integer: the slot's own min and max when it
 * gives them (never past them), else inferred from the value and its type:
 *   a 0–1 fraction → 0..1 · degrees → a full turn (0..360, or -180..180 when the value or the min is negative)
 *   otherwise 0..2×value, rounded up to a round number (a negative value: -2×|value|..2×|value|)
 * `base` is the value the range is drawn around (the value when the tool opened), so the range does not move while a
 * slider is dragged; the current value is always inside it. → { min, max, step, soft: { min, max } } (soft: inferred)
 */
export function sliderRange(s, base = s.value) {
  if (s.type !== 'number' && s.type !== 'integer') return null;
  const c = s.constraints ?? {}, integer = s.type === 'integer';
  const hasMin = typeof c.min === 'number', hasMax = typeof c.max === 'number';
  const v = Number.isFinite(Number(base)) ? Number(base) : hasMin ? c.min : 0;
  const unit = unitOf(s).unit;
  let min, max;
  if (hasMin && hasMax && c.max > c.min) { min = c.min; max = c.max; }
  else if (unit === 'deg') {
    min = hasMin ? c.min : v < 0 ? -180 : 0;
    max = hasMax ? c.max : min + 360;
    if (hasMax && !hasMin) min = max - 360;
  } else if (isFraction({ ...s, value: v })) { min = hasMin ? c.min : 0; max = hasMax ? c.max : 1; }
  else {
    const top = niceCeil(Math.abs(v) * 2) || (integer ? 10 : 1);
    min = hasMin ? c.min : v < 0 ? -top : 0;
    max = hasMax ? c.max : Math.max(top, min + (integer ? 5 : 1));
    if (hasMin && !hasMax && max <= min) max = min + (niceCeil(Math.abs(min)) || (integer ? 10 : 1));
  }
  // the value in hand is always reachable (a game made with a value past the inferred end widens it, never the slot's own)
  for (const x of [v, Number(s.value)].filter(Number.isFinite)) {
    if (!hasMin) min = Math.min(min, x);
    if (!hasMax) max = Math.max(max, x);
  }
  if (integer) { min = Math.ceil(min); max = Math.floor(max); }
  if (!(max > min)) max = min + 1;
  const step = typeof c.step === 'number' && c.step > 0 ? c.step : stepFitting(unit === 'deg' ? 1 : stepFor(max - min, integer), min, v, integer);
  return { min, max, step, soft: { min: !hasMin, max: !hasMax } };
}

/** A number held inside its range and on its step (what the slider sends). Typed values keep their own precision. */
export function snapValue(s, v, range = sliderRange(s)) {
  const n = Number(v);
  if (!Number.isFinite(n)) return s.value;
  const lo = range && !range.soft?.min ? range.min : s.constraints?.min, hi = range && !range.soft?.max ? range.max : s.constraints?.max;
  let x = n;
  if (typeof lo === 'number') x = Math.max(lo, x);
  if (typeof hi === 'number') x = Math.min(hi, x);
  return s.type === 'integer' ? Math.round(x) : +x.toFixed(6);
}
/** A slider's position → the value: on the step, measured from the range's low end. */
export const fromSlider = (s, range, raw) => snapValue(s, range.min + roundTo(Number(raw) - range.min, range.step), range);

// ---------------------------------------------------------------- what a value looks like

/** How a setting is drawn: 'switch' | 'pills' | 'swatches' | 'dial' | 'fill' | 'dots' | 'slider'. By type and unit only. */
export function visualOf(s, range = sliderRange(s)) {
  if (s.type === 'boolean') return 'switch';
  if (s.type === 'enum') return 'pills';
  if (s.type === 'color') return 'swatches';
  const unit = unitOf(s).unit;
  if (unit === 'deg') return 'dial';
  if (isFraction(s)) return 'fill';
  if (s.type === 'integer' && !unit && range && range.max - range.min <= 15 && range.max <= 16) return 'dots';
  return 'slider';
}

const plural = (n, one, many = `${one}s`) => `${n} ${Math.abs(n) === 1 ? one : many}`;
/** A number with no float noise and at most a few decimals: 0.7200000001 → "0.72", 1200 → "1,200". */
export function plainNumber(n, decimals = 3) {
  const x = +Number(n).toFixed(decimals);
  return Math.abs(x) >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: decimals }) : String(x);
}
/** A value as a person reads it: "1.5 seconds", "1 min 30 s", "55°", "72%", "5.2 m/s", "On", "golden". */
export function formatValue(s, v) {
  if (s.type === 'boolean') return v === true || v === 'true' ? 'On' : 'Off';
  if (s.type === 'enum') { const o = optionsOf(s).find(o => sameValue(o.value, v)); return o ? o.label : String(v ?? ''); }
  if (s.type === 'color') return String(v ?? '').toUpperCase();
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  const unit = unitOf(s).unit;
  if (unit === 'deg') return `${plainNumber(n, 1)}°`;
  if (unit === '%') return `${plainNumber(n, 1)}%`;
  if (unit === 's') {
    if (Math.abs(n) >= 60) { const m = Math.floor(Math.abs(n) / 60), r = +(Math.abs(n) - m * 60).toFixed(1); return `${n < 0 ? '-' : ''}${m} min${r ? ` ${plainNumber(r, 1)} s` : ''}`; }
    return plural(plainNumber(n, 2), 'second');
  }
  if (unit === 'ms') return `${plainNumber(n, 0)} ms`;
  if (unit === 'm') return plural(plainNumber(n, 2), 'metre');
  if (!unit && isFraction(s)) return `${plainNumber(n * 100, 0)}%`;
  return unit ? `${plainNumber(n, 2)} ${unit}` : plainNumber(n, 2);
}
/** The words under a slider's two ends: { min, max }. */
export function endLabels(s, range = sliderRange(s)) {
  if (!range) return null;
  return { min: formatValue(s, range.min), max: formatValue(s, range.max) };
}
/** An enum's choices as { value, label }. */
export function optionsOf(s) {
  return (s.constraints?.options ?? []).map(o => (o && typeof o === 'object') ? { value: o.value, label: String(o.label ?? o.value) } : { value: o, label: String(o) });
}
/** A string that is a colour a page can paint (#rgb, #rrggbb, #rrggbbaa, rgb()/hsl()). Named colours: the tab asks the
 *  browser (CSS.supports), so a choice called "golden" is a word and one called "gold" is a colour. */
export const isColourText = v => typeof v === 'string' && /^(#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\([^()]*\))$/i.test(v.trim());

/** Where 0..1 a value sits in its range (a tick, a fill, a dial). */
export const fractionOf = (range, v) => Math.min(1, Math.max(0, (Number(v) - range.min) / (range.max - range.min || 1)));

/** The value a setting resets to: the one the game was made with when the slot says (constraints.default or a
 *  `default` on the row), else the value when the tool opened. */
export function defaultOf(s, opened) {
  const d = s.constraints?.default ?? s.default;
  return d !== undefined ? d : opened;
}

// ---------------------------------------------------------------- the cards

/** A card's icon by its group's id or name (words, not slot ids): one of the icons the tab draws. */
export function groupIcon(group = '', label = '') {
  const t = `${group} ${label}`.toLowerCase();
  const by = [
    ['light', /look|light|sky|sun|colou?r|render|quality|time/], ['clock', /round|time|timer/], ['trophy', /rule|scor|win|point/],
    ['gear', /mechanic|plays|combat|fair|health|weapon/], ['move', /control|move|camera|input/], ['box', /prop|item|object|pickup/],
    ['globe', /world|map|level|arena|terrain/], ['person', /character|player|skin|body|avatar/], ['layout', /ui|menu|hud|screen/],
    ['text', /text|title|word/], ['sound', /sound|audio|music/],
  ];
  for (const [icon, re] of by) if (re.test(t)) return icon;
  return 'sliders';
}

/** The settings in cards, one per slot group, in the manifest's group order (groups it does not list come last).
 *  → [{ id, label, icon, main: [setting], more: [setting] }] (more: the advanced tier, behind "More settings"). */
export function cardsOf(settings, groups = []) {
  const order = new Map(groups.map((g, i) => [g.id, i])), names = new Map(groups.map(g => [g.id, g.label]));
  const by = new Map();
  for (const s of settings) {
    const id = s.group ?? 'other';
    if (!by.has(id)) by.set(id, { id, label: names.get(id) ?? (s.group ? String(s.group) : 'Other'), main: [], more: [] });
    by.get(id)[(s.tier ?? 'main') === 'main' ? 'main' : 'more'].push(s);
  }
  const rank = c => (order.has(c.id) ? order.get(c.id) : 1e6);
  return [...by.values()].map(c => ({ ...c, icon: groupIcon(c.id, c.label) }))
    .sort((a, b) => (b.main.length > 0) - (a.main.length > 0) || rank(a) - rank(b) || a.label.localeCompare(b.label));
}
