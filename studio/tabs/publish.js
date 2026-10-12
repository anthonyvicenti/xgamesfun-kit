// Publish: put this game on games.fun at a link anyone can play (games.fun hosts it). The same steps as
// `npx gamesfun login` and `npx gamesfun publish` (server/routes/publish.mjs → lib/publish/). The page never sees the
// sign-in token: it sees who is signed in.
//
// What it shows, top to bottom: the four steps (Sign in → Check → Publish → Share, each done / now / waiting /
// problem: studio/tabs/publish/model.js), the share card people will see (the game's title, its line and a picture:
// the newest verify screenshot, else a title card), the one next step (sign in, publish, or copy the link), a problem
// in plain words with what to do, the versions, and Details (the account, a private draft, "as a new game", the
// files check and the log).
import { STEPS, stepsOf, currentStep, plainError, pickShot, versionsOf, ago, shortLink } from './publish/model.js';

const el = (tag, { dataset, ...attrs } = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs); Object.assign(e.dataset, dataset ?? {}); e.append(...kids.flat().filter(k => k != null && k !== false)); return e; };
const svg = (paths, cls = 'pub-ico') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = paths; return s; };
const mb = n => `${(n / 1048576).toFixed(1)} MB`;
const ICON = {
  signin: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  check: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  publish: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  done: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  problem: '<path d="M12 7v6"/><path d="M12 17h.01"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
};
function useStylesheet() {
  if (document.querySelector('link[data-tab-css="publish"]')) return;
  const l = el('link', { rel: 'stylesheet', href: '/studio/tabs/publish.css' }); l.dataset.tabCss = 'publish';
  document.head.append(l);
}

export default {
  id: 'publish',
  label: 'Publish',
  group: 'Share',
  order: 30,
  // the flow's last step: also a primary button beside the preview's bar (studio.js), which opens this tool
  action: { label: 'Publish' },
  async mount(root, ctx) {
    useStylesheet();
    const wrap = el('div', { className: 'pub' });
    root.append(wrap);

    // ---- the pieces (made once; render() fills them)
    const steps = el('ol', { className: 'pub-steps', ariaLabel: 'Publishing steps' });
    const account = el('div', { className: 'conn pub-account', dataset: { state: 'idle' } });
    const signIn = el('button', { type: 'button', className: 'pub-go' }, 'Sign in to games.fun');
    const signOut = el('button', { type: 'button', className: 'ghost small' }, 'Sign out');
    const pic = el('div', { className: 'pub-pic' });
    const cardTitle = el('div', { className: 'pub-title' });
    const cardHook = el('div', { className: 'pub-hook' });
    const cardLink = el('div', { className: 'pub-cardlink' });
    const card = el('figure', { className: 'pub-card', ariaLabel: 'What people will see' }, pic, el('figcaption', {}, cardTitle, cardHook, cardLink));
    const live = el('div', { className: 'pub-live', hidden: true });
    const problem = el('div', { className: 'pub-problem', hidden: true });
    const publish = el('button', { type: 'button', className: 'pub-go', dataset: { testid: 'publish-run' } }, 'Publish');
    const progress = el('div', { className: 'pub-progress', hidden: true, ariaLive: 'polite' });
    const act = el('div', { className: 'pub-act' }, signIn, publish);
    const hint = el('p', { className: 'pub-hint' });
    const result = el('div');
    const versions = el('ol', { className: 'pub-versions' });
    const versionsBox = el('section', { className: 'pub-section', hidden: true }, el('h3', {}, 'Versions'), versions);
    // Details: what an advanced person (or their agent) may want
    const draft = el('button', { type: 'button', className: 'ghost small' }, 'Save a private draft');
    const asNewBox = el('input', { type: 'checkbox', role: 'switch' });
    const asNew = el('label', { className: 'pub-switch' }, asNewBox, el('span', { className: 'pub-knob', ariaHidden: 'true' }), el('span', {}, 'As a new game ', el('small', {}, '(a new link; the old one stays)')));
    const checks = el('div');
    const log = el('pre', { className: 'log', hidden: true });
    const where = el('p', { className: 'pub-small' });
    const details = el('details', { className: 'pub-details' }, el('summary', {}, 'Details'),
      el('div', { className: 'pub-details-body' }, asNew, el('div', { className: 'toolbar' }, draft, el('span', { className: 'pub-small' }, 'A version only you can see in your games.fun Studio.')),
        el('h3', {}, 'The files'), checks, where, el('h3', { hidden: true }, 'Log'), log));

    wrap.append(steps, problem, card, live, act, progress, hint, result, account, versionsBox, details);

    // ---- what we know
    let timer = null, last = null, check = null, verifyRun = null, shot = null;
    const game = { title: ctx.game?.title ?? 'This game', hook: ctx.game?.hook ?? '' };

    const start = async isDraft => {
      try { await ctx.api('publish/run', { draft: isDraft, newGame: asNewBox.checked }); ctx.toast(isDraft ? 'Saving a draft…' : 'Publishing…'); poll(); }
      catch (e) { ctx.toast(e.message, 'error'); }
    };
    publish.addEventListener('click', () => start(false));
    draft.addEventListener('click', () => start(true));
    signIn.addEventListener('click', async () => {
      // A new tab is opened at once (in the click, so no popup blocker stops it) and pointed at games.fun's sign-in.
      const tab = window.open('about:blank', '_blank');
      try { const { url } = await ctx.api('publish/login', {}); if (tab) tab.location.href = url; else window.open(url, '_blank'); poll(); }
      catch (e) { tab?.close(); ctx.toast(e.message, 'error'); }
    });
    signOut.addEventListener('click', async () => { try { await ctx.api('publish/logout', {}); ctx.toast('Signed out'); poll(); } catch (e) { ctx.toast(e.message, 'error'); } });

    const copy = async url => {
      try { await navigator.clipboard.writeText(url); ctx.toast('Link copied', 'ok'); }
      catch { const i = el('input', { value: url }); document.body.append(i); i.select(); try { document.execCommand('copy'); ctx.toast('Link copied', 'ok'); } catch { ctx.toast(url); } i.remove(); }
    };

    function drawSteps(list) {
      const now = currentStep(list);
      steps.replaceChildren(...list.map((s, i) => {
        const mark = s.state === 'done' ? svg(ICON.done, 'pub-mark-ico') : s.state === 'problem' ? svg(ICON.problem, 'pub-mark-ico') : svg(ICON[s.id], 'pub-mark-ico');
        const li = el('li', { dataset: { state: s.state, step: s.id } },
          el('span', { className: 'pub-mark' }, mark),
          el('span', { className: 'pub-step-label' }, s.label),
          el('span', { className: 'pub-step-note' }, s.note));
        li.title = `${i + 1}. ${s.label}: ${s.note}`;
        if (s.id === now) li.setAttribute('aria-current', 'step');
        return li;
      }));
    }

    function drawCard(url) {
      cardTitle.textContent = game.title;
      cardHook.textContent = game.hook || 'A game made with the games.fun kit.';
      cardHook.hidden = false;
      cardLink.replaceChildren(svg(ICON.link), el('span', {}, url ? shortLink(url) : 'Your link appears here once it’s published'));
      cardLink.classList.toggle('pending', !url);
      if (shot) {
        if (pic.dataset.src !== shot) { pic.dataset.src = shot; pic.replaceChildren(el('img', { src: shot, alt: `${game.title}, from its last health check`, loading: 'lazy' }), el('span', { className: 'pub-play' }, svg(ICON.play))); }
      } else if (pic.dataset.src !== 'card') {
        pic.dataset.src = 'card';
        // a title card: the game's name over the studio's colours (no screenshot yet: run a health check for one)
        pic.replaceChildren(el('div', { className: 'pub-titlecard' }, el('span', { className: 'pub-titlecard-name' }, game.title), el('span', { className: 'pub-play' }, svg(ICON.play))));
      }
    }

    function drawProblem(p, action = null) {
      problem.hidden = !p;
      if (!p) { problem.replaceChildren(); return; }
      problem.replaceChildren(svg(ICON.warn, 'pub-problem-ico'),
        el('div', {}, el('b', {}, p.title), p.text ? el('div', { className: 'pub-problem-text' }, p.text) : null, el('div', { className: 'pub-problem-todo' }, p.todo), action));
    }

    function render(s) {
      last = s;
      const who = s.signedIn, run = s.run ?? {}, r = run.result;
      const url = r?.url ?? s.known?.url ?? null;
      const list = stepsOf({ status: s, check, verify: verifyRun });
      drawSteps(list);
      drawCard(url);

      // account: who is signed in (the shots test waits for this line's words)
      account.dataset.state = who ? 'ok' : s.signIn?.state === 'waiting' ? 'warn' : 'idle';
      account.replaceChildren(el('span', { className: `dot ${who ? 'ok' : s.signIn?.state === 'waiting' ? 'warn' : ''}` }),
        el('span', {}, who ? `Signed in as ${who.email}` : s.signIn?.state === 'waiting' ? 'Waiting for you to approve this computer in the games.fun tab…' : 'Not signed in to games.fun'),
        ...(who ? [signOut] : []));

      // the one next step: sign in; publish; or (published) copy the link, with publishing an update as the ghost
      signIn.hidden = !!who;
      signIn.disabled = s.signIn?.state === 'waiting';
      signIn.textContent = s.signIn?.state === 'waiting' ? 'Waiting for games.fun…' : 'Sign in to games.fun';
      publish.hidden = !who;
      publish.disabled = draft.disabled = !who || run.running;
      publish.textContent = run.running ? 'Publishing…' : url ? 'Publish an update' : 'Publish';
      publish.classList.toggle('ghost', !!url);
      hint.textContent = run.running ? '' : !who ? 'Free, and you need no server: games.fun hosts it. Only people you give the link to can find it.'
        : url ? 'An update keeps the same link. People get the new version next time they open it.'
        : 'It checks the game first (about 2 minutes), then puts it online at its own link.';
      hint.hidden = !hint.textContent;

      // the link, big, once there is one
      live.hidden = !url || run.running;
      if (url && !run.running) {
        const copyBtn = el('button', { type: 'button', className: 'pub-copy' }, svg(ICON.copy), 'Copy link');
        copyBtn.addEventListener('click', () => copy(url));
        const open = el('a', { className: 'btn ghost', href: url, target: '_blank', rel: 'noopener' }, svg(ICON.open), 'Open');
        live.replaceChildren(el('div', { className: 'pub-live-head' }, el('span', { className: 'dot ok' }), 'Live: anyone with the link can play'),
          el('a', { className: 'pub-url', href: url, target: '_blank', rel: 'noopener', dataset: { testid: 'publish-link' } }, shortLink(url)),
          el('div', { className: 'toolbar' }, copyBtn, open));
      }

      // under way: the newest line in words, and the clock
      progress.hidden = !run.running;
      if (run.running) {
        const line = String(run.lines?.at(-1) ?? 'Starting…').trim().replace(/\(verify --quick;?[^)]*\)/, '(about 2 minutes)');
        progress.replaceChildren(el('span', { className: 'pub-spin', ariaHidden: 'true' }), el('span', {}, line), el('span', { className: 'pub-small' }, ` · since ${new Date(run.started).toLocaleTimeString()}`));
      }

      // a problem, in plain words with what to do
      if (run.error) drawProblem(plainError({ message: run.error, code: run.code }));
      else if (s.signIn?.state === 'failed') drawProblem({ title: 'Sign-in didn’t finish', text: s.signIn.error, todo: 'Press Sign in to try again.' });
      else if (check && check.ok === false) drawProblem(plainError(check));
      else if (check?.error) drawProblem(plainError({ message: check.error }));
      else drawProblem(null);

      // what the last run did
      result.replaceChildren();
      if (r && !r.url) {
        const failed = (r.verify?.failed ?? []).map(c => c.name).filter(Boolean);
        result.append(el('div', { className: 'pub-problem warn', dataset: { testid: 'publish-result' } }, svg(ICON.warn, 'pub-problem-ico'),
          el('div', {}, el('b', {}, `Saved as a private draft (version ${r.version?.number ?? '?'})`),
            el('div', { className: 'pub-problem-text' }, r.verify?.pass ? 'Only you can see it, in your games.fun Studio.' : `Some health checks didn’t pass${failed.length ? ` (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''})` : ''}, so it has no public link yet.`),
            el('div', { className: 'pub-problem-todo' }, r.verify?.pass ? 'Press Publish when you want a public link.' : 'Open Health check to see what failed, fix it (or ask your session), then publish again.'),
            el('div', { className: 'toolbar' }, r.verify?.pass ? null : el('a', { className: 'btn ghost small', href: '#verify' }, 'Open Health check'),
              r.studioUrl ? el('a', { className: 'btn ghost small', href: r.studioUrl, target: '_blank', rel: 'noopener' }, 'See it on games.fun') : null))));
      } else if (r?.url) {
        result.append(el('div', { className: 'pub-done', dataset: { testid: 'publish-result' } }, svg(ICON.done, 'pub-done-ico'),
          `Version ${r.version?.number ?? ''} is live. `, el('span', { className: 'pub-small' }, `${r.uploaded} new file${r.uploaded === 1 ? '' : 's'} sent; games.fun already had ${r.alreadyThere}.`)));
      }
      result.hidden = !result.children.length;
      if (run.error) problem.dataset.testid = 'publish-result'; else delete problem.dataset.testid;

      // versions, newest first
      const vs = versionsOf(s.known, s.live?.version?.number ?? null);
      versionsBox.hidden = !vs.length;
      versions.replaceChildren(...vs.slice(0, 8).map(v => el('li', { dataset: { kind: v.live ? 'live' : v.draft ? 'draft' : 'public' } },
        el('span', { className: 'pub-vdot', ariaHidden: 'true' }),
        el('span', { className: 'pub-vname' }, `Version ${v.version}`),
        el('span', { className: 'pub-vtag' }, v.live ? 'Live now' : v.draft ? 'Private draft' : 'Earlier'),
        el('span', { className: 'pub-small pub-vwhen' }, ago(v.at)))));

      log.hidden = !run.lines?.length; log.previousElementSibling.hidden = log.hidden;
      log.textContent = (run.lines ?? []).join('\n'); log.scrollTop = log.scrollHeight;
      where.textContent = `games.fun: ${s.studio ?? ''}${who ? ` · the sign-in is kept in ${s.store}, never in the game` : ''}${s.known?.projectId ? ` · game id ${s.known.projectId}` : ''}`;
    }

    async function loadChecks() {
      try {
        check = await ctx.api('publish/check');
        checks.replaceChildren(el('div', { className: `check-line ${check.ok ? 'ok' : 'bad'}` }, check.ok
          ? `${check.files} files, ${mb(check.bytes)}; nothing that looks like a key.${check.backend.length ? ` Once published it may talk to ${check.backend.join(', ')} (its saves & scores service) and nowhere else.` : ' Once published it talks to games.fun only.'}`
          : [...check.problems, check.secrets].filter(Boolean).join(' ')));
      } catch (e) { check = { error: e.message }; checks.replaceChildren(el('div', { className: 'error-box' }, e.message)); }
    }
    async function loadPicture() {
      try {
        const v = await ctx.api('game/verify');
        verifyRun = v.runs?.[0] ?? null;
        const withShots = (v.runs ?? []).find(x => x.shots?.length);
        shot = withShots ? pickShot(withShots.shots) : null;
      } catch { verifyRun = null; shot = null; }
    }
    async function poll() {
      clearTimeout(timer);
      try { const s = await ctx.api('publish/status'); render(s); if (s.run.running || s.signIn?.state === 'waiting') timer = setTimeout(poll, 1500); }
      catch (e) { drawProblem(plainError({ message: e.message })); }
    }
    drawSteps(STEPS.map(s => ({ ...s, state: 'waiting', note: '…' })));
    drawCard(null);
    await Promise.all([loadChecks(), loadPicture()]);
    await poll();
    const refresh = async () => { await Promise.all([loadChecks(), loadPicture()]); if (last) render(last); };
    const offs = [ctx.on('publish', () => poll()), ctx.on('game', refresh), ctx.on('verify', refresh)];
    return () => { offs.forEach(off => off()); clearTimeout(timer); };
  },
};
