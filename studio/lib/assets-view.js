// Art & sound (studio/tabs/assets.js): the pure part. Which tile a slot is, how the slots and sounds fall into the
// gallery's sections, which text slots make the title card, and a sound's waveform as peaks. No DOM, no fetch: the
// tab draws what these return, and tests/assets-view.test.mjs checks them under node.

/** The files a slot type takes (the file picker's accept list, and what a drop is checked against). */
export const ACCEPT = { model: '.glb', image: '.png,.jpg,.jpeg,.webp', texture: '.ktx2,.hdr', audio: '.ogg,.mp3,.wav,.m4a', font: '.ttf,.otf,.woff,.woff2', data: '.json' };
const SHOWN = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
export const ext = f => String(f ?? '').split(/[?#]/)[0].split('.').pop().toLowerCase();

/**
 * What a slot is in the gallery:
 *   model, image, texture (a file the page cannot show as a picture), audio, font, data   a file tile
 *   text                                                                                 words (the title card, or a text row)
 *   colour, colours                                                                      a swatch, a row of swatches
 *   setting                                                                              a number, switch, choice or table:
 *                                                                                        the Settings tool's, shown only
 *                                                                                        under "Show every slot"
 *   other                                                                                not editable here
 */
export function tileKind(slot) {
  if (!slot) return 'other';
  if (slot.kind === 'file') {
    if (slot.type === 'model') return 'model';
    if (slot.type === 'image') return 'image';
    if (slot.type === 'texture') return SHOWN.has(ext(slot.file)) ? 'image' : 'texture';
    if (slot.type === 'audio') return 'audio';
    if (slot.type === 'font') return 'font';
    if (slot.type === 'data') return 'data';
    return SHOWN.has(ext(slot.file)) ? 'image' : 'data';
  }
  if (slot.kind !== 'value') return 'other';
  if (slot.type === 'text') return Array.isArray(slot.constraints?.enum) ? 'setting' : 'text';
  if (slot.type === 'color') return 'colour';
  if (slot.type === 'colors') return 'colours';
  return 'setting';
}

/** Is it in the gallery's default view? Numbers, switches, choices and tables are the Settings tool's. */
export const inGallery = slot => !['setting', 'other'].includes(tileKind(slot));

/** Does a dropped file fit the slot? → null, or the words saying why not. */
export function dropProblem(slot, fileName) {
  const list = (ACCEPT[slot?.type] ?? `.${ext(slot?.file)}`).split(',').map(s => s.trim().replace(/^\./, ''));
  const e = ext(fileName);
  if (!list.includes(e)) return `${slot?.label ?? 'This'} takes ${list.map(x => `.${x}`).join(', ')} files, not .${e || '?'}`;
  return null;
}

/**
 * A picture that is a sheet of frames shows its first frame (a 2D body's "idle"), not a strip of tiny figures. A
 * character's body is the kit's six-across sheet (studio/lib/editors/skins.js sheetFrames); another picture is a sheet
 * when it is a row of three or more square cells. → { x, y, w, h } | null
 */
export function sheetCell(slot, width, height) {
  if (!(width > 0 && height > 0)) return null;
  if (String(slot?.id ?? '').startsWith('character.body')) {
    const cell = width / 6;
    if (cell >= 8 && height >= cell * 0.9) return { x: 0, y: 0, w: cell, h: cell };
  }
  const n = width / height;
  if (n >= 3 && Math.abs(n - Math.round(n)) < 0.02) return { x: 0, y: 0, w: height, h: height };
  return null;
}

/** A size in plain words. */
export function sizeWords(bytes) {
  if (bytes == null) return 'missing';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What a tile kind is called, in a word (the tile's small badge, the jump row's counts). */
export const KIND_WORDS = { model: '3D model', image: 'Picture', texture: 'Texture', audio: 'Sound file', font: 'Font', data: 'Data file', sound: 'Sound', music: 'Music', colour: 'Colour', colours: 'Colours', text: 'Words', setting: 'Setting' };

/**
 * The title card: the slots of the words the players read first. The ids the kit gives them (ui.title, ui.hook,
 * ui.goal) come first in that order; without them, the text group's first three. → { title, lines: [slot…] } | null
 */
export function titleCard(slots) {
  const texts = slots.filter(s => tileKind(s) === 'text');
  if (!texts.length) return null;
  const byId = id => texts.find(s => s.id === id);
  const title = byId('ui.title') ?? texts.find(s => s.group === 'text') ?? null;
  if (!title) return null;
  const lines = ['ui.hook', 'ui.goal'].map(byId).filter(Boolean);
  if (!lines.length) lines.push(...texts.filter(s => s.group === title.group && s !== title).slice(0, 2));
  return { title, lines };
}

/**
 * The sounds of the game's sound list (assets.json → sounds, the gf-audio kit's manifest) as tiles.
 * Music and ambience (their bus) are "music"; the rest "sound". → [{ id, label, bus, kind, src, code, editable }]
 */
export function soundsOf(manifest) {
  const list = manifest?.sounds && typeof manifest.sounds === 'object' ? manifest.sounds : {};
  return Object.entries(list).filter(([, s]) => s && typeof s === 'object').map(([id, s]) => ({
    id, label: typeof s.label === 'string' && s.label ? s.label : id, bus: s.bus ?? 'sfx',
    kind: s.bus === 'music' || s.bus === 'ambient' ? 'music' : 'sound', src: s.src ?? null, code: !!s.code, loop: !!s.loop,
  }));
}

/** The first playable source of a sound: a preset, zzfx numbers, a file (or a slice of one), or layers of these. */
export function firstSource(src) {
  const one = Array.isArray(src) ? src[0] : src;
  return one && typeof one === 'object' ? one : null;
}

/**
 * The gallery's sections, in the game's group order: each with its tiles (files), colours, text rows (words that are
 * not on the title card) and settings (numbers and the like: only with every=true). Sounds come last, as their own
 * sections (Sounds, then Music). A section with nothing to show is left out.
 * → [{ id, label, files: [slot], colours: [slot], texts: [slot], settings: [slot], sounds: [sound] }]
 */
export function sections({ slots = [], groups = [], sounds = [], every = false, card = null } = {}) {
  const onCard = new Set(card ? [card.title, ...card.lines].map(s => s.id) : []);
  const order = groups.map(g => g.id);
  const label = new Map(groups.map(g => [g.id, g.label]));
  const by = new Map();
  const get = id => { if (!by.has(id)) by.set(id, { id, label: label.get(id) ?? (id === 'other' ? 'Other' : id), files: [], colours: [], texts: [], settings: [], sounds: [] }); return by.get(id); };
  for (const s of slots) {
    const k = tileKind(s), sec = get(s.group ?? 'other');
    if (['model', 'image', 'texture', 'audio', 'font', 'data'].includes(k)) sec.files.push(s);
    else if (k === 'colour' || k === 'colours') sec.colours.push(s);
    else if (k === 'text') { if (!onCard.has(s.id)) sec.texts.push(s); }
    else if (every && k === 'setting') sec.settings.push(s);
  }
  const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const out = [...by.values()].sort((a, b) => rank(a.id) - rank(b.id))
    .filter(s => s.files.length + s.colours.length + s.texts.length + s.settings.length > 0);
  const fx = sounds.filter(s => s.kind === 'sound'), music = sounds.filter(s => s.kind === 'music');
  if (fx.length) out.push({ id: 'sounds', label: 'Sounds', files: [], colours: [], texts: [], settings: [], sounds: fx });
  if (music.length) out.push({ id: 'music', label: 'Music', files: [], colours: [], texts: [], settings: [], sounds: music });
  return out;
}

/** How many things a section shows (the jump row's number). */
export const sectionCount = s => s.files.length + s.colours.length + s.texts.length + s.settings.length + s.sounds.length;

/**
 * A waveform: the loudest sample in each of n equal buckets, scaled so the loudest bucket is 1 (a quiet sound still
 * draws; silence stays flat). samples: a Float32Array (or any array of numbers). → Float32Array(n), each 0..1
 */
export function peaks(samples, n = 48) {
  const out = new Float32Array(Math.max(1, n | 0));
  const len = samples?.length ?? 0;
  if (!len) return out;
  for (let b = 0; b < out.length; b++) {
    const from = Math.floor(b * len / out.length), to = Math.max(from + 1, Math.floor((b + 1) * len / out.length));
    let m = 0;
    for (let i = from; i < to && i < len; i++) { const v = Math.abs(samples[i]); if (v > m) m = v; }
    out[b] = m;
  }
  let top = 0;
  for (const v of out) if (v > top) top = v;
  if (top > 1e-4) for (let b = 0; b < out.length; b++) out[b] = out[b] / top;
  else out.fill(0);
  return out;
}

/** Mix a few channels to one (a stereo file's waveform). */
export function mono(channels) {
  if (!channels?.length) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = Math.max(...channels.map(c => c.length)), out = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < c.length; i++) out[i] += c[i] / channels.length;
  return out;
}

/** The details a tile hides behind its ⓘ: what the agent and the command line call it. → [[label, value]] */
export function slotDetails(slot) {
  const rows = [['Slot', slot.id], ['Type', slot.type]];
  if (slot.kind === 'file') { rows.push(['File', slot.file]); rows.push(['Size', sizeWords(slot.bytes)]); }
  if (slot.kind === 'value' && slot.file) rows.push(['Saved in', `${slot.file}${slot.pointer ?? ''}`]);
  if (slot.scope === 'player') rows.push(['Per player', 'yes']);
  if (slot.tier && slot.tier !== 'main') rows.push(['Shown', 'under "Show every slot"']);
  if (slot.license) rows.push(['Licence', licenceWords(slot.license)]);
  if (slot.description) rows.push(['About', slot.description]);
  return rows;
}

/** A licence record ({ spdx, author, url } or a string) in a line. */
export function licenceWords(l) {
  if (typeof l === 'string') return l;
  if (!l || typeof l !== 'object') return '';
  const id = l.spdx ?? l.license ?? l.id ?? l.name ?? '';
  return [id, l.author ? `by ${l.author}` : '', l.url ?? ''].filter(Boolean).join(' · ') || JSON.stringify(l);
}

/** A sound's details (its id in the sound list, its bus, where it comes from). */
export function soundDetails(sound) {
  const src = firstSource(sound.src);
  const from = !src ? 'nothing' : src.preset ? `preset "${src.preset}"` : src.file ? src.file : src.zzfx ? 'made from numbers (zzfx)' : src.layers ? `${src.layers.length} layers` : 'other';
  const rows = [['Sound', `sounds.${sound.id}`], ['Plays on', sound.bus], ['Made from', from]];
  if (Array.isArray(sound.src) && sound.src.length > 1) rows.push(['Variations', String(sound.src.length)]);
  if (sound.code) rows.push(['Note', 'the game makes this one in its own code']);
  return rows;
}
