// The sync's policy, on made-up inputs: the licence filter, the secret scan, name exclusions and portability rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excludedByName, libraryDecision, portabilityProblems, scanSecrets } from '../scripts/sync-kits.mjs';

const LIC = {
  'props/tree.glb': { spdx: 'CC0-1.0', author: 'Kenney (www.kenney.nl)', from: 'kenney:nature/tree' },
  'props/slide.glb': { spdx: 'CC-BY-3.0', author: 'Poly by Google', credit: '"Slide" by Poly by Google, CC BY 3.0' },
  'props/sa.glb': { spdx: 'CC-BY-SA-4.0', author: 'someone' },
  'props/nc.glb': { spdx: 'CC-BY-NC-4.0', author: 'someone' },
  'bodies/meshy-gecko.glb': { spdx: 'CC-BY-4.0', author: 'Meshy AI (generated for games.fun)' },
  'bodies/robot.glb': { spdx: 'CC-BY-4.0', title: 'Robot (Meshy)', author: 'x' },
  'bodies/bean.glb': { spdx: 'CC0-1.0', author: 'games.fun' },
  'bodies/bean.preview.jpg': { spdx: null, generated: true, author: 'games.fun', of: 'bodies/bean.glb' },
  'bodies/meshy-gecko.preview.jpg': { spdx: null, generated: true, author: 'games.fun', of: 'bodies/meshy-gecko.glb' },
  'textures/noise.png': { spdx: null, generated: true, author: 'games.fun (procedural)' },
  'textures/mystery.png': { spdx: null },
};

test('library: CC0 and permissive licences ship; share-alike, non-commercial and unknown do not', () => {
  assert.equal(libraryDecision('props/tree.glb', LIC).keep, true);
  assert.equal(libraryDecision('props/slide.glb', LIC).keep, true);
  assert.equal(libraryDecision('props/sa.glb', LIC).keep, false);
  assert.equal(libraryDecision('props/nc.glb', LIC).keep, false);
  assert.equal(libraryDecision('textures/mystery.png', LIC).keep, false);
  assert.equal(libraryDecision('props/unrecorded.glb', LIC).keep, false);
});

test('library: Meshy output never ships (by author, title or file name), nor what is made from it', () => {
  assert.match(libraryDecision('bodies/meshy-gecko.glb', LIC).why, /Meshy/);
  assert.equal(libraryDecision('bodies/robot.glb', LIC).keep, false);
  assert.equal(libraryDecision('bodies/meshy-gecko.preview.jpg', LIC).keep, false);
  assert.equal(libraryDecision('bodies/meshy-gecko.json', LIC, () => ({ kind: 'meshy' })).keep, false);
});

test('library: games.fun\'s own generated files and body sidecars follow their source', () => {
  assert.equal(libraryDecision('textures/noise.png', LIC).keep, true);
  assert.equal(libraryDecision('bodies/bean.preview.jpg', LIC).keep, true);
  assert.equal(libraryDecision('bodies/bean.json', LIC, () => ({ kind: 'bean' })).keep, true);
  assert.equal(libraryDecision('LICENSES.json', LIC).keep, true);
  assert.equal(libraryDecision('meshy-ledger.jsonl', LIC).keep, false);
});

test('secret scan finds key-shaped strings', () => {
  const b = s => Buffer.from(s);
  const fake = (...parts) => parts.join('');   // assembled here so this file itself never holds a key-shaped string
  const cases = [
    ['a.mjs', `const k = '${fake('sk-ant-api03-', 'a'.repeat(40))}';`],
    ['b.env.example', fake('MESHY_API_KEY=msy_', 'Abc123'.repeat(5))],
    ['c.md', fake('-----BEGIN ', 'PRIVATE KEY-----\nMIIE')],
    ['d.js', fake('AKIA', 'ABCDEFGHIJKLMNOP')],
    ['e.json', JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * 7) % 256))],
    ['f.js', `const SUPABASE_SERVICE_ROLE = "${fake('eyJhbGciOiJIUzI1NiJ9', '.eyJyb2xlIjoic2VydmljZSJ9', '.', 'x'.repeat(30))}"`],
    ['g.ts', `apiKey: "${fake('AIza', 'S'.repeat(35))}"`],
  ];
  for (const [name, text] of cases) assert.ok(scanSecrets(name, b(text)).length > 0, `${name} should be flagged`);
});

test('secret scan leaves ordinary code alone', () => {
  const code = `import { x } from './y.js';\nconst KEY = process.env.MESHY_API_KEY;\nconst hash = '${'ab12'.repeat(16)}';\nconst arr = [1, 2, 3];\n// sk- is a prefix\n`;
  assert.deepEqual(scanSecrets('ok.mjs', Buffer.from(code)), []);
  assert.deepEqual(scanSecrets('model.glb', Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16, 0), Buffer.from(`sk-ant-${'a'.repeat(40)}`)])), [], 'binary assets are not scanned');
});

test('names left out: .env files, keys, ledgers, and left-out folders', () => {
  assert.ok(excludedByName('research/pipeline-v2/.env'));
  assert.ok(excludedByName('a/.env.local'));
  assert.ok(excludedByName('a/node_modules/x/index.js'));
  assert.ok(excludedByName('research/gf-three/lookdev/evidence/x.jpg'));
  assert.ok(excludedByName('wallet.keypair.json'));
  assert.ok(excludedByName('a/server.pem'));
  assert.equal(excludedByName('research/gf-three/kit/core/boot.js'), null);
  assert.equal(excludedByName('research/gf-three/.env.example/x'), null, 'only the file name counts, not a folder named like it');
});

test('portability: long paths, case collisions, device names, forbidden characters', () => {
  assert.equal(portabilityProblems(['a/b.js', 'a/c.js']).length, 0);
  assert.equal(portabilityProblems(['a/Readme.md', 'a/README.md']).length, 1);
  assert.equal(portabilityProblems([`${'x'.repeat(200)}.js`]).length, 1);
  assert.equal(portabilityProblems(['a/con.json']).length, 1);
  assert.equal(portabilityProblems(['a/AUX']).length, 1);
  assert.equal(portabilityProblems(['a/what?.js']).length, 1);
  assert.equal(portabilityProblems(['a/name. ']).length, 1);
});
