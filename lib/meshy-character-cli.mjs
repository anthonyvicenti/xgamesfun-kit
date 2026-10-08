// The CLI of gf-three's tools/meshy-character.mjs, run from here. Upstream's own CLI starts only when
// `import.meta.url === "file://" + process.argv[1]`, which is never true on Windows (C:\… vs file:///C:/…) or under a
// path with spaces, so `gamesfun meshy character` calls its exported generateCharacter() with the same flags, output
// and exit codes instead (listed under "upstream fixes" in docs/DEVELOPING.md).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GF3_TOOLS } from './paths.mjs';

const a = process.argv.slice(2);
const val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const out = val('--out');
if (!(val('--image') || val('--prompt')) || !out) {
  console.error('usage: gamesfun meshy character (--image <png>|--prompt "<text>") --out <glb> [--describe ..] [--enemy] [--id ..] [--label ..] [--height m] [--polycount n] [--no-concept] [--dry-run]');
  process.exit(2);
}
const tool = await import(pathToFileURL(path.join(GF3_TOOLS, 'meshy-character.mjs')).href);
const meshy = await import(pathToFileURL(path.join(GF3_TOOLS, 'lib', 'char-meshy.mjs')).href);
const r = await tool.generateCharacter({
  image: val('--image') && path.resolve(val('--image')), prompt: val('--prompt'), out, id: val('--id'), label: val('--label'), describe: val('--describe'),
  enemy: a.includes('--enemy'), concept: !a.includes('--no-concept'), height: val('--height') ? +val('--height') : 1.7,
  polycount: val('--polycount') ? +val('--polycount') : 12000, dryRun: a.includes('--dry-run'),
}).catch(e => { console.error(`\nmeshy-character: ${e.message}`); process.exit(/Meshy cap|MESHY_API_KEY/.test(e.message) ? 3 : 1); });
if (r.dryRun) { console.log(JSON.stringify(r, null, 1)); process.exit(0); }
console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.file}  ${r.credits} credits  (ledger total ${meshy.spent()} / ${meshy.CAP})`);
for (const e of r.rigCheck?.errors ?? []) console.log(`  error: ${e}`);
for (const w of r.rigCheck?.warnings ?? []) console.log(`  warn:  ${w}`);
process.exitCode = r.ok ? 0 : 1;
