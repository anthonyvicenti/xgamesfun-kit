// The vista engine as the CLI shows it, with no browser: the catalog's engines lines say which engines are not open yet
// and which this kit does not carry, and the vista example is listed only when GF_VISTA_OPEN=1 (create --from still
// finds it). Its verify needs a hardware WebGPU adapter, so it runs by hand or in the smoke test (docs/CI.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogLines, SECTIONS } from '../lib/catalog.mjs';
import { exampleOpen, listExamples, resolveExample } from '../lib/examples.mjs';
import { EXAMPLES } from '../lib/paths.mjs';

const engines = {
  party: { kit: 'gf-three 0.1.0-dev', status: 'ready', for: 'silly party games' },
  forge: { kit: 'gf-forge 0.9.0', status: 'not open yet (still being built)', for: 'first-person action' },
  vista: { kit: 'gf-vista 0.2.0-thin', status: 'not open yet (gf-vista is still being built)', for: 'calm games', note: 'WebGPU only' },
};

test('catalog engines: a closed engine says so and how it is opened; an engine whose kit is not carried says that', () => {
  assert.ok(SECTIONS.includes('engines'));
  const lines = catalogLines({ engines }, ['engines'], { kits: new Set(['gf-three', 'gf-vista']) });
  assert.match(lines.find(l => /^\s+party/.test(l)), /^\s+party\s+gf-three 0\.1\.0-dev: silly party games$/);
  assert.match(lines.find(l => /^\s+vista/.test(l)), /\[not open yet; GF_VISTA_OPEN=1 opens it\] gf-vista 0\.2\.0-thin: calm games/);
  assert.ok(lines.includes(`${' '.repeat(14)}WebGPU only`), 'the note line');
  assert.match(lines.find(l => /^\s+forge/.test(l)), /\[not open yet\] \[not in this kit\]/);
  const open = catalogLines({ engines: { vista: { ...engines.vista, status: 'ready' } } }, ['engines'], { kits: new Set(['gf-vista']) });
  assert.doesNotMatch(open.join('\n'), /not open|not in this kit/);
});

test('the vista example is listed only with GF_VISTA_OPEN=1, and create --from finds it either way', async () => {
  const meta = JSON.parse(await readFile(path.join(EXAMPLES, 'lantern-cove', 'example.json'), 'utf8'));
  assert.equal(meta.closed?.env, 'GF_VISTA_OPEN');
  const spec = JSON.parse(await readFile(path.join(EXAMPLES, 'lantern-cove', 'spec.json'), 'utf8'));
  assert.equal(spec.engine, 'vista');
  assert.ok(!(await listExamples(EXAMPLES, { env: {} })).some(e => e.id === 'lantern-cove'));
  const shown = (await listExamples(EXAMPLES, { env: { GF_VISTA_OPEN: '1' } })).find(e => e.id === 'lantern-cove');
  assert.equal(shown?.engine, 'vista');
  assert.ok((await listExamples(EXAMPLES, { env: {}, all: true })).some(e => e.id === 'lantern-cove'));
  assert.equal((await resolveExample('lantern-cove')).id, 'lantern-cove');
  assert.equal(exampleOpen({ id: 'soak-squad' }, {}), true, 'an example of an open engine is always listed');
});
