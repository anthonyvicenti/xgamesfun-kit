// Import kit modules in Node (tools/slots.mjs, catalog.mjs, tests) to read their declarations: `slots`, `slotsFor`,
// `params`, `id`, `examples`, `templates`, `presets`, `CLIPS`. A module may import three.js, Rapier, postprocessing
// or N8AO by their import-map names, and the game-relative files a vendored kit sees (gf/gf-assets.js, gf/mp/net.js,
// audio/audio.js, gf/three/kit.js); this hook resolves those to the pinned copies, the same files a game vendors.
// A module must not touch the DOM when it is imported (CONTRACT: declarations are read in Node).
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { VENDOR, GF_ASSETS, GF_AUDIO, PARTY, KIT, SCENIC, FORGE, KIT_VERSION, below } from './paths.mjs';

let installed = false;
const addon = rel => { for (const d of VENDOR.threeAddons) { const p = join(d, 'examples/jsm', rel); if (existsSync(p)) return p; } return null; };
const BARE = {
  three: join(VENDOR.threeBuild, 'build/three.module.js'),
  // the scenic engine's modules (CONTRACT §8) import the WebGPU build; in Node only their declarations are read
  'three/webgpu': join(VENDOR.threeWebgpu, 'build/three.webgpu.js'),
  'three/tsl': join(VENDOR.threeWebgpu, 'build/three.tsl.js'),
  postprocessing: join(VENDOR.postprocessing, 'postprocessing.module.js'),
  n8ao: join(VENDOR.n8ao, 'N8AO.js'),
  '@dimforge/rapier3d-compat': join(VENDOR.rapier, 'rapier.mjs'),
};
// a game-relative file the dev kit tree does not hold → its kit source
const GAME_FILES = [
  [/\/gf-assets\.js$/, GF_ASSETS],
  [/\/mp\/net\.js$/, join(PARTY, 'kit/net.js')],
  [/\/audio\/audio\.js$/, join(GF_AUDIO, 'source/audio.js')],
  [/\/audio\/presets\.json$/, join(GF_AUDIO, 'source/presets.json')],
];
const KIT_STUB = `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify({ name: 'gf-three', version: KIT_VERSION, modules: {}, files: {} })};`)}`;

export function installKitImports() {
  if (installed) return; installed = true;
  registerHooks({
    resolve(specifier, context, next) {
      if (BARE[specifier]) return { url: pathToFileURL(BARE[specifier]).href, shortCircuit: true };
      const m = /^three\/(?:addons|examples\/jsm)\/(.+)$/.exec(specifier);
      if (m) { const p = addon(m[1]); if (p) return { url: pathToFileURL(p).href, shortCircuit: true }; }
      if ((specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL?.startsWith('file:')) {
        const target = new URL(specifier, context.parentURL);
        if (!existsSync(fileURLToPath(target))) {
          if (/\/three\/kit\.js$/.test(target.pathname) || /\/kit\/kit\.js$/.test(target.pathname)) return { url: KIT_STUB, shortCircuit: true };
          // the scenic engine's dev tree imports the shared kit as a game sees it (gf/scenic/x → ../../three/core/…):
          // research/gf-scenic/three/<rel> is research/gf-three/kit/<rel> (CONTRACT §8)
          const file = fileURLToPath(target), sc = below(join(SCENIC, 'three'), file);
          if (sc) { const k = join(KIT, sc); if (existsSync(k)) return { url: pathToFileURL(k).href, shortCircuit: true }; }
          // the forge engine's kit the same way (gf/forge/x → ../three/core/…): research/gf-forge/three/<rel> (CONTRACT §8 forge)
          const fo = below(join(FORGE, 'three'), file);
          if (fo) { const k = join(KIT, fo); if (existsSync(k)) return { url: pathToFileURL(k).href, shortCircuit: true }; }
          for (const [re, file] of GAME_FILES) if (re.test(target.pathname)) return { url: pathToFileURL(file).href, shortCircuit: true };
        }
      }
      return next(specifier, context);
    },
  });
}

/** Import a module file (absolute path) with the hook installed. Errors come back as {error}. */
export async function importKitModule(file) {
  installKitImports();
  try { return await import(pathToFileURL(file).href); } catch (e) { return { error: e }; }
}
