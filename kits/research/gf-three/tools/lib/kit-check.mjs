// verify check 2: the kit copies in a game are unedited. gf/three against the hashes create wrote in gf/three/kit.js
// (and, for information, against the kit's dev source); gf/mp through the multiplayer kit's own checkKitReleased (any
// released gf-multiplayer version, unedited; a note when it is not the current one); audio/ and gf/gf-assets.js against
// their frozen SHA256SUMS; vendor/ against the pinned sources create copied from.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, GF_AUDIO, VENDOR, walk, sha256 } from './paths.mjs';
import { KIT_VERSION as MP_VERSION, checkKitReleased } from '../../../multiplayer/party/manifest.mjs';
import { addonClosure } from './vendor.mjs';

async function sums(file) {
  const out = new Map();
  for (const line of (await readFile(file, 'utf8')).split('\n')) { const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim()); if (m) out.set(m[2], m[1]); }
  return out;
}

export async function checkKitCopies(gameDir) {
  const problems = [], notes = [];
  // gf/three: every file in kit.js, unchanged, and nothing else
  const kitJs = join(gameDir, 'gf/three/kit.js');
  if (!existsSync(kitJs)) problems.push('gf/three/kit.js is missing (re-run create)');
  else {
    const text = await readFile(kitJs, 'utf8');
    let rec = null;
    try { rec = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { problems.push('gf/three/kit.js does not parse'); }
    if (rec) {
      const have = (await walk(join(gameDir, 'gf/three'))).filter(r => r !== 'kit.js');
      for (const [rel, h] of Object.entries(rec.files ?? {})) {
        const cur = await readFile(join(gameDir, 'gf/three', rel)).catch(() => null);
        if (!cur) problems.push(`gf/three/${rel}: missing`); else if (sha256(cur) !== h) problems.push(`gf/three/${rel}: edited (differs from the copy create made)`);
      }
      for (const rel of have) if (!(rel in (rec.files ?? {}))) problems.push(`gf/three/${rel}: not a kit file`);
      let stale = 0;
      for (const [rel, h] of Object.entries(rec.files ?? {})) { const src = await readFile(join(KIT, rel)).catch(() => null); if (!src || sha256(src) !== h) stale++; }
      if (stale) notes.push(`gf/three is kit ${rec.version} as it was when create ran; ${stale} file(s) have changed in research/gf-three/kit since (re-run create to update)`);
    }
  }
  // gf/mp
  const mp = await checkKitReleased(gameDir);
  for (const f of mp.missing) problems.push(`gf/mp/${f}: missing`);
  for (const f of mp.changed) problems.push(`gf/mp/${f}: differs from gf-multiplayer ${mp.version}`);
  for (const f of mp.extra) problems.push(`gf/mp/${f}: not a kit file`);
  if (mp.ok && !mp.latest) notes.push(`gf/mp is gf-multiplayer ${mp.version}, unedited; the current kit is ${MP_VERSION} (upgrade moves the game onto it)`);
  // audio/ and gf/gf-assets.js
  const audio = await sums(join(GF_AUDIO, 'SHA256SUMS'));
  for (const [f, h] of audio) { const cur = await readFile(join(gameDir, 'audio', f)).catch(() => null); if (!cur) problems.push(`audio/${f}: missing`); else if (sha256(cur) !== h) problems.push(`audio/${f}: differs from gf-audio 1.5.0`); }
  for (const f of await walk(join(gameDir, 'audio'))) if (!audio.has(f)) problems.push(`audio/${f}: not a gf-audio 1.5.0 file`);
  const assetsSums = await sums(join(GF_AUDIO, '../../gf-assets/1.3.0/SHA256SUMS'));
  const ga = await readFile(join(gameDir, 'gf/gf-assets.js')).catch(() => null);
  if (!ga) problems.push('gf/gf-assets.js: missing'); else if (sha256(ga) !== assetsSums.get('gf-assets.js')) problems.push('gf/gf-assets.js: differs from gf-assets 1.3.0');
  // vendor/: byte-identical to the pinned sources
  const pinned = rel => {
    if (rel.startsWith('vendor/three/examples/jsm/')) { for (const d of VENDOR.threeAddons) { const p = join(d, rel.slice('vendor/three/'.length)); if (existsSync(p)) return p; } return null; }
    if (rel.startsWith('vendor/three/')) return join(VENDOR.threeBuild, rel.slice('vendor/three/'.length));
    for (const k of ['rapier', 'postprocessing', 'n8ao']) if (rel.startsWith(`vendor/${k}/`)) return join(VENDOR[k], rel.slice(`vendor/${k}/`.length));
    return null;
  };
  for (const rel of (await walk(join(gameDir, 'vendor'))).map(r => `vendor/${r}`)) {
    const src = pinned(rel);
    if (!src || !existsSync(src)) { problems.push(`${rel}: not a pinned library file`); continue; }
    if (sha256(await readFile(join(gameDir, rel))) !== sha256(await readFile(src))) problems.push(`${rel}: differs from the pinned copy`);
  }
  // every three.js addon the kit, the libraries and rules.js import is there
  const texts = [];
  for (const rel of await walk(join(gameDir, 'gf/three'))) if (/\.m?js$/.test(rel)) texts.push(await readFile(join(gameDir, 'gf/three', rel), 'utf8'));
  for (const f of ['vendor/n8ao/N8AO.js', 'vendor/postprocessing/postprocessing.module.js', 'rules.js']) texts.push(await readFile(join(gameDir, f), 'utf8').catch(() => ''));
  try { for (const a of await addonClosure(texts)) if (!existsSync(join(gameDir, 'vendor/three/examples/jsm', a))) problems.push(`vendor/three/examples/jsm/${a}: imported but not vendored (re-run create)`); }
  catch (e) { problems.push(e.message); }
  return { ok: problems.length === 0, problems, notes };
}
