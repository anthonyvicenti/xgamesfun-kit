#!/usr/bin/env node
// gf-three loadouts: the loadout leg of verify check 5 on its own (CONTRACT §6e), for a repair loop or a proof run.
// Two players over real WebRTC, each in their own loadout; each copy must draw the other in it; a change mid-round
// and a reloaded copy follow. --third adds a player who joins during round 1 and must see the host's look in round 2.
//
//   node research/gf-three/tools/loadouts.mjs <game> [--out <dir>] [--third] [--a <loadout JSON>] [--b <loadout JSON> | --b none] [--json]
//
// Without --a/--b the players get test loadouts unlike the game's own colours (verify's). Evidence: <game>/evidence/
// loadouts-N/ (or --out): loadouts.json and a screenshot from each player's own view. Exit 0 when every step passes.
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { checkLoadouts, testLoadouts } from './lib/loadout-check.mjs';
import { getPointer } from '../../asset-manifest/runtime/gf-assets.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--out', '--a', '--b'].includes(a[i - 1]));
  if (!dir) { console.error('usage: loadouts.mjs <game> [--out <dir>] [--third] [--a <loadout JSON>] [--b <loadout JSON> | --b none] [--json]'); process.exit(2); }
  const game = resolve(dir);
  let out = opt('--out') ? resolve(opt('--out')) : null;
  if (!out) { const root = join(game, 'evidence'); await mkdir(root, { recursive: true }); const taken = new Set(await readdir(root)); let n = 1; while (taken.has(`loadouts-${n}`)) n++; out = join(root, `loadouts-${n}`); }
  await mkdir(out, { recursive: true });
  let loadouts = null;
  if (opt('--a') || opt('--b')) {
    const assets = JSON.parse(await readFile(join(game, 'assets.json'), 'utf8'));
    const val = async id => { const s = assets.slots.find(x => x.id === id); try { return s?.source?.pointer ? getPointer(JSON.parse(await readFile(join(game, s.source.file), 'utf8')), s.source.pointer) : null; } catch { return null; } };
    const T = testLoadouts(assets, { palette: (await val('character.tint.player')) ?? [], colors: { 'mechanic.projectile.color': await val('mechanic.projectile.color') } });
    const parse = s => (s === 'none' ? null : JSON.parse(s));
    loadouts = { ...T, A: opt('--a') ? parse(opt('--a')) : T.A, B: opt('--b') ? parse(opt('--b')) : T.B };
  }
  const json = a.includes('--json');
  const r = await checkLoadouts({ dir: game, outDir: out, third: a.includes('--third'), throwBall: true, loadouts, log: json ? () => {} : console.log });
  if (json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  for (const w of r.warnings) console.log(`note ${w}`);
  console.log(`loadouts ${relative(process.cwd(), game) || '.'}: ${r.ok ? 'PASS' : 'FAIL'} ${r.record.steps.filter(s => s.ok).length}/${r.record.steps.length} → ${relative(process.cwd(), out)}/loadouts.json`);
  process.exitCode = r.ok ? 0 : 1;
}
