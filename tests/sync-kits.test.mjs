// The sync's policy, on made-up inputs: the licence filter, the secret scan, name exclusions and portability rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GF3_TOOLS, KIT_ROOT, KITS } from '../lib/paths.mjs';
import { runToolJson } from '../lib/run-tool.mjs';
import { tempDir } from './helpers.mjs';
import { closure, DATA, ENTRIES, excludedByName, kitVersions, LEFT_OUT, libraryDecision, licenceOfText, namedPaths, pathConstants, portabilityProblems, scanSecrets, maskTemplates, stripComments, TOOL_ENTRIES } from '../scripts/sync-kits.mjs';

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

test('library: a folder that carries its upstream\'s permissive LICENSE ships without a record; Meshy output still does not', () => {
  const mit = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY';
  assert.equal(licenceOfText(mit), 'MIT');
  assert.equal(licenceOfText('All rights reserved.'), null);
  assert.equal(licenceOfText(null), null);
  const beside = rel => (rel.startsWith('folio/') ? licenceOfText(mit) : null);
  assert.equal(libraryDecision('folio/rock.glb', {}, () => null, beside).keep, true);
  assert.equal(libraryDecision('other/rock.glb', {}, () => null, beside).keep, false);
  assert.equal(libraryDecision('folio/meshy-rock.glb', {}, () => null, beside).keep, false);
  assert.equal(libraryDecision('folio/rock.glb', {}, () => null, () => 'GPL-3.0').keep, false);
});

// ---- the walk: what the tools reach ----
test('comments are removed without mistaking a string, a line comment or a regular expression for one', () => {
  const src = [
    '// a line comment that names research/*/kit and never closes',
    'import { a } from \'./a.mjs\';',
    'const glob = \'kit/*\', re = /\\/\\*/, url = "http://x/y";   // trailing',
    '/* import { gone } from \'./gone.mjs\'; */',
    'const t = `tpl // not a comment`;',
    'import { b } from \'./b.mjs\';',
  ].join('\n');
  const out = stripComments(src);
  assert.ok(out.includes('./a.mjs') && out.includes('./b.mjs'), 'both imports survive');
  assert.ok(!out.includes('gone.mjs') && !out.includes('never closes') && !out.includes('trailing'));
  assert.ok(out.includes('\'kit/*\'') && out.includes('/\\/\\*/') && out.includes('http://x/y') && out.includes('tpl // not a comment'));
  assert.equal(out.split('\n').length, src.split('\n').length, 'line numbers hold');
});

test('source a tool writes into a template literal is not an import of the tool', () => {
  const src = 'import { a } from \'./a.mjs\';\nconst w = (x) => `${x}import { F } from \'./gf/forge/feel.js\';\n${`n`}`;\nimport(\'./c.mjs\');';
  const out = maskTemplates(stripComments(src));
  assert.ok(out.includes('./a.mjs') && out.includes('./c.mjs'));
  assert.ok(!out.includes('feel.js'));
  assert.equal(out.split('\n').length, src.split('\n').length);
});

const PATHS_SRC = `
export const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
export const GF3 = join(REPO, 'research/gf-three');
export const KIT = join(GF3, 'kit');
export const FORGE = join(REPO, 'research/gf-forge');
export const FORGE_KIT = join(FORGE, 'kit');
export const KIT_VERSION = '0.9.0';
export const SCENIC_VERSION = '0.2.0';
const T = 'research/foundations/trials';
export const VENDOR = { three: join(REPO, \`\${T}/fps/vendor/three\`) };
export const GF_ASSETS = join(REPO, 'research/foundations/kits/gf-assets/1.3.0/source/gf-assets.js');
export const GF_AUDIO = join(REPO, 'research/foundations/kits/gf-audio/1.5.0');
`;
const P = 'research/gf-three/tools/lib/paths.mjs';
function walk(files, opts = {}) {
  const all = { [P]: PATHS_SRC, ...files };
  return closure({ entries: Object.keys(files).slice(0, 1), has: f => f in all, read: f => all[f] ?? null, faults: [], ...opts });
}

test('paths.mjs is read for its folders, the paths it names and the kit versions', () => {
  const c = pathConstants(PATHS_SRC);
  assert.equal(c.get('REPO'), '');
  assert.equal(c.get('KIT'), 'research/gf-three/kit');
  assert.equal(c.get('FORGE_KIT'), 'research/gf-forge/kit');
  const named = namedPaths(PATHS_SRC);
  for (const p of ['research/gf-three/kit', 'research/foundations/trials/fps/vendor/three', 'research/foundations/kits/gf-audio/1.5.0']) assert.ok(named.includes(p), p);
  assert.ok(!named.includes('research/foundations/trials'), 'the prefix alone is not a path the tools read');
  const v = kitVersions(f => ({ [P]: PATHS_SRC, 'research/multiplayer/party/manifest.mjs': 'export const KIT_VERSION = \'1.6.3\';   // note' })[f]);
  assert.deepEqual(v, { mp: '1.6.3', audio: '1.5.0', assets: '1.3.0', gf3: '0.9.0', scenic: '0.2.0' });
});

test('the walk follows static imports, import(), register() and new URL(), and stops at page modules', () => {
  const r = walk({
    'research/gf-three/tools/a.mjs': 'import { x } from \'./lib/b.mjs\';\nexport { y } from \'./lib/c.mjs\';\nconst d = await import(\'../../other/d.mjs\');\nregister(\'./lib/hook.mjs\', import.meta.url);\nconst f = new URL(\'./lib/data.json\', import.meta.url);\nconst g = new URL(\'./lib/absent.json\', import.meta.url);\nconst folder = new URL(\'./lib/\', import.meta.url);\nimport \'node:fs\';',
    'research/gf-three/tools/lib/b.mjs': 'import \'../../kit/page.js\';',
    'research/gf-three/tools/lib/c.mjs': '',
    'research/other/d.mjs': '',
    'research/gf-three/tools/lib/hook.mjs': '',
    'research/gf-three/tools/lib/data.json': '{}',
    'research/gf-three/kit/page.js': 'import \'../vendor/three.js\';   // a game\'s layout, not this repository\'s',
    'research/gf-three/tools/unreached.mjs': '',
  }, { browser: f => f.startsWith('research/gf-three/kit/') });
  assert.deepEqual(r.problems, []);
  assert.deepEqual([...r.modules].sort(), ['research/gf-three/kit/page.js', 'research/gf-three/tools/a.mjs', 'research/gf-three/tools/lib/b.mjs', 'research/gf-three/tools/lib/c.mjs', 'research/gf-three/tools/lib/data.json', 'research/gf-three/tools/lib/hook.mjs', 'research/other/d.mjs']);
});

test('the walk refuses an import that leaves the tracked files, and a static import into a left-out part', () => {
  const gone = walk({ 'research/gf-three/tools/a.mjs': 'import \'./lib/missing.mjs\';' });
  assert.equal(gone.problems.length, 1);
  assert.match(gone.problems[0], /missing\.mjs.*does not track/);
  const forge = walk({ 'research/gf-three/tools/a.mjs': 'import { t } from \'../../gf-forge/kit/tables/index.js\';', 'research/gf-forge/kit/tables/index.js': '' });
  assert.equal(forge.problems.length, 1);
  assert.match(forge.problems[0], /left out.*importPart/);
  assert.ok(!forge.modules.has('research/gf-forge/kit/tables/index.js'));
});

test('the walk records parts loaded by path: taken when this package carries them, skipped when left out', () => {
  const r = walk({
    'research/gf-three/tools/a.mjs': 'const t = await importPart(join(FORGE_KIT, \'tables/index.js\'), \'the forge engine\');\nconst w = await importPart(join(REPO, \'research/worlds/serve.mjs\'), \'the world server\');\nif (forge) (await import(\'../../gf-forge/hud/create.mjs\')).go();',
    'research/gf-forge/kit/tables/index.js': 'import \'./deep.js\';',
    'research/gf-forge/hud/create.mjs': '',
    'research/worlds/serve.mjs': 'import \'./core.mjs\';',
    'research/worlds/core.mjs': '',
  });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.parts.map(p => [p.path, p.taken]), [['research/gf-forge/hud/create.mjs', false], ['research/gf-forge/kit/tables/index.js', false], ['research/worlds/serve.mjs', true]]);
  assert.ok(r.modules.has('research/worlds/core.mjs'), 'a taken part brings what it imports');
  assert.ok(![...r.modules].some(m => m.startsWith('research/gf-forge/')));
  const unknown = walk({ 'research/gf-three/tools/a.mjs': 'await importPart(join(NOWHERE, \'x.mjs\'), \'x\');' });
  assert.match(unknown.problems[0], /NOWHERE/);
});

test('a recorded tool fault takes only the named file and what it imports, and fails once it is no longer needed', () => {
  const files = {
    'research/gf-three/tools/a.mjs': 'import { t } from \'../../gf-forge/kit/tables/index.js\';',
    'research/gf-forge/kit/tables/index.js': 'import \'./fields.js\';',
    'research/gf-forge/kit/tables/fields.js': '',
    'research/gf-forge/kit/host.js': '',
  };
  const faults = [{ from: 'research/gf-three/tools/a.mjs', imports: 'research/gf-forge/kit/tables/index.js', why: 'x' }];
  const r = walk(files, { faults });
  assert.deepEqual(r.problems, []);
  assert.ok(r.modules.has('research/gf-forge/kit/tables/fields.js') && !r.modules.has('research/gf-forge/kit/host.js'));
  const fixed = walk({ ...files, 'research/gf-three/tools/a.mjs': '' }, { faults });
  assert.match(fixed.problems[0], /TOOL_FAULTS.*delete the entry/);
});

// ---- the lists that are still written by hand stay honest ----
test('every tool this package runs is an entry of the walk, and every entry is in kits/', async () => {
  const run = new Set();
  const scan = async dir => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'web3'].includes(e.name)) await scan(p); continue; }
      if (!/\.mjs$/.test(e.name)) continue;
      const text = await readFile(p, 'utf8');
      for (const m of text.matchAll(/(?:runTool|runToolJson|toolPath)\(\s*([^,)]+)/g)) {
        const arg = m[1].trim();
        // a literal name, or a choice between literal names
        for (const lit of arg.matchAll(/'([a-z0-9-]+)'/g)) run.add(lit[1]);
      }
    }
  };
  for (const d of ['bin', 'commands', 'lib', 'mcp', 'server']) await scan(path.join(KIT_ROOT, d));
  assert.ok(run.size >= 8, `found the tools the CLI runs (${[...run].join(', ')})`);
  for (const t of run) assert.ok(TOOL_ENTRIES.includes(t), `the CLI runs "${t}", which is not in TOOL_ENTRIES (scripts/sync-kits.mjs)`);
  for (const t of TOOL_ENTRIES) assert.ok(run.has(t), `TOOL_ENTRIES lists "${t}", which the CLI no longer runs`);
  for (const e of ENTRIES) assert.ok(existsSync(path.join(KITS, ...e.split('/'))), `${e} is in kits/`);
});

test('no kit version is written in the data list, and the forge engine is left out', () => {
  for (const d of DATA) assert.ok(!/kits\/gf-[a-z]+\/\d/.test(d.path), `${d.path}: use {mp}, {audio} or {assets}`);
  assert.ok(LEFT_OUT.some(p => p.path === 'research/gf-forge'));
  assert.ok(!DATA.some(d => d.path.startsWith('research/gf-forge')));
});

// The forge engine is not in kits/ (bar the data tables of one recorded tool fault): every tool still loads, and
// create refuses a spec that asks for it.
test('every tool loads without the forge engine', { timeout: 120000 }, () => {
  assert.ok(!existsSync(path.join(KITS, 'research', 'gf-forge', 'kit', 'wasm')), 'no forge core here');
  assert.ok(!existsSync(path.join(KITS, 'research', 'gf-forge', 'tools')), 'no forge tools here');
  const needsPackages = [];
  for (const t of TOOL_ENTRIES) {
    const file = path.join(GF3_TOOLS, `${t}.mjs`);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', 'const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);', file], { encoding: 'utf8', cwd: KIT_ROOT });
    if (r.status !== 0 && /dependencies missing/.test(r.stderr)) { needsPackages.push(t); continue; }   // the 3D tools' own packages, installed on first use
    assert.equal(r.status, 0, `${t}.mjs does not load: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    assert.ok(!/gf-forge/.test(r.stderr), `${t}.mjs: ${r.stderr}`);
  }
  assert.ok(needsPackages.every(t => ['rig-check', 'meshy-character', 'meshy-prop', 'verify'].includes(t)), `only the 3D tools and verify (check 19 reads bodies) may wait for their packages (${needsPackages.join(', ')})`);
});

test('a forge spec is refused, naming the missing engine, and nothing is written', { timeout: 120000 }, async () => {
  const t = await tempDir();
  try {
    const spec = JSON.parse(await readFile(path.join(KITS, 'research', 'studio-v2', 'specs', 'dev-dodgeball.spec.json'), 'utf8'));
    await writeFile(path.join(t.dir, 'forge.spec.json'), JSON.stringify({ ...spec, engine: 'forge' }));
    const r = await runToolJson('create', [path.join(t.dir, 'forge.spec.json'), path.join(t.dir, 'game')]);
    assert.equal(r.data?.ok, false);
    assert.match((r.data.problems ?? []).join(' '), /gf-forge/);
    assert.ok(!existsSync(path.join(t.dir, 'game', 'index.html')), 'no game was written');
  } finally { await t.cleanup(); }
});
