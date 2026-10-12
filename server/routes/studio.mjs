// /api/studio/…: what the studio page loads: its tabs (studio/tabs/*.js, the tabs seam).
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO } from '../../lib/paths.mjs';

// Web3 is off until asked for (HANDOFF section 1): the Economy tab is not in the list the page builds its tab
// row from, so they are not in the DOM and cannot be reached by keyboard. On with GAMESFUN_WEB3=1 for the dev server (the
// variable the MCP server uses for its web3_* tools), or when the game already has a gamesfun.json.
export const WEB3_TAB_FILES = new Set(['economy.js']);

export async function web3On(env, gameDir) {
  if (env.GAMESFUN_WEB3 === '1') return true;
  try { return (await stat(path.join(gameDir, 'gamesfun.json'))).isFile(); } catch { return false; }
}

export default function register(router, ctx = {}) {
  router.get('/tabs', async () => {
    let files = [];
    try { files = (await readdir(path.join(STUDIO, 'tabs'))).filter(f => /^[a-z0-9][a-z0-9-]*\.js$/.test(f)).sort(); } catch {}
    if (!(await web3On(process.env, ctx.gameDir ?? ''))) files = files.filter(f => !WEB3_TAB_FILES.has(f));
    return files.map(f => ({ file: f, url: `/studio/tabs/${f}` }));
  });
}
