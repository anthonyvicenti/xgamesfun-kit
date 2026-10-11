// The pitch step's own rules (open builder M4-B): how the idea is played is decided before the cards, and said.
// Home: a part (the talk loop's pitch step). Nothing here is read by a build, and nothing here is a build-brief line.
//
//   loop      every card's spec names a ready loop with that loop's shape (tools/catalog.mjs loopProblems); the pitch
//             says which loop the idea needs (play.loop.wants: a catalog loop, ready or planned, or "none"); when that
//             loop is not ready, card 1 uses play.loop.closest, play.loop.lost is in card 1's v1.notYet, the reply
//             starts with what is lost and names the closest loop, and no card's words promise the missing loop
//   needs     with no game named (no research.signature), play.needs lists what the creator's words ask for; a row
//             the kit supports names what in card 1's spec does it; a missing row is in card 1's v1.notYet, and the
//             reply starts with a missing core row (the gauntlet's blind spot: research/open-builder/findings/
//             gauntlet-2026-10-11.md, finding 1)
//   ask       the creator, 2026-10-11: "We should ask about multiplayer and characters if there are non obvious."
//             how friends play together, and what a player is in a game with no character to walk, is either settled
//             by the creator's own words (copied into play.*.from, checked against the prompt) or asked as one of the
//             pitch's questions (about: together | body) with a default. Never both: what the creator said is not
//             asked again, and a game whose player is a character is not asked what the player is
//
// One source for both hosts: the Studio worker (studio-worker/tools/check-v2.mjs) and a person's own session (the kit's
// gamesfun_step_spec) call checkPlay; the pitch prompt's words for this step are PITCH_PLAY_STEP (the worker's
// prompts/pitch.md carries them verbatim: loop/tests/pitch-rules.test.mjs fails when it drifts).
// Pure: checkPlay(pitch, {request, catalog, kind}) → ['$.play.loop.wants: …'].
import { loopProblems } from '../tools/catalog.mjs';

export const MAX_QUESTIONS = 3;
export const ABOUT = ['together', 'body'];
/** What `by` may name beside a mechanic id, the world template and the loop of card 1's spec. */
export const BY_FIELDS = ['camera', 'players', 'characters', 'props', 'look', 'rules'];

/** The pitch prompt's words for this step, line by line (the first is the step's own line; the rest are its bullets). */
export const PITCH_PLAY_STEP = [
  '**How it is played.** Before the engine and the cards, decide how the idea is played and write it in `play` (checked):',
  '- **The loop** (the catalog\'s `loops` and `loopGuide`). Pick it by how things move and who acts when, not by theme. `play.loop.wants` is the loop the idea needs, whether or not the kit has it: a ready one, a planned one when that is the one (`turns` for a board or card game), or `"none"` only when no loop listed, built or planned, is how this idea is played; `play.loop.why` says why in one sentence. Every card\'s spec names a **ready** loop in `spec.loop` and has that loop\'s shape (`loops[].spec`).',
  '- **When the loop the idea needs is planned, or none fits, say so.** Never pitch it as if the kit had it. `play.loop.closest` is the ready loop card 1 uses and `play.loop.lost` what the creator loses by it. `reply` starts with what is lost and names the closest loop in plain words (its `label`), e.g. "Taking turns is not built yet. The closest this kit has is a timed round where everyone plays at once, so card 1 …". Card 1 lists each lost thing in `v1.notYet`, and no card\'s words promise the missing loop.',
  '- **What the idea needs** (`play.needs`, when the creator named no existing game): the 2–8 things their words ask for, each `{feature, support, by, how, core}`. A `supported` or `approximated` row names in `by` what in card 1\'s spec does it: the id of a mechanic the spec lists (`"race"`), the id of its world template (`"arena"`, not the word world), the id of its loop (`"round"`), or one of the words `camera`, `players`, `characters`, `props`, `look`, `rules`. A `missing` row says in `how` what the kit lacks, goes in card 1\'s `v1.notYet` in its own words, and, when it is `core`, `reply` starts with it. `rules` is for a number or a condition the game\'s own rules can hold (a score, a timer, a zone). It is never for a part the kit lacks: a car, a ball, a board, a shop, a save is `missing`. A second reader (another model, not you) is asked about every row whose only `by` is `rules`, and a row it calls a system the kit lacks is refused, so do not call a missing system "rules".',
  '- **How friends play together** (`play.together.how`: `versus`, `coop`, `teams`, `turns`, `own-board`). When the creator\'s words settle it, copy those words exactly into `play.together.from` (a few of their words are enough: "against bots", "two teams", "tag") and ask nothing. When they do not, ask it as one of your questions (`"about": "together"`), with the cards\' choice as the default.',
  '- **What a player is** (`play.body.what`): in the creator\'s idea, not in your card. Four in a row is a `board`, a racing game a `vehicle`, a clicker or a point-and-click story a `cursor`, a card game `cards`, even when card 1 gives each player a character to walk because the kit has nothing else. A `character` that walks about needs no question: do not ask one. A game with no such body asks how each player is shown on screen, as one of your questions (`"about": "body"`, with a default), unless the creator\'s words say it (`play.body.from`). A card that uses a part whose catalog entry has `asks` owes that question the same way.',
  '- Do not ask what is obvious: a tag game or a shooter already says who plays whom and what you are.',
];

// ── words ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const STOPW = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'you', 'your', 'it', 'its', 'is', 'are', 'by', 'for', 'from', 'each', 'every', 'that', 'as', 'at', 'no', 'not', 'yet']);
const stemw = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const content = t => new Set(String(t ?? '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOPW.has(w)).map(stemw));
/** Does `text` name `feature`? Half its content words (at least one, at most three needed). The worker's own rule. */
export function names(text, feature) {
  const f = [...content(feature)], t = content(text);
  if (!f.length) return false;
  const need = Math.min(3, Math.max(1, Math.ceil(f.length / 2)));
  return f.filter(w => t.has(w)).length >= need;
}
const flat = s => String(s ?? '').toLowerCase().replace(/[‘’]/g, '\'').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
/** Is `quote` the creator's own words (any case, any spacing)? */
export const quoted = (quote, words) => { const q = flat(quote); return q.length >= 2 && flat(words).includes(q); };
const firstSentence = s => String(s ?? '').split(/(?<=[.!?])\s+/)[0] ?? '';

// What the creator's words say about how friends play. Not a list of kinds of game: only words about who plays whom.
export const SAID_TOGETHER = /\b(against\s+(each\s+other|one\s+another|bots|the\s+(bots|computer|ai|other\s+team)|my\s+friends|your\s+friends|friends)|versus|vs\.?|1\s*v\s*1|\d\s*v\s*\d|free[\s-]for[\s-]all|every(one|body)\s+for\s+(them|him|her)sel(f|ves)|two\s+(teams|squads|sides)|(in|as|on|into)\s+(two\s+)?teams?|team\s+(up|vs|against)|co-?op(erative)?|work(ing)?\s+together|help\s+each\s+other|take\s+turns|taking\s+turns|turn[\s-]based|one\s+at\s+a\s+time|each\s+on\s+(our|their|your|his|her)\s+own)\b/i;

// What a card may only say when the loop it names is built. Data per loop id; a loop the catalog marks ready is not held.
const LOOP_WORDS = {
  // ("turn order" is not here: the honest card says "the kit has no turn order yet", and the gauntlet's did)
  turns: /\b(tak(e|es|ing)\s+turns|turn[\s-]based|(your|my|their|next|each|every|a)\s+turn\b|one\s+(move|disc|card|piece)\s+at\s+a\s+time|wait(s|ing)?\s+for\s+(your|their)\s+turn)/gi,
  match: /\b(best\s+of\s+(three|five|seven|\d+)|first\s+to\s+(win\s+)?(two|three|four|five|\d+)\s+rounds?|rounds?\s+won|match\s+point)\b/gi,
  endless: /\b(endless(ly)?|never\s+ends?|no\s+end|goes\s+on\s+forever)\b/gi,
  saved: /\b(progress\s+(is\s+)?(saved|kept)|(keeps?|saves?)\s+(your|their|its|the)\s+(pets?|money|coins?|upgrades?|progress|town|house|base)|while\s+you\s+are\s+away|offline\s+(income|earnings)|come\s+back\s+(tomorrow|later)\s+to)\b/gi,
};
const isReady = l => /^ready/.test(l?.status ?? '');
const creatorWords = r => `${r?.prompt ?? ''}\n${r?.steer ?? ''}\n${r?.choice?.text ?? ''}`;

/** The parts card specs use whose catalog entry asks the creator something: [{part, about, why}]. */
export function partAsks(cards, catalog) {
  const list = v => (Array.isArray(v) ? v : []);
  const out = [], seen = new Set();
  const take = (id, entry) => { for (const a of list(entry?.asks)) if (ABOUT.includes(a?.about) && !seen.has(`${id}/${a.about}`)) { seen.add(`${id}/${a.about}`); out.push({ part: id, about: a.about, why: a.why ?? '' }); } };
  for (const c of cards) {
    const s = c?.spec; if (!s) continue;
    for (const m of list(s.mechanics)) take(m.id, list(catalog?.mechanics).find(x => x.id === m.id));
    take(s.world?.template, list(catalog?.worlds).find(x => x.id === s.world?.template));
    take(s.loop, list(catalog?.loops).find(x => x.id === s.loop));
  }
  return out;
}

/**
 * The pitch step's rules on a pitch (pitch.json): run after the schema check. A catalog without `loops` (an older kit,
 * the worker's fallback) is not judged. A refine's pitch is held to its cards' loops and words only: the idea was read
 * and the questions asked when it was first pitched.
 * → errors with JSON paths from the pitch root ($.play.loop.wants: …)
 */
export function checkPlay(pitch, { request = {}, catalog = null, kind = request.kind ?? 'pitch' } = {}) {
  const loops = Array.isArray(catalog?.loops) ? catalog.loops : [];
  if (!loops.length || !pitch || typeof pitch !== 'object') return [];
  const errors = [], cards = Array.isArray(pitch.cards) ? pitch.cards : [];
  const fresh = kind === 'pitch';
  const ready = loops.filter(isReady), label = id => loops.find(l => l.id === id)?.label ?? id;
  const readyList = ready.map(l => `"${l.id}" (${l.label})`).join(', ');

  // every card: a ready loop with its shape, and no words that promise a loop that is not built
  for (const [i, c] of cards.entries()) {
    if (!c?.spec) continue;
    for (const e of loopProblems(c.spec, loops, { require: fresh })) errors.push(`$.cards[${i}].spec.${e}`);
    for (const l of loops) {
      if (isReady(l) || !LOOP_WORDS[l.id]) continue;
      for (const [field, text] of [['hook', c.hook], ['howItPlays', c.howItPlays], ['v1.has', (c.v1?.has ?? []).join('. ')]]) {
        const words = [...new Set((String(text ?? '').match(LOOP_WORDS[l.id]) ?? []).map(w => w.toLowerCase().replace(/\s+/g, ' ').trim()))];
        if (words.length) errors.push(`$.cards[${i}].${field}: it promises ${words.slice(0, 3).map(w => `"${w}"`).join(', ')}, and ${l.label} is ${String(l.status).split(/[:(]/)[0].trim()}, not built: say plainly what this card does instead, and put ${l.label} in v1.notYet`);
      }
    }
  }
  if (!fresh) return errors;

  const play = pitch.play;
  if (!play || typeof play !== 'object') {
    errors.push(`$.play: say how the idea is played before the cards: {loop: {wants, why}, together: {how, from}, body: {what}, needs: [...]}. wants is the loop the idea needs (${loops.map(l => l.id).join(', ')}, or "none" when none of them fits; ready today: ${ready.map(l => l.id).join(', ')})`);
    return errors;
  }
  const c1 = cards[0], spec1 = c1?.spec ?? {};
  const notYet = (c1?.v1?.notYet ?? []).join(' | '), reply = String(pitch.reply ?? ''), first = firstSentence(reply);
  const lead = [];          // what the reply must start with one of: what the idea loses, core things the kit lacks

  // the loop the idea needs
  const L = play.loop ?? {}, wanted = loops.find(l => l.id === L.wants) ?? null;
  if (L.wants !== 'none' && !wanted) errors.push(`$.play.loop.wants: "${L.wants}" is not a loop in the catalog (${loops.map(l => l.id).join(', ')}); write "none" when none of them is how this idea is played`);
  else if (wanted && isReady(wanted)) {
    if (c1?.spec && spec1.loop && spec1.loop !== wanted.id) errors.push(`$.cards[0].spec.loop: the idea needs "${wanted.id}" (${wanted.label}; play.loop.wants) and the kit has it, so card 1 plays it; this card's loop is "${spec1.loop}"`);
  } else {
    const what = wanted ? `${wanted.label} ("${wanted.id}") is ${String(wanted.status).split(/[:(]/)[0].trim()}, not built` : 'none of the kit\'s loops is how this idea is played';
    const closest = loops.find(l => l.id === L.closest) ?? null, lost = Array.isArray(L.lost) ? L.lost.filter(Boolean) : [];
    if (!closest || !isReady(closest)) errors.push(`$.play.loop.closest: ${what}, so name the ready loop card 1 uses instead (${readyList})`);
    else if (c1?.spec && spec1.loop && spec1.loop !== closest.id) errors.push(`$.cards[0].spec.loop: play.loop.closest is "${closest.id}", so card 1 plays that; this card's loop is "${spec1.loop}"`);
    if (!lost.length) errors.push(`$.play.loop.lost: ${what}: say what the creator loses by playing it ${closest ? `as ${closest.label}` : 'on the closest loop'}, in plain words (one to four things)`);
    for (const x of lost) if (!names(notYet, x)) errors.push(`$.cards[0].v1.notYet: "${x}" (play.loop.lost) is not in card 1's v1.notYet; list it there in its own words`);
    lead.push(...lost, ...(wanted ? [wanted.label] : []));
    if (closest && isReady(closest) && reply && !names(reply, closest.label)) errors.push(`$.reply: ${what}; the reply names the closest thing the kit can do in plain words, "${closest.label}", and what is lost by it`);
  }

  // what the idea needs, when no game is named (a named game has research.signature, which the host holds)
  const needs = Array.isArray(play.needs) ? play.needs : null;
  if (!needs && !pitch.research?.signature) errors.push('$.play.needs: list the 2-8 things the creator\'s words ask for, each {feature, support: "supported" | "approximated" | "missing", by, how, core}; a missing one goes in card 1\'s v1.notYet');
  if (needs) {
    const mech = new Set((spec1.mechanics ?? []).map(m => m?.id)), allowed = new Set([...mech, spec1.world?.template, spec1.loop, ...BY_FIELDS].filter(Boolean));
    if (!needs.some(r => r?.core)) errors.push('$.play.needs: mark the one to three things without which it is not the game the creator asked for ("core": true)');
    for (const [k, r] of needs.entries()) {
      if (r?.support === 'missing') {
        if (!names(notYet, r.feature)) errors.push(`$.cards[0].v1.notYet: the idea's missing "${r.feature}" (play.needs[${k}]) is not in card 1's v1.notYet; list it there in its own words`);
        if (r.core) lead.push(r.feature);
        continue;
      }
      const by = Array.isArray(r?.by) ? r.by : [];
      if (!by.length) errors.push(`$.play.needs[${k}].by: "${r?.feature}" is ${r?.support}: name what in card 1's spec does it (one of its mechanics${mech.size ? `: ${[...mech].join(', ')}` : ''}; its world "${spec1.world?.template}"; its loop; or ${BY_FIELDS.join(', ')}), or mark it missing`);
      for (const b of by) if (!allowed.has(b)) errors.push(`$.play.needs[${k}].by: "${b}" is not in card 1's spec (its mechanics: ${[...mech].join(', ') || 'none'}; world "${spec1.world?.template}"; loop "${spec1.loop}"; or ${BY_FIELDS.join(', ')}): add it to the spec, or mark "${r?.feature}" missing`);
    }
  }
  if (lead.length) {
    if (!reply) errors.push(`$.reply: the idea asks for something this kit does not have (${lead.slice(0, 3).map(x => `"${x}"`).join(', ')}): the reply starts by saying so, before anything else`);
    else if (!lead.some(x => names(first, x))) errors.push(`$.reply: its first sentence must say what is missing (${lead.slice(0, 4).map(x => `"${x}"`).join(', ')}) before anything else; it says "${first.slice(0, 120)}"`);
  }

  // ask, or quote: how friends play together, and what a player is when there is no character
  const words = creatorWords(request), questions = Array.isArray(pitch.questions) ? pitch.questions : [];
  const asks = about => questions.find(q => q?.about === about) ?? null;
  const left = Math.max(0, MAX_QUESTIONS - (Array.isArray(request.asked) ? request.asked.length : 0));
  const owed = partAsks(cards, catalog);
  const T = play.together ?? {}, B = play.body ?? {};
  // together
  const tQuote = T.from != null && quoted(T.from, words);
  if (T.from != null && !tQuote) errors.push(`$.play.together.from: "${T.from}" is not in the creator's words: copy the words that settle how friends play exactly as they wrote them, or leave "from" out and ask (a question with "about": "together")`);
  const said = words.match(SAID_TOGETHER)?.[0] ?? null, qT = asks('together');
  if (qT && (said || tQuote)) errors.push(`$.questions: the creator already said how friends play ("${said ?? T.from}"): do not ask it again (drop the question "${qT.id}" and put those words in play.together.from)`);
  else if (!qT && !tQuote && T.from == null) {
    const part = owed.find(o => o.about === 'together');
    if (said) errors.push(`$.play.together.from: the creator's words say how friends play ("${said}"): copy them here`);
    else if (left > 0) errors.push(`$.questions: the creator's words do not say how friends play together${part ? ` (and "${part.part}" needs it: ${part.why})` : ''}: ask it as one of the questions ("about": "together"; e.g. against each other, together, in teams), with the cards' choice ("${T.how}") as the default`);
  }
  if (T.how === 'turns' && L.wants !== 'turns') errors.push('$.play.together.how: friends take turns, so the loop the idea needs is "turns" (play.loop.wants)');
  const mode = spec1.players?.mode ?? (spec1.players?.teams >= 2 ? 'teams' : 'versus');
  if (c1?.spec && ((T.how === 'coop' && mode !== 'coop') || (T.how === 'teams' && !(mode === 'teams' || spec1.players?.teams >= 2)) || (T.how === 'versus' && mode === 'coop'))) errors.push(`$.cards[0].spec.players.mode: play.together.how is "${T.how}" and card 1's players are "${mode}": card 1 plays it the way the creator said, or the way the question's default says`);
  // body
  const qB = asks('body'), bodyPart = owed.find(o => o.about === 'body'), noBody = B.what && B.what !== 'character';
  if (B.from != null && !quoted(B.from, words)) errors.push(`$.play.body.from: "${B.from}" is not in the creator's words: copy the words that say how each player is shown exactly as they wrote them, or leave "from" out and ask (a question with "about": "body")`);
  const bodySaid = B.from != null && quoted(B.from, words);
  if (!noBody && !bodyPart && qB) errors.push(`$.questions: each player is a character that walks about (play.body.what), which needs no question: drop "${qB.id}" (what the characters look like is another question, with no "about")`);
  if ((noBody || bodyPart) && qB && bodySaid) errors.push(`$.questions: the creator already said how each player is shown ("${B.from}"): do not ask it again (drop the question "${qB.id}")`);
  if ((noBody || bodyPart) && !qB && !bodySaid && B.from == null && left > 0) errors.push(`$.questions: ${noBody ? `a player in this idea is not a character that walks about (play.body.what: "${B.what}")` : `"${bodyPart.part}" has no player body of its own (${bodyPart.why})`}, and the creator's words do not say how each player is shown: ask it as one of the questions ("about": "body"; e.g. a character walking beside it, or a marker in each player's colour), with the cards' choice as the default`);
  return errors;
}
