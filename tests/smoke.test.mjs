// The whole path in a real browser (slow: about 3 minutes, needs Chrome or downloads Chromium). Runs when
// GAMESFUN_SMOKE=1 (npm run test:smoke sets nothing; CI sets it): create from the example, quick verify through the CLI
// (it must pass), then the dev server with two pages that must each see the other player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BIN, KIT_ROOT } from '../lib/paths.mjs';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';
import { twoPlayers } from './two-players.mjs';

const on = process.env.GAMESFUN_SMOKE === '1';

test('create from the example, quick verify passes, and two pages see each other', { skip: on ? false : 'set GAMESFUN_SMOKE=1 to run (about 3 minutes)', timeout: 15 * 60 * 1000 }, async () => {
  const g = await tempGame('soak-squad');
  try {
    const code = await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [BIN, 'verify', g.dir, '--quick'], { cwd: KIT_ROOT, stdio: 'inherit' });
      c.on('error', reject); c.on('close', resolve);
    });
    const runs = (await readdir(path.join(g.dir, 'evidence'))).filter(n => /^verify-\d+$/.test(n)).sort();
    const verdict = JSON.parse(await readFile(path.join(g.dir, 'evidence', runs.at(-1), 'verdict.json'), 'utf8'));
    const failed = verdict.checks.filter(c => c.ok === false).map(c => `${c.n} ${c.name}: ${c.detail}`);
    assert.deepEqual(failed, [], 'no check failed');
    assert.equal(verdict.pass, true);
    assert.equal(code, 0);

    const srv = await startDevServer({ gameDir: g.dir, port: 0, log: () => {}, watch: false });
    try {
      const r = await twoPlayers(srv.url, { seconds: 8 });
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally { await srv.close(); }
  } finally { await g.cleanup(); }
});
