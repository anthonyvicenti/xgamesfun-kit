// Shared by the plugin's scripts. Node's own modules only: an installed plugin is copied away from the kit, so it
// cannot import bridge/. findRun here and in bridge/runfile.mjs follow the same rule (CONTRACT.md section 5); a test
// holds them to the same answers. No shell, no POSIX-only path: the same on Windows, macOS and Linux.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_FILE = ['.gamesfun', 'bridge.json'];

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const inside = (base, p) => { const rel = path.relative(path.resolve(base), path.resolve(p)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function* above(dir) {
  let d = path.resolve(dir);
  for (;;) { yield d; const up = path.dirname(d); if (up === d) return; d = up; }
}

/** → { url, token, run, pid, game, wait, started, file } or null */
export async function findRun({ cwd = process.cwd(), env = process.env, extra = [HERE] } = {}) {
  const files = [];
  if (env.GAMESFUN_BRIDGE_FILE) files.push(path.resolve(env.GAMESFUN_BRIDGE_FILE));
  for (const start of [cwd, env.CLAUDE_PROJECT_DIR, ...extra]) if (start) for (const d of above(start)) files.push(path.join(d, ...RUN_FILE));
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    let v = null;
    try { v = JSON.parse(await readFile(file, 'utf8')); } catch { continue; }
    const runs = v?.schema === 'gf-bridge/1' && Array.isArray(v.runs) ? v.runs.filter(r => r && alive(r.pid)) : [];
    if (!runs.length) continue;
    const near = cwd ? runs.filter(r => r.game && (inside(cwd, r.game) || inside(r.game, cwd))) : [];
    const pick = (near.length ? near : runs).sort((a, b) => (b.started ?? 0) - (a.started ?? 0))[0];
    return { ...pick, file };
  }
  return null;
}

/** The hook's input: the JSON the agent writes to stdin. {} when there is none. */
export async function readInput() {
  if (process.stdin.isTTY) return {};
  try {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) text += c;
    return text.trim() ? JSON.parse(text) : {};
  } catch { return {}; }
}

/** POST JSON to the bridge. → { status, text }. node:http, so a long hold has no five-minute body timeout. */
export function post(run, route, body, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body ?? {}));
    const req = http.request(new URL(route, run.url), { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length, 'x-gamesfun-token': run.token } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
