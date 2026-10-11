// The write guard: node guard.mjs   (a PreToolUse hook, exec form, no shell; Node's own modules only)
//
// The build loop keeps its own folder inside each game: <game>/.gf-loop/ (the state, the locked spec, the promises,
// the verdicts, the play-tester's brief and report, the checkpoints). The loop's tools write it; a session that edits
// it is editing the proof its game is checked against (seen on 2026-10-11: a session took a failing control out of
// the locked spec). The loop library notices and puts things back; this hook stops the write before it happens.
//
// Denied, with a reason that names the tool to use instead:
//   - Edit, Write, MultiEdit, NotebookEdit on a path under a `.gf-loop` folder. The play-tester subagent alone may
//     write its own `job/playtest/out/` and `job/playtest/runs/`.
//   - Bash (and PowerShell) when the command names a `.gf-loop` path at all, also to read it: the Read tool reads it.
//   - Edit and Write inside a game the person has just rolled back from the studio page, until the session has
//     called gamesfun_next (the mark <game>/.gf-loop/cancel.json; lib/cancel.mjs).
//
// What this cannot stop, plainly: a command that builds the path when it runs (a variable, a glob such as `.gf-l*`,
// `cd` into the folder by another name, a script file that holds the path), a tool of another MCP server that writes
// files, and anything done outside the session. For those the loop's own checks stand (the library's lock, held in
// the MCP server's memory). A hook that fails (no node, a crash) decides nothing, by Claude Code's rule.
//
// Output form (https://code.claude.com/docs/en/hooks.md, read 2026-10-11): exit 0 with
//   {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}
// and exit 0 with no output for "no decision". A subagent's tool calls run the same hook with `agent_type` set.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOOP_DIR = '.gf-loop';
export const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const SHELL_TOOLS = ['Bash', 'PowerShell'];
/** Where the play-tester subagent may write, under a game's .gf-loop/. */
export const PLAYTESTER_MAY = ['job/playtest/out/', 'job/playtest/runs/'];
const isPlaytester = type => /(^|:)playtester$/.test(String(type ?? ''));

const WHY_FILE = 'The folder .gf-loop/ is the build loop\'s own (its state, the locked spec, the promises, the verdicts, the play-tester\'s brief and report): only the loop\'s tools write it, and the game is checked against the spec as it was locked. Change the game instead (rules.js, config, slots). If a part of the plan cannot be built, ask the person with the gamesfun_ask tool; gamesfun_next says what comes next.';
const WHY_SHELL = `A shell command may not name a path under .gf-loop/ (the build loop's own folder). Read a file there with the Read tool; nothing in it is yours to write. If a part of the plan cannot be built, ask the person with the gamesfun_ask tool; gamesfun_next says what comes next.`;
const WHY_ROLLED_BACK = 'The person has just rolled this game back from the studio page, and the run that was under way is cancelled. Call the gamesfun_next tool first (it ends the run and says what the person did); do not put the undone changes back.';

/** The path after the last `.gf-loop` segment, with forward slashes, or null when the path is not under one. */
export function underLoopDir(file) {
  const parts = String(file).split(/[\\/]+/);
  const i = parts.lastIndexOf(LOOP_DIR);
  return i < 0 ? null : parts.slice(i + 1).join('/');
}
/** Does a command line name a `.gf-loop` path? Any quoting or separator around the name counts. */
export const namesLoopDir = command => /(^|[^A-Za-z0-9_-])\.gf-loop($|[^A-Za-z0-9_-])/.test(String(command ?? ''));

/** The game folder a file is in when that game has a roll-back mark waiting, else null. */
export function rolledBackGame(file, exists = existsSync) {
  let d = path.dirname(path.resolve(file));
  for (let n = 0; n < 40; n++) {
    if (exists(path.join(d, LOOP_DIR, 'cancel.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

/** → the reason to deny this tool call, or null (no decision: the session's own permission flow goes on). */
export function decide(input, { exists = existsSync } = {}) {
  const tool = input?.tool_name, ti = input?.tool_input ?? {};
  if (SHELL_TOOLS.includes(tool)) return namesLoopDir(ti.command) ? WHY_SHELL : null;
  if (!FILE_TOOLS.includes(tool)) return null;
  const raw = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (typeof raw !== 'string' || !raw) return null;
  const file = path.resolve(input.cwd ?? process.cwd(), raw);
  const rel = underLoopDir(file);
  if (rel !== null) {
    if (isPlaytester(input.agent_type) && PLAYTESTER_MAY.some(dir => rel.startsWith(dir)) && !rel.split('/').includes('..')) return null;
    return WHY_FILE;
  }
  return rolledBackGame(file, exists) ? WHY_ROLLED_BACK : null;
}

async function main() {
  let text = '';
  try { process.stdin.setEncoding('utf8'); for await (const c of process.stdin) text += c; } catch { /* no input: no decision */ }
  let input = null;
  try { input = JSON.parse(text); } catch { /* not ours to judge */ }
  const reason = input ? decide(input) : null;
  if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
}
// run as the hook (not imported by a test): the two paths are compared through any link an install may have made
const real = p => { try { return realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) await main();
