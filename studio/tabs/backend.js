// Saves & scores (the Backend tab, id 'backend'): a game needs none. With none, the tool opens on pictures of what one
// gives a game (high scores, saved progress, player accounts, its own server: studio/tabs/backend/model.js), then the
// services that give them (Supabase, Railway), each a card with its connection light and one button. Picking one
// mounts its panel (studio/tabs/backend/<id>.js, listed by /api/backend/status; the provider shape is
// lib/backend/providers.mjs), whose connect flow is drawn as a stepper (studio/tabs/backend/flow-ui.js). With a backend
// connected: the service and its light, what the game has now, the checks (no secrets in the game, row-level security
// on every table), the provider's panel, and Remove.
//
// A panel module exports `default { id, mount(el, pctx) }`; pctx is this tab's ctx plus { provider (its status
// entry), game (the game's backend status), refresh(), line(tone, text), el }. mount may return a cleanup function.
//
// A tool of the studio's layout (docs/ARCHITECTURE.md): in the Share group after Publish and before Economy, in the
// inspector beside the game. It asks the person's session only through the conversation (ctx.chat.ask / send); a page
// with no conversation (a test page) has no ctx.chat, and the tab then only says what to ask.
import { BENEFITS, SERVICES, ICONS, benefitsOf, lightOf } from './backend/model.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) (k in e && k !== 'list') ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.flat().filter(k => k != null && k !== false));
  return e;
};
const line = (tone, text) => el('div', { className: `check-line ${tone}` }, text);
const icon = (name, cls = 'sv-ico') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name] ?? ''; return s; };
const lamp = l => el('span', { className: 'sv-light', 'data-tone': l.tone }, el('span', { className: 'sv-lamp', 'aria-hidden': 'true' }), l.words);
function useStylesheet() {
  if (document.querySelector('link[data-tab-css="backend"]')) return;
  const l = el('link', { rel: 'stylesheet', href: '/studio/tabs/backend.css' }); l.dataset.tabCss = 'backend';
  document.head.append(l);
}

export default {
  id: 'backend',
  label: 'Saves & scores',
  group: 'Share',
  order: 35,                     // Publish is 30, Economy 40 (web3 keeps Economy last)
  icon: ICONS.scores,
  async mount(root, ctx) {
    useStylesheet();
    let cleanup = null, picked = null;
    const body = el('div', { className: 'sv' });
    root.append(body);

    async function mountPanel(where, prov, status) {
      cleanup?.(); cleanup = null;
      if (!prov.panel) { where.replaceChildren(el('ol', { className: 'timeline' }, ...prov.agent.steps.map(s => el('li', {}, s)))); return; }
      try {
        const mod = (await import(prov.panel)).default;
        cleanup = await mod.mount(where, { ...ctx, provider: prov, game: status.game, refresh: paint, line, el }) ?? null;
      } catch (e) { where.replaceChildren(el('p', { className: 'error-box' }, `${prov.panel} did not load: ${e.message}`)); }
    }

    /** The four picture cards. `lit`: the benefits the game has now (connected), else null (choosing). */
    function benefitGrid(lit = null, onPick = null) {
      return el('div', { className: 'sv-benefits', role: 'list' }, ...BENEFITS.map(b => {
        const has = lit ? lit.includes(b.id) : null;
        const card = el(onPick ? 'button' : 'div', { className: 'sv-benefit', role: 'listitem', 'data-id': b.id, ...(onPick ? { type: 'button', title: `Which services give ${b.title.toLowerCase()}` } : {}), ...(has === null ? {} : { 'data-has': String(has) }) },
          el('span', { className: 'sv-pic' }, icon(b.id, 'sv-pic-ico'), has ? el('span', { className: 'sv-badge' }, icon('tick', 'sv-badge-ico')) : null),
          el('span', { className: 'sv-benefit-title' }, b.title),
          el('span', { className: 'sv-benefit-text' }, b.text));
        if (onPick) card.addEventListener('click', () => onPick(b));
        return card;
      }));
    }

    async function checks(box, kind) {
      let c;
      try { c = await ctx.api('backend/check'); } catch (e) { box.replaceChildren(line('bad', e.message)); return; }
      const secrets = line(c.scan.ok ? 'ok' : 'bad', c.scan.ok ? `No secrets in the game's ${c.scan.files} files.` : `Secrets in the game's files: ${c.scan.hits.map(h => `${h.file}: ${h.kind}`).join('; ')}`);
      // a server (Railway) has no tables of the game's: only the secrets line
      if (kind === 'server') { box.replaceChildren(secrets); return; }
      box.replaceChildren(
        secrets,
        line(c.rls.ok ? 'ok' : 'bad', c.rls.migrations.length || c.rls.used.length ? `Each table locked to its players (row-level security): ${c.rls.ok ? 'on every table' : 'refused'} (${c.rls.migrations.length} table file${c.rls.migrations.length === 1 ? '' : 's'}; the game reads ${c.rls.used.join(', ') || 'no table'}).` : 'No tables yet. Ask your session for one, for example "a high-score table" or "save each player\'s progress".'),
        ...c.rls.refused.map(r => line('bad', r)), ...c.rls.warned.map(w => line('warn', w)));
      // a table is the session's work: ask it in the conversation's one box, with this tool as the chip
      if (ctx.chat?.ask) {
        const ask = el('button', { type: 'button', className: c.rls.migrations.length ? 'ghost small' : 'small' }, c.rls.migrations.length ? 'Ask my session for another table' : 'Ask my session for a table');
        ask.addEventListener('click', () => ctx.chat.ask({
          label: 'Saves & scores',
          placeholder: 'e.g. a high-score table, or save each player\'s progress',
          compose: words => `For this game's backend (backend.json): ${words}. Follow the gamesfun-backend skill: a migration in supabase/migrations/ with row-level security on every table, the game reaches it only through gf/backend/, then npx gamesfun backend check passes.`,
          button: 'Ask my session',
        }));
        box.append(el('div', { className: 'toolbar' }, ask));
      }
    }

    /** A service as a card: its picture, name, light, what it gives, and (when choosing) its button. */
    function serviceCard(p, status, { button = true, primary = false } = {}) {
      const s = SERVICES[p.id] ?? { icon: p.kind === 'database' ? 'database' : 'server', tagline: p.about, best: null };
      const light = lightOf(p, status.game);
      const card = el('div', { className: 'sv-service', 'data-id': p.id, 'data-tone': light.tone },
        el('span', { className: 'sv-logo', 'aria-hidden': 'true' }, icon(s.icon, 'sv-logo-ico')),
        el('div', { className: 'sv-service-main' },
          el('div', { className: 'sv-service-head' }, el('b', {}, p.label), s.best ? el('span', { className: 'sv-best' }, s.best) : null),
          el('div', { className: 'sv-service-text' }, s.tagline),
          el('div', { className: 'sv-gives' }, ...benefitsOf(p.id).map(id => el('span', { className: 'sv-give', title: BENEFITS.find(b => b.id === id).title }, icon(id, 'sv-give-ico'), BENEFITS.find(b => b.id === id).title))),
          lamp(light)));
      if (button) {
        const go = el('button', { type: 'button', className: primary ? '' : 'ghost' }, `Use ${p.label}`);
        go.addEventListener('click', () => { picked = p.id; paint(); });
        card.append(el('div', { className: 'sv-service-go' }, go));
      }
      return card;
    }

    async function paint() {
      let s;
      try { s = await ctx.api('backend/status'); } catch (e) { body.replaceChildren(el('p', { className: 'error-box' }, e.message)); return; }
      const set = s.game.settings;
      const settingsError = s.game.settingsError ? [el('p', { className: 'error-box' }, s.game.settingsError)] : [];

      // ---- connected: the service, what the game has now, the checks, its panel, Remove
      if (set) {
        const prov = s.providers.find(p => p.id === set.provider);
        const panel = el('div', { className: 'sv-panel' }), checkBox = el('div');
        const remove = el('button', { type: 'button', className: 'ghost small danger' }, 'Remove from this game');
        remove.addEventListener('click', async () => {
          if (!confirm('Remove backend.json and gf/backend/ from this game? The database itself is not touched.')) return;
          await ctx.api('backend/disconnect', { provider: set.provider, fromGame: true }).catch(e => ctx.toast(e.message, 'error'));
          picked = null; paint();
        });
        const light = lightOf(prov ?? { id: set.provider }, s.game);
        body.replaceChildren(
          el('div', { className: 'sv-connected', 'data-tone': light.tone },
            el('span', { className: 'sv-logo', 'aria-hidden': 'true' }, icon(SERVICES[set.provider]?.icon ?? 'database', 'sv-logo-ico')),
            el('div', { className: 'sv-service-main' },
              el('div', { className: 'sv-service-head' }, el('b', {}, prov?.label ?? set.provider)),
              lamp(light),
              el('div', { className: 'sv-where' }, `${set.project?.name ? `${set.project.name} · ` : ''}${set.url}`))),
          el('h3', {}, 'What your game has now'), benefitGrid(benefitsOf(set.provider)),
          el('h3', {}, 'Checks'), checkBox, panel,
          el('details', { className: 'sv-details' }, el('summary', {}, 'Details'),
            el('p', { className: 'sv-small' }, `${set.keyKind ? `${set.keyKind === 'publishable' ? 'A publishable' : 'An anon'} key in backend.json (public by design). ` : ''}The game reaches it through ${s.game.client ?? 'gf/backend/ (missing: connect again)'}.`)),
          el('div', { className: 'toolbar end' }, remove));
        await checks(checkBox, prov?.kind);
        if (prov) await mountPanel(panel, prov, s);
        return;
      }

      // ---- none yet: the pictures, then the services
      if (!picked || picked === 'choose') {
        // the service most games want first, and its button the one primary
        const order = [...s.providers].sort((a, b) => Number(!!SERVICES[b.id]?.best) - Number(!!SERVICES[a.id]?.best));
        const services = el('div', { className: 'sv-services' }, ...order.map((p, i) => serviceCard(p, s, { primary: i === 0 })));
        const showWho = b => {
          for (const c of services.children) c.dataset.match = b.by.includes(c.dataset.id) ? 'yes' : 'no';
          for (const c of grid.children) c.setAttribute('aria-pressed', String(c.dataset.id === b.id));
          services.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        };
        const grid = benefitGrid(null, showWho);
        body.replaceChildren(...settingsError,
          el('p', { className: 'sv-intro' }, 'Your game works without this. Add it when players should keep something between visits.'),
          grid,
          el('h3', {}, 'Where it lives'),
          services,
          el('p', { className: 'sv-small sv-foot' }, 'Free to start, in your own account. The game carries only public values; secrets stay with the service.'));
        return;
      }

      // ---- one service picked: its card, then its panel (the connect flow as a stepper)
      const prov = s.providers.find(p => p.id === picked);
      const panel = el('div', { className: 'sv-panel' });
      const back = el('button', { type: 'button', className: 'ghost small sv-back' }, icon('back'), 'Back');
      back.addEventListener('click', () => { picked = null; paint(); });
      body.replaceChildren(...[...settingsError, el('div', { className: 'toolbar' }, back),
        prov ? serviceCard(prov, s, { button: false }) : el('h3', {}, picked),
        panel, prov?.about ? el('details', { className: 'sv-details' }, el('summary', {}, `About ${prov.label}: plans and limits`), el('p', { className: 'sv-small' }, prov.about)) : null].filter(Boolean));
      if (prov) await mountPanel(panel, prov, s);
    }

    await paint();
    const off = ctx.on?.('backend', () => paint());
    return () => { off?.(); cleanup?.(); };
  },
};
