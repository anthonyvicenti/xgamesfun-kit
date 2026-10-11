// What the session's tools call (mcp/tools: gamesfun_requests). The MCP server is its own process, so these find the
// running dev server from the run file and talk to its routes; a tool needs no port, no token and no Bash.
// Every function answers { ok: false, error } instead of throwing: a closed page never breaks a tool.
import { findRun } from './runfile.mjs';

async function call(run, method, route, body) {
  const res = await fetch(new URL(route, run.url), {
    method,
    headers: { 'x-gamesfun-token': run.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) return { ok: false, error: json?.error ?? `the studio answered ${res.status}` };
  return { ok: true, ...json };
}
async function withRun(options, fn) {
  const run = options.run ?? await findRun({ cwd: options.cwd, env: options.env, extra: options.extra });
  if (!run) return { ok: false, error: 'the studio is not running here (start it with: npx gamesfun dev)' };
  try { return await fn(run); } catch (e) { return { ok: false, error: `the studio did not answer at ${run.url}: ${e.message}` }; }
}

/** Is a studio running for this folder, and which sessions does it see? */
export async function bridgeStatus(options = {}) {
  const run = options.run ?? await findRun({ cwd: options.cwd, env: options.env, extra: options.extra });
  if (!run) return { running: false };
  try {
    const q = await call(run, 'GET', '/api/session/queue');
    if (!q.ok) return { running: false, error: q.error };
    return { running: true, url: run.url, run: q.run, game: q.game, wait: q.transport?.wait ?? null, sessions: q.sessions, waiting: q.requests.filter(r => r.state === 'waiting').length };
  } catch (e) { return { running: false, error: e.message }; }
}

/** The page's requests for this session: what it was handed and has not reported, plus what is waiting for it. */
export function collectRequests(options = {}) {
  return withRun(options, async run => {
    const r = await call(run, 'GET', `/api/session/requests${options.session ? `?session=${encodeURIComponent(options.session)}` : ''}`);
    if (!r.ok) return r;
    return { ok: true, session: r.session, requests: r.requests.map(({ id, text, selection, state }) => ({ id, text, selection, state })) };
  });
}

/** The session reports a request done (or that it will not do it: status "dropped", with the reason in note). */
export function reportRequest(options = {}) {
  return withRun(options, async run => {
    if (!options.id) return { ok: false, error: 'which request? pass its id' };
    const r = await call(run, 'POST', `/api/session/request/${encodeURIComponent(options.id)}/done`, { note: options.note ?? null, status: options.status ?? 'done' });
    if (!r.ok) return r;
    const { ok, ...request } = r;
    return { ok: true, request };
  });
}
