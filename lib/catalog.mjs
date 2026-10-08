// What the kit can build (gf-three's catalog), as this snapshot has it: bodies whose file was left out of kits/ (e.g.
// Meshy output, licence unconfirmed) are dropped, so a spec never names one.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GF3_LIBRARY } from './paths.mjs';
import { runToolJson } from './run-tool.mjs';

export async function catalog() {
  const r = await runToolJson('catalog');
  if (!r.data) throw new Error(`gf-three catalog failed (exit ${r.code}): ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  const c = r.data;
  c.bodies = (c.bodies ?? []).filter(b => !b.file || existsSync(path.join(GF3_LIBRARY, ...String(b.file).split('/'))));
  return c;
}

export const SECTIONS = ['mechanics', 'worlds', 'looks', 'bodies', 'props', 'clips', 'fair', 'spec'];

/** Plain-text lines for the sections asked for. */
export function catalogLines(c, sections = ['mechanics', 'worlds']) {
  const L = [];
  const want = s => sections.includes(s);
  if (want('mechanics')) {
    L.push('MECHANICS (spec mechanics[].id; params checked against each one\'s schema)');
    for (const m of c.mechanics ?? []) {
      L.push(`  ${m.id.padEnd(11)} ${m.status === 'ready' ? '' : `[${m.status}] `}${m.describe ?? ''}`);
      if (m.examples?.length) L.push(`${' '.repeat(14)}as: ${m.examples.join(' · ')}`);
      const ps = Object.entries(m.params ?? {});
      if (ps.length) L.push(`${' '.repeat(14)}params: ${ps.map(([k, p]) => `${k}${p && 'default' in p ? `=${JSON.stringify(p.default)}` : ''}`).join(', ')}`);
    }
    L.push('');
  }
  if (want('worlds')) {
    L.push('WORLDS (spec world.template and world.size)');
    for (const w of c.worlds ?? []) {
      L.push(`  ${w.id.padEnd(11)} ${w.label ? `${w.label}: ` : ''}${w.describe ?? ''}${w.kind ? ` [${w.kind}]` : ''}`);
      for (const [k, z] of Object.entries(w.sizes ?? {})) L.push(`${' '.repeat(14)}${k.padEnd(7)} ${(z.size ?? []).join(' x ')} m${z.rooms?.length ? `, rooms: ${z.rooms.join(', ')}` : ''}${z.entries?.length ? `; enemies come in at ${z.entries.join(', ')}` : ''}`);
    }
    if (c.worldSizes) L.push(`  sizes: ${Object.entries(c.worldSizes).map(([k, v]) => `${k} ${v.area?.[0]}–${v.area?.[1]} m²`).join(' · ')}`);
    L.push('');
  }
  if (want('looks')) { L.push('LOOKS (spec look.preset, look.time)'); for (const l of c.looks ?? []) L.push(`  ${l.id.padEnd(14)} ${l.label ?? ''}${l.describe ? `: ${l.describe}` : ''} (${(l.times ?? []).join(', ')})`); L.push(''); }
  if (want('bodies')) {
    L.push('BODIES (spec characters[].body: {"from": "library", "library": <id>} or {"from": "bean"})');
    for (const b of c.bodies ?? []) L.push(`  ${String(b.id).padEnd(28)} ${b.describe ?? ''}${b.tags?.length ? ` [${b.tags.join(', ')}]` : ''}`);
    if (c.bodyGuide?.length) { L.push('  how to pick:'); for (const g of c.bodyGuide) L.push(`    ${g}`); }
    L.push('');
  }
  if (want('props')) { L.push(`PROPS (${(c.props ?? []).length}; spec world.props[].name picks the library prop by name and describe)`); L.push(`  ${(c.props ?? []).map(p => p.id).join(', ')}`); L.push(''); }
  if (want('clips')) { L.push('CLIPS (gf-humanoid-1)'); L.push(`  ${(c.clips ?? []).join(', ')}`); L.push(''); }
  if (want('fair')) { L.push('FAIR PLAY (every game; config/game.json → fair)'); L.push(`  ${Object.entries(c.fair?.defaults ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`); for (const d of c.fair?.does ?? []) L.push(`  - ${d}`); L.push(''); }
  if (want('spec') && c.spec) { L.push(`SPEC  cameras ${(c.spec.cameras ?? []).join('/')} · players 1–${c.spec.players?.max} · round ${(c.spec.roundSeconds ?? []).join('–')} s · body from ${(c.spec.bodyFrom ?? []).join('/')}`); L.push(''); }
  return L;
}
