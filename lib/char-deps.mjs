// gf-three's 3D tools (rig-check, meshy-*, optimize) need npm packages of their own (gltf-transform, meshoptimizer,
// sharp), pinned in kits/research/gf-three/tools/lib/char-deps/package.json and loaded from the node_modules beside it.
// They are installed there on first use (git-ignored; the snapshot itself is never changed).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GF3_TOOLS } from './paths.mjs';

export const CHAR_DEPS = path.join(GF3_TOOLS, 'lib', 'char-deps');

/** npm's own CLI script, run with this Node (no shell: npm.cmd can't be spawned directly on Windows). */
export function npmCli() {
  const cands = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  return cands.find(p => p && /npm-cli\.js$/.test(p) && existsSync(p)) ?? null;
}

export function ensureCharDeps({ log = m => console.error(m) } = {}) {
  if (existsSync(path.join(CHAR_DEPS, 'node_modules'))) return;
  const cli = npmCli();
  if (!cli) throw new Error(`the 3D tools need their npm packages. Run: npm ci --prefix "${CHAR_DEPS}"`);
  log('gamesfun: installing the 3D tools\' packages once (gltf-transform, meshoptimizer, sharp)…');
  const r = spawnSync(process.execPath, [cli, 'ci', '--no-audit', '--no-fund'], { cwd: CHAR_DEPS, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) throw new Error(`npm ci in ${CHAR_DEPS} failed (exit ${r.status})`);
}
