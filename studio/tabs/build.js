// Build: where the build loop is (step, round, verdict, play-tester) and a roll-back per saved round.
// Reads <game>/.gf-loop/state.json through GET /api/build/state; the loop library is its only writer.
import { loopView } from '../lib/loop-state.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) (k in e && k !== 'list') ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.filter(k => k != null));
  return e;
};
const clock = at => { const d = at ? new Date(at) : null; return d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };

export default {
  id: 'build',
  label: 'Build',
  order: 2,
  async mount(root, ctx) {
    const body = el('div');
    root.append(body);
    let timer = null, last = '';

    async function rollback(c) {
      if (!confirm(`Put the game back to ${c.label ?? `round ${c.round ?? c.id}`}? Changes since then are lost.`)) return;
      try { await ctx.api('build/rollback', { id: String(c.id) }); ctx.toast('Rolled back', 'ok'); } catch (e) { ctx.toast(e.message, 'error'); }
    }

    function paint(data) {
      const v = loopView(data.loop, data.verdict);
      body.replaceChildren();
      if (data.elsewhere) body.append(el('p', { className: 'error-box' }, `Your session is working on another game: ${data.elsewhere.name}${data.elsewhere.loop ? ` (${data.elsewhere.loop.status}, step ${data.elsewhere.loop.step})` : ''}. This studio shows ${ctx.game?.title ?? 'this game'}. To follow that build here, start the studio on it: node bin/gamesfun.mjs dev ${data.elsewhere.name}`));
      if (!v.present) {
        body.append(el('p', { className: 'muted' }, 'No build is running. When your session builds or changes this game with the gamesfun tools, its steps appear here.'));
      } else {
        const tone = v.status === 'failed' ? 'bad' : v.status === 'delivered' ? 'ok' : v.status === 'waiting-on-question' || v.status === 'cancelled' ? 'warn' : 'go';
        body.append(
          el('div', { className: 'conn', 'data-tone': tone, role: 'status' }, el('span', { className: `dot ${tone}` }), el('strong', {}, `${v.statusWords}: ${v.stepWords}`),
            v.why ? el('div', { className: 'small muted' }, v.why) : null,
            el('div', { className: 'small muted' }, `Round ${v.round} · ${v.counts.verifies} verify · ${v.counts.repairs} repair · ${v.counts.playtests} play-test${v.counts.playtests === 1 ? '' : 's'}${v.counts.rescues ? ` · ${v.counts.rescues} rescue` : ''}`)),
          ...(v.staleProof ? [el('p', { className: 'error-box' }, 'Delivered, but the files changed after the last play-test: the proof is out of date.')] : []));

        body.append(el('h3', {}, 'Verdict'));
        if (!v.verify) body.append(el('p', { className: 'muted' }, 'Verify has not run yet.'));
        else {
          body.append(el('p', {}, el('span', { className: `st ${v.verify.ok ? 'pass' : 'fail'}` }, v.verify.ok ? 'PASS' : 'FAIL'), ` verify ${v.verify.n ?? ''} ${clock(v.verify.at)}`, v.verify.ok || v.verify.playable ? '' : ' · not playable yet'));
          for (const f of v.failures) {
            body.append(el('div', { className: 'fail-card' }, el('strong', {}, `${f.n} ${f.name}`),
              f.rule ? el('div', { className: 'small' }, el('b', {}, 'Rule: '), f.rule) : null,
              f.fix ? el('div', { className: 'small' }, el('b', {}, 'Fix: '), f.fix) : null,
              f.detail ? el('div', { className: 'detail small' }, f.detail) : null));
          }
        }

        body.append(el('h3', {}, 'Play-tester'));
        if (!v.playtest) body.append(el('p', { className: 'muted' }, 'The play-tester has not played yet.'));
        else {
          body.append(el('p', {}, el('span', { className: `st ${v.playtest.ok ? 'pass' : 'fail'}` }, v.playtest.verdict.toUpperCase()), ` round ${v.playtest.round ?? ''} ${clock(v.playtest.at)}`));
          if (v.playtest.notes.length) body.append(el('ul', { className: 'notes' }, ...v.playtest.notes.map(n => el('li', {}, n))));
        }

        if (v.fixes.length) body.append(el('h3', {}, 'Automatic fixes'), el('ul', { className: 'notes' }, ...v.fixes.map(f => el('li', {}, `${f.fix} in ${f.file}`))));
        if (v.history.length) body.append(el('h3', {}, 'Steps so far'), el('ol', { className: 'timeline' }, ...v.history.slice().reverse().map(h => el('li', {}, el('span', { className: 'time mono' }, clock(h.at)), ` ${h.step} → ${h.next}`))));
      }

      body.append(el('h3', {}, 'Roll back'));
      if (!data.checkpoints.length) body.append(el('p', { className: 'muted' }, data.rollback ? 'No saved rounds yet. One is saved before each round of your session\'s work.' : 'Rolling back is not available in this kit yet.'));
      for (const c of data.checkpoints) {
        const b = el('button', { type: 'button', className: 'ghost' }, 'Roll back to this');
        b.addEventListener('click', () => rollback(c));
        body.append(el('div', { className: 'row' }, el('div', { className: 'name' }, c.label ?? `Round ${c.round ?? c.id}`, el('small', {}, clock(c.at))), b));
      }
    }

    async function poll() {
      try {
        const data = await ctx.api('build/state');
        const key = JSON.stringify(data);
        if (key !== last) { last = key; paint(data); }
      } catch (e) { body.replaceChildren(el('p', { className: 'error-box' }, e.message)); last = ''; }
    }
    await poll();
    timer = setInterval(poll, 2000);
    const off = ctx.on('verify', poll);
    return () => { clearInterval(timer); off(); };
  },
};
