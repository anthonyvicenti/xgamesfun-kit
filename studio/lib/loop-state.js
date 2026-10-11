// The build loop's state file (<game>/.gf-loop/state.json, schema gf-loop/1, final: games.fun research/gf-three/loop/README.md),
// as a person reads it. loopView is the one reader of that shape; if the shape moves, only it changes. No DOM.

const STEP_WORDS = {
  pitch: 'Choosing a pitch', spec: 'Checking the spec', create: 'Making the game folder', agent: 'Your session is writing the game',
  fix: 'Applying automatic fixes', verify: 'Running verify', playtest: 'The play-tester is playing', repair: 'Your session is repairing what failed',
  deliver: 'Handing the game over', done: 'Finished',
};
const STATUS_WORDS = { building: 'Building', 'waiting-on-question': 'Waiting for your answer', delivered: 'Delivered', failed: 'Stopped: it did not work out', cancelled: 'Cancelled: you rolled back' };

/** Raw state (or null) + the newest verify run (summarizeVerdict shape, or null) → what the Build tab draws. */
export function loopView(raw, verdict = null) {
  if (!raw || typeof raw !== 'object') return { present: false };
  const failedN = new Set((Array.isArray(raw.verify?.failed) ? raw.verify.failed : []).map(f => String(typeof f === 'object' ? f.n ?? f.check : f)));
  const checks = (verdict?.failed ?? []).filter(c => !failedN.size || failedN.has(String(c.n)));
  // each failed check with its rule and fix as verify printed them (detail); state-held objects {n, rule, fix} win
  const held = new Map((Array.isArray(raw.verify?.failed) ? raw.verify.failed : []).filter(f => f && typeof f === 'object').map(f => [String(f.n ?? f.check), f]));
  const failures = (checks.length ? checks : [...failedN].map(n => ({ n, name: `check ${n}`, detail: '' }))).map(c => {
    const h = held.get(String(c.n)) ?? {};
    return { n: c.n, name: c.name ?? h.name ?? `check ${c.n}`, rule: h.rule ?? null, fix: h.fix ?? null, detail: h.detail ?? c.detail ?? '' };
  });
  const pt = raw.playtest;
  return {
    present: true,
    status: raw.status ?? 'building',
    statusWords: STATUS_WORDS[raw.status] ?? String(raw.status ?? ''),
    step: raw.step ?? null,
    stepWords: STEP_WORDS[raw.step] ?? String(raw.step ?? ''),
    why: raw.why ?? '',
    round: Number(raw.round) || 0,
    counts: { repairs: raw.repairs ?? 0, rescues: raw.rescues ?? 0, verifies: raw.verifies ?? 0, playtests: raw.playtests ?? 0 },
    verify: raw.verify ? { n: raw.verify.n ?? null, ok: raw.verify.ok === true, playable: raw.verify.playable === true, at: raw.verify.at ?? null } : null,
    failures,
    playtest: pt ? { round: pt.round ?? null, ok: pt.ok === true, verdict: pt.verdict ?? (pt.ok ? 'pass' : 'fail'), at: pt.at ?? null, notes: playtestNotes(raw.pt ?? pt) } : null,
    waitingOn: raw.handed ? raw.handed.kind ?? raw.handed.step ?? 'your session' : null,
    fixes: (raw.fixes ?? []).slice(-8).map(f => ({ round: f.round, fix: f.fix, file: f.file, line: f.line ?? '' })),
    history: (raw.history ?? []).slice(-12).map(h => ({ step: h.step, next: h.next, why: h.why ?? '', at: h.at ?? null })),
    outcome: raw.outcome == null ? null : typeof raw.outcome === 'object' ? raw.outcome.outcome ?? JSON.stringify(raw.outcome) : String(raw.outcome),
    staleProof: /stale/.test(String(raw.outcome?.outcome ?? raw.outcome ?? '')),
    updated: raw.updated ?? null,
  };
}

/** The play-tester's notes, as short lines (it may hold `notes`, `issues` or `report`). */
export function playtestNotes(pt) {
  const take = v => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
  return [...take(pt?.notes), ...take(pt?.issues), ...take(pt?.report)].map(x => (typeof x === 'string' ? x : x?.text ?? x?.note ?? JSON.stringify(x))).slice(0, 12);
}
