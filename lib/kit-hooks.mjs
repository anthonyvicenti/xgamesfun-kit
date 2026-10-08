// Module resolution hooks for running games.fun's tools from kits/ unedited (`node --import ./lib/kit-hooks.mjs …`, or
// imported in-process). The import paths are rewritten here, never inside kits/:
//   research/foundations/qa/browser.mjs imports '../../pipeline/node_modules/playwright/index.mjs' (games.fun keeps a
//   Playwright install in research/pipeline). Here it resolves to this package's pinned playwright-core, which exports
//   the same `chromium`.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { KITS } from './paths.mjs';

const KITS_URL = pathToFileURL(KITS + '/').href;
const PLAYWRIGHT = import.meta.resolve('playwright-core');
export const REWRITES = [
  { test: spec => /(^|\/)pipeline\/node_modules\/playwright\/index\.mjs$/.test(spec), to: () => PLAYWRIGHT, why: 'Playwright from this package (playwright-core)' },
];

let installed = false;
export function installKitHooks() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith(KITS_URL)) for (const r of REWRITES) if (r.test(specifier)) return { url: r.to(), shortCircuit: true };
      return next(specifier, context);
    },
  });
}

installKitHooks();
