// A small fake of the Solana JSON-RPC and the Irys node, for offline tests of the creator flows. It checks every
// signature on what it is sent (so a flow that sends a half-signed transaction fails here), and applies the effects
// the flows rely on: the loot program's create_game / upsert_item / upsert_box, Metaplex Core's collection, and a
// Meteora DBC pool with its mint and metadata.
import { createHash } from 'node:crypto';
import { addressBytes, decodeBase58, encodeBase58 } from '../../web3/gf-web3/chain/base58.js';
import { encodeBorsh, decodeBorsh } from '../../web3/gf-web3/chain/borsh.js';
import { concat, fromBase64, toBase64, uintLE, utf8 } from '../../web3/gf-web3/chain/bytes.js';
import { LOOT_IDL, LOOT_PROGRAM } from '../../web3/gf-web3/chain/loot.js';
import { MPL_CORE_PROGRAM } from '../../web3/gf-web3/chain/core.js';
import { DBC_PROGRAM } from '../../web3/gf-web3/chain/dbc.js';
import { TOKEN_PROGRAM } from '../../web3/gf-web3/chain/pda.js';
import { readMessage, readTransaction } from '../../web3/gf-web3/chain/tx.js';
import { verifySignature } from '../../web3/node/ed25519.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? Number(v) : v)), { status, headers: { 'content-type': 'application/json' } });
const discriminator = (kind, name) => Uint8Array.from((kind === 'ix' ? LOOT_IDL.instructions : LOOT_IDL.accounts).find((x) => x.name === name).discriminator);
const borshString = (s) => concat(uintLE(utf8(s).length, 4), utf8(s));

export function fakeChain({ irysFree = true } = {}) {
  const accounts = new Map();
  const sent = [];
  const simulated = [];
  const uploads = [];
  const irysBalances = new Map();
  let slot = 1000;
  const blockhash = encodeBase58(createHash('sha256').update('fake blockhash').digest());

  const put = (address, owner, data) => accounts.set(address, { owner, data, lamports: 1_000_000 });
  const rawAccount = (a) => (a ? { owner: a.owner, lamports: a.lamports, data: [toBase64(a.data), 'base64'], executable: false } : null);

  function lootEffect(name, args, keys) {
    const ix = LOOT_IDL.instructions.find((i) => i.name === name);
    const at = (n) => keys[ix.accounts.findIndex((a) => a.name === n)];
    if (name === 'create_game') {
      const data = encodeBorsh(LOOT_IDL, { defined: { name: 'Game' } }, { authority: at('authority'), admins: [], collection: at('collection'), mint: at('mint'), treasury: at('treasury'), burn_bps: args.burn_bps, paused: false, orders: 0n, bump: 255 });
      put(at('game'), LOOT_PROGRAM, concat(discriminator('account', 'Game'), data));
    } else if (name === 'upsert_item') {
      const a = args.args;
      const existing = accounts.get(at('item'));
      const issued = existing ? decodeBorsh(LOOT_IDL, { defined: { name: 'ItemDef' } }, existing.data, 8)[0].issued : 0;
      const data = encodeBorsh(LOOT_IDL, { defined: { name: 'ItemDef' } }, { game: at('game'), item_id: args.item_id, kind: a.kind, rarity: a.rarity, soulbound: a.soulbound, name: a.name, uri: a.uri, max_supply: a.max_supply, issued, price: a.price, active: a.active, bump: 255 });
      put(at('item'), LOOT_PROGRAM, concat(discriminator('account', 'ItemDef'), data));
    } else if (name === 'upsert_box') {
      const data = encodeBorsh(LOOT_IDL, { defined: { name: 'LootBox' } }, { game: at('game'), box_id: args.box_id, price: args.price, active: args.active, entries: args.entries, opened: 0n, bump: 255 });
      put(at('loot_box'), LOOT_PROGRAM, concat(discriminator('account', 'LootBox'), data));
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
  return { fetchImpl, accounts, put, sent, simulated, uploads, irysBalances, blockhash };
}
