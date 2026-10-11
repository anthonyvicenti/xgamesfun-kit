// `gamesfun doctor`: is this machine ready to make a first game? Each item is { id, label, status: ok|warn|fail, detail,
// fix: { win32, darwin, linux } }. Only a "fail" blocks a first game (and makes the exit code non-zero); a "warn" is
// something worth knowing (an optional agent missing, software graphics). Every probe is injectable so the Windows and
// macOS wording is tested from any system.
import { access, constants, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { detectAll, loadAgents, mcpCommands, serverCommand } from './agents.mjs';
import { findChrome, playwrightChromium } from './chrome.mjs';
import { GAMES, KIT_ROOT, KITS_JSON, STATE } from './paths.mjs';
import { findProgram, run } from './proc.mjs';
import { PREFERRED_PORTS } from '../server/index.mjs';

export const REQUIRED_NODE = 24;
const same = s => ({ win32: s, darwin: s, linux: s });
const item = (id, label, status, detail, fix = null) => ({ id, label, status, detail, fix: typeof fix === 'string' ? same(fix) : fix });
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

export async function portFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', e => resolve(e.code === 'EADDRINUSE' ? false : null));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

async function writable(dir) {
  try {
    await mkdir(dir, { recursive: true });
    const f = path.join(dir, `.doctor-${process.pid}.tmp`);
    await writeFile(f, 'x');
    await rm(f, { force: true });
    return null;
  } catch (e) { return e.code ?? e.message; }
}

/**
 * options: { platform, env, nodeVersion, data, graphics (false skips the browser probe), probes: { detected, chrome, playwright, git, ports, writable, gpu, registered } }
 * → { ok, platform, items }
 */
export async function runDoctor(options = {}) {
  const { platform = process.platform, env = process.env, nodeVersion = process.version, graphics = true, probes = {} } = options;
  const data = options.data ?? loadAgents();
  const items = [];

  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  items.push(major >= REQUIRED_NODE
    ? item('node', 'Node', 'ok', `${nodeVersion} (24 or newer needed)`)
    : item('node', 'Node', 'fail', `${nodeVersion} is too old: the kit needs Node ${REQUIRED_NODE} or newer`, { win32: 'winget install OpenJS.NodeJS', darwin: 'brew install node@24', linux: 'nvm install 24   (no nvm? see https://github.com/nvm-sh/nvm)' }));

  const have = probes.deps ?? (name => existsSync(path.join(KIT_ROOT, 'node_modules', name, 'package.json')));
  const missing = ['@modelcontextprotocol/sdk', 'playwright-core'].filter(n => !have(n));
  items.push(missing.length ? item('packages', 'Packages', 'fail', `not installed: ${missing.join(', ')}`, 'npm ci') : item('packages', 'Packages', 'ok', 'installed (npm ci)'));

  const kitsOk = probes.kits ?? existsSync(KITS_JSON);
  items.push(kitsOk ? item('kits', 'Kits', 'ok', 'kits/ present') : item('kits', 'Kits', 'fail', 'kits/KITS.json is missing: this checkout is incomplete', 'git restore kits'));

  const git = probes.git !== undefined ? probes.git : findProgram(['git.exe', 'git'], { platform, env });
  items.push(git ? item('git', 'git', 'ok', git) : item('git', 'git', 'warn', 'not found: needed to fetch the kit and to update it', { win32: 'winget install Git.Git', darwin: 'xcode-select --install', linux: 'sudo apt install git   (or your distribution\'s package manager)' }));

  const chrome = probes.chrome !== undefined ? probes.chrome : findChrome({ platform, env });
  if (chrome) items.push(item('browser', 'Browser', 'ok', `${chrome.kind} at ${chrome.path} (${chrome.source})`));
  else {
    const pw = probes.playwright !== undefined ? probes.playwright : await playwrightChromium().catch(() => ({ installed: false }));
    items.push(pw.installed ? item('browser', 'Browser', 'ok', `Playwright's Chromium at ${pw.path}`)
      : item('browser', 'Browser', 'warn', 'no Chrome or Edge, and no Playwright Chromium yet (the first verify downloads about 170 MB)', { win32: 'winget install Google.Chrome', darwin: 'brew install --cask google-chrome', linux: 'npx playwright-core install chromium   (may also need: npx playwright-core install-deps chromium)' }));
  }

  if (graphics && (chrome || probes.gpu)) {
    const g = probes.gpu ? await probes.gpu() : await probeGraphics({ env });
    const fixGpu = { win32: 'update the graphics driver from your card maker (NVIDIA, AMD or Intel), then run doctor again', darwin: 'none needed on a Mac with Chrome; if this says software, quit other GPU-heavy apps and run doctor again', linux: 'install your card\'s driver (for example: sudo ubuntu-drivers install), or on a headless box set CHROME_ARGS="--use-gl=angle --use-angle=gl-egl"' };
    if (!g.ok) items.push(item('graphics', 'Graphics', 'warn', `could not ask the browser: ${g.error}`, 'node bin/gamesfun.mjs doctor --skip-graphics'));
    else if (!g.webgl) items.push(item('graphics', 'Graphics', 'warn', 'the browser has no WebGL: games will not draw', fixGpu));
    else if (SOFTWARE_RENDERER.test(g.renderer)) items.push(item('graphics', 'Graphics', 'warn', `software rendering (${g.renderer}): games run slowly, scenic games may not run`, fixGpu));
    else items.push(item('graphics', 'Graphics', 'ok', `hardware: ${g.renderer}${g.webgpu ? ' (WebGPU available)' : ''}`));
  }

  const ports = probes.ports ?? (await Promise.all(PREFERRED_PORTS.map(async p => [p, await portFree(p)])));
  const free = ports.filter(([, f]) => f === true).map(([p]) => p);
  items.push(free.length ? item('port', 'Ports', 'ok', `${free[0]} is free for the dev server (${free.length} of ${ports.length} free in ${PREFERRED_PORTS[0]}-${PREFERRED_PORTS.at(-1)})`)
    : item('port', 'Ports', 'warn', `none of ${PREFERRED_PORTS[0]}-${PREFERRED_PORTS.at(-1)} is free: dev will pick another, or pass --port`, { win32: 'netstat -ano | findstr :5180', darwin: 'lsof -i :5180', linux: 'ss -ltnp | grep 5180' }));

  const w = probes.writable ?? { games: await writable(GAMES), state: await writable(STATE) };
  const bad = Object.entries(w).filter(([, v]) => v);
  items.push(bad.length ? item('write', 'Write access', 'fail', `cannot write to ${bad.map(([k, v]) => `${k === 'games' ? 'games/' : '.gamesfun/'} (${v})`).join(', ')} in ${KIT_ROOT}`, { win32: 'move the kit to a folder you own: git clone <url> "%USERPROFILE%\\gamesfun-kit"', darwin: 'sudo chown -R "$USER" "' + KIT_ROOT + '"', linux: 'sudo chown -R "$USER" "' + KIT_ROOT + '"' })
    : item('write', 'Write access', 'ok', 'games/ and .gamesfun/ are writable'));

  const detected = probes.detected ?? await detectAll(data, { platform, env });
  const { command, args } = serverCommand(path.join(KIT_ROOT, 'mcp', 'server.mjs'));
  for (const d of detected) {
    const id = `agent-${d.id}`;
    if (!d.found) { items.push(item(id, d.name, d.optional ? 'warn' : 'fail', `not found${d.optional ? ' (optional: the kit also works from any agent that reads AGENTS.md)' : ''}`, d.row.install)); continue; }
    if (!d.version) { items.push(item(id, d.name, 'warn', `found at ${d.path} but \`${d.row.versionArgs?.join(' ') ?? '--version'}\` failed (${d.versionError})`, d.row.install)); continue; }
    let reg;
    if (probes.registered) reg = await probes.registered(d);
    else {
      const cmds = mcpCommands(d.row, { name: data.server.name, command, args });
      const r = await run(d.path, cmds.get, { cwd: os.tmpdir(), env, timeoutMs: 30000, platform });
      reg = r.code === 0 && r.stdout.includes(data.server.name);
    }
    items.push(reg ? item(id, d.name, 'ok', `${d.version} at ${d.path}; "${data.server.name}" is registered`)
      : item(id, d.name, 'warn', `${d.version} at ${d.path}; our tools are not added yet`, 'node bin/gamesfun.mjs connect'));
  }
  if (!detected.some(d => d.found)) items.push(item('agent', 'Agent', 'warn', 'no Claude Code or Codex found: you are probably running this from one, or from another agent that reads AGENTS.md', null));

  return { ok: !items.some(i => i.status === 'fail'), platform, items };
}

/** Ask the browser which renderer it got, in a child process with a time limit. → { ok, webgl, renderer, webgpu } or { ok: false, error } */
export async function probeGraphics({ env = process.env, timeoutMs = 60000 } = {}) {
  const r = await run(process.execPath, [path.join(KIT_ROOT, 'lib', 'gpu-probe.mjs')], { cwd: KIT_ROOT, env, timeoutMs });
  if (r.timedOut) return { ok: false, error: `the browser did not answer within ${timeoutMs / 1000} s` };
  try { return JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { return { ok: false, error: (r.stderr || r.error || 'no answer').trim().split('\n')[0] }; }
}

/** Plain-text lines for a person. `system` picks whose fix to print ('all' prints every system's). */
export function formatDoctor(result, { system = process.platform, all = false } = {}) {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const lines = [];
  for (const i of result.items) {
    lines.push(`${mark[i.status]} ${i.label.padEnd(13)} ${i.detail}`);
    if (i.fix && i.status !== 'ok') {
      if (all) for (const s of ['win32', 'darwin', 'linux']) lines.push(`       fix (${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[s]}): ${i.fix[s]}`);
      else lines.push(`       fix: ${i.fix[system] ?? i.fix.linux}`);
    }
  }
  lines.push('', result.ok ? 'Ready: nothing blocks a first game.' : 'Not ready: fix the FAIL lines above, then run doctor again.');
  return lines.join('\n');
}
