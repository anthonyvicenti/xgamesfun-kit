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

test('the workflow runs the profile through the real flag for both engines, macOS only off pull requests, one system or job by hand', async () => {
  const wf = await readFile(at('.github/workflows/check.yml'), 'utf8');
  assert.ok(!wf.includes('GF_VERIFY_PROFILE'), 'no gate variable');
  assert.equal(wf.match(/verify games\/ci(-scenic)? --quick --profile \.github\/ci-profile\.json/g)?.length, 2);
  assert.match(wf, /--from soak-squad/); assert.match(wf, /--from isle-run/);
  assert.match(wf, /--from giant-four/); assert.match(wf, /verify games\/ci-board --quick --profile \.github\/ci-profile\.json/, 'the turn-based board example runs under the profile too');
  assert.match(wf, /doctor --skip-graphics/);
  assert.ok(!wf.includes('continue-on-error'), 'no step may fail quietly: a check that cannot run on a runner leaves the profile by name, with its reason');
  const matrices = wf.match(/os: \$\{\{ fromJSON\(github\.event_name == 'pull_request'[\s\S]*?\) \}\}/g) ?? [];
  assert.equal(matrices.length, 2, 'one matrix per job');
  for (const m of matrices) {
    const [pr, ...rest] = m.split('||'), all = rest.at(-1);
    assert.ok(!/macos/.test(pr) && /ubuntu/.test(pr) && /windows/.test(pr), 'pull requests: Linux and Windows');
    assert.ok(/ubuntu/.test(all) && /windows/.test(all) && /macos/.test(all), 'pushes to main and by hand: macOS too');
    // by hand, one system alone (so a fix for Windows does not pay for macOS)
    for (const [input, os] of [['linux', 'ubuntu-latest'], ['windows', 'windows-latest'], ['macos', 'macos-latest']]) assert.ok(m.includes(`inputs.system == '${input}' && '["${os}"]'`), `system=${input} runs ${os} alone`);
  }
  for (const job of ['party', 'scenic']) assert.ok(wf.includes(`if: github.event_name != 'workflow_dispatch' || inputs.job == 'all' || inputs.job == '${job}'`), `job=${job} runs alone`);
  // every system's Chrome is named, and each job reads its own
  const paths = wf.match(/CHROME_PATH: \$\{\{ fromJSON\('(\{.*\})'\)\[matrix\.os\] \}\}/g) ?? [];
  assert.equal(paths.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(/fromJSON\('(\{.*\})'\)/.exec(paths[0])[1])), ['ubuntu-latest', 'windows-latest', 'macos-latest']);
});
