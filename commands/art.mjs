// gamesfun art: pictures and models from whichever maker the person has (docs/ART.md).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { chooseMaker, keyState, KINDS, loadProviders } from '../lib/art/providers.mjs';
import { artMake, artRequest, artTake } from '../lib/art/session.mjs';

const usage = `Usage:
  gamesfun art makers [--json]                     the makers this kit knows: what each makes, costs, and its licence
  gamesfun art who [--kind <k>] [--style pixel|drawn]   which maker would be used on this machine now, and why
  gamesfun art request --slot <id> --subject "<what to draw>" [--game <dir>] [--style pixel|drawn] [--plane side|top]
                       [--palette "#rrggbb #rrggbb …"] [--direction "<one line for the whole game>"] [--kind <k>]
  gamesfun art request --out <file> --kind <k> --subject "…" [--style …]        a bare file, no game
  gamesfun art take <ticket> --svg <file> | --grid <file> | --file <png or glb> [--no-write]
  gamesfun art make <ticket> [--image <concept.png>] [--yes]      a key-based maker; spends the person's money with --yes

kinds: ${KINDS.join(', ')}. The order of choice is always: art you provide → a connection you offered (a key in the
environment, or GF_ART_<KIND>=connection:<name>) → your session's own maker → the kit's stand-ins.
"request" prints a ticket and, when your own session is the maker, the exact request to draw from. "take" turns the
answer into a PNG, checks it (size, see-through ground, frames, feet, seams) and only then writes it through the slot.
No command here calls a model; "make" calls a paid service only with --yes and only with your own key.`;

export default {
  name: 'art',
  summary: 'pictures and models from whichever maker you have (your session, your keys, your files)',
  usage,
  run: args => guard(async () => {
    const [verb, ...rest] = args;
    const { values, positionals } = parse(rest, {
      kind: { type: 'string' }, style: { type: 'string' }, slot: { type: 'string' }, game: { type: 'string' }, out: { type: 'string' }, subject: { type: 'string' }, plane: { type: 'string' },
      palette: { type: 'string' }, direction: { type: 'string' }, svg: { type: 'string' }, grid: { type: 'string' }, file: { type: 'string' }, image: { type: 'string' }, 'no-write': { type: 'boolean' }, yes: { type: 'boolean' },
    }, usage);
    if (verb === 'makers') {
      const data = loadProviders();
      if (values.json) return printJson(data);
      console.log(`Order of choice: ${data.order.join(' → ')}   (prices and licences as read on ${data.checked}; re-read them before you rely on them)\n`);
      for (const p of data.providers) {
        const reach = p.reach.via === 'env' ? `key: ${p.reach.env.join(', ')} (${keyState(p).set ? 'set' : 'not set'})` : p.reach.via;
        console.log(`${p.name}  [${p.id}; ${p.tier}; makes ${p.kinds.join(', ')}${p.styles ? `; ${p.styles.join(', ')} only` : ''}; ${reach}]`);
        console.log(`  cost     ${p.cost.note}${p.cost.url ? `  (${p.cost.url})` : ''}`);
        console.log(`  licence  ${p.licence.note}`);
        console.log(`  run      ${p.run}\n`);
      }
      return;
    }
    if (verb === 'who') {
      const kinds = values.kind ? [values.kind] : KINDS;
      const out = kinds.map(kind => { const c = chooseMaker({ kind, style: values.style ?? null }); return { kind, maker: c.maker.id, name: c.connection ? `connection "${c.connection}"` : c.maker.name, why: c.why, passedOver: c.passedOver }; });
      if (values.json) return printJson(out);
      for (const o of out) { console.log(`${o.kind.padEnd(8)} ${o.name}: ${o.why}`); for (const p of o.passedOver) console.log(`           not ${p.id}: ${p.why}`); }
      return;
    }
    if (verb === 'request') {
      if (!values.subject) throw new UsageError(usage);
      const game = values.out && !values.slot ? null : await resolveGame(values.game);
      const r = await artRequest({ game, slot: values.slot ?? null, out: values.out ?? null, kind: values.kind ?? null, style: values.style ?? null, plane: values.plane ?? 'side', subject: values.subject, palette: values.palette ? values.palette.split(/[\s,]+/).filter(Boolean) : null, direction: values.direction ?? null });
      if (values.json) return printJson(r);
      console.log(`ticket ${r.ticket}: ${r.kind}${r.style ? `, ${r.style}` : ''}${r.size ? `, ${r.size.join('x')}` : ''}\nmaker: ${r.makerName} (${r.why})`);
      if (r.request) console.log(`\n----- the request -----\n${r.request}\n-----------------------`);
      console.log(`\n${r.next}`);
      return;
    }
    if (verb === 'take') {
      const id = positionals[0];
      if (!id || !(values.svg || values.grid || values.file)) throw new UsageError(usage);
      const r = await artTake(id, { svg: values.svg ? await readFile(values.svg, 'utf8') : null, grid: values.grid ? await readFile(values.grid, 'utf8') : null, file: values.file ? path.resolve(values.file) : null, write: !values['no-write'] });
      if (values.json) printJson(r);
      else {
        console.log(r.ok ? `art: passed the checks${r.written ? `, written to ${r.written.slot ?? r.written.file}` : ''}` : 'art: REFUSED');
        for (const p of r.problems) console.log(`  - ${p}`);
        for (const w of r.warnings ?? []) console.log(`  (note) ${w}`);
        if (r.look) console.log(`look at it: ${r.look}`);
        console.log(r.next);
      }
      return r.ok ? 0 : 1;
    }
    if (verb === 'make') {
      const id = positionals[0];
      if (!id) throw new UsageError(usage);
      const r = await artMake(id, { yes: !!values.yes, image: values.image ? path.resolve(values.image) : null, write: !values['no-write'], log: m => console.error(m) });
      if (values.json) printJson(r);
      else { if (r.plan) console.log(JSON.stringify(r.plan, null, 2)); for (const p of r.problems ?? []) console.log(`  - ${p}`); console.log(r.next); }
      return r.ok ? 0 : r.paid === false && !r.problems?.length ? 0 : 1;
    }
    throw new UsageError(usage);
  }),
};
