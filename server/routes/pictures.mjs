// /api/pictures/…: the start page's card pictures, read only. A game's picture is the best screenshot of its newest
// verify run that has one (<game>/evidence/verify-N/*.jpg|png); an example's is its own picture if the kit ships one
// (templates/examples/<id>/picture|cover|preview.png|jpg|webp). With none, the page draws a title card from the
// colours this route reads (config/characters.json palette, config/look.json background).
//   GET /                  → { games: { <name>: { picture: url|null, colours: [] } }, examples: { <id>: { picture } } }
//   GET /game/:name        → the game's picture (image bytes), 404 when it has none
//   GET /example/:id       → the example's picture, 404 when it has none
// Only names from the folder listings are served: a game name must be a folder under games/ (gameFolder's rule), an
// example id one listExamples knows, and the file a regular file (not a link) found by listing that folder, inside it.
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { listExamples } from '../../lib/examples.mjs';
import { isGame, readJson } from '../../lib/games.mjs';
import { HttpError } from '../http.mjs';
import { gameFolder } from '../index.mjs';
import { BASE_HEADERS } from '../security.mjs';

const IMAGE = /\.(png|jpe?g|webp)$/i;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
/** Screenshot names that show the game being played, best first; then anything but menus, lobbies and error pages. */
const BEST = [/playing/, /first-look/, /round/, /hud/, /look/, /host-sees/, /world/];
const NOT = /(no-webgpu|no-webgl|error|blank|menu|friends-0[1-5]|home|waiting|lobby|results|pause|settings)/;

/** A verify run's file names → the one to show, or null. Pure (tested). */
export function pickShot(files) {
  const pics = files.filter(f => IMAGE.test(f) && !f.startsWith('.')).sort();
  for (const re of BEST) { const hit = pics.find(f => re.test(f) && !/no-web/.test(f)); if (hit) return hit; }
  return pics.find(f => !NOT.test(f)) ?? null;
}

/** A regular file directly in dir (no link, no folder), inside dir after links are resolved: → its path, or null. */
async function fileIn(dir, name) {
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  const file = path.join(dir, name);
  try {
    const st = await lstat(file);
    if (!st.isFile()) return null;
    const [real, root] = await Promise.all([realpath(file), realpath(dir)]);
    return path.dirname(real) === root ? file : null;
  } catch { return null; }
}

/** <game>/evidence/verify-N → { file, run } for the newest run with a picture, or null. */
export async function gamePicture(dir) {
  const ev = path.join(dir, 'evidence');
  let runs = [];
  try { runs = (await readdir(ev, { withFileTypes: true })).filter(e => e.isDirectory() && /^verify-\d+$/.test(e.name)).map(e => e.name).sort((a, b) => Number(b.slice(7)) - Number(a.slice(7))); } catch { return null; }
  for (const run of runs.slice(0, 20)) {
    let files = [];
    try { files = await readdir(path.join(ev, run)); } catch { continue; }
    const pick = pickShot(files);
    const file = pick ? await fileIn(path.join(ev, run), pick) : null;
    if (file) return { file, run };
  }
  return null;
}

/** templates/examples/<id>/ → its own picture, or null. */
export async function examplePicture(dir) {
  let files = [];
  try { files = await readdir(dir); } catch { return null; }
  for (const stem of ['picture', 'cover', 'preview', 'thumbnail']) {
    const name = files.find(f => IMAGE.test(f) && f.toLowerCase().replace(/\.[^.]+$/, '') === stem);
    const file = name ? await fileIn(dir, name) : null;
    if (file) return file;
  }
  return null;
}

/** A game's own colours: its player palette and its sky, as #hex strings (the page checks them again). */
async function coloursOf(dir) {
  const ch = await readJson(path.join(dir, 'config', 'characters.json'), {});
  const look = await readJson(path.join(dir, 'config', 'look.json'), {});
  return [...(Array.isArray(ch.palette) ? ch.palette : []), look.values?.background].filter(c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 6);
}

async function sendImage(res, file) {
  const buf = await readFile(file);
  // the URL names the verify run (?v=), so a short private cache is safe and keeps the start page from refetching
  res.writeHead(200, { ...BASE_HEADERS, 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=300' });
  res.end(buf);
}

export default function register(router, ctx = {}) {
  const root = () => ctx.gamesRoot;
  const folder = name => { try { return gameFolder(root(), name); } catch { throw new HttpError(400, 'not a game name'); } };

  router.get('/', async () => {
    const games = {}, examples = {};
    let names = [];
    try { names = (await readdir(root(), { withFileTypes: true })).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name); } catch {}
    for (const name of names) {
      let dir;
      try { dir = gameFolder(root(), name); } catch { continue; }
      const pic = await gamePicture(dir);
      games[name] = { picture: pic ? `/api/pictures/game/${encodeURIComponent(name)}?v=${pic.run}` : null, colours: isGame(dir) ? await coloursOf(dir) : [] };
    }
    for (const ex of await listExamples()) {
      const pic = await examplePicture(ex.dir);
      examples[ex.id] = { picture: pic ? `/api/pictures/example/${encodeURIComponent(ex.id)}` : null };
    }
    return { games, examples };
  });

  router.get('/game/:name', async (req, res, { name }) => {
    const pic = await gamePicture(folder(name));
    if (!pic) throw new HttpError(404, 'this game has no screenshot yet');
    await sendImage(res, pic.file);
  });

  router.get('/example/:id', async (req, res, { id }) => {
    const ex = (await listExamples()).find(e => e.id === id);
    if (!ex) throw new HttpError(404, 'no such example');
    const file = await examplePicture(ex.dir);
    if (!file) throw new HttpError(404, 'this example has no picture');
    await sendImage(res, file);
  });
}
