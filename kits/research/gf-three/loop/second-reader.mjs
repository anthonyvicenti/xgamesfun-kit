// The pitch's second reader (open builder wave 8, track P, question 20). Pure: it builds the question and reads the answer;
// the model call is a RUNNER the host passes in (like the play-tester), so this library never starts an agent, signs
// anyone in or sends a request to a model.
//
// The blind spot it closes: the pitch checker can only hold a card to its own words. A pitch that calls a missing system
// "supported by `rules`" (a car, a block world, saving, a new camera) passes (research/studio-v2/evals/gauntlet/honesty-probe.mjs,
// "missing-called-rules": 12 of 12). X1 showed that a build agent CAN write a small mechanic in rules.js, so "rules do it" is
// sometimes true. So each such claim goes to a reader that did not write the pitch, with one question and nothing else:
// is this something rules.js can do with the kit's contract (a rule, a score, a small mechanic), or a system the kit lacks?
//
//   rulesClaims(pitch)              the needs rows whose only doer is `rules` (a row that also names a part is that part's)
//   secondReadPrompt(claim, ctx)    the one question, as text (the contract, the ready parts, the creator's words)
//   parseRead(text)                 the answer: {verdict: 'rules' | 'system' | 'part', why, part?} | null
//   secondRead(pitch, {runner, ...}) → {claims, reads, unread, errors, skipped}
//
// runner(prompt, claim) → Promise<string>: a cheap, separate model call the HOST makes (the Studio worker: an executor
// session on SECOND_READER_MODEL; a person's session: a subagent). No runner = the step is skipped and said (`skipped`).
// A runner that throws, or an answer that cannot be read, leaves the claim standing and says so (`unread`): a reader that
// failed is not a verdict.
//
// Home: a part (the pitch step), like pitch-rules.mjs. Nothing here is a build-brief line.

export const SECOND_READER_VERSION = 1;
export const SKIPPED_NO_RUNNER = 'no second reader on this host: the pitch\'s "rules" claims were read only by the checker';

/** What rules.js can do, as the reader is told (CONTRACT §3, and what the X1 experiment showed builders writing). */
export const RULES_CAN = [
  'rules.js is the one file of the game\'s own code. It runs on top of the kit with its hooks (setup, roundStart, update every frame, event, check for the end of the round, results, bot) and a context: the three.js scene and camera, the physics world, the players (positions, score, alive, per-player data), the world (spawn points, named zones, props), the mechanics already configured for the game, host-owned shared state that every copy sees, network events between copies, the HUD and score helpers (meter, banner, toast, goal text), sounds.',
  'It CAN do: scoring and win or lose conditions, timers and phases, zones and triggers, spawning and removing things on the kit\'s world, picking who is "it", item pickups and drops, simple effects on the kit\'s bodies (speed, health, knockback, visibility), and a small mechanic of this kind (tag, king of the hill, a hot potato, capture a flag) written as host-owned rules.',
  'It CANNOT add what the kit does not have underneath: a kind of body or vehicle with its own physics and controls (a car, a boat, a horse, a plane, a ball sport\'s ball physics), a world the players edit or dig (blocks, voxels, terrain), saving or progress that persists between sessions or while away, a new camera mode, a new rendering or lighting system, a new kind of loop (turns, an endless world) the kit does not run, a new input device, or a large new system (an economy with shops, a base builder, an inventory) where the kit lists no part for it.',
].join('\n');

/** The needs rows that say `rules` is the only thing doing it: [{index, feature, support, how, core}] (index into play.needs). */
export function rulesClaims(pitch) {
  const needs = Array.isArray(pitch?.play?.needs) ? pitch.play.needs : [];
  const out = [];
  for (const [index, r] of needs.entries()) {
    if (!r || (r.support !== 'supported' && r.support !== 'approximated')) continue;
    const by = Array.isArray(r.by) ? r.by : [];
    if (by.length && by.every(b => b === 'rules')) out.push({ index, feature: String(r.feature ?? ''), support: r.support, how: String(r.how ?? ''), core: !!r.core });
  }
  return out;
}

const list = v => (Array.isArray(v) ? v : []);
/** The catalog's ready parts, as a short list for the reader: what exists, so "a part does it" can be told from "rules do it". */
export function readyParts(catalog) {
  const ready = x => !x.status || /^ready/.test(x.status);
  const one = x => `${x.id}${x.describe ? ` (${String(x.describe).split(/[.;]/)[0].slice(0, 90)})` : x.label ? ` (${x.label})` : ''}`;
  return {
    mechanics: list(catalog?.mechanics).filter(m => m?.id && ready(m)).map(one),
    worlds: list(catalog?.worlds).filter(w => w?.id).map(w => w.id),
    loops: list(catalog?.loops).filter(l => l?.id && ready(l)).map(l => `${l.id} (${l.label})`),
  };
}

/** The one question for one claim. It does not say what the pitch wanted the answer to be. */
export function secondReadPrompt(claim, { request = {}, catalog = null } = {}) {
  const parts = readyParts(catalog);
  const words = [request.prompt, request.steer, request.choice?.text].filter(Boolean).join('\n').slice(0, 1500);
  return [
    'You are a second reader for a game maker. Answer one narrow question about what a game\'s own code file can do. Do not design the game and do not use any tool: answer from what is written here.',
    '',
    'THE KIT AND ITS RULES FILE',
    RULES_CAN,
    '',
    'WHAT THE KIT ALREADY HAS AS READY PARTS (a part does its job without rules.js)',
    `mechanics: ${parts.mechanics.join('; ') || 'none listed'}`,
    `worlds: ${parts.worlds.join(', ') || 'none listed'}`,
    `loops: ${parts.loops.join('; ') || 'none listed'}`,
    '',
    ...(words ? ['WHAT THE PERSON ASKED FOR', words, ''] : []),
    'THE THING IN QUESTION',
    `Feature: ${claim.feature}`,
    `How a designer says the game gets it: ${claim.how || '(not said)'}`,
    '',
    'QUESTION',
    'Can an agent write this feature in rules.js with the kit as described (a rule, a score, a condition, a small mechanic on the kit\'s bodies and world)? Or does it need a system the kit does not have, so that a game without it would not really have the feature?',
    'Answer with one JSON object and nothing else:',
    '{"verdict": "rules" | "system" | "part", "why": "<one plain sentence>", "part": "<a ready part id from the list, only when verdict is part>"}',
    '- "rules": rules.js can do it with the kit as it is.',
    '- "system": it needs a system the kit lacks (name the system in why).',
    '- "part": a ready part in the list already does it (name it).',
  ].join('\n');
}

/** The reader's answer: JSON anywhere in the text. → {verdict, why, part?} or null when it cannot be read. */
export function parseRead(text) {
  const s = String(text ?? '');
  for (const m of s.matchAll(/\{[^{}]*\}/g)) {
    try {
      const v = JSON.parse(m[0]);
      const verdict = String(v.verdict ?? '').toLowerCase().trim();
      if (!['rules', 'system', 'part'].includes(verdict)) continue;
      return { verdict, why: String(v.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), ...(v.part ? { part: String(v.part).trim() } : {}) };
    } catch { /* not json */ }
  }
  return null;
}

/**
 * Ask the reader about each `rules` claim of a fresh pitch.
 *   runner       async (prompt, claim) → text. Absent: skipped, and said.
 *   catalog      for the list of ready parts and the check of a named part
 *   request      the creator's words
 *   cache        a Map the host keeps across checks of the same job (one reading per claim, not per check)
 * → {claims, reads: [{feature, index, verdict, why, part?}], unread: [{feature, why}], errors: ['$.play.needs[2]: …'], skipped?: string}
 */
export async function secondRead(pitch, { runner = null, catalog = null, request = {}, cache = new Map() } = {}) {
  const claims = rulesClaims(pitch);
  const out = { claims: claims.length, reads: [], unread: [], errors: [] };
  if (!claims.length) return out;
  if (typeof runner !== 'function') return { ...out, skipped: SKIPPED_NO_RUNNER };
  const readyMech = new Set(list(catalog?.mechanics).filter(m => m?.id && (!m.status || /^ready/.test(m.status))).map(m => m.id));
  await Promise.all(claims.map(async claim => {
    const key = `${claim.feature}\u0000${claim.how}`;
    let read = cache.get(key);
    if (!read) {
      try { read = parseRead(await runner(secondReadPrompt(claim, { request, catalog }), claim)); } catch (e) { out.unread.push({ feature: claim.feature, why: String(e?.message ?? e).slice(0, 160) }); return; }
      if (!read) { out.unread.push({ feature: claim.feature, why: 'the answer was not a verdict' }); return; }
      cache.set(key, read);
    }
    out.reads.push({ feature: claim.feature, index: claim.index, ...read });
    const at = `$.play.needs[${claim.index}]`;
    if (read.verdict === 'system') {
      out.errors.push(`${at}: a second reader, asked only whether "${claim.feature}" is something rules.js can do, says it is a system the kit lacks (${read.why || 'no reason given'}): mark it "missing", put it in card 1's v1.notYet in its own words, and, when it is core, say it first in the reply`);
    } else if (read.verdict === 'part' && read.part && readyMech.has(read.part)) {
      out.errors.push(`${at}: a second reader says the ready part "${read.part}" does "${claim.feature}" (${read.why || 'no reason given'}): add it to card 1's mechanics and name it in "by", or mark the row "missing"`);
    }
  }));
  out.reads.sort((a, b) => a.index - b.index);
  out.errors.sort();
  return out;
}
