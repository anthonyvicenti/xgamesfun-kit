// The Backend tab's Supabase panel (the panel seam: studio/tabs/backend.js). The usual way is the person's own agent:
// "Connect Supabase" asks their session to add Supabase's MCP server; they sign in in their browser; the agent writes the
// project's URL and publishable key with `gamesfun backend use`. Also: paste the two values, or sign in from the kit
// (a pasted token, or an OAuth app once one is registered: docs/BACKEND.md).
import { sessionApi } from '../../lib/session-client.js';
import { connection } from '../../lib/session.js';

export default {
  id: 'supabase',
  async mount(root, ctx) {
    const { el, line, provider: prov, game } = ctx;
    const api = (p, b) => ctx.api(`backend/supabase/${p}`, b);
    const parts = [];

    if (!game.connected) {
      // ---- the usual way: the person's own session
      const ask = el('button', { type: 'button' }, 'Connect Supabase');
      const addMcp = el('button', { type: 'button', className: 'ghost' }, 'Add Supabase to my agents');
      const said = el('div', { 'aria-live': 'polite' });
      const steps = () => el('ol', { className: 'timeline' }, ...prov.agent.steps.map(s => el('li', {}, s)));
      ask.addEventListener('click', async () => {
        ask.disabled = true;
        try {
          if (connection(await sessionApi('queue')).state === 'none') throw new Error('no session');
          const { text } = await ctx.api('backend/request', { provider: 'supabase' });
          // through the conversation when the page has one (the request shows in the thread), else straight to the bridge
          if (ctx.chat?.send) await ctx.chat.send(text); else await sessionApi('request', { text });
          said.replaceChildren(line('ok', 'Asked your session. It adds Supabase\'s MCP server and tells you how to sign in: your browser opens Supabase, you sign in and allow access to your organization. Nothing is registered, and the kit keeps no token.'));
        } catch {
          said.replaceChildren(line('warn', 'No session is connected to this page. Press "Add Supabase to my agents" and sign in from your agent, or follow these steps:'), steps());
        } finally { ask.disabled = false; }
      });
      addMcp.addEventListener('click', async () => {
        addMcp.disabled = true;
        try {
          const r = await api('add-mcp', {});
          said.replaceChildren(...(r.agents.length ? r.agents.map(a => line(a.status === 'failed' ? 'bad' : 'ok', `${a.name}: ${a.status}. ${['added', 'already added'].includes(a.status) ? a.signIn : a.output ?? ''}`)) : [line('warn', 'No Claude Code or Codex found on this machine. With another agent:'), steps()]));
        } catch (e) { said.replaceChildren(line('bad', e.message)); } finally { addMcp.disabled = false; }
      });

      const url = el('input', { type: 'url', placeholder: 'https://<ref>.supabase.co', 'aria-label': 'Project URL' });
      const key = el('input', { type: 'text', placeholder: 'sb_publishable_…', 'aria-label': 'Publishable key', autocomplete: 'off', spellcheck: false });
      const write = el('button', { type: 'button', className: 'ghost' }, 'Use these');
      const wrote = el('div', { 'aria-live': 'polite' });
      write.addEventListener('click', async () => {
        try { await ctx.api('backend/use', { provider: 'supabase', url: url.value.trim(), key: key.value.trim() }); key.value = ''; ctx.refresh(); } catch (e) { wrote.replaceChildren(line('bad', e.message)); }
      });
      parts.push(
        el('p', { className: 'muted small' }, prov.about),
        el('div', { className: 'toolbar' }, ask, addMcp), said,
        el('details', {}, el('summary', {}, 'Paste the URL and publishable key yourself'),
          el('p', { className: 'muted small' }, 'From your project in the Supabase dashboard: Project settings → API keys. Only the publishable (or anon) key: a secret one is refused.'),
          el('div', { className: 'row' }, el('span', {}, 'Project URL'), el('div', { className: 'edit' }, url)),
          el('div', { className: 'row' }, el('span', {}, 'Publishable key'), el('div', { className: 'edit' }, key)),
          el('div', { className: 'toolbar' }, write), wrote));
    }

    // ---- the kit's own sign-in
    const kit = el('details', {}, el('summary', {}, game.connected ? 'The kit\'s own Supabase sign-in' : 'Sign in from the kit instead'));
    const kitBody = el('div');
    kit.append(kitBody);
    parts.push(kit);
    root.replaceChildren(...parts);

    const signed = prov.status?.signedIn;
    const note = el('div', { 'aria-live': 'polite' });
    if (!signed) {
      const pat = el('input', { type: 'password', placeholder: 'sbp_…', 'aria-label': 'Personal access token', autocomplete: 'off' });
      const save = el('button', { type: 'button', className: 'ghost' }, 'Save token');
      save.addEventListener('click', async () => { try { await api('token', { token: pat.value }); pat.value = ''; ctx.refresh(); } catch (e) { note.replaceChildren(line('bad', e.message)); } });
      const signIn = el('button', { type: 'button', className: 'ghost', disabled: !prov.status?.oauthApp }, 'Sign in with Supabase');
      signIn.addEventListener('click', async () => {
        try { const r = await api('sign-in', {}); window.open(r.startUrl, '_blank', 'noopener'); note.replaceChildren(line('ok', 'Finish signing in in the new tab; this page updates when you are back.')); } catch (e) { note.replaceChildren(line('bad', e.message)); }
      });
      kitBody.append(
        el('p', { className: 'muted small' }, 'A personal access token from supabase.com/dashboard/account/tokens (scope it to one organization). The kit keeps it in your system\'s keychain, or a private file in your user folder; never in the game or the kit\'s folder.'),
        el('div', { className: 'toolbar' }, pat, save),
        el('p', { className: 'muted small' }, prov.status?.oauthApp ? 'Or sign in in your browser through the OAuth app set up on this machine.' : 'A one-click sign-in from the kit needs an OAuth app registered with Supabase; none is set up here (docs/BACKEND.md).'),
        el('div', { className: 'toolbar' }, signIn), note);
      return;
    }
    const out = el('button', { type: 'button', className: 'ghost small danger' }, 'Sign the kit out');
    out.addEventListener('click', async () => { await ctx.api('backend/disconnect', { provider: 'supabase' }); ctx.refresh(); });
    if (game.connected) {
      const live = el('button', { type: 'button', className: 'ghost small' }, 'Check the project too');
      live.addEventListener('click', async () => {
        try { const r = await api('check-live'); note.replaceChildren(line(r.ok ? 'ok' : 'bad', r.ok ? 'The project: every table has row-level security.' : 'The project:'), ...r.refused.map(x => line('bad', x)), ...r.warned.map(x => line('warn', x))); } catch (e) { note.replaceChildren(line('bad', e.message)); }
      });
      kitBody.append(el('p', { className: 'muted small' }, `Signed in (${signed.kind}).`), el('div', { className: 'toolbar' }, live, out), note);
      return;
    }
    kitBody.append(el('p', { className: 'muted' }, 'Loading your projects…'));
    let list;
    try { list = await api('projects'); } catch (e) { kitBody.replaceChildren(line('bad', e.message), el('div', { className: 'toolbar' }, out)); return; }
    const anon = el('input', { type: 'checkbox', checked: true });
    const use = async body => {
      note.replaceChildren(line('ok', 'Connecting (a new project takes a minute or two to come up)…'));
      try {
        const r = await api('connect', { ...body, anonymous: anon.checked });
        if (r.dbPassword) {
          // shown once, here only; never logged
          note.replaceChildren(el('div', { className: 'conn', 'data-tone': 'warn' }, el('b', {}, 'Database password (shown once): '), el('code', {}, r.dbPassword), el('br'), el('span', { className: 'muted small' }, `Keep it in your password manager. The kit also kept it in ${r.dbPasswordKept}. It never goes in the game.`)),
            Object.assign(el('button', { type: 'button', className: 'ghost small' }, 'I have kept it'), { onclick: () => ctx.refresh() }));
        } else ctx.refresh();
      } catch (e) { note.replaceChildren(line('bad', e.message)); }
    };
    const rows = list.projects.map(p => el('div', { className: 'row' }, el('span', {}, p.name, el('small', {}, `${p.ref} · ${p.region} · ${p.status}`)),
      el('div', { className: 'edit' }, /INACTIVE|PAUS/.test(p.status) ? el('span', { className: 'muted small' }, 'Paused: restore it in the Supabase dashboard') : Object.assign(el('button', { type: 'button', className: 'small' }, 'Use'), { onclick: () => use({ project: p.ref }) }))));
    const name = el('input', { type: 'text', placeholder: 'my-game', 'aria-label': 'New project name' });
    const org = el('select', { 'aria-label': 'Organization' }, ...list.organizations.map(o => el('option', { value: o.slug }, o.name)));
    const region = el('select', { 'aria-label': 'Region' });
    const loadRegions = async () => { try { const r = await api(`regions?org=${encodeURIComponent(org.value)}`); region.replaceChildren(...r.regions.map(x => el('option', { value: x.code, selected: x.recommended }, `${x.name}${x.recommended ? ' (near you)' : ''}`))); } catch (e) { note.replaceChildren(line('bad', e.message)); } };
    org.addEventListener('change', loadRegions);
    if (list.organizations.length) loadRegions();
    const create = el('button', { type: 'button', className: 'ghost' }, 'Create and connect');
    create.addEventListener('click', () => use({ create: { name: name.value.trim(), org: org.value, region: region.value } }));
    kitBody.replaceChildren(
      el('h3', {}, 'Your projects'), ...(rows.length ? rows : [el('div', { className: 'empty' }, 'No projects yet: create one below.')]),
      el('h3', {}, 'A new project'), el('p', { className: 'muted small' }, 'The free plan has two active projects; use an existing one when you can.'),
      el('div', { className: 'toolbar' }, name, org, region, create),
      el('label', { className: 'muted small' }, anon, ' Turn on anonymous sign-ins (each player gets an id for their own scores and saves)'),
      note, el('div', { className: 'toolbar end' }, out));
  },
};
