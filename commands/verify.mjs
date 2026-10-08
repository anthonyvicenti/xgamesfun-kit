import { ensureBrowser } from '../lib/chrome.mjs';
import { guard, parse, UsageError } from '../lib/cli.mjs';
import { resolveGame, shown } from '../lib/games.mjs';
import { runTool } from '../lib/run-tool.mjs';

const usage = `Usage: gamesfun verify [dir] [--quick] [--check <n>] [--out <dir>] [--json]

Is this game good? gf-three's verify plays it in Chrome with real input (alone with bots, and two players over real
WebRTC) and prints one verdict. Evidence goes to <game>/evidence/verify-N/ (verdict.json, screenshots).
  --quick        skip the contact sheet (check 9); about 2 minutes
  --check <n>    run one check alone while you fix it: 10, 13, 14, 15, 16, or the static 11, 17, 11,17
  --out <dir>    write the evidence somewhere else

Chrome: CHROME_PATH, else an installed Chrome or Edge, else Playwright's Chromium (downloaded once, on demand).`;

const STATIC = ['11', '14', '17', '11,17', '17,11'];

export default {
  name: 'verify',
  summary: 'run the checks every game must pass (real Chrome, real input)',
  usage,
  run: args => guard(async () => {
    const { values, positionals } = parse(args, { quick: { type: 'boolean' }, check: { type: 'string' }, out: { type: 'string' } }, usage);
    if (values.check && !/^\d+(,\d+)*$/.test(values.check)) throw new UsageError(`--check takes a check number, e.g. 13\n\n${usage}`);
    const dir = await resolveGame(positionals[0]);
    if (!STATIC.includes(values.check ?? '')) {
      const b = await ensureBrowser({ log: m => console.error(m) });
      if (!values.json) console.error(`verify: ${shown(dir)} in ${b.kind === 'edge' ? 'Microsoft Edge' : b.kind === 'chromium' ? 'Chromium' : 'Chrome'} (${b.path})`);
    }
    const flags = [];
    if (values.quick) flags.push('--quick');
    if (values.check) flags.push('--check', values.check);
    if (values.out) flags.push('--out', values.out);
    if (values.json) flags.push('--json');
    const r = await runTool('verify', [dir, ...flags], { stdio: 'inherit' });
    return r.code;
  }),
};
