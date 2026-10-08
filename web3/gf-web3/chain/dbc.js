// Meteora Dynamic Bonding Curve (DBC): the instructions a token launch needs (create a pool from games.fun's config,
// and the creator's optional first buy in the same transaction) and the few config and pool fields the kit reads.
// Discriminators, account orders and account layouts come from the DBC IDL (program version 0.2.1) shipped inside
// @meteora-ag/dynamic-bonding-curve-sdk 1.5.12 (MIT, see THIRD_PARTY.md); tests/web3-dbc.test.mjs checks these
// builders against what that SDK builds.
import { addressBytes, encodeBase58 } from './base58.js';
import { compareBytes, concat, readUintLE, uintLE, utf8 } from './bytes.js';
import {
  associatedTokenAddress,
  metadataAddress,
  METAPLEX_METADATA_PROGRAM,
  pdaOf,
  SYSTEM_PROGRAM,
  SYSVAR_INSTRUCTIONS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from './pda.js';
import { createAssociatedTokenAccountIdempotent, meta } from './programs.js';

export const DBC_PROGRAM = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

const DISCRIMINATOR = {
  initializeWithSplToken: Uint8Array.of(140, 85, 215, 176, 102, 54, 104, 79),
  initializeWithToken2022: Uint8Array.of(169, 118, 51, 78, 145, 110, 220, 155),
  swap: Uint8Array.of(248, 198, 158, 145, 225, 117, 135, 200),
};
const ACCOUNT_DISCRIMINATOR = {
  PoolConfig: Uint8Array.of(26, 108, 14, 123, 116, 230, 129, 43),
  VirtualPool: Uint8Array.of(213, 224, 5, 209, 98, 69, 119, 92),
};

/** Byte offsets in a PoolConfig account (bytemuck, 1048 bytes including the discriminator). */
const CONFIG = {
  bytes: 1048,
  quoteMint: 8,
  feeClaimer: 40,
  baseFeeMode: 104 + 26,
  activationType: 234,
  tokenDecimal: 235,
  tokenType: 237,
  quoteTokenFlag: 238,
  migrationQuoteThreshold: 264,
  preMigrationTokenSupply: 344,
  postMigrationTokenSupply: 352,
  enableFirstSwapWithMinFee: 365,
};
/** Byte offsets in a VirtualPool account (424 bytes). */
const POOL = {
  bytes: 424,
  config: 72,
  creator: 104,
  baseMint: 136,
  baseVault: 168,
  quoteVault: 200,
  baseReserve: 232,
  quoteReserve: 240,
  isMigrated: 305,
};

const TokenType = { SplToken: 0, Token2022: 1 };
const RATE_LIMITER_MODE = 2;

export const dbcPda = {
  poolAuthority: () => pdaOf([utf8('pool_authority')], DBC_PROGRAM),
  eventAuthority: () => pdaOf([utf8('__event_authority')], DBC_PROGRAM),
  /** The pool of a base mint under a config: seeds put the larger of the two mints first. */
  pool: (quoteMint, baseMint, config) => {
    const quote = addressBytes(quoteMint);
    const base = addressBytes(baseMint);
    const [first, second] = compareBytes(quote, base) > 0 ? [quote, base] : [base, quote];
    return pdaOf([utf8('pool'), addressBytes(config), first, second], DBC_PROGRAM);
  },
  tokenVault: (pool, mint) => pdaOf([utf8('token_vault'), addressBytes(mint), addressBytes(pool)], DBC_PROGRAM),
};

const tokenProgramOf = (flag) => (flag === TokenType.Token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM);

const startsWith = (data, prefix) => data.length >= prefix.length && prefix.every((b, i) => data[i] === b);
const address = (data, at) => encodeBase58(data.subarray(at, at + 32));

/** The PoolConfig fields a launch needs. Throws when the data is not a PoolConfig. */
export function readPoolConfig(data) {
  if (data.length !== CONFIG.bytes || !startsWith(data, ACCOUNT_DISCRIMINATOR.PoolConfig)) throw new Error('Not a DBC pool config');
  return {
    quoteMint: address(data, CONFIG.quoteMint),
    feeClaimer: address(data, CONFIG.feeClaimer),
    baseFeeMode: data[CONFIG.baseFeeMode],
    activationType: data[CONFIG.activationType],
    tokenDecimal: data[CONFIG.tokenDecimal],
    tokenType: data[CONFIG.tokenType],
    quoteTokenFlag: data[CONFIG.quoteTokenFlag],
    migrationQuoteThreshold: readUintLE(data, CONFIG.migrationQuoteThreshold, 8),
    preMigrationTokenSupply: readUintLE(data, CONFIG.preMigrationTokenSupply, 8),
    postMigrationTokenSupply: readUintLE(data, CONFIG.postMigrationTokenSupply, 8),
    enableFirstSwapWithMinFee: data[CONFIG.enableFirstSwapWithMinFee] === 1,
  };
}

/** The VirtualPool fields the status read shows. */
export function readVirtualPool(data) {
  if (data.length !== POOL.bytes || !startsWith(data, ACCOUNT_DISCRIMINATOR.VirtualPool)) throw new Error('Not a DBC pool');
  return {
    config: address(data, POOL.config),
    creator: address(data, POOL.creator),
    baseMint: address(data, POOL.baseMint),
    baseVault: address(data, POOL.baseVault),
    quoteVault: address(data, POOL.quoteVault),
    baseReserve: readUintLE(data, POOL.baseReserve, 8),
    quoteReserve: readUintLE(data, POOL.quoteReserve, 8),
    isMigrated: data[POOL.isMigrated] === 1,
  };
}

const borshString = (text) => {
  const bytes = utf8(text);
  return concat(uintLE(bytes.length, 4), bytes);
};

/**
 * Create a pool (and its base mint, with Metaplex metadata for a classic SPL base) under a config.
 * `config` is the decoded PoolConfig. The base mint and the payer sign.
 */
export function createPoolInstruction({ configAddress, config, baseMint, creator, payer = creator, name, symbol, uri }) {
  const pool = dbcPda.pool(config.quoteMint, baseMint, configAddress);
  const spl = config.tokenType === TokenType.SplToken;
  const keys = [
    meta(configAddress, false, false),
    meta(dbcPda.poolAuthority(), false, false),
    meta(creator, true, false),
    meta(baseMint, true, true),
    meta(config.quoteMint, false, false),
    meta(pool, false, true),
    meta(dbcPda.tokenVault(pool, baseMint), false, true),
    meta(dbcPda.tokenVault(pool, config.quoteMint), false, true),
    ...(spl ? [meta(metadataAddress(baseMint), false, true), meta(METAPLEX_METADATA_PROGRAM, false, false)] : []),
    meta(payer, true, true),
    meta(tokenProgramOf(config.quoteTokenFlag), false, false),
    meta(spl ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM, false, false),
    meta(SYSTEM_PROGRAM, false, false),
    meta(dbcPda.eventAuthority(), false, false),
    meta(DBC_PROGRAM, false, false),
  ];
  const data = concat(
    spl ? DISCRIMINATOR.initializeWithSplToken : DISCRIMINATOR.initializeWithToken2022,
    borshString(name),
    borshString(symbol),
    borshString(uri),
  );
  return { programId: DBC_PROGRAM, keys, data, pool };
}

/**
 * The creator's first buy on a pool the same transaction creates: their token accounts (idempotent), then a swap
 * from the quote token into the new token. With `enableFirstSwapWithMinFee` the program charges the minimum fee
 * when it can see (through the instructions sysvar) that the pool was created in this transaction.
 */
export function firstBuyInstructions({ configAddress, config, baseMint, buyer, amountIn, minimumAmountOut }) {
  const pool = dbcPda.pool(config.quoteMint, baseMint, configAddress);
  const quoteProgram = tokenProgramOf(config.quoteTokenFlag);
  const baseProgram = config.tokenType === TokenType.SplToken ? TOKEN_PROGRAM : TOKEN_2022_PROGRAM;
  const input = associatedTokenAddress(buyer, config.quoteMint, quoteProgram);
  const output = associatedTokenAddress(buyer, baseMint, baseProgram);
  const sysvar = config.enableFirstSwapWithMinFee || config.baseFeeMode === RATE_LIMITER_MODE;
  const swap = {
    programId: DBC_PROGRAM,
    keys: [
      meta(dbcPda.poolAuthority(), false, false),
      meta(configAddress, false, false),
      meta(pool, false, true),
      meta(input, false, true),
      meta(output, false, true),
      meta(dbcPda.tokenVault(pool, baseMint), false, true),
      meta(dbcPda.tokenVault(pool, config.quoteMint), false, true),
      meta(baseMint, false, false),
      meta(config.quoteMint, false, false),
      meta(buyer, true, false),
      meta(baseProgram, false, false),
      meta(quoteProgram, false, false),
      meta(DBC_PROGRAM, false, false), // referral token account: none (Anchor passes the program id)
      meta(dbcPda.eventAuthority(), false, false),
      meta(DBC_PROGRAM, false, false),
      ...(sysvar ? [meta(SYSVAR_INSTRUCTIONS, false, false)] : []),
    ],
    data: concat(DISCRIMINATOR.swap, uintLE(amountIn, 8), uintLE(minimumAmountOut, 8)),
  };
  return {
    instructions: [
      createAssociatedTokenAccountIdempotent(buyer, buyer, config.quoteMint, quoteProgram),
      createAssociatedTokenAccountIdempotent(buyer, buyer, baseMint, baseProgram),
      swap,
    ],
    output,
  };
}
