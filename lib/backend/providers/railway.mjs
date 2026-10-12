// Railway as a backend provider (the shape is lib/backend/providers.mjs): kind 'server', the person's own server. The kit
// signs in to Railway in the person's browser, deploys the kit's game server template (leaderboards, saves, a live
// score feed) and writes only its public URL into the game. Railway's side is ../railway.mjs.
import { shown } from '../../games.mjs';
import { openUrl } from '../../open.mjs';
import * as R from '../railway.mjs';

// lib/backend/index.mjs imports this registry, so it is reached lazily here (no import cycle at load)
const lib = () => import('../index.mjs');

const REQUEST = game => `Give this game (${game}) its own server on Railway: run "npx gamesfun backend connect railway ${game}" in a terminal I can see, so my browser opens Railway's sign-in (I pick the workspace on Railway's page). If it lists more than one workspace, ask me which one. It deploys the kit's game server and writes only the server's public URL into backend.json. Then use gf/backend/server.js in rules.js for the leaderboard (submitScore at the end of a round, topScores for the board) and keep every secret out of the game.`;

const cliOptions = {
  workspace: { type: 'string' }, origin: { type: 'string', multiple: true }, image: { type: 'string' },
  'no-dev-origins': { type: 'boolean' },
  // shared with other providers' flags (the same names and types)
  name: { type: 'string' }, project: { type: 'string' }, 'sign-in': { type: 'boolean' },
};
const cliUsage = [
  'connect railway [game]              The game\'s own server (leaderboards, saves, a live feed) in your Railway account:',
  '                                    your browser signs in to Railway; the kit creates a project and a service from',
  '                                    its game server template and writes only the server\'s public URL into the game',
  '    --workspace <id>                the workspace to use (when you shared more than one on Railway\'s page)',
  '    --name <name>                   the new project\'s name (default: the game\'s folder name)',
  '    --project <id>                  deploy again into a project the kit made before',
  '    --origin <origin>               another exact origin the server lets in (repeatable; the games.fun play host and',
  '                                    this machine\'s dev server are always in); --no-dev-origins leaves the dev server out',
  '    --image <ref>                   deploy a published image of the template instead of uploading it',
  '    --sign-in                       sign in again (another account, or other workspaces)',
];

function say(json) { return (...l) => { if (!json) for (const x of l) console.log(x); }; }

/** `gamesfun backend connect railway …`. io: { printJson, stdin, resolveGame } */
async function connect(values, gameArg, io) {
  const json = values.json, out = say(json);
  const B = await lib();
  const gameDir = await io.resolveGame(gameArg);
  await B.assertClean(gameDir, 'before connecting');           // refuse before anything is made at Railway
  if (values['sign-in'] || !R.loadToken()) {
    // the link goes to stderr too under --json, so a person (or a test) can always finish the sign-in
    const tell = json ? l => process.stderr.write(`${l}\n`) : l => console.log(l);
    const r = await R.signIn({ open: url => {
      if (process.env.GAMESFUN_NO_OPEN === '1' || !openUrl(url)) tell(`Open this link in your browser to sign in to Railway (it waits up to 5 minutes): ${url}`);
      else tell(`Opening ${url} in your browser to sign in to Railway (it waits up to 5 minutes)…`);
    } });
    out(`Signed in to Railway; the sign-in is kept in ${r.where.where}.`);
  }
  let workspaceId = values.workspace ?? null, workspaceName = null;
  if (!values.project) {
    const ws = await R.workspaces();
    if (!ws.length) throw new Error('You shared no workspace with the kit on Railway\'s page. Sign in again and pick one: npx gamesfun backend connect railway --sign-in');
    if (!workspaceId && ws.length > 1) {
      if (json) { io.printJson({ need: 'workspace', workspaces: ws }); return 0; }
      out('Which Railway workspace (--workspace <id>)?', ...ws.map(w => `  ${w.id}  ${w.name}`));
      return 0;
    }
    const w = workspaceId ? ws.find(x => x.id === workspaceId) : ws[0];
    if (!w) throw new Error(`no shared workspace has the id ${workspaceId} (you shared: ${ws.map(x => `${x.id} ${x.name}`).join(', ')})`);
    workspaceId = w.id; workspaceName = w.name;
  }
  const extra = values.origin ?? [];
  const origins = R.gameOrigins(extra, { dev: !values['no-dev-origins'] });
  const name = values.name ?? (shown(gameDir).split(/[\\/]/).pop() || 'game').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
  const r = await connectGame(gameDir, values.project ? { projectId: values.project } : { workspaceId, workspaceName, name }, { origins, image: values.image ?? null, onStep: s => out(`  ${s}…`) });
  if (json) { io.printJson({ game: shown(gameDir), settings: r.settings, project: r.project, created: r.created, volume: r.volume }); return 0; }
  out(`Connected ${shown(gameDir)} to its own server: ${r.settings.url}`,
    `  backend.json holds only that URL; the server's secret stays on Railway. The client is gf/backend/server.js.`,
    r.volume ? '  Scores and saves are kept on a Railway volume.' : '  No volume: scores and saves reset at each deploy.',
    `  Railway project: ${r.project.name} (${r.project.id}). Disconnect the kit's sign-in any time: npx gamesfun backend disconnect railway`);
  return 0;
}

/** Deploy, then write backend.json (the URL only) and the client. → { settings, client, project, created, volume } */
export async function connectGame(gameDir, pick, o = {}) {
  const B = await lib();
  await B.assertClean(gameDir, 'before connecting');
  const d = await R.deployServer(pick, o);
  const r = await B.use(gameDir, { provider: 'railway', url: d.url, key: null, project: { ref: d.project.id, name: d.project.name, region: null, organization: pick.workspaceName ?? null }, players: 'anonymous', loopbackOk: true });
  return { ...r, project: d.project, created: d.created, volume: d.volume };
}

/** The studio panel's routes, at /api/backend/railway/… */
function routes(router, ctx, { HttpError, readJson, fail }) {
  const { gameDir } = ctx;
  const wrap = fn => async (req, res, params) => { try { return await fn(req, res, params); } catch (e) { if (e instanceof HttpError) throw e; fail(e); } };
  let signing = null, running = null;
  router.post('/railway/sign-in', wrap(async () => {
    if (signing) return { startUrl: signing };
    let resolveStart;
    const started = new Promise(r => { resolveStart = r; });
    const run = R.signIn({ open: url => { signing = url; resolveStart(url); } });
    run.then(() => ctx.events.send('backend', { provider: 'railway', signedIn: true }), e => ctx.events.send('backend', { provider: 'railway', signedIn: false, error: e.message })).finally(() => { signing = null; });
    return { startUrl: await Promise.race([started, run.then(() => null)]) };
  }));
  router.get('/railway/workspaces', wrap(async () => ({ workspaces: await R.workspaces() })));
  // a deploy takes minutes: answer at once; the panel reads /railway/progress (the tab is repainted on 'backend'
  // events, so the steps live here, not in the page)
  let progress = { running: false, steps: [], error: null, url: null };
  router.get('/railway/progress', wrap(async () => progress));
  router.post('/railway/connect', wrap(async req => {
    if (running) throw new HttpError(409, 'A Railway deploy is already running for this game.');
    const b = await readJson(req, { limit: 4096 });
    const extra = Array.isArray(b.origins) ? b.origins.map(String) : [];
    const pick = b.projectId ? { projectId: String(b.projectId) } : { workspaceId: String(b.workspaceId ?? ''), workspaceName: b.workspaceName ? String(b.workspaceName) : null, name: String(b.name ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'game' };
    const B = await lib();
    await B.assertClean(gameDir, 'before connecting');
    progress = { running: true, steps: [], error: null, url: null };
    running = connectGame(gameDir, pick, { origins: R.gameOrigins(extra), onStep: st => progress.steps.push(st) })
      .then(r => { progress = { ...progress, running: false, url: r.settings.url, volume: r.volume }; ctx.events.send('backend', { provider: 'railway', changed: true }); },
        e => { progress = { ...progress, running: false, error: e.message }; ctx.events.send('backend', { provider: 'railway', error: e.message }); })
      .finally(() => { running = null; });
    return { started: true };
  }));
}

export default {
  id: 'railway',
  label: 'Railway',
  kind: 'server',
  about: 'The game\'s own server (leaderboards, saves, a live score feed) in your own Railway account. You sign in in your browser; the kit deploys its game server template and writes only the server\'s URL into the game. Free plan: $1 of credit a month; Hobby $5.',
  ways: [
    { id: 'oauth', label: 'Sign in to Railway from the kit', needs: 'a Railway account; nothing to register (the kit registers its own sign-in client)' },
    { id: 'deploy-paste', label: 'Deploy the template yourself, then paste its URL', needs: 'the template in a public repository (templates/backends/railway-node/README.md)' },
  ],
  // a server host gives a game no key at all: only its public URL
  publicKey: () => false,
  settings({ project = null }) {
    return project ? { project: { ref: project.ref ?? null, name: project.name ?? null, region: project.region ?? null, organization: project.organization ?? null } } : {};
  },
  status: ({ env = process.env } = {}) => R.status({ env }),
  disconnect: ({ env = process.env } = {}) => R.disconnect({ env }),
  agentSteps: () => ({
    steps: [
      'In a terminal: npx gamesfun backend connect railway <game>',
      'Your browser opens Railway: sign in (or make an account) and pick the workspace the kit may use.',
      'The kit creates a project and a service, deploys its game server, and writes the server\'s URL to backend.json.',
    ],
    tools: [
      'gf/backend/server.js in rules.js: connectGameServer(), then submitScore(board, score, name), topScores(board), save(data), load(), live(board, fn)',
      'npx gamesfun backend check: no secret in the game',
    ],
    request: REQUEST,
  }),
  cli: { options: cliOptions, usage: cliUsage, connect },
  routes,
  panel: '/studio/tabs/backend/railway.js',
};
