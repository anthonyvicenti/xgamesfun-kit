// gf-three assets: every visible thing loads through a slot (CONTRACT §2.1). Reads go through gf/gf-assets.js, so
// Studio's overrides (__GF_ASSET_OVERRIDES), packed mode (__GF_FILES) and __GF_ASSETS_SEEN all work unchanged.
//
//   import { assets } from './gf/three/assets/assets.js';
//   await assets.init({ renderer });                    // the kit does this at boot
//   const tree = await assets.model('prop.ball', { fit: 0.45 });  // a clone; every mesh tagged userData.gfSlot
//   const tex  = await assets.texture('world.backyard.ground');
//   const v    = assets.value('look.sun.intensity');
//   const cfg  = assets.config('game');
//   assets.tag(mesh, 'look.sky.top');                    // a kit primitive whose material is a slot (R1)
//   assets.coverage(scene)  → { meshes, tagged, exempt, untagged: [{name, path, type}] }
//
// Player looks (CONTRACT §6e): slots with `scope: "player"` resolve per player. Pass the player and get that player's
// loadout value or file when they have one, else the game's:
//   assets.value('mechanic.projectile.color', '#fff', { player: p })   assets.model('character.body.player', { player: p })
//   assets.setLoadout(playerId, loadout)   assets.loadout(playerId)   assets.own(slotId, p)   assets.onLoadout(fn)
//
// A slot whose file is missing is an error, never a silent fallback (an `optional` slot returns null instead). A
// player's own file that fails (unreachable, over the slot's budget, not a model) is dropped for that player and the
// game's file is used: a loadout is never fatal.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as gf from '../../gf-assets.js';
import { getPointer } from '../../gf-assets.js';
import { validateLoadout, loadoutKey, playerLookSlots, isEmpty } from './loadout.js';

const S = { manifest: null, slots: new Map(), files: new Map(), configs: new Map(), renderer: null, gltf: new Map(), tex: new Map(), ext: new Map(), extTex: new Map(), loader: null, ktx2: null, ready: false };
// loadouts (CONTRACT §6e): the player-look slots, and per player {loadout, key, advertised, dropped, rejected}
const L = { looks: new Map(), of: new Map(), fns: [] };
const pid = p => (p !== null && typeof p === 'object' ? p.id : p);
const notify = id => { for (const fn of L.fns.slice()) { try { fn(id); } catch (e) { console.error(e); } } };
const isUrl = f => /^https?:\/\//i.test(f);
async function fetchBytes(url, max) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const n = Number(res.headers.get('content-length'));
  if (max && n > max) throw new Error(`${n} bytes is over the slot's ${max}-byte budget`);
  return res.arrayBuffer();
}
const DRAWABLE = o => o.isMesh || o.isSprite || o.isPoints || o.isLine;
const vendorBase = () => new URL('vendor/three/examples/jsm/', globalThis.document?.baseURI ?? 'http://x/').href;

function gltfLoader() {
  if (S.loader) return S.loader;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const draco = new DRACOLoader(); draco.setDecoderPath(vendorBase() + 'libs/draco/gltf/'); loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2Loader());
  // Studio blocks fetch() even of blob: URLs; images inside a GLB load through an <img> instead (asset-manifest §3).
  loader.register(p => { p.textureLoader = new THREE.TextureLoader(p.options.manager); return { name: 'gf_img_textures' }; });
  return (S.loader = loader);
}
function ktx2Loader() {
  if (S.ktx2) return S.ktx2;
  const k = new KTX2Loader(); k.setTranscoderPath(vendorBase() + 'libs/basis/');
  if (S.renderer) k.detectSupport(S.renderer);
  return (S.ktx2 = k);
}

function slotOf(id) {
  const s = S.slots.get(id);
  if (!s) throw new Error(`gf-three assets: no slot "${id}" in assets.json`);
  return s;
}

/** A loaded GLB → a clone (SkeletonUtils when skinned) with every drawable tagged with the slot; fit and ground. */
function build(id, gltf, { fit = null, fitAxis = 'max', ground = fit !== null } = {}, file = null) {
  let skinned = false; gltf.scene.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
  const scene = skinned ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
  const root = new THREE.Group(); root.name = id; root.add(scene);
  root.animations = gltf.animations;
  root.userData.gfFile = file;                    // which file this copy draws (the slot's, or a player's own)
  if (fit !== null || ground) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true), size = box.getSize(new THREE.Vector3());
    const span = fitAxis === 'y' ? size.y : Math.max(size.x, size.y, size.z);
    const k = fit !== null && span > 1e-6 ? fit / span : 1;
    scene.scale.multiplyScalar(k);
    if (ground) { const c = box.getCenter(new THREE.Vector3()); scene.position.set(-c.x * k, -box.min.y * k, -c.z * k); }
    root.userData.gfSize = size.multiplyScalar(k).toArray();
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return assets.tag(root, id);
}
/** A player's own model (an https URL or a path inside the game): parsed once per URL, within the slot's budget. */
function externalGltf(s, file) {
  if (!S.ext.has(file)) S.ext.set(file, (async () => {
    const max = s.constraints?.maxBytes;
    const buf = isUrl(file) ? await fetchBytes(file, max) : await gf.bytes(file);
    if (max && buf.byteLength > max) throw new Error(`${buf.byteLength} bytes is over the slot's ${max}-byte budget`);
    const path = file.split(/[?#]/)[0], base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const g = await gltfLoader().parseAsync(buf, new URL(base, globalThis.document?.baseURI ?? 'http://x/').href);
    let meshes = 0; g.scene.traverse(o => { if (o.isMesh) meshes++; });
    if (!meshes) throw new Error('the file has no meshes');
    return g;
  })());
  return S.ext.get(file);
}
/** A player's own texture or image file, once per URL. */
function externalTexture(s, file) {
  if (!S.extTex.has(file)) S.extTex.set(file, (async () => {
    const ext = file.split(/[?#]/)[0].split('.').pop().toLowerCase();
    let t;
    if (ext === 'ktx2') { const buf = isUrl(file) ? await fetchBytes(file, s.constraints?.maxBytes) : await gf.bytes(file); t = await new Promise((ok, no) => ktx2Loader().parse(buf, ok, no)); }
    else t = await new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(isUrl(file) ? file : gf.url(file));
    t.colorSpace = s.constraints?.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = S.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    t.userData.gfSlot = s.id; t.userData.gfFile = file;
    return t;
  })());
  return S.extTex.get(file);
}

export const assets = {
  /** Load assets.json and every JSON file a value slot points into (config/*.json), so value() and config() are synchronous. */
  async init({ renderer = null, configs = ['game', 'look', 'world', 'characters'] } = {}) {
    S.renderer = renderer;
    S.manifest = await gf.manifest();
    for (const s of S.manifest.slots ?? []) S.slots.set(s.id, s);
    L.looks = playerLookSlots(S.manifest.slots ?? []);
    const files = new Set(configs.map(n => `config/${n}.json`));
    for (const s of S.slots.values()) if (s.source?.pointer !== undefined && /\.json$/i.test(s.source.file)) files.add(s.source.file);
    await Promise.all([...files].map(async f => { S.files.set(f, await gf.json(f)); }));
    for (const n of configs) S.configs.set(n, S.files.get(`config/${n}.json`));
    S.ready = true;
    return this;
  },
  setRenderer(r) { S.renderer = r; if (S.ktx2) S.ktx2.detectSupport(r); },
  get manifest() { return S.manifest; },
  /** The slot's definition from assets.json (throws on an unknown id). */
  slot: slotOf,
  has: id => S.slots.has(id),
  /** Every slot id, optionally those starting with a prefix. */
  ids: (prefix = '') => [...S.slots.keys()].filter(k => k.startsWith(prefix)),
  /** The file a slot reads (its source.file). */
  file: id => slotOf(id).source.file,
  /** A URL for a slot's file (Image, Audio): Studio's replaced file when there is one; opts.player: their own file. */
  url: (id, opts) => { const own = opts?.player != null ? assets.ownFile(id, opts.player) : null; return own && isUrl(own) ? own : gf.url(own ?? slotOf(id).source.file); },

  /** A whole config file (config/<name>.json) with Studio's patches applied. */
  config(name) {
    const c = S.configs.get(name) ?? S.files.get(`config/${name}.json`);
    if (c === undefined) throw new Error(`gf-three assets: config/${name}.json was not loaded`);
    return c;
  },
  /** A value slot's current value (overrides applied). opts.player: that player's value, their loadout's for a
   *  player-look slot, else the game's; a `colors` slot (one per seat) gives the player's own entry (by p.seat). */
  value(id, fallback, opts) {
    const s = S.slots.get(id);
    if (!s) { if (fallback !== undefined) return fallback; throw new Error(`gf-three assets: no slot "${id}"`); }
    if (s.source?.pointer === undefined) throw new Error(`gf-three assets: "${id}" is a file slot; use model() or texture()`);
    const player = opts?.player ?? null;
    if (player !== null) { const own = assets.own(id, player); if (own !== undefined) return own; }
    const doc = S.files.get(s.source.file);
    if (doc === undefined) throw new Error(`gf-three assets: ${s.source.file} was not loaded`);
    const v = getPointer(doc, s.source.pointer);
    if (player !== null && s.type === 'colors' && Array.isArray(v) && v.length && typeof player === 'object') return v[(Number(player.seat) || 0) % v.length] ?? fallback;
    return v === undefined ? fallback : v;
  },

  // ---- player looks and loadouts (CONTRACT §6e) ----
  /** The slot ids that resolve per player (`scope: "player"`). */
  playerLooks: () => [...L.looks.keys()],
  isPlayerLook: id => L.looks.has(id),
  /** Set (or clear, with null) a player's loadout. It is checked against the player-look slots; what doesn't fit is
   *  dropped, never fatal. opts.key: the key the owner advertised, when it came over the net.
   *  → { key, loadout, dropped, changed } */
  setLoadout(player, raw, { key = null } = {}) {
    const id = pid(player), prev = L.of.get(id) ?? null;
    const { loadout, dropped } = raw == null ? { loadout: { values: {}, files: {} }, dropped: [] } : validateLoadout(raw, L.looks);
    const k = loadoutKey(loadout), changed = (prev?.key ?? '') !== k;
    L.of.set(id, { loadout, key: k, advertised: key ?? k, dropped, rejected: changed || !prev ? new Map() : prev.rejected });
    if (changed) notify(id);
    return { key: k, loadout, dropped, changed };
  },
  /** A player's record { loadout, key, advertised, dropped, rejected } or null. */
  loadout: player => L.of.get(pid(player)) ?? null,
  /** Forget a player's loadout (they left). */
  clearLoadout(player) { const id = pid(player), had = L.of.get(id); L.of.delete(id); if (had?.key) notify(id); },
  /** The player's own value for a player-look slot (undefined when the game's applies). */
  own(id, player) { if (!L.looks.has(id)) return undefined; const r = L.of.get(pid(player)); return r && !isEmpty(r.loadout) ? r.loadout.values[id] : undefined; },
  /** The player's own file (a URL or a game path) for a player-look file slot, unless it already failed for them. */
  ownFile(id, player) { if (!L.looks.has(id)) return null; const r = L.of.get(pid(player)); const f = r?.loadout.files[id]; return f && !r.rejected.has(id) ? f : null; },
  /** The file this player draws for a slot: their own, else the slot's. */
  fileFor: (id, player = null) => (player !== null ? assets.ownFile(id, player) : null) ?? slotOf(id).source.file,
  /** A player's own file failed: it is dropped for them and the game's file is used. */
  reject(player, id, why) {
    const r = L.of.get(pid(player)); if (!r || r.rejected.has(id)) return;
    r.rejected.set(id, String(why).slice(0, 200));
    console.warn(`gf-three loadout: ${pid(player)}'s ${id} was dropped (${why}); the game's own is used`);
    notify(pid(player));
  },
  /** fn(playerId) whenever a player's loadout changes (or one of its files is dropped). → unsubscribe */
  onLoadout(fn) { L.fns.push(fn); return () => { const i = L.fns.indexOf(fn); if (i >= 0) L.fns.splice(i, 1); }; },

  /**
   * A model slot's GLB, cloned (SkeletonUtils.clone when skinned) with every drawable tagged userData.gfSlot.
   * Options: fit (metres: the largest side, or the height with fitAxis 'y'), fitAxis, ground (feet at y = 0, centred in
   * x and z; the default when fitting). Returns a THREE.Group whose `animations` are the GLB's clips; null for an
   * optional slot whose file is absent.
   */
  async model(id, opts = {}) {
    const s = slotOf(id);
    if (s.type !== 'model') throw new Error(`gf-three assets: "${id}" is a ${s.type} slot, not a model`);
    // opts.player: that player's own file (their loadout), within the slot's budget; on any failure the game's file
    // (opts.ownOnly: null instead, when the player has no own file or it failed)
    const player = opts.player ?? null, own = player !== null ? assets.ownFile(id, player) : null;
    if (own) {
      try { return build(id, await externalGltf(s, own), opts, own); }
      catch (e) { assets.reject(player, id, e.message); }
    }
    if (opts.ownOnly) return null;
    const file = s.source.file;
    if (!S.gltf.has(id)) {
      S.gltf.set(id, (async () => {
        if (s.optional && !(await gf.exists(file))) return null;
        const buf = await gf.bytes(file);
        const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
        return gltfLoader().parseAsync(buf, new URL(base, globalThis.document?.baseURI ?? 'http://x/').href);
      })());
    }
    const gltf = await S.gltf.get(id).catch(e => { S.gltf.delete(id); throw new Error(`gf-three assets: ${id} (${file}) failed to load: ${e.message}`); });
    if (!gltf) return null;
    return build(id, gltf, opts, file);
  },

  /** A texture slot (KTX2, PNG, JPG, WebP; HDR through HDRLoader is left to the look module). Cached per slot; null for an
   *  optional slot whose file is absent. opts.player: that player's own file, else the slot's. */
  async texture(id, { repeat = null, player = null } = {}) {
    const s = slotOf(id);
    if (!['texture', 'image'].includes(s.type)) throw new Error(`gf-three assets: "${id}" is a ${s.type} slot, not a texture`);
    const own = player !== null ? assets.ownFile(id, player) : null;
    if (own) {
      try {
        const t = await externalTexture(s, own);
        if (repeat === null) return t;
        const c = t.clone(); c.repeat.set(...[].concat(repeat, repeat).slice(0, 2)); c.needsUpdate = true; c.userData.gfSlot = id; return c;
      } catch (e) { assets.reject(player, id, e.message); }
    }
    const file = s.source.file, ext = file.split('.').pop().toLowerCase();
    if (!S.tex.has(id)) {
      S.tex.set(id, (async () => {
        if (s.optional && !(await gf.exists(file))) return null;
        let tex;
        if (ext === 'ktx2') { const buf = await gf.bytes(file); tex = await new Promise((ok, no) => ktx2Loader().parse(buf, ok, no)); }
        else tex = await new THREE.TextureLoader().loadAsync(gf.url(file));
        tex.colorSpace = s.constraints?.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = S.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
        tex.userData.gfSlot = id;
        return tex;
      })());
    }
    const tex = await S.tex.get(id).catch(e => { S.tex.delete(id); throw new Error(`gf-three assets: ${id} (${file}) failed to load: ${e.message}`); });
    if (!tex) return null;
    if (repeat !== null) { const t = tex.clone(); t.repeat.set(...[].concat(repeat, repeat).slice(0, 2)); t.needsUpdate = true; t.userData.gfSlot = id; return t; }
    return tex;
  },

  /** Tag an object and every drawable under it with a slot id (R1: a kit primitive whose material is a slot). */
  tag(object3d, id) {
    object3d.userData.gfSlot = id;
    object3d.traverse(o => { if (DRAWABLE(o)) o.userData.gfSlot ??= id; });
    return object3d;
  },
  /** Mark something visible as not a slot, with the reason (a debug helper, a ray-cast proxy). */
  exempt(object3d, reason) { object3d.userData.gfExempt = String(reason || 'exempt'); return object3d; },

  /** R3: every visible drawable must carry a slot. → { meshes, tagged, exempt, untagged: [{name, path, type}] } */
  coverage(scene) {
    const out = { meshes: 0, tagged: 0, exempt: 0, untagged: [] };
    const exemptOf = o => { for (let p = o; p; p = p.parent) if (p.userData?.gfExempt) return true; return false; };
    scene.traverseVisible(o => {
      if (!DRAWABLE(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.length && mats.every(m => m && m.visible === false)) return;
      out.meshes++;
      if (exemptOf(o)) { out.exempt++; return; }
      if (o.userData.gfSlot) { out.tagged++; return; }
      const path = []; for (let p = o; p && p !== scene; p = p.parent) path.unshift(p.name || p.type);
      if (out.untagged.length < 50) out.untagged.push({ name: o.name || '', path: path.join('/'), type: o.type });
    });
    return out;
  },

  /** What each slot puts in the scene: { [slotId]: { drawables, triangles, onScreen } } (QA: swap proof, previews). */
  stats(scene, camera = null) {
    const out = {}, v = new THREE.Vector3(), box = new THREE.Box3();
    scene.updateMatrixWorld(true);
    scene.traverseVisible(o => {
      if (!DRAWABLE(o) || !o.userData.gfSlot) return;
      const r = (out[o.userData.gfSlot] ??= { drawables: 0, triangles: 0, onScreen: false });
      r.drawables++;
      const g = o.geometry;
      if (g) r.triangles += Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3) * (o.isInstancedMesh ? o.count : 1);
      if (camera && !r.onScreen && g) {
        if (!g.boundingBox) g.computeBoundingBox();
        box.copy(g.boundingBox).applyMatrix4(o.matrixWorld); box.getCenter(v).project(camera);
        if (v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) r.onScreen = true;
      }
    });
    return out;
  },
};
export default assets;
