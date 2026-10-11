// kits/ is exactly the snapshot KITS.json records, holds no secrets or left-out assets, and is portable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { KITS, KITS_JSON } from '../lib/paths.mjs';
import { tempDir } from './helpers.mjs';
import { buildSnapshot, closureProblems, diffKits, findSource, kitsRecord, LEFT_OUT, LIBRARIES, libraryDecision, licenceOfText, portabilityProblems, scanSecrets, TOOL_FAULTS } from '../scripts/sync-kits.mjs';

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
  assert.equal(record.schema, 'gamesfun-kits/2');
  assert.match(record.source.commit, /^[0-9a-f]{40}$/);
  for (const k of ['gf-three', 'gf-scenic', 'gf-multiplayer', 'gf-audio', 'gf-assets']) assert.ok(record.kits[k]?.version, `${k} version`);
  // the versions are the ones the tools in kits/ ask for (read from their code), and each kit folder is there
  const mp = /export const KIT_VERSION = '([^']+)'/.exec(readFileSync(path.join(KITS, 'research/multiplayer/party/manifest.mjs'), 'utf8'))[1];
  assert.equal(record.kits['gf-multiplayer'].version, mp);
  for (const k of ['gf-multiplayer', 'gf-audio', 'gf-assets']) {
    assert.ok(record.kits[k].path.endsWith(`/${record.kits[k].version}`), `${k} path names its version`);
    assert.ok(Object.keys(record.files).some(f => f.startsWith(record.kits[k].path + '/')), `${k} ${record.kits[k].version} is in kits/`);
  }
  assert.equal(record.totals.files, Object.keys(record.files).length);
});

test('nothing left out by policy is in kits/', () => {
  const rels = Object.keys(record.files);
  for (const rel of rels) {
    assert.ok(!/(^|\/)(node_modules|evidence|regressions|sandbox|lookdev|\.cache)\//.test(rel), `${rel} is in a left-out folder`);
    assert.ok(!/(^|\/)\.env(\.|$)/.test(rel), `${rel} is a .env file`);
    assert.ok(!/^research\/gf-(three|scenic)\/library\/(.*\/)?meshy-/.test(rel), `${rel} is Meshy output or its ledger`);
  }
});

test('the parts this package leaves out are not in kits/ (the forge engine: only what a recorded tool fault needs)', () => {
  const allowed = new Set();
  // a tool fault's file and the modules beside it that it imports
  for (const x of TOOL_FAULTS) for (const rel of Object.keys(record.files)) if (path.posix.dirname(rel) === path.posix.dirname(x.imports)) allowed.add(rel);
  for (const rel of Object.keys(record.files)) {
    const out = LEFT_OUT.find(p => rel === p.path || rel.startsWith(p.path + '/'));
    if (out) assert.ok(allowed.has(rel), `${rel} is in a left-out part (${out.why})`);
  }
  assert.ok(!Object.keys(record.files).some(f => /\.wasm$/.test(f) && f.includes('gf-forge')), 'no forge wasm');
});

test('every library asset in kits/ has a CC0 or permissive licence record (or is games.fun\'s own)', async () => {
  for (const root of LIBRARIES) {
    const lib = `${root}/`;
    const licences = JSON.parse(await readFile(path.join(KITS, ...`${lib}LICENSES.json`.split('/')), 'utf8')).files;
    const licenceFile = rel => { try { return licenceOfText(readFileSync(path.join(KITS, ...`${lib}${path.posix.dirname(rel)}/LICENSE`.split('/')), 'utf8')); } catch { return null; } };
    const mine = Object.keys(record.files).filter(r => r.startsWith(lib));
    assert.ok(mine.length > 10, `${root} is in kits/`);
    for (const rel of mine) {
      const inLib = rel.slice(lib.length);
      if (/\/LICENSE$/.test(inLib)) continue;   // a licence text itself
      const d = libraryDecision(inLib, licences, () => null, licenceFile);
      assert.ok(d.keep, `${rel}: ${d.why}`);
    }
  }
});

test('no key-shaped strings anywhere in kits/', async () => {
  const hits = [];
  for (const [rel, buf] of await loadKitFiles()) hits.push(...scanSecrets(rel, buf));
  assert.deepEqual(hits, []);
});

test('every relative import in the Node tooling resolves inside kits/', async () => {
  assert.deepEqual(closureProblems(await loadKitFiles(), record.browserRoots), []);
});

// The drift test's own proof: a copy of kits/ with one byte changed, one file added and one removed is reported.
test('a kit file changed, added or removed by hand is reported', async () => {
  const t = await tempDir('gamesfun-kits-');
  try {
    const copy = path.join(t.dir, 'kits');
    await cp(KITS, copy, { recursive: true, filter: src => path.basename(src) !== 'node_modules' });
    assert.equal((await diffKits(record, copy)).ok, true, 'an exact copy matches');
    const edited = 'research/gf-three/kit/core/boot.js', removed = 'research/gf-three/CONTRACT.md';
    await writeFile(path.join(copy, ...edited.split('/')), Buffer.concat([await readFile(path.join(copy, ...edited.split('/'))), Buffer.from('\n')]));
    await rm(path.join(copy, ...removed.split('/')));
    await writeFile(path.join(copy, 'research', 'gf-three', 'note.txt'), 'by hand');
    const d = await diffKits(record, copy);
    assert.equal(d.ok, false);
    assert.deepEqual(d.changed, [edited]);
    assert.deepEqual(d.missing, [removed]);
    assert.deepEqual(d.extra, ['research/gf-three/note.txt']);
  } finally { await t.cleanup(); }
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

// What the script would write: needs a games.fun checkout holding the recorded commit (maintainers; skipped elsewhere,
// e.g. CI, where the byte-for-byte test above still holds kits/ to KITS.json).
const source = findSource();
const hasCommit = source && spawnSync('git', ['-C', source, 'cat-file', '-e', `${record.source.commit}^{commit}`]).status === 0;
test('kits/ is what the script writes from the recorded commit (file for file, and the same KITS.json)', { skip: hasCommit ? false : 'no games.fun checkout with the recorded commit (set GAMESFUN_REPO)' }, async () => {
  const snap = await buildSnapshot(source, record.source.commit);
  assert.deepEqual(snap.problems, []);
  assert.equal(JSON.stringify(kitsRecord(snap)), JSON.stringify(record));
  const d = await diffKits(kitsRecord(snap));
  assert.deepEqual([d.missing, d.changed, d.extra], [[], [], []]);
});
