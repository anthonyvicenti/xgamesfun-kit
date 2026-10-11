// A stub of the bridge's session routes, for the studio page's tests and screenshots ONLY, shaped by
// bridge/CONTRACT.md version 1 (track M3-B, worktree gamesfun-kit-worktrees/bridge). It is not the bridge:
// server/routes/session.mjs belongs to M3-B. Control from a test: stub.emit(kind, fields), stub.session (the one
// session), stub.requests, stub.permissions, stub.decisions.
import { HttpError, readJson } from '../../server/http.mjs';

export const TOKEN = 'stub-token-0001';

export function attachSessionStub(server) {
  const area = server.router.area('session');
  const clients = new Set();
  const stub = { requests: [], permissions: [], decisions: [], events: [], loop: null, n: 1, seq: 0,
    session: { id: 's1', agent: 'claude-code', cwd: '/stub', state: 'idle', connected: false, primary: true, permissionMode: 'default', started: Date.now(), lastEvent: 'stop', lastEventAt: Date.now(), guard: null } };
  stub.sessions = [stub.session];
  const guard = req => {
    const t = req.headers['x-gamesfun-token'] ?? new URL(req.url, 'http://x').searchParams.get('token');
    if (t !== TOKEN) throw new HttpError(401, 'missing or wrong token');
  };
  stub.emit = (kind, fields = {}) => {
    const e = { seq: ++stub.seq, t: Date.now(), kind, ...(kind === 'hello' ? {} : { session: 's1' }), ...fields };
    stub.events.push(e);
    for (const res of clients) res.write(`id: ${e.seq}\nevent: ${kind}\ndata: ${JSON.stringify(e)}\n\n`);
    return e;
  };
  area.get('/token', (req) => {
    if (req.headers['sec-fetch-site'] !== 'same-origin') throw new HttpError(403, 'same-origin only');
    return { token: TOKEN, run: 'abcd1234', contract: 1 };
  });
  area.get('/events', (req, res) => {
    guard(req);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    res.write(`event: hello\ndata: ${JSON.stringify({ seq: 0, t: Date.now(), kind: 'hello', run: 'abcd1234', contract: 1 })}\n\n`);
    for (const e of stub.events) res.write(`id: ${e.seq}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  area.get('/queue', req => {
    guard(req);
    return { run: 'abcd1234', contract: 1, game: '/stub', transport: { id: 'claude-hooks', wait: 'rewake', capabilities: {} },
      sessions: stub.sessions, requests: stub.requests, permissions: stub.permissions, loop: stub.loop };
  });
  area.post('/request', async req => {
    guard(req);
    const { text, selection } = await readJson(req);
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new HttpError(400, 'text must be 1 to 8000 characters');
    const r = { id: `r_abcd1234_${stub.n++}`, text, selection: selection ?? null, session: null, state: 'waiting', via: null, created: Date.now(), handed: null, seen: null, done: null, note: null, refusals: 0 };
    stub.requests.push(r);
    return r;
  });
  const find = id => stub.requests.find(x => x.id === id) ?? (() => { throw new HttpError(404, 'no such request'); })();
  area.patch('/request/:id', async (req, res, { id }) => {
    guard(req);
    const r = find(id);
    if (r.state !== 'waiting') throw new HttpError(409, `the request is ${r.state}`);
    const b = await readJson(req);
    if (typeof b.text === 'string') r.text = b.text;
    if ('selection' in b) r.selection = b.selection;
    return r;
  });
  area.delete('/request/:id', (req, res, { id }) => {
    guard(req);
    const r = find(id);
    if (r.state !== 'waiting') throw new HttpError(409, `the request is ${r.state}`);
    r.state = 'dropped';
    return r;
  });
  area.post('/permission/:id', async (req, res, { id }) => {
    guard(req);
    const { decision } = await readJson(req);
    if (!['allow', 'deny'].includes(decision)) throw new HttpError(400, 'decision must be allow or deny');
    const p = stub.permissions.find(x => x.id === id);
    if (!p) throw new HttpError(404, 'no such permission');
    if (p.state !== 'waiting') throw new HttpError(409, 'no longer waiting');
    p.state = decision; p.resolved = Date.now();
    stub.decisions.push({ id, decision });
    stub.emit('permission-resolved', { permission: p });
    return p;
  });
  stub.ask = (tool, input) => {
    const p = { id: `p_abcd1234_${stub.permissions.length + 1}`, session: 's1', tool, input, state: 'waiting', mode: 'default', created: Date.now(), resolved: null };
    stub.permissions.push(p);
    stub.emit('permission-request', { permission: p });
    return p;
  };
  return stub;
}
