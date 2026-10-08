// The seams other tracks plug into (docs/ARCHITECTURE.md): commands, MCP tools, studio tabs. Routes: server.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BIN, KIT_ROOT, STUDIO } from '../lib/paths.mjs';
import { createServer, inputProblems, loadTools, toResult, TOOLS_DIR } from '../mcp/server.mjs';
import { tempDir } from './helpers.mjs';

const CORE_COMMANDS = ['catalog', 'create', 'dev', 'examples', 'meshy', 'play', 'promises', 'rig-check', 'slots', 'upgrade', 'verify'];

test('commands: every commands/*.mjs exports default { name, summary, usage, run }', async () => {
  const dir = path.join(KIT_ROOT, 'commands');
  const names = new Set();
  for (const f of (await readdir(dir)).filter(f => f.endsWith('.mjs'))) {
    const c = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    assert.equal(typeof c?.name, 'string', `${f}: name`);
    assert.equal(typeof c.summary, 'string', `${f}: summary`);
    assert.equal(typeof c.usage, 'string', `${f}: usage`);
    assert.equal(typeof c.run, 'function', `${f}: run`);
    assert.ok(!names.has(c.name), `${f}: duplicate name ${c.name}`);
    names.add(c.name);
  }
  for (const n of CORE_COMMANDS) assert.ok(names.has(n), `core command ${n}`);
});

test('commands: the CLI lists every command and answers --help and bad input plainly', () => {
  const help = spawnSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  for (const n of CORE_COMMANDS) assert.match(help.stdout, new RegExp(`\\n  ${n} `));
  const h = spawnSync(process.execPath, [BIN, 'create', '--help'], { encoding: 'utf8' });
  assert.match(h.stdout, /--from <example>/);
  const bad = spawnSync(process.execPath, [BIN, 'create', 'x', '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.doesNotMatch(bad.stderr, /at .*\.mjs:\d+/, 'no stack trace for a usage error');
  assert.equal(spawnSync(process.execPath, [BIN, 'no-such-command'], { encoding: 'utf8' }).status, 1);
});

test('MCP tools: core tools load, with valid unique names and object schemas', async () => {
  const { tools, problems } = await loadTools(TOOLS_DIR);
  assert.deepEqual(problems, []);
  for (const n of ['gamesfun_catalog', 'gamesfun_create', 'gamesfun_verify', 'gamesfun_slots_list', 'gamesfun_slots_set', 'gamesfun_dev_status', 'gamesfun_dev_start']) assert.ok(tools.has(n), n);
  for (const t of tools.values()) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(t.inputSchema.type, 'object', `${t.name} schema`);
    assert.ok(t.description.length > 20, `${t.name} description`);
  }
});

test('MCP tools: a plug-in tools file is picked up; a broken one or a duplicate name is reported, not fatal', async () => {
  const t = await tempDir();
  try {
    await writeFile(path.join(t.dir, 'extra.mjs'), `export const tools = [{ name: 'extra_hello', description: 'Says hello to whoever asks.', inputSchema: { type: 'object', required: ['who'], properties: { who: { type: 'string' } } }, handler: ({ who }, ctx) => ({ hello: who, kitRoot: ctx.kitRoot }) }];`);
    await writeFile(path.join(t.dir, 'zz-dupe.mjs'), `export const tools = [{ name: 'extra_hello', description: 'A second tool with the same name.', handler: () => 1 }];`);
    await writeFile(path.join(t.dir, 'broken.mjs'), 'throw new Error("boom");');
    const { tools, problems } = await loadTools(t.dir);
    assert.ok(tools.has('extra_hello'));
    assert.equal(problems.length, 2);
    // over the protocol, with an in-memory client
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { server } = await createServer({ toolsDir: t.dir, log: () => {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    assert.deepEqual((await client.listTools()).tools.map(x => x.name), ['extra_hello']);
    const r = await client.callTool({ name: 'extra_hello', arguments: { who: 'ada' } });
    assert.deepEqual(JSON.parse(r.content[0].text), { hello: 'ada', kitRoot: KIT_ROOT });
    const missing = await client.callTool({ name: 'extra_hello', arguments: {} });
    assert.equal(missing.isError, true);
    await client.close();
  } finally { await t.cleanup(); }
});

test('MCP helpers: input checks and result shapes', () => {
  const schema = { type: 'object', required: ['id'], properties: { id: { type: 'string' }, n: { type: 'integer' }, k: { type: 'string', enum: ['a', 'b'] } } };
  assert.deepEqual(inputProblems(schema, { id: 'x' }), []);
  assert.equal(inputProblems(schema, {}).length, 1);
  assert.equal(inputProblems(schema, { id: 'x', n: 1.5 }).length, 1);
  assert.equal(inputProblems(schema, { id: 'x', k: 'c' }).length, 1);
  assert.deepEqual(toResult('hi'), { content: [{ type: 'text', text: 'hi' }] });
  assert.deepEqual(toResult({ content: [{ type: 'text', text: 'x' }] }), { content: [{ type: 'text', text: 'x' }] });
});

test('studio tabs: every studio/tabs/*.js exports default { id, label, order, mount } with unique ids', async () => {
  const ids = new Set();
  for (const f of (await readdir(path.join(STUDIO, 'tabs'))).filter(f => f.endsWith('.js'))) {
    const d = (await import(pathToFileURL(path.join(STUDIO, 'tabs', f)).href)).default;
    assert.equal(typeof d?.id, 'string', `${f}: id`);
    assert.equal(typeof d.label, 'string', `${f}: label`);
    assert.equal(typeof d.mount, 'function', `${f}: mount`);
    assert.ok(Number.isFinite(d.order), `${f}: order`);
    assert.ok(!ids.has(d.id), `${f}: duplicate id ${d.id}`);
    ids.add(d.id);
  }
  for (const id of ['assets', 'verify', 'friends']) assert.ok(ids.has(id));
});
