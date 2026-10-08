// Which game a CLI or MCP call means, and where the studio is, for the web3 commands and tools.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The kit's root folder (this file is web3/node/game-dir.mjs). */
export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const exists = async (p) => stat(p).then(() => true, () => false);
const isGame = async (dir) => (await exists(path.join(dir, 'index.html'))) || (await exists(path.join(dir, 'gamesfun.json')));

/**
 * The game folder: `--game`, else the current folder when it is a game, else the only game under games/.
 * Throws a plain message listing the games when it can't tell.
 */
export async function resolveGame(given, { kitRoot = KIT_ROOT, cwd = process.cwd() } = {}) {
  if (given) {
    const dir = path.resolve(cwd, given);
    if (!(await isGame(dir))) throw new Error(`${given} is not a game folder (no index.html or gamesfun.json).`);
    return dir;
  }
  if (await isGame(cwd)) return cwd;
  const gamesDir = path.join(kitRoot, 'games');
  const names = [];
  for (const entry of await readdir(gamesDir, { withFileTypes: true }).catch(() => [])) if (entry.isDirectory() && (await isGame(path.join(gamesDir, entry.name)))) names.push(entry.name);
  if (names.length === 1) return path.join(gamesDir, names[0]);
  if (!names.length) throw new Error('No game found. Make one with `npx gamesfun create games/<name>`, or pass --game <folder>.');
  throw new Error(`Which game? Pass --game with one of: ${names.map((n) => `games/${n}`).join(', ')}.`);
}

/**
 * Where the studio is for a tab, when `gamesfun dev` is running: GAMESFUN_DEV_URL, else the URL or port the dev
 * server records in .gamesfun/dev.json. Null when it is not known (the dev server is not running).
 */
export async function studioUrl(tab, { kitRoot = KIT_ROOT, env = process.env } = {}) {
  let base = env.GAMESFUN_DEV_URL ?? null;
  if (!base) {
    try {
      const dev = JSON.parse(await readFile(path.join(kitRoot, '.gamesfun', 'dev.json'), 'utf8'));
      base = dev.url ?? (dev.port ? `http://127.0.0.1:${dev.port}/` : null);
    } catch {}
  }
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('tab', tab);
  return url.toString();
}
