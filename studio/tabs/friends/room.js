// Play with friends: the steps a room goes through, the players in it, and the game's controls as keys to draw.
// Pure: no DOM, so tests/studio-friends.test.mjs runs it. The room is read from the multiplayer kit's own read-only
// observation in the preview (window.__party.snapshot(): code, host, racers, names, colors; gf-multiplayer 1.4+).

const CODE = /^[A-Za-z0-9-]{3,16}$/;

/** The room in the preview, from the kit's snapshot and the code on its page. → { code, host, players, round, phase } */
export function roomFrom(snap, pageCode = null) {
  const s = snap && typeof snap === 'object' ? snap : {};
  const raw = s.code || pageCode || null;
  const code = raw && CODE.test(String(raw).trim()) ? String(raw).trim() : null;
  const names = s.names && typeof s.names === 'object' ? s.names : {};
  const colors = Object.fromEntries((Array.isArray(s.colors) ? s.colors : []).map(c => [c?.id, c?.color]));
  const racers = Array.isArray(s.racers) ? s.racers : [];
  const players = racers.filter(r => r && !r.watching).map(r => ({
    id: String(r.id), name: String(names[r.id] ?? r.name ?? r.id), color: colors[r.id] ?? null,
    host: r.id === s.hostId || (s.host === true && r.id === s.you) || r.host === true, you: r.id === s.you, bot: !!r.bot,
  }));
  // the host flag on a player: the snapshot names who hosts only for the copy that hosts (host: true, you)
  return { code, host: s.host === true, players, round: Number(s.round) || 0, phase: s.room ?? s.phase ?? null };
}

/**
 * The steps, each 'done', 'now' or 'todo': host a room → open the friend's tab → the friend joins → start playing.
 * opened: the person opened the friend's tab from here (the studio cannot see another tab otherwise); online: friends
 * on other computers can join (the words say so).
 * → [{ id, label, state, note }]
 */
export function stepsFor(room, { opened = false, online = false } = {}) {
  const r = room ?? {};
  const humans = (r.players ?? []).filter(p => !p.bot).length;
  const hosted = !!r.code, joined = hosted && humans >= 2, playing = joined && (r.round > 0 || r.phase === 'playing');
  const done = { host: hosted, open: hosted && (opened || joined), join: joined, play: playing };
  const words = {
    host: hosted ? `Room ${r.code} is open in the preview` : 'Opens the waiting room in the preview: type a name, press Host',
    open: done.open ? 'Your friend\'s tab is open' : online ? 'A second tab here, or send a friend the code' : 'A second browser tab plays your friend',
    join: joined ? `${humans} players in the room` : 'In the friend\'s tab: type a name, press Join',
    play: playing ? 'Playing together' : 'The host presses Start in the preview',
  };
  const labels = { host: 'Host a room', open: 'Open your friend\'s tab', join: 'Your friend joins', play: 'Start playing' };
  let now = false;
  return ['host', 'open', 'join', 'play'].map(id => {
    const state = done[id] ? 'done' : now ? 'todo' : (now = true, 'now');
    return { id, label: labels[id], state, note: words[id] };
  });
}

/** A name's initial for a round avatar. */
export const initial = name => (String(name ?? '').trim().match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase();

// The kit's keys (gf-three kit/core/input.js): WASD or arrows move, Space jumps, mouse button / F is primary, right
// button / Q is secondary, E is interact, Shift sprints.
const KEYS = {
  primary: [{ kind: 'mouse', button: 'left', label: 'Click' }, { kind: 'key', label: 'F' }],
  secondary: [{ kind: 'mouse', button: 'right', label: 'Right click' }, { kind: 'key', label: 'Q' }],
  interact: [{ kind: 'key', label: 'E' }],
  jump: [{ kind: 'key', label: 'Space', wide: true }],
  sprint: [{ kind: 'key', label: 'Shift', wide: true }],
};
const FLAT = new Set(['side', 'top', 'board', 'cursor', 'iso', 'isometric']);

/**
 * The controls to draw: moving and looking first (from the camera), then every control the game lists, in its own
 * words. → [{ id, words, keys: [{ kind: 'key' | 'mouse', label, button?, wide? }] }]
 */
export function controlRows(controls = {}, { camera = null } = {}) {
  const list = controls && typeof controls === 'object' ? controls : {};
  const lower = Object.fromEntries(Object.entries(list).map(([k, v]) => [String(k).toLowerCase(), v]));
  const rows = [];
  const side = camera === 'side';
  if (!('move' in lower)) rows.push({ id: 'move', words: 'Move', keys: side ? [{ kind: 'key', label: 'A' }, { kind: 'key', label: 'D' }] : ['W', 'A', 'S', 'D'].map(label => ({ kind: 'key', label })), alt: side ? '← →' : 'or the arrow keys' });
  if (!FLAT.has(camera) && !('look' in lower)) rows.push({ id: 'look', words: 'Look around', keys: [{ kind: 'mouse', button: 'move', label: 'Mouse' }] });
  for (const [k, v] of Object.entries(list)) {
    const id = String(k).toLowerCase();
    const keys = KEYS[id] ?? (id === 'move' ? ['W', 'A', 'S', 'D'].map(label => ({ kind: 'key', label })) : id === 'look' ? [{ kind: 'mouse', button: 'move', label: 'Mouse' }] : [{ kind: 'key', label: String(k).length <= 6 ? String(k) : '?', wide: String(k).length > 1 }]);
    const words = String(v ?? '').trim() || id;
    rows.push({ id, words: words[0].toUpperCase() + words.slice(1), keys });
  }
  return rows;
}

/** Online play for this game: the game info's word when the studio gives one, else the online line the dev server put
 *  in the game's page (window.GF_P2P_CONFIG.signal === 'online'). → true | false */
export function onlineOn(gameInfo, pageConfig) {
  if (gameInfo?.online && typeof gameInfo.online === 'object') return gameInfo.online.use === 'online';
  if (typeof gameInfo?.online === 'boolean') return gameInfo.online;
  return pageConfig?.signal === 'online';
}
