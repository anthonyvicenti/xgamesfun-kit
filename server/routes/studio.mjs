// /api/studio/…: what the studio page loads: its tabs (studio/tabs/*.js, the tabs seam).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { web3On } from '../../lib/web3-switch.mjs';
import { STUDIO } from '../../lib/paths.mjs';

// Web3 is on by default (lib/web3-switch.mjs): GAMESFUN_WEB3=0 takes the Economy tab out of the list the page builds
// its tab row from, so it is not in the DOM and cannot be reached by keyboard.
export const WEB3_TAB_FILES = new Set(['economy.js']);

export default function register(router, ctx = {}) {
  router.get('/tabs', async () => {
    let files = [];
    try { files = (await readdir(path.join(STUDIO, 'tabs'))).filter(f => /^[a-z0-9][a-z0-9-]*\.js$/.test(f)).sort(); } catch {}
    if (!web3On(process.env)) files = files.filter(f => !WEB3_TAB_FILES.has(f));
    return files.map(f => ({ file: f, url: `/studio/tabs/${f}` }));
  });
}
