// A stand-in for core's `gamesfun dev`, for web3 tests and the devnet proof only: it serves the studio tabs and the
// web3 kit files, mounts server/routes/web3.mjs under /api/web3 the way docs/ARCHITECTURE.md describes, and serves
// one game folder under /game/ (with a page that loads gf-web3). Core's real dev server replaces all of this.
//   node tests/web3/harness/server.mjs --game <game folder> [--port 5300]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import register from '../../../server/routes/web3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, '..', '..', '..');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

async function staticFile(res, root, rel) {
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
  return true;
}

export async function startHarness({ gameDir, port = 0, kitRoot: stateRoot = kitRoot, extra = {} }) {
  const table = [];
  const router = {
    get: (p, h) => table.push({ method: 'GET', path: `/api/web3${p}`, handler: h }),
    post: (p, h) => table.push({ method: 'POST', path: `/api/web3${p}`, handler: h }),
  };
  register(router, { gameDir, kitRoot: stateRoot, log: (m) => console.error(m), ...extra });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = table.find((r) => r.path === url.pathname && r.method === req.method);
    if (route) return route.handler(req, res, {});
    if (url.pathname.startsWith('/api/web3/')) return void (res.writeHead(404), res.end());
    if (req.method !== 'GET') return void (res.writeHead(405), res.end());
    if (url.pathname === '/' || url.pathname === '/studio/') return void (await staticFile(res, here, 'studio.html'));
    if (url.pathname === '/game/' || url.pathname === '/game/index.html') return void (await staticFile(res, here, 'game.html'));
    if (url.pathname.startsWith('/game/') && (await staticFile(res, path.resolve(gameDir), decodeURIComponent(url.pathname.slice(6))))) return;
    if (/^\/(studio|web3)\//.test(url.pathname) && (await staticFile(res, kitRoot, decodeURIComponent(url.pathname.slice(1))))) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  return { port: actual, url: `http://127.0.0.1:${actual}/`, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const gameDir = arg('game');
  if (!gameDir) throw new Error('usage: node tests/web3/harness/server.mjs --game <game folder> [--port 5300]');
  const h = await startHarness({ gameDir: path.resolve(gameDir), port: Number(arg('port', 5300)) });
  console.log(`studio harness: ${h.url}   game: ${h.url}game/`);
}
