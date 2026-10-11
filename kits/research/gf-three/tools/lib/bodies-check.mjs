// verify check 19, "bodies hold their shape" (creator, 2026-10-07: "We need to work on a model judge for 3 models. We need
// to look at face, body, arms, legs, hands, and feet. We also need to make sure any animation does not distort these. We
// just made a game where the models look good, but the hand is crooked"). Static, no browser, runs in --quick and alone
// (`--check 19`).
//
// Every character body the game ships (assets.json → slots `character.body.*`, the file each slot loads) goes through
// the model judge's measuring tier (body-judge.mjs) with the game's own retarget (its vendored gf/three/character/rig.js)
// and its own clip file (slot `character.clips`): face, body, arms, hands, legs and feet, at rest and in the clips that
// role plays. A body any part of which fails fails the check. Token Call Centre as delivered fails it: on its kit copy
// the player's Quaternius hands fold at the palm and bend their fingers sideways in idle.
//
// The clips a role plays (2026-10-08, after the creator's roguelike lost four generated enemies to a face that stretched
// in `swim`, which no enemy of that game played): the player every clip but swim, sit, crouch and the emotes; any other
// role what enemies play (body-judge.mjs ENEMY_CLIPS); and for every role, the clips the game's own code plays
// (clipsInCode: rules.js and the files beside it).
//
//   const r = await checkBodies('<game dir>');   // { ok, detail, bodies: [{role, file, ok, parts, errors}], notes }
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { judgeBody, judgeSummary, PARTS, PART_LABEL, DEV_RIG, DEFAULT_CLIPS } from './body-judge.mjs';

/**
 * The clip names the game's own code plays: in its top-level .js files (rules.js and its siblings; never gf/, vendor/
 * or audio/), comments left out, a name quoted as `….play('x'` / `play?.('x'` (not `audio.play`), `act('x'` or after
 * `anim:`, `fireAnim:` or `clip:`. (A sound called "throw" is not a clip the game plays.)
 */
export function clipsInCode(text) {
  const code = String(text).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = new Set();
  for (const m of code.matchAll(/([\w$?.\]\)]{0,40})\bplay\??\.?\(\s*['"`]([a-z][a-z0-9_]*)['"`]/g)) if (!/audio|sound|sfx/i.test(m[1])) out.add(m[2]);
  for (const m of code.matchAll(/\bact\??\.?\(\s*['"`]([a-z][a-z0-9_]*)['"`]/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(?:fireAnim|anim|clip)\s*:\s*['"`]([a-z][a-z0-9_]*)['"`]/g)) out.add(m[1]);
  return [...out];
}
async function namedInCode(dir) {
  const out = new Set();
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.js'))) for (const n of clipsInCode(await readFile(join(dir, f), 'utf8').catch(() => ''))) out.add(n);
  return [...out];
}

export async function checkBodies(dir) {
  const notes = [];
  const manifest = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
  const slots = manifest.slots ?? [];
  const fileOf = s => s?.source?.file ?? s?.default?.file ?? s?.file ?? null;
  const bodies = slots.filter(s => /^character\.body\./.test(s.id) && fileOf(s));
  const rig = existsSync(join(dir, 'gf/three/character/rig.js')) ? join(dir, 'gf/three/character/rig.js') : DEV_RIG;
  if (rig === DEV_RIG) notes.push('no gf/three/character/rig.js in the game: judged with the dev kit\'s retarget');
  const clipsFile = fileOf(slots.find(s => s.id === 'character.clips'));
  const clips = clipsFile && existsSync(join(dir, clipsFile)) ? join(dir, clipsFile) : DEFAULT_CLIPS;
  if (!bodies.length) return { ok: true, detail: 'no character bodies (nothing to judge)', bodies: [], notes };
  const seen = new Map(), out = [];
  const named = await namedInCode(dir);
  for (const s of bodies) {
    const role = s.id.split('.').slice(2).join('.'), rel = fileOf(s);
    if (!existsSync(join(dir, rel))) { out.push({ role, file: rel, ok: false, errors: [`${rel} is missing`], parts: {} }); continue; }
    const as = role === 'player' ? 'player' : 'enemy', key = `${rel}|${as}`;
    if (!seen.has(key)) seen.set(key, await judgeBody(join(dir, rel), { rig, clips, role: as, extraClips: named }));
    const r = seen.get(key);
    const warns = PARTS.flatMap(p => r.parts[p].warnings.map(w => `${PART_LABEL[p]}: ${w}`));
    out.push({ role, file: rel, ok: r.ok, summary: r.ok ? '' : judgeSummary(r), errors: r.errors,
      parts: Object.fromEntries(PARTS.map(p => [p, r.parts[p].na ? 'n/a' : r.parts[p].ok ? 'pass' : 'fail'])),
      worst: Object.fromEntries(PARTS.filter(p => r.parts[p].worst).map(p => [p, r.parts[p].worst])),
      warnings: warns.length, stats: r.stats });
    if (warns.length) notes.push(`${role} (${rel}): ${warns.slice(0, 3).join(' | ')}${warns.length > 3 ? ` (+${warns.length - 3} more)` : ''}`);
  }
  const ok = out.every(b => b.ok);
  const detail = out.map(b => `${b.role} (${b.file}): ${b.ok ? `face, body, arms, hands, legs and feet hold their shape in the ${b.stats?.clips ?? '?'} clips it plays` : `FAIL ${b.summary || b.errors.join('; ')}`}`).join(' · ');
  return { ok, detail: ok ? detail : `${detail} (node research/gf-three/tools/model-judge.mjs <file> --rig gf/three/character/rig.js shows every part; a body from the library: pick one that passes, or the kit's retarget is wrong for it)`, bodies: out, notes };
}
