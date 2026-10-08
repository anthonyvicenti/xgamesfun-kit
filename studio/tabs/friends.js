// Play with friends: how a live game's players find each other on this machine (and later through games.fun).
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, attrs); e.append(...kids.filter(k => k != null)); return e; };

export default {
  id: 'friends',
  label: 'Play with friends',
  order: 30,
  async mount(root, ctx) {
    const here = el('button', { type: 'button' }, 'Friends lobby in the preview');
    here.addEventListener('click', () => ctx.preview.show('/game/gf/mp/'));
    const tab = el('a', { href: '/game/gf/mp/', target: '_blank', rel: 'noopener' }, 'Open the lobby in a new tab ↗');
    const g = ctx.game;
    root.append(
      el('p', {}, `Multiplayer: ${g.multiplayer ?? 'unknown'}. Friends play in one game, in sync, and each sees the others as a character.`),
      el('div', { className: 'toolbar' }, here, tab),
      el('h3', {}, 'Two players on this machine'),
      el('ol', {},
        el('li', {}, 'Open the lobby (above), type a name and press Host.'),
        el('li', {}, 'Copy the invite link and open it in another tab or browser window: Join.'),
        el('li', {}, 'The host presses Start. Each screen shows the other player where they really are.')),
      el('p', { className: 'muted' }, 'The dev server is the signaling server (WebSocket /signal and HTTP /signal/v1) and only answers this machine. Game traffic goes peer to peer over WebRTC. Playing with friends elsewhere needs the game published on games.fun.'),
      el('h3', {}, 'Controls'),
      el('p', {}, Object.entries(g.controls ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Move with WASD, look with the mouse.'));
  },
};
