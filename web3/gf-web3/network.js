// The one place games.fun's chain addresses live. Everything here is public: program ids, the launchpad's curve
// config and quote mint, fee wallets, the Irys node. No key, token or keyed RPC URL ever belongs in this file.
// Devnet only: there is deliberately no mainnet entry (creator decision; mainnet needs explicit approval).
// Source: games.fun launchpad/devnet.json (2026-10-01; loot 0.3 under `loot03`, 2026-10-11) and launchpad/lib/mint-info.mjs.

export const DEVNET = 'devnet';

const devnet = Object.freeze({
  id: DEVNET,
  /** The Wallet Standard chain a wallet signs for. */
  chain: 'solana:devnet',
  /** A public RPC that needs no key. The creator may use their own (gamesfun web3 settings --rpc); players use this. */
  rpcUrl: 'https://api.devnet.solana.com',
  explorer: 'https://explorer.solana.com/{kind}/{id}?cluster=devnet',
  /** Irys (Arweave) bundler node, paid in devnet SOL. Devnet uploads are not permanent. */
  irys: Object.freeze({ node: 'https://devnet.irys.xyz', gateway: 'https://devnet.irys.xyz', currency: 'solana' }),
  /** Meteora Dynamic Bonding Curve launches on games.fun's config, quoted in its main token (partner fees to games.fun). */
  launchpad: Object.freeze({
    dbcProgram: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
    configName: 'antisnipe-v1',
    config: 'FZpLG3faLrRdrFn2n1SU7MDLmmzgyL69g4Rbr21kibTi',
    quoteMint: '4ikj24Byduo7WZGhnxNYkqstpm9xUVeZH7eLQbjGDL7N',
    quoteDecimals: 6,
    quoteSymbol: 'MAIN-dev',
    partner: '8yPDcNeKHwfSmyx9MPNpgqU8o1W4xiCHxzYty7w3rnNV',
  }),
  /**
   * The games.fun loot program 0.3 (items, shop, loot boxes and every other economy piece), its platform record and
   * its two flat fees in lamports: the player fee when a player signs for something of their own (a purchase, a box,
   * tickets, a stake), the project fee for everything else that is charged. The platform account holds the fees in
   * force; these are what it was set up with (games.fun launchpad/loot devnet-deploy-0.3-result.json, 2026-10-11).
   * Shops take SOL, any classic SPL token and any Token-2022 token.
   */
  loot: Object.freeze({
    program: '88Labq6tdVnBQsjHSfic6qqgvo5b9NGmy99AYj7KVXqM',
    platform: 'DFbnNkPGmsrc9NT4yZKoiD161gt2SPK98DKe4yAL2cm9',
    playerFeeLamports: 2_000_000,
    projectFeeLamports: 10_000,
    partner: '8yPDcNeKHwfSmyx9MPNpgqU8o1W4xiCHxzYty7w3rnNV',
    token2022: true,
  }),
  /** Currencies a shop can be priced in without typing an address (any other mint, classic or Token-2022, works by address). */
  currencies: Object.freeze([
    Object.freeze({ kind: 'sol', symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 }),
    Object.freeze({ kind: 'main', symbol: 'MAIN-dev', mint: '4ikj24Byduo7WZGhnxNYkqstpm9xUVeZH7eLQbjGDL7N', decimals: 6 }),
    Object.freeze({ kind: 'usdc', symbol: 'USDC-dev', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 }),
  ]),
});

export const NETWORKS = Object.freeze({ [DEVNET]: devnet });

/** The network by name. Anything but devnet is refused: there is no mainnet in this kit. */
export function networkConfig(name = DEVNET) {
  if (name !== DEVNET) throw new Error(`The games.fun kit runs on devnet only (asked for ${String(name)}).`);
  return NETWORKS[name];
}

/** An explorer link for an address, a transaction or a token. */
export const explorerUrl = (network, kind, id) =>
  network.explorer.replace('{kind}', kind).replace('{id}', encodeURIComponent(id));
