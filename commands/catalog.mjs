import { catalog, catalogLines, DEFAULT_SECTIONS, SECTIONS } from '../lib/catalog.mjs';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';

const usage = `Usage: gamesfun catalog [section…] [--all] [--json]

What the kit has: a library to build with, never the limit of an idea (what it lacks, the game makes: the "made" section). Sections: ${SECTIONS.join(', ')}.
Without a section: loops, mechanics and worlds. --all prints every section; --json gives the whole catalog.`;

export default {
  name: 'catalog',
  summary: 'what the kit has: loops, mechanics, worlds, looks, bodies, props, and how a game makes what it lacks',
  usage,
  run: args => guard(async () => {
    const { values, positionals } = parse(args, { all: { type: 'boolean' } }, usage);
    const bad = positionals.filter(s => !SECTIONS.includes(s));
    if (bad.length) throw new UsageError(`unknown section ${bad.join(', ')}\n\n${usage}`);
    const c = await catalog();
    if (values.json) return printJson(c);
    const sections = values.all ? SECTIONS : positionals.length ? positionals : DEFAULT_SECTIONS;
    console.log(`gf-three ${c.kit?.version ?? ''}: what the kit has (a library; what it lacks, the game makes)\n`);
    for (const line of catalogLines(c, sections)) console.log(line);
  }),
};
