// A stub of the bridge's session routes (wave 4 README), for the studio page's tests and screenshots ONLY. It is not
// the bridge: server/routes/session.mjs belongs to track M3-B and is built against bridge/CONTRACT.md.
//   GET /api/session/events (SSE)   POST /api/session/request {text, selection?} → {id}   GET /api/session/queue
//   PATCH|DELETE /api/session/request/:id   POST /api/session/permission/:id {decision}
// Control from a test: stub.emit(event), stub.setWait(bool), stub.setState(id, state), stub.requests, stub.decisions.
import { HttpError, readJson } from '../../server/http.mjs';

export function attachSessionStub(server) {
  const area = server.router.area('session');
  const clients = new Set();
  const stub = { requests: [], decisions: [], events: [], wait: false, next: 1 };
  stub.emit = ev => {
    const e = { id: `e${stub.events.length + 1}`, at: new Date().toISOString(), ...ev };
    stub.events.push(e);
    for (const res of clients) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    return e;
  };
  stub.setWait = v => { stub.wait = !!v; };
  stub.setState = (id, state) => { const r = stub.requests.find(x => x.id === id); if (r) r.state = state; };
  area.get('/events', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    res.write('retry: 1000\n\n');
    for (const e of stub.events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  area.post('/request', async req => {
    const { text, selection } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text is required');
    const r = { id: `r${stub.next++}`, text, selection: selection ?? null, state: 'waiting', at: new Date().toISOString() };
    stub.requests.push(r);
    return { id: r.id };
  });
  area.get('/queue', () => ({ requests: stub.requests, wait: { open: stub.wait } }));
  area.patch('/request/:id', async (req, res, { id }) => {
    const r = stub.requests.find(x => x.id === id);
    if (!r) throw new HttpError(404, 'no such request');
    if (r.state !== 'waiting') throw new HttpError(409, 'already handed over');
    r.text = String((await readJson(req)).text ?? r.text);
    return r;
  });
  area.delete('/request/:id', (req, res, { id }) => {
    const i = stub.requests.findIndex(x => x.id === id);
    if (i < 0) throw new HttpError(404, 'no such request');
    stub.requests.splice(i, 1);
    return { removed: id };
  });
  area.post('/permission/:id', async (req, res, { id }) => {
    const { decision } = await readJson(req);
    if (!['allow', 'deny'].includes(decision)) throw new HttpError(400, 'decision must be allow or deny');
    stub.decisions.push({ id, decision });
    stub.emit({ type: 'permission-resolved', request: id, text: decision });
    return { ok: true };
  });
  return stub;
}
