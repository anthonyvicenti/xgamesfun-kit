// /api/publish/…: the studio's Publish tab (studio/tabs/publish.js). The same steps as `gamesfun login` and
// `gamesfun publish` (lib/publish/), run inside the dev server, one at a time, with their progress sent to open pages
// as the `publish` event. The token never reaches the page: the page sees who is signed in, never the token.
import { HttpError, openGame, readJson } from '../http.mjs';
import { login, logout, studioOrigin } from '../../lib/publish/client.mjs';
import { preflight, publishGame, publishStatus } from '../../lib/publish/index.mjs';
import { storeName } from '../../lib/credentials.mjs';

export default function register(router, ctx) {
  // The open game is read at each request, never kept: the studio may open a game after this route loaded (the start
  // page, then a new or picked game), or another one. Keeping ctx.gameDir from load time sent null to the file walk
  // ("The "paths[0]" argument must be of type string. Received null" on a fresh game).
  const G = () => openGame(ctx);
  const signIn = { state: 'idle', url: null, error: null, email: null };
  const run = { running: false, lines: [], result: null, error: null, code: null, started: null };
  const send = () => ctx.events?.send('publish', { running: run.running, signIn: signIn.state });
  // another game opened: the last run's words were about the one before
  ctx.onGame?.(() => { if (!run.running) Object.assign(run, { lines: [], result: null, error: null, code: null, started: null }); });

  router.get('/status', async () => {
    const origin = studioOrigin();
    const s = await publishStatus(G(), { origin }).catch(e => ({ studio: origin, error: e.message }));
    return { ...s, store: storeName(), signIn: { ...signIn }, run: { running: run.running, lines: run.lines.slice(-200), result: run.result, error: run.error, code: run.code, started: run.started } };
  });

  router.get('/check', async () => {
    const p = await preflight(G(), { origin: studioOrigin() });
    return { ok: !p.problems.length && !p.secrets, files: p.built.tree.files.length, bytes: p.built.bytes, skipped: p.built.skipped, added: p.built.added, problems: p.problems, secrets: p.secrets, backend: p.backend };
  });

  // Starts a sign-in and answers at once with the page to open; the page opens it in a new tab, the person approves
  // there, and games.fun sends the browser back to the kit's own loopback callback.
  router.post('/login', async () => {
    if (signIn.state === 'waiting') return { url: signIn.url };
    Object.assign(signIn, { state: 'waiting', url: null, error: null, email: null });
    const origin = studioOrigin();
    let resolveUrl;
    const urlReady = new Promise(r => { resolveUrl = r; });
    login({ origin, open: url => { signIn.url = url; resolveUrl(url); } })
      .then(r => { Object.assign(signIn, { state: 'signed-in', email: r.email }); })
      .catch(e => { Object.assign(signIn, { state: 'failed', error: e.message }); resolveUrl(null); })
      .finally(send);
    const url = await urlReady;
    if (!url) throw new HttpError(502, signIn.error ?? 'sign-in did not start');
    return { url };
  });

  router.post('/logout', async () => {
    const r = await logout(studioOrigin());
    Object.assign(signIn, { state: 'idle', url: null, error: null, email: null });
    send();
    return r;
  });

  router.post('/run', async req => {
    if (run.running) throw new HttpError(409, 'a publish is already running');
    const gameDir = G(), body = await readJson(req);
    Object.assign(run, { running: true, lines: [], result: null, error: null, code: null, started: new Date().toISOString() });
    send();
    publishGame(gameDir, { origin: studioOrigin(), draft: body.draft === true, newGame: body.newGame === true, title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : null,
      progress: line => { run.lines.push(line); if (run.lines.length > 2000) run.lines.splice(0, run.lines.length - 2000); ctx.events?.send('publish', { line }); } })
      .then(r => { run.result = r; })
      .catch(e => { run.error = e.message; run.code = e.code ?? null; })
      .finally(() => { run.running = false; send(); });
    return { started: true };
  });
}
