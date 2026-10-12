// `gamesfun economy …`: check, simulate and cost a game's economy (the `economy` section of its gamesfun.json), see
// its setup plan, move an old shop into it, ask the creator to put it live (`publish` leaves a request the studio's
// Economy tab opens; the creator's wallet approves it there) and read where it stands on chain (`status`). Read-only
// apart from `migrate --write` and the request. Nothing here signs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { resolveGame } from '../lib/games.mjs';
import { check, describe } from '../web3/economy/check.mjs';
import { compile } from '../web3/economy/compile.mjs';
import { cost, explainCost } from '../web3/economy/cost.mjs';
import { migrateFile } from '../web3/economy/migrate.mjs';
import { explain, simulate } from '../web3/economy/simulate.mjs';
import { economyStatus, publishPlan, readEconomy } from '../web3/node/economy.mjs';
import { KIT_ROOT, studioUrl } from '../web3/node/game-dir.mjs';
import { queueRequest } from '../web3/node/requests.mjs';
import { chainContext } from '../web3/node/settings.mjs';

const usage = `Usage: gamesfun economy <action> [game-dir] [--spec <file>] [--json]      (devnet only)

  check       Refusals (each with its fix) and warnings for the game's economy
  simulate    What each box, ticket and craft is worth, how long each pool lasts, who pays what
  cost        What going live costs (rent, fees, seeds) and what each action costs while it runs
  plan        The setup, instruction by instruction, split into the transactions your wallet approves
  migrate     Move the game's shop into an economy (shows it; --write saves gamesfun.json)
  publish     Ask to put it live: prints the studio link where your wallet approves it (this never signs)
              [--picture <file>] the picture of a token launched on games.fun's curve with it
  status      Where it stands on devnet: each part on chain or not, and whether it matches the spec

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

/** `publish`: checks the economy, then leaves a request the studio's Economy tab opens for the wallet's approval. */
async function publish(target, values) {
  const dir = await resolveGame(target);
  const { economy, migrated, notes } = await readEconomy(dir);
  if (!economy) throw new Error(`${path.basename(dir)}'s gamesfun.json has no "economy" section yet (web3/economy/README.md).`);
  const { plan } = publishPlan(economy, { now: Math.floor(Date.now() / 1000) });
  if (!plan.ok) {
    if (values.json) printJson(plan);
    else console.log(`${describe({ refusals: plan.refusals, warnings: [] })}\n\nFix these first (npx gamesfun economy check).`);
    return 1;
  }
  const owners = plan.transactions.filter((t) => t.signer === 'owner').length;
  const launches = plan.before.filter((s) => s.ix === 'launch_on_curve');
  if (!owners && !launches.length) {
    if (values.json) printJson({ ok: true, nothing: true });
    else console.log('Everything in the economy is already live. Change it, then publish again: only what changed goes out.');
    return 0;
  }
  const input = values.picture ? { picture: values.picture } : {};
  const summary = `Put ${economy.name ?? 'the economy'} live${economy.live?.game ? ' (only what changed)' : ''}: ${owners} transaction${owners === 1 ? '' : 's'}${launches.length ? `, after launching ${launches.map((s) => s.args.symbol).join(', ')} on games.fun's curve` : ''}.`;
  const request = await queueRequest(KIT_ROOT, { kind: 'economy', gameDir: dir, input, from: 'cli', summary });
  const url = await studioUrl({ gameDir: dir, kitRoot: KIT_ROOT });
  const rel = path.relative(process.cwd(), dir) || '.';
  const where = url ? `${url} (the Economy tab)` : `the studio's Economy tab (start it with: npx gamesfun dev ${rel})`;
  if (values.json) printJson({ ok: true, requestId: request.id, url, tab: 'economy', summary, migrated });
  else console.log([...(migrated ? notes : []), summary, `Waiting for your approval: open ${where} and press "Review and approve". Your wallet shows every transaction before anything is signed; nothing is signed here.`].join('\n'));
  return 0;
}

const amountWords = (p) => (p.amount === null ? 'not open' : `${p.amount} ${p.symbol ?? ''}`.trim());

/** `status`: each part of the economy on devnet. */
async function status(target, values) {
  const dir = await resolveGame(target);
  const chain = await chainContext(KIT_ROOT);
  const s = await economyStatus(dir, { rpc: chain.rpc, network: chain.network, receipts: values.json ? 5 : 3 });
  if (values.json) {
    printJson(s);
    return 0;
  }
  if (!s.game) {
    console.log(`${path.basename(dir)}'s economy is not live yet (${s.parts.length} part${s.parts.length === 1 ? '' : 's'} to set up). Put it live: npx gamesfun economy publish`);
    return 0;
  }
  const lines = [`Game ${s.game} on loot program ${s.program} (devnet): ${s.live ? 'live' : 'not found on chain'}. ${s.explorer ?? ''}`.trim()];
  for (const p of s.parts) lines.push(`  ${p.part} ${p.key}: ${p.onChain ? (p.differs ? 'on chain, but the spec has changed (publish again)' : 'on chain, as the spec says') : 'not on chain yet'}`);
  if (s.pools.length) lines.push(`Pools: ${s.pools.map((p) => `${p.key} ${amountWords(p)}`).join(', ')}`);
  if (s.receipts.length) lines.push(`Recent: ${s.receipts.map((r) => `${r.events.join('+') || 'transaction'}${r.ok ? '' : ' (failed)'} ${r.at ?? ''}`.trim()).join('; ')}`);
  const waiting = s.parts.filter((p) => !p.onChain || p.differs).length;
  lines.push(waiting ? `${waiting} part${waiting === 1 ? '' : 's'} to publish: npx gamesfun economy publish` : 'Everything matches the spec.');
  console.log(lines.join('\n'));
  return 0;
}

export default {
  name: 'economy',
  summary: "check, simulate and cost a game's economy; its setup plan (devnet)",
  usage,
  run: (args) =>
    guard(async () => {
      const { values, positionals } = parse(args, { spec: { type: 'string' }, write: { type: 'boolean' }, picture: { type: 'string' } }, usage);
      const [action, target] = positionals;
      if (!action) throw new UsageError(usage);
      if (action === 'publish') return publish(target, values);
      if (action === 'status') return status(target, values);
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
