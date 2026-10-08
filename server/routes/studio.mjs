// /api/studio/…: what the studio page loads: its tabs (studio/tabs/*.js, the tabs seam).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO } from '../../lib/paths.mjs';

export default function register(router) {
  router.get('/tabs', async () => {
    let files = [];
    try { files = (await readdir(path.join(STUDIO, 'tabs'))).filter(f => /^[a-z0-9][a-z0-9-]*\.js$/.test(f)).sort(); } catch {}
    return files.map(f => ({ file: f, url: `/studio/tabs/${f}` }));
  });
}
