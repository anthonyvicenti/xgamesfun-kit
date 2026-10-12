// /api/build/…: the build loop as the studio shows it (read-only), and the roll-back button.
//   GET  /state      → { loop, verdict, checkpoints, rollback, elsewhere, said }  said = the delivery's outcome in words and its first words
//                      (.gf-loop/job/out/outcome.json, written by gamesfun_step_deliver; null when none or about another outcome)
//                      also → { loop, verdict, checkpoints, rollback, elsewhere }  elsewhere = the game a session is building when it is not this studio's
//                      (each of)  loop = the loop state file as written (null when none),
//                      verdict = the newest verify run summarised, checkpoints = what lib/checkpoint.mjs lists (M2-G)
//   POST /rollback   { id } → restores that checkpoint through lib/checkpoint.mjs; a run under way is cancelled (lib/cancel.mjs)
// The state file is written only by the loop library (through M2-G's tools). It is read here; never written.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCancel, writeCancel } from '../../lib/cancel.mjs';
import { latestVerdict } from '../../lib/games.mjs';
import { gameReady } from '../index.mjs';
import { KIT_ROOT } from '../../lib/paths.mjs';
import { HttpError, openGame, readJson } from '../http.mjs';

// where the loop keeps its state (final, games.fun research/gf-three/loop/README.md): <game>/.gf-loop/state.json, schema gf-loop/1
const STATE_FILES = ['.gf-loop/state.json'];

export async function readLoopFile(gameDir) {
  for (const rel of STATE_FILES) {
    try {
      const j = JSON.parse(await readFile(path.join(gameDir, ...rel.split('/')), 'utf8'));
      if (j && typeof j === 'object') return j;
    } catch {}
  }
  return null;
}

/**
 * What the talk loop left for the person (the studio's conversation shows it): the idea in their words and the
 * concepts the pitch step accepted (.gf-loop/job/pitch.json, pitch.schema.json), cut to what a card shows.
 */
export async function talkOf(gameDir) {
  const job = path.join(gameDir, '.gf-loop', 'job');
  const idea = await readFile(path.join(job, 'idea.txt'), 'utf8').then(t => t.slice(0, 2000), () => null);
  let pitch = null;
  try {
    const p = JSON.parse(await readFile(path.join(job, 'pitch.json'), 'utf8'));
    const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const list = (v, n) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, n)) : []);
    pitch = {
      reply: text(p.reply, 400),
      cards: (Array.isArray(p.cards) ? p.cards : []).slice(0, 3).map(c => ({ id: text(c?.id, 24), title: text(c?.title, 60), hook: text(c?.hook, 200), howItPlays: text(c?.howItPlays, 600), players: text(c?.players, 80), v1: { has: list(c?.v1?.has, 120), notYet: list(c?.v1?.notYet, 120) } })),
      questions: (Array.isArray(p.questions) ? p.questions : []).slice(0, 3).map(q => ({ id: text(q?.id, 32), text: text(q?.text, 160), default: text(q?.default, 32), options: (Array.isArray(q?.options) ? q.options : []).slice(0, 4).map(o => ({ id: text(o?.id, 32), label: text(o?.label, 60) })) })),
    };
  } catch { /* no concepts yet */ }
  return { idea, pitch };
}

async function checkpointLib() {
  try { return await import(pathToFileURL(path.join(KIT_ROOT, 'lib', 'checkpoint.mjs')).href); } catch { return null; }
}

export default function register(router, ctx) {
  // the open game, read at each request: the studio may open another while the server runs (server/index.mjs)
  const G = () => openGame(ctx);

  router.get('/state', async () => {
    if (!ctx.gameDir) return { none: true, made: false, loop: null, verdict: null, checkpoints: [], rollback: false, elsewhere: null, said: null, pitch: null, idea: null };
    const lib = await checkpointLib();
    let checkpoints = [];
    try { if (lib?.listCheckpoints) checkpoints = (await lib.listCheckpoints(G())) ?? []; } catch (e) { ctx.log(`checkpoints: ${e.message}`); }
    // a run the person rolled back is cancelled from that moment, also before a loop tool has written it into the state
    let loop = await readLoopFile(G());
    const mark = loop?.status === 'building' ? await readCancel(G()) : null;
    if (mark) loop = { ...loop, status: 'cancelled', step: 'done', outcome: 'cancelled', why: mark.reason, handed: null };
    // A session that is building another game than the one this studio shows: say so, never show nothing.
    let elsewhere = null;
    try {
      const { bridgeFor } = await import('./session.mjs');
      const other = bridgeFor(ctx.url)?.bridge.sessions().find(x => x.state !== 'ended' && x.game && path.resolve(x.game) !== path.resolve(G()));
      if (other) elsewhere = { game: other.game, name: path.relative(KIT_ROOT, other.game).split(path.sep).join('/'), loop: await readLoopFile(other.game).then(l => (l ? { status: l.status, step: l.step } : null)) };
    } catch { /* no bridge on this server */ }
    // how the delivery was named, in words (the deliver tool's record): only for the outcome the state holds now
    let said = null;
    if (loop?.status === 'delivered') {
      try {
        const o = JSON.parse(await readFile(path.join(G(), '.gf-loop', 'job', 'out', 'outcome.json'), 'utf8'));
        if (o && o.outcome === loop.outcome) said = { outcome: String(o.outcome), words: typeof o.words === 'string' ? o.words : null, firstWords: typeof o.firstWords === 'string' ? o.firstWords.slice(0, 1200) : null };
      } catch { /* none written */ }
    }
    const made = gameReady(G());
    if (made) ctx.gameMade?.();                      // the folder the loop was making is a game now: the server watches it
    return { elsewhere, loop, said, verdict: await latestVerdict(G()), checkpoints, rollback: !!lib?.restoreCheckpoint, made, ...(await talkOf(G())) };
  });

  router.post('/rollback', async req => {
    const { id } = await readJson(req);
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'id is required');
    const lib = await checkpointLib();
    if (!lib?.restoreCheckpoint) throw new HttpError(501, 'Rolling back is not available in this kit yet (lib/checkpoint.mjs).');
    let out;
    try { out = { restored: id, ...(await lib.restoreCheckpoint(G(), id)) }; } catch (e) { throw new HttpError(400, e.message); }
    // A roll-back while a run is under way cancels the run (the decision and its reasons: mcp/tools/loop.mjs,
    // applyCancel). This process cannot end the run itself (the loop's state is the MCP server's to write), so it
    // leaves the mark the loop tools apply; from this moment the stop guard and this tab read the run as cancelled.
    const loop = await readLoopFile(G());
    if (loop?.status === 'building' && loop.step !== 'done') {
      const label = (await lib.listCheckpoints(G()).catch(() => [])).find(c => c.id === id)?.label ?? id;
      const mark = await writeCancel(G(), { reason: `the person rolled the game back from the studio page to "${label}"`, checkpoint: id, label });
      out.cancelled = { run: loop.kind ?? 'build', step: loop.step, at: mark.at };
    }
    return out;
  });
}
