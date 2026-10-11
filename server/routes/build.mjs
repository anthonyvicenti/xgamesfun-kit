// /api/build/…: the build loop as the studio shows it (read-only), and the roll-back button.
//   GET  /state      → { loop, verdict, checkpoints, rollback, elsewhere }  elsewhere = the game a session is building when it is not this studio's
//                      (each of)  loop = the loop state file as written (null when none),
//                      verdict = the newest verify run summarised, checkpoints = what lib/checkpoint.mjs lists (M2-G)
//   POST /rollback   { id } → restores that checkpoint through lib/checkpoint.mjs; a run under way is cancelled (lib/cancel.mjs)
// The state file is written only by the loop library (through M2-G's tools). It is read here; never written.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCancel, writeCancel } from '../../lib/cancel.mjs';
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
    // a run the person rolled back is cancelled from that moment, also before a loop tool has written it into the state
    let loop = await readLoopFile(gameDir);
    const mark = loop?.status === 'building' ? await readCancel(gameDir) : null;
    if (mark) loop = { ...loop, status: 'cancelled', step: 'done', outcome: 'cancelled', why: mark.reason, handed: null };
    // A session that is building another game than the one this studio shows: say so, never show nothing.
    let elsewhere = null;
    try {
      const { bridgeFor } = await import('./session.mjs');
      const other = bridgeFor(ctx.url)?.bridge.sessions().find(x => x.state !== 'ended' && x.game && path.resolve(x.game) !== path.resolve(gameDir));
      if (other) elsewhere = { game: other.game, name: path.relative(KIT_ROOT, other.game).split(path.sep).join('/'), loop: await readLoopFile(other.game).then(l => (l ? { status: l.status, step: l.step } : null)) };
    } catch { /* no bridge on this server */ }
    return { elsewhere, loop, verdict: await latestVerdict(gameDir), checkpoints, rollback: !!lib?.restoreCheckpoint };
  });

  router.post('/rollback', async req => {
    const { id } = await readJson(req);
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'id is required');
    const lib = await checkpointLib();
    if (!lib?.restoreCheckpoint) throw new HttpError(501, 'Rolling back is not available in this kit yet (lib/checkpoint.mjs).');
    let out;
    try { out = { restored: id, ...(await lib.restoreCheckpoint(gameDir, id)) }; } catch (e) { throw new HttpError(400, e.message); }
    // A roll-back while a run is under way cancels the run (the decision and its reasons: mcp/tools/loop.mjs,
    // applyCancel). This process cannot end the run itself (the loop's state is the MCP server's to write), so it
    // leaves the mark the loop tools apply; from this moment the stop guard and this tab read the run as cancelled.
    const loop = await readLoopFile(gameDir);
    if (loop?.status === 'building' && loop.step !== 'done') {
      const label = (await lib.listCheckpoints(gameDir).catch(() => [])).find(c => c.id === id)?.label ?? id;
      const mark = await writeCancel(gameDir, { reason: `the person rolled the game back from the studio page to "${label}"`, checkpoint: id, label });
      out.cancelled = { run: loop.kind ?? 'build', step: loop.step, at: mark.at };
    }
    return out;
  });
}
