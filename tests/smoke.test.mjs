// The whole path in a real browser (slow: about 4 minutes an example, needs Chrome or downloads Chromium). Runs when
// GAMESFUN_SMOKE=1 (npm run test:smoke sets nothing; CI sets it): for every example, create from it, quick verify
// through the CLI (it must pass), then the dev server with two pages that must each see the other player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BIN, EXAMPLES, KIT_ROOT } from '../lib/paths.mjs';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';
import { twoPlayers } from './two-players.mjs';

const on = process.env.GAMESFUN_SMOKE === '1';
const examples = (await readdir(EXAMPLES, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();

// one test per example (one per engine: the party example on WebGL, the scenic one on WebGPU or WebGL2, the vista one
// on WebGPU only, so it fails on a machine without a hardware WebGPU adapter)
for (const id of examples) {
  test(`${id}: create from the example, quick verify passes, and two pages see each other`, { skip: on ? false : 'set GAMESFUN_SMOKE=1 to run (about 4 minutes an example)', timeout: 20 * 60 * 1000 }, async () => {
    const g = await tempGame(id);
    try {
      const code = await new Promise((resolve, reject) => {
        const c = spawn(process.execPath, [BIN, 'verify', g.dir, '--quick'], { cwd: KIT_ROOT, stdio: 'inherit' });
        c.on('error', reject); c.on('close', resolve);
      });
      const runs = (await readdir(path.join(g.dir, 'evidence'))).filter(n => /^verify-\d+$/.test(n)).sort();
      const verdict = JSON.parse(await readFile(path.join(g.dir, 'evidence', runs.at(-1), 'verdict.json'), 'utf8'));
      // example.json → knownFailing: checks a kit fault fails today (the example's README says which and why). The
      // verdict must fail exactly those, so the entry is deleted the day the kit is fixed.
      const known = JSON.parse(await readFile(path.join(EXAMPLES, id, 'example.json'), 'utf8')).knownFailing ?? [];
      const failed = verdict.checks.filter(c => c.ok === false);
      assert.deepEqual(failed.filter(c => !known.includes(c.n)).map(c => `${c.n} ${c.name}: ${c.detail}`), [], 'no check failed that is not a known kit fault');
      assert.deepEqual(known.filter(n => !failed.some(c => c.n === n)), [], 'a known failing check passes now: delete it from example.json → knownFailing');
      assert.equal(verdict.pass, known.length === 0);
      assert.equal(code, known.length ? 1 : 0);

      const srv = await startDevServer({ gameDir: g.dir, port: 0, log: () => {}, watch: false });
      try {
        // a vista game draws only with WebGPU (no WebGL path): its two pages open in the kit's WebGPU launch
        const engine = JSON.parse(await readFile(path.join(EXAMPLES, id, 'spec.json'), 'utf8')).engine;
        const r = await twoPlayers(srv.url, { seconds: 8, gpu: engine === 'vista' ? 'webgpu' : null });
        assert.equal(r.ok, true, JSON.stringify(r));
      } finally { await srv.close(); }
    } finally { await g.cleanup(); }
  });
}
