// Saves & scores (the Backend tab)'s pure logic, no DOM: what a backend gives a game (the picture cards), which service
// gives what, and each service's connection light. studio/tabs/backend.js draws them; tests/backend-model.test.mjs
// checks them. Icons are SVG shapes on a 24 x 24 grid, stroked with currentColor (like the tool bar's).

export const ICONS = {
  scores: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  saves: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="6" rx="1"/>',
  accounts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6 1.6 0 3 .4 4.1 1.2"/><circle cx="17" cy="15.5" r="2.5"/><path d="M18.8 17.3L22 20.5M20.6 19.1l-1.3 1.3"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>',
  database: '<path d="M4.5 5.5a7.5 2.5 0 1 0 15 0a7.5 2.5 0 1 0-15 0"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

/** What a backend gives a game, in the order the tool shows them. `by`: the services that give it. */
export const BENEFITS = [
  { id: 'scores', title: 'High scores', text: 'A leaderboard every player sees.', by: ['supabase', 'railway'] },
  { id: 'saves', title: 'Saved progress', text: 'Players pick up where they left off.', by: ['supabase', 'railway'] },
  { id: 'accounts', title: 'Player accounts', text: 'Each player has their own sign-in.', by: ['supabase'] },
  { id: 'server', title: 'Its own server', text: 'A live score feed, and rules that run off the players’ screens.', by: ['railway'] },
];

/** The services, in short words (the provider's own `about` stays the long version). */
export const SERVICES = {
  supabase: { icon: 'database', tagline: 'A database: scores, saves and player sign-in.', best: 'Most games' },
  railway: { icon: 'server', tagline: 'A server of the game’s own: leaderboards, saves, a live feed.', best: null },
};

/** The benefits a service gives. */
export const benefitsOf = id => BENEFITS.filter(b => b.by.includes(id)).map(b => b.id);

/**
 * A service's connection light for this game. provider: a /api/backend/status providers entry; game: its `game`.
 * → { tone: 'ok' | 'warn' | 'off' | 'bad', words }
 */
export function lightOf(provider, game = {}) {
  if (!provider) return { tone: 'off', words: 'Not connected' };
  if (game.settings?.provider === provider.id) return game.client ? { tone: 'ok', words: 'Connected to this game' } : { tone: 'warn', words: 'Connected, but the game’s link is missing: connect again' };
  if (provider.status?.error) return { tone: 'bad', words: 'Could not check' };
  if (provider.status?.signedIn) return { tone: 'warn', words: 'Signed in, not used by this game' };
  return { tone: 'off', words: 'Not connected' };
}

/** The steps a service's one button will take, shown before it starts (the flow's own steps replace them). */
export const PLANS = {
  supabase: [['sign-in', 'Sign in to Supabase in your browser'], ['project', 'Pick a project, or make one'], ['tables', 'Add the game’s tables, each locked to its players'], ['keys', 'Connect the game']],
  railway: [['sign-in', 'Sign in to Railway in your browser'], ['workspace', 'Choose the workspace'], ['deploy', 'Start the game’s server'], ['keys', 'Connect the game']],
};
