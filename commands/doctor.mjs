import { guard, parse, printJson } from '../lib/cli.mjs';
import { formatDoctor, runDoctor } from '../lib/doctor.mjs';

const usage = `Usage: gamesfun doctor [--json] [--skip-graphics] [--all-systems]

Is this machine ready to make a first game? Checks Node 24, the installed packages, git, a browser, whether graphics are
hardware or software, a free port for the dev server, write access, and each coding agent in lib/agents.json (an agent
you do not use is only a note). Each problem line names the one command that fixes it on your system.
Exit code 1 only for what blocks a first game (a FAIL line); a "warn" never does.
  --json            the same as data: { ok, platform, items: [{ id, label, status, detail, fix: { win32, darwin, linux } }] }
  --skip-graphics   don't open the browser to look at the renderer (about 5 seconds)
  --all-systems     print the fix for Windows, macOS and Linux`;

export default {
  name: 'doctor',
  summary: 'check this machine for a first game and say how to fix what is missing',
  usage,
  run: args => guard(async () => {
    const { values } = parse(args, { 'skip-graphics': { type: 'boolean' }, 'all-systems': { type: 'boolean' } }, usage);
    const r = await runDoctor({ graphics: !values['skip-graphics'] });
    if (values.json) printJson(r); else console.log(formatDoctor(r, { all: !!values['all-systems'] }));
    return r.ok ? 0 : 1;
  }),
};
