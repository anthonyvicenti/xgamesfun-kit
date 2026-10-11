#!/usr/bin/env node
// Character bench server: node research/gf-three/character-bench/serve.mjs [--port 5792]
// Serves research/gf-three/ as the site root (so /kit/... and /library/... are the dev sources), plus:
//   */vendor/three/build/*, */vendor/three/examples/jsm/*, */vendor/rapier/*   the pinned copies (README "Pinned")
//   /gf-assets.js                                                             gf-assets 1.3.0 (what kit/assets imports as ../../gf-assets.js)
//   /character-bench/assets/models/body-player.glb                            the library's default body (bodies.json "default")
//   /character-bench/assets/bodies/<id>.glb, /character-bench/assets/clips/*  library files
import { isMain } from '../tools/lib/main.mjs';
import http from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GF3 = resolve(here, '..');
const REPO = resolve(GF3, '../..');
const T = join(REPO, 'research/foundations/trials');
const VENDOR = {
  threeBuild: join(T, 'fps-arena/source/vendor/three'),
  threeAddons: [join(GF3, 'tools/lib/vendor/three'), join(T, 'fps-arena/source/vendor/three'), join(T, 'third-person-adventure/source/vendor/three')],
  rapier: join(T, 'third-person-adventure/source/vendor/rapier'),
};
const GF_ASSETS = join(REPO, 'research/foundations/kits/gf-assets/1.3.0/source/gf-assets.js');
const LIB = join(GF3, 'library');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.svg': 'image/svg+xml' };

function route(path) {
  let m;
  if ((m = path.match(/\/vendor\/three\/build\/(.+)$/))) return join(VENDOR.threeBuild, 'build', m[1]);
  if ((m = path.match(/\/vendor\/three\/examples\/jsm\/(.+)$/))) return VENDOR.threeAddons.map(d => join(d, 'examples/jsm', m[1])).find(existsSync);
  if ((m = path.match(/\/vendor\/rapier\/(.+)$/))) return join(VENDOR.rapier, m[1]);
  if (/(^|\/)gf-assets\.js$/.test(path) && !path.startsWith('/kit/')) return GF_ASSETS;
  if (path === '/character-bench/assets/models/body-player.glb') {
    const lib = JSON.parse(readFileSync(join(LIB, 'bodies.json'), 'utf8'));
    return join(LIB, lib.bodies.find(b => b.id === lib.default).file);
  }
  if ((m = path.match(/^\/character-bench\/assets\/bodies\/([a-z0-9_-]+)\.glb$/))) return join(LIB, 'bodies', `${m[1]}.glb`);
  if ((m = path.match(/^\/character-bench\/assets\/clips\/([a-z0-9_.-]+\.glb)$/))) return join(LIB, 'clips', m[1]);
  return join(GF3, path);
}

export function serve(port = 5792) {
  const srv = http.createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/' || path === '/character-bench') { res.writeHead(302, { location: '/character-bench/' }); return res.end(); }
    if (path.endsWith('/')) path += 'index.html';
    const file = route(path);
    if (!file || !resolve(file).startsWith(REPO) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => srv.listen(port, '127.0.0.1', () => ok(srv)));
}

if (isMain(import.meta)) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? +process.argv[i + 1] : 5792;
  await serve(port);
  console.log(`character bench: http://127.0.0.1:${port}/character-bench/`);
}
