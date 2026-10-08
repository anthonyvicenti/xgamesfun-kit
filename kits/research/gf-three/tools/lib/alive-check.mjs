// verify check 15: the loop is alive. Each mechanic config/game.json uses shows its own sign of life, read from the
// kit's state (snapshot().shared and the players), and the game's goal is on the player's screen when the round starts.
//
// Creator, "Hang Up On Them" (live Studio, 2026-10-07): "The zombies are instant killed to I couldn't even tell what
// was happened. There was no healthbar or anything. And it also took over an hour to make." Round 1 of that build
// passed verify 13/13 while the play-tester saw no token, no token health on the HUD, zombies standing at the doors and
// no kill in 160 s: waves.target named a prop ("token"), not a world zone, so with aggro "target" the zombies had
// nowhere to go, and check 12 passed on bots shooting zombies that stood still. Two repair rounds (34 min of agent
// time) fixed what this check now fails in the build agent's own `verify --quick` loop.
//
// What it reads (every item names the state it reads; a value the game never reports is "unmeasured", which fails,
// never passes):
//   pages      every page verify opens records the observation 4 times a second (RECORDER, installed by verify's
//              newPage): the solo round, check 10's two pages, check 13's page and this check's own page. A sign seen
//              on any of them counts.
//   undefended this check's own page (only for a game with waves): no bots, the player stands still. Enemies must come,
//              go for their goal, and hurt it: an idle player must lose (genex-desktop's "a do-nothing player must
//              lose"). Then the player aims at the nearest enemy with real mouse moves and fires: the shot must lower
//              its hit points or kill it.
//   first look the goal at round start, in the local player's own view: a config/game.json prop whose role is the
//              thing to defend (window.__game.sight: its share of the view, depth-tested), and the waves target's
//              health meter on the HUD.
//
// Signs, per mechanic (shared key → what counts):
//   waves      shared.waves.e/w: enemies came; one closed ≥ APPROACH_M on its goal (the target zone, else the nearest
//              player) or reached it; with a target: the zone exists in config/world.json, the HUD shows its meter, and
//              undefended its health fell ≥ TARGET_DROP of its max; a player's aimed shot hurt or killed an enemy (else
//              a kill in a round with bots, noted).
//   pickup     shared.pk.p: a spot taken (state 1 → 0) on any page (check 13's E on a pickup counts).
//   projectile shared.prj: shots or streams in flight, and a hit landed: an enemy hurt or killed, a player's hit points
//              fell, a player knocked down, or paint changed.
//   carry      shared.carry.i: an item held.          station   shared.station: progress or quota.
//   paint      shared.paint.g: cells changed.         race      shared.race.r: a gate or lap passed.
//   tag        shared.tag.t: someone is it.           teams     shared.teams.a: players on two teams or more.
//   health     shared.hp.h: reported (hit points that fell), never failed on its own.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

export const ALIVE_LIMITS = {
  GOAL_MIN_SHARE: 0.003,      // the goal fills ≥ 0.3% of the first look (about 53 × 53 px of a 1280 × 720 screen)
  APPROACH_M: 2,              // an enemy closes at least this far on its goal…
  REACH_SLACK: 0.6,           // …or gets within attackRange + this
  TARGET_DROP: 0.2,           // undefended, the target loses ≥ 20% of its health
  GOAL_AT_TARGET_M: 2.5,      // the goal prop stands within the zone's radius + this of the waves target
  UNDEFENDED_MAX_S: 60,       // the longest the idle player waits
  AIM_SECONDS: 9,             // aim-and-fire: lining up and firing, at most
  SAMPLE_MS: 250,
};
/** A config/game.json prop whose role makes it the thing the players defend (the game's goal). */
export const GOAL_ROLE = /\b(defend(ed)?|protect(ed)?|guard(ed)?|keep (it )?safe|save)\b/i;
const KNOWN = ['waves', 'pickup', 'projectile', 'carry', 'station', 'paint', 'race', 'tag', 'teams', 'health'];
const SHARED_KEY = { waves: 'waves', pickup: 'pk', projectile: 'prj', carry: 'carry', station: 'station', paint: 'paint', race: 'race', tag: 'tag', teams: 'teams', health: 'hp' };

/**
 * In the page (installed with addInitScript): every SAMPLE_MS while a round plays, a compact copy of the observation.
 * window.__gfAlive() → {samples}. A sample: {w (wall s), t (round s), ph, rd, pl: [[id, x, z, score, alive, down,
 * local, bot]], sh: {waves: {e, w}, pk: [state], hp: {id: hp}, carry: [holder], station: [[state, progress]], q,
 * paint: 'hash:length', race, tag, teams, prj: [shots, streams]}, mods: [stand-in mechanic ids]}.
 */
export const RECORDER = () => {
  if (window.__gfAlive) return;
  const rec = { samples: [], t0: performance.now() };
  if (new URLSearchParams(location.search).has('gf-demo')) { window.__gfAlive = () => rec; return; }   // a staged moment is not a round
  const R = v => Math.round(v * 100) / 100;
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const take = () => {
    const g = window.__game; if (!g?.snapshot || g.phase === 'show') return;
    let s; try { s = g.snapshot(); } catch { return; }
    if (s.phase !== 'playing' && s.phase !== 'results') return;
    const last = rec.samples[rec.samples.length - 1];
    if (s.phase === 'results' && last?.ph === 'results' && last.rd === s.round) return;
    if (rec.samples.length >= 900) return;
    const sh = s.shared ?? {}, o = {};
    if (sh.waves) o.waves = { e: sh.waves.e ?? [], w: sh.waves.w ?? null };
    if (sh.pk) o.pk = (sh.pk.p ?? []).map(q => q[3]);
    if (sh.hp) o.hp = sh.hp.h ?? {};
    if (sh.carry) o.carry = (sh.carry.i ?? []).map(e => e[4]);
    if (sh.station) { o.station = (sh.station.s ?? []).map(x => [x[0], x[2]]); o.q = sh.station.q ?? null; }
    if (sh.paint) o.paint = `${hash(sh.paint.g ?? '')}:${(sh.paint.g ?? '').length}`;
    if (sh.race) o.race = sh.race.r ?? {};
    if (sh.tag) o.tag = sh.tag.t ?? [];
    if (sh.teams) o.teams = sh.teams.a ?? {};
    if (sh.prj) o.prj = [(sh.prj.l ?? []).length, (sh.prj.st ?? []).length];
    rec.samples.push({ w: R((performance.now() - rec.t0) / 1000), t: R(s.time?.round ?? 0), ph: s.phase, rd: s.round ?? 1,
      pl: (s.players ?? []).map(p => [p.id, R(p.x), R(p.z), p.score ?? 0, p.alive === false ? 0 : 1, p.down ? 1 : 0, p.local ? 1 : 0, p.bot ? 1 : 0]),
      sh: o, mods: (s.modules?.mechanics ?? []).filter(m => m.standin).map(m => m.id) });
  };
  setInterval(take, 250);
  window.__gfAlive = () => rec;
};

/** The first round a page played (later rounds are a replay of the same thing). */
export const firstRound = samples => { const rd = samples.find(s => s.ph === 'playing')?.rd; return rd === undefined ? [] : samples.filter(s => s.rd === rd); };

// ---------------------------------------------------------------------------------------------------------------------
// The goal (pure)
// ---------------------------------------------------------------------------------------------------------------------

/** A zone's centre and radius from config/world.json → zones[name], or null. */
export function zoneOf(world, name) {
  const z = name ? world?.zones?.[name] : null; if (!z) return null;
  const a = z.at ?? [0, 0, 0], x = a.x ?? a[0] ?? 0, zz = a.z ?? a[2] ?? 0, s = z.size ?? [1];
  return { name, x, z: zz, r: z.shape === 'box' ? Math.hypot((s[0] ?? 1) / 2, (s[2] ?? s[1] ?? 1) / 2) : (s[0] ?? 1) };
}

/**
 * What the game defends and where: {props: [{name, slot, role, placed: [{x, z}]}], waves: null | {params, aggro,
 * target, zone (or null when the name is not a zone), zones (names), label, hp, height, hittable, attackRange}}.
 */
export function goalOf(game = {}, world = {}) {
  const placedOf = name => (world.props ?? []).filter(p => p.prop === name).map(p => ({ x: p.at?.[0] ?? 0, z: p.at?.[2] ?? 0 }));
  const props = (game.props ?? []).filter(p => p?.name && GOAL_ROLE.test(`${p.role ?? ''}`)).map(p => ({ name: p.name, slot: `prop.${p.name}`, role: p.role, placed: placedOf(p.name) }));
  const wm = (game.mechanics ?? []).find(m => m.id === 'waves');
  let waves = null;
  if (wm) {
    const P = wm.params ?? {};
    const target = P.target ?? '';
    waves = { params: P, aggro: P.aggro ?? 'nearest', target, zone: zoneOf(world, target), zones: Object.keys(world.zones ?? {}), label: P.targetLabel ?? 'Core', hp: P.targetHp ?? 20,
      height: P.height ?? 1.5, hittable: P.hittable !== false, attackRange: P.attackRange ?? 1.2, firstDelay: P.firstDelay ?? 3, speed: P.speed ?? 2.6, startCount: P.startCount ?? 3, spawnEvery: P.spawnEvery ?? 0.6 };
  }
  return { props, waves };
}

/** How long an idle player waits for the enemies to come and hurt the goal, from the waves params and the area. */
export function undefendedSeconds(waves, world = {}) {
  const size = world.size ?? [world.half ? world.half * 2 : 24, world.half ? world.half * 2 : 24];
  const half = Math.hypot((Array.isArray(size) ? size[0] : size) / 2, (Array.isArray(size) ? size[1] ?? size[0] : size) / 2);
  const walk = half / Math.max(0.5, waves.speed);
  return Math.min(ALIVE_LIMITS.UNDEFENDED_MAX_S, Math.ceil(waves.firstDelay + waves.startCount * waves.spawnEvery + walk + 10));
}

// ---------------------------------------------------------------------------------------------------------------------
// Signs (pure): samples → what each mechanic did
// ---------------------------------------------------------------------------------------------------------------------

/** Waves on one page: enemies came, how far they closed on their goal, the target's health, kills. */
export function wavesSigns(samples, goal) {
  const W = goal.waves, z = W?.zone;
  const out = { seen: false, maxAlive: 0, firstAt: null, closed: 0, moved: 0, reached: false, hp0: null, hpMin: null, kills: 0, enemyHpDrop: false };
  const track = new Map();       // enemy id → {x0, z0, d0, dmin, hp}
  for (const s of samples) {
    const wv = s.sh?.waves; if (!wv) continue;
    out.seen = true;
    if (Array.isArray(wv.w)) { const hp = Number(wv.w[2]); if (out.hp0 === null) out.hp0 = hp; out.hpMin = out.hpMin === null ? hp : Math.min(out.hpMin, hp); out.kills = Math.max(out.kills, Number(wv.w[1]) || 0); }
    if (wv.e.length && out.firstAt === null) out.firstAt = s.t;
    out.maxAlive = Math.max(out.maxAlive, wv.e.length);
    const players = (s.pl ?? []).filter(p => p[4]).map(p => ({ x: p[1], z: p[2] }));
    for (const [id, x, ez, hp] of wv.e) {
      const goals = [];
      if (W.aggro !== 'players' && z) goals.push(z);
      if (W.aggro !== 'target') goals.push(...players);
      const d = goals.length ? Math.min(...goals.map(g => Math.hypot(g.x - x, g.z - ez))) : null;
      let e = track.get(id);
      if (!e) { e = { x0: x, z0: ez, d0: d, dmin: d, hp }; track.set(id, e); }
      if (d !== null) { if (e.d0 === null) e.d0 = d; e.dmin = Math.min(e.dmin ?? d, d); out.closed = Math.max(out.closed, e.d0 - e.dmin); if (e.dmin <= W.attackRange + ALIVE_LIMITS.REACH_SLACK) out.reached = true; }
      out.moved = Math.max(out.moved, Math.hypot(x - e.x0, ez - e.z0));
      if (hp < e.hp) out.enemyHpDrop = true;
      e.hp = hp;
    }
  }
  out.closed = r1(out.closed); out.moved = r1(out.moved);
  return out;
}

/** The other mechanics on one page: what changed. */
export function otherSigns(samples) {
  const o = { keys: new Set(), standins: new Set(), pkTaken: 0, pkPresent: 0, hpFell: false, hpMin: null, down: false, carried: false, station: false, paintChanged: false, race: false, it: false, itPassed: false, teams: 0, fired: false, scoreMoved: false };
  let pk = null, paint0 = null, tag0 = null, score0 = null;
  const hp0 = new Map();
  for (const s of samples) {
    for (const k of Object.keys(s.sh ?? {})) o.keys.add(k);
    for (const m of s.mods ?? []) o.standins.add(m);
    const sh = s.sh ?? {};
    if (sh.pk) { o.pkPresent = Math.max(o.pkPresent, sh.pk.filter(v => v === 1).length); if (pk) sh.pk.forEach((v, i) => { if (pk[i] === 1 && v === 0) o.pkTaken++; }); pk = sh.pk; }
    if (sh.hp) for (const [id, v] of Object.entries(sh.hp)) { if (!hp0.has(id)) hp0.set(id, v); else if (v < hp0.get(id)) o.hpFell = true; o.hpMin = o.hpMin === null ? v : Math.min(o.hpMin, v); }
    if ((s.pl ?? []).some(p => p[5])) o.down = true;
    if (sh.carry?.some(h => h !== -1 && h !== null)) o.carried = true;
    if (sh.station?.some(x => (x[1] ?? 0) > 0) || (sh.q?.[0] ?? 0) > 0) o.station = true;
    if (sh.paint !== undefined) { if (paint0 === null) paint0 = sh.paint; else if (sh.paint !== paint0) o.paintChanged = true; }
    if (sh.race && Object.values(sh.race).some(v => (v?.[0] ?? 0) > 0 || (v?.[1] ?? 0) > 0)) o.race = true;
    if (sh.tag) { if (sh.tag.length) o.it = true; const k = [...sh.tag].sort().join(); if (tag0 === null) tag0 = k; else if (k !== tag0 && sh.tag.length) o.itPassed = true; }
    if (sh.teams) o.teams = Math.max(o.teams, new Set(Object.values(sh.teams)).size);
    if (sh.prj && (sh.prj[0] > 0 || sh.prj[1] > 0)) o.fired = true;
    const sc = (s.pl ?? []).map(p => p[3]).join();
    if (score0 === null) score0 = sc; else if (sc !== score0) o.scoreMoved = true;
  }
  return o;
}

/** Signs over several pages: each page measured on its own (a change between two pages is not a change), then merged. */
export function mergeSigns(list) {
  const o = otherSigns([]);
  for (const x of list) {
    for (const k of x.keys) o.keys.add(k); for (const m of x.standins) o.standins.add(m);
    o.pkTaken += x.pkTaken; o.pkPresent = Math.max(o.pkPresent, x.pkPresent); o.teams = Math.max(o.teams, x.teams);
    if (x.hpMin !== null) o.hpMin = o.hpMin === null ? x.hpMin : Math.min(o.hpMin, x.hpMin);
    for (const k of ['hpFell', 'down', 'carried', 'station', 'paintChanged', 'race', 'it', 'itPassed', 'fired', 'scoreMoved']) o[k] = o[k] || x[k];
  }
  return o;
}

/** Waves over several pages, merged the same way. */
export function mergeWaves(list) {
  const o = { seen: false, maxAlive: 0, firstAt: null, closed: 0, moved: 0, reached: false, hp0: null, hpMin: null, kills: 0, enemyHpDrop: false };
  for (const x of list) {
    o.seen ||= x.seen; o.reached ||= x.reached; o.enemyHpDrop ||= x.enemyHpDrop;
    o.maxAlive = Math.max(o.maxAlive, x.maxAlive); o.closed = Math.max(o.closed, x.closed); o.moved = Math.max(o.moved, x.moved); o.kills = Math.max(o.kills, x.kills);
    if (x.firstAt !== null) o.firstAt = o.firstAt === null ? x.firstAt : Math.min(o.firstAt, x.firstAt);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------
// The judgement (pure)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * pages: [{label, samples}] (every recorded page; this check's own page is labelled 'alive'); firstLook: {sight,
 * meters, phase} or null; aim: the aim-and-fire result or null. → {ok, items, detail}
 * An item: {mechanic, item, status: 'ok' | 'dead' | 'unmeasured' | 'note', reads, saw, fix}.
 */
export function judgeAlive({ game = {}, world = {}, pages = [], firstLook = null, aim = null }) {
  const L = ALIVE_LIMITS, goal = goalOf(game, world), items = [];
  const add = (mechanic, item, status, reads, saw, fix = '') => items.push({ mechanic, item, status, reads, saw, ...(fix ? { fix } : {}) });
  const used = [...new Set((game.mechanics ?? []).map(m => m.id))];
  const rounds = pages.map(p => ({ label: p.label, samples: firstRound(p.samples ?? []) })).filter(p => p.samples.length);
  const alive = rounds.find(p => p.label === 'alive');
  const others = mergeSigns(rounds.map(p => otherSigns(p.samples)));
  const wavesAll = goal.waves ? mergeWaves(rounds.map(p => wavesSigns(p.samples, goal))) : null;
  const names = rounds.map(p => p.label).join(', ') || 'none';
  const secs = p => r1((p.samples.at(-1)?.t ?? 0) - (p.samples[0]?.t ?? 0));

  if (!rounds.length) add('kit', 'recording', 'unmeasured', 'window.__game.snapshot() on every page', 'no page recorded a round (the game never reached "playing", or the page has no window.__game)', 'run the game: ?bots=3 must reach a playing round');

  // ---- the goal on screen ----
  const W = goal.waves;
  for (const g of goal.props) {
    const s = firstLook?.sight ?? null;
    const what = `the ${g.name} (config/game.json → props, role "${g.role}")`;
    if (!firstLook) add('goal', 'first look', 'unmeasured', `window.__game.sight(['${g.slot}'])`, 'no first look was taken (the solo round did not start)');
    else if (s?.error) add('goal', 'first look', 'unmeasured', `window.__game.sight(['${g.slot}'])`, `sight() threw: ${s.error}`);
    else if (!s || typeof s.share !== 'number') add('goal', 'first look', 'unmeasured', `window.__game.sight(['${g.slot}'])`, 'the game has no window.__game.sight (its kit copy predates check 15)', 'node research/gf-three/tools/upgrade.mjs <game> brings the kit up to date');
    else if (!s.drawables) add('goal', 'in the world', 'dead', `window.__game.sight(['${g.slot}']).drawables`, `${what} is not in the world when the round starts: nothing is drawn with slot ${g.slot}`,
      `place it where the game is played: config/world.json → props gets {"prop": "${g.name}", "at": [x, 0, z], "rot": 0, "scale": 1}${W?.zone ? ` at the waves target zone "${W.zone.name}" (${r1(W.zone.x)}, ${r1(W.zone.z)})` : ''} and config/props.json its catalog entry, or spawn it in rules.setup with ctx.assets.model('${g.slot}')`);
    else if (s.share < L.GOAL_MIN_SHARE) add('goal', 'readable at round start', 'dead', `window.__game.sight(['${g.slot}']).share`,
      `${what} fills ${r2(s.share * 100)}% of the player's first look (needs ${L.GOAL_MIN_SHARE * 100}%): it is ${s.size ? `${r1(Math.max(s.size.x, s.size.z))} m wide and ${r1(s.size.y)} m tall, ` : ''}${s.distance ?? '?'} m from the camera${s.open === 0 ? ', and out of view (behind the camera or off screen)' : s.open > s.share * 2 ? `, and mostly hidden behind something (${r2(s.open * 100)}% with nothing in front)` : ''}`,
      'make it big enough to read (config/world.json → props[…].scale for this prop, or its size), and put it where the player looks at round start (spawns face the middle of the play area)');
    else add('goal', 'readable at round start', 'ok', `window.__game.sight(['${g.slot}']).share`, `${what} fills ${r2(s.share * 100)}% of the first look, ${s.distance} m away`);
    // the thing to defend is where the enemies go
    if (W && W.zone && s?.center) {
      const d = Math.hypot(s.center.x - W.zone.x, s.center.z - W.zone.z);
      if (d > W.zone.r + L.GOAL_AT_TARGET_M) add('goal', 'at the waves target', 'dead', 'sight().center vs config/world.json → zones', `the enemies go for zone "${W.zone.name}" at (${r1(W.zone.x)}, ${r1(W.zone.z)}), but the ${g.name} stands at (${r1(s.center.x)}, ${r1(s.center.z)}), ${r1(d)} m away`, `move the ${g.name} into zone "${W.zone.name}" (config/world.json → props) or point waves.target at a zone around it`);
    }
  }
  if (W && (W.target || goal.props.length || W.aggro === 'target')) {
    const meter = firstLook?.meters?.find(m => String(m.label ?? '').trim().toLowerCase() === String(W.label).trim().toLowerCase());
    const zonesTxt = W.zones.length ? W.zones.join(', ') : 'none';
    const near = goal.props[0] && firstLook?.sight?.center ? nearestZone(world, firstLook.sight.center) : null;
    const nearTxt = near ? `; the ${goal.props[0].name} stands in or near zone "${near.name}" (${r1(near.d)} m)` : '';
    if (!W.target) add('waves', 'target', 'dead', 'config/game.json → mechanics[waves].params.target', `waves has no target (target is "")${goal.props.length ? ` although the ${goal.props[0].name} is the thing to defend` : ''}${W.aggro === 'target' ? ', and with aggro "target" the enemies have nothing to go for' : ''}`,
      `set mechanics[waves].params.target to the world zone the ${goal.props[0]?.name ?? 'goal'} stands in (config/world.json → zones: ${zonesTxt}${nearTxt})`);
    else if (!W.zone) add('waves', 'target', 'dead', 'config/game.json → mechanics[waves].params.target, config/world.json → zones', `waves.target is "${W.target}", which is not a zone in config/world.json (zones: ${zonesTxt}): the enemies have no target${W.aggro === 'target' ? ' (aggro "target": they stand where they came in)' : ''} and the HUD shows no "${W.label}" meter`,
      `set mechanics[waves].params.target to a zone name${nearTxt}; a prop's name is not a zone`);
    if (W.target && W.zone && firstLook) {
      if (meter) add('waves', 'target health on the HUD', 'ok', `the HUD's .gf-meter "${W.label}"`, `"${W.label}" ${meter.pct}% at round start`);
      else add('waves', 'target health on the HUD', 'dead', `the HUD's .gf-meter "${W.label}"`, `no "${W.label}" meter on the HUD at round start (meters: ${(firstLook.meters ?? []).map(m => m.label).join(', ') || 'none'})`, 'the kit draws it when waves.target names a zone and the HUD is on; do not hide #gf-ui meters in rules');
    }
    if (W.aggro === 'players' && goal.props.length) add('waves', 'goes for the goal', 'dead', 'config/game.json → mechanics[waves].params.aggro', `aggro is "players": the enemies never go for the ${goal.props[0].name}`, 'set aggro to "target" (only the goal) or "nearest" (the goal or a player, whichever is closer)');
  }

  // ---- each mechanic's sign of life ----
  for (const id of used) {
    const key = SHARED_KEY[id];
    if (!KNOWN.includes(id)) { add(id, 'sign of life', 'note', '—', `check 15 has no sign defined for "${id}"`); continue; }
    if (others.standins.has(id)) { add(id, 'sign of life', 'unmeasured', `snapshot().modules.mechanics`, `"${id}" runs as a stand-in, so nothing it does is real`, 'the game\'s kit copy lacks the module: node research/gf-three/tools/upgrade.mjs <game>'); continue; }
    if (rounds.length && !others.keys.has(key)) { add(id, 'sign of life', 'unmeasured', `snapshot().shared.${key}`, `the ${id} mechanic never published its state (shared.${key}) on any page (${names})`, `is "${id}" in config/game.json → mechanics with the kit's module? rules must not replace it`); continue; }
    if (!rounds.length) continue;
    if (id === 'waves') {
      const page = alive ?? null;
      const ws = page ? wavesSigns(page.samples, goal) : wavesAll, wAll = wavesAll;
      const where = page ? `undefended for ${secs(page)} s (no bots, the player standing still)` : `on ${names}`;
      if (!ws.seen) { add('waves', 'enemies come', 'unmeasured', 'snapshot().shared.waves', `no waves state ${where}`); continue; }
      if (!ws.maxAlive) add('waves', 'enemies come', 'dead', 'shared.waves.e', `no enemy came ${where} (firstDelay ${W.firstDelay} s, startCount ${W.startCount})`, 'check mechanics[waves].params (firstDelay, startCount, maxWaves) and that rules do not remove enemies');
      else {
        add('waves', 'enemies come', 'ok', 'shared.waves.e', `${ws.maxAlive} at once, the first at ${r1(ws.firstAt)} s`);
        const goalWords = W.aggro === 'target' ? (W.zone ? `the target zone "${W.zone.name}"` : 'a target that does not exist') : W.aggro === 'players' ? 'the nearest player' : `the nearest player${W.zone ? ` or zone "${W.zone.name}"` : ''}`;
        if (ws.closed >= L.APPROACH_M || ws.reached) add('waves', 'enemies go for their goal', 'ok', 'shared.waves.e positions', `they closed ${ws.closed} m on ${goalWords}${ws.reached ? ' and reached it' : ''}`);
        else add('waves', 'enemies go for their goal', 'dead', 'shared.waves.e positions', `${W.aggro === 'target' && !W.zone ? 'the enemies had no goal (their target does not exist)' : `the enemies did not go for ${goalWords}`} ${where}: the most any closed on a goal was ${ws.closed} m, the farthest any moved ${ws.moved} m`,
          W.zone || W.aggro !== 'target' ? 'check waves speed and that walls or props do not box the spawn edges in' : 'give waves a target zone (above), or set aggro "nearest" so they come for the players');
      }
      if (W.zone) {
        if (!page) add('waves', 'an idle player loses the target', 'unmeasured', 'shared.waves.w[2] (target health), undefended', 'the undefended page did not run');
        else {
          const drop = ws.hp0 > 0 && ws.hpMin !== null ? (ws.hp0 - ws.hpMin) / ws.hp0 : 0;
          if (ws.hp0 === null) add('waves', 'an idle player loses the target', 'unmeasured', 'shared.waves.w[2]', 'the target\'s health was never reported');
          else if (drop >= L.TARGET_DROP || ws.hpMin <= 0) add('waves', 'an idle player loses the target', 'ok', 'shared.waves.w[2] (target health)', `nobody defended it: ${W.label} ${r1(ws.hp0)} → ${r1(ws.hpMin)} in ${secs(page)} s`);
          else add('waves', 'an idle player loses the target', 'dead', 'shared.waves.w[2] (target health)', `nobody defended the ${W.label} for ${secs(page)} s and its health went ${r1(ws.hp0)} → ${r1(ws.hpMin)} (needs a ${L.TARGET_DROP * 100}% drop): ${ws.reached ? 'enemies reached it but did not hurt it' : `no enemy got within attackRange ${W.attackRange} m (+${L.REACH_SLACK})`}`,
            ws.reached ? 'check waves damage and attackInterval, and that rules do not refill targetHp' : 'check attackRange against the size of what stands in the zone (enemies stop at its collider), and waves speed');
        }
      } else if (page && W.aggro !== 'target' && (game.mechanics ?? []).some(m => m.id === 'health')) {
        // no target: the goal is the player's own skin, and an idle player alone must get hurt
        const me = otherSigns(page.samples);
        if (me.hpFell || me.down) add('waves', 'an idle player is hurt', 'ok', 'shared.hp.h, players down (undefended)', `the enemies reached the idle player and ${me.hpFell ? `hurt them (hit points down to ${me.hpMin})` : 'knocked them down'}`);
        else add('waves', 'an idle player is hurt', 'dead', 'shared.hp.h, players down (undefended)', `the player stood still for ${secs(page)} s with no bots and was never hurt (the closest an enemy came: ${ws.reached ? 'in reach' : `${ws.closed} m closer than where it came in`})`,
          'check waves damage, attackRange and aggro ("nearest" or "players"), and that rules do not protect the player');
      }
      // a player's shot hurts an enemy
      if (W.hittable && (game.mechanics ?? []).some(m => m.id === 'projectile')) {
        if (aim?.hit) add('waves', 'a shot hurts an enemy', 'ok', 'shared.waves.e hp and w[1] kills, while the player fired', `the player aimed at an enemy ${aim.distance} m away and fired: ${aim.kill ? 'it died' : `its hit points went ${aim.hpBefore} → ${aim.hpAfter}`}`);
        else if (wAll.kills > 0 || wAll.enemyHpDrop) add('waves', 'a shot hurts an enemy', 'ok', 'shared.waves.w[1] kills', `${wAll.kills} killed on the pages with bots${aim ? `; the aimed shot did not land (${aim.why})` : ''}`);
        else add('waves', 'a shot hurts an enemy', aim?.measured ? 'dead' : 'unmeasured', 'shared.waves.e hp and w[1] kills', `no enemy was hurt or killed on any page (${names})${aim ? `; the aimed player: ${aim.why}` : ''}`,
          'check that waves.hittable is on and the shots reach the enemies (projectile speed, lifetime, the aim at the crosshair), and that rules.bot makes bots shoot them');
      }
      continue;
    }
    if (id === 'pickup') {
      if (!others.pkPresent) add('pickup', 'pickups are there', 'dead', 'shared.pk.p[i][3]', `no pickup was out on any page (${names})`, 'check mechanics[pickup].params count and zone');
      else if (others.pkTaken) add('pickup', 'one is taken', 'ok', 'shared.pk.p[i][3] 1 → 0', `${others.pkTaken} taken`);
      else add('pickup', 'one is taken', 'dead', 'shared.pk.p[i][3] 1 → 0', `${others.pkPresent} pickups were out and nobody took one on any page (${names})`, 'make bots go for them (rules.bot: p.bot.seek(pk.nearest(p.position))) and keep them where players walk; collect "both" lets E take them');
      continue;
    }
    if (id === 'projectile') {
      const hit = wavesAll?.enemyHpDrop || wavesAll?.kills > 0 || others.hpFell || others.down || others.paintChanged;
      if (!others.fired) add('projectile', 'shots fly', 'dead', 'shared.prj.l and .st', `no shot or stream was ever in flight on any page (${names})`, 'rules must fire: prj.fire(p) on primary for the player, and for bots in rules.bot (or ctx.bots.attack)');
      else if (hit) add('projectile', 'a hit lands', 'ok', 'enemy hp, shared.hp.h, players down, paint', [wavesAll?.kills ? 'enemies killed' : '', others.hpFell ? 'hit points fell' : '', others.down ? 'players knocked down' : '', others.paintChanged ? 'paint changed' : ''].filter(Boolean).join(', ') || 'enemies hurt');
      else add('projectile', 'a hit lands', 'dead', 'enemy hp, shared.hp.h, players down, paint', `shots flew but nothing they hit changed on any page (${names}): no hit points fell, nobody went down${(game.mechanics ?? []).some(m => m.id === 'paint') ? ', no paint changed' : ''}`, 'check damage and knockback in mechanics[projectile].params and that rules.bot aims at someone (ctx.bots.attack)');
      continue;
    }
    if (id === 'health') { add('health', 'hit points', 'note', 'shared.hp.h', others.hpFell ? `hit points fell (lowest ${others.hpMin})` : 'nobody lost hit points on these pages'); continue; }
    const simple = {
      carry: [others.carried, 'an item is held', 'shared.carry.i[…][4]', 'nobody picked an item up', 'make bots grab items (rules.bot) and check carry grabAction and reach'],
      station: [others.station, 'a station is worked', 'shared.station.s progress, q', 'no station made progress', 'make bots work stations (rules.bot) and check station action and range'],
      paint: [others.paintChanged, 'paint changes', 'shared.paint.g', 'no cell was painted', 'check paint.fromProjectile and that shots land on the ground (or rules call paint.splat)'],
      race: [others.race, 'a gate is passed', 'shared.race.r', 'nobody passed a gate', 'call race.botStep(p) in rules.bot and check the gates are reachable'],
      tag: [others.it, 'someone is it', 'shared.tag.t', 'nobody was it', 'tag makes an it at round start unless rules clear it'],
      teams: [others.teams >= 2, 'two teams', 'shared.teams.a', `players were on ${others.teams} team(s)`, 'check players.teams in config/game.json and that rules do not reassign everyone'],
    }[id];
    const [ok, item, reads, deadSaw, fix] = simple;
    add(id, item, ok ? 'ok' : 'dead', reads, ok ? 'yes' + (id === 'tag' && others.itPassed ? ', and it passed on' : '') : `${deadSaw} on any page (${names})`, ok ? '' : fix);
  }

  const bad = items.filter(i => i.status === 'dead' || i.status === 'unmeasured');
  const line = i => `${i.mechanic} ${i.item}: ${i.status === 'ok' ? 'ok' : i.status.toUpperCase()}, ${i.saw}${i.status !== 'ok' && i.status !== 'note' ? ` [reads ${i.reads}]${i.fix ? `. Fix: ${i.fix}` : ''}` : ''}`;
  const ok = bad.length === 0;
  const detail = ok
    ? items.filter(i => i.status === 'ok').map(line).join('; ')
    : `${bad.map(line).join('; ')}. The loop must be alive in the player's first minute: the goal on screen with its health, the enemies or other players doing what the rules say, a shot that lands. ${items.some(i => i.status === 'ok') ? `Working: ${items.filter(i => i.status === 'ok').map(i => `${i.mechanic} ${i.item}`).join(', ')}.` : ''}`;
  return { ok, items, detail, goal: { props: goal.props.map(g => g.name), target: W?.target ?? null, zone: W?.zone?.name ?? null } };
}

/** The zone nearest a point (for the repair hint). */
function nearestZone(world, p) {
  let best = null;
  for (const name of Object.keys(world.zones ?? {})) { const z = zoneOf(world, name); const d = Math.max(0, Math.hypot(z.x - p.x, z.z - p.z) - (z.r ?? 0)); if (!best || d < best.d) best = { name, d }; }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// The browser side
// ---------------------------------------------------------------------------------------------------------------------

/** The goal and the HUD at round start, from the local player's view: {sight, meters, phase, at}. */
export async function firstLook(page, game, world) {
  const goal = goalOf(game, world);
  return page.evaluate(ids => {
    const g = window.__game, ui = document.getElementById('gf-ui');
    const shown = e => { if (!e) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.05; };
    const meters = ui ? [...ui.querySelectorAll('.gf-meter')].filter(shown).map(m => ({ label: (m.querySelector('b')?.textContent ?? '').trim(), pct: Math.round(parseFloat(m.querySelector('u')?.style.width) || 0) })) : [];
    let sight = null;
    if (ids.length) { try { sight = typeof g?.sight === 'function' ? g.sight(ids) : null; } catch (e) { sight = { error: String(e?.message ?? e) }; } }
    return { phase: g?.phase ?? null, t: g?.snapshot?.()?.time?.round ?? null, meters, sight };
  }, goal.props.map(p => p.slot)).catch(e => ({ error: e.message, meters: [], sight: null }));
}

/** Read a page's recording (verify harvests every page this way just before it closes). */
export const recordingOf = page => Promise.race([page.evaluate(() => window.__gfAlive?.() ?? null), sleep(2500).then(() => null)]).catch(() => null);

const OBS = () => {
  const g = window.__game; const s = g.snapshot(); let c = null; try { c = g.controls?.() ?? null; } catch {}
  return { me: s.players.find(x => x.local), e: s.shared.waves?.e ?? [], w: s.shared.waves?.w ?? null, aim: c?.aim ?? null, phase: s.phase };
};
const yawOf = d => Math.atan2(d[0], d[2]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The enemy to aim at: the nearest within 2.5–26 m whose line from the player does not pass the goal zone first
 * (a shot at a zombie behind the token hits the token). → {id, x, z, hp, d} or null
 */
export function pickEnemy(me, enemies, { avoid = null, skip = new Set() } = {}) {
  let best = null;
  for (const [id, x, z, hp] of enemies) {
    if (skip.has(id)) continue;
    const d = Math.hypot(x - me.x, z - me.z);
    if (d < 2.5 || d > 26) continue;
    if (avoid) {
      const ux = (x - me.x) / d, uz = (z - me.z) / d, ax = avoid.x - me.x, az = avoid.z - me.z, along = ax * ux + az * uz;
      if (along > 0 && along < d && Math.abs(ax * uz - az * ux) < Math.min(1.2, avoid.r ?? 1)) continue;
    }
    if (!best || d < best.d) best = { id, x, z, hp, d };
  }
  return best;
}

/**
 * Aim at an enemy with real mouse moves (pointer lock: the view turns with the movement between mouse events), hold
 * primary, and watch its hit points; up to three enemies in `seconds`. → {measured, hit, kill, distance, hpBefore,
 * hpAfter, tries, why}
 */
export async function aimAndFire(p, { height = 1.5, avoid = null, seconds = ALIVE_LIMITS.AIM_SECONDS } = {}) {
  const t0 = Date.now(), obs = () => p.evaluate(OBS);
  const cur = { x: 640, y: 360 };
  const move = async (dx, dy) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 25)); for (let i = 0; i < n; i++) { cur.x += dx / n; cur.y += dy / n; await p.mouse.move(cur.x, cur.y); } await sleep(160); };
  let o = await obs();
  if (!o.aim?.dir?.length || o.aim.dist === null) return { measured: false, hit: false, why: 'the game reports no crosshair aim (window.__game.controls().aim)' };
  // calibrate: how far the view turns per pixel, sideways and up
  const a0 = o.aim.dir; await move(60, 0); o = await obs(); const kx = wrap(yawOf(o.aim.dir) - yawOf(a0)) / 60;
  const s0 = o.aim.dir[1]; await move(0, 30); o = await obs(); let ky = (o.aim.dir[1] - s0) / 30; await move(0, -30);
  if (Math.abs(kx) < 1e-4) return { measured: false, hit: false, why: 'moving the mouse did not turn the view (no pointer lock?)' };
  if (Math.abs(ky) < 1e-5) ky = -Math.abs(kx);
  const errors = (s, t) => {
    const dir = s.aim?.dir; if (!dir) return null;
    const hl = Math.hypot(dir[0], dir[2]) || 1e-6, d = Math.hypot(t.x - s.me.x, t.z - s.me.z);
    return { yawErr: wrap(Math.atan2(t.x - s.me.x, t.z - s.me.z) - yawOf(dir)), slopeErr: (height * 0.45 - 1.2) / d - dir[1] / hl, tol: Math.atan(0.3 / d), d };
  };
  const tried = new Set(), notes = [];
  let last = null;
  while (Date.now() - t0 < seconds * 1000 && tried.size < 3) {
    o = await obs();
    const t = pickEnemy(o.me, o.e, { avoid, skip: tried });
    if (!t) { if (!tried.size) { await sleep(400); if (Date.now() - t0 > seconds * 500) break; continue; } break; }
    tried.add(t.id);
    // line up (yaw within the enemy's half-width, the slope crossing it at 45% of its height)
    let e = null;
    for (let i = 0; i < 7; i++) {
      o = await obs(); const now = o.e.find(x => x[0] === t.id); if (!now) break;
      Object.assign(t, { x: now[1], z: now[2], hp: now[3] });
      e = errors(o, t); if (!e) break;
      if (Math.abs(e.yawErr) < e.tol && Math.abs(e.slopeErr) < 0.12) break;
      await move(Math.max(-500, Math.min(500, e.yawErr / kx * 0.85)), Math.max(-150, Math.min(150, e.slopeErr / ky * 0.7)));
    }
    if (!e) continue;
    const before = await obs(), kills0 = Number(before.w?.[1] ?? 0), hp0 = new Map(before.e.map(x => [x[0], x[3]]));
    let hit = false, kill = false, hpAfter = t.hp;
    await p.mouse.down();
    try {
      for (const end = Date.now() + 1800; Date.now() < end && !hit; ) {
        await sleep(200);
        const s = await obs();
        if (Number(s.w?.[1] ?? 0) > kills0) { kill = true; hit = true; hpAfter = 0; }
        for (const [id, , , hp] of s.e) if (hp0.has(id) && hp < hp0.get(id)) { hit = true; if (id === t.id) hpAfter = hp; }
        const now = s.e.find(x => x[0] === t.id), er = now && errors(s, { x: now[1], z: now[2] });
        if (er && Math.abs(er.yawErr) > er.tol) await move(Math.max(-200, Math.min(200, er.yawErr / kx * 0.8)), 0);
      }
    } finally { await p.mouse.up(); }
    last = { distance: r1(e.d), hpBefore: t.hp, hpAfter, yawErrDeg: r1(e.yawErr * 180 / Math.PI) };
    if (hit) return { measured: true, hit, kill, ...last, tries: tried.size, why: 'hit' };
    notes.push(`an enemy ${r1(e.d)} m away (aim ${r1(Math.abs(e.yawErr) * 180 / Math.PI)}° off its middle) kept ${t.hp} hit points through 1.8 s of fire`);
    await sleep(300);
  }
  if (!last) return { measured: false, hit: false, why: tried.size ? 'the enemies left before the aim lined up' : 'no enemy came within 2.5–26 m of the player in a clear line' };
  return { measured: true, hit: false, kill: false, ...last, tries: tried.size, why: notes.join('; ') };
}

/**
 * The undefended page (a game with waves): no bots, the player stands still until the enemies hurt the goal (or the
 * time is up), then aims and fires. newPage is verify's (it installs RECORDER and keeps the recording as 'alive' when
 * the page closes). → {aim, seconds, waited}
 */
export async function undefended({ newPage, url, game, world, shot = async () => null, log = () => {} }) {
  const goal = goalOf(game, world), W = goal.waves, wait = undefendedSeconds(W, world);
  const T = await newPage('alive', { overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: wait + 40 }] } });
  const p = T.page, t0 = Date.now();
  let aim = null, waited = 0;
  try {
    await p.goto(`${url}?seed=7&bots=0`, { waitUntil: 'load' });
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'lobby'; ) { if (Date.now() - t > 90000) throw new Error('no lobby in 90 s'); await sleep(200); }
    const play = await p.locator('#gf-play').boundingBox().catch(() => null);
    if (play) await p.mouse.click(play.x + play.width / 2, play.y + play.height / 2); else await p.keyboard.press('Enter');
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'playing'; ) { if (Date.now() - t > 20000) throw new Error('the round did not start'); await sleep(120); }
    // stand still (no click: a click fires) until the goal is hurt or the time is up
    const t1 = Date.now(), end = t1 + wait * 1000, hurtAt = W.hp * (1 - ALIVE_LIMITS.TARGET_DROP);
    for (;;) {
      await sleep(1000);
      const rec = await p.evaluate(() => window.__gfAlive?.() ?? null).catch(() => null);
      const samples = firstRound(rec?.samples ?? []), s = samples.at(-1), w = s?.sh?.waves?.w;
      if (s?.ph === 'results' || Date.now() > end) break;
      if (W.zone && w && Number(w[2]) <= hurtAt) break;
      if (!W.zone && (otherSigns(samples).hpFell || otherSigns(samples).down)) break;
    }
    waited = Math.round((Date.now() - t1) / 1000);
    await shot(p, 'alive-undefended');
    // aim and fire (a click takes the mouse first; that click may fire one shot, before anything is measured)
    if (W.hittable && (game.mechanics ?? []).some(m => m.id === 'projectile') && game.controls?.primary && (await p.evaluate(() => window.__game?.phase).catch(() => null)) === 'playing') {
      await p.mouse.click(640, 360); await sleep(400);
      aim = await aimAndFire(p, { height: W.height, avoid: W.zone }).catch(e => ({ measured: false, hit: false, why: `the aim script stopped: ${e.message.split('\n')[0]}` }));
      await shot(p, 'alive-aimed');
      log(`alive: the aimed shot ${aim.hit ? 'hit' : 'did not hit'} (${aim.why})`);
    }
  } finally {
    await T.ctx.close().catch(() => {});
  }
  return { aim, waited, seconds: Math.round((Date.now() - t0) / 1000), errors: T.errors.slice(0, 3) };
}
