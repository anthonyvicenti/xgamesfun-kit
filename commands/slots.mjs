import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { runTool } from '../lib/run-tool.mjs';
import { addKitIgnores } from '../lib/manifest-ignores.mjs';
import { listSlots, setFile, setValue, findSlot, getPointer, slotsUpToDate } from '../lib/slots.mjs';

const usage = `Usage:
  gamesfun slots [list] [dir] [--all] [--group <g>] [--json]   the main tier (about 40 slots); --all for every slot
  gamesfun slots get <id> [--game <dir>] [--json]
  gamesfun slots set <id> <value> [--game <dir>]              a colour, number, text, … (checked against the slot)
  gamesfun slots set <id> --file <path> [--game <dir>]        a model, picture or sound: same kind, same path
  gamesfun slots write [dir]                                   rebuild assets.json from the declarations
  gamesfun slots check [dir]                                   exit 1 when assets.json is out of date

Every visible model, texture and tuning value of a game is a slot in its assets.json. Swapping one needs no code
change: the game reads it through the kit. Run gamesfun verify afterwards (check 8 proves a swap shows).`;

const fmt = v => (v === undefined ? '(unset)' : typeof v === 'string' ? v : JSON.stringify(v));

export default {
  name: 'slots',
  summary: 'list and swap the slots: every model, texture and value a game shows',
  usage,
  run: args => guard(async () => {
    const verbs = ['list', 'get', 'set', 'write', 'check'];
    const verb = verbs.includes(args[0]) ? args[0] : 'list';
    let rest = verbs.includes(args[0]) ? args.slice(1) : args;
    // a negative number is a value, not a flag: `slots set look.sun.x -0.4`
    let negative = null;
    if (verb === 'set' && /^-\d|^-\.\d/.test(rest[1] ?? '')) { negative = rest[1]; rest = [rest[0], ...rest.slice(2)]; }
    const { values, positionals } = parse(rest, { all: { type: 'boolean' }, group: { type: 'string' }, game: { type: 'string' }, file: { type: 'string' } }, usage);
    if (verb === 'list') {
      const dir = await resolveGame(values.game ?? positionals[0]);
      const r = await listSlots(dir, { all: values.all });
      const rows = values.group ? r.slots.filter(s => s.group === values.group) : r.slots;
      if (values.json) return printJson({ game: shown(dir), shown: rows.length, total: r.total, slots: rows });
      const groups = new Map(r.groups.map(g => [g.id, g.label]));
      let cur = null;
      for (const s of rows) {
        if (s.group !== cur) { cur = s.group; console.log(`\n${groups.get(cur) ?? cur ?? 'other'}`); }
        const what = s.kind === 'file' ? `${s.file}${s.missing ? ' (MISSING)' : s.bytes != null ? ` (${(s.bytes / 1024).toFixed(0)} KB)` : ''}` : fmt(s.value);
        console.log(`  ${s.id.padEnd(38)} ${s.type.padEnd(8)} ${what.length > 60 ? what.slice(0, 57) + '…' : what}${s.label && s.label !== s.id ? `   ${s.label}` : ''}`);
      }
      console.log(`\n${rows.length} of ${r.total} slots${values.all ? '' : ' (main tier; --all for every slot)'} in ${shown(dir)}/assets.json`);
      return;
    }
    if (verb === 'write') {
      const dir = await resolveGame(values.game ?? positionals[0]);
      const r = await runTool('slots', [dir, '--write'], { stdio: 'inherit' });
      if (r.code === 0) await addKitIgnores(dir);
      return r.code;
    }
    if (verb === 'check') {
      const dir = await resolveGame(values.game ?? positionals[0]);
      const r = await slotsUpToDate(dir);
      console.log(r.same ? 'slots: assets.json is up to date' : 'slots: assets.json differs from what the declarations give (run: npx gamesfun slots write)');
      return r.same ? 0 : 1;
    }
    const id = positionals[0];
    if (!id) throw new UsageError(usage);
    const dir = await resolveGame(values.game);
    if (verb === 'get') {
      const s = await findSlot(dir, id);
      const out = { id: s.id, label: s.label, type: s.type, tier: s.tier, source: s.source, constraints: s.constraints ?? {}, license: s.license ?? null };
      if (s.source?.pointer) {
        const { readFile } = await import('node:fs/promises');
        out.value = getPointer(JSON.parse(await readFile(path.join(dir, ...s.source.file.split('/')), 'utf8')), s.source.pointer);
      }
      if (values.json) return printJson(out);
      console.log(`${out.id}: ${out.label ?? ''} (${out.type}, ${out.tier ?? 'main'})`);
      console.log(out.source?.pointer ? `  value  ${fmt(out.value)}  (${out.source.file} ${out.source.pointer})` : `  file   ${out.source?.file}`);
      if (Object.keys(out.constraints).length) console.log(`  rules  ${JSON.stringify(out.constraints)}`);
      if (out.license) console.log(`  licence ${out.license.spdx ?? ''} ${out.license.author ?? ''}`);
      return;
    }
    // set
    if (values.file) {
      const r = await setFile(dir, id, { from: path.resolve(values.file) });
      if (values.json) return printJson(r);
      console.log(`slots: ${id} ← ${values.file} (${r.bytes} bytes, was ${r.before ?? 'missing'}) at ${r.file}`);
      console.log('Record where the file came from and its licence in ATTRIBUTION.md. Then: npx gamesfun verify --quick');
      return;
    }
    const raw = negative ?? positionals.slice(1).join(' ');
    if (!raw) throw new UsageError(`slots set ${id} needs a value or --file <path>\n\n${usage}`);
    const r = await setValue(dir, id, raw);
    if (values.json) return printJson(r);
    console.log(`slots: ${id} ${fmt(r.before)} → ${fmt(r.after)} (${r.file} ${r.pointer})`);
  }),
};
