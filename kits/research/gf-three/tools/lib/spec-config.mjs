// A game spec (research/studio-v2/game-spec.schema.json) → the project's config files, sound list, multiplayer
// manifest and asset choices. Pure apart from reading the libraries (track L's props, track C's bodies) when they
// exist. Deterministic: positions come from a random stream seeded by the spec's title.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY, STANDIN_ASSETS, KIT } from './paths.mjs';
import { createRng, hashString } from '../../kit/core/rng.js';
import { FAIR_DEFAULTS } from '../../kit/core/fair-logic.js';
import { generateLayout } from '../../kit/world/generate.js';

const SIZES = { small: 12, medium: 18, large: 26 };
const SEAT_COLORS = ['#4f7cff', '#ff5ea8', '#3ddc84', '#ffd166', '#b388ff', '#ff8a50', '#4dd0e1', '#e57373'];   // the party page's seat colours
// a prop whose role says players handle it is a gameplay prop (mechanics and rules spawn it), not a layout piece
// (a consumable too: "drink to refill your bladder" is a pickup, never scenery: as scenery it reads as litter and the
// pickup mechanic draws its stand-in gem instead)
const GAMEPLAY = /\b(throw|thrown|carr(y|ied)|hold|held|pick(ed)?\s*up|collect|grab|ammo|projectile|ball|pickup|item|token|coin|weapon|refill(s|ed)?|restores?|replenish(es)?|heals?|consum(e|es|able)|power-?ups?|boosts?)\b/i;

// sound words → gf-audio presets (research/foundations/kits/gf-audio/1.5.0/source/presets.json)
const SOUND_WORDS = [
  [/whoosh|throw|swing|swish|toss/i, 'arrow-whoosh'], [/bonk|boing|bounce|rubber|squish/i, 'bounce'], [/slap|catch|smack|clap/i, 'hit-soft'],
  [/punch|crunch|thud|smash/i, 'hit-crunch'], [/bell|ring|chime|whistle|gong|buzzer|horn/i, 'alarm'], [/coin|collect|pickup|pick up/i, 'coin'],
  [/gem|sparkle/i, 'gem'], [/jump/i, 'jump'], [/land/i, 'land'], [/splash|water|spray|hose|stream|squirt|liquid/i, 'splash'],
  [/explo|boom|blast/i, 'explosion-small'], [/laser|zap/i, 'laser-soft'], [/shoot|pew|shot|fire/i, 'pew-retro'], [/cheer|victory|win|yay/i, 'win'],
  [/lose|fail|game over/i, 'lose'], [/hurt|ouch|ow\b/i, 'hurt'], [/power/i, 'powerup'], [/heal/i, 'heal'], [/door|latch/i, 'door'],
  [/engine|motor/i, 'engine-loop'], [/wind|breeze/i, 'wind-loop'], [/step|footstep/i, 'footstep'], [/alarm|siren/i, 'alarm'], [/click|tap|button/i, 'click'],
  [/count|beep|tick/i, 'countdown'], [/hit|bump/i, 'hit-soft'],
];
/**
 * A declared picture slot whose file the game lacks (a module's own texture, e.g. the look's noise): the library's
 * file of the same name, else the library's soft noise for a noise or pattern slot. → {from, license} or null.
 */
export async function libraryPicture(slot) {
  const base = slot.source.file.split('/').pop();
  for (const rel of [`textures/${base}`, ...(/noise|pattern/i.test(`${slot.id} ${base}`) ? ['textures/noise-soft.png'] : [])])
    if (existsSync(join(LIBRARY, rel))) return { from: join(LIBRARY, rel), license: await libraryLicense(rel, base.replace(/\.[^.]+$/, '')) };
  return null;
}

export function presetFor(s) { const t = `${s.id} ${s.describe ?? ''}`; for (const [re, p] of SOUND_WORDS) if (re.test(t)) return p; return 'hit-soft'; }

async function readJsonMaybe(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }
const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? (v.props ?? v.bodies ?? v.items ?? Object.entries(v).map(([id, x]) => ({ id, ...x }))) : []);

/**
 * The library's prop for a spec prop name. It must match the name itself (the id, a part of the id, or a tag); among
 * those, the one sharing most words with the description wins ("a soft red rubber dodgeball" → ball-red). Ties keep
 * the library's order. null: no match (a stand-in is used).
 */
export async function libraryProp(name, describe) {
  const props = list(await readJsonMaybe(join(LIBRARY, 'props.json')));
  const words = String(describe ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const ok = p => p && typeof p.file === 'string' && /\.glb$/i.test(p.file) && existsSync(join(LIBRARY, p.file));
  let best = null, bestScore = 0;
  for (const p of props) {
    if (!ok(p)) continue;
    const parts = String(p.id).toLowerCase().split(/[^a-z0-9]+/), tags = (p.tags ?? []).map(t => String(t).toLowerCase());
    const named = p.id === name ? 1000 : parts.includes(name) ? 100 : tags.includes(name) ? 50 : 0;
    if (!named) continue;
    const hay = new Set([...parts, ...tags, ...String(p.describe ?? '').toLowerCase().split(/[^a-z0-9]+/)]);
    const score = named + words.filter(w => hay.has(w)).length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}
async function libraryLicense(file, id) {
  const L = await readJsonMaybe(join(LIBRARY, 'LICENSES.json'));
  // { files: { "<library path>": {spdx, author, page} } } (track L's shape), or a list of records
  const hit = (L?.files && !Array.isArray(L.files) ? L.files[file] : null) ?? list(L).find(x => x.file === file || x.id === id);
  return hit ? { spdx: hit.spdx ?? hit.license ?? 'CC0-1.0', author: hit.author ?? hit.by ?? '', url: hit.page ?? hit.url ?? hit.source ?? '' } : null;
}
/**
 * The library's gf-humanoid-1 body for a spec character (track C): the library id asked for, else a bean. For generate
 * and reference, `body.library` (when the pitch names one) is the stand-in until the generated body lands in the slot,
 * and stays if generation fails: a far better fallback than the bean (verify check 14 still counts it as a stand-in until
 * the worker records why it stayed). From library/bodies.json, or by file name in library/bodies/ while that list does
 * not exist yet.
 */
async function libraryBody(body) {
  const bodies = list(await readJsonMaybe(join(LIBRARY, 'bodies.json')));
  const ok = b => b && typeof b.file === 'string' && existsSync(join(LIBRARY, b.file));
  const named = body?.library && ['library', 'generate', 'reference'].includes(body.from);
  if (named) { const b = bodies.find(x => ok(x) && x.id === body.library); if (b) return b; }
  const bean = bodies.find(x => ok(x) && (x.id === 'bean' || x.from === 'bean' || (x.tags ?? []).includes('bean') || /bean/i.test(x.id ?? '')));
  if (bean || bodies.length) return bean ?? bodies.find(ok) ?? null;
  const byFile = id => (existsSync(join(LIBRARY, `bodies/${id}.glb`)) ? { id, file: `bodies/${id}.glb` } : null);
  if (named && byFile(body.library)) return byFile(body.library);
  return byFile('bean-classic') ?? byFile('ual-mannequin');
}


/**
 * spec → { game, look, world, characters, sounds, multiplayer, assets: [{to, from, license, note}], record, notes }
 * modules: the real modules create found ({look, world, character, mechanics}); lookPreset(id, time): values or null.
 */
// A pee stream leaves the hips (creator, 2026-10-07: "have the pee stream start a bit lower towards the lower part of
// their body"): a continuous projectile in a game about peeing gets `muzzle: 'hips'` unless the spec sets it. create
// (here) and upgrade (filling a missing key) both use this, so the choice never rests on the build agent noticing it.
const PEE = /\b(pee|pees|peeing|piss\w*|wee|wees|urin\w*|bladders?|tinkle)\b/i;
export const isPeeGame = spec => PEE.test([spec?.prompt, spec?.title, spec?.hook, ...(spec?.mechanics ?? []).map(m => m.as)].map(x => typeof x === 'string' ? x : JSON.stringify(x ?? '')).join(' '));
/** Spec-derived defaults for one mechanic (under the spec's own params). */
export function specParams(spec, m) {
  if (m.id === 'projectile' && (m.params?.kind ?? 'discrete') === 'continuous' && isPeeGame(spec)) return { muzzle: 'hips' };
  return {};
}

/**
 * Hits read (creator, "Hang Up On Them", 2026-10-07: "The zombies are instant killed to I couldn't even tell what was
 * happened"): an enemy the game's weapon kills in one hit shows nothing between the shot and the kill. So a basic
 * enemy takes 2–4 hits from the default weapon (the projectile's damage, or a stream's per-tick damage): when the
 * spec's damage would kill a wave-1 enemy in one hit, its hit points go up to three hits' worth. Not when the spec
 * asks for one-hit kills (waves `oneHitKills`). Changes `mechanics` in place. → a note, or null
 */
export function enemyToughness(mechanics) {
  const w = mechanics.find(m => m.id === 'waves'), p = mechanics.find(m => m.id === 'projectile');
  if (!w || !p || w.params?.oneHitKills === true || w.params?.hittable === false) return null;
  const stream = (p.params?.kind ?? 'discrete') === 'continuous';
  const dmg = Number(stream ? p.params?.streamDamage : p.params?.damage);
  const hp = Number(w.params?.hp);
  if (!(dmg > 0) || !(hp > 0) || hp > dmg) return null;
  const to = Math.max(2, Math.ceil(dmg * 3));
  w.params.hp = to;
  return `waves: hp ${hp} → ${to}, so an enemy takes 3 hits from the ${stream ? 'stream' : 'shot'} (damage ${dmg}) and each one shows (a health bar, a flash); set waves oneHitKills only when the creator asks for one-hit kills`;
}

export async function specToConfig(spec, { modules, lookPreset = null, lookConfig = null, standinPresetValues, mechanicDefaults = {} }) {
  const notes = [];
  const rng = createRng(hashString(`${spec.title}|layout`));
  const P = spec.players ?? { min: 1, max: 4 };
  const half = SIZES[spec.world?.size ?? 'small'] ?? 12;
  const assets = [];

  // ---- props: layout pieces and gameplay props ----
  const gameProps = [], layoutProps = [], propFiles = {}, named = {};   // named: the spec's prop name → its slot id
  for (const p of spec.world?.props ?? []) (GAMEPLAY.test(`${p.role ?? ''} ${p.name}`) ? gameProps : layoutProps).push(p);
  // with the real world module the layout pieces come from its catalog (realWorld below); here: the gameplay props,
  // and with the stand-in world every prop
  for (const p of spec.world?.props ?? []) {
    if (modules.world && layoutProps.includes(p)) continue;
    const made = p.from === 'generate' || p.from === 'reference';   // the worker makes it (tools/meshy-prop.mjs) and places it here
    const lib = !made ? await libraryProp(p.name, p.describe) : null;
    const to = `assets/models/${p.name}.glb`;
    named[p.name] = `prop.${p.name}`;
    if (lib) {
      const license = await libraryLicense(lib.file, lib.id);
      assets.push({ to, from: join(LIBRARY, lib.file), license });
      propFiles[p.name] = { file: to, from: `library:${lib.id}`, ...(license ? { license } : {}) };
    } else {
      const stand = existsSync(join(STANDIN_ASSETS, `${p.name}.glb`)) ? p.name : 'crate';
      const license = { spdx: 'CC0-1.0', author: 'games.fun (stand-in, research/gf-three/tools/lib/standin-bake.mjs)', url: 'https://games.fun' };
      assets.push({ to, from: join(STANDIN_ASSETS, `${stand}.glb`), license });
      propFiles[p.name] = { file: to, from: `standin:${stand}`, license };
      notes.push(`prop "${p.name}": no library match yet, stand-in ${stand}.glb${made ? ' (the spec asks for a generated model: the Studio worker generates it into this slot; verify check 14 fails while the stand-in stays unrecorded)' : ''}`);
    }
  }
  // the layout: each layout piece `count` times, apart from each other, the spawns and the centre
  const spawns = [];
  const nSpawn = Math.max(2, P.max ?? 4);
  for (let i = 0; i < nSpawn; i++) { const a = Math.PI / 4 + (i / nSpawn) * Math.PI * 2; spawns.push([r2(Math.cos(a) * half * 0.55), 0, r2(Math.sin(a) * half * 0.55)]); }
  const placed = [];
  const free = (x, z, r) => Math.hypot(x, z) > 4 && spawns.every(s => Math.hypot(s[0] - x, s[2] - z) > 3) && placed.every(q => Math.hypot(q.at[0] - x, q.at[2] - z) > r + q.r);
  for (const p of layoutProps) {
    const r = /slide|tree|tower|house|car|table/i.test(p.name) ? 2.2 : 1.4;
    for (let k = 0; k < (p.count ?? 1); k++) {
      let x = 0, z = 0, tries = 0;
      do { const a = rng() * Math.PI * 2, d = half * (0.3 + rng() * 0.5); x = Math.cos(a) * d; z = Math.sin(a) * d; tries++; } while (!free(x, z, r) && tries < 200);
      placed.push({ prop: p.name, at: [r2(x), 0, r2(z)], rot: r2(Math.atan2(-x, -z) + (rng() - 0.5) * 0.8), scale: 1, r });
    }
  }
  const worldProps = placed.map(({ r, ...q }) => q);

  // ---- characters ----
  const roles = {}, bodies = {};
  for (const c of spec.characters ?? [{ role: 'player', body: { from: 'bean' } }]) {
    const to = `assets/models/body-${c.role}.glb`;
    const lib = modules.character ? await libraryBody(c.body) : null;
    if (lib) {
      // the body's own licence record (library/bodies.json), else library/LICENSES.json
      const rec = lib.license ?? lib.licence ?? null;
      const license = rec ? { spdx: rec.spdx, author: rec.author, url: rec.url ?? rec.page ?? '' } : await libraryLicense(lib.file, lib.id);
      if (!license) notes.push(`character "${c.role}": body ${lib.id} has no licence record in library/bodies.json`);
      assets.push({ to, from: join(LIBRARY, lib.file), license }); bodies[c.role] = { file: to, from: `library:${lib.id}`, ...(license ? { license } : {}) };
      if (c.body?.from === 'generate' || c.body?.from === 'reference') notes.push(`character "${c.role}": ${lib.id} stands in until the Studio worker places the generated body (verify check 14 fails while it stays unrecorded)`);
    }
    else {
      const license = { spdx: 'CC0-1.0', author: 'Quaternius', url: 'https://quaternius.itch.io/universal-animation-library' };
      assets.push({ to, from: join(STANDIN_ASSETS, 'mannequin.glb'), license });
      bodies[c.role] = { file: to, from: 'standin:mannequin', license };
      notes.push(`character "${c.role}": body from ${c.body?.from ?? '?'} is not available yet (track C), stand-in UAL mannequin${c.body?.from === 'generate' || c.body?.from === 'reference' ? '; the worker generates into this slot' : ''}`);
    }
    // a hat (character.hat.<role>, worn on the head socket): a stand-in cap until a library hat or a generated one exists
    let hat = null;
    if (c.hat) {
      hat = `assets/models/hat-${c.role}.glb`;
      const variant = /backward|reverse/i.test(c.hat) ? 'cap-backwards' : 'cap';
      assets.push({ to: hat, from: join(STANDIN_ASSETS, `${variant}.glb`), license: { spdx: 'CC0-1.0', author: 'games.fun (stand-in, research/gf-three/tools/lib/standin-bake.mjs)', url: 'https://games.fun' } });
      bodies[`${c.role}.hat`] = { file: hat, from: `standin:${variant}`, describe: c.hat, license: { spdx: 'CC0-1.0', author: 'games.fun (stand-in)', url: 'https://games.fun' } };
      notes.push(`character "${c.role}": hat "${c.hat}" is a stand-in ${variant}.glb (Studio generates or uploads into character.hat.${c.role})`);
    }
    roles[c.role] = { body: to, height: 1.7, ...(hat ? { hat, hatDescribe: c.hat } : {}), ...(c.describe ? { describe: c.describe } : {}), ...(bodies[c.role].license ? { license: bodies[c.role].license } : {}) };
  }
  if (modules.character && existsSync(join(LIBRARY, 'clips/gf-humanoid-1.glb'))) assets.push({ to: 'assets/clips/gf-humanoid-1.glb', from: join(LIBRARY, 'clips/gf-humanoid-1.glb'), license: (await libraryLicense('clips/gf-humanoid-1.glb', 'gf-humanoid-1')) ?? { spdx: 'CC0-1.0', author: 'Quaternius (Universal Animation Library), retargeted by games.fun', url: 'https://quaternius.itch.io/universal-animation-library' } });

  // ---- the ground (stand-in world only: the real world draws its own from colour slots and a noise texture) ----
  if (!modules.world) assets.push({ to: 'assets/textures/ground.ktx2', from: join(STANDIN_ASSETS, 'grass.ktx2'), license: { spdx: 'CC0-1.0', author: 'Poly Haven', url: 'https://polyhaven.com/a/leafy_grass' } });

  // ---- config files ----
  const mechanics = (spec.mechanics ?? []).map(m => ({ id: m.id, ...(m.as ? { as: m.as } : {}), params: { ...(mechanicDefaults[m.id] ?? {}), ...specParams(spec, m), ...(m.params ?? {}) } }));
  const tough = enemyToughness(mechanics);
  if (tough) notes.push(tough);
  const game = {
    schemaVersion: 0,
    title: spec.title,
    hook: spec.hook ?? '',
    text: { title: spec.title, hook: spec.hook ?? '', play: 'Play', again: 'Play again', waiting: 'Waiting for everyone…', you: 'You', wins: '{name} wins!', draw: 'Round over: nobody scored' },
    players: { min: P.min ?? 1, max: P.max ?? 4, bots: P.bots !== false, teams: P.teams ?? 0, mode: P.mode ?? 'versus', botNames: ['Pip', 'Bo', 'Moss', 'Juno', 'Rex', 'Ivy', 'Tam'] },
    round: { seconds: spec.round?.seconds ?? 120, countdown: 3, replay: spec.round?.replay !== false, ...(spec.round?.winBy ? { winBy: spec.round.winBy } : {}), ...(spec.round?.loseBy ? { loseBy: spec.round.loseBy } : {}) },
    camera: spec.camera ?? 'third',
    controller: { speed: 5.2, sprint: 7.4, jump: 7.2, camera: { [spec.camera ?? 'third']: cameraDefaults(spec.camera ?? 'third') } },
    controls: { ...(spec.controls ?? {}) },
    props: gameProps.map(p => ({ name: p.name, describe: p.describe, count: p.count ?? 1, ...(p.role ? { role: p.role } : {}), size: /ball/i.test(p.name) ? 0.44 : 0.6 })),
    mechanics,
    rules: { summary: spec.rules?.summary ?? '', ...(spec.rules?.scoring ? { scoring: spec.rules.scoring } : {}), params: { ...(spec.rules?.params ?? {}) } },
    // fair play (kit/core/fair.js): on by default in every game; each value a fair.* slot the creator tunes in Studio
    fair: { ...FAIR_DEFAULTS },
    ui: { panel: '#1c2133d9', text: '#ffffff', crosshair: '#ffffff' },
  };
  // the real look writes its own config/look.json (the whole preset, every value a slot); the stand-in keeps `values`
  const realLook = lookConfig?.(spec.look?.preset ?? 'jelly-pastel', spec.look?.time ?? 'day');
  const look = realLook ?? { preset: spec.look?.preset ?? 'jelly-pastel', time: spec.look?.time ?? 'day', ...(spec.look?.palette ? { palette: spec.look.palette } : {}), values: lookPreset?.(spec.look?.preset, spec.look?.time) ?? standinPresetValues(spec.look?.preset, spec.look?.time ?? 'day') };
  const lookPlayers = look.palette?.players;
  let world = modules.world ? await realWorld(spec, { spawns, layoutProps, rng, assets, propFiles, notes, named }) : null;
  if (!world) world = {
    template: spec.world?.template ?? 'backyard', size: spec.world?.size ?? 'small', half,
    ground: { texture: 'assets/textures/ground.ktx2', color: '#d4f0b0', repeat: Math.round(half / 1.5), license: { spdx: 'CC0-1.0', author: 'Poly Haven', url: 'https://polyhaven.com/a/leafy_grass' } },
    props: worldProps, spawns, zones: { centre: { shape: 'circle', at: [0, 0, 0], size: [2.5] } }, walls: true,
    ...(spec.world?.notes ? { notes: spec.world.notes } : {}),
  };
  // seat colours (character.tint.<role>): the look's player palette when it has one, else the party page's colours
  const characters = { roles, palette: (Array.isArray(lookPlayers) ? lookPlayers : SEAT_COLORS).slice(0, Math.max(4, P.max ?? 4)), nameplate: { show: true } };

  // ---- sounds: the spec's, then the kit's round sounds ----
  const sounds = { version: 1, sounds: {} };
  for (const s of spec.sounds ?? []) sounds.sounds[s.id] = { label: cap(s.describe ?? s.id), src: { preset: s.preset ?? presetFor(s) } };
  const kitSounds = { 'ui-click': ['Menu click', 'click', 'ui'], 'round-countdown': ['Countdown beep', 'countdown', 'ui'], 'round-go': ['Round starts', 'confirm', 'ui'], 'round-win': ['You won the round', 'win', 'sfx'] };
  // an enemy going down (kit/mechanics/waves soundKill), in games that have enemies
  if (mechanics.some(m => m.id === 'waves')) kitSounds['enemy-down'] = ['An enemy goes down', 'explosion-small', 'sfx'];
  for (const [id, [label, preset, bus]] of Object.entries(kitSounds)) if (!sounds.sounds[id]) sounds.sounds[id] = { label, src: { preset }, ...(bus !== 'sfx' ? { bus } : {}) };

  const multiplayer = {
    schemaVersion: 2, mode: 'live', title: spec.title.slice(0, 60), players: { min: 1, max: Math.min(8, P.max ?? 4) },
    live: {
      entry: 'index.html', seedParam: null, team: P.mode === 'coop', metric: 'score', direction: 'higher', unit: 'pts', maxSeconds: Math.min(3600, (spec.round?.seconds ?? 120) + 30),
      sees: 'Each player sees the others as their character, in their seat colour, with a ring at their feet and their name above.',
      shares: 'The round and its clock, the scores, the bots and everything the rules share (ctx.shared), owned by the host\'s copy',
    },
    check: { near: 2.5, seconds: 60 },
  };
  if (!look.palette?.accent) game.ui.accent = spec.look?.palette?.[0] ?? '#ff7a59';   // the look's accent wins when it has one
  const props = world.__catalog ?? null; delete world.__catalog;
  return { game, look, world, characters, props, sounds, multiplayer, assets, propFiles, named, bodies, notes };
}

/**
 * The real world module (track L): its template's recipe (kit/world/templates/<id>.json) expanded at the spec's size
 * class by kit/world/generate.js (seeded by the title, so each game gets its own rooms and the same ones every time),
 * plus the spec's own layout props it lacks, and config/props.json, the catalog entries the game uses (L's
 * CONTRACT-REQUEST). Every prop the layout places gets its library model copied to assets/models/<id>.glb. null when
 * the template is missing.
 */
async function realWorld(spec, { spawns, layoutProps, rng, assets, propFiles, notes, named }) {
  const T = spec.world?.template ?? 'backyard';
  const tpl = await readJsonMaybe(join(KIT, `world/templates/${T}.json`));
  const lib = await readJsonMaybe(join(LIBRARY, 'props.json'));
  if (!tpl || !lib?.props) { notes.push(`world: the real module has no ${T} template or library/props.json yet; stand-in world`); return null; }
  const byId = new Map(lib.props.map(p => [p.id, p]));
  const size = spec.world?.size ?? 'small';
  const world = generateLayout(tpl, { size, seed: hashString(`${spec.title}|world`) });
  notes.push(`world: ${T} at size ${size}, ${world.size.join(' x ')} m${world.rooms?.length ? `, ${world.rooms.length} rooms (${world.rooms.map(r => r.id).join(', ')})` : ''}${world.entries?.length ? `, entries ${world.entries.map(e => e.name).join(', ')}` : ''}`);
  const [W, D] = world.size ?? [24, 24];
  const sp = (world.spawns ?? spawns).map(s => ({ x: s[0], z: s[2] }));
  // the game's own gameplay props are never scenery: a template ball would look pickable and is not
  const gameNames = (spec.world?.props ?? []).filter(p => !layoutProps.includes(p)).map(p => p.name);
  const isGameplay = id => { const e = byId.get(id); const parts = String(id).split(/[^a-z0-9]+/); return gameNames.some(n => parts.includes(n) || (e?.tags ?? []).includes(n)); };
  const dropped = (world.props ?? []).filter(p => isGameplay(p.prop)).map(p => p.prop);
  if (dropped.length) { world.props = world.props.filter(p => !isGameplay(p.prop)); notes.push(`world: left out the template's ${[...new Set(dropped)].join(', ')} (the game's own ${gameNames.join(', ')} are gameplay props)`); }
  world.scatter = (world.scatter ?? []).filter(s => !isGameplay(s.prop));
  const used = new Map();
  const taken = (world.props ?? []).map(p => ({ x: p.at?.[0] ?? 0, z: p.at?.[2] ?? 0 }));
  // the spec's layout props: the template keeps its own; any count it lacks is placed in the open
  for (const p of layoutProps) {
    const entry = await libraryProp(p.name, p.describe);
    if (!entry) { notes.push(`world: no library prop for "${p.name}"; not placed (the template has its own scenery)`); continue; }
    named[p.name] = `prop.${entry.id}`;
    const have = (world.props ?? []).filter(q => q.prop === entry.id).length;
    for (let k = have; k < (p.count ?? 1); k++) {
      let x = 0, z = 0, ok = false;
      for (let tries = 0; tries < 300 && !ok; tries++) {
        x = (rng() - 0.5) * W * 0.8; z = (rng() - 0.5) * D * 0.8;
        ok = Math.hypot(x, z) > 4 && sp.every(s => Math.hypot(s.x - x, s.z - z) > 3) && taken.every(t => Math.hypot(t.x - x, t.z - z) > 2.2);
      }
      taken.push({ x, z });
      (world.props ??= []).push({ prop: entry.id, at: [r2(x), 0, r2(z)], rot: Math.round(rng() * 360), scale: 1 });
    }
    if (entry.id !== p.name) notes.push(`world: "${p.name}" is the library's "${entry.id}"`);
  }
  if ((world.spawns ?? []).length < (spec.players?.max ?? 4)) world.spawns = spawns;
  world.zones = { centre: { shape: 'circle', at: [0, 0, 0], size: [2.5] }, ...(world.zones ?? {}) };
  // every prop the layout uses (placed or scattered): its model and its catalog entry
  for (const id of [...(world.props ?? []).map(p => p.prop), ...(world.scatter ?? []).map(s => s.prop)]) used.set(id, byId.get(id));
  const gameProps = (spec.world?.props ?? []).filter(p => !layoutProps.includes(p));
  for (const p of gameProps) { const e = await libraryProp(p.name, p.describe); if (e) used.set(p.name, { ...e, id: p.name }); }
  const catalog = { schema: lib.schema, about: 'The library entries this game uses (research/gf-three/library/props.json), for the world module.', props: [] };
  for (const [id, e] of [...used.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!e) { notes.push(`world: the template uses "${id}", which library/props.json lacks`); continue; }
    catalog.props.push({ ...e, id });
    const to = `assets/models/${id}.glb`;
    if (!assets.some(a => a.to === to)) { const license = await libraryLicense(e.file, e.id); assets.push({ to, from: join(LIBRARY, e.file), license }); propFiles[id] ??= { file: to, from: `library:${e.id}`, ...(license ? { license } : {}) }; }
  }
  world.__catalog = catalog;
  return world;
}

function cameraDefaults(mode) {
  if (mode === 'first') return { fov: 72, sensitivity: 0.0024 };
  if (mode === 'top') return { distance: 15, fov: 50 };
  return { distance: 5.2, fov: 60, sensitivity: 0.0026 };
}
const r2 = v => Math.round(v * 100) / 100;
const cap = s => String(s).replace(/^./, c => c.toUpperCase()).slice(0, 60);
