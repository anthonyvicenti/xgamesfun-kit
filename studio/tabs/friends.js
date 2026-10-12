// Play with friends: a picture of the idea (your screen hosts, your friend's joins), numbered steps that tick off as
// they happen (room hosted → friend's tab open → friend joined → playing), the room code big with Copy, the players as
// avatars, and the game's controls drawn as keys and a mouse. On this machine a second tab is the friend; with online
// play on, friends on other computers join with the code. The pure parts: studio/tabs/friends/room.js.
import { controlRows, initial, onlineOn, roomFrom, stepsFor } from './friends/room.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    if (k === 'style' && typeof v === 'object') { Object.assign(e.style, v); continue; }
    (k in e && k !== 'list' && !k.startsWith('aria-') && !k.startsWith('data-')) ? (e[k] = v) : e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (inner, { size = 18, cls = 'ico', width = 1.8, box = '0 0 24 24' } = {}) => {
  const s = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: box, width: size, height: size, class: cls, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  s.innerHTML = inner;
  return s;
};
const ICON = {
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  home: '<path d="M4 11l8-7 8 7v9H4v-9Z"/><path d="M10 20v-5h4v5"/>',
  solo: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
};
/** A mouse with the button that does it lit: left, right, or the whole mouse for looking. */
function mouseIcon(button) {
  const lit = button === 'left' ? '<path d="M12 3a6 6 0 0 0-6 6v1h6V3Z" class="lit"/>' : button === 'right' ? '<path d="M12 3a6 6 0 0 1 6 6v1h-6V3Z" class="lit"/>' : '';
  const arrows = button === 'move' ? '<path d="M2 12h2M20 12h2M3 10.5 1.6 12 3 13.5M21 10.5l1.4 1.5-1.4 1.5" />' : '';
  return svg(`${lit}<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M6 10h12M12 3v7"/>${arrows}`, { size: 26, cls: 'fr-mouse', width: 1.6 });
}

function useStyles() {
  if (document.querySelector('link[data-friends]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: '/studio/tabs/friends/friends.css', 'data-friends': '1' }));
}

/** The room and the online word, read from the game's own page in the preview (same origin; read only). */
function readPreview(frame) {
  try {
    const w = frame?.contentWindow, d = frame?.contentDocument;
    let snap = null;
    try { snap = w?.__party?.snapshot?.() ?? null; } catch {}
    const pageCode = (d?.getElementById('mp-code') ?? d?.getElementById('gf-room-code'))?.textContent?.trim() || null;
    const invite = d?.getElementById('mp-invite')?.value || null;
    return { room: roomFrom(snap, pageCode), invite, config: w?.GF_P2P_CONFIG ?? null };
  } catch { return { room: roomFrom(null), invite: null, config: null }; }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = el('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
    document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    t.remove(); return ok;
  }
}

/** A player's round avatar: their colour, their initial. */
const avatar = (p, size = 'md') => el('span', { className: `fr-av ${size}`, style: p?.color ? { background: p.color } : null, title: p?.name ?? '' }, p ? initial(p.name) : '?');

export default {
  id: 'friends',
  label: 'Play with friends',
  group: 'Test',
  order: 30,
  async mount(root, ctx) {
    useStyles();
    root.classList.add('friends-tool');
    const mode = ctx.game.multiplayer;

    // the controls never change while the tab is open: drawn once
    const controls = el('section', { className: 'fr-controls' }, el('h3', {}, 'How to play'),
      el('ul', { className: 'fr-keys' }, controlRows(ctx.game.controls, { camera: ctx.game.camera }).map(r => el('li', {},
        el('span', { className: 'fr-caps' }, r.id === 'move' && r.keys.length === 4
          ? el('span', { className: 'fr-wasd' }, r.keys.map(k => el('kbd', { className: 'fr-key' }, k.label)))
          : r.keys.map((k, i) => [i ? el('span', { className: 'fr-or' }, 'or') : null, k.kind === 'mouse' ? el('span', { className: 'fr-mousecap', title: k.label }, mouseIcon(k.button), el('span', { className: 'sr' }, k.label)) : el('kbd', { className: `fr-key${k.wide ? ' wide' : ''}` }, k.label)])),
        el('span', { className: 'fr-does' }, r.words, r.alt ? el('small', {}, r.alt) : null)))));

    if (mode === 'solo') {
      const art = el('div', { className: 'fr-solo' }, svg(ICON.solo, { size: 44, width: 1.4 }),
        el('p', {}, el('b', {}, 'This game is for one player.')),
        el('p', { className: 'muted small' }, 'Ask your session to make it multiplayer, and friends can join here.'),
        el('button', { type: 'button', on: { click: () => ctx.chat?.ask?.({ label: 'Make it multiplayer', placeholder: 'How should friends play together?', compose: w => `Make this game multiplayer (live: friends in one game, each sees the others): ${w}` }) } }, 'Ask my session'));
      root.append(art, controls);
      return () => {};
    }

    // ---- the parts ----
    const scene = el('div', { className: 'fr-scene', 'aria-hidden': 'true' });
    const host = el('button', { type: 'button', 'data-testid': 'friends-host', on: { click: () => ctx.preview.show('/game/gf/mp/') } }, el('span', { className: 'sr' }, '1. '), 'Host a room in the preview');
    const second = el('a', { className: 'button', target: '_blank', rel: 'noopener', 'aria-disabled': 'true', 'data-testid': 'friends-second' }, el('span', { className: 'sr' }, '2. '), 'Open your friend\'s tab ↗');
    let opened = false;
    second.addEventListener('click', e => {
      if (second.getAttribute('aria-disabled') === 'true') { e.preventDefault(); ctx.toast('Host a room first (step 1)', 'error'); return; }
      opened = true; paint(true);
    });
    const code = el('div', { className: 'fr-code', hidden: true, 'aria-live': 'polite' });
    const steps = el('ol', { className: 'fr-steps' });
    const people = el('section', { className: 'fr-people' });
    const note = el('p', { className: 'fr-note muted small' });
    const modeLine = mode && mode !== 'live' ? el('p', { className: 'fr-note muted small' }, mode === 'race'
      ? 'In this game friends race in their own copies and see each other\'s scores, not each other.'
      : `Friends play in one room (${mode}).`) : null;
    root.append(...[scene, code, steps, people, controls, modeLine, note].filter(Boolean));

    function drawScene(room, online) {
      const me = room.players.find(p => p.you) ?? (room.code ? { name: 'You' } : null);
      const friends = room.players.filter(p => !p.you && !p.bot);
      const joined = friends.length > 0;
      const friendOn = joined || opened;
      scene.dataset.state = joined ? 'joined' : room.code ? 'hosted' : 'idle';
      scene.replaceChildren(
        el('figure', { className: 'fr-screen you' },
          el('div', { className: 'fr-display' }, el('div', { className: 'fr-avs' }, me ? avatar(me, 'lg') : el('span', { className: 'fr-av lg ghost' }, '?'), friends.slice(0, 3).map(p => avatar(p, 'sm'))),
            room.code ? el('span', { className: 'fr-badge' }, room.code) : el('span', { className: 'fr-badge muted' }, 'no room yet')),
          el('div', { className: 'fr-stand' }), el('figcaption', {}, el('b', {}, 'You'), el('small', {}, 'host the room'))),
        el('div', { className: 'fr-wire' }, svg(online ? ICON.globe : ICON.link, { size: 20 }), el('span', {}, joined ? 'in one game' : room.code ? 'waiting…' : 'room code')),
        el('figure', { className: `fr-screen friend${friendOn ? '' : ' off'}` },
          el('div', { className: 'fr-display' }, el('div', { className: 'fr-avs' }, joined ? [avatar(friends[0], 'lg'), me?.color ? avatar(me, 'sm') : null] : el('span', { className: 'fr-av lg ghost' }, '?')),
            el('span', { className: 'fr-badge muted' }, joined ? 'joined' : friendOn ? 'joining…' : online ? 'any computer' : 'a second tab')),
          el('div', { className: 'fr-stand' }), el('figcaption', {}, el('b', {}, joined ? friends[0].name : 'Your friend'), el('small', {}, 'joins with the code'))));
    }

    function drawSteps(room, online) {
      const list = stepsFor(room, { opened, online });
      steps.replaceChildren(...list.map((s, i) => el('li', { className: 'fr-step', 'data-state': s.state, 'data-step': s.id },
        el('span', { className: 'fr-num' }, s.state === 'done' ? svg(ICON.tick, { size: 14, width: 2.6 }) : String(i + 1)),
        el('div', { className: 'fr-step-body' },
          el('b', {}, s.label), el('small', {}, s.note),
          s.id === 'host' ? host : s.id === 'open' ? second : null))));
      // one primary: the step that is now; the others are ghost
      host.className = list[0].state === 'now' ? '' : 'ghost small';
      host.lastChild.textContent = list[0].state === 'now' ? 'Host a room in the preview' : 'Show the waiting room';
      second.className = list[1].state === 'now' ? 'button' : 'button ghost btn small';
    }

    function drawCode(room, invite, online) {
      code.hidden = !room.code;
      if (!room.code) { code.replaceChildren(); return; }
      const copy = el('button', { type: 'button', className: 'ghost', 'data-testid': 'friends-copy', on: { click: async () => {
        const ok = await copyText(room.code);
        copy.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { copy.lastChild.textContent = 'Copy'; }, 1600);
      } } }, svg(ICON.copy, { size: 14 }), el('span', {}, 'Copy'));
      const link = online && invite ? el('button', { type: 'button', className: 'ghost small', on: { click: async () => { ctx.toast((await copyText(invite)) ? 'Invite link copied' : 'Could not copy the link', 'ok'); } } }, svg(ICON.link, { size: 14 }), 'Copy invite link') : null;
      code.replaceChildren(el('span', { className: 'fr-code-label' }, 'Room code'), el('b', {}, room.code), el('div', { className: 'fr-code-acts' }, copy, link));
    }

    function drawPeople(room) {
      const list = room.players;
      people.replaceChildren();
      if (!room.code) return;
      const empty = Math.max(0, 2 - list.length);
      people.append(el('h3', {}, `In the room · ${list.length}`),
        el('ul', { className: 'fr-roster' }, list.map(p => el('li', {}, avatar(p), el('span', { className: 'fr-name' }, p.name), el('span', { className: 'fr-tags muted small' }, [p.you ? 'you' : null, p.host ? 'host' : null, p.bot ? 'bot' : null].filter(Boolean).join(' · ')))),
          Array.from({ length: empty }, () => el('li', { className: 'waiting' }, el('span', { className: 'fr-av md ghost' }, '?'), el('span', { className: 'fr-name muted' }, 'Waiting for a friend…')))));
    }

    let lastKey = '';
    function paint(force = false) {
      const r = readPreview(ctx.preview.frame);
      const online = onlineOn(ctx.game, r.config);
      const key = JSON.stringify([r.room, r.invite, online, opened]);
      if (!force && key === lastKey) return;
      lastKey = key;
      if (r.room.code) { second.href = `/game/gf/mp/?join=${encodeURIComponent(r.room.code)}`; second.setAttribute('aria-disabled', 'false'); }
      else { second.removeAttribute('href'); second.setAttribute('aria-disabled', 'true'); opened = false; }
      drawScene(r.room, online);
      drawSteps(r.room, online);
      drawCode(r.room, r.invite, online);
      drawPeople(r.room);
      note.replaceChildren(svg(online ? ICON.globe : ICON.home, { size: 14 }), online
        ? ' Online play is on: friends on other computers join with the code. Keep the host\'s tab open.'
        : ' Works on this computer only: the second tab plays your friend. Keep the host\'s tab open.');
    }
    paint(true);
    const t = setInterval(() => { if (!root.hidden) paint(); }, 1000);
    return () => clearInterval(t);
  },
};
