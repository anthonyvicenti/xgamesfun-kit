// The Backend tab's Railway panel (the panel seam: studio/tabs/backend.js; the provider: lib/backend/providers/railway.mjs).
// One button for the game's own server: sign in to Railway in a new tab, pick the workspace, and the kit deploys its
// game server template there and writes only the server's URL into the game. Or deploy the template yourself and paste
// its URL. The panel keeps no state of its own: a deploy's steps are read from /api/backend/railway/progress.
export default {
  id: 'railway',
  async mount(root, ctx) {
    const { el, line, provider: prov, game } = ctx;
    const api = (p, b) => ctx.api(`backend/railway/${p}`, b);
    const note = el('div', { 'aria-live': 'polite' });
    const steps = el('ol', { className: 'timeline' });
    let timer = null, stopped = false, sawRunning = false;

    async function poll() {
      if (stopped) return;
      let p;
      try { p = await api('progress'); } catch (e) { note.replaceChildren(line('bad', e.message)); return; }
      steps.replaceChildren(...p.steps.map(s => el('li', {}, s)));
      if (p.running) { sawRunning = true; timer = setTimeout(poll, 1500); return; }
      if (p.error) note.replaceChildren(line('bad', `The last deploy stopped: ${p.error}`));
      // refresh once, when this panel saw the deploy finish (an earlier result is already what the tab shows)
      else if (p.url && sawRunning) { note.replaceChildren(line('ok', `The game's server is up at ${p.url}. backend.json holds only that URL.`)); ctx.refresh(); }
    }

    const signed = prov.status?.signedIn;
    const parts = [el('p', { className: 'muted small' }, prov.about)];
    const settings = game.settings?.provider === 'railway' ? game.settings : null;

    if (settings) {
      const again = el('button', { type: 'button', className: 'ghost' }, 'Deploy the server again');
      again.disabled = !signed || !settings.project?.ref;
      again.addEventListener('click', async () => {
        try { await api('connect', { projectId: settings.project.ref }); poll(); } catch (e) { note.replaceChildren(line('bad', e.message)); }
      });
      parts.push(
        el('p', {}, 'In rules.js: ', el('code', {}, "import { connectGameServer } from './gf/backend/server.js'"), ', then ', el('code', {}, "submitScore('main', score, name)"), ' at the end of a round and ', el('code', {}, "topScores('main')"), ' for the board.'),
        el('div', { className: 'toolbar' }, again), steps, note);
    } else if (!signed) {
      const signIn = el('button', { type: 'button' }, 'Sign in to Railway');
      signIn.addEventListener('click', async () => {
        signIn.disabled = true;
        try {
          const r = await api('sign-in', {});
          if (r.startUrl) window.open(r.startUrl, '_blank', 'noopener');
          note.replaceChildren(line('ok', 'Finish in the new tab: sign in to Railway (or make an account) and pick the workspace the kit may use. Then press "I have signed in".'),
            Object.assign(el('button', { type: 'button', className: 'ghost small' }, 'I have signed in'), { onclick: () => ctx.refresh() }));
        } catch (e) { note.replaceChildren(line('bad', e.message)); } finally { signIn.disabled = false; }
      });
      parts.push(el('p', { className: 'muted small' }, 'Nothing to register: the kit registers its own sign-in with Railway on this machine. The sign-in is kept in your system\'s keychain, or a private file in your user folder; never in the game.'),
        el('div', { className: 'toolbar' }, signIn), note);
    } else {
      const ws = el('select', { 'aria-label': 'Railway workspace' });
      const name = el('input', { type: 'text', placeholder: 'my-game-server', 'aria-label': 'Project name', maxLength: 40 });
      const go = el('button', { type: 'button' }, 'Create the game server');
      go.addEventListener('click', async () => {
        go.disabled = true;
        note.replaceChildren(line('ok', 'Deploying (a first deploy takes a few minutes)…'));
        try { await api('connect', { workspaceId: ws.value, workspaceName: ws.selectedOptions[0]?.textContent ?? null, name: name.value.trim() }); poll(); }
        catch (e) { note.replaceChildren(line('bad', e.message)); go.disabled = false; }
      });
      parts.push(el('div', { className: 'toolbar' }, ws, name, go), steps, note);
      api('workspaces').then(r => {
        if (!r.workspaces.length) { note.replaceChildren(line('warn', 'You shared no workspace with the kit. Sign the kit out and sign in again, then pick one on Railway\'s page.')); go.disabled = true; return; }
        ws.replaceChildren(...r.workspaces.map(w => el('option', { value: w.id }, w.name)));
      }, e => note.replaceChildren(line('bad', e.message)));
    }

    // the "everyone else" way: deploy the template yourself (any host), then paste the URL
    if (!settings) {
      const url = el('input', { type: 'url', placeholder: 'https://<service>.up.railway.app', 'aria-label': 'Server URL' });
      const use = el('button', { type: 'button', className: 'ghost' }, 'Use this server');
      const said = el('div', { 'aria-live': 'polite' });
      use.addEventListener('click', async () => {
        try { await ctx.api('backend/use', { provider: 'railway', url: url.value.trim() }); ctx.refresh(); } catch (e) { said.replaceChildren(line('bad', e.message)); }
      });
      parts.push(el('details', {}, el('summary', {}, 'Deploy the template yourself, then paste its URL'),
        el('p', { className: 'muted small' }, 'The template is templates/backends/railway-node/ in the kit (its README has the steps for Railway, Render, Fly.io and Cloudflare). Set GF_ORIGINS to this game\'s origins and GF_SECRET to a long random value on the host; only the URL goes in the game.'),
        el('div', { className: 'toolbar' }, url, use), said));
    }
    if (signed) {
      const out = el('button', { type: 'button', className: 'ghost small danger' }, 'Sign the kit out of Railway');
      out.addEventListener('click', async () => {
        try { const r = await ctx.api('backend/disconnect', { provider: 'railway' }); note.replaceChildren(line(r.revoked ? 'ok' : 'warn', r.note ?? 'Signed out.')); setTimeout(() => ctx.refresh(), 1500); } catch (e) { note.replaceChildren(line('bad', e.message)); }
      });
      parts.push(el('div', { className: 'toolbar end' }, out));
    }
    root.replaceChildren(...parts);
    poll();                                    // a deploy started before this panel was (re)mounted keeps reporting
    return () => { stopped = true; clearTimeout(timer); };
  },
};
