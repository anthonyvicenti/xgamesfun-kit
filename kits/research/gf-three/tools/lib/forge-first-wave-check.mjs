// verify check 15's forge leg (CONTRACT §8 forge): the first wave can be fought. Kept apart from
// tools/verify-forge.mjs, which plays it in its solo session and folds the answer into check 15 (the loop is alive).
//
// Why forge has its own (the frozen forge case, 2026-10-11; research/gf-forge/evidence/eval-t6-full-2026-10-11;
// regressions/forge-first-wave-kills): verify passed three times on a game whose first minute a play-tester could not
// get through, and nothing in it plays the fight. Check 15 looked at the goal's share of the first picture; check 12
// plays bots; check 6 fells the player on purpose. So a first wave that kills whoever stands and fights (Bone Vigil's
// first: 14 of the dead, seven at once, three swinging: felled 11 s in) passed, and so would enemies no round can hurt.
//
// What it does: a game whose player has hit points, holds a weapon at the start and whose enemies come in waves is
// played alone on its own values (only the clock is lengthened, so the clock cannot be what ends it). The player
// stands where it spawned and fights with a new player's hand (lib/forge-fight.mjs: the nearest enemy in view, a
// quarter second to react, about a degree off, three rounds a second). It fails when
//   - the player is felled before the first wave is cleared, or
//   - KILL_S after the first enemy rose, nothing has fallen.
// A wave still being fought after WATCH_S, with the player standing and enemies falling, passes and says so.
import { healthApplies } from './forge-hud-check.mjs';
import { POINTER_LOCK } from './forge-feel-check.mjs';
import { fightFor } from './forge-fight.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;
export const FORGE_FIRST_WAVE_LIMITS = { CLOCK: 600, WATCH_S: 75, KILL_S: 30 };

/** Does the leg apply? (pure) */
export function firstWaveApplies(game) {
  const a = healthApplies(game);
  if (!a.applies) return a;
  if (game.round?.mode === 'world') return { applies: false, why: 'a world has no waves to clear' };
  if (!(game.forge?.weapons ?? []).some(w => w?.start !== false)) return { applies: false, why: 'the player holds no weapon at the start' };
  const size = (game.forge.waves[0]?.enemies ?? []).reduce((n, e) => n + (Number(e?.count) || 0), 0);
  return { applies: true, size };
}

/** In the page: the round, the local player and the wave, as the core holds them. */
const READ = () => {
  const g = window.__game; if (!g) return null;
  const s = g.snapshot(), me = s.players.find(p => p.local), core = g.forge?.players?.().find(p => p.local) ?? null;
  let dead = false; try { dead = !!g.forge?.feel?.()?.shown?.view?.dead; } catch {}
  let cards = null; try { cards = g.forge?.cards?.()?.phase ?? null; } catch {}
  return { phase: s.phase, reason: s.reason ?? null, fallen: me?.alive === false || dead || (core ? core.alive === false || core.hp <= 0 : false), hp: core?.hp ?? null,
    wave: s.rules?.ai?.director?.wave ?? null, cards, enemies: (g.enemies?.() ?? []).filter(e => !e.dead).length };
};

/**
 * The verdict from the measurements (pure). m: {applies, why, size (the first wave's enemies), cannot, first (s into
 * the round the first enemy was alive, or null), kill (s the first one fell), cleared (s the wave was cleared), fell (s
 * the player fell), watched (s), low (the lowest health seen), hp (the player's own), shots, firedAt, down (enemies
 * that fell)}
 */
export function judgeFirstWave(m, L = FORGE_FIRST_WAVE_LIMITS) {
  if (!m.applies) return { ok: true, judged: false, detail: `the first wave: nothing to judge (${m.why})` };
  if (m.cannot) return { ok: true, judged: false, detail: 'the first wave: not judged, the game gives no enemies or no look to fight with (window.__game.enemies, forge.face)' };
  if (m.first === null) return { ok: true, judged: false, detail: `the first wave: not judged, no enemy came in ${Math.round(m.watched)} s` };
  const of = `${m.down} of the wave's ${m.size} down, ${m.shots} rounds fired at ${m.firedAt} of them`;
  if (m.fell !== null && (m.cleared === null || m.fell <= m.cleared)) return { ok: false, judged: true, detail: `the first wave fells a player who stands and fights: alone on the game's own values (${m.hp} hit points), aiming at the nearest enemy and firing three rounds a second, the player was down ${r1(m.fell)} s into the round, ${r1(m.fell - m.first)} s after the first enemy rose, with ${of}. A new player does not know to run yet: make the first wave smaller, slower to rise or fewer at once (forge.waves[0]: enemies, delay, spawnEvery, maxAlive, attackers), and ramp the later ones` };
  if (m.kill === null && m.watched - m.first >= L.KILL_S) return { ok: false, judged: true, detail: `nothing falls in the first wave: alone on the game's own values, ${m.shots} rounds aimed at the bodies of ${m.firedAt} enemies in ${r1(m.watched - m.first)} s and none fell (enemy health against the starting weapon's damage and magazine, or shots that do not land)` };
  if (m.cleared !== null) return { ok: true, judged: true, detail: `the first wave can be fought: standing and firing, cleared in ${r1(m.cleared)} s (${m.shots} rounds, ${m.down} down; lowest health ${m.low === null ? '?' : Math.round(m.low)} of ${m.hp})` };
  return { ok: true, judged: true, detail: `the first wave can be fought: still standing after ${Math.round(m.watched)} s with ${of} (lowest health ${m.low === null ? '?' : Math.round(m.low)} of ${m.hp})` };
}

/** Check 15's forge leg. → {ok, detail, judged, record, warnings} */
export async function checkForgeFirstWave({ newPage, url, game, log = () => {}, shot = async () => null }) {
  const L = FORGE_FIRST_WAVE_LIMITS, warnings = [];
  const a = firstWaveApplies(game);
  const m = { applies: a.applies, why: a.why ?? null, size: a.size ?? 0, cannot: false, first: null, kill: null, cleared: null, fell: null, watched: 0, low: null, hp: Number(game.forge?.player?.health ?? 0), shots: 0, firedAt: 0, down: 0 };
  if (!m.applies) { const j = judgeFirstWave(m, L); return { ...j, warnings, record: { applies: false, why: m.why } }; }
  const T = await newPage('the first wave', { overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: L.CLOCK }] } });
  const p = T.page;
  let shotFile = null;
  try {
    await p.addInitScript(POINTER_LOCK);
    await p.goto(`${url}?seed=7&bots=0`, { waitUntil: 'load' });
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'lobby'; ) { if (Date.now() - t > 90000) throw new Error('no lobby in 90 s'); await sleep(200); }
    await p.click('#gf-play');
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'playing'; ) { if (Date.now() - t > 20000) throw new Error('the round did not start'); await sleep(120); }
    await p.mouse.click(640, 360);                                             // the mouse is the game's from here
    const t0 = Date.now(), at = () => (Date.now() - t0) / 1000;
    const io = { frame: () => p, down: k => (k === 'Mouse' ? p.mouse.down() : p.keyboard.down(k)), up: k => (k === 'Mouse' ? p.mouse.up() : p.keyboard.up(k)) };
    const did = await fightFor(io, { seconds: L.WATCH_S, seed: 15, until: async d => {
      const s = await p.evaluate(READ).catch(() => null);
      if (!s) return null;
      m.watched = at();
      if (s.hp !== null) m.low = m.low === null ? s.hp : Math.min(m.low, s.hp);
      if (m.first === null && s.enemies > 0) m.first = at();
      if (m.kill === null && d.fell > 0) m.kill = at();
      if (s.fallen) { m.fell = at(); return 'fell'; }
      if (s.phase === 'results') { m.cleared = at(); return 'the round ended'; }   // not fallen: the game's own end (a single wave won)
      if ((s.wave ?? 1) >= 2 || s.cards === 'choosing' || s.cards === 'dealing') { m.cleared = at(); return 'cleared'; }
      if (m.first !== null && m.kill === null && at() - m.first >= L.KILL_S) return 'nothing fell';
      return null;
    } });
    m.watched = at(); m.cannot = did.cannot; m.shots = did.shots; m.firedAt = did.firedAt; m.down = did.fell;
    if (m.kill === null && did.fell > 0) m.kill = m.watched;
    shotFile = await shot(p, 'first-wave');
  } catch (e) { warnings.push(`the first-wave page stopped: ${e.message}`); }
  finally { if (T.errors.length) warnings.push(`the first-wave page console errors: ${[...new Set(T.errors)].slice(0, 2).join(' | ')}`); await T.ctx.close().catch(() => {}); }
  const j = judgeFirstWave(m, L);
  if (!j.judged) warnings.push(`check 15 on forge: ${j.detail}`);
  log(`  forge first wave: ${j.ok ? 'ok' : 'FAIL'} ${j.detail.slice(0, 240)}`);
  const n = v => (v === null ? null : r1(v));
  return { ...j, warnings, record: { ...m, first: n(m.first), kill: n(m.kill), cleared: n(m.cleared), fell: n(m.fell), watched: r1(m.watched), limits: L, hand: 'lib/forge-fight.mjs FIGHT', shot: shotFile } };
}
