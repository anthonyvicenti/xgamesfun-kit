// The Economy tab's looks, with no browser (studio/tabs/web3/economy-look.js): an icon and a colour for every kind of
// part and every box of the money flow, an "Add" picture button for every kind, each part's key number, the wallet's
// chip, the receipt's lines and where a day of the players' money goes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { SECTIONS, flowGraph } from '../studio/tabs/web3/economy-parts.js';
import { ADD_GROUPS, ICONS, TONES, daySplit, isEmpty, keyNumber, kindOfSection, lookOf, receiptLines, shortAmount, titleOf, walletLook } from '../studio/tabs/web3/economy-look.js';
import { starterEconomy } from '../web3/node/economy-routes.mjs';
import { simulate } from '../web3/economy/simulate.mjs';
import { cost } from '../web3/economy/cost.mjs';

const FIXTURES = new URL('../web3/economy/fixtures/', import.meta.url);
const fixtures = async () => Promise.all((await readdir(FIXTURES)).filter((f) => f.endsWith('.json')).map(async (f) => [f, JSON.parse(await readFile(new URL(f, FIXTURES), 'utf8'))]));

describe('the Economy tab’s looks (economy-look.js)', () => {
  it('every kind of part has an icon and a tone, and every box of every fixture’s picture does too', async () => {
    for (const s of SECTIONS) {
      const look = lookOf(kindOfSection(s.section));
      assert.ok(ICONS[look.icon], s.section);
      assert.ok(TONES[look.icon], s.section);
    }
    for (const [f, spec] of await fixtures()) {
      for (const n of flowGraph(spec).nodes) {
        const look = lookOf(n.kind, n.id);
        assert.ok(ICONS[look.icon] && look.icon === (n.id === 'collectibles' ? 'gem' : n.kind), `${f}: ${n.id} (${n.kind}) has no icon of its own`);
        assert.ok(['ink', 'lav', 'lime', 'info', 'warn', 'good', 'bad', 'muted'].includes(look.tone), `${f}: ${n.id}`);
      }
    }
    for (const [name, paths] of Object.entries(ICONS)) assert.match(paths, /^(<(path|circle|rect|ellipse)\b[^<>]*\/>)+$/, `${name}: inline SVG shapes only`);
  });

  it('has one "Add" picture button for every kind of part, and the three kinds of token', () => {
    const buttons = ADD_GROUPS.flatMap((g) => g.parts);
    assert.equal(new Set(buttons.map((b) => b.id)).size, buttons.length, 'test ids are unique');
    for (const s of SECTIONS.filter((x) => x.section !== 'tokens')) assert.ok(buttons.some((b) => b.kind === s.kind && b.id === s.kind), `no button for ${s.kind}`);
    assert.deepEqual(buttons.filter((b) => b.kind === 'token').map((b) => b.variant), ['curve', 'existing', 'game']);
    for (const b of buttons) {
      assert.ok(b.label.length <= 16 && b.hint.length <= 18, `${b.id}: short words`);
      assert.ok(ICONS[b.icon ?? lookOf(b.kind).icon], b.id);
    }
  });

  it('an economy with nothing that takes money is empty: the starter, or tokens alone', async () => {
    assert.equal(isEmpty(starterEconomy('Bean Brawl')), true);
    assert.equal(isEmpty({ tokens: [{ key: 'sol', source: 'sol' }, { key: 'bean', source: 'curve' }] }), true);
    assert.equal(isEmpty(undefined), true);
    for (const [f, spec] of await fixtures()) assert.equal(isEmpty(spec), false, f);
  });

  it('names each part’s key number in plain words', async () => {
    const spec = Object.fromEntries(await fixtures())['coin-flip-arena.json'];
    assert.equal(keyNumber(spec, 'boxes', spec.boxes[0]), '0.1 SOL a roll');
    assert.equal(keyNumber(spec, 'lotteries', spec.lotteries[0]), '0.01 SOL a ticket · every 7d');
    assert.equal(keyNumber(spec, 'pools', spec.pools[0]), 'starts with 5 SOL');
    assert.equal(keyNumber(spec, 'pools', spec.pools[1]), 'holds SOL');
    assert.equal(keyNumber(spec, 'stakes', spec.stakes[0]), 'lock ARENA ≥ 1d');
    assert.equal(keyNumber(spec, 'tokens', spec.tokens[1]), '$ARENA');
    assert.equal(titleOf('tokens', spec.tokens[0]), 'SOL');
    assert.equal(titleOf('pools', spec.pools[0]), 'house');
    for (const [f, s] of await fixtures()) for (const sec of SECTIONS) for (const p of s[sec.section] ?? []) {
      const k = keyNumber(s, sec.section, p);
      assert.equal(typeof k, 'string', `${f} ${sec.section}:${p.key}`);
      assert.ok(!/undefined|NaN|null/.test(k), `${f} ${sec.section}:${p.key}: ${k}`);
    }
  });

  it('the wallet chip: green with the wallet, amber when not connected, red with no wallet in the browser', () => {
    assert.deepEqual(walletLook('4ikj24Byduo7WZGhnxNYkqstpm9xUVeZH7eLQbjGDL7N', 1), { tone: 'ok', text: 'Wallet 4ikj…DL7N' });
    assert.equal(walletLook(null, 2).tone, 'warn');
    assert.equal(walletLook(null, null).tone, 'warn');
    assert.deepEqual(walletLook(null, 0), { tone: 'bad', text: 'No wallet in this browser' });
  });

  it('the receipt’s lines: rent, the pools’ seeds, fees', async () => {
    const spec = Object.fromEntries(await fixtures())['coin-flip-arena.json'];
    const c = cost(spec, { now: 1_800_000_000 });
    const lines = receiptLines(c.setup);
    assert.match(lines[0].label, /^Rent for \d+ accounts$/);
    assert.ok(lines.some((l) => l.label === 'Seeds the pools' && /^5 /.test(l.amount)), JSON.stringify(lines));
    assert.equal(lines.at(-1).label, 'Fees');
    assert.deepEqual(receiptLines(null), []);
  });

  it('where a day of the players’ money goes adds up to what they pay, never more', async () => {
    for (const [f, spec] of await fixtures()) {
      const sim = simulate(spec);
      for (const s of daySplit(sim.perDay)) {
        const sum = s.parts.reduce((a, p) => a + p.percent, 0);
        assert.ok(sum <= 100.0001 && sum > 99.9, `${f} ${s.token}: ${sum}`);
        for (const p of s.parts) assert.ok(p.percent > 0 && ['back', 'treasury', 'burned', 'kept'].includes(p.key), `${f}: ${JSON.stringify(p)}`);
      }
    }
    assert.deepEqual(daySplit({ players: { pay: { sol: 100 }, getBack: { sol: 40 } }, creator: { treasury: { sol: 10 } }, burned: {} }).map((s) => s.parts.map((p) => [p.key, Math.round(p.percent)])), [[['back', 40], ['treasury', 10], ['kept', 50]]]);
    assert.deepEqual(daySplit({ players: { pay: { sol: 10 }, getBack: { sol: 30 } } })[0].parts.map((p) => [p.key, p.percent]), [['back', 100]], 'paying back more than comes in is shown as all of it');
    assert.deepEqual(daySplit(null), []);
  });

  it('short amounts for the tiles', () => {
    assert.equal(shortAmount(0.176), '0.176');
    assert.equal(shortAmount(12345), '12,345');
    assert.equal(shortAmount(661118454101324.2), '661.1T');
    assert.equal(shortAmount('0.5'), '0.5');
  });
});
