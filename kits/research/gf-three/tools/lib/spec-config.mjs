// A game spec (research/studio-v2/game-spec.schema.json) → the project's config files, sound list, multiplayer
// manifest and asset choices. Pure apart from reading the libraries (track L's props, track C's bodies) when they
// exist. Deterministic: positions come from a random stream seeded by the spec's title.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY, STANDIN_ASSETS, KIT, SCENIC, FORGE, FORGE_KIT, importPart } from './paths.mjs';
import { createRng, hashString } from '../../kit/core/rng.js';
import { FAIR_DEFAULTS } from '../../kit/core/fair-logic.js';
import { generateLayout } from '../../kit/world/generate.js';
import { libraryBodyById, LIBRARIES } from './char-library.mjs';

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
  if (!hit) return null;
  const out = { spdx: hit.spdx ?? hit.license ?? 'CC0-1.0', author: hit.author ?? hit.by ?? '', url: hit.page ?? hit.url ?? hit.source ?? '' };
  // a licence that asks for credit (CC BY) carries everything the credit needs into the game: the title, the record's
  // own credit line, the licence's page and what was changed (kit LICENSING.md: "credit the author, the title and a
  // link, and say you changed it")
  const legal = licenceUrl(out.spdx);
  if (legal) Object.assign(out, { ...(hit.title ? { title: hit.title } : {}), ...(hit.credit ? { credit: hit.credit } : {}), licenseUrl: legal, ...(hit.modified ? { modified: hit.modified } : {}) });
  return out;
}
/** The licence page of a Creative Commons licence that asks for credit (CC-BY-3.0 → …/by/3.0/), else null. */
export function licenceUrl(spdx) {
  const m = /^CC-BY(-SA|-NC|-ND|-NC-SA|-NC-ND)?-(\d\.\d)$/.exec(String(spdx ?? ''));
  return m ? `https://creativecommons.org/licenses/by${(m[1] ?? '').toLowerCase()}/${m[2]}/` : null;
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
  if (named) {
    const b = bodies.find(x => ok(x) && x.id === body.library); if (b) return b;
    // a scenic library body (research/gf-scenic/library, CONTRACT §8): on gf-humanoid-1 like every body, so any engine
    // may wear it. Only ids gf-three's own list lacks get here, so those resolve exactly as before.
    const s = await libraryBodyById(body.library, { roots: LIBRARIES.filter(l => l.engine === 'scenic') }); if (s) return s;
  }
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
/**
 * A forge game's multiplayer.json check.query (create writes it, upgrade adds it to a game that lacks it). The live
 * gate plays a round with scripted random input for 40 s and then checks that a host in a background tab does not
 * stop the world, play again and a reload. A forge round does not last that long under random input: in a wave fight
 * both players fall, in a walk-to game the random walk reaches the goal (research/gf-forge/INTEGRATION.md mismatch 28:
 * the background-host step was "not reached" on both forge games). With ?gf-gate=1 the forge boot
 * (kit/core/boot-forge.js) lets the rules end no round: the clock and the host's End round still do. QA only.
 */
export const FORGE_GATE_QUERY = 'gf-gate=1';
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

export async function specToConfig(spec, { modules, lookPreset = null, lookConfig = null, standinPresetValues, mechanicDefaults = {}, mechanicSounds = {}, worldConfig = null, flow = null, flat = null }) {
  const notes = [];
  const rng = createRng(hashString(`${spec.title}|layout`));
  const P = spec.players ?? { min: 1, max: 4 };
  const half = SIZES[spec.world?.size ?? 'small'] ?? 12;
  const assets = [];

  // ---- props: layout pieces and gameplay props ----
  const gameProps = [], layoutProps = [], propFiles = {}, named = {};   // named: the spec's prop name → its slot id
  // (a flat game has no layout pieces: its world is a tile map, so every prop the spec names is the game's own)
  for (const p of spec.world?.props ?? []) (flat || GAMEPLAY.test(`${p.role ?? ''} ${p.name}`) ? gameProps : layoutProps).push(p);
  // with the real world module the layout pieces come from its catalog (realWorld below); here: the gameplay props,
  // and with the stand-in world every prop
  // (a forge world places every spec prop itself, from its own library: CONTRACT §8 forge)
  for (const p of spec.engine === 'forge' ? [] : spec.world?.props ?? []) {
    if (modules.world && layoutProps.includes(p)) continue;
    // a flat (2D) game's prop is a picture (kit/flat): an image slot, a stand-in in the game's art style until one is made
    if (flat) { named[p.name] = `prop.${p.name}`; propFiles[p.name] = flat.part.propFor(p, { style: flat.style, assets, repoFile: flat.repoFile }); continue; }
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
  // the forge engine (CONTRACT §8 forge "Live co-op"): no three.js character; the body friends see, its clips and the
  // model of each weapon a friend holds come from research/gf-forge/library (gf/forge/wear.js), each a slot
  const forge = spec.engine === 'forge';
  let forgeWear = null;
  if (forge) {
    const W = await importPart(join(FORGE_KIT, 'wear.js'), 'the forge engine (research/gf-forge)');
    const L = await (await importPart(join(FORGE, 'tools/library.mjs'), 'the forge engine (research/gf-forge)')).forgeLibrary();
    const lic = (rel, scenic = false) => { const l = scenic ? L.licences[rel] : L.forgeLicences[rel]; return l ? { spdx: l.spdx, author: l.author, url: l.page ?? l.from ?? '' } : null; };
    const filled = (await importPart(join(FORGE_KIT, 'tables/index.js'), 'the forge engine (research/gf-forge)')).fill(spec.forge ?? {});
    // the art library's catalog (research/gf-forge/library/catalog.json, after tracks C2 and C3): the four co-op hunters
    // by seat, the Meshy weapons, the first-person arms, a kill's pieces and the effect pictures (gf/forge/wear.js)
    forgeWear = W.wearConfig(filled, L.forgeCatalog);
    const held = [];
    for (const f of W.wearFiles(filled, L.forgeCatalog)) {
      assets.push({ to: f.to, from: f.scenic ? L.scenicFile(f.from) : L.forgeFile(f.from), license: lic(f.from, f.scenic) });
      if (/held-/.test(f.to)) held.push(`${f.what.replace(/^the /, '')} (${f.from})`);
    }
    notes.push(`characters: friends see each other as the co-op hunters, one body a seat (slots ${W.BODY}, ${W.bodySlot(1)}, …), skinned by the forge renderer, their cloth in the player's colour${held.length ? `, holding ${held.join(', ')}` : ''}${forgeWear.fp ? '; the first-person arms and weapons, a kill\'s pieces, a coin and the effect pictures are slots too' : ''}`);
  }
  // a flat (2D) game's body is a picture sheet (kit/flat/character.js, the gf-flat-1 standard)
  if (flat) for (const c of spec.characters ?? [{ role: 'player', body: { from: 'sprite' } }]) { const b = flat.part.bodyFor(c, { plane: flat.plane, style: flat.style, assets, repoFile: flat.repoFile }); roles[c.role] = b.role; bodies[c.role] = b.record; notes.push(b.note); }
  for (const c of forge || flat ? [] : spec.characters ?? [{ role: 'player', body: { from: 'bean' } }]) {
    const to = `assets/models/body-${c.role}.glb`;
    const lib = modules.character ? await libraryBody(c.body) : null;
    if (lib) {
      // the body's own licence record (library/bodies.json), else library/LICENSES.json
      const rec = lib.license ?? lib.licence ?? null;
      const license = rec ? { spdx: rec.spdx, author: rec.author, url: rec.url ?? rec.page ?? '', ...(licenceUrl(rec.spdx) ? { title: rec.title ?? lib.label ?? lib.id, credit: rec.credit ?? `"${rec.title ?? lib.label ?? lib.id}" by ${rec.author}, ${rec.spdx.replace(/^CC-BY-/, 'CC BY ')}${rec.url ?? rec.page ? ` (${rec.url ?? rec.page})` : ''}`, licenseUrl: licenceUrl(rec.spdx), ...(rec.modified ? { modified: rec.modified } : {}) } : {}) } : await libraryLicense(lib.file, lib.id);
      if (!license) notes.push(`character "${c.role}": body ${lib.id} has no licence record in library/bodies.json`);
      assets.push({ to, from: lib.path ?? join(LIBRARY, lib.file), license }); bodies[c.role] = { file: to, from: `library:${lib.id}`, ...(license ? { license } : {}) };
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
  if (modules.character && !forge && existsSync(join(LIBRARY, 'clips/gf-humanoid-1.glb'))) assets.push({ to: 'assets/clips/gf-humanoid-1.glb', from: join(LIBRARY, 'clips/gf-humanoid-1.glb'), license: (await libraryLicense('clips/gf-humanoid-1.glb', 'gf-humanoid-1')) ?? { spdx: 'CC0-1.0', author: 'Quaternius (Universal Animation Library), retargeted by games.fun', url: 'https://quaternius.itch.io/universal-animation-library' } });

  // ---- the ground (stand-in world only: the real world draws its own from colour slots and a noise texture) ----
  if (!modules.world && !forge && !flat) assets.push({ to: 'assets/textures/ground.ktx2', from: join(STANDIN_ASSETS, 'grass.ktx2'), license: { spdx: 'CC0-1.0', author: 'Poly Haven', url: 'https://polyhaven.com/a/leafy_grass' } });

  // ---- config files ----
  const mechanics = (spec.mechanics ?? []).map(m => ({ id: m.id, ...(m.as ? { as: m.as } : {}), params: { ...(mechanicDefaults[m.id] ?? {}), ...specParams(spec, m), ...(m.params ?? {}) } }));
  const tough = enemyToughness(mechanics);
  if (tough) notes.push(tough);
  await scenicMechanicArt(spec, mechanics, assets, notes);
  const game = {
    schemaVersion: 0,
    title: spec.title,
    hook: spec.hook ?? '',
    text: { title: spec.title, hook: spec.hook ?? '', goal: goalLine(spec), play: 'Play', again: 'Play again', waiting: 'Waiting for everyone…', you: 'You', wins: '{name} wins!', draw: 'Round over: nobody scored', lost: 'Defeated' },
    players: { min: P.min ?? 1, max: P.max ?? 4, bots: P.bots !== false, teams: P.teams ?? 0, mode: P.mode ?? 'versus', botNames: ['Pip', 'Bo', 'Moss', 'Juno', 'Rex', 'Ivy', 'Tam'] },
    // a flow other than the timed round (kit/loops/<id>, open builder M4-C) is named with its params; one with no
    // round clock (turns, endless) gets round.seconds only when the spec gives it (a cap)
    round: { ...(flow && !Number.isInteger(spec.round?.seconds) ? {} : { seconds: spec.round?.seconds ?? 120 }), countdown: 3, replay: spec.round?.replay !== false, ...(spec.round?.winBy ? { winBy: spec.round.winBy } : {}), ...(spec.round?.loseBy ? { loseBy: spec.round.loseBy } : {}), ...(flow ? { flow: flow.id, params: flow.params } : {}) },
    camera: spec.camera ?? 'third',
    // forge (CONTRACT §8 forge): the walk, the jump and the field of view are the data tables' (game.forge.player), so
    // the controller keeps only the mouse's sensitivity
    controller: forge ? { camera: { first: { sensitivity: cameraDefaults('first').sensitivity } } } : { speed: 5.2, sprint: 7.4, jump: 7.2, camera: { [spec.camera ?? 'third']: cameraDefaults(spec.camera ?? 'third') } },
    controls: { ...(spec.controls ?? {}) },
    // forge (CONTRACT §8 forge): every spec prop is the game's own, placed by the world module; no size or count values,
    // which the forge world does not read
    props: forge ? (spec.world?.props ?? []).map(p => ({ name: p.name, ...(p.describe ? { describe: p.describe } : {}), ...(p.role ? { role: p.role } : {}) }))
      : gameProps.map(p => ({ name: p.name, describe: p.describe, count: p.count ?? 1, ...(p.role ? { role: p.role } : {}), size: /ball/i.test(p.name) ? 0.44 : 0.6 })),
    mechanics,
    rules: { summary: spec.rules?.summary ?? '', ...(spec.rules?.scoring ? { scoring: spec.rules.scoring } : {}), params: { ...(spec.rules?.params ?? {}) } },
    // fair play (kit/core/fair.js): on by default in every game; each value a fair.* slot the creator tunes in Studio
    fair: { ...FAIR_DEFAULTS },
    ui: { panel: '#1c2133d9', text: '#ffffff', crosshair: '#ffffff' },
  };
  // fair play is about knocks and bots, which the forge engine has neither of yet (tracks F and A): no fair.* values
  // (slots that would change nothing) until it does
  if (forge) delete game.fair;
  // a flat (2D) game: its plane, its jump and its controls are the flat part's to set (kit/flat/slots.js gameFor)
  if (flat) Object.assign(game, flat.part.gameFor(spec, game));
  // the forge data tables (spec.forge: player, physics, weapons, enemies, waves, cards), every value filled and a slot
  // (research/gf-forge/kit/tables; create has already refused what the core can't do)
  const forgeTables = forge ? await importPart(join(FORGE_KIT, 'tables/index.js'), 'the forge engine (research/gf-forge)') : null;
  if (forge) game.forge = forgeTables.fill(spec.forge ?? {});
  // the real look writes its own config/look.json (the whole preset, every value a slot); the stand-in keeps `values`
  const realLook = lookConfig?.(spec.look?.preset ?? 'jelly-pastel', spec.look?.time ?? 'day');
  const look = realLook ?? { preset: spec.look?.preset ?? 'jelly-pastel', time: spec.look?.time ?? 'day', ...(spec.look?.palette ? { palette: spec.look.palette } : {}), values: lookPreset?.(spec.look?.preset, spec.look?.time) ?? standinPresetValues(spec.look?.preset, spec.look?.time ?? 'day') };
  const lookPlayers = look.palette?.players;
  // the scenic engine's world module writes its own config/world.json (CONTRACT §8): a generated island, ruins or isles;
  // a voxel world (CONTRACT §9) is the kit's default block island, seeded by the title
  let world = spec.world?.template === 'voxel' ? await voxelWorld(spec, { assets, notes })
    : worldConfig ? await worldConfig(spec, { spawns, layoutProps, rng, assets, propFiles, notes, named })
    : modules.world ? await realWorld(spec, { spawns, layoutProps, rng, assets, propFiles, notes, named }) : null;
  if (spec.round?.mode === 'world') worldGame(spec, game, world, notes);
  if (!world) world = {
    template: spec.world?.template ?? 'backyard', size: spec.world?.size ?? 'small', half,
    ground: { texture: 'assets/textures/ground.ktx2', color: '#d4f0b0', repeat: Math.round(half / 1.5), license: { spdx: 'CC0-1.0', author: 'Poly Haven', url: 'https://polyhaven.com/a/leafy_grass' } },
    props: worldProps, spawns, zones: { centre: { shape: 'circle', at: [0, 0, 0], size: [2.5] } }, walls: true,
    ...(spec.world?.notes ? { notes: spec.world.notes } : {}),
  };
  // seat colours (character.tint.<role>): the look's player palette when it has one, else the party page's colours
  const characters = { roles, palette: (Array.isArray(lookPlayers) ? lookPlayers : SEAT_COLORS).slice(0, Math.max(4, P.max ?? 4)), nameplate: { show: true }, ...(forgeWear ? { forge: forgeWear } : {}) };

  // ---- sounds: the spec's, then the kit's round sounds ----
  const sounds = { version: 1, sounds: {} };
  for (const s of spec.sounds ?? []) sounds.sounds[s.id] = { label: cap(s.describe ?? s.id), src: { preset: s.preset ?? presetFor(s) } };
  const kitSounds = { 'ui-click': ['Menu click', 'click', 'ui'], 'round-countdown': ['Countdown beep', 'countdown', 'ui'], 'round-go': ['Round starts', 'confirm', 'ui'], 'round-win': ['You won the round', 'win', 'sfx'] };
  // an enemy going down (kit/mechanics/waves soundKill), in games that have enemies
  if (mechanics.some(m => m.id === 'waves')) kitSounds['enemy-down'] = ['An enemy goes down', 'explosion-small', 'sfx'];
  // the forge core's own events (gf/three/core/boot-forge.js plays them for the local player): steps, jumps, landings
  // the forge core's own sounds: every sound id its tables name (steps, jumps, landings, and the weapons' and enemies'),
  // which the host plays by name when the core says so
  if (forge) {
    for (const s of forgeTables.soundsOf(game.forge)) kitSounds[s.id] ??= [s.label, s.preset, 'sfx'];
    kitSounds['round-end'] ??= ['The round ends', 'lose', 'sfx'];
  }
  // the flow's own sounds (kit/loops/<id> → sounds: a turn passing), in games that flow plays
  for (const [id, v] of Object.entries(flow?.sounds ?? {})) kitSounds[id] ??= v;
  // the action mechanics' own sounds (melee, levels, boss, loot: each plays these ids, optional; CONTRACT §8)
  // (a mechanic folder that exports `sounds` brings its own: create hands them in as mechanicSounds)
  for (const m of mechanics) for (const [id, v] of Object.entries({ ...(MECHANIC_SOUNDS[m.id] ?? {}), ...(mechanicSounds[m.id] ?? {}) })) kitSounds[id] ??= v;
  // a kit sound is a preset id, or a full source (layers: one sound made of several presets played together)
  for (const [id, [label, preset, bus]] of Object.entries(kitSounds)) if (!sounds.sounds[id]) sounds.sounds[id] = { label, src: typeof preset === 'string' ? { preset } : preset, ...(bus !== 'sfx' ? { bus } : {}) };

  const multiplayer = spec.round?.mode === 'world' ? {
    // a world (gf-multiplayer 1.5.0 world rooms, research/worlds/PLAN.md §4.4): the room for this post, no rounds
    schemaVersion: 2, mode: 'world', title: spec.title.slice(0, 60), players: { min: 1, max: Math.min(8, P.max ?? 8) },
    world: {
      entry: 'index.html', query: '', key: 'auto', tagline: (spec.hook ?? '').slice(0, 140), hud: 'game',
      sees: 'Each player sees the others as their character, in their seat colour, with a ring at their feet and their name above, building where they point.',
      shares: 'The world itself: every block placed, broken or painted and every sign, ordered by the host\'s copy and saved on the play host.',
    },
    check: { near: 2.5, seconds: 60 },
  } : {
    schemaVersion: 2, mode: 'live', title: spec.title.slice(0, 60), players: { min: 1, max: Math.min(8, P.max ?? 4) },
    live: {
      entry: 'index.html', seedParam: null, team: P.mode === 'coop' || forge, metric: 'score', direction: 'higher', unit: 'pts', maxSeconds: flow ? flowMaxSeconds(spec, flow) : Math.min(3600, (spec.round?.seconds ?? 120) + 30),
      // forge (CONTRACT §8 forge "Live co-op"): co-op for 2–4, the host's core owns the world (research/rust-engine/PLAN.md §9)
      sees: forge ? 'Each player sees the others as a hooded body in their own colour, holding the weapon they hold, with their name above, where the host\'s core has them.'
        : 'Each player sees the others as their character, in their seat colour, with a ring at their feet and their name above.',
      shares: forge ? 'Everything the host\'s core simulates (every player\'s body from their inputs, enemies, shots, hits), sent in its snapshots, and the round, its clock and the scores'
        : 'The round and its clock, the scores and everything the rules share (ctx.shared), owned by the host\'s copy',
      // gf-multiplayer 1.4.0: the game's world behind the waiting room, and the game's own HUD and room menu in a round
      backdrop: 'gf-backdrop=1', hud: 'game',
    },
    check: { near: 2.5, seconds: 60 },
  };
  if (forge) multiplayer.players.max = Math.min(4, multiplayer.players.max);
  // forge: the live gate plays the game with FORGE_GATE_QUERY (multiplayer.json check.query: a query for scripted
  // players, never used in real play), so the steps after its 40 s of random input find the round still running
  if (forge) multiplayer.check.query = FORGE_GATE_QUERY;
  if (!look.palette?.accent) game.ui.accent = spec.look?.palette?.[0] ?? '#ff7a59';   // the look's accent wins when it has one
  // forge, wave 2 (track U; research/gf-forge/hud/create.mjs): the grim theme's colours, words and fonts, the forge keys
  // for How to play and touch, the library's sound files in place of the presets above, the friends page's colours
  if (forge) (await importPart(join(FORGE, 'hud/create.mjs'), 'the forge engine (research/gf-forge)')).forgeHud({ spec, game, sounds, multiplayer, assets, world, notes });
  const props = world.__catalog ?? null; delete world.__catalog;
  const worldArt = world.__art ?? null; delete world.__art;
  return { game, look, world, characters, props, sounds, multiplayer, assets, propFiles, named, bodies, notes, worldArt };
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
  if (mode === 'orbit') return { distance: 8, fov: 55 };   // CONTRACT §9
  if (mode === 'first') return { fov: 72, sensitivity: 0.0024 };
  if (mode === 'top') return { distance: 15, fov: 50 };
  if (mode === 'follow') return { distance: 34, minDistance: 20, maxDistance: 46, pitchDeg: 48, yawDeg: 45, fov: 25 };   // CONTRACT §8
  return { distance: 5.2, fov: 60, sensitivity: 0.0026 };
}
const r2 = v => Math.round(v * 100) / 100;
const cap = s => String(s).replace(/^./, c => c.toUpperCase()).slice(0, 60);

/** The HUD's goal line and How to play's (CONTRACT §6g): the spec's win line, else its rules summary, else its hook. */
/** The party page's time cap for a game a flow plays: a capped session's cap, a match's rounds and pauses, else the
 *  room's longest (an hour): a game with no clock is not cut short by the page. */
function flowMaxSeconds(spec, flow) {
  const s = spec.round?.seconds, P = flow.params ?? {};
  if (Number.isInteger(P.rounds)) return Math.min(3600, P.rounds * ((s ?? 120) + (P.between ?? 3)) + 30);
  return Number.isInteger(s) ? Math.min(3600, s + 30) : 3600;
}
export function goalLine(spec) {
  const t = String(spec.round?.winBy || spec.rules?.summary || spec.hook || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 120) return t;
  const cut = t.slice(0, 119); const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > 40 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

// ---- the action mechanics' sounds and, in scenic games, their art (CONTRACT §8; gf-scenic wave 1, track M) ----
const MECHANIC_SOUNDS = {
  // the place sound is a soft hit with a low thump under it (play-test 2026-10-09: too quiet in mixed play; gainDb never
  // goes above 0, research/audio/GUIDE.md, so it gains body instead)
  build: { 'block-place': ['A block is placed', { layers: [{ preset: 'hit-soft' }, { preset: 'land', gainDb: -2 }] }, 'sfx'], 'block-break': ['A block breaks', 'hit-crunch', 'sfx'], paint: ['Paint sprays on', 'splash', 'sfx'], sign: ['A sign goes up', 'confirm', 'sfx'], fuse: ['A boom block is lit', 'countdown', 'sfx'], boom: ['A boom block pops', 'explosion-small', 'sfx'], denied: ['That can\'t be done', 'error', 'ui'], 'world-enter': ['You arrive in the world', 'powerup', 'ui'] },
  shove: { shove: ['A shove', 'arrow-whoosh', 'sfx'], 'shove-miss': ['A shove at nobody', 'hover', 'sfx'] },
  melee: { 'melee-swing': ['A sword whoosh', 'arrow-whoosh', 'sfx'], 'melee-heavy': ['A heavy sword whoosh', 'arrow-whoosh', 'sfx'], 'melee-hit': ['A crunchy hit', 'hit-crunch', 'sfx'], 'melee-block': ['A hit on a shield', 'hit-soft', 'sfx'], 'melee-dash': ['A quick dodge whoosh', 'jump', 'sfx'] },
  waves: { 'enemy-windup': ['An enemy about to strike', 'click', 'sfx'], 'enemy-swing': ['An enemy swing', 'arrow-whoosh', 'sfx'] },
  boss: { 'boss-roar': ['The boss roars', 'explosion-big', 'sfx'], 'boss-slam': ['The boss slams the ground', 'explosion-small', 'sfx'], 'boss-down': ['The boss falls', 'explosion-big', 'sfx'], 'enemy-windup': ['An enemy about to strike', 'click', 'sfx'] },
  levels: { 'portal-open': ['The portal opens', 'level-up', 'sfx'], 'portal-travel': ['Through the portal', 'powerup', 'sfx'] },
  loot: { 'loot-coin': ['A coin', 'coin', 'sfx'], 'loot-potion': ['A potion', 'heal', 'sfx'], 'loot-chest': ['A chest opens', 'door', 'sfx'], 'loot-weapon': ['A new weapon', 'gem', 'sfx'], 'loot-upgrade': ['An upgrade picked', 'level-up', 'sfx'] },
};

const SCENIC_LIBRARY = join(SCENIC, 'library');
let scenicPropsCache = null;
async function scenicProps() {
  if (scenicPropsCache) return scenicPropsCache;
  const doc = await readJsonMaybe(join(SCENIC_LIBRARY, 'props.json'));
  scenicPropsCache = new Map((doc?.props ?? []).map(e => [e.id, e]));
  return scenicPropsCache;
}
// The greatsword's own moves (track M's proof game): two slow, wide, heavy swings
const GREATSWORD_COMBO = [
  { windup: 0.16, active: 0.12, recover: 0.3, arc: 150, reach: 2.7, damage: 2, knockback: 6, hitStop: 0.08, lunge: 3, sweep: 1, tilt: 18, clip: 'slash_1' },
  { windup: 0.22, active: 0.14, recover: 0.45, arc: 180, reach: 2.9, damage: 3, knockback: 10, hitStop: 0.12, lunge: 5, sweep: -1, tilt: -24, clip: 'heavy', finisher: true },
];

/**
 * A scenic game's melee weapons, enemy and boss weapons and loot (chest, coin, potion) are the scenic library's KayKit
 * models (research/gf-scenic/library/props.json, CC0), copied into the mechanics' own model files. A spec (or the
 * pitch) names a library prop by its id wherever a mechanic takes a model file: a waves type's or the boss's `weapon`,
 * a melee weapon's `model` (e.g. "kaykit-skeleton-axe"); create copies it to assets/models/<id>.glb and fills the
 * grip from the library. Unnamed: the player gets a sword, an axe and a greatsword, the boss a staff, loot the
 * dungeon chest, coin and bottle. A party game keeps the mechanics' kit-drawn stand-ins.
 */
async function scenicMechanicArt(spec, mechanics, assets, notes) {
  if (spec.engine !== 'scenic') return;
  const lib = await scenicProps();
  if (!lib.size) return;
  const grip = e => (e.grip ? { position: e.grip.position, quaternion: e.grip.quaternion } : undefined);
  const add = (id, to = `${id}.glb`) => {
    const e = lib.get(id);
    if (!e || !existsSync(join(SCENIC_LIBRARY, e.file))) return null;
    if (!assets.some(a => a.to === `assets/models/${to}`)) assets.push({ to: `assets/models/${to}`, from: join(SCENIC_LIBRARY, e.file), ...(e.license ? { license: e.license } : {}) });
    return { ...e, to };
  };
  /** A library id where a model file goes: → {file, grip} (the file name in assets/models/), else null. */
  const named = v => { if (typeof v !== 'string' || !v) return null; const id = v.replace(/\.glb$/, ''); const e = lib.has(id) ? add(id) : null; return e ? { file: e.to, grip: grip(e) } : null; };
  const used = new Set();
  const melee = mechanics.find(m => m.id === 'melee');
  if (melee) {
    if (Array.isArray(melee.params.weapons) && melee.params.weapons.length) {
      for (const w of melee.params.weapons) { const r = named(w.model) ?? named(w.prop); if (r) { w.model = r.file; delete w.prop; w.grip ??= r.grip; used.add(r.file); } }
    } else {
      const table = [['sword', 'Sword', 'sword', 'kaykit-sword'], ['axe', 'Axe', 'axe', 'kaykit-axe'], ['greatsword', 'Greatsword', 'sword', 'kaykit-greatsword']];
      const weapons = [];
      for (const [id, name, kind, src] of table) {
        const e = add(src, `melee-${id}.glb`);
        if (e) weapons.push({ id, name, kind, model: `melee-${id}.glb`, ...(grip(e) ? { grip: grip(e) } : {}), ...(id === 'greatsword' ? { combo: GREATSWORD_COMBO } : {}) });
      }
      if (weapons.length) { melee.params.weapons = weapons; notes.push(`melee: the scenic library's ${weapons.map(w => w.name.toLowerCase()).join(', ')} (KayKit, CC0) in the hand`); }
    }
  }
  const waves = mechanics.find(m => m.id === 'waves');
  for (const t of waves?.params?.types ?? []) { const r = named(t.weapon); if (r) { t.weapon = r.file; t.weaponGrip ??= r.grip; used.add(r.file); } }
  const boss = mechanics.find(m => m.id === 'boss');
  if (boss) {
    const r = named(boss.params.weapon) ?? (!boss.params.weapon ? named('kaykit-staff') : null);
    if (r) { boss.params.weapon = r.file; boss.params.weaponGrip ??= r.grip; used.add(r.file); }
  }
  if (used.size) notes.push(`scenic library models: ${[...used].join(', ')} (KayKit, CC0)`);
  if (mechanics.some(m => m.id === 'loot')) {
    const got = [['chest', 'dungeon-chest'], ['coin', 'dungeon-coin'], ['potion', 'dungeon-bottle']].filter(([k, src]) => add(src, `loot-${k}.glb`)).map(([k]) => k);
    if (got.length) notes.push(`loot: the scenic library's ${got.join(', ')} (KayKit Dungeon Remastered, CC0)`);
  }
}

// ---- worlds (CONTRACT §9; research/worlds/PLAN.md) ----
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b ?? {})) out[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v; return out; };

/** config/world.json for world.template 'voxel': the kit's default block island (kit/world/voxel/default.json) seeded by
 *  the title, the spec's world.voxel merged over it, every block texture copied from the library (with its licence),
 *  and the spawn square protected (the play host refuses edits there too). */
async function voxelWorld(spec, { assets, notes }) {
  const D = JSON.parse(await readFile(join(KIT, 'world/voxel/default.json'), 'utf8'));
  delete D.about;
  const hotbar = D.hotbar; delete D.hotbar;
  const V = merge(D, spec.world?.voxel ?? {});
  delete V.hotbar;
  V.terrain = { ...V.terrain, seed: V.terrain?.seed ?? (hashString(`${spec.title}|island`) % 1e9) };
  const plaza = V.terrain.plaza ?? {};
  if (typeof plaza.signText === 'string') plaza.signText = plaza.signText.replace(/\{title\}/g, spec.title).slice(0, 60);
  const textures = {};
  for (const [name, src] of Object.entries(V.textures ?? {})) {
    const rel = String(src).replace(/^library:/, '');
    if (!String(src).startsWith('library:')) { textures[name] = src; continue; }
    const to = `assets/textures/blocks/${name}.png`;
    assets.push({ to, from: join(LIBRARY, rel), license: (await libraryLicense(rel, name)) ?? { spdx: 'CC0-1.0', author: 'games.fun', url: 'https://games.fun' } });
    textures[name] = to;
  }
  V.textures = textures;
  const [sx, sy, sz] = V.size;
  const at = plaza.at ?? [Math.floor(sx / 2), Math.floor(sz / 2)], half = plaza.half ?? 6;
  V.protect ??= [{ min: [at[0] - half, V.floor ?? 1, at[1] - half], max: [at[0] + half, sy - 1, at[1] + half], why: 'spawn square' }];
  notes.push(`world: a voxel island ${sx} × ${sy} × ${sz}, seed ${V.terrain.seed}, ${V.blocks.length} blocks, spawn square protected`);
  return { template: 'voxel', voxel: V, __hotbar: spec.world?.voxel?.hotbar ?? hotbar };
}

/** A world game (round.mode 'world'): no clock, results or bots; first person (the creator, 2026-10-09: "Can we make it
 *  first person?"; spec.camera 'orbit' keeps the third-person one); the build tools' words. */
function worldGame(spec, game, world, notes) {
  game.round = { mode: 'world', countdown: 0, replay: false, ...(spec.round?.winBy ? { winBy: spec.round.winBy } : {}) };
  game.players.bots = false;
  game.camera = spec.camera ?? 'first';
  game.controller = { speed: 5.0, sprint: 7.2, jump: 7.4, camera: { [game.camera]: cameraDefaults(game.camera) } };
  // the bare page's home menu: Enter the world (the world card, saved) first, then a practice copy that saves nothing
  Object.assign(game.text, { play: 'Enter the world', playSub: 'Build, break and paint anything', enter: 'Enter the world', enterSub: 'Build with everyone here: it is all saved',
    practice: 'Try it on your own', practiceSub: 'A practice copy: nothing you build is saved', welcome: `Welcome to ${spec.title}` });
  if (!spec.round?.winBy) game.text.goal = 'Build anything: it stays for everyone';
  const build = game.mechanics.find(m => m.id === 'build');
  if (build) {
    if (!build.params.hotbar?.length && world?.__hotbar) build.params.hotbar = world.__hotbar;
    game.controls = { primary: 'use the tool (place a block)', secondary: 'break a block', interact: 'change a sign', jump: 'jump',
      more: [[game.camera === 'first' ? '1 – 0 · wheel' : '1 – 0', 'pick a block', 'Hotbar'], ['X', 'break tool', 'Break button'], ['P', 'paint tool', 'Paint button'], ...(game.mechanics.some(m => m.id === 'shove') ? [['F', 'shove someone', 'Shove button']] : [])],
      ...(spec.controls ?? {}) };
  } else notes.push('world: round.mode world without the build mechanic: nothing can change the world');
  if (world) delete world.__hotbar;
  delete game.props;
}
