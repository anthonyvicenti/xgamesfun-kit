// gf-three tools: where things are. Every path is absolute; nothing depends on the working directory.
import { fileURLToPath, pathToFileURL } from 'node:url';
import pathImpl, { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

export const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const GF3 = join(REPO, 'research/gf-three');
// GF_KIT_DIR points every tool at another copy of the kit folder (a test that adds one throwaway mechanic folder and
// runs catalog, create and verify on it: tests/h-throwaway.test.mjs). Unset, the tools use the repository's kit.
export const KIT = process.env.GF_KIT_DIR ? resolve(process.env.GF_KIT_DIR) : join(GF3, 'kit');
export const LIBRARY = join(GF3, 'library');
export const TOOLS = join(GF3, 'tools');
export const TOOLS_LIB = join(TOOLS, 'lib');
export const STANDIN_ASSETS = join(TOOLS_LIB, 'standin-assets');
export const SPEC_SCHEMA = join(REPO, 'research/studio-v2/game-spec.schema.json');
export const KIT_VERSION = '0.1.0-dev';
// The scenic engine (research/gf-scenic/PLAN.md, CONTRACT §8): its look and world, vendored into a scenic game as gf/scenic/
export const SCENIC = join(REPO, 'research/gf-scenic');
export const SCENIC_KIT = join(SCENIC, 'kit');
export const SCENIC_VERSION = '0.1.0-dev';
// The forge engine (research/rust-engine/PLAN.md, CONTRACT §8 forge; wave 1b, the four tracks together): a Rust core on
// WebGPU, vendored into a forge game as gf/forge/ (host, look, world, players, show, the data tables, the release wasm);
// no three.js, no Rapier (the core's own physics is rapier3d in Rust)
export const FORGE = join(REPO, 'research/gf-forge');
export const FORGE_KIT = join(FORGE, 'kit');
export const FORGE_VERSION = '0.8.0-wave6';
export const ENGINES = ['party', 'scenic', 'forge'];
export const engineOf = spec => (spec?.engine === 'scenic' ? 'scenic' : spec?.engine === 'forge' ? 'forge' : 'party');

// Pinned third-party sources (research/gf-three/README.md "Pinned"), copied byte for byte into a game's vendor/.
const T = 'research/foundations/trials';
export const VENDOR = {
  // three 0.186.0: the build from fps-arena (byte-identical to the npm tarball); addons resolve from the curated copy
  threeBuild: join(REPO, `${T}/fps-arena/source/vendor/three`),
  threeAddons: [join(TOOLS_LIB, 'vendor/three'), join(REPO, `${T}/fps-arena/source/vendor/three`), join(REPO, 'research/gf-scenic/tools/lib/vendor/three')],
  rapier: join(REPO, `${T}/third-person-adventure/source/vendor/rapier`),
  // three 0.186.0's WebGPU build (three.webgpu.js, three.tsl.js; byte-identical to the npm tarball, the same three.core.js)
  threeWebgpu: join(REPO, `${T}/third-person-adventure/source/vendor/three`),
  postprocessing: join(REPO, `${T}/fps-arena/source/vendor/postprocessing`),
  n8ao: join(REPO, `${T}/fps-arena/source/vendor/n8ao`),
};
export const GF_ASSETS = join(REPO, 'research/foundations/kits/gf-assets/1.3.0/source/gf-assets.js');
export const GF_AUDIO = join(REPO, 'research/foundations/kits/gf-audio/1.5.0');
export const PARTY = join(REPO, 'research/multiplayer/party');

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const sha256File = async p => sha256(await readFile(p));

/** Every file under dir (relative paths with /), sorted, skipping node_modules and .git. */
export async function walk(dir, { skip = () => false } = {}, base = dir, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name), rel = p.slice(base.length + 1).split('\\').join('/');
    if (skip(rel, e)) continue;
    if (e.isDirectory()) await walk(p, { skip }, base, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Stable JSON: two-space indent, a trailing newline (the same input always gives the same bytes). */
export const json = v => JSON.stringify(v, null, 2) + '\n';

/** A game's engine (CONTRACT §8): gf-three.json → kit.engine, else what its gf/three/kit.js records, else 'party'. */
export async function engineOfGame(dir) {
  try { const e = JSON.parse(await readFile(join(dir, 'gf-three.json'), 'utf8'))?.kit?.engine; if (e) return ENGINES.includes(e) ? e : 'party'; } catch {}
  try { const m = /"engine":\s*"(scenic|forge)"/.exec(await readFile(join(dir, 'gf/three/kit.js'), 'utf8')); return m ? m[1] : 'party'; } catch {}
  return 'party';
}

/**
 * Chrome for a game's QA pages, on the renderer the game really uses: WebGPU for a scenic game (WebGPURenderer;
 * qa/browser.mjs's headless shell with Vulkan), WebGL on the real GPU for a party game, software with
 * GF_VERIFY_SOFTWARE=1. A scenic game on a machine whose Chrome finds no WebGPU adapter runs on WebGL (the WebGL2 path
 * inside WebGPURenderer) and `note` says so. Pass qa/browser.mjs's launchChrome (this module stays free of Playwright).
 * → {browser, gpu: 'webgpu' | 'webgl' | 'software', engine, note}
 */
export async function launchForGame(launchChrome, dir, { software = !!process.env.GF_VERIFY_SOFTWARE, engine = null, ...given } = {}) {
  // a check may play two players on this one machine: real addresses in their WebRTC candidates (qa/browser.mjs
  // LOCAL_WEBRTC_OFF; where mDNS names cannot be looked up, as on a macOS CI runner, the two never connect)
  const rest = { disableFeatures: ['WebRtcHideLocalIpsWithMdns'], ...given };
  const eng = engine ?? await engineOfGame(dir);
  const plan = rendererFor(eng, { software });
  if (plan.gpu === 'software') return { browser: await launchChrome({ ...rest }), gpu: 'software', engine: eng, note: null };
  if (plan.gpu === 'webgl') return { browser: await launchChrome({ gpu: 'webgl', ...rest }), gpu: 'webgl', engine: eng, note: null };
  try { return { browser: await launchChrome({ gpu: 'webgpu', ...rest }), gpu: 'webgpu', engine: eng, note: null }; }
  catch (e) {
    if (e?.name !== 'NoWebGPUError') throw e;
    const why = e.why ?? e.message.split('(')[1]?.split(')')[0] ?? e.message;
    if (plan.withoutWebgpu !== 'webgl') { e.message = `${plan.result} ${e.message}`; throw e; }
    return { browser: await launchChrome({ gpu: 'webgl', ...rest }), gpu: 'webgl', engine: eng, note: `a scenic game, but this Chrome has no WebGPU adapter (${why}); it ran on WebGL2 inside WebGPURenderer` };
  }
}

/**
 * Which renderer a game's QA pages run on, and what happens on a machine whose Chrome has no WebGPU adapter. The answer
 * is the same on Linux, Windows and macOS: the engine decides it, and qa/browser.mjs's gpuLaunchPlan() picks the flags
 * and the binary that fit the system (Vulkan in the headless shell on Linux, Chrome's own Direct3D 12 or Metal backend
 * elsewhere). Pure.
 *   party   WebGL on the graphics card. WebGPU is never asked for.
 *   scenic  WebGPU; without an adapter it runs on WebGL2 inside WebGPURenderer and the verdict's notes say so.
 *   forge   WebGPU only; without an adapter the launch fails with NoWebGPUError (nothing is drawn in software).
 *   GF_VERIFY_SOFTWARE=1: any engine on Chrome's software renderer (never for judging looks).
 * → {gpu: 'webgl' | 'webgpu' | 'software', withoutWebgpu: null | 'webgl' | 'error', result}
 */
export function rendererFor(engine, { software = false } = {}) {
  if (software) return { gpu: 'software', withoutWebgpu: null, result: 'Runs on Chrome\'s software renderer (GF_VERIFY_SOFTWARE).' };
  if (engine === 'forge') return { gpu: 'webgpu', withoutWebgpu: 'error', result: 'A forge game draws only with WebGPU and has no WebGL path, so it cannot be verified on this machine.' };
  if (engine === 'scenic') return { gpu: 'webgpu', withoutWebgpu: 'webgl', result: 'A scenic game without a WebGPU adapter runs on WebGL2 inside WebGPURenderer, and the verdict says so.' };
  return { gpu: 'webgl', withoutWebgpu: null, result: 'A party game runs on WebGL and never asks for WebGPU.' };
}

/** A path as a verdict or a record writes it: relative to `base`, with forward slashes on every system. */
export const relPosix = (base, p, impl = pathImpl) => impl.relative(base, p).split(impl.sep).join('/');

/**
 * Is `file` inside the folder `base`? → the path below it, in the system's own form, or null (the folder itself, a
 * sibling whose name only starts the same, another drive). The one test for "under this folder": `file.startsWith(base
 * + '/')` is never true on Windows, where the paths Node hands out have backslashes (a scenic `create` failed there on
 * the first Windows run, 2026-10-11: kit-import.mjs never mapped research/gf-scenic/three/ to the kit).
 */
export function below(base, file, impl = pathImpl) {
  const rel = impl.relative(base, file);
  return rel && !impl.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + impl.sep) ? rel : null;
}

/**
 * Import a module of a part of the repository that a checkout may not carry (the forge engine, the watch relay, the
 * world server, the character bench): by path at the moment it is needed, with a plain error when it is absent.
 * `what` names the part for the person ("the forge engine (research/gf-forge)").
 */
export async function importPart(file, what) {
  if (!existsSync(file)) { const e = new Error(`${what} is not in this checkout (${relPosix(REPO, file)} is missing)`); e.code = 'GF_PART_MISSING'; throw e; }
  return import(pathToFileURL(file).href);
}
