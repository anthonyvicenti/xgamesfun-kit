// The default way to connect Supabase: the person's own agent adds Supabase's hosted MCP server and signs in in the
// browser (dynamic client registration: nobody registers an app, the kit never sees a token). Supabase's docs,
// https://supabase.com/docs/guides/getting-started/mcp (read 2026-10-12):
//   Claude Code  claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp", then
//                /mcp → supabase → Authenticate (the browser opens)
//   Codex        codex mcp add supabase --url "https://mcp.supabase.com/mcp", then codex mcp login supabase
// The kit adds it with the agent's own command, as `gamesfun connect` adds the kit's server (lib/connect.mjs): it never
// edits an agent's configuration file. Claude Code gets scope `local` (this checkout, the person's alone), not
// `project`, so no .mcp.json naming the person's database is written into the kit's folder.
// The URL carries at most one query parameter: on Windows Codex is a .cmd shim and lib/proc.mjs refuses a `&` in its
// arguments (cmd.exe syntax).
import { detectAll, loadAgents } from '../agents.mjs';
import { KIT_ROOT } from '../paths.mjs';
import { run } from '../proc.mjs';

export const NAME = 'supabase';
export const BASE = 'https://mcp.supabase.com/mcp';
/** The server's link: the whole account (to list and create projects), or one project once it is picked. */
export const mcpUrl = (projectRef = null) => (projectRef ? `${BASE}?project_ref=${encodeURIComponent(projectRef)}` : BASE);

/** Per agent: how to add the server, how the person signs in, the tools the agent then calls. */
export const STEPS = {
  claude: {
    add: url => ['mcp', 'add', '--scope', 'local', '--transport', 'http', NAME, url],
    get: ['mcp', 'get', NAME],
    remove: ['mcp', 'remove', '--scope', 'local', NAME],
    signIn: 'In Claude Code type /mcp, pick "supabase" and choose Authenticate: your browser opens Supabase; sign in and allow access to your organization. (A session started before this needs /mcp once to see the new server.)',
  },
  codex: {
    add: url => ['mcp', 'add', NAME, '--url', url],
    get: ['mcp', 'get', NAME],
    remove: ['mcp', 'remove', NAME],
    signIn: 'In a terminal run: codex mcp login supabase. Your browser opens Supabase; sign in and allow access to your organization.',
  },
};

/** What the agent does once signed in: Supabase's own tool names, so the kit's route and the agent's are the same. */
export const AGENT_TOOLS = [
  'list_projects (or create_project: the person picks a name and region; free plans have 2 active projects, so offer an existing one first)',
  'get_project_url and get_publishable_keys (keep only the publishable key, or the legacy anon key)',
  'npx gamesfun backend use supabase <game> --url <url> --key <publishable key>  (writes backend.json; refuses any other key)',
  'npx gamesfun backend check <game>  (row-level security on every table, no secret in the game) before apply_migration',
  'apply_migration with each file of <game>/supabase/migrations, then get_advisors (type security) and execute_sql with `npx gamesfun backend check --live-sql`',
];

/** Add Supabase's MCP server to every agent found (or `agent`). → [{ id, name, status, command, output, signIn }] */
export async function addServer({ agent = null, projectRef = null, runner = run, detected = null, env = process.env, platform = process.platform } = {}) {
  const found = (detected ?? await detectAll(loadAgents(), { env, platform })).filter(d => STEPS[d.id] && (agent ? d.id === agent : d.found));
  const url = mcpUrl(projectRef);
  const out = [];
  for (const d of found) {
    const s = STEPS[d.id];
    const rec = { id: d.id, name: d.name, url, signIn: s.signIn, command: [d.id, ...s.add(url)].join(' ') };
    out.push(rec);
    if (!d.found) { rec.status = 'not installed'; continue; }
    const had = await runner(d.path, s.get, { cwd: KIT_ROOT, env, timeoutMs: 30000, platform });
    if (had.code === 0 && /mcp\.supabase\.com/.test(`${had.stdout}${had.stderr}`)) { rec.status = 'already added'; continue; }
    const r = await runner(d.path, s.add(url), { cwd: KIT_ROOT, env, timeoutMs: 60000, platform });
    rec.status = r.code === 0 ? 'added' : 'failed';
    rec.output = `${r.stdout}${r.stderr}`.trim().split('\n').slice(0, 6).join('\n') || r.error || '';
  }
  return out;
}

/** The words for a person (or their agent) with no agent the kit can drive. */
export const manualSteps = (url = mcpUrl()) => [
  `Claude Code: claude mcp add --scope local --transport http ${NAME} "${url}", then /mcp → supabase → Authenticate`,
  `Codex: codex mcp add ${NAME} --url "${url}", then codex mcp login ${NAME}`,
  `Any other agent: add the HTTP MCP server ${url} and sign in when it asks (Supabase's docs: https://supabase.com/docs/guides/getting-started/mcp)`,
];
