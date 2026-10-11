#!/usr/bin/env node
// gf-three slots: assets.json from the slot declarations (CONTRACT §2.2): the kit's modules (from the game's own kit
// copy), config/*.json and the files under assets/. The sound list a game already has is kept (it is Studio's).
//
//   node research/gf-three/tools/slots.mjs <game> [--write] [--check] [--json]
//
//   (no flag)  print the slot count, the main tier and any warnings
//   --write    write assets.json (after an agent adds a prop, a rules param, a mechanic, or a file under assets/)
//   --check    exit 1 when assets.json differs from what the declarations give
import { isMain } from './lib/main.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleManifest } from './lib/slots-lib.mjs';
import { json } from './lib/paths.mjs';

export async function slots(gameDir, { write = false } = {}) {
  const dir = resolve(gameDir);
  const path = join(dir, 'assets.json');
  const cur = existsSync(path) ? await readFile(path, 'utf8') : null;
  let sounds = null;
  try { sounds = cur ? JSON.parse(cur).sounds ?? null : null; } catch {}
  const r = await assembleManifest(dir, { sounds });
  const text = json(r.manifest);
  const same = cur === text;
  if (write && !same) await writeFile(path, text);
  return { ...r, same, wrote: write && !same };
}

if (isMain(import.meta)) {
  const a = process.argv.slice(2);
  const dir = a.find(x => !x.startsWith('--'));
  if (!dir) { console.error('usage: slots.mjs <game> [--write] [--check] [--json]'); process.exit(2); }
  const r = await slots(dir, { write: a.includes('--write') });
  if (a.includes('--json')) { console.log(JSON.stringify({ slots: r.slotCount, main: r.mainCount, same: r.same, wrote: r.wrote, warnings: r.warnings, mainSlots: r.manifest.slots.filter(s => s.tier === 'main').map(s => s.id) }, null, 2)); }
  else {
    for (const w of r.warnings) console.log(`warning ${w}`);
    console.log(`main tier (${r.mainCount}): ${r.manifest.slots.filter(s => s.tier === 'main').map(s => s.id).join(', ')}`);
    console.log(`slots: ${r.slotCount} (${r.mainCount} main) · assets.json ${r.same ? 'is up to date' : r.wrote ? 'written' : 'differs (run with --write)'}`);
  }
  process.exitCode = a.includes('--check') && !r.same ? 1 : 0;
}
