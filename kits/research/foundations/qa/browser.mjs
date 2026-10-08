// Portable Chrome launcher for trial qa.mjs scripts (Linux, macOS, Windows).
// Older trials hard-code a Windows Chrome path; new trials should use this instead:
//   import { launchChrome } from '../../qa/browser.mjs';
//   const browser = await launchChrome();            // headless by default
//   const browser = await launchChrome({ gpu: 'webgl' });    // WebGL on the real GPU (ANGLE on OpenGL; never Vulkan here, see below)
//   const browser = await launchChrome({ gpu: 'webgpu' });   // a WebGPU game (assets.json runtime.gpu), see below
// Playwright is resolved from research/pipeline/node_modules (`cd research/pipeline && npm ci`); pass `chromium` (a
// Playwright BrowserType) to use another copy (the Studio worker's container has its own in /opt/deps).
// Override the binary with CHROME_PATH; set HEADED=1 to watch; CHROME_ARGS adds launch flags.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

export function chromePath() {
  return candidates.find(path => existsSync(path)); // undefined → Playwright's bundled chromium
}

// WebGPU (manifest v1.3 `runtime.gpu: "webgpu"`, creator-studio/docs/asset-manifest.md). Measured 2026-10-01 on the
// RTX 5090 host (driver 595.84, Linux, Playwright 1.63) by clearing a WebGPU canvas to red and reading the screenshot:
//   Chrome 148, any headless flags                   no adapter, or (--enable-unsafe-webgpu) only the CPU fallback
//                                                    adapter that tidewater hangs on; with --use-angle=vulkan
//                                                    --enable-features=Vulkan it gets the NVIDIA adapter, but
//                                                    headless Chrome composites in software and the canvas comes out
//                                                    empty (transparent in screenshots, zeros on readback)
//   chrome-headless-shell 151 / 1243 + WEBGPU_ARGS   NVIDIA "blackwell" adapter on the first try, canvas red in the
//                                                    screenshot (host, and the worker image with the GPU passed in)
//   headed Chrome 148 + --enable-features=Vulkan     works too (tidewater's pilot), but opens a window
// Both flags are needed (either alone: no adapter). --disable-vulkan-surface: with no X display (the worker's
// container) the shell finds no adapter without it. Playwright's own --enable-features=CDPScreenshotNewSurface is
// repeated because Chrome keeps only the last --enable-features. No display or Xvfb is needed.
export const WEBGPU_ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan,CDPScreenshotNewSurface', '--disable-vulkan-surface'];
// WebGL on the real GPU (launchChrome({gpu: 'webgl'}), or these flags in CHROME_ARGS): ANGLE on OpenGL, which is what
// desktop Chrome on Linux uses by default. Do NOT add --use-angle=vulkan for WebGL. Measured 2026-10-02 on the RTX 5090
// host (driver 595.84, Chrome 148, headless and headless shell alike): with it, Chrome's GPU process segfaults
// (exit_code=139) while linking some three.js programs. The page logs "THREE.WebGLProgram: Shader Error 0 -
// VALIDATE_STATUS false" with an empty info log, then CONTEXT_LOST_WEBGL, and after repeated crashes "Web page caused
// context loss and was blocked". The scene renders white or black (starfall, leonida-stories; 0 errors on OpenGL or
// SwiftShader). Many Chromes sharing the GPU at once made it worse. Repro: research/private-explore/findings/GPU-WHITE-BLACK.md.
export const WEBGL_GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist'];
/** Console text that means Chrome's GPU process or driver failed WebGL, not the game (see WEBGL_GPU_ARGS). */
export const GPU_TROUBLE = /CONTEXT_LOST_WEBGL|context loss and was blocked|Could not create a WebGL context|Shader Error \d+ - VALIDATE_STATUS false[\s\S]*Program Info Log:\s*$/;
let warnedVulkan = false;
const WEBGPU_HEADED_ARGS = ['--enable-features=Vulkan,CDPScreenshotNewSurface'];   // + --use-angle=vulkan breaks WebGL headed here
export class NoWebGPUError extends Error { constructor(message) { super(message); this.name = 'NoWebGPUError'; } }
/** The GPU a game's assets.json asks for: 'webgpu' (runtime.gpu) or null (any renderer, SwiftShader is fine). */
export const manifestGpu = m => (m?.runtime?.gpu === 'webgpu' ? 'webgpu' : null);

/** Playwright's chrome-headless-shell: CHROME_HEADLESS_SHELL, else the newest in the Playwright browser cache
 *  (`npx playwright install chromium-headless-shell`; /ms-playwright in the worker image), else undefined. */
export function headlessShellPath() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
    : process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright') : join(homedir(), '.cache/ms-playwright'));
  let dirs = [];
  try { dirs = readdirSync(root).filter(d => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]); } catch { return undefined; }
  const bins = ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell', 'chrome-headless-shell-win64/chrome-headless-shell.exe'];
  for (const d of dirs) for (const b of bins) if (existsSync(join(root, d, b))) return join(root, d, b);
  return undefined;
}

/**
 * Asks a fresh page of `browser` for a WebGPU adapter: {ok, vendor, architecture, description, fallback, tries, ms}.
 * ok is false, with `why`, when there is none or only a CPU fallback adapter. Right after launch the first
 * requestAdapter() can come back null while the GPU process starts (headless Chrome: "A valid external Instance
 * reference no longer exists"; the next call 250 ms later succeeds), so null is retried until `timeoutMs`.
 */
export async function webgpuAdapter(browser, { timeoutMs = Number(process.env.GF_WEBGPU_PROBE_MS ?? 3000) } = {}) {
  const t0 = Date.now(), page = await browser.newPage();
  try {
    // navigator.gpu exists only in a secure context; a routed loopback URL is one, with no server or HTTPS upgrade.
    await page.route('http://127.0.0.1/__gf-webgpu-probe', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WebGPU probe</title>' }));
    await page.goto('http://127.0.0.1/__gf-webgpu-probe');
    const r = await page.evaluate(async ms => {
      if (!navigator.gpu) return { ok: false, tries: 0, why: 'navigator.gpu is missing (WebGPU is off in this browser)' };
      let a = null, tries = 0;
      for (const t0 = performance.now(); !a && (tries === 0 || performance.now() - t0 < ms);) { tries++; a = await navigator.gpu.requestAdapter(); if (!a) await new Promise(ok => setTimeout(ok, 250)); }
      if (!a) return { ok: false, tries, why: 'requestAdapter() returned no adapter' };
      const i = a.info ?? {}, fallback = !!(i.isFallbackAdapter ?? a.isFallbackAdapter) || i.architecture === 'swiftshader';
      return { ok: !fallback, tries, vendor: i.vendor, architecture: i.architecture, description: i.description, fallback, ...(fallback ? { why: `only a CPU fallback adapter (${i.vendor}/${i.architecture})` } : {}) };
    }, timeoutMs);
    return { ...r, ms: Date.now() - t0 };
  } finally { await page.close().catch(() => {}); }
}

export async function launchChrome(options = {}) {
  const { gpu = null, chromium: browserType, ...rest } = options;
  const chromium = browserType ?? (await import('../../pipeline/node_modules/playwright/index.mjs')).chromium;
  // CHROME_ARGS adds flags, e.g. "--enable-gpu --ignore-gpu-blocklist" for WebGL games that fail on software GL.
  const extra = (process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean);
  const headless = rest.headless ?? process.env.HEADED !== '1';
  if (gpu !== 'webgpu' && !warnedVulkan && [...extra, ...(rest.args ?? [])].includes('--use-angle=vulkan')) {
    warnedVulkan = true;
    console.warn('launchChrome: --use-angle=vulkan for WebGL crashes Chrome\'s GPU process on some shaders on this host (white or black page); use gpu: "webgl" or CHROME_ARGS="--enable-gpu --ignore-gpu-blocklist" (qa/browser.mjs WEBGL_GPU_ARGS)');
  }
  if (!gpu) return chromium.launch({ executablePath: chromePath(), headless, ...rest, args: [...(rest.args ?? []), ...extra] });
  if (gpu === 'webgl') return chromium.launch({ executablePath: chromePath(), headless, ...rest, args: [...WEBGL_GPU_ARGS, ...(rest.args ?? []), ...extra] });
  if (gpu !== 'webgpu') throw new Error(`launchChrome: gpu must be "webgl" or "webgpu" (got ${JSON.stringify(gpu)})`);
  // Headless: chrome-headless-shell (see above), unless the caller names a binary. Headed: installed Chrome.
  const executablePath = 'executablePath' in rest ? rest.executablePath : headless ? headlessShellPath() : chromePath();
  const browser = await chromium.launch({ ...rest, executablePath, headless, args: [...(headless ? WEBGPU_ARGS : WEBGPU_HEADED_ARGS), ...(rest.args ?? []), ...extra] });
  // A hardware adapter or nothing: a game that needs WebGPU fails here at once instead of hanging on its error card.
  const adapter = await webgpuAdapter(browser).catch(e => ({ ok: false, why: e.message.split('\n')[0] }));
  if (!adapter.ok) {
    await browser.close().catch(() => {});
    throw new NoWebGPUError(`needs WebGPU: Chrome found no hardware WebGPU adapter (${adapter.why}). It needs a GPU with a Vulkan driver (vulkaninfo lists it); in Docker, pass the GPU through (--device nvidia.com/gpu=all).`);
  }
  browser.webgpu = { ...adapter, executablePath: executablePath ?? 'playwright default' };   // for reports
  return browser;
}
