// /api/build/…: the build loop as the studio shows it (read-only), and the roll-back button.
//   GET  /state      → { loop, verdict, checkpoints, rollback }  loop = the loop state file as written (null when none),
//                      verdict = the newest verify run summarised, checkpoints = what lib/checkpoint.mjs lists (M2-G)
//   POST /rollback   { id } → restores that checkpoint through lib/checkpoint.mjs; 501 until M2-G's library exists
// The state file is written only by the loop library (through M2-G's tools). It is read here; never written.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { latestVerdict } from '../../lib/games.mjs';
import { KIT_ROOT } from '../../lib/paths.mjs';
import { HttpError, readJson } from '../http.mjs';

// where the loop keeps its state (final, games.fun research/gf-three/loop/README.md): <game>/.gf-loop/state.json, schema gf-loop/1
const STATE_FILES = ['.gf-loop/state.json'];

export async function readLoopFile(gameDir) {
  for (const rel of STATE_FILES) {
    try {
      const j = JSON.parse(await readFile(path.join(gameDir, ...rel.split('/')), 'utf8'));
      if (j && typeof j === 'object') return j;
    } catch {}
  }
  return null;
}

async function checkpointLib() {
  try { return await import(pathToFileURL(path.join(KIT_ROOT, 'lib', 'checkpoint.mjs')).href); } catch { return null; }
}

export default function register(router, ctx) {
  const { gameDir } = ctx;

  router.get('/state', async () => {
    const lib = await checkpointLib();
    let checkpoints = [];
    try { if (lib?.listCheckpoints) checkpoints = (await lib.listCheckpoints(gameDir)) ?? []; } catch (e) { ctx.log(`checkpoints: ${e.message}`); }
    return { loop: await readLoopFile(gameDir), verdict: await latestVerdict(gameDir), checkpoints, rollback: !!lib?.restoreCheckpoint };
  });

  router.post('/rollback', async req => {
    const { id } = await readJson(req);
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'id is required');
    const lib = await checkpointLib();
    if (!lib?.restoreCheckpoint) throw new HttpError(501, 'Rolling back is not available in this kit yet (lib/checkpoint.mjs).');
    try { return { restored: id, ...(await lib.restoreCheckpoint(gameDir, id)) }; } catch (e) { throw new HttpError(400, e.message); }
  });
}
