// The start page: what the studio opens on when no game is open (`gamesfun dev` with no folder, or "All games").
// Nothing is played here. The person describes a game (the idea goes to their own agent session through the bridge,
// the same queue the conversation uses, and starts the build loop on a fresh folder), opens one of theirs, or starts
// from an example. Games and examples are picture cards: a game's newest verify screenshot, an example's own picture,
// else a title card drawn from its colours and words (lib/pictures.js; the pictures come from /api/pictures). With no
// session connected the page shows the connect picture (lib/connect-picture.js); it never calls a model.
import { connection, readQueue } from './lib/session.js';
import { sessionApi } from './lib/session-client.js';
import { cardState, iconFor, iconSvg, titleCardUrl } from './lib/pictures.js';
import { connectPicture, el, svg, useTalkStyles } from './lib/connect-picture.js';
import { ideaRequest } from './chat.js';

/** A few ideas to start from, one tap each: they fill the box, the person still presses Make it. */
export const IDEAS = [
  'A pillow fight in a backyard with my friends',
  'Four in a row on a giant board, we take turns',
  'A side-on platformer where we race to grab coins',
  'Tag in a haunted house: one ghost, everyone else hides',
  'Bumper boats in a pool, last one floating wins',
];

/** An empty shelf: a few blank cards and a sparkle (no games yet). */
const EMPTY_ART = '<svg viewBox="0 0 160 90" width="160" height="90" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="22" width="40" height="52" rx="6" stroke-dasharray="4 4"/><rect x="60" y="14" width="40" height="60" rx="6"/><rect x="110" y="22" width="40" height="52" rx="6" stroke-dasharray="4 4"/><path d="M80 32v16M72 40h16"/><path d="M128 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"/></svg>';

/** The picture of a card: the real one when there is one (falling back to the title card if it does not load). */
function picture(src, words, colours, alt) {
  const card = titleCardUrl({ words, colours });
  const img = el('img', { className: 'gc-img', alt, loading: 'lazy', decoding: 'async', src: src || card, 'data-kind': src ? 'shot' : 'card' });
  if (src) img.addEventListener('error', () => { img.src = card; img.dataset.kind = 'card'; }, { once: true });
  return img;
}

export function mountStart(root, ctx) {
  useTalkStyles();
  const box = el('textarea', { id: 'start-input', rows: 3, maxLength: 2000, placeholder: 'Describe your game…', 'aria-label': 'Describe your game' });
  const go = el('button', { id: 'start-go', type: 'button' }, 'Make it');
  const note = el('div', { className: 'start-note small', 'aria-live': 'polite' });
  const session = el('div', { className: 'start-session', 'data-part': 'session' });
  const chips = el('div', { className: 'start-ideas', role: 'group', 'aria-label': 'Ideas to start from' },
    ...IDEAS.map(t => el('button', { type: 'button', className: 'idea', on: { click: () => { box.value = t; box.focus(); } } }, svg(iconSvg(iconFor(t), 14)), el('span', {}, t))));
  const mine = el('div', { className: 'start-games' });
  const examples = el('div', { className: 'start-examples' });
  const exSection = el('section', { className: 'start-section', 'aria-labelledby': 'start-ex' }, el('h2', { id: 'start-ex' }, 'Start from an example'), el('p', { className: 'muted small' }, 'A finished game, copied for you to change.'), examples);

  root.replaceChildren(el('div', { className: 'start-inner talk-start' },
    el('div', { className: 'start-hero' },
      el('h1', {}, 'What do you want to ', el('span', {}, 'make'), '?'),
      el('p', { className: 'start-lede' }, 'Describe a game. Your agent pitches a few takes, you pick one, and it builds it here for you and your friends.'),
      el('div', { className: 'start-box' }, box, el('div', { className: 'start-box-row' }, note, go)),
      session, chips),
    el('section', { className: 'start-section', 'aria-labelledby': 'start-mine' }, el('h2', { id: 'start-mine' }, 'Your games'), mine),
    exSection));

  async function make() {
    const idea = box.value.trim();
    if (!idea) { box.focus(); note.textContent = 'Say what the game is first: a sentence is plenty.'; return; }
    go.disabled = true; note.textContent = '';
    try {
      const p = await ctx.api('studio/new', { idea });
      const r = await sessionApi('request', { text: ideaRequest(idea, `games/${p.name}`) });
      // say only what is true now: handed to a session that listens, or waiting for one
      ctx.toast(r.state === 'handed' ? 'Handed to your session: it starts with a pitch' : r.session ? 'Saved: your session gets it when it listens again' : 'Saved: no session is listening yet, so nothing is being made. It waits for your session', r.state === 'handed' ? 'ok' : '');
      box.value = '';
      await ctx.open(p.project);
    } catch (e) { note.textContent = `Not sent: ${e.message}`; }
    finally { go.disabled = false; }
  }
  go.addEventListener('click', make);
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); make(); } });

  async function openGame(name) {
    try { const r = await ctx.api('studio/project', { name }); await ctx.open(r.project); } catch (e) { ctx.toast(e.message, 'error'); }
  }
  async function fromExample(ex, btn) {
    btn.disabled = true; btn.textContent = 'Making a copy…';
    try { const r = await ctx.api('studio/example', { example: ex.id }); ctx.toast(`Made games/${r.name} from ${ex.title}`, 'ok'); await ctx.open(r.project); }
    catch (e) { ctx.toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Start from this'; }
  }

  let setup = null, shownSession = '';
  async function paintSession() {
    let q = null;
    try { q = await sessionApi('queue'); } catch { /* no bridge */ }
    const c = connection(readQueue(q));
    const key = JSON.stringify([c.state, c.hint, c.toolsNote, setup?.connected, setup?.plugin]);
    if (key === shownSession) return;                  // a repaint would reset the Copy button under the person's pointer
    shownSession = key;
    session.dataset.state = c.state;
    session.replaceChildren(...[connectPicture(c, { setup, compact: true }), c.toolsNote ? el('p', { className: 'muted small sp-note' }, c.toolsNote) : null].filter(Boolean));
  }

  function gameCard(g, pics) {
    const st = cardState(g);
    const p = pics?.games?.[g.name] ?? {};
    return el('button', { type: 'button', className: 'game-card pic-card', 'data-game': g.name, 'data-state': st.label.toLowerCase().replace(/ /g, '-'), on: { click: () => openGame(g.name) } },
      el('span', { className: 'gc-pic' }, picture(p.picture, `${g.title} ${g.hook ?? ''}`, p.colours ?? [], ''),
        el('span', { className: 'gc-state', 'data-tone': st.tone }, el('span', { className: 'dot' }), st.label)),
      el('span', { className: 'gc-body' },
        el('span', { className: 'game-card-title' }, g.title),
        g.hook ? el('span', { className: 'game-card-hook' }, g.hook) : null,
        st.note ? el('span', { className: 'gc-note' }, st.note) : null));
  }
  function exampleCard(ex, pics) {
    const b = el('button', { type: 'button', className: 'ghost small' }, 'Start from this');
    b.addEventListener('click', () => fromExample(ex, b));
    const p = pics?.examples?.[ex.id] ?? {};
    return el('div', { className: 'game-card pic-card example', 'data-example': ex.id },
      el('span', { className: 'gc-pic' }, picture(p.picture, `${ex.title} ${ex.summary ?? ''}`, [], ''),
        el('span', { className: 'gc-state', 'data-tone': 'lav' }, 'Example')),
      el('span', { className: 'gc-body' },
        el('span', { className: 'game-card-title' }, ex.title),
        el('span', { className: 'game-card-hook' }, ex.summary),
        el('span', { className: 'game-card-meta' }, b)));
  }

  async function paint() {
    let home, pics = null;
    try { [home, pics] = await Promise.all([ctx.api('studio/home'), ctx.api('pictures').catch(() => null)]); } catch (e) { mine.replaceChildren(el('p', { className: 'error-box' }, e.message)); return; }
    setup = home.setup;
    mine.replaceChildren(home.games.length
      ? el('div', { className: 'game-list' }, ...home.games.map(g => gameCard(g, pics)))
      : el('div', { className: 'empty talk-empty' }, svg(EMPTY_ART), el('p', {}, 'No games yet. Describe one above, or start from an example.'),
        el('button', { type: 'button', className: 'ghost small', on: { click: () => exSection.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }, 'See the examples')));
    examples.replaceChildren(el('div', { className: 'game-list' }, ...home.examples.map(ex => exampleCard(ex, pics))));
    shownSession = '';
    paintSession();
  }
  paint();
  const t = setInterval(paintSession, 4000);
  return { refresh: paint, focus: () => box.focus(), close: () => clearInterval(t) };
}
