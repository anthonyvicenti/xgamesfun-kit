#!/usr/bin/env node
// The gamesfun MCP server (stdio): the CLI's operations as tools for any agent that speaks MCP (Claude Code, Codex,
// Cursor, opencode, Cline). Tools come from mcp/tools/<area>.mjs, each exporting `tools`, an array of
//   { name, description, inputSchema /* JSON Schema */, handler(input, ctx) → result }
// (docs/ARCHITECTURE.md, "MCP tools"). A result may be a string, any JSON value, or an MCP result ({ content: [...] }).
// ctx: { kitRoot, log(...), progress(message), runCli(args, { onLine }) → { code, stdout, stderr } }.
// A tool that spends money, signs or changes chain state returns a step for the human; it never signs.
//
// stdout is the protocol: everything else (logs, tool output) goes to stderr.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from '../lib/main.mjs';
import { BIN, KIT_ROOT } from '../lib/paths.mjs';

export const TOOLS_DIR = path.join(KIT_ROOT, 'mcp', 'tools');
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Run the gamesfun CLI as a child (keeps long browser runs and their output out of this process). */
export function runCli(args, { onLine = null, cwd = KIT_ROOT, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const split = (stream) => { let buf = ''; return d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i).replace(/\r$/, ''), stream); buf = buf.slice(i + 1); } }; };
    const o = split('stdout'), e = split('stderr');
    c.stdout.on('data', d => { stdout += d; o(String(d)); });
    c.stderr.on('data', d => { stderr += d; e(String(d)); });
    c.on('error', reject);
    c.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Every tool from mcp/tools/*.mjs. → { tools: Map(name → tool), problems: [] } */
export async function loadTools(dir = TOOLS_DIR, log = () => {}) {
  const tools = new Map(), problems = [];
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.mjs')).sort(); } catch {}
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      if (!Array.isArray(mod.tools)) throw new Error('must export `tools`, an array');
      for (const t of mod.tools) {
        if (!t || !NAME.test(t.name ?? '') || typeof t.handler !== 'function' || typeof t.description !== 'string') { problems.push(`${f}: a tool needs name (${NAME}), description and handler`); continue; }
        if (tools.has(t.name)) { problems.push(`${f}: tool ${t.name} is already defined by ${tools.get(t.name).file}`); continue; }
        tools.set(t.name, { ...t, inputSchema: t.inputSchema ?? { type: 'object', properties: {} }, file: f });
      }
    } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  for (const p of problems) log(`mcp: ${p}`);
  return { tools, problems };
}

/** Required fields and simple types, before a handler runs (the client usually checked already). */
export function inputProblems(schema, input) {
  const out = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['arguments must be an object'];
  for (const k of schema?.required ?? []) if (input[k] === undefined) out.push(`${k} is required`);
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    const v = input[k];
    if (v === undefined || !p?.type) continue;
    const types = [].concat(p.type);
    const ok = types.some(t => (t === 'integer' ? Number.isInteger(v) : t === 'array' ? Array.isArray(v) : t === 'null' ? v === null : t === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : typeof v === t));
    if (!ok) out.push(`${k} must be ${types.join(' or ')}`);
    if (p.enum && !p.enum.includes(v)) out.push(`${k} must be one of ${p.enum.join(', ')}`);
  }
  return out;
}

export function toResult(value) {
  if (value && typeof value === 'object' && Array.isArray(value.content)) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
  return { content: [{ type: 'text', text }] };
}

export async function createServer({ toolsDir = TOOLS_DIR, log = (...a) => console.error(...a) } = {}) {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(path.join(KIT_ROOT, 'package.json'), 'utf8'));
  const { tools } = await loadTools(toolsDir, log);
  const server = new Server({ name: 'gamesfun', version: pkg.version }, {
    capabilities: { tools: {} },
    instructions: 'gamesfun builds multiplayer three.js browser games on games.fun\'s gf-three kit. Read AGENTS.md in the kit root first. Typical order: gamesfun_catalog → write and lock a spec → gamesfun_create → edit the game\'s rules.js and config → gamesfun_verify (quick) until it passes → gamesfun_dev_start to play it with two tabs.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const t = tools.get(req.params.name);
    if (!t) return { isError: true, content: [{ type: 'text', text: `no tool ${req.params.name}` }] };
    const input = req.params.arguments ?? {};
    const bad = inputProblems(t.inputSchema, input);
    if (bad.length) return { isError: true, content: [{ type: 'text', text: bad.join('; ') }] };
    const token = req.params._meta?.progressToken;
    let n = 0;
    const ctx = {
      kitRoot: KIT_ROOT,
      log,
      progress: message => { if (token === undefined) return; extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: String(message).slice(0, 300) } }).catch(() => {}); },
      runCli,
      signal: extra.signal,
    };
    try { return toResult(await t.handler(input, ctx)); }
    catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
  return { server, tools };
}

if (isMain(import.meta)) {
  // stdout belongs to the protocol: anything a library prints goes to stderr instead
  console.log = (...a) => console.error(...a);
  console.info = (...a) => console.error(...a);
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { server, tools } = await createServer();
  await server.connect(new StdioServerTransport());
  console.error(`gamesfun MCP server: ${tools.size} tools (${[...tools.keys()].join(', ')})`);
}
