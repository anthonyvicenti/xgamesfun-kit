// The one place the bridge reads the build loop's state. The file is written only by the loop library, through the
// loop tools (kits/research/gf-three/loop/README.md, "The state file"); the bridge never writes it. If its place or
// shape changes, this function is all that follows.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const LOOP_STATE = ['.gf-loop', 'state.json'];
export const LOOP_STATUSES = ['building', 'waiting-on-question', 'delivered', 'failed'];

/** → { status, step, why, round, updated, session } or null (no file, not JSON, or a status the bridge does not know). */
export async function readLoopState(gameDir) {
  let s;
  try { s = JSON.parse(await readFile(path.join(gameDir, ...LOOP_STATE), 'utf8')); } catch { return null; }
  if (!s || typeof s !== 'object' || !LOOP_STATUSES.includes(s.status)) return null;
  return {
    status: s.status,
    step: typeof s.step === 'string' ? s.step : null,
    why: typeof s.why === 'string' ? s.why : null,
    round: s.round ?? null,
    updated: s.updated ?? null,
    session: typeof s.session === 'string' ? s.session : null,
  };
}
