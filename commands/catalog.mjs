import { catalog, catalogLines, SECTIONS } from '../lib/catalog.mjs';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';

const usage = `Usage: gamesfun catalog [section…] [--all] [--json]

What the kit can build: every game spec stays inside it. Sections: ${SECTIONS.join(', ')}.
Without a section: mechanics and worlds. --all prints every section; --json gives the whole catalog.`;

export default {
  name: 'catalog',
  summary: 'what the kit can build: mechanics, worlds, looks, bodies, props',
  usage,
  run: args => guard(async () => {
    const { values, positionals } = parse(args, { all: { type: 'boolean' } }, usage);
    const bad = positionals.filter(s => !SECTIONS.includes(s));
    if (bad.length) throw new UsageError(`unknown section ${bad.join(', ')}\n\n${usage}`);
    const c = await catalog();
    if (values.json) return printJson(c);
    const sections = values.all ? SECTIONS : positionals.length ? positionals : ['mechanics', 'worlds'];
    console.log(`gf-three ${c.kit?.version ?? ''}: what the kit can build\n`);
    for (const line of catalogLines(c, sections)) console.log(line);
  }),
};
