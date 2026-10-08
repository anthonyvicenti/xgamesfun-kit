// The CLI of gf-three's tools/rig-check.mjs, run from here: upstream's own CLI starts only when
// `import.meta.url === "file://" + process.argv[1]`, which is never true on Windows or under a path with spaces.
// Same output and exit codes: 0 every body passes, 1 one fails, 2 bad usage.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GF3_TOOLS } from './paths.mjs';

const args = process.argv.slice(2);
const ci = args.indexOf('--clips');
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--clips');
if (!files.length) { console.error('usage: gamesfun rig-check <body.glb> [...] [--clips file] [--json]'); process.exit(2); }
const { rigCheck } = await import(pathToFileURL(path.join(GF3_TOOLS, 'rig-check.mjs')).href);
let fail = 0;
const out = [];
for (const f of files) {
  const r = await rigCheck(path.resolve(f), ci >= 0 ? { clips: path.resolve(args[ci + 1]) } : {});
  out.push(r);
  if (!r.ok) fail++;
  if (!args.includes('--json')) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${f}  ${(r.stats.bytes / 1e6).toFixed(2)} MB, ${Math.round(r.stats.triangles ?? 0)} tris, ${r.stats.joints ?? 0} joints${r.metrics.height ? `, ${r.metrics.height} m` : ''}`);
    for (const e of r.errors) console.log(`  error: ${e}`);
    for (const w of r.warnings) console.log(`  warn:  ${w}`);
  }
}
if (args.includes('--json')) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 1));
process.exitCode = fail ? 1 : 0;
