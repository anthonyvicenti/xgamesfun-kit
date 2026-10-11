import path from 'node:path';
import { guard, parse } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { runTool } from '../lib/run-tool.mjs';
import { installGfWeb3 } from '../web3/node/install.mjs';

const usage = `Usage: gamesfun upgrade [dir] [--out <dir>] [--world] [--json]

Bring a game made on an older kit onto the kits in this checkout (after git pull or a kit sync): the vendored copies
are refreshed, rules.js and every config value the game set are kept, new config gets the kit's defaults, and
assets.json is regenerated. --out upgrades a copy; --world also re-lays a stock world. Then run gamesfun verify.`;

export default {
  name: 'upgrade',
  summary: 'move a game onto the current kits, keeping its rules and config',
  usage,
  run: args => guard(async () => {
    const { values, positionals } = parse(args, { out: { type: 'string' }, world: { type: 'boolean' } }, usage);
    const dir = await resolveGame(positionals[0]);
    const flags = [];
    if (values.out) flags.push('--out', values.out);
    if (values.world) flags.push('--world');
    if (values.json) flags.push('--json');
    const r = await runTool('upgrade', [dir, ...flags]);
    if (r.code === 0) await installGfWeb3(values.out ? path.resolve(values.out) : dir);   // refresh gf/web3/
    return r.code;
  }),
};
