// The local dev server behind `gamesfun dev`: one game, the studio page, live reload, local multiplayer signaling and
// the API routes in server/routes/*.mjs. It binds 127.0.0.1 only and checks Host and Origin (security.mjs).
//
//   /                      → /studio/
//   /studio/…              the studio page (studio/index.html, studio.js, tabs/*.js)
//   /game/…                the game folder (its pages get the live-reload script and, when the game's multiplayer kit
//                          knows online play and GAMESFUN_ONLINE is not off, the online-play line); /game/gf/mp/ plays with friends
//   /signal, /signal/v1    gf-multiplayer signaling: the WebSocket the kit uses on 127.0.0.1, and HTTP (kits' signal server)
//   /api/<area>/…          routes from server/routes/<area>.mjs
//   /__gamesfun/online.js  online play's readable side, for a game page that got the online line (server/online.mjs)
//   /__gamesfun/gf-web3/…  the kit's own in-game web3 kit (web3/gf-web3), for the studio's host bridge (studio/host-bridge.js):
//                          the page that hosts the game signs with the kit's code, never with code from the game's folder
//   /__gamesfun/events     live reload (Server-Sent Events): `game` when the game's files change, `studio` for the studio's
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson } from '../lib/games.mjs';
import { KIT_ROOT, SIGNAL_SERVER, STUDIO } from '../lib/paths.mjs';
const GF_WEB3 = path.join(KIT_ROOT, 'web3', 'gf-web3');
import { sendJson, sendText } from './http.mjs';
import { injectOnline, ONLINE_CLIENT, ONLINE_CLIENT_PATH, onlineFor } from './online.mjs';
import { createEvents, injectReload, RELOAD_CLIENT, watchTree } from './reload.mjs';
import { createRouter } from './router.mjs';
import { BASE_HEADERS, refuse } from './security.mjs';
import { serveStatic } from './static.mjs';

export const HOST = '127.0.0.1';
export const PREFERRED_PORTS = [5180, 5181, 5182, 5183, 5184, 5185, 5186, 5187, 5188, 5189];

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = e => { server.off('listening', onListen); reject(e); };
    const onListen = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(port, HOST);
  });
}

/**
 * Start serving one game. port: a number (exactly that one), or null (the first free of PREFERRED_PORTS, else any free
 * port). → { url, port, close(), router, events }
 */
export async function startDevServer({ gameDir, port = null, log = console.log, watch = true, routesDir = path.join(KIT_ROOT, 'server', 'routes'), env = process.env } = {}) {
  const gamesfun = await readJson(path.join(gameDir, 'gamesfun.json'), null);
  const network = process.env.GAMESFUN_NETWORK || gamesfun?.network || 'devnet';
  const events = createEvents();
  const router = createRouter({ log });
  let actualPort = 0;
  let sig = null, upgradeHandler = null;

  const server = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return sendText(res, 400, 'bad request'); }
    const api = url.pathname.startsWith('/api/') || url.pathname.startsWith('/signal');
    const no = refuse(req.headers, actualPort, { api });
    if (no) return sendText(res, no.status, no.reason);
    try {
      if (sig?.handleHttp(req, res)) return;                                      // POST /signal/v1, GET /signal/v1/ice
      if (url.pathname.startsWith('/api/')) {
        if (await router.handle(req, res, url)) return;
        return sendJson(res, 404, { error: `no route ${req.method} ${url.pathname}` });
      }
      if (url.pathname === '/') { res.writeHead(302, { ...BASE_HEADERS, location: '/studio/' }); return res.end(); }
      if (url.pathname === '/favicon.ico') { res.writeHead(204, BASE_HEADERS); return res.end(); }
      if (url.pathname === '/__gamesfun/events') return events.attach(req, res);
      if (url.pathname === '/__gamesfun/reload.js') return sendText(res, 200, RELOAD_CLIENT, 'text/javascript; charset=utf-8');
      if (url.pathname === ONLINE_CLIENT_PATH) return sendText(res, 200, ONLINE_CLIENT, 'text/javascript; charset=utf-8');
      if (url.pathname === '/studio' || url.pathname === '/game') { res.writeHead(301, { ...BASE_HEADERS, location: `${url.pathname}/${url.search}` }); return res.end(); }
      if (url.pathname.startsWith('/__gamesfun/gf-web3/')) return await serveStatic(req, res, { base: GF_WEB3, rest: url.pathname.slice('/__gamesfun/gf-web3'.length), mount: '/__gamesfun/gf-web3', search: url.search });
      if (url.pathname.startsWith('/studio/')) return await serveStatic(req, res, { base: STUDIO, rest: url.pathname.slice('/studio'.length), mount: '/studio', search: url.search });
      if (url.pathname.startsWith('/game/')) {
        return await serveStatic(req, res, {
          base: gameDir, rest: url.pathname.slice('/game'.length), mount: '/game', search: url.search,
          // the game's kit and the person's switch are read as each page is served: an upgrade or a new setting needs no restart of the game
          transform: async (file, buf, type) => (type.startsWith('text/html') ? injectOnline(injectReload(buf), await onlineFor(gameDir, env)) : buf),
        });
      }
      return sendText(res, 404, 'not found');
    } catch (e) {
      log(`dev server: ${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) sendText(res, 500, 'server error');
    }
  });
  // WebSocket upgrades (signaling at /signal) pass the same Host and Origin checks first
  server.on('upgrade', (req, socket, head) => {
    const no = refuse(req.headers, actualPort, { api: true });
    if (no || !upgradeHandler) { socket.write(`HTTP/1.1 ${no?.status ?? 404} ${no ? 'Refused' : 'Not Found'}\r\nConnection: close\r\n\r\n`); socket.destroy(); return; }
    upgradeHandler(req, socket, head);
  });

  // listen: the port asked for, else a preferred one, else any free one
  if (port != null) actualPort = await listen(server, Number(port));
  else {
    for (const p of [...PREFERRED_PORTS, 0]) {
      try { actualPort = await listen(server, p); break; } catch (e) { if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e; }
    }
  }
  const url = `http://${HOST}:${actualPort}/`;

  // signaling from the kits (gf-multiplayer's own server code): it registers its upgrade handler on this gate
  const { attachSignaling } = await import(pathToFileURL(SIGNAL_SERVER).href);
  const gate = { on: (e, fn) => { if (e === 'upgrade') upgradeHandler = fn; }, off: (e, fn) => { if (e === 'upgrade' && upgradeHandler === fn) upgradeHandler = null; } };
  sig = attachSignaling(gate, { path: '/signal', log: () => {} });

  const ctx = { gameDir, kitRoot: KIT_ROOT, network, log, url, events };
  await router.load(routesDir, ctx);

  const unwatch = [];
  if (watch) {
    unwatch.push(watchTree(gameDir, files => { events.send('game', { files }); }, { log }));
    unwatch.push(watchTree(STUDIO, files => { events.send('studio', { files }); }, { log }));
  }
  return {
    url, port: actualPort, router, events, ctx, signaling: sig,
    /** Where this game's friends join from: { use: 'online' | 'this-machine', host, own, kit, why } */
    online: () => onlineFor(gameDir, env),
    close: () => new Promise(resolve => {
      for (const u of unwatch) u();
      events.close(); sig.close();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

/** The studio's own version line (shown in the studio header). */
export async function kitsInfo() {
  const k = await readJson(path.join(KIT_ROOT, 'kits', 'KITS.json'), null);
  const pkg = JSON.parse(await readFile(path.join(KIT_ROOT, 'package.json'), 'utf8'));
  return { version: pkg.version, kits: k ? { commit: k.source?.commit, date: k.source?.date, gf3: k.kits?.['gf-three']?.version } : null };
}
