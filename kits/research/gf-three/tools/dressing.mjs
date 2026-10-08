#!/usr/bin/env node
// gf-three set-dressing lint: is the world clean? No browser, about a second.
//
//   node research/gf-three/tools/dressing.mjs <game dir | template id | layout.json> [--json] [--svg plan.svg] [--look <preset>] [--strict]
//
// Checks (thresholds and rule meanings in tools/lib/dressing.mjs, T and RULES): solid props interpenetrating; props
// floating, sunk or tilted; props straddling the play-area edge or backdrops reaching into it; spawns blocked, at the
// edge, too few or too close, and the camera behind a spawn starting inside a prop; zones and the pickup area covered by
// props; scenery that looks collectable; pickups drawn as the stand-in gem or too small; sizes against the real thing and
// the character height; loose clutter, decor density and plants on paving; seats facing nothing; a crowded middle;
// colour contrast of players, paint and the stream against the ground, value contrast, and the player palette.
// Prints one plain-words line per problem with its slot and config pointer; --json prints the whole report.
// Exit: 0 clean (warnings allowed), 1 errors (or warnings with --strict), 2 bad usage.
import { writeFileSync } from 'node:fs';
import { loadSubject, lintDressing, lines, planSvg } from './lib/dressing.mjs';

const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const target = argv.find((a, i) => !a.startsWith('--') && !['--svg', '--look'].includes(argv[i - 1]));
if (!target) { console.error('usage: dressing.mjs <game dir | template id | layout.json> [--json] [--svg plan.svg] [--look <preset>] [--strict]'); process.exit(2); }

let subject;
try { subject = await loadSubject(target, { look: opt('--look') ?? undefined }); } catch (e) { console.error(e.message); process.exit(2); }
const report = lintDressing(subject);
if (opt('--svg')) writeFileSync(opt('--svg'), planSvg(subject, report));
const failed = report.errors > 0 || (argv.includes('--strict') && report.warnings > 0);
if (argv.includes('--json')) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`dressing ${report.template} (${report.kind} ${target}): ${failed ? 'FAIL' : 'pass'}, ${report.errors} errors, ${report.warnings} warnings · open floor ${(report.stats.openFloor * 100).toFixed(0)}% · ${report.stats.placements} placements`);
  for (const l of lines(report)) console.log('  ' + l);
}
process.exitCode = failed ? 1 : 0;
