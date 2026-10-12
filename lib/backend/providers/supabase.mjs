// Supabase as a backend provider (the shape is lib/backend/providers.mjs). The Management API and the kit's own
// sign-in are ../supabase.mjs; the agent's way (Supabase's hosted MCP server) is ../mcp.mjs.
import { shown } from '../../games.mjs';
import { openUrl } from '../../open.mjs';
import * as mcp from '../mcp.mjs';
import * as S from '../supabase.mjs';

// lib/backend/index.mjs imports this registry, so it is reached lazily here (no import cycle at load)
const lib = () => import('../index.mjs');

const REQUEST = game => `Connect Supabase to this game (${game}) as its backend. Follow the gamesfun-backend skill: run "npx gamesfun backend connect supabase --add-mcp", tell me how to sign in to Supabase in my browser, then list my projects (offer an existing one before creating one: ask me the name and region), get the project URL and publishable key and write them with "npx gamesfun backend use supabase". Do not put any secret or service-role key in the game.`;

const cliOptions = {
  'add-mcp': { type: 'boolean' }, 'token-stdin': { type: 'boolean' }, 'sign-in': { type: 'boolean' },
  'client-id': { type: 'string' }, 'client-secret-stdin': { type: 'boolean' },
  project: { type: 'string' }, create: { type: 'boolean' }, name: { type: 'string' }, org: { type: 'string' }, region: { type: 'string' },
  'anonymous-sign-ins': { type: 'boolean' },
};

const cliUsage = [
  'connect supabase [game]             The usual way: your agent adds Supabase\'s MCP server and you sign in in your',
  '                                    browser (nobody registers an app; the kit keeps no token). Prints the steps.',
  '    --add-mcp                       add the server to Claude Code / Codex with their own commands',
  '  Or sign in from the kit itself, then pick or create a project:',
  '    --token-stdin                   a Supabase personal access token (sbp_…) on stdin',
  '    --sign-in                       the kit\'s own OAuth sign-in (needs a registered OAuth app: docs/BACKEND.md)',
  '    --client-id <uuid> --client-secret-stdin   your own OAuth app (your organization\'s OAuth Apps page)',
  '    --project <ref>                 use this project',
  '    --create --name <n> --org <slug> --region <code>   a new project (lists the regions without --region)',
  '    --anonymous-sign-ins            turn on the project\'s anonymous sign-ins (each player gets an id)',
];

/** `gamesfun backend connect supabase …`. io: { json, print(lines), printJson(v), stdin(), resolveGame(arg) } */
async function connect(values, gameArg, io) {
  const json = values.json;
  const say = (...l) => { if (!json) for (const x of l) console.log(x); };
  const kitWay = values['token-stdin'] || values['sign-in'] || values['client-id'] || values.project || values.create;
  if (!kitWay) {
    const out = { way: 'mcp', url: mcp.mcpUrl(), steps: mcp.manualSteps(), tools: mcp.AGENT_TOOLS, agents: [] };
    if (values['add-mcp']) out.agents = await mcp.addServer();
    if (json) { io.printJson(out); return 0; }
    for (const a of out.agents) say(`${a.name}: ${a.status}${a.status === 'failed' ? `\n  ${a.output}` : ''}${['added', 'already added'].includes(a.status) ? `\n  Sign in: ${a.signIn}` : ''}`);
    if (!out.agents.length) { say('Connect Supabase through your agent (nobody registers anything; your browser signs in):'); for (const s of out.steps) say(`  ${s}`); }
    say('', 'Then your agent:', ...out.tools.map(t => `  - ${t}`), '', 'Skill: gamesfun-backend (tables, access rules and edge functions, safely).');
    return 0;
  }
  const B = await lib();
  const gameDir = await io.resolveGame(gameArg);
  if (values['client-id']) {
    if (!values['client-secret-stdin']) throw new Error('--client-id needs --client-secret-stdin (the secret goes on stdin, never in the arguments)');
    const w = S.saveOwnApp(values['client-id'], await io.stdin());
    say(`Your OAuth app is saved in ${w.where}.`);
  }
  if (values['token-stdin']) {
    const r = await S.savePat(await io.stdin());
    say(`Signed in with your token; saved in ${r.where.where}. Revoke it any time at https://supabase.com/dashboard/account/tokens.`);
  } else if (values['sign-in'] || values['client-id'] || !S.loadToken()) {
    const r = await S.signIn({ open: url => { say(`Opening ${url} in your browser to sign in to Supabase (it waits up to 5 minutes)…`); if (!openUrl(url)) say(`Open it yourself: ${url}`); } });
    say(`Signed in to Supabase; the sign-in is saved in ${r.where.where}.`);
  }
  if (values.create) {
    if (!values.name || !values.org) throw new Error('--create needs --name <name> and --org <organization slug> (and --region; run without it to list them)');
    if (!values.region) {
      const regions = await S.regions(values.org);
      if (json) { io.printJson({ need: 'region', regions }); return 0; }
      say(`Pick a region for "${values.name}" (--region <code>):`, ...regions.map(r => `  ${r.code.padEnd(16)} ${r.name}${r.recommended ? '  (recommended near you)' : ''}`));
      return 0;
    }
  }
  if (!values.project && !values.create) {
    const [orgs, projects] = await Promise.all([S.organizations(), S.projects()]);
    if (json) { io.printJson({ need: 'project', organizations: orgs, projects: projects.map(p => ({ ref: p.ref, name: p.name, region: p.region, status: p.status, organization: p.organization_slug })) }); return 0; }
    say('Your Supabase projects (an existing one first: the free plan has 2 active projects):');
    for (const p of projects) say(`  ${p.ref}  ${p.name}  ${p.region}  ${p.status}${/INACTIVE|PAUS/.test(p.status) ? '  (paused: restore it in the dashboard)' : ''}`);
    if (!projects.length) say('  (none yet)');
    say('', `Organizations: ${orgs.map(o => `${o.slug} (${o.name})`).join(', ') || 'none'}`, '',
      `Then: npx gamesfun backend connect supabase ${shown(gameDir)} --project <ref>`,
      `  or: npx gamesfun backend connect supabase ${shown(gameDir)} --create --name <name> --org <slug> --region <code>`);
    return 0;
  }
  const anonymous = !!values['anonymous-sign-ins'];
  const r = await B.connectWithKit(gameDir, values.create ? { create: { name: values.name, org: values.org, region: values.region }, anonymous } : { project: values.project, anonymous }, { onWait: s => say(`  waiting for the project (${s})…`) });
  if (json) { io.printJson({ game: shown(gameDir), settings: r.settings, created: r.created, ...(r.created ? { dbPassword: `generated and kept in ${r.dbPassSaved.where} (npx gamesfun backend password ${r.project.ref}, in your own terminal)` } : {}) }); return 0; }
  say(`Connected ${shown(gameDir)} to ${r.project.name} (${r.project.ref}, ${r.project.region}).`,
    `  backend.json: ${r.settings.url}, ${r.settings.keyKind} key; the client is at gf/backend/.`);
  if (r.created) say(`  The database password was generated and kept in ${r.dbPassSaved.where}; see it with: npx gamesfun backend password ${r.project.ref}`);
  say('Next: write tables in supabase/migrations/ (skill gamesfun-backend), then npx gamesfun backend check.');
  return 0;
}

/** The kit-sign-in routes of the studio panel, at /api/backend/supabase/… */
function routes(router, ctx, { HttpError, readJson, fail }) {
  const { gameDir } = ctx;
  const wrap = fn => async (req, res, params) => { try { return await fn(req, res, params); } catch (e) { if (e instanceof HttpError) throw e; fail(e); } };
  let signing = null;
  router.post('/supabase/add-mcp', wrap(async () => ({ agents: await mcp.addServer() })));
  router.post('/supabase/token', wrap(async req => { const b = await readJson(req, { limit: 4096 }); const r = await S.savePat(b.token); return { saved: r.where.kind }; }));
  router.post('/supabase/sign-in', wrap(async () => {
    if (signing) return { startUrl: signing };
    let resolveStart;
    const started = new Promise(r => { resolveStart = r; });
    const run = S.signIn({ open: url => { signing = url; resolveStart(url); } });
    run.then(() => ctx.events.send('backend', { signedIn: true }), e => ctx.events.send('backend', { signedIn: false, error: e.message })).finally(() => { signing = null; });
    return { startUrl: await Promise.race([started, run.then(() => null)]) };
  }));
  router.get('/supabase/projects', wrap(async () => {
    const [organizations, projects] = await Promise.all([S.organizations(), S.projects()]);
    return { organizations, projects: projects.map(p => ({ ref: p.ref, name: p.name, region: p.region, status: p.status, organization: p.organization_slug })) };
  }));
  router.get('/supabase/regions', wrap(async req => ({ regions: await S.regions(req.query.get('org')) })));
  router.post('/supabase/connect', wrap(async req => {
    const B = await lib();
    const b = await readJson(req, { limit: 8192 });
    const pick = b.create ? { create: { name: b.create.name, org: b.create.org, region: b.create.region } } : { project: b.project };
    pick.anonymous = !!b.anonymous;
    const r = await B.connectWithKit(gameDir, pick);
    ctx.events.send('backend', { changed: true });
    // a new project's database password goes to the page once, for the person to keep; never logged
    return { settings: r.settings, created: r.created, dbPassword: r.dbPass, dbPasswordKept: r.dbPassSaved?.where ?? null };
  }));
  router.get('/supabase/check-live', wrap(async () => (await lib()).checkLive(gameDir)));
}

export default {
  id: 'supabase',
  label: 'Supabase',
  kind: 'database',
  about: 'A Postgres database with row-level security, player sign-in (anonymous) and edge functions, in your own Supabase account. Free plan: 2 active projects, paused after a week without use.',
  ways: [
    { id: 'mcp', label: 'Through your agent (Supabase\'s MCP server)', needs: 'Claude Code or Codex; you sign in in your browser' },
    { id: 'pat', label: 'A personal access token', needs: 'a token from supabase.com/dashboard/account/tokens' },
    { id: 'oauth', label: 'Sign in from the kit', needs: 'an OAuth app registered with Supabase (games.fun\'s, once the creator registers one, or your own)' },
    { id: 'paste', label: 'Paste the URL and publishable key', needs: 'the Supabase dashboard' },
  ],
  publicKey: S.isPublicKey,
  settings({ url, key = null, project = null }) {
    const u = new URL(url);
    const ref = project?.ref ?? (/^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1] ?? null);
    return {
      ...(key != null ? { key, keyKind: String(key).startsWith('sb_publishable_') ? 'publishable' : 'anon-jwt' } : {}),
      ...(ref || project ? { project: { ref, name: project?.name ?? null, region: project?.region ?? null, organization: project?.organization ?? project?.organization_slug ?? null } } : {}),
    };
  },
  status({ env = process.env } = {}) {
    const t = S.loadToken({ env }), a = S.app({ env });
    return { signedIn: t ? { kind: t.kind, expires_at: t.expires_at } : null, oauthApp: a ? { via: a.via, own: !!a.own } : null };
  },
  disconnect: opts => S.disconnect(opts),
  agentSteps: () => ({ steps: mcp.manualSteps(), tools: mcp.AGENT_TOOLS, request: REQUEST }),
  cli: { options: cliOptions, usage: cliUsage, connect },
  routes,
  panel: '/studio/tabs/backend/supabase.js',
};
