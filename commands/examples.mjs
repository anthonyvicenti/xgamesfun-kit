import { guard, parse, printJson } from '../lib/cli.mjs';
import { listExamples } from '../lib/examples.mjs';

const usage = `Usage: gamesfun examples [--json]

Complete games to start from: npx gamesfun create games/<name> --from <example>`;

export default {
  name: 'examples',
  summary: 'list the example games create --from can start from',
  usage,
  run: args => guard(async () => {
    const { values } = parse(args, {}, usage);
    const all = await listExamples();
    const closed = (await listExamples(undefined, { all: true })).filter(e => !all.some(x => x.id === e.id));
    if (values.json) return printJson(all.map(({ dir, ...e }) => e));
    if (!all.length) { console.log('No examples in templates/examples/.'); return; }
    for (const e of all) {
      console.log(`${e.id.padEnd(16)} ${e.title}: ${e.summary}`);
      console.log(`${' '.repeat(17)}${e.engine && e.engine !== 'party' ? `${e.engine} · ` : ''}${e.mechanics.length ? `${e.mechanics.join(', ')} · ` : ''}${e.world ?? ''}${e.verified ? ` · verify ${e.verified.result} on kits ${String(e.verified.kits).slice(0, 12)}` : ''}`);
    }
    for (const e of closed) console.log(`\n${e.id} (${e.engine} engine) is not listed: ${e.closed.why}. ${e.closed.env}=1 lists it; create --from ${e.id} makes it either way.`);
    console.log(`\nnpx gamesfun create games/my-game --from ${all[0].id}`);
  }),
};
