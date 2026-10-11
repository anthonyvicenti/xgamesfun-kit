import path from 'node:path';
import { guard, parse } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { runTool } from '../lib/run-tool.mjs';
import { installGfWeb3 } from '../web3/node/install.mjs';
import { migrateFile } from '../web3/economy/migrate.mjs';

const usage = `Usage: gamesfun upgrade [dir] [--out <dir>] [--world] [--economy] [--json]

Bring a game made on an older kit onto the kits in this checkout (after git pull or a kit sync): the vendored copies
are refreshed, rules.js and every config value the game set are kept, new config gets the kit's defaults, and
assets.json is regenerated. --out upgrades a copy; --world also re-lays a stock world. --economy also moves the game's
shop (gamesfun.json) into an economy for loot program 0.3 (web3/economy). Then run gamesfun verify.`;

export default {
  name: 'upgrade',
  summary: 'move a game onto the current kits, keeping its rules and config',
  usage,
  run: args => guard(async () => {
    const { values, positionals } = parse(args, { out: { type: 'string' }, world: { type: 'boolean' }, economy: { type: 'boolean' } }, usage);
    const dir = await resolveGame(positionals[0]);
    const flags = [];
    if (values.out) flags.push('--out', values.out);
    if (values.world) flags.push('--world');
    if (values.json) flags.push('--json');
    const r = await runTool('upgrade', [dir, ...flags]);
    if (r.code === 0) await installGfWeb3(values.out ? path.resolve(values.out) : dir);   // refresh gf/web3/
    if (r.code === 0 && values.economy) {
      const moved = await migrateFile(values.out ? path.resolve(values.out) : dir, { write: true });   // shop → economy
      if (!values.json) console.log(moved.notes.join('\n'));
    }
    return r.code;
  }),
};
