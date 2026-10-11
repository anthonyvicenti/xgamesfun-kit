// Register this kit's MCP server with the person's coding agents, through each agent's own command (rows of
// lib/agents.json). The steps: (1) the server starts and lists its tools, asked of the server itself; (2) per agent, ask
// whether the name is already registered; (3) add it with the agent's `mcp add`; (4) ask the agent's `mcp get` that it is
// there; (5) where the agent has plugin commands (a row's `plugin`), install this kit's plugin from this checkout the
// same way, so the studio page can reach the person's session (the bridge's hooks), and check the agent lists it.
// Nothing here edits an agent's configuration file, reads a login or token, or starts an agent session.
// GAMESFUN_CONNECT_SCOPE and GAMESFUN_CONNECT_DIR are the defaults for scope and dir when neither is given (a test
// machine keeps a registration to one scratch folder that way, with the one line unchanged).
import os from 'node:os';
import path from 'node:path';
import { detectAll, loadAgents, mcpCommands, pluginCommands, serverCommand } from './agents.mjs';
import { listServerTools } from './mcp-check.mjs';
import { KIT_ROOT } from './paths.mjs';
import { run } from './proc.mjs';

export const SERVER_FILE = path.join(KIT_ROOT, 'mcp', 'server.mjs');

/** Quote for showing a command to a person (not for running it). */
export const show = (file, args) => [file, ...args].map(a => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');

/**
 * options: { agent (id or null = every agent found), scope, dir, replace, remove, dryRun, serverFile, env, platform, data, detected, listTools, runner }
 * → { ok, server: {ok, tools, error}, results: [{ id, name, status, steps: [{ do, command, code, note }], restartHint }] }
 */
export async function connect(options = {}) {
  const { agent = null, replace = false, remove = false, dryRun = false, serverFile = SERVER_FILE, env = process.env, platform = process.platform, kit = KIT_ROOT } = options;
  const scope = options.scope ?? (env.GAMESFUN_CONNECT_SCOPE || null);
  const dir = options.dir ?? (env.GAMESFUN_CONNECT_DIR || null);
  const data = options.data ?? loadAgents();
  const name = data.server.name;
  const runner = options.runner ?? run;
  const { command, args } = serverCommand(serverFile);
  const detected = options.detected ?? await detectAll(data, { platform, env });
  const wanted = agent ? detected.filter(d => d.id === agent) : detected.filter(d => d.found);
  if (agent && !wanted.length) throw new Error(`no agent "${agent}" in lib/agents.json (rows: ${data.agents.map(a => a.id).join(', ')})`);
  const out = { ok: false, server: null, results: [] };

  if (!remove) {
    out.server = dryRun ? { ok: null, tools: [], note: 'not started (dry run)' } : await (options.listTools ?? listServerTools)({ command, args, cwd: KIT_ROOT });
    if (out.server.ok === false) {
      out.error = `our MCP server did not start: ${out.server.error}${out.server.stderr ? `\n${out.server.stderr}` : ''}\nFix that first (is "npm ci" done? "node bin/gamesfun.mjs doctor" says), then run connect again. Nothing was registered.`;
      return out;
    }
  }

  for (const d of wanted) {
    const res = { id: d.id, name: d.name, status: 'skipped', steps: [], restartHint: d.row.mcp.restartHint };
    out.results.push(res);
    if (!d.found) { res.status = 'not installed'; res.note = `Install it with: ${d.row.install[platform] ?? d.row.install.linux}`; continue; }
    const sc = scope ?? d.row.mcp.defaultScope;
    if (!d.row.mcp.scopes.includes(sc)) { res.status = agent ? 'failed' : 'skipped'; res.note = `${d.name} has no "${sc}" scope (it has: ${d.row.mcp.scopes.join(', ')})`; continue; }
    // User scope is asked from a neutral folder, so a project's own .mcp.json or local entry never answers for it.
    const cwd = sc === d.row.mcp.defaultScope && sc === 'user' ? os.tmpdir() : path.resolve(dir ?? process.cwd());
    const cmds = mcpCommands(d.row, { name, scope: sc, command, args });
    const step = async (what, argv, { mutates = false } = {}) => {
      const rec = { do: what, command: show(path.basename(d.path), argv), cwd };
      if (dryRun && mutates) { rec.note = 'not run (dry run)'; res.steps.push(rec); return { code: 0, stdout: '', dry: true }; }
      const r = await runner(d.path, argv, { cwd, env, timeoutMs: 60000, platform });
      Object.assign(rec, { code: r.code, ...(r.timedOut ? { note: 'timed out' } : {}), ...(r.error ? { note: r.error } : {}) });
      rec.output = `${r.stdout}${r.stderr}`.trim().split('\n').slice(0, 8).join('\n');
      res.steps.push(rec);
      return r;
    };
    const present = async () => { const r = await step('is it registered', cmds.get); return r.code === 0 && r.stdout.includes(name); };

    // ---- the plugin (the studio bridge's hooks), through the agent's own plugin commands
    const pc = pluginCommands(d.row, { scope: sc, kit });
    const pluginPresent = async () => {
      const r = await step('is the plugin installed', pc.list);
      if (r.code !== 0) return false;
      let list = [];
      try { list = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))); } catch { return false; }
      return list.some(x => x?.id === pc.id && x.scope === sc && x.enabled !== false && (!x.projectPath || sc === 'user' || path.resolve(x.projectPath) === cwd));
    };
    const first = out => (out.stderr || out.stdout || out.error || '').trim().split('\n').filter(Boolean).at(-1) ?? '';
    const pluginOut = async () => {
      if (!(await pluginPresent())) return { status: 'not installed' };
      const r = await step('uninstall the plugin', pc.uninstall, { mutates: true });
      await step('remove its marketplace', pc.removeMarketplace, { mutates: true });
      return { status: r.code === 0 && (dryRun || !(await pluginPresent())) ? 'removed' : 'failed' };
    };
    const pluginIn = async () => {
      if (await pluginPresent()) {
        if (!replace) return { status: 'already installed' };
        const gone = await pluginOut();
        if (gone.status === 'failed') return { status: 'failed', note: 'could not remove the old plugin' };
      }
      const m = await step('add this checkout as a plugin marketplace', pc.addMarketplace, { mutates: true });
      if (m.code !== 0) return { status: 'failed', note: `${d.name} refused the marketplace: ${first(m)}` };
      const inst = await step('install the plugin', pc.install, { mutates: true });
      if (inst.code !== 0) return { status: 'failed', note: `${d.name} refused the plugin: ${first(inst)}` };
      if (dryRun) return { status: 'would install' };
      return (await pluginPresent()) ? { status: 'installed' } : { status: 'failed', note: `${d.name} did not list "${pc.id}" after installing it` };
    };

    const server = async () => {
      if (remove) {
        if (!(await present())) return 'not registered';
        const r = await step('remove', cmds.remove, { mutates: true });
        return r.code === 0 && (dryRun || !(await present())) ? 'removed' : 'failed';
      }
      if (await present()) {
        if (!replace) { res.note = `Left as it is. To point it at this checkout: connect --replace${scope ? ` --scope ${sc}` : ''}`; return 'already registered'; }
        const r = await step('remove the old registration', cmds.remove, { mutates: true });
        if (r.code !== 0) { res.note = 'could not remove the old registration'; return 'failed'; }
      }
      const added = await step('add', cmds.add, { mutates: true });
      if (added.code !== 0) { res.note = `${d.name} refused: ${(added.stderr || added.stdout || added.error || '').trim().split('\n')[0]}`; return 'failed'; }
      if (dryRun) return 'would register';
      if (!(await present())) { res.note = `${d.name} did not list "${name}" after adding it`; return 'failed'; }
      if (sc === 'project') res.note = `${d.name} asks the person to approve a project server the first time they open that folder.`;
      return 'registered';
    };
    res.status = await server();
    // The plugin is its own result: the tools work without it, the studio page does not reach the session without it.
    if (pc && res.status !== 'failed') res.plugin = { id: pc.id, ...(remove ? await pluginOut() : await pluginIn()) };
    else res.plugin = pc ? null : { id: null, status: 'none', note: `${d.name} has no plugin command: the studio page cannot reach its sessions yet` };
  }
  const good = ['registered', 'already registered', 'removed', 'would register', 'not registered'];
  out.ok = out.results.length > 0 && out.results.every(r => [...good, 'skipped'].includes(r.status)) && out.results.some(r => good.includes(r.status));
  if (!out.results.length) out.error = 'no coding agent found on this machine. Run: node bin/gamesfun.mjs doctor';
  return out;
}
