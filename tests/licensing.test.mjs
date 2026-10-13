// Licensing guard: LICENSE is MIT, every library file has a licence record, every CC-BY record is credited in CREDITS.md.
// Reads only files in this repository; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = s => s.replace(/\s+/g, ' ').trim();

const LIBRARIES = ['kits/research/gf-three/library', 'kits/research/gf-scenic/library'];
/** Index files the sync keeps beside the records (they describe files; they are not art). */
const INDEX = new Set(['LICENSES.json', 'props.json', 'bodies.json', 'kits.json', 'sources.json', 'body-sources.json', 'props-folio.json', 'sources.lock.json']);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

test('LICENSE is the standard MIT text', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'LICENSE')), 'LICENSE is missing');
  const t = squash(read('LICENSE'));
  assert.match(t, /^MIT License Copyright \(c\) \d{4} \S/, 'LICENSE must start "MIT License" and a copyright line');
  for (const phrase of [
    'Permission is hereby granted, free of charge, to any person obtaining a copy of this software',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software',
    'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
  ]) assert.ok(t.includes(phrase), `LICENSE lacks: ${phrase}`);
  assert.equal(JSON.parse(read('package.json')).license, 'MIT', 'package.json "license" must be MIT');
});

test('every library file has a licence record, or sits in a folder with its own LICENSE text', () => {
  for (const lib of LIBRARIES) {
    const dir = path.join(ROOT, lib);
    assert.ok(fs.existsSync(dir), `${lib} is missing`);
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'LICENSES.json'), 'utf8')).files;
    const missing = [];
    for (const abs of walk(dir)) {
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (INDEX.has(rel) || /(^|\/)([^/]+-)?LICENSE[^/]*$/.test(rel)) continue;   // a licence text (bodies/rocketbox-LICENSE.md)
      if (/^bodies\/[^/]+\.json$/.test(rel)) continue;                       // a body's sidecar describes a record
      if (records[rel]) continue;
      if (fs.existsSync(path.join(path.dirname(abs), 'LICENSE'))) continue;  // e.g. library/folio/ (MIT, Bruno Simon)
      missing.push(rel);
    }
    assert.deepEqual(missing, [], `${lib}: files without a licence record in LICENSES.json`);
    for (const [rel, r] of Object.entries(records)) {
      assert.ok(r.spdx || r.generated, `${lib}: record ${rel} has no licence (spdx) and is not marked generated`);
    }
  }
});

test('CREDITS.md carries the credit line of every CC-BY record, exactly', () => {
  const credits = read('CREDITS.md');
  const third = read('THIRD_PARTY.md');
  let n = 0;
  for (const lib of LIBRARIES) {
    const records = JSON.parse(read(`${lib}/LICENSES.json`)).files;
    for (const [rel, r] of Object.entries(records)) {
      if (!/^CC-BY/.test(r.spdx ?? '')) continue;
      n++;
      assert.ok(r.credit, `${rel}: a CC-BY record needs a credit line`);
      assert.ok(credits.includes(r.credit), `CREDITS.md lacks the credit line of ${rel}: ${r.credit}`);
      assert.ok(third.includes(r.credit), `THIRD_PARTY.md lacks the credit line of ${rel}: ${r.credit}`);
    }
  }
  assert.ok(n >= 11, `expected the 11 CC-BY records the creator named, found ${n}`);
});

test('licensing docs exist and say what they must', () => {
  const doc = read('docs/LICENSING.md');
  assert.match(doc, /DRAFT/, 'the name policy must stay marked DRAFT until a lawyer reads it');
  assert.match(doc, /separate, private/i, 'LICENSING.md must say the hosted Creator Studio is a separate, private service');
  assert.doesNotMatch(read('THIRD_PARTY.md'), /has no licence yet/, 'THIRD_PARTY.md still says there is no licence');
});

test('no use of vendor names beyond plain text in the files this guard covers', () => {
  for (const f of ['CREDITS.md', 'docs/LICENSING.md']) {
    const t = read(f);
    assert.doesNotMatch(t, /!\[[^\]]*\]\([^)]*(claude|anthropic|openai|codex)[^)]*\)/i, `${f}: no vendor logos`);
  }
});
