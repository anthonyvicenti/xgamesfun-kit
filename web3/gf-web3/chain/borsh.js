// A small Borsh codec driven by an Anchor IDL, so neither side needs Anchor. It covers what the loot program and the
// accounts this kit reads use: bool, u8–u128, pubkey, string, fixed arrays, vec, option, defined structs and unit
// enums. Addresses are base58 strings, u64/u128 values bigints (u8–u32 numbers) and byte arrays Uint8Arrays.
// Bytemuck (repr C) accounts decode the same way because their IDL lists every padding field.
import { addressBytes, encodeBase58 } from './base58.js';
import { concat, equalBytes, fromUtf8, readUintLE, uintLE, utf8 } from './bytes.js';

const INT_SIZES = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16 };
const ADDRESS_BYTES = 32;

function typeDef(idl, name) {
  const def = idl.types.find((t) => t.name === name);
  if (!def) throw new Error(`Unknown IDL type ${name}`);
  return def;
}

function encodeScalar(type, value, out) {
  const size = INT_SIZES[type];
  if (size) out.push(uintLE(value, size));
  else if (type === 'bool') out.push(Uint8Array.of(value ? 1 : 0));
  else if (type === 'pubkey') out.push(addressBytes(String(value)));
  else if (type === 'string') {
    const bytes = utf8(String(value));
    out.push(uintLE(bytes.length, 4), bytes);
  } else throw new Error(`Unsupported IDL type ${type}`);
}

function encodeDefined(idl, name, value, out) {
  const def = typeDef(idl, name).type;
  if (def.kind === 'enum') {
    const index = def.variants.findIndex((v) => v.name === value);
    if (index < 0) throw new Error(`${name} has no variant ${String(value)}`);
    out.push(Uint8Array.of(index));
    return;
  }
  for (const field of def.fields) {
    if (!(field.name in value)) throw new Error(`${name}.${field.name} is required`);
    encodeInto(idl, field.type, value[field.name], out);
  }
}

function encodeInto(idl, type, value, out) {
  if (typeof type === 'string') return encodeScalar(type, value, out);
  if ('array' in type) {
    const [inner, length] = type.array;
    if (value.length !== length) throw new Error(`Expected ${length} items, got ${value.length}`);
    if (inner === 'u8') out.push(Uint8Array.from(value));
    else for (const item of Array.from(value)) encodeInto(idl, inner, item, out);
    return;
  }
  if ('vec' in type) {
    out.push(uintLE(value.length, 4));
    for (const item of value) encodeInto(idl, type.vec, item, out);
    return;
  }
  if ('option' in type) {
    if (value === null || value === undefined) out.push(Uint8Array.of(0));
    else {
      out.push(Uint8Array.of(1));
      encodeInto(idl, type.option, value, out);
    }
    return;
  }
  encodeDefined(idl, type.defined.name, value, out);
}

/** The Borsh bytes of one value of `type`. */
export function encodeBorsh(idl, type, value) {
  const out = [];
  encodeInto(idl, type, value, out);
  return concat(...out);
}

/** An instruction's data: its discriminator, then each argument in IDL order. */
export function encodeInstruction(idl, name, args) {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`Unknown instruction ${name}`);
  const out = [Uint8Array.from(ix.discriminator)];
  for (const arg of ix.args) {
    if (!(arg.name in args)) throw new Error(`${name}: missing argument ${arg.name}`);
    encodeInto(idl, arg.type, args[arg.name], out);
  }
  return concat(...out);
}

function decodeScalar(type, data, at) {
  const size = INT_SIZES[type];
  if (size >= 8) return [readUintLE(data, at, size), at + size];
  if (size) return [Number(readUintLE(data, at, size)), at + size];
  if (type === 'bool') {
    if (at >= data.length) throw new RangeError('read past the end of the data');
    return [data[at] !== 0, at + 1];
  }
  if (type === 'pubkey') {
    if (at + ADDRESS_BYTES > data.length) throw new RangeError('read past the end of the data');
    return [encodeBase58(data.subarray(at, at + ADDRESS_BYTES)), at + ADDRESS_BYTES];
  }
  if (type === 'string') {
    const length = Number(readUintLE(data, at, 4));
    if (at + 4 + length > data.length) throw new RangeError('string runs past the end of the data');
    return [fromUtf8(data.subarray(at + 4, at + 4 + length)), at + 4 + length];
  }
  throw new Error(`Unsupported IDL type ${type}`);
}

function decodeList(idl, inner, length, data, at) {
  const items = [];
  let offset = at;
  for (let i = 0; i < length; i++) {
    const [item, next] = decodeAt(idl, inner, data, offset);
    items.push(item);
    offset = next;
  }
  return [items, offset];
}

function decodeDefined(idl, name, data, at) {
  const def = typeDef(idl, name).type;
  if (def.kind === 'enum') {
    const variant = def.variants[data[at]];
    if (!variant) throw new Error(`${name}: unknown variant ${data[at]}`);
    return [variant.name, at + 1];
  }
  const record = {};
  let offset = at;
  for (const field of def.fields) [record[field.name], offset] = decodeAt(idl, field.type, data, offset);
  return [record, offset];
}

function decodeAt(idl, type, data, at) {
  if (typeof type === 'string') return decodeScalar(type, data, at);
  if ('array' in type) {
    const [inner, length] = type.array;
    if (inner === 'u8') {
      if (at + length > data.length) throw new RangeError('read past the end of the data');
      return [data.slice(at, at + length), at + length];
    }
    return decodeList(idl, inner, length, data, at);
  }
  if ('vec' in type) {
    const length = Number(readUintLE(data, at, 4));
    if (length > data.length) throw new RangeError('vec longer than the data');
    return decodeList(idl, type.vec, length, data, at + 4);
  }
  if ('option' in type) return data[at] === 0 ? [null, at + 1] : decodeAt(idl, type.option, data, at + 1);
  return decodeDefined(idl, type.defined.name, data, at);
}

/** One value of `type` at `offset`: [value, next offset]. */
export const decodeBorsh = (idl, type, data, offset = 0) => decodeAt(idl, type, data, offset);

/** An account of the named type, after checking its 8-byte discriminator. */
export function decodeAccount(idl, name, data) {
  const account = idl.accounts.find((a) => a.name === name);
  if (!account) throw new Error(`Unknown account type ${name}`);
  if (!equalBytes(data.subarray(0, 8), Uint8Array.from(account.discriminator))) throw new Error(`Not a ${name} account`);
  return decodeDefined(idl, name, data, 8)[0];
}

/** Whether the data starts with the named account's discriminator. */
export function isAccount(idl, name, data) {
  const account = idl.accounts.find((a) => a.name === name);
  return Boolean(account) && equalBytes(data.subarray(0, 8), Uint8Array.from(account.discriminator));
}
