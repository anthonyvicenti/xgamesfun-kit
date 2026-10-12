// `gamesfun economy …`: check, simulate and cost a game's economy (the `economy` section of its gamesfun.json), see
// its setup plan, and move an old shop into it. Read-only apart from `migrate --write`. Nothing here signs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { check, describe } from '../web3/economy/check.mjs';
import { compile } from '../web3/economy/compile.mjs';
import { cost, explainCost } from '../web3/economy/cost.mjs';
import { migrateFile } from '../web3/economy/migrate.mjs';
import { explain, simulate } from '../web3/economy/simulate.mjs';

const usage = `Usage: gamesfun economy <action> [game-dir] [--spec <file>] [--json]      (devnet only)

  check       Refusals (each with its fix) and warnings for the game's economy
  simulate    What each box, ticket and craft is worth, how long each pool lasts, who pays what
  cost        What going live costs (rent, fees, seeds) and what each action costs while it runs
  plan        The setup, instruction by instruction, split into the transactions your wallet approves
  migrate     Move the game's shop into an economy (shows it; --write saves gamesfun.json)
  publish     Not yet: needs the loot 0.3 chain client (the economy publish flow)
  status      Not yet: needs the loot 0.3 chain client

The economy is the "economy" section of the game's gamesfun.json (web3/economy/README.md).
--spec <file> reads an economy (or a whole gamesfun.json) from a file instead of a game.`;

async function load(positional, spec) {
  if (spec) {
    const value = JSON.parse(await readFile(path.resolve(spec), 'utf8'));
    return { economy: value.economy ?? value, network: value.economy ? value.network : value.network ?? 'devnet', where: spec };
  }
  const dir = await resolveGame(positional);
  let config;
  try {
    config = JSON.parse(await readFile(path.join(dir, 'gamesfun.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${path.basename(dir)} has no gamesfun.json yet. Write its economy there (web3/economy/README.md; an example: web3/economy/fixtures/coin-flip-arena.json).`);
    throw new Error(`gamesfun.json is not valid JSON: ${e.message}`);
  }
  if (!config.economy) {
    if (config.shop) throw new Error(`${path.basename(dir)} has a shop and no economy yet. Move it: npx gamesfun economy migrate ${positional ?? ''} --write`);
    throw new Error(`${path.basename(dir)}'s gamesfun.json has no "economy" section yet (web3/economy/README.md).`);
  }
  return { economy: config.economy, network: config.network ?? 'devnet', where: dir, dir };
}

const words = (plan) =>
  [
    ...plan.before.map((s) => `First, on its own: ${s.says}`),
    ...plan.transactions.map((t, i) => `Transaction ${i + 1} (${t.signer} signs, about ${t.bytes} of ${plan.budget.maxBytes} bytes):\n${t.steps.map((s) => `  ${s.program}.${s.ix}: ${s.says}`).join('\n')}`),
    ...plan.notes,
  ].join('\n');

export default {
  name: 'economy',
  summary: "check, simulate and cost a game's economy; its setup plan (devnet)",
  usage,
  run: (args) =>
    guard(async () => {
      const { values, positionals } = parse(args, { spec: { type: 'string' }, write: { type: 'boolean' } }, usage);
      const [action, target] = positionals;
      if (!action) throw new UsageError(usage);
      if (action === 'publish' || action === 'status') {
        console.error(`gamesfun economy ${action} is not built yet: it needs the loot 0.3 chain client, which is being written. Until then: npx gamesfun economy check, simulate, cost and plan.`);
        return 2;
      }
      if (action === 'migrate') {
        const dir = await resolveGame(target);
        const r = await migrateFile(dir, { write: values.write });
        if (values.json) printJson(r);
        else {
          console.log(r.notes.join('\n'));
          if (r.changed) console.log(r.written ? `Saved ${path.relative(process.cwd(), r.file)}.` : `${JSON.stringify(r.config.economy, null, 2)}\n(Not saved. Add --write to save it.)`);
        }
        return 0;
      }
      const { economy, network } = await load(target, values.spec);
      if (action === 'check') {
        const r = check(economy, { network });
        if (values.json) printJson(r);
        else console.log(r.refusals.length || r.warnings.length ? describe(r) : 'No problems found.');
        if (!values.json) console.log(r.ok ? `\nReady to go live (${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}).` : `\n${r.refusals.length} refusal${r.refusals.length === 1 ? '' : 's'}: fix ${r.refusals.length === 1 ? 'it' : 'them'} before going live.`);
        return r.ok ? 0 : 1;
      }
      const verdict = check(economy, { network });
      if (!verdict.ok) {
        if (values.json) printJson(verdict);
        else console.log(`${describe({ refusals: verdict.refusals, warnings: [] })}\n\nFix these first (npx gamesfun economy check).`);
        return 1;
      }
      if (action === 'simulate') {
        const sim = simulate(economy, { now: Math.floor(Date.now() / 1000) });
        if (values.json) printJson(sim);
        else console.log(explain(sim, economy));
        return 0;
      }
      if (action === 'cost') {
        const c = cost(economy, { network });
        if (values.json) printJson(c);
        else console.log(c.ok ? explainCost(c) : describe(c));
        return c.ok ? 0 : 1;
      }
      if (action === 'plan') {
        const p = compile(economy, { network });
        if (values.json) printJson(p);
        else console.log(p.ok ? words(p) : describe(p));
        return p.ok ? 0 : 1;
      }
      throw new UsageError(`Unknown action "${action}".\n\n${usage}`);
    }),
};
