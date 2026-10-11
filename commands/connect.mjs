import { guard, parse, printJson, UsageError } from '../lib/cli.mjs';
import { connect } from '../lib/connect.mjs';

const usage = `Usage: gamesfun connect [--agent <id>] [--scope <scope>] [--dir <folder>] [--replace] [--remove] [--dry-run] [--json]

Register this kit's MCP server with your coding agent (every agent found; rows are in lib/agents.json) using the agent's
own command ("claude mcp add", "codex mcp add"), then check the server starts, lists its tools, and shows up in the
agent's own list. For Claude Code it also installs this kit's plugin from this checkout ("claude plugin marketplace add",
"claude plugin install"): the hooks that let the studio page reach your session. It never edits an agent's config
file, signs in, or reads a credential.
  --agent <id>    only that agent (claude, codex)
  --scope <s>     Claude Code: user (default; every folder), local (this folder, private), project (.mcp.json in --dir)
                  Codex has one scope, user
  --dir <folder>  the folder local and project scopes belong to (default: the current one)
  --replace       point an existing "gamesfun" registration at this checkout
  --remove        take the registration and the plugin out again
The environment variables GAMESFUN_CONNECT_SCOPE and GAMESFUN_CONNECT_DIR set --scope and --dir when they are not given.
  --dry-run       print the agent commands, run none that change anything`;

export default {
  name: 'connect',
  summary: 'add our MCP server to Claude Code and Codex through their own commands',
  usage,
  run: args => guard(async () => {
    const { values } = parse(args, { agent: { type: 'string' }, scope: { type: 'string' }, dir: { type: 'string' }, replace: { type: 'boolean' }, remove: { type: 'boolean' }, 'dry-run': { type: 'boolean' } }, usage);
    if (values.replace && values.remove) throw new UsageError(`--replace and --remove together make no sense\n\n${usage}`);
    const r = await connect({ agent: values.agent ?? null, scope: values.scope ?? null, dir: values.dir ?? null, replace: !!values.replace, remove: !!values.remove, dryRun: !!values['dry-run'] });
    if (values.json) { printJson(r); return r.ok ? 0 : 1; }
    if (r.error) console.error(r.error);
    if (r.server?.ok) console.log(`server: starts, ${r.server.tools.length} tools (${r.server.tools.join(', ')})`);
    for (const a of r.results) {
      console.log(`${a.name}: ${a.status}`);
      for (const s of a.steps) console.log(`  ${s.do}: ${s.command}${s.code === undefined ? '' : `  -> exit ${s.code}`}${s.note ? ` (${s.note})` : ''}`);
      if (a.note) console.log(`  ${a.note}`);
      if (a.plugin) console.log(`  plugin (the studio page's link to your session): ${a.plugin.status}${a.plugin.note ? `: ${a.plugin.note}` : ''}`);
      if (['registered', 'would register'].includes(a.status) || ['installed', 'would install'].includes(a.plugin?.status)) console.log(`  next: ${a.restartHint}`);
    }
    return r.ok ? 0 : 1;
  }),
};
