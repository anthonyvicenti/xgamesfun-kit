// kits/ is exactly the snapshot KITS.json records, holds no secrets or left-out assets, and is portable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { KITS, KITS_JSON } from '../lib/paths.mjs';
import { buildSnapshot, closureProblems, diffKits, findSource, kitsRecord, libraryDecision, portabilityProblems, scanSecrets } from '../scripts/sync-kits.mjs';

const record = JSON.parse(await readFile(KITS_JSON, 'utf8'));

async function loadKitFiles() {
  const files = new Map();
  for (const rel of Object.keys(record.files)) files.set(rel, await readFile(path.join(KITS, ...rel.split('/'))));
  return files;
}

test('kits/ matches KITS.json byte for byte, with nothing extra', async () => {
  const d = await diffKits(record);
  assert.deepEqual(d.missing, [], 'files KITS.json lists but kits/ lacks');
  assert.deepEqual(d.changed, [], 'files edited after the sync (never edit kits/: fix in games.fun and sync)');
  assert.deepEqual(d.extra, [], 'files in kits/ that KITS.json does not list');
});

test('KITS.json records the source commit and the kits', () => {
  assert.equal(record.schema, 'gamesfun-kits/1');
  assert.match(record.source.commit, /^[0-9a-f]{40}$/);
  for (const k of ['gf-three', 'gf-multiplayer', 'gf-audio', 'gf-assets']) assert.ok(record.kits[k]?.version, `${k} version`);
  assert.equal(record.kits['gf-multiplayer'].version, '1.3.0');
  assert.equal(record.kits['gf-audio'].version, '1.5.0');
  assert.equal(record.totals.files, Object.keys(record.files).length);
});

test('nothing left out by policy is in kits/', () => {
  const rels = Object.keys(record.files);
  for (const rel of rels) {
    assert.ok(!/(^|\/)(node_modules|evidence|regressions|sandbox|lookdev|character-bench|\.cache)\//.test(rel), `${rel} is in a left-out folder`);
    assert.ok(!/(^|\/)\.env(\.|$)/.test(rel), `${rel} is a .env file`);
    assert.ok(!/^research\/gf-three\/library\/(.*\/)?meshy-/.test(rel), `${rel} is Meshy output or its ledger`);
  }
});

test('every library asset in kits/ has a CC0 or permissive licence record (or is games.fun\'s own)', async () => {
  const lib = 'research/gf-three/library/';
  const licences = JSON.parse(await readFile(path.join(KITS, ...`${lib}LICENSES.json`.split('/')), 'utf8')).files;
  for (const rel of Object.keys(record.files).filter(r => r.startsWith(lib))) {
    const d = libraryDecision(rel.slice(lib.length), licences, () => null);
    assert.ok(d.keep, `${rel}: ${d.why}`);
  }
});

test('no key-shaped strings anywhere in kits/', async () => {
  const hits = [];
  for (const [rel, buf] of await loadKitFiles()) hits.push(...scanSecrets(rel, buf));
  assert.deepEqual(hits, []);
});

test('every relative import in the Node tooling resolves inside kits/', async () => {
  assert.deepEqual(closureProblems(await loadKitFiles()), []);
});

test('kit paths are safe on Windows and macOS (length, case, device names)', () => {
  assert.deepEqual(portabilityProblems(Object.keys(record.files)), []);
});

test('no symlinks in kits/', async () => {
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      assert.ok(!e.isSymbolicLink(), `${path.join(dir, e.name)} is a symlink`);
      if (e.isDirectory() && e.name !== 'node_modules') await walk(path.join(dir, e.name));
    }
  };
  await walk(KITS);
});

// Reproducibility: needs a games.fun checkout holding the recorded commit (maintainers; skipped elsewhere, e.g. CI).
const source = findSource();
const hasCommit = source && spawnSync('git', ['-C', source, 'cat-file', '-e', `${record.source.commit}^{commit}`]).status === 0;
test('the recorded commit rebuilds the same snapshot', { skip: hasCommit ? false : 'no games.fun checkout with the recorded commit (set GAMESFUN_REPO)' }, async () => {
  const snap = await buildSnapshot(source, record.source.commit);
  assert.deepEqual(snap.problems, []);
  assert.equal(JSON.stringify(kitsRecord(snap)), JSON.stringify(record));
});
