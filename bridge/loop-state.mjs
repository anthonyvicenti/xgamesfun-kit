// The one place the bridge reads the build loop's state. The file is written only by the loop library, through the
// loop tools (kits/research/gf-three/loop/README.md, "The state file"); the bridge never writes it. If its place or
// shape changes, this function is all that follows.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const LOOP_STATE = ['.gf-loop', 'state.json'];
export const LOOP_STATUSES = ['building', 'waiting-on-question', 'delivered', 'failed'];

/** → { status, step, why, round, updated, session, handed } or null (no file, not JSON, or a status the bridge does not know). */
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
    // who has the round, when someone does: 'playtest' means the play-tester subagent, not the session itself
    handed: s.handed && typeof s.handed === 'object' ? String(s.handed.step ?? s.handed.kind ?? 'round') : null,
  };
}

// Tool calls of ours that are running on the game right now (lib/running.mjs writes one marker per call; this is the
// bridge's reader of them). A marker counts while its process lives and it is younger than half an hour.
export const RUNNING_DIR = ['.gf-loop', 'running'];
const MAX_AGE_MS = 30 * 60 * 1000;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** → [{ tool, pid, since }] */
export async function readRunning(gameDir, { now = Date.now, isAlive = alive } = {}) {
  const dir = path.join(gameDir, ...RUNNING_DIR);
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const out = [];
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    let m = null;
    try { m = JSON.parse(await readFile(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!m || !Number.isInteger(m.pid) || typeof m.since !== 'number') continue;
    if (now() - m.since > MAX_AGE_MS || !isAlive(m.pid)) continue;
    out.push({ tool: String(m.tool ?? ''), pid: m.pid, since: m.since });
  }
  return out;
}
