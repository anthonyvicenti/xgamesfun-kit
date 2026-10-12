import path from 'node:path';
import { guard, parse } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { runTool } from '../lib/run-tool.mjs';
import { installGfWeb3 } from '../web3/node/install.mjs';
import { migrateFile } from '../web3/economy/migrate.mjs';

const usage = `Usage: gamesfun upgrade [dir] [--out <dir>] [--world] [--dry-run] [--json]

Bring a game made on an older kit onto the kits in this checkout (after git pull or a kit sync): the vendored copies
are refreshed, rules.js and every config value the game set are kept, new config gets the kit's defaults, and
assets.json is regenerated. A game's shop (gamesfun.json) moves into its economy for loot program 0.3
(web3/economy). --out upgrades a copy; --world also re-lays a stock world; --dry-run only shows what moving the shop
into an economy would write, and changes nothing. Then run gamesfun verify.`;

export default {
  name: 'upgrade',
  summary: 'move a game onto the current kits, keeping its rules and config',
  usage,
  run: args => guard(async () => {
    // --economy was the opt-in before the shop moved into the economy by default; it is still accepted and does nothing.
    const { values, positionals } = parse(args, { out: { type: 'string' }, world: { type: 'boolean' }, economy: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, usage);
    const dir = await resolveGame(positionals[0]);
    if (values['dry-run']) {
      const moved = await migrateFile(dir, { write: false });   // shop → economy, shown only
      if (values.json) process.stdout.write(`${JSON.stringify({ dryRun: true, changed: moved.changed, notes: moved.notes, economy: moved.config?.economy ?? null }, null, 2)}\n`);
      else console.log([...moved.notes, moved.changed ? JSON.stringify(moved.config.economy, null, 2) : '', 'Dry run: nothing was changed (the kits were not upgraded either).'].filter(Boolean).join('\n'));
      return 0;
    }
    const flags = [];
    if (values.out) flags.push('--out', values.out);
    if (values.world) flags.push('--world');
    if (values.json) flags.push('--json');
    const r = await runTool('upgrade', [dir, ...flags]);
    if (r.code === 0) await installGfWeb3(values.out ? path.resolve(values.out) : dir);   // refresh gf/web3/
    if (r.code === 0) {
      const moved = await migrateFile(values.out ? path.resolve(values.out) : dir, { write: true });   // shop → economy
      if (!values.json && moved.changed) console.log(moved.notes.join('\n'));
    }
    return r.code;
  }),
};
