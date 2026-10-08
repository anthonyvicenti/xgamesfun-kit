// The asset-manifest validator (verify check 1) fails any .md, .json, image or model file in a game that no slot
// covers and assets.json does not ignore. gf-three writes a fixed ignore list, so the files this kit adds to a game
// for coding agents (AGENTS.md, CLAUDE.md, .claude/, .agents/) and their scratch files would fail check 1.
// After gf-three writes assets.json (create, slots --write, upgrade), these entries are added to its `ignore`.
// Upstream fix (docs/DEVELOPING.md): gf-three could ignore agent guide files, or keep an existing manifest's extra
// ignore entries the way it keeps its sound list.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const KIT_IGNORES = [
  { path: 'AGENTS.md', reason: 'the game\'s guide for coding agents (gamesfun-kit), not a game asset' },
  { path: 'CLAUDE.md', reason: 'imports AGENTS.md for Claude Code (gamesfun-kit), not a game asset' },
  { path: '.claude/**', reason: 'coding-agent settings and skills, not game assets' },
  { path: '.agents/**', reason: 'coding-agent skills, not game assets' },
  { path: 'scratch/**', reason: 'an agent\'s and a play-tester\'s scratch files, not game assets' },
];

/** The manifest with the kit's ignore entries present (in order, once each). Pure. */
export function withKitIgnores(manifest) {
  const ignore = Array.isArray(manifest.ignore) ? [...manifest.ignore] : [];
  for (const e of KIT_IGNORES) if (!ignore.some(x => x?.path === e.path)) ignore.push({ ...e });
  return { ...manifest, ignore };
}

/** Add the entries to <game>/assets.json in place (gf-three's formatting: two spaces, trailing newline). → changed */
export async function addKitIgnores(gameDir) {
  const file = path.join(gameDir, 'assets.json');
  const text = await readFile(file, 'utf8');
  const next = JSON.stringify(withKitIgnores(JSON.parse(text)), null, 2) + '\n';
  if (next === text) return false;
  await writeFile(file, next);
  return true;
}
