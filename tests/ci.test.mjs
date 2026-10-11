// The CI profile and workflow stay consistent with the verify tool that reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkProfile, requiredFor } from '../kits/research/gf-three/tools/lib/verdict.mjs';

const at = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));

test('.github/ci-profile.json is a valid verify --profile file, and skips only checks a build runs', async () => {
  const profile = JSON.parse(await readFile(at('.github/ci-profile.json'), 'utf8'));
  assert.deepEqual(checkProfile(profile), []);
  assert.equal(profile.environment.GF_VERIFY_SOFTWARE, '1');
  const build = requiredFor('round');
  for (const s of profile.skip) assert.ok(build.includes(s.check), `check ${s.check} is not one a build's verify runs`);
  assert.deepEqual(profile.skip.filter(s => s.legs).map(s => [s.check, s.legs]), [[5, 'lobby']], 'check 5 keeps its lobby legs');
  assert.equal(profile.run, undefined, 'the file names what it skips; everything else runs');
});

test('the workflow runs the profile through the real flag for both engines, and macOS only off pull requests', async () => {
  const wf = await readFile(at('.github/workflows/check.yml'), 'utf8');
  assert.ok(!wf.includes('GF_VERIFY_PROFILE'), 'no gate variable');
  assert.equal(wf.match(/verify games\/ci(-scenic)? --quick --profile \.github\/ci-profile\.json/g)?.length, 2);
  assert.match(wf, /--from soak-squad/); assert.match(wf, /--from isle-run/);
  assert.match(wf, /doctor --skip-graphics/);
  const matrices = wf.match(/fromJSON\(github\.event_name == 'pull_request'[\s\S]*?\) \}\}/g) ?? [];
  assert.equal(matrices.length, 2, 'one matrix per job');
  for (const m of matrices) {
    const [pr, push] = m.split('||');
    assert.ok(!/macos/.test(pr) && /ubuntu/.test(pr) && /windows/.test(pr), 'pull requests: Linux and Windows');
    assert.ok(/macos/.test(push), 'pushes to main and by hand: macOS too');
  }
});
