// /api/editors/…: what the map, skin and item editors need beyond the slot routes. Nothing here writes a game file in
// a way the slot routes could not: the map save IS a slot write (lib/slots setValue on world.map, the same function
// POST /api/game/slots/value calls), followed by the kit's own rewrite of what is derived from the map
// (tools/flat-map.mjs sync: config/world.json → spawns and half). The rest only reads the kit's library.
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GF3, GF3_LIBRARY, GF3_TOOLS } from '../../lib/paths.mjs';
import { findSlot, setValue } from '../../lib/slots.mjs';
import { BASE_HEADERS } from '../security.mjs';
import { HttpError, openGame, readJson } from '../http.mjs';

const FOLDERS = new Set(['bodies', 'props']);
const NAME = /^[a-z0-9][a-z0-9-]*\.(glb|preview\.jpg)$/;
const TYPES = { glb: 'model/gltf-binary', jpg: 'image/jpeg' };
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const kitModule = rel => import(pathToFileURL(path.join(GF3, rel)).href);

export default function register(router, ctx) {
  // the open game, read at each request: the studio may open another while the server runs (server/index.mjs)
  const G = () => openGame(ctx);

  // the library's bodies, each with its picture, and which one the game's body slot holds now (by its bytes)
  router.get('/bodies', async () => {
    const lib = await json(path.join(GF3_LIBRARY, 'bodies.json'));
    const list = Array.isArray(lib) ? lib : lib.bodies ?? [];
    let current = null, file = null;
    try { const s = await findSlot(G(), `character.body.${ctxRole(ctx)}`); file = s.source?.file; } catch {}
    if (file && file.endsWith('.glb')) {
      try {
        const mine = createHash('sha256').update(await readFile(path.join(G(), file))).digest('hex');
        for (const b of list) {
          try { if (createHash('sha256').update(await readFile(path.join(GF3_LIBRARY, b.file))).digest('hex') === mine) { current = b.id; break; } } catch {}
        }
      } catch {}
    }
    const out = [];
    for (const b of list) {
      const id = b.id, pic = path.join(GF3_LIBRARY, 'bodies', `${id}.preview.jpg`);
      let preview = null; try { await stat(pic); preview = `/api/editors/library/bodies/${id}.preview.jpg`; } catch {}
      out.push({ id, label: b.label ?? id, describe: b.describe ?? '', height: b.height ?? null, tags: b.tags ?? [], playerColour: b.playerColour ?? true, license: b.license ?? null, file: `/api/editors/library/bodies/${path.basename(b.file)}`, preview });
    }
    return { bodies: out, current, slotFile: file };
  });

  // a library file (a body or prop model, or its picture): read-only, by name, inside the library
  router.get('/library/:folder/:file', async (req, res, { folder, file }) => {
    if (!FOLDERS.has(folder) || !NAME.test(file)) throw new HttpError(404, 'no such library file');
    const full = path.join(GF3_LIBRARY, folder, file);
    let st; try { st = await stat(full); } catch { throw new HttpError(404, 'no such library file'); }
    res.writeHead(200, { ...BASE_HEADERS, 'content-type': TYPES[file.split('.').pop()] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'max-age=300' });
    createReadStream(full).pipe(res);
  });

  // the footprint of each library prop (metres, [w, h, d]): the layout editor draws props at their real size
  router.get('/props', async () => {
    const lib = await json(path.join(GF3_LIBRARY, 'props.json'));
    const list = Array.isArray(lib) ? lib : lib.props ?? Object.values(lib);
    const sizes = {};
    for (const p of list) if (p?.id && Array.isArray(p.size)) sizes[p.id] = p.size;
    return { sizes };
  });

  // the map: checked by the kit's own flat part, written through its slot, then the derived list rewritten by the kit
  router.post('/map', async req => {
    const { map } = await readJson(req, { limit: 512 * 1024 });
    if (!map || typeof map !== 'object') throw new HttpError(400, 'map is required');
    const slot = await findSlot(G(), 'world.map').catch(() => null);
    if (!slot) throw new HttpError(400, 'this game has no tile map (no world.map slot)');
    const { readMap, reachOf, jumpReach } = await kitModule('kit/flat/tilemap.js');
    const { SIDE } = await kitModule('kit/flat/slots.js');
    const M = readMap(map);
    if (!M.ok) throw new HttpError(400, `the map has problems: ${M.problems.join('; ')}`);
    if (M.side) {
      const game = await json(path.join(G(), 'config', 'game.json')).catch(() => ({}));
      const C = game.controller ?? {};
      const reach = reachOf(M, jumpReach({ gravity: game.gravity ?? 20, jump: C.jump ?? SIDE.jump, speed: C.speed ?? SIDE.speed, fallScale: SIDE.fallScale }));
      if (reach.problems.length) throw new HttpError(400, `out of reach: ${reach.problems.join('; ')}`);
    }
    const wrote = await setValue(G(), 'world.map', map);
    const derived = await syncDerived(G());
    return { id: wrote.id, file: wrote.file, cols: M.cols, rows: M.rows, spawns: M.spawns.length, derived };
  });
}

/**
 * What is derived from the map, written again (config/world.json → spawns and half): games.fun's
 * tools/flat-map.mjs --sync does exactly this, but sync-kits does not carry that tool yet (a request in the findings),
 * so the same three lines run here on the kit's own spawnsOf. Once the tool is in kits/, call its sync instead.
 */
async function syncDerived(gameDir) {
  const tool = path.join(GF3_TOOLS, 'flat-map.mjs');
  try { await stat(tool); return (await import(pathToFileURL(tool).href)).sync(gameDir); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  const { readMap } = await kitModule('kit/flat/tilemap.js');
  const { spawnsOf } = await kitModule('kit/flat/index.js');
  const file = path.join(gameDir, 'config', 'world.json'), world = await json(file), M = readMap(world.map);
  const next = { ...world, spawns: spawnsOf(world.map), half: Math.round((M.cols * M.tile) / 2) };
  if (JSON.stringify(next) === JSON.stringify(world)) return [];
  await writeFile(file, `${JSON.stringify(next, null, 1)}\n`);
  return ['config/world.json'];
}

// the role whose body the skin editor edits: the player (every game has one; other roles are a next step)
const ctxRole = () => 'player';
