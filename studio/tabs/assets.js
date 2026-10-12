// Art & sound: a gallery of everything the players see and hear (the game's assets.json: its slots and its sound
// list). A picture of each model, image and font; ▶ and a waveform for each sound; the title, tagline and goal on a
// title card you edit in place; colours as swatches. Drop a file on a tile (or press Replace) and the game reloads
// with it: no code change (rules R1–R5 in AGENTS.md). Numbers are the Settings tool's: here only under "Show every
// slot". The pure part (which tile a slot is, the sections, a waveform's peaks) is studio/lib/assets-view.js.
import { el, slider, swatchRow, useStyles } from '../lib/editors/ui.js';
import { ACCEPT, KIND_WORDS, dropProblem, ext, firstSource, inGallery, mono, peaks, sectionCount, sections, sheetCell, sizeWords, slotDetails, soundDetails, soundsOf, tileKind, titleCard } from '../lib/assets-view.js';

// ---------- icons: inline SVG on a 24 x 24 grid, stroked with currentColor (like the tool bar's) ----------
const ICON = {
  model: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  texture: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  font: '<path d="M5 20L11 4h2l6 16M8 14h8"/>',
  data: '<path d="M8 4H6a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
};
const icon = (name, cls = 'ico') => { const s = el('span', { className: cls, 'aria-hidden': 'true' }); s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] ?? ICON.data}</svg>`; return s; };
const EMPTY_ART = '<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="12" width="46" height="36" rx="6"/><circle cx="22" cy="25" r="5"/><path d="M54 40L40 28 14 48"/><path d="M76 16l20 11v22l-20 11-20-11V27z"/><path d="M76 38l20-11M76 38v22M76 38L56 27"/><path d="M14 66h22M44 62v8M50 58v16M56 63v6M62 60v12M68 64v4"/></svg>';

/** The tab's own stylesheet, once per page. */
function useArtStyles() {
  useStyles();
  if (document.querySelector('link[data-art]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: '/studio/tabs/assets.css', 'data-art': '1' }));
}

// ---------- 3D model pictures ----------
// A picture of a .glb, drawn with the game's own three.js (served under /game/) in one small hidden frame of the
// studio's origin (the frame carries the import map three's add-ons need). Made once, on demand, one at a time; null
// when there is no WebGL (a headless browser) or no three.js in the game: the tile then shows its typed icon.
const RIG = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/game/vendor/three/build/three.module.js","three/addons/":"/game/vendor/three/examples/jsm/"}}</script>
<script type="module">
try {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  try { const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js'); loader.setMeshoptDecoder(MeshoptDecoder); } catch {}
  let renderer = null, dead = false;
  const SIZE = 256;
  window.gfThumb = async (bytes, dir) => {
    if (dead) return null;
    if (!renderer) {
      try {
        const c = document.createElement('canvas'); c.width = c.height = SIZE;
        renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE, false); renderer.setClearColor(0x000000, 0);
      } catch { dead = true; return null; }
    }
    const own = new ArrayBuffer(bytes.byteLength); new Uint8Array(own).set(new Uint8Array(bytes));   // this frame's own buffer (the loader checks instanceof)
    const gltf = await loader.parseAsync(own, dir);
    const root = gltf.scene, scene = new THREE.Scene();
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    root.position.sub(centre);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const r = Math.max(size.length() / 2, 1e-3), dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
    cam.position.set(1, 0.65, 1.35).normalize().multiplyScalar(dist);
    cam.near = dist / 100; cam.far = dist * 10; cam.updateProjectionMatrix(); cam.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(3, 5, 4); scene.add(sun);
    renderer.render(scene, cam);
    const pic = renderer.domElement.toDataURL('image/webp', 0.86);
    root.traverse(o => { o.geometry?.dispose?.(); for (const m of [].concat(o.material ?? [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose?.(); } });
    return pic;
  };
} catch (e) { window.gfThumbFailed = String(e && e.message || e); }
</script>`;
let rig = null;
function thumbRig() {
  if (rig) return rig;
  rig = new Promise(resolve => {
    const f = el('iframe', { title: 'model pictures', tabIndex: -1, 'aria-hidden': 'true', className: 'art-rig' });
    f.srcdoc = RIG;
    f.addEventListener('load', () => {
      let n = 0;
      const wait = () => { const w = f.contentWindow; if (w?.gfThumb) resolve(w.gfThumb); else if (w?.gfThumbFailed || ++n > 100) resolve(null); else setTimeout(wait, 50); };
      wait();
    }, { once: true });
    document.body.append(f);
  });
  return rig;
}
// A picture made once is kept in this browser by the model's bytes (a library prop looks the same in every game): a
// convenience only, the tile draws it again when it is not there.
const pictures = new Map();   // file + version → Promise<data URL | null>
let queue = Promise.resolve();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function modelPicture(url) {
  if (!pictures.has(url)) {
    pictures.set(url, (async () => {
      const r = await fetch(url);
      if (!r.ok) return null;
      const bytes = await r.arrayBuffer();
      let key = null;
      try { key = `gf-art-picture:${hex(await crypto.subtle.digest('SHA-256', bytes))}`; const hit = localStorage.getItem(key); if (hit) return hit; } catch {}
      const made = queue.then(async () => { const draw = await thumbRig(); if (!draw) return null; try { return await draw(bytes, new URL('.', new URL(url, location.href)).href); } catch { return null; } });
      queue = made.catch(() => null);
      const pic = await made;
      if (pic && key) try { localStorage.setItem(key, pic); } catch {}
      return pic;
    })().catch(() => null));
  }
  return pictures.get(url);
}

// ---------- sounds: the game's own audio kit (gf-audio, served under /game/audio/) ----------
let soundKit = null;
const loadSoundKit = () => (soundKit ??= (async () => {
  const [zz, snd, pre] = await Promise.all([import('/game/audio/zzfx.mjs'), import('/game/audio/sounds.mjs'), fetch('/game/audio/presets.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))]);
  return { zz, snd, presets: pre.presets ?? {} };
})().catch(() => null));
const RATE = 22050;
/** A sound's samples (its first variation), to draw: a preset or zzfx numbers built here, a file decoded, layers mixed. */
async function samplesOf(sound) {
  const kit = await loadSoundKit();
  if (!kit) return null;
  const leaf = async s => {
    if (!s) return null;
    if (s.layers) {
      const parts = (await Promise.all(s.layers.map(async l => ({ channels: [await leaf(l)], gainDb: l.gainDb, delayMs: l.delayMs })))).filter(p => p.channels[0]);
      return parts.length ? mono(kit.snd.mixLayers(parts, RATE)) : null;
    }
    const zz = s.preset ? kit.presets[s.preset]?.zzfx : s.zzfx;
    if (zz) return kit.zz.buildSamples(zz, { sampleRate: RATE, random: () => 0.5 });
    if (s.file) {
      const r = await fetch(`/game/${s.file}`);
      if (!r.ok) return null;
      const buf = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await r.arrayBuffer());
      const all = mono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)));
      const from = Math.round((s.start ?? 0) * RATE), to = s.end != null ? Math.round(s.end * RATE) : all.length;
      return all.subarray(Math.max(0, from), Math.max(from + 1, Math.min(all.length, to)));
    }
    return null;
  };
  try { return await leaf(firstSource(sound.src)); } catch { return null; }
}
const waves = new Map();      // sound id + its source → Promise<{ peaks, seconds } | null>
function waveOf(sound) {
  const key = `${sound.id}:${JSON.stringify(sound.src)}`;
  if (!waves.has(key)) waves.set(key, samplesOf(sound).then(s => (s?.length ? { peaks: peaks(s, 40), seconds: s.length / RATE } : null)));
  return waves.get(key);
}
function drawWave(canvas, wave) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth || 120, h = canvas.clientHeight || 40;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const css = getComputedStyle(canvas);
  g.fillStyle = css.getPropertyValue('--wave').trim() || '#a99cff';
  const n = wave.peaks.length, step = w / n, bar = Math.max(1.5, step * 0.6);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.06, wave.peaks[i]) * (h / 2 - 2);
    const x = i * step + (step - bar) / 2;
    g.beginPath(); g.roundRect ? g.roundRect(x, h / 2 - v, bar, v * 2, bar / 2) : g.rect(x, h / 2 - v, bar, v * 2); g.fill();
  }
}

export default {
  id: 'assets',
  label: 'Art & sound',
  group: 'Build',
  order: 10,
  icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  async mount(root, ctx) {
    useArtStyles();
    root.classList.add('art');
    let every = false, busy = false, again = false, openColour = null, replaced = null, player = null, playing = null, lastSounds = null;
    const version = new Map();  // file → a number bumped when it changes (a picture made again, an image loaded fresh)
    const ver = f => version.get(f) ?? 0;

    // the head: one line, the "every slot" switch, the jump row
    const toggle = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Show every slot' });
    toggle.addEventListener('change', () => { every = toggle.checked; render(); });
    const count = el('span', { className: 'muted small art-count' });
    const jump = el('nav', { className: 'art-jump', 'aria-label': 'Sections' });
    const note = el('div', { className: 'live-note art-note', hidden: true, 'aria-live': 'polite' });
    const body = el('div', { className: 'art-body' });
    root.append(
      el('p', { className: 'muted' }, 'Everything the players see and hear. Drop a file on a picture to replace it.'),
      el('div', { className: 'toolbar art-head' }, el('label', { className: 'art-switch' }, toggle, el('span', { className: 'track', 'aria-hidden': 'true' }), 'Show every slot'), count),
      jump, note, body);

    // ---------- saving ----------
    async function save(slot, value) {
      try { await ctx.api('game/slots/value', { id: slot.id, value }); ctx.toast(`${slot.label}: saved. The game reloads with it.`, 'ok'); return true; }
      catch (e) { ctx.toast(e.message, 'error'); render(); return false; }
    }
    async function upload(slot, file, tile) {
      const why = dropProblem(slot, file.name);
      if (why) { ctx.toast(why, 'error'); return; }
      tile?.classList.add('busy');
      try {
        const r = await ctx.api(`game/slots/file?id=${encodeURIComponent(slot.id)}&name=${encodeURIComponent(file.name)}`, file);
        version.set(slot.file, ver(slot.file) + 1);
        replaced = { label: slot.label, file: file.name, bytes: r.bytes };
        ctx.toast(`${slot.label}: replaced with ${file.name}.`, 'ok');
        render();
      } catch (e) { ctx.toast(e.message, 'error'); }
      finally { tile?.classList.remove('busy'); }
    }
    function showNote() {
      note.hidden = !replaced;
      if (!replaced) return;
      const x = el('button', { type: 'button', className: 'chip-x', 'aria-label': 'Dismiss', on: { click: () => { replaced = null; showNote(); } } }, '×');
      note.replaceChildren(icon('check'), el('span', {}, el('strong', {}, `${replaced.label} replaced`), ` with ${replaced.file} (${sizeWords(replaced.bytes)}). Note where it came from and its licence in `, el('code', {}, 'ATTRIBUTION.md'), '.'), x);
    }

    // ---------- pieces of a tile ----------
    const pickedId = () => ctx.selection.get()?.id;
    function askBtn(id, label) {
      return el('button', { type: 'button', className: 'icon small ghost art-ask', title: 'Pick this to ask your session about it', 'aria-label': `Ask your session about ${label}`, 'aria-pressed': String(pickedId() === id), 'data-pick': id,
        on: { click: () => ctx.selection.set(pickedId() === id ? null : { id, label }) } }, icon('ask'));
    }
    function details(rows) {
      return el('details', { className: 'art-info' },
        el('summary', { title: 'Details for your agent', 'aria-label': 'Details' }, icon('info')),
        el('dl', {}, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
    }
    function fallback(kind) {
      return el('div', { className: `art-fallback k-${kind}` }, icon(kind === 'sound' || kind === 'music' ? 'audio' : kind, 'big'), el('span', {}, KIND_WORDS[kind] ?? 'File'));
    }

    // a file slot: its picture, its name, Replace, Show in game, ask, details; a file dropped on it replaces it
    function fileTile(slot, showOf, bodyPic) {
      const kind = tileKind(slot);
      const pic = el('div', { className: `art-pic k-${kind}` });
      const url = `/game/${slot.file}?v=${ver(slot.file)}-${slot.bytes ?? 0}`;
      if (slot.missing) pic.append(fallback(kind), el('span', { className: 'art-missing' }, 'missing'));
      else if (kind === 'image') {
        const img = el('img', { src: url, alt: slot.label, decoding: 'async' });
        img.addEventListener('load', () => {
          const cell = sheetCell(slot, img.naturalWidth, img.naturalHeight);
          if (cell) {   // a sheet of frames: its first frame, big
            const c = el('canvas', { className: 'art-frame', width: Math.round(cell.w), height: Math.round(cell.h), role: 'img', 'aria-label': slot.label });
            c.getContext('2d').drawImage(img, cell.x, cell.y, cell.w, cell.h, 0, 0, c.width, c.height);
            if (cell.w <= 128) c.classList.add('pixel');
            img.replaceWith(c);
            pic.append(el('span', { className: 'art-badge' }, 'first frame'));
          } else if (img.naturalWidth <= 128) img.classList.add('pixel');
        });
        img.addEventListener('error', () => img.replaceWith(fallback(kind)));
        pic.classList.add('checker'); pic.append(img);
      } else if (kind === 'model') {
        pic.append(fallback(kind));
        const use = src => { if (!src) return; const img = el('img', { src, alt: slot.label }); pic.replaceChildren(img); pic.classList.add('drawn'); };
        if (bodyPic && !ver(slot.file)) use(bodyPic);
        else whenSeen(pic, () => modelPicture(url).then(use));
      } else if (kind === 'font') {
        const fam = `gf-art-${slot.id.replace(/[^a-z0-9]/gi, '-')}-${ver(slot.file)}`;
        const sample = el('div', { className: 'art-font' }, el('span', { className: 'aa' }, 'Aa'), el('span', {}, 'The quick fox'));
        pic.append(sample);
        new FontFace(fam, `url("${url}")`).load().then(f => { document.fonts.add(f); sample.style.fontFamily = `"${fam}", var(--font)`; }).catch(() => pic.replaceChildren(fallback(kind)));
      } else if (kind === 'audio') {
        pic.append(fallback(kind));
      } else pic.append(fallback(kind));

      const tile = el('article', { className: `art-tile k-${kind}`, 'data-slot': slot.id });
      const pick = el('input', { type: 'file', accept: ACCEPT[slot.type] ?? `.${ext(slot.file)}`, hidden: true, 'aria-label': `New file for ${slot.label}` });
      pick.addEventListener('change', () => { if (pick.files[0]) upload(slot, pick.files[0], tile); pick.value = ''; });
      const show = showOf.get(slot.id);
      tile.append(
        pic,
        el('div', { className: 'art-name' }, el('span', { className: 'label' }, slot.label), el('span', { className: 'what' }, `${KIND_WORDS[kind] ?? 'File'}${slot.scope === 'player' ? ' · each player' : ''}`)),
        el('div', { className: 'art-actions' },
          el('button', { type: 'button', className: 'ghost small art-replace', on: { click: () => pick.click() } }, icon('upload'), 'Replace'),
          show ? el('button', { type: 'button', className: 'icon small ghost', title: 'Show it in the game', 'aria-label': `Show ${slot.label} in the game`, on: { click: () => ctx.preview.show(`/game/${show}`) } }, icon('eye')) : null,
          askBtn(slot.id, slot.label)),
        details(slotDetails(slot)), pick);
      // drop a file on it
      tile.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); tile.classList.add('drop'); } });
      tile.addEventListener('dragleave', e => { if (!tile.contains(e.relatedTarget)) tile.classList.remove('drop'); });
      tile.addEventListener('drop', e => { e.preventDefault(); tile.classList.remove('drop'); const f = e.dataTransfer?.files?.[0]; if (f) upload(slot, f, tile); });
      return tile;
    }

    // a sound of the game's sound list: ▶, its waveform, its name
    function soundTile(sound) {
      const canvas = el('canvas', { className: 'art-wave', 'aria-hidden': 'true' });
      const btn = el('button', { type: 'button', className: 'art-play', 'aria-label': `Play ${sound.label}`, title: 'Play it' }, icon('play'));
      const tile = el('article', { className: `art-tile art-sound k-${sound.kind}`, 'data-sound': sound.id });
      let seconds = 0.4;
      btn.addEventListener('click', () => playSound(sound, tile, () => seconds));
      tile.append(
        el('div', { className: 'art-pic art-wavebox' }, btn, canvas),
        el('div', { className: 'art-name art-name-row' },
          el('div', { className: 'txt' }, el('span', { className: 'label' }, sound.label), el('span', { className: 'what' }, `${KIND_WORDS[sound.kind]}${sound.loop ? ' · loops' : ''}`)),
          askBtn(`sounds.${sound.id}`, sound.label), details(soundDetails(sound))));
      whenSeen(canvas, () => waveOf(sound).then(w => { if (!w) { canvas.replaceWith(el('span', { className: 'muted small art-nowave' }, 'no waveform')); return; } seconds = w.seconds; tile.style.setProperty('--dur', `${Math.max(0.15, w.seconds)}s`); drawWave(canvas, w); }));
      return tile;
    }
    async function playSound(sound, tile, seconds) {
      if (playing?.tile === tile) { player?.stop(sound.id, 0.05); stopShown(); return; }
      try {
        if (!player) {
          const [mod, kit, manifest] = await Promise.all([import('/game/audio/audio.js'), loadSoundKit(), lastSounds ? Promise.resolve(lastSounds) : fetchSounds()]);
          player = mod.createAudio(manifest ?? { sounds: {} }, { presets: kit?.presets ?? {}, baseUrl: new URL('/game/', location.href).href });
        }
        await player.unlock();
        await player.ready;
        stopShown();
        player.play(sound.id);
        tile.classList.add('playing');
        tile.querySelector('.art-play').replaceChildren(icon('stop'));
        const t = setTimeout(stopShown, Math.min(30, sound.loop ? 30 : seconds()) * 1000 + 150);
        playing = { tile, t, id: sound.id };
      } catch (e) { ctx.toast(`This sound could not play here: ${e.message}`, 'error'); }
    }
    function stopShown() {
      if (!playing) return;
      clearTimeout(playing.t);
      playing.tile.classList.remove('playing');
      playing.tile.querySelector('.art-play')?.replaceChildren(icon('play'));
      playing = null;
    }
    const fetchSounds = () => fetch(`/game/assets.json?t=${Date.now()}`).then(r => (r.ok ? r.json() : null)).then(j => j?.sounds ?? null).catch(() => null);

    // colours: a swatch chip each; a click opens the swatches under it
    function colourGrid(list) {
      const grid = el('div', { className: 'art-colours' });
      for (const s of list) {
        const many = tileKind(s) === 'colours';
        const values = many ? (Array.isArray(s.value) ? s.value : []) : [s.value];
        const chip = el('div', { className: `art-colour${many ? ' many' : ''}`, 'data-slot': s.id, title: s.label });
        const dots = el('span', { className: 'dots' });
        values.forEach((c, i) => {
          const open = openColour?.id === s.id && openColour.i === i;
          dots.append(el('button', { type: 'button', className: 'dot-pick', style: { background: c }, title: many ? `${s.label}: ${i + 1}` : s.label, 'aria-label': many ? `${s.label}, number ${i + 1}: ${c}` : `${s.label}: ${c}`, 'aria-expanded': String(open),
            on: { click: () => { openColour = open ? null : { id: s.id, i }; render(); } } }));
        });
        const name = el('span', { className: 'label' }, s.label);
        name.addEventListener('click', () => { openColour = openColour?.id === s.id ? null : { id: s.id, i: 0 }; render(); });
        chip.append(dots, name);
        if (openColour?.id === s.id) chip.classList.add('open');
        grid.append(chip);
        if (openColour?.id === s.id && openColour.i < values.length) {
          const i = openColour.i, cur = values[i];
          const editor = el('div', { className: 'art-colour-edit' },
            el('div', { className: 'edit-head' }, el('span', { className: 'small grow' }, el('strong', {}, s.label), many ? ` · ${s.scope === 'player' ? 'player' : 'number'} ${i + 1}` : ''), askBtn(s.id, s.label), details(slotDetails(s))),
            swatchRow(/^#[0-9a-f]{6}$/i.test(cur ?? '') ? cur.toLowerCase() : cur, async c => {
              const next = many ? values.map((v, j) => (j === i ? c : v)) : c;
              if (await save(s, next)) render();
            }, { label: s.label }));
          grid.append(editor);
        }
      }
      return grid;
    }

    // the title card: the game's name, tagline and goal as the players see them, edited where they are
    function titleCardView(card, accent) {
      const field = (slot, cls) => {
        const max = slot.constraints?.maxLength;
        const span = el('span', { className: `art-edit ${cls}`, role: 'textbox', 'aria-label': slot.label, title: `${slot.label}: click to edit`, 'data-slot': slot.id }, String(slot.value ?? ''));
        try { span.contentEditable = 'plaintext-only'; } catch { span.contentEditable = 'true'; }
        span.spellcheck = false;
        span.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } if (e.key === 'Escape') { span.textContent = String(slot.value ?? ''); span.blur(); } });
        span.addEventListener('input', () => { if (max && span.textContent.length > max) { span.textContent = span.textContent.slice(0, max); const r = document.createRange(); r.selectNodeContents(span); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } });
        span.addEventListener('blur', async () => { const v = span.textContent.replace(/\s+/g, ' ').trim(); if (v === String(slot.value ?? '')) return; if (!v) { span.textContent = String(slot.value ?? ''); return; } if (await save(slot, v)) slot.value = v; });
        return span;
      };
      const [hook, goal] = card.lines;
      const box = el('div', { className: 'art-card' },
        el('div', { className: 'art-card-screen' },
          field(card.title, 'title'),
          hook ? field(hook, 'hook') : null,
          goal ? el('div', { className: 'goal' }, el('span', { className: 'goal-k' }, 'Goal'), field(goal, 'goal-v')) : null,
          el('span', { className: 'art-card-btn', 'aria-hidden': 'true' }, 'Play')),
        el('div', { className: 'art-card-foot muted small' }, icon('pencil'), 'Click any words to change them', el('span', { className: 'grow' }), askBtn(card.title.id, card.title.label),
          details([card.title, ...card.lines].map(s => [s.label, s.id]))));
      if (accent) box.style.setProperty('--card-accent', accent);
      return box;
    }

    // words that are not on the card, and (under "Show every slot") the numbers, switches and choices
    function textRow(s) {
      const max = s.constraints?.maxLength;
      const i = el('input', { type: 'text', value: s.value ?? '', 'aria-label': s.label, maxLength: max || null });
      i.addEventListener('change', () => save(s, i.value));
      return el('div', { className: 'art-text', 'data-slot': s.id }, el('label', { className: 'field-label' }, s.label), el('div', { className: 'art-text-edit' }, i, askBtn(s.id, s.label), details(slotDetails(s))));
    }
    function settingRow(s) {
      const v = s.value, c = s.constraints ?? {};
      let edit;
      if (s.type === 'number' || s.type === 'integer') return el('div', { className: 'art-setting', 'data-slot': s.id }, slider(s, v, (val, done) => { if (done) save(s, val); }, { typed: 'raw' }), details(slotDetails(s)));
      if (s.type === 'boolean') { edit = el('input', { type: 'checkbox', checked: !!v, role: 'switch', 'aria-label': s.label }); edit.addEventListener('change', () => save(s, edit.checked)); }
      else if (s.type === 'enum' || Array.isArray(c.enum)) {
        edit = el('select', { 'aria-label': s.label });
        for (const o of c.options ?? c.enum ?? []) { const val = o && typeof o === 'object' ? o.value : o; edit.append(el('option', { value: String(val), selected: String(val) === String(v) }, o?.label ?? String(val))); }
        edit.addEventListener('change', () => save(s, edit.value));
      } else if (/^world\.[a-z0-9-]+\.layout$/.test(s.id) || (s.id === 'world.map' && c.editor === 'tilemap')) {
        // the level itself: never raw data here, the World tool draws it
        edit = el('button', { type: 'button', className: 'ghost small' }, 'Edit it in World');
        edit.addEventListener('click', () => { location.hash = 'map'; });
      } else edit = el('span', { className: 'muted small' }, Array.isArray(v) ? `a list of ${v.length}` : v && typeof v === 'object' ? 'a set of values' : String(v ?? ''));
      return el('div', { className: 'row art-setting', 'data-slot': s.id }, el('div', { className: 'name' }, s.label), el('div', { className: 'edit' }, edit, details(slotDetails(s))));
    }

    // lazily: a picture or a waveform is made when its tile is first on screen
    // (and the rest soon after, in order: a phone's long page or a quick scroll finds them made)
    const pending = new Set();
    const fire = node => { if (!pending.delete(node)) return; seen.unobserve(node); node.__seen?.(); };
    const seen = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) fire(e.target); }, { rootMargin: '300px' });
    function whenSeen(node, fn) { node.__seen = fn; pending.add(node); seen.observe(node); }
    let rest = null;
    const drawRest = () => { clearTimeout(rest); rest = setTimeout(() => { for (const n of [...pending]) if (n.isConnected) fire(n); else pending.delete(n); }, 700); };

    async function render() {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const [r, manifest, bodies] = await Promise.all([
          ctx.api(`game/slots${every ? '?all=1' : ''}`),
          fetchSounds(),
          ctx.api('editors/bodies').catch(() => null),
        ]);
        lastSounds = manifest;
        if (player && manifest) try { player.update(manifest); } catch {}
        const showOf = new Map();
        for (const s of r.showcase ?? []) for (const id of s.slots ?? []) showOf.set(id, s.query);
        // a body from the kit's library already has a picture (the Characters tool's): use it
        const bodyPic = new Map();
        const cur = bodies?.bodies?.find(b => b.id === bodies.current);
        if (cur?.preview && bodies.slotFile) bodyPic.set(bodies.slotFile, cur.preview);
        const sounds = soundsOf(manifest);
        const slots = every ? r.slots : r.slots.filter(inGallery);
        const card = titleCard(slots);
        const secs = sections({ slots, groups: r.groups, sounds, every, card });
        const accentSlot = r.slots.find(s => s.id === 'ui.accent') ?? r.slots.find(s => s.id === 'look.palette.accent');
        const accent = /^#[0-9a-f]{6}$/i.test(accentSlot?.value ?? '') ? accentSlot.value : null;

        const shown = slots.length;
        count.textContent = every ? `${r.slots.length} slots · ${sounds.length} sounds` : `${shown} of ${r.total} slots · ${sounds.length} sounds`;
        stopShown();
        body.replaceChildren();
        jump.replaceChildren();
        if (card) {
          body.append(el('section', { className: 'art-sec', id: 'art-sec-title' }, el('h3', {}, 'Title screen'), titleCardView(card, accent)));
          jump.append(el('a', { href: '#art-sec-title', className: 'art-jumpchip', on: { click: e => { e.preventDefault(); root.querySelector('#art-sec-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, 'Title'));
        }
        for (const sec of secs) {
          const id = `art-sec-${sec.id}`;
          const node = el('section', { className: 'art-sec', id }, el('h3', {}, sec.label, el('span', { className: 'n' }, String(sectionCount(sec)))));
          if (sec.files.length) node.append(el('div', { className: 'art-grid' }, sec.files.map(s => fileTile(s, showOf, bodyPic.get(s.file)))));
          if (sec.sounds.length) node.append(el('div', { className: 'art-grid sounds' }, sec.sounds.map(soundTile)));
          if (sec.colours.length) node.append(colourGrid(sec.colours));
          if (sec.texts.length) node.append(el('div', { className: 'art-texts' }, sec.texts.map(textRow)));
          if (sec.settings.length) node.append(el('div', { className: 'art-settings' }, el('div', { className: 'muted small' }, 'Numbers and switches (the Settings tool has these too)'), sec.settings.map(settingRow)));
          body.append(node);
          jump.append(el('a', { href: `#${id}`, className: 'art-jumpchip', on: { click: e => { e.preventDefault(); root.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } }, sec.label, el('span', { className: 'n' }, String(sectionCount(sec)))));
        }
        jump.hidden = jump.childElementCount < 3;
        if (!card && !secs.length) {
          const art = el('div', { className: 'art-empty-pic', 'aria-hidden': 'true' }); art.innerHTML = EMPTY_ART;
          body.append(el('div', { className: 'empty art-empty' }, art, el('p', {}, 'This game has no pictures, models or sounds to change here yet.'),
            every ? null : el('button', { type: 'button', className: 'ghost', on: { click: () => { toggle.checked = true; every = true; render(); } } }, 'Show every slot')));
        }
        showNote();
        drawRest();
      } catch (e) { body.replaceChildren(el('p', { className: 'error-box' }, e.message)); }
      finally { busy = false; if (again) { again = false; render(); } }
    }
    await render();

    let t = null;
    const offSel = ctx.selection.onChange(sel => { for (const n of root.querySelectorAll('[data-pick]')) n.setAttribute('aria-pressed', String(n.dataset.pick === sel?.id)); });
    const offGame = ctx.on('game', ({ files = [] }) => {
      if (files.length && files.every(f => f.startsWith('evidence/'))) return;
      for (const f of files) version.set(f, ver(f) + 1);   // a file changed on disk: its picture is made again
      clearTimeout(t); t = setTimeout(render, 200);
    });
    return () => { offSel(); offGame(); seen.disconnect(); clearTimeout(rest); stopShown(); try { player?.destroy(); } catch {} player = null; };
  },
};
