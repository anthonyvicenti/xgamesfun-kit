// The one-line entry: the agent registry, connect, doctor, update and the process helpers. Windows and macOS cases are
// checked with a fake platform and path.win32, as in paths.test.mjs; real agents are never started (a recording runner
// stands in), and the real Claude Code and Codex runs are documented in docs/DEVELOPING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { agentProblems, detectAgent, expand, loadAgents, mcpCommands } from '../lib/agents.mjs';
import { connect, SERVER_FILE } from '../lib/connect.mjs';
import { formatDoctor, runDoctor, SOFTWARE_RENDERER } from '../lib/doctor.mjs';
import { listServerTools } from '../lib/mcp-check.mjs';
import { agentCommand, findProgram, stopCommand } from '../lib/proc.mjs';
import { checkAllowed, DAY_MS, kitState, noticeText, startUpdateCheck, updateKit } from '../lib/update.mjs';
import { tempDir } from './helpers.mjs';

const data = loadAgents();
const claude = data.agents.find(a => a.id === 'claude'), codex = data.agents.find(a => a.id === 'codex');

test('agents.json is valid and has Claude Code and Codex', () => {
  assert.deepEqual(agentProblems(data), []);
  assert.deepEqual(data.agents.map(a => a.id).sort(), ['claude', 'codex']);
});

test('a broken row is named, not swallowed', () => {
  const bad = structuredClone(data);
  bad.agents[0].mcp.add = ['mcp', 'add', '{name}'];
  bad.agents[1].binaries.win32 = [];
  bad.agents.push({ ...structuredClone(bad.agents[0]), id: 'claude' });
  const p = agentProblems(bad).join('\n');
  assert.match(p, /mcp\.add needs/);
  assert.match(p, /binaries\.win32/);
  assert.match(p, /duplicate id/);
});

test('a new agent is a row: nothing else changes', () => {
  const more = structuredClone(data);
  more.agents.push({ ...structuredClone(codex), id: 'other', name: 'Other' });
  assert.deepEqual(agentProblems(more), []);
});

test('expand fills names and spreads {...args}', () => {
  assert.deepEqual(expand(['a', '{name}', '--', '{command}', '{...args}'], { name: 'x', command: '/n', args: ['1', '2 3'] }), ['a', 'x', '--', '/n', '1', '2 3']);
  assert.throws(() => expand(['{scope}'], {}), /no value for \{scope\}/);
});

test('the agents\' own commands, with an absolute Node and a path holding spaces', () => {
  const v = { name: 'gamesfun', command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\Ada Lovelace\\gamesfun-kit\\mcp\\server.mjs'] };
  const c = mcpCommands(claude, { ...v, scope: 'project' });
  assert.deepEqual(c.add, ['mcp', 'add', '--transport', 'stdio', '--scope', 'project', 'gamesfun', '--', v.command, v.args[0]]);
  assert.deepEqual(c.remove, ['mcp', 'remove', '--scope', 'project', 'gamesfun']);
  assert.equal(mcpCommands(claude, v).add[5], 'user');
  const x = mcpCommands(codex, v);
  assert.deepEqual(x.add, ['mcp', 'add', 'gamesfun', '--', v.command, v.args[0]]);
  assert.deepEqual(x.list, ['mcp', 'list', '--json']);
  assert.throws(() => mcpCommands(codex, { ...v, scope: 'project' }), /no "project" scope/);
});

test('finding an agent on Windows: PATHEXT, a .cmd shim, no shell', async () => {
  const have = new Set(['C:\\npm\\codex.cmd', 'C:\\bin\\claude.exe']);
  const env = { PATH: 'C:\\nothing;C:\\npm;C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const exists = p => have.has(p);
  assert.equal(findProgram(codex.binaries.win32, { platform: 'win32', env, exists }), 'C:\\npm\\codex.cmd');
  assert.equal(findProgram(claude.binaries.win32, { platform: 'win32', env, exists }), 'C:\\bin\\claude.exe');
  assert.equal(findProgram(['nope'], { platform: 'win32', env, exists }), null);
  const calls = [];
  const d = await detectAgent(codex, { platform: 'win32', env, exists, runner: async (f, a) => { calls.push([f, a]); return { code: 0, stdout: 'codex-cli 9.9\n', stderr: '' }; } });
  assert.equal(d.found, true);
  assert.equal(d.version, 'codex-cli 9.9');
  assert.deepEqual(calls, [['C:\\npm\\codex.cmd', ['--version']]]);
  const none = await detectAgent(claude, { platform: 'linux', env: { PATH: '' }, exists: () => false });
  assert.equal(none.found, false);
});

test('a Windows batch shim goes through cmd.exe once; syntax characters are refused', () => {
  const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  const c = agentCommand('C:\\npm\\codex.cmd', ['mcp', 'add', 'gamesfun', '--', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Ada Lovelace\\kit\\mcp\\server.mjs'], { platform: 'win32', env });
  assert.equal(c.cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(c.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(c.args[3], '"C:\\npm\\codex.cmd mcp add gamesfun -- "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ada Lovelace\\kit\\mcp\\server.mjs""');
  assert.equal(c.windowsVerbatimArguments, true);
  for (const bad of ['a&b', '50%', 'x"y', 'a|b', 'a^b', '<x', 'a\nb']) assert.throws(() => agentCommand('C:\\npm\\codex.cmd', [bad], { platform: 'win32', env }), /refusing/);
  assert.deepEqual(agentCommand('C:\\bin\\claude.exe', ['a&b'], { platform: 'win32', env }), { cmd: 'C:\\bin\\claude.exe', args: ['a&b'] });
  assert.deepEqual(agentCommand('/usr/bin/codex.cmd', ['x'], { platform: 'linux' }), { cmd: '/usr/bin/codex.cmd', args: ['x'] });
});

test('stopping a tree: taskkill on Windows, the process group elsewhere, never pid 0', () => {
  assert.deepEqual(stopCommand(4242, { platform: 'win32' }), { cmd: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
  assert.deepEqual(stopCommand(4242, { platform: 'linux' }), { group: true, pid: 4242 });
  assert.deepEqual(stopCommand(4242, { platform: 'darwin' }), { group: true, pid: 4242 });
  for (const bad of [0, -1, NaN, '12', null]) assert.equal(stopCommand(bad, { platform: 'win32' }), null);
});

// A recording stand-in for an agent's program: it keeps a set of registered names and answers get/add/remove.
function fakeAgents({ registered = {}, addFails = false } = {}) {
  const calls = [], state = { ...registered };
  const runner = async (file, argv) => {
    calls.push([path.basename(file), ...argv].join(' '));
    const id = path.basename(file);
    const verb = argv[1];
    const nm = argv[0] === 'mcp' && verb === 'add' ? argv[argv.indexOf('--') > 0 ? argv.indexOf('--') - 1 : 2] : argv.at(-1);
    if (verb === 'get') return state[id] ? { code: 0, stdout: `gamesfun:\n  Status: ok\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'No MCP server found' };
    if (verb === 'add') { if (addFails) return { code: 1, stdout: '', stderr: 'boom' }; state[id] = nm; return { code: 0, stdout: 'added', stderr: '' }; }
    if (verb === 'remove') { delete state[id]; return { code: 0, stdout: 'removed', stderr: '' }; }
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  const detected = data.agents.map(row => ({ id: row.id, name: row.name, optional: true, found: true, path: `/bin/${row.id}`, version: '1', row }));
  return { calls, state, runner, detected };
}
const okServer = async () => ({ ok: true, tools: ['gamesfun_catalog'] });

test('connect registers with each found agent through its own command, then checks it', async () => {
  const f = fakeAgents();
  const r = await connect({ runner: f.runner, detected: f.detected, listTools: okServer, data });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map(x => x.status), ['registered', 'registered']);
  assert.equal(f.calls.filter(c => c.startsWith('claude mcp add --transport stdio --scope user gamesfun -- ')).length, 1);
  assert.equal(f.calls.filter(c => c.startsWith('codex mcp add gamesfun -- ')).length, 1);
  assert.ok(f.calls.every(c => /^(claude|codex) mcp (get|add)/.test(c)), 'only the agents\' own commands');
  assert.ok(r.results[0].steps.at(-1).command.includes('mcp get'));
});

test('connect leaves an existing registration alone unless --replace, and --remove takes it out', async () => {
  const f = fakeAgents({ registered: { claude: 'gamesfun' } });
  let r = await connect({ agent: 'claude', runner: f.runner, detected: f.detected, listTools: okServer, data });
  assert.equal(r.results[0].status, 'already registered');
  assert.ok(!f.calls.some(c => c.includes(' add ')));
  r = await connect({ agent: 'claude', replace: true, runner: f.runner, detected: f.detected, listTools: okServer, data });
  assert.equal(r.results[0].status, 'registered');
  assert.ok(f.calls.some(c => c.startsWith('claude mcp remove --scope user gamesfun')));
  r = await connect({ agent: 'claude', remove: true, runner: f.runner, detected: f.detected, data });
  assert.equal(r.results[0].status, 'removed');
  assert.equal(f.state.claude, undefined);
});

test('connect registers nothing when our server does not start', async () => {
  const f = fakeAgents();
  const r = await connect({ runner: f.runner, detected: f.detected, listTools: async () => ({ ok: false, error: 'Cannot find package', stderr: 'x' }), data });
  assert.equal(r.ok, false);
  assert.match(r.error, /did not start.*Nothing was registered/s);
  assert.deepEqual(f.calls, []);
});

test('connect reports a refused add, a missing agent, an unknown scope, and a dry run changes nothing', async () => {
  const f = fakeAgents({ addFails: true });
  let r = await connect({ agent: 'codex', runner: f.runner, detected: f.detected, listTools: okServer, data });
  assert.equal(r.ok, false);
  assert.match(r.results[0].note, /refused: boom/);
  r = await connect({ agent: 'codex', scope: 'project', runner: f.runner, detected: f.detected, listTools: okServer, data });
  assert.match(r.results[0].note, /no "project" scope/);
  await assert.rejects(() => connect({ agent: 'zed', detected: f.detected, listTools: okServer, data }), /no agent "zed"/);
  const missing = f.detected.map(d => ({ ...d, found: false }));
  r = await connect({ runner: f.runner, detected: missing, listTools: okServer, data });
  assert.equal(r.ok, false);
  assert.match(r.error, /no coding agent found/);
  const g = fakeAgents();
  r = await connect({ runner: g.runner, detected: g.detected, data, dryRun: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map(x => x.status), ['would register', 'would register']);
  assert.ok(!g.calls.some(c => / (add|remove) /.test(c)));
});

test('our MCP server starts and lists its tools (asked of the server itself)', async () => {
  const r = await listServerTools({ command: process.execPath, args: [SERVER_FILE] });
  assert.equal(r.ok, true, r.error);
  for (const t of ['gamesfun_catalog', 'gamesfun_create', 'gamesfun_verify', 'gamesfun_dev_start']) assert.ok(r.tools.includes(t), t);
  const bad = await listServerTools({ command: process.execPath, args: [path.join(path.dirname(SERVER_FILE), 'no-such.mjs')], timeoutMs: 5000 });
  assert.equal(bad.ok, false);
});

const probes = (over = {}) => ({
  deps: () => true, kits: true, git: '/usr/bin/git', chrome: { path: '/usr/bin/google-chrome', kind: 'chrome', source: 'installed' },
  gpu: async () => ({ ok: true, webgl: true, renderer: 'ANGLE (NVIDIA GeForce RTX 5090)', webgpu: true }),
  ports: [[5180, true], [5181, true]], writable: { games: null, state: null },
  detected: data.agents.map(row => ({ id: row.id, name: row.name, optional: true, found: false, path: null, row })),
  registered: async () => true, ...over,
});
const by = (r, id) => r.items.find(i => i.id === id);

test('doctor: a ready machine exits ok even with no agent; each fix is per system', async () => {
  const r = await runDoctor({ probes: probes(), data });
  assert.equal(r.ok, true);
  assert.equal(by(r, 'agent-claude').status, 'warn');
  assert.equal(by(r, 'graphics').status, 'ok');
  assert.match(formatDoctor(r), /Ready/);
});

test('doctor: only what blocks a first game fails (old Node, no packages, no write access)', async () => {
  const r = await runDoctor({ nodeVersion: 'v22.11.0', probes: probes({ deps: n => n !== 'playwright-core', writable: { games: 'EACCES', state: null } }), data });
  assert.equal(r.ok, false);
  assert.deepEqual(r.items.filter(i => i.status === 'fail').map(i => i.id), ['node', 'packages', 'write']);
  assert.match(by(r, 'node').fix.win32, /winget/);
  assert.match(by(r, 'node').fix.darwin, /brew/);
  assert.match(by(r, 'node').fix.linux, /nvm/);
  assert.equal(by(r, 'packages').fix.linux, 'npm ci');
  const text = formatDoctor(r, { system: 'win32' });
  assert.match(text, /FAIL Node/);
  assert.match(text, /fix: winget install OpenJS\.NodeJS/);
  assert.match(formatDoctor(r, { all: true }), /fix \(macOS\): brew install node@24/);
});

test('doctor: software graphics, no browser, busy ports and an unregistered agent are warnings', async () => {
  assert.ok(SOFTWARE_RENDERER.test('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'));
  assert.ok(SOFTWARE_RENDERER.test('llvmpipe (LLVM 15)'));
  assert.ok(!SOFTWARE_RENDERER.test('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)'));
  const r = await runDoctor({ platform: 'win32', probes: probes({
    gpu: undefined, ports: [[5180, false], [5181, false]], chrome: null, playwright: { installed: false },
    detected: data.agents.map(row => ({ id: row.id, name: row.name, optional: true, found: true, path: 'C:\\x.exe', version: '1.0', row })), registered: async () => false,
  }), data });
  assert.equal(r.ok, true);
  assert.equal(by(r, 'graphics'), undefined, 'no browser, so no graphics probe');
  assert.equal(by(r, 'browser').status, 'warn');
  assert.match(by(r, 'browser').fix.win32, /winget install Google\.Chrome/);
  assert.equal(by(r, 'port').status, 'warn');
  assert.equal(by(r, 'agent-codex').status, 'warn');
  assert.match(by(r, 'agent-codex').fix.win32, /connect/);
  const g = await runDoctor({ probes: probes({ gpu: async () => ({ ok: true, webgl: true, renderer: 'llvmpipe (LLVM 15)' }) }), data });
  assert.equal(by(g, 'graphics').status, 'warn');
  assert.match(by(g, 'graphics').detail, /software/);
});

test('doctor: an installed but silent agent is a warning with its install command', async () => {
  const r = await runDoctor({ probes: probes({ detected: [{ id: 'codex', name: 'Codex', optional: true, found: true, path: '/x/codex', version: null, versionError: 'exit 1', row: codex }, { id: 'claude', name: 'Claude Code', optional: true, found: false, row: claude }] }), data });
  assert.equal(by(r, 'agent-codex').status, 'warn');
  assert.equal(by(r, 'agent-codex').fix.linux, 'npm install -g @openai/codex');
  assert.equal(r.ok, true);
});

test('update check switches: off by variable, in CI, in tests; daily; a clock set back', () => {
  const now = 1_000_000_000_000;
  assert.equal(checkAllowed({ env: {}, cache: null, now }), true);
  assert.equal(checkAllowed({ env: {}, cache: { checkedAt: now - 1000 }, now }), false);
  assert.equal(checkAllowed({ env: {}, cache: { checkedAt: now - DAY_MS }, now }), true);
  assert.equal(checkAllowed({ env: {}, cache: { checkedAt: now + 5000 }, now }), true);
  assert.equal(checkAllowed({ env: { GAMESFUN_NO_UPDATE_CHECK: '1' }, cache: null, now }), false);
  assert.equal(checkAllowed({ env: { GAMESFUN_NO_UPDATE_CHECK: '0' }, cache: null, now }), true);
  assert.equal(checkAllowed({ env: { CI: 'true' }, cache: null, now }), false);
  assert.equal(checkAllowed({ env: { NODE_TEST_CONTEXT: 'child-v8' }, cache: null, now }), false);
  assert.equal(noticeText(null), null);
  assert.equal(noticeText({ behind: 0 }), null);
  assert.match(noticeText({ behind: 3, upstream: 'origin/main' }), /3 new commits on origin\/main.*update.*GAMESFUN_NO_UPDATE_CHECK=1/);
});

test('the update check starts in the background and never waits', async () => {
  const spawned = [];
  const fake = (...a) => { spawned.push(a); return { on() {}, unref() {} }; };
  const tmp = await tempDir();
  const cacheFile = path.join(tmp.dir, 'update-check.json');
  const t0 = Date.now();
  await startUpdateCheck({ env: {}, spawnFn: fake, cacheFile });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0][1].slice(1), ['update', '--refresh-cache']);
  assert.equal(spawned[0][2].detached, true);
  assert.equal(spawned[0][2].stdio, 'ignore');
  await startUpdateCheck({ env: { GAMESFUN_NO_UPDATE_CHECK: '1' }, spawnFn: fake, cacheFile });
  assert.equal(spawned.length, 1);
  await writeFile(cacheFile, JSON.stringify({ checkedAt: Date.now(), behind: 2, upstream: 'origin/main' }));
  assert.match(await startUpdateCheck({ env: {}, spawnFn: fake, cacheFile }), /2 new commits/);
  assert.equal(spawned.length, 1, 'a fresh cache starts nothing');
  assert.equal(await startUpdateCheck({ env: { GAMESFUN_NO_UPDATE_CHECK: '1' }, spawnFn: fake, cacheFile }), null);
  await tmp.cleanup();
});

// Real git, no network: a bare "remote", two clones.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
async function twoClones() {
  const t = await tempDir('gamesfun-update-');
  const remote = path.join(t.dir, 'remote.git'), a = path.join(t.dir, 'a'), b = path.join(t.dir, 'b');
  git(t.dir, 'init', '--bare', '-b', 'main', remote);
  git(t.dir, 'clone', '-q', remote, a);
  await writeFile(path.join(a, 'package.json'), '{"name":"x","version":"1.0.0","lockfileVersion":3}\n');
  await writeFile(path.join(a, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.0.0' } } }));
  await writeFile(path.join(a, 'one.txt'), '1\n');
  git(a, 'add', '.'); git(a, 'commit', '-qm', 'one'); git(a, 'push', '-q', '-u', 'origin', 'main');
  git(t.dir, 'clone', '-q', remote, b);
  return { ...t, a, b };
}

test('update: up to date, then a fast-forward, with npm ci only when the lockfile changed', async () => {
  const c = await twoClones();
  try {
    await mkdir(path.join(c.b, 'node_modules'), { recursive: true });
    let r = await updateKit({ cwd: c.b, install: false });
    assert.equal(r.status, 'up-to-date');
    await writeFile(path.join(c.a, 'two.txt'), '2\n'); git(c.a, 'add', '.'); git(c.a, 'commit', '-qm', 'two'); git(c.a, 'push', '-q');
    assert.equal((await kitState({ cwd: c.b })).behind, 1);
    r = await updateKit({ cwd: c.b, dryRun: true });
    assert.equal(r.status, 'would-update');
    assert.equal(await readFile(path.join(c.b, 'one.txt'), 'utf8'), '1\n');
    r = await updateKit({ cwd: c.b });
    assert.equal(r.status, 'updated');
    assert.equal(r.commits, 1);
    assert.equal(r.installed, false, 'the lockfile did not change');
  } finally { await c.cleanup(); }
});

test('update: refuses a diverged or a dirty checkout and changes nothing', async () => {
  const c = await twoClones();
  try {
    await writeFile(path.join(c.a, 'two.txt'), '2\n'); git(c.a, 'add', '.'); git(c.a, 'commit', '-qm', 'two'); git(c.a, 'push', '-q');
    await writeFile(path.join(c.b, 'one.txt'), 'mine\n');
    let r = await updateKit({ cwd: c.b, install: false });
    assert.equal(r.status, 'dirty');
    git(c.b, 'commit', '-aqm', 'mine');
    r = await updateKit({ cwd: c.b, install: false });
    assert.equal(r.status, 'diverged');
    assert.equal(await readFile(path.join(c.b, 'one.txt'), 'utf8'), 'mine\n');
    const none = await tempDir();
    r = await updateKit({ cwd: none.dir, install: false });
    assert.equal(r.status, 'cannot-check');
    await none.cleanup();
  } finally { await c.cleanup(); }
});

test('update: a changed lockfile runs npm ci', async () => {
  const c = await twoClones();
  try {
    await mkdir(path.join(c.b, 'node_modules'), { recursive: true });
    await writeFile(path.join(c.a, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.0.1', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', version: '1.0.1' } } }));
    await writeFile(path.join(c.a, 'package.json'), '{"name":"x","version":"1.0.1","lockfileVersion":3}\n');
    git(c.a, 'commit', '-aqm', 'lock'); git(c.a, 'push', '-q');
    const r = await updateKit({ cwd: c.b });
    assert.equal(r.status, 'updated');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.installed, true);
  } finally { await c.cleanup(); }
});

test('the one line is the same in README.md and docs/ONE-LINE.md, and every command in it exists', async () => {
  const fence = text => text.match(/```text\n([^\n]+)\n```/)?.[1];
  const readme = fence(await readFile(new URL('../README.md', import.meta.url), 'utf8'));
  const doc = fence(await readFile(new URL('../docs/ONE-LINE.md', import.meta.url), 'utf8'));
  assert.ok(readme && readme === doc, 'one line, identical in both files');
  for (const must of ['git clone https://', 'npm ci', 'bin/gamesfun.mjs doctor', 'bin/gamesfun.mjs connect', 'create games/first --from soak-squad', 'bin/gamesfun.mjs dev games/first', 'docs/ONE-LINE.md', 'Never ask me for a password, token or key']) assert.ok(doc.includes(must), must);
  assert.ok(!/claude\.ai|anthropic|logo/i.test(doc), 'no vendor name or logo in the line itself beyond what the README says in plain text');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(new URL('../commands/', import.meta.url));
  for (const c of ['doctor', 'connect', 'update', 'create', 'dev']) assert.ok(files.includes(`${c}.mjs`), c);
  const guide = await readFile(new URL('../docs/ONE-LINE.md', import.meta.url), 'utf8');
  for (const step of ['### 1. Clone', '### 2. `npm ci`', '### 3.', '### 4.', '### 5.']) assert.ok(guide.includes(step), step);
  assert.ok((guide.match(/^If it fails/gm) ?? []).length >= 4, 'each step says what to do when it fails');
});
