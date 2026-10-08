// Find a Chrome to drive, on Windows, macOS and Linux: CHROME_PATH, then an installed Google Chrome or Microsoft Edge
// (both Chromium; Playwright drives either), then Playwright's own Chromium, downloaded once on demand with a clear
// message. verify, play and the gate read the result through CHROME_PATH (kits' qa/browser.mjs honours it).
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** Where browsers live by default, most preferred first. Pure: platform, env and home come in, paths go out. */
export function chromeCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const out = [];
  const add = (p, kind) => { if (p) out.push({ path: p, kind }); };
  if (platform === 'win32') {
    const w = path.win32;
    const roots = [env.PROGRAMFILES ?? 'C:\\Program Files', env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', env.LOCALAPPDATA ?? w.join(home, 'AppData', 'Local')];
    for (const r of roots) add(w.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'chrome');
    for (const r of roots) add(w.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'edge');
    for (const r of roots) add(w.join(r, 'Chromium', 'Application', 'chrome.exe'), 'chromium');
  } else if (platform === 'darwin') {
    for (const base of ['/Applications', path.posix.join(home, 'Applications')]) {
      add(`${base}/Google Chrome.app/Contents/MacOS/Google Chrome`, 'chrome');
      add(`${base}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, 'edge');
      add(`${base}/Chromium.app/Contents/MacOS/Chromium`, 'chromium');
    }
  } else {
    for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']) add(p, 'chrome');
    for (const p of ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge']) add(p, 'edge');
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) add(p, 'chromium');
  }
  return out;
}

/** Program names to look for on PATH when the usual places are empty. */
const PATH_NAMES = { win32: ['chrome', 'msedge'], darwin: [], linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'] };

/** A program on PATH, without a shell (PATHEXT on Windows). */
export function onPath(name, { platform = process.platform, env = process.env, exists = isFile } = {}) {
  const impl = platform === 'win32' ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const d of dirs) for (const e of exts) { const p = impl.join(d, name + e.toLowerCase()); if (exists(p)) return p; const q = impl.join(d, name + e); if (exists(q)) return q; }
  return null;
}

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

/** An installed Chrome or Edge, or null. → { path, kind, source } */
export function findChrome({ platform = process.platform, env = process.env, home = os.homedir(), exists = isFile } = {}) {
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return { path: env.CHROME_PATH, kind: 'chrome', source: 'CHROME_PATH' };
  for (const c of chromeCandidates({ platform, env, home })) if (exists(c.path)) return { ...c, source: 'installed' };
  for (const n of PATH_NAMES[platform] ?? PATH_NAMES.linux) { const p = onPath(n, { platform, env, exists }); if (p) return { path: p, kind: /edge/.test(n) ? 'edge' : 'chrome', source: 'PATH' }; }
  return null;
}

/** Playwright's own Chromium for the pinned playwright-core: { path, installed } */
export async function playwrightChromium() {
  const { chromium } = await import('playwright-core');
  let p = null;
  try { p = chromium.executablePath(); } catch {}
  return { path: p, installed: !!p && existsSync(p) };
}

/**
 * Make sure there is a browser for verify and play, and point CHROME_PATH at it. Never throws for a missing browser
 * when it can install one; returns { path, kind, source } or throws with what to do.
 */
export async function ensureBrowser({ log = console.error, install = true, env = process.env } = {}) {
  const found = findChrome({ env });
  if (found) { env.CHROME_PATH = found.path; return found; }
  const pw = await playwrightChromium();
  if (pw.installed) { env.CHROME_PATH = pw.path; return { path: pw.path, kind: 'chromium', source: 'playwright' }; }
  if (!install) throw new Error('No Chrome or Edge found, and Playwright\'s Chromium is not installed. Install Google Chrome, or run: npx playwright-core install chromium');
  log('gamesfun: no Chrome or Edge found (set CHROME_PATH to use another). Downloading Playwright\'s Chromium once (about 170 MB) into its cache…');
  const cli = createRequire(import.meta.url).resolve('playwright-core/cli.js');
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', windowsHide: true });
  const after = await playwrightChromium();
  if (r.status !== 0 || !after.installed) {
    throw new Error(`Could not install Playwright's Chromium (exit ${r.status}). Install Google Chrome, or run: npx playwright-core install chromium${process.platform === 'linux' ? ' (on Linux it may also need: npx playwright-core install-deps chromium)' : ''}`);
  }
  env.CHROME_PATH = after.path;
  log(`gamesfun: using Playwright's Chromium at ${after.path}`);
  return { path: after.path, kind: 'chromium', source: 'playwright (installed now)' };
}
