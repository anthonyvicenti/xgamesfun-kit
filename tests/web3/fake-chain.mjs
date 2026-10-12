// A small fake of the Solana JSON-RPC and the Irys node, for offline tests of the creator flows. It checks every
// signature on what it is sent (so a flow that sends a half-signed transaction fails here), and applies the effects
// the flows rely on: the loot program 0.3's create_game / open_pool / upsert_item / upsert_box / upsert_recipe /
// upsert_schedule / upsert_lottery / open_stake, a shop purchase's order
// (buy_item opens it rolled, settle and refund close it), Metaplex Core's collection, and a Meteora DBC pool with its
// mint and metadata.
import { createHash } from 'node:crypto';
import { addressBytes, decodeBase58, encodeBase58 } from '../../web3/gf-web3/chain/base58.js';
import { decodeAccount, decodeBorsh, encodeAccount } from '../../web3/gf-web3/chain/borsh.js';
import { concat, fromBase64, toBase64, uintLE, utf8 } from '../../web3/gf-web3/chain/bytes.js';
import { LOOT_IDL, LOOT_PROGRAM, NO_ADDRESS } from '../../web3/gf-web3/chain/loot.js';
import { MPL_CORE_PROGRAM } from '../../web3/gf-web3/chain/core.js';
import { DBC_PROGRAM } from '../../web3/gf-web3/chain/dbc.js';
import { TOKEN_PROGRAM } from '../../web3/gf-web3/chain/pda.js';
import { readMessage, readTransaction } from '../../web3/gf-web3/chain/tx.js';
import { verifySignature } from '../../web3/node/ed25519.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? Number(v) : v)), { status, headers: { 'content-type': 'application/json' } });
const borshString = (s) => concat(uintLE(utf8(s).length, 4), utf8(s));

export function fakeChain({ irysFree = true } = {}) {
  const accounts = new Map();
  const sent = [];
  const rolls = [];
  const simulated = [];
  const uploads = [];
  const irysBalances = new Map();
  let slot = 1000;
  const blockhash = encodeBase58(createHash('sha256').update('fake blockhash').digest());

  const put = (address, owner, data) => accounts.set(address, { owner, data, lamports: 1_000_000 });
  // Wrapped SOL's mint is always there, as on the real chain.
  const nativeMint = new Uint8Array(82);
  nativeMint[44] = 9;
  nativeMint[45] = 1;
  put('So11111111111111111111111111111111111111112', TOKEN_PROGRAM, nativeMint);
  const rawAccount = (a) => (a ? { owner: a.owner, lamports: a.lamports, data: [toBase64(a.data), 'base64'], executable: false } : null);

  const loot = (address, type, value) => put(address, LOOT_PROGRAM, encodeAccount(LOOT_IDL, type, value));
  const read = (address, type) => decodeAccount(LOOT_IDL, type, accounts.get(address).data);

  function lootEffect(name, args, keys) {
    const ix = LOOT_IDL.instructions.find((i) => i.name === name);
    const names = [];
    const walk = (list) => list.forEach((a) => (a.accounts ? walk(a.accounts) : names.push(a.name)));
    walk(ix.accounts);
    const at = (n) => keys[names.indexOf(n)];
    if (name === 'create_game') {
      loot(at('game'), 'Game', { owner: at('owner'), authority: args.authority, collection: at('collection'), mint: at('mint'), treasury: at('treasury'), orders: 0n, bump: 255, paused: false, suspended: false, official: null });
    } else if (name === 'upsert_item') {
      const issued = accounts.get(at('item')) ? read(at('item'), 'Item').issued : 0;
      loot(at('item'), 'Item', { ...args.args, game: at('game'), item_id: args.item_id, issued, bump: 255 });
    } else if (name === 'upsert_box') {
      const old = accounts.get(at('loot_box')) ? read(at('loot_box'), 'LootBox') : null;
      loot(at('loot_box'), 'LootBox', { ...args.args, game: at('game'), box_id: args.box_id, opened: 0n, version: old ? old.version + 1 : 0, bump: 255 });
    } else if (name === 'open_pool') {
      const data = new Uint8Array(165);
      data.set(addressBytes(at('mint')), 0);
      data.set(addressBytes(at('game')), 32);
      put(at('pool'), TOKEN_PROGRAM, data);
    } else if (name === 'upsert_recipe') {
      loot(at('recipe'), 'Recipe', { ...args.args, game: at('game'), id: args.id, bump: 255, version: 0 });
    } else if (name === 'upsert_schedule') {
      loot(at('schedule'), 'Schedule', { ...args.args, game: at('game'), id: args.id, bump: 255, runs: 0 });
    } else if (name === 'upsert_lottery') {
      const places = [...args.args.places, ...Array(8 - args.args.places.length).fill(0)];
      loot(at('lottery'), 'Lottery', { ...args.args, places, game: at('game'), id: args.id, bump: 255, round: 0, status: 'Open', sold: 0n, asked_slot: 0n, winner: NO_ADDRESS, first_ticket: 0n, paid: 0, pot_at_payout: 0n });
    } else if (name === 'open_stake') {
      loot(at('stake'), 'Stake', { game: at('game'), id: args.id, bump: 255, mint: at('mint'), rewards_pool: args.rewards_pool, rewards_mint: at('rewards_mint'), lock: args.lock, total: 0n, reward_per_token: 0n });
    } else if (name === 'buy_item') {
      const item = read(at('item'), 'Item');
      loot(at('item'), 'Item', { ...item, issued: item.issued + 1 });
      loot(at('order'), 'Order', {
        game: at('game'), player: at('player'), nonce: args.nonce, mint: at('mint'), loot_box: NO_ADDRESS, box_version: 0, status: 'Rolled',
        outcome: { Item: [args.item_id] }, serial: item.issued + 1, paid: item.price, fee: 2_000_000n, shares: item.shares, requested_slot: BigInt(slot), bump: 255,
      });
    } else if (name === 'open_box') {
      // The oracle answers at once here: `rolls` says how (the box's first entry, unless a test pushed 'Failed').
      const box = read(at('loot_box'), 'LootBox');
      const failed = rolls.shift() === 'Failed';
      loot(at('order'), 'Order', {
        game: at('game'), player: at('player'), nonce: args.nonce, mint: at('mint'), loot_box: at('loot_box'), box_version: box.version, status: failed ? 'Failed' : 'Rolled',
        outcome: failed ? 'Nothing' : box.entries[0].outcome, serial: 1, paid: box.price, fee: 2_000_000n, shares: box.shares, requested_slot: BigInt(slot), bump: 255,
      });
    } else if (name === 'settle' || name === 'settle_prize' || name === 'refund') {
      accounts.delete(at('order'));
    }
  }

  function decodeLootIx(data) {
    const ix = LOOT_IDL.instructions.find((i) => i.discriminator.every((b, j) => data[j] === b));
    if (!ix) throw new Error('unknown loot instruction');
    let at = 8;
    const args = {};
    for (const arg of ix.args) [args[arg.name], at] = decodeBorsh(LOOT_IDL, arg.type, data, at);
    return { name: ix.name, args };
  }

  function apply(wire, { verify }) {
    const { message, signatures, signers } = readTransaction(wire);
    if (verify) signers.forEach((s, i) => {
      if (!verifySignature(s, message, signatures[i])) throw Object.assign(new Error(`Transaction signature verification failure for ${s}`), { code: -32003 });
    });
    const m = readMessage(message);
    if (m.blockhash !== blockhash) throw new Error('Blockhash not found');
    const effects = [];
    for (const ix of m.instructions) {
      const program = m.keys[ix.programIndex];
      const keys = ix.accountIndexes.map((i) => m.keys[i]);
      if (program === LOOT_PROGRAM) effects.push(() => {
        const { name, args } = decodeLootIx(ix.data);
        lootEffect(name, args, keys);
      });
      if (program === MPL_CORE_PROGRAM && ix.data[0] === 21) effects.push(() => {
        let at = 1;
        const nameLen = Number(new DataView(ix.data.buffer, ix.data.byteOffset + at, 4).getUint32(0, true));
        const name = new TextDecoder().decode(ix.data.subarray(at + 4, at + 4 + nameLen));
        at += 4 + nameLen;
        const uriLen = new DataView(ix.data.buffer, ix.data.byteOffset + at, 4).getUint32(0, true);
        const uri = new TextDecoder().decode(ix.data.subarray(at + 4, at + 4 + uriLen));
        put(keys[0], MPL_CORE_PROGRAM, concat(Uint8Array.of(5), addressBytes(keys[1]), borshString(name), borshString(uri), uintLE(0, 4), uintLE(0, 4)));
      });
      if (program === DBC_PROGRAM && ix.data.length > 8 && [140, 85, 215, 176].every((b, j) => ix.data[j] === b)) effects.push(() => {
        const [config, , creator, baseMint, , pool, , , mintMetadata] = keys;
        const vp = new Uint8Array(424);
        vp.set([213, 224, 5, 209, 98, 69, 119, 92]);
        vp.set(addressBytes(config), 72);
        vp.set(addressBytes(creator), 104);
        vp.set(addressBytes(baseMint), 136);
        put(pool, DBC_PROGRAM, vp);
        const mint = new Uint8Array(82);
        mint[44] = 6;
        mint[45] = 1;
        put(baseMint, TOKEN_PROGRAM, mint);
        let at = 8;
        const read = () => {
          const n = new DataView(ix.data.buffer, ix.data.byteOffset + at, 4).getUint32(0, true);
          const s = new TextDecoder().decode(ix.data.subarray(at + 4, at + 4 + n));
          at += 4 + n;
          return s;
        };
        const [name, symbol, uri] = [read(), read(), read()];
        put(mintMetadata, 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', concat(Uint8Array.of(4), addressBytes(creator), addressBytes(baseMint), borshString(name), borshString(symbol), borshString(uri)));
      });
    }
    return { effects, signature: encodeBase58(signatures[0]), m };
  }

  async function rpc(body) {
    const { method, params, id } = body;
    const ok = (result) => json({ jsonrpc: '2.0', id, result });
    const err = (message, code = -32002) => json({ jsonrpc: '2.0', id, error: { code, message } });
    switch (method) {
      case 'getLatestBlockhash':
        return ok({ context: { slot }, value: { blockhash, lastValidBlockHeight: 10_000 } });
      case 'getBlockHeight':
        return ok(500);
      case 'getSlot':
        return ok(slot);
      case 'getMultipleAccounts':
        return ok({ context: { slot }, value: params[0].map((a) => rawAccount(accounts.get(a))) });
      case 'getAccountInfo':
        return ok({ context: { slot }, value: rawAccount(accounts.get(params[0])) });
      case 'getProgramAccounts': {
        const [program, { filters = [] } = {}] = params;
        const match = (data) =>
          filters.every((f) => {
            if (f.dataSize !== undefined) return data.length === f.dataSize;
            const want = decodeBase58(f.memcmp.bytes);
            return want.every((b, i) => data[f.memcmp.offset + i] === b);
          });
        return ok([...accounts.entries()].filter(([, a]) => a.owner === program && match(a.data)).map(([pubkey, a]) => ({ pubkey, account: rawAccount(a) })));
      }
      case 'getMinimumBalanceForRentExemption':
        return ok((params[0] + 128) * 5080);
      case 'getSignaturesForAddress':
        return ok(sent.slice(-(params[1]?.limit ?? 10)).reverse().map((signature) => ({ signature, slot, err: null, blockTime: 1_800_000_000 })));
      case 'getTransaction':
        return ok({ meta: { logMessages: [] } });
      case 'getBalance':
        return ok({ context: { slot }, value: 5_000_000_000 });
      case 'getTokenAccountBalance': {
        const a = accounts.get(params[0]);
        if (!a) return err('Invalid param: could not find account', -32602);
        return ok({ context: { slot }, value: { amount: String(new DataView(a.data.buffer, a.data.byteOffset).getBigUint64(64, true)), decimals: 6 } });
      }
      case 'simulateTransaction': {
        try {
          const { m } = apply(fromBase64(params[0]), { verify: params[1]?.sigVerify !== false });
          simulated.push(m);
          const watch = params[1]?.accounts?.addresses ?? [];
          const token = (amount) => {
            const d = new Uint8Array(165);
            new DataView(d.buffer).setBigUint64(64, amount, true);
            return { owner: TOKEN_PROGRAM, lamports: 2039280, data: [toBase64(d), 'base64'], executable: false };
          };
          return ok({ context: { slot }, value: { err: null, logs: ['Program log: ok'], unitsConsumed: 123456, accounts: watch.map(() => token(47_388_825_736_462n)) } });
        } catch (e) {
          return ok({ context: { slot }, value: { err: { InstructionError: [0, 'Custom'] }, logs: [`Program log: ${e.message}`], unitsConsumed: 0 } });
        }
      }
      case 'sendTransaction': {
        try {
          const { effects, signature } = apply(fromBase64(params[0]), { verify: true });
          for (const e of effects) e();
          sent.push(signature);
          return ok(signature);
        } catch (e) {
          return err(e.message, e.code ?? -32002);
        }
      }
      case 'getSignatureStatuses':
        return ok({ context: { slot }, value: params[0].map((s) => (sent.includes(s) ? { slot, confirmations: 1, err: null, confirmationStatus: 'confirmed' } : null)) });
      default:
        return err(`fake chain: no ${method}`);
    }
  }

  async function irys(url, init) {
    const u = new URL(url);
    if (u.pathname.startsWith('/price/')) return new Response('39874');
    if (u.pathname === '/info') return json({ addresses: { solana: '4a7s9iC5NwfUtf8fXpKWxYXcekfqiN6mRqipYXMtcrUS' } });
    if (u.pathname === '/account/balance/solana' && init?.method === 'POST') return json({ confirmed: true });
    if (u.pathname === '/account/balance/solana') return json({ balance: String(irysBalances.get(u.searchParams.get('address')) ?? 0) });
    if (u.pathname === '/tx/solana' && init?.method === 'POST') {
      const bytes = new Uint8Array(init.body);
      if (!irysFree && bytes.length > 1000) return new Response('Not enough balance for transaction', { status: 402 });
      const id = encodeBase58(createHash('sha256').update(bytes.subarray(2, 66)).digest());
      uploads.push({ id, bytes });
      return json({ id, timestamp: Date.now() });
    }
    return new Response('not found', { status: 404 });
  }

  const fetchImpl = async (url, init = {}) => {
    if (String(url).startsWith('https://devnet.irys.xyz')) return irys(String(url), init);
    return rpc(JSON.parse(init.body));
  };
  return { fetchImpl, accounts, put, sent, simulated, uploads, irysBalances, blockhash, rolls };
}
