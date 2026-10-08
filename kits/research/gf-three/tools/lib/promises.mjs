// Promises need proof (creator decision 2026-10-06, research/foundations/evidence/studio-v2-build-method-decision-2026-10-06.json).
// A game promises things: every control its HUD lists, what each mechanic is "as", the hook on its title card, the core
// loop in its rules, the creator's accept items, and the kit's standing promises. This module derives that list from
// spec.json and config/game.json, with no browser. Each promise names its proofs: a verify check ('verify:N') or a
// play-tester's own screen ('play'). The worker writes it into every build and v2 change job (job/promises.json), and
// the play-tester (research/studio-v2/prompts/playtest.md) is held to the 'play' ones.
//
//   const list = derivePromises({ spec, config });   // { schema, title, hook, controls, promises: [...], notPromised, excluded }
//   const list = await promisesFor(gameDir, { spec }); // reads <game>/spec.json (or the spec given) and <game>/config/game.json
//
// A promise: { id, text (plain words a player would say), source (where it came from), proofs: ['verify:N' | 'play'],
//              core (true: the first-minute loop; a core promise still failing after the repair rounds fails the job),
//              kind: 'control' | 'loop' | 'score' | 'mechanic' | 'hook' | 'accept' | 'kit', and for a control: action, keys, key, hud }
// The spec's notInV1 items are never promised: a derived promise that is mostly one of them is dropped (listed in `excluded`).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SCHEMA = 'gf-three-promises/1';

/** What the kit's HUD prints for each action (kit/ui/ui.js helpLine) and the key the play tool presses for it. */
export const CONTROL_KEYS = {
  primary: { keys: 'click / F', key: 'Mouse' },
  secondary: { keys: 'right click / Q', key: 'MouseRight' },
  interact: { keys: 'E', key: 'KeyE' },
  jump: { keys: 'Space', key: 'Space' },
};

/** The HUD's help line for a controls map, exactly as kit/ui/ui.js draws it. */
export function hudLine(controls = {}) {
  const parts = ['WASD move', 'mouse look'];
  if (controls.primary) parts.push(`click / F: ${controls.primary}`);
  if (controls.secondary) parts.push(`right click / Q: ${controls.secondary}`);
  if (controls.interact) parts.push(`E: ${controls.interact}`);
  if (controls.jump) parts.push(`Space: ${controls.jump}`);
  return parts.join(' · ');
}

/** The kit's standing promises (CONTRACT §5 check numbers). verify proves them; 'play' adds what a new player sees. */
export const KIT_PROMISES = [
  { id: 'kit.friends', text: 'With friends in the game, I see each of them as a character with a name, where they really are.', proofs: ['verify:5'], check: 'friends visible' },
  { id: 'kit.round', text: 'A round ends on a results screen that says who won, and I can play again.', proofs: ['verify:6', 'play'], check: 'a round to results and replay' },
  { id: 'kit.fair', text: 'When I get knocked down I am back up within a moment, and nobody can keep me on the floor.', proofs: ['verify:10', 'play'], check: 'fair play' },
  { id: 'kit.clean', text: 'The world looks tidy: nothing floating, sunk into something else or cluttering the floor.', proofs: ['verify:11'], check: 'clean world' },
  { id: 'kit.happens', text: 'Something happens in a round: scores move.', proofs: ['verify:12'], check: 'something happens' },
  { id: 'kit.controls', text: 'Every control the HUD lists does something I can see.', proofs: ['verify:13'], check: 'controls work' },
  { id: 'kit.looks', text: 'Every character and prop the creator asked to be made is that model, or the delivery names the placeholder still in its place and why; no enemy wears a player\'s body in another colour.', proofs: ['verify:14'], check: 'looks honoured' },
  { id: 'kit.world', text: 'The world is a whole place the size I asked for: a building has walls all round, a ceiling and real doors (enemies come in through them), and past the walls I see a street or skyline, not an empty plain.', proofs: ['verify:17', 'play'], check: 'the world is complete' },
];

// ---- words (for the notInV1 exclusion) ----
const STOP = new Set(['the', 'and', 'with', 'your', 'you', 'for', 'that', 'this', 'are', 'its', 'their', 'they', 'them', 'have', 'has', 'can', 'see', 'into', 'from', 'when', 'what', 'who', 'one', 'out', 'off', 'all', 'any', 'more', 'than', 'then', 'not', 'but', 'get', 'got', 'how', 'per', 'each', 'also', 'mode']);
const stem = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
export const contentWords = t => new Set((String(t).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter(w => !STOP.has(w)).map(stem));
/** How much of the notInV1 item's content words the text repeats: {n, share}. */
export function overlap(item, text) {
  const a = contentWords(item), b = contentWords(text);
  let n = 0; for (const w of a) if (b.has(w)) n++;
  return { n, share: a.size ? n / a.size : 0 };
}
/** A promise is mostly a notInV1 item when it repeats at least two of its words and 60% of them ("more maps" alone never drops a hook about the map). */
export const isMostly = (item, text) => { const o = overlap(item, text); return o.n >= 2 && o.share >= 0.6; };

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sentence = s => { const t = clean(s); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };
const FRIENDS = /\bfriends?\b[^.]*\b(see|visible|seen|show)|\bsee each other\b|\bsee (your|my) friends\b/i;

/**
 * The promise list. `spec` is the locked game spec; `config` is config/game.json (what the game ships: its HUD controls,
 * hook and mechanics win over the spec's, because that is what the player sees).
 */
export function derivePromises({ spec = {}, config = {} } = {}) {
  const out = [], excluded = [];
  const notInV1 = (spec.notInV1 ?? []).map(clean).filter(Boolean);
  const add = p => {
    const hit = notInV1.find(n => isMostly(n, p.text));
    if (hit) { excluded.push({ id: p.id, text: p.text, because: `not in v1: ${hit}` }); return; }
    if (out.some(q => q.id === p.id)) { let i = 2; while (out.some(q => q.id === `${p.id}-${i}`)) i++; p = { ...p, id: `${p.id}-${i}` }; }
    out.push(p);
  };

  // 1. every control the HUD lists (config wins: the agent may have changed the words)
  const controls = { ...(spec.controls ?? {}), ...(config.controls ?? {}) };
  const order = Object.keys(CONTROL_KEYS), rank = a => (order.includes(a) ? order.indexOf(a) : order.length);
  for (const [action, raw] of Object.entries(controls).sort((x, y) => rank(x[0]) - rank(y[0]))) {
    const desc = clean(raw);
    if (!desc) continue;
    const k = CONTROL_KEYS[action];
    if (!k) { excluded.push({ id: `control.${action}`, text: desc, because: 'the HUD does not show this action (only primary, secondary, interact and jump)' }); continue; }
    add({ id: `control.${action}`, kind: 'control', action, keys: k.keys, key: k.key, hud: `${k.keys}: ${desc}`,
      text: `Pressing ${k.keys} does what the HUD says ("${desc}"), and I can see it happen on my own screen.`,
      source: `config/game.json controls.${action}`, proofs: ['verify:13', 'play'], core: action !== 'jump' });
  }

  // 2. the core loop (rules summary) and the scoring a new player should see in the first minute
  const rules = { ...(spec.rules ?? {}), ...(config.rules ?? {}) };
  if (clean(rules.summary)) add({ id: 'loop', kind: 'loop', text: `In my first minute I can play the core loop: ${sentence(rules.summary)}`, source: 'rules.summary', proofs: ['verify:15', 'play'], core: true });
  if (clean(rules.scoring)) add({ id: 'score', kind: 'score', text: `My score changes on screen the way the rules say: ${sentence(rules.scoring)}`, source: 'rules.scoring', proofs: ['verify:12', 'play'], core: true });

  // 3. each mechanic's "as" (what it is in this game)
  const mechanics = Array.isArray(config.mechanics) && config.mechanics.length ? config.mechanics : (spec.mechanics ?? []);
  mechanics.forEach((m, i) => {
    const as = clean(m?.as);
    if (!m?.id || !as) return;
    add({ id: `mechanic.${m.id}`, kind: 'mechanic', mechanic: m.id, text: `I can see this working when I play: ${sentence(as)}`, source: `mechanics[${i}].as (${m.id})`, proofs: ['play'], core: false });
  });

  // 4. the hook on the title card
  const hook = clean(config.text?.hook ?? config.hook ?? spec.hook);
  if (hook) add({ id: 'hook', kind: 'hook', text: `What the title card says happens in a round: "${hook}"`, source: config.text?.hook ? 'config/game.json text.hook' : config.hook ? 'config/game.json hook' : 'spec.hook', proofs: ['play'], core: false });

  // 5. the creator's accept items
  (spec.accept ?? []).forEach((a, i) => {
    const text = clean(a); if (!text) return;
    add({ id: `accept.${i + 1}`, kind: 'accept', text: sentence(text.charAt(0).toUpperCase() + text.slice(1)), source: `spec.accept[${i}]`, proofs: FRIENDS.test(text) ? ['verify:5'] : ['play'], core: false });
  });

  // 6. the kit's standing promises (the winBy words ride on the round promise)
  for (const k of KIT_PROMISES) {
    const winBy = clean(config.round?.winBy ?? spec.round?.winBy);
    const text = k.id === 'kit.round' && winBy ? `A round ends on a results screen that says who won (${winBy}), and I can play again.` : k.text;
    add({ id: k.id, kind: 'kit', text, source: `kit: ${k.check}`, proofs: [...k.proofs], core: false });
  }
  // 7. a game with enemies: every hit reads (verify check 16; creator, "Hang Up On Them": "The zombies are instant killed")
  if (mechanics.some(m => m?.id === 'waves')) add({ id: 'kit.hits', kind: 'kit', text: 'When I shoot an enemy I see each hit land: a health bar over it drops, it flashes and flinches, and it takes a few hits to go down.', source: 'kit: hits read', proofs: ['verify:16', 'play'], core: false });

  const title = clean(config.text?.title ?? config.title ?? spec.title);
  return { schema: SCHEMA, title, hook, controls: { hud: hudLine(controls), list: out.filter(p => p.kind === 'control').map(p => ({ action: p.action, keys: p.keys, key: p.key, does: controls[p.action] })) },
    promises: out, notPromised: notInV1, excluded };
}

/** The promises a play-tester is asked to prove (those with a 'play' proof). */
export const playPromises = list => (list?.promises ?? list ?? []).filter(p => p.proofs?.includes('play'));

/** Reads <game>/config/game.json and the spec (`spec` path, else <game>/spec.json) and derives the list. */
export async function promisesFor(gameDir, { spec: specFile = null } = {}) {
  const dir = resolve(gameDir);
  const read = async f => JSON.parse(await readFile(f, 'utf8'));
  const sf = specFile ? resolve(specFile) : join(dir, 'spec.json');
  const spec = existsSync(sf) ? await read(sf) : {};
  const cf = join(dir, 'config/game.json');
  const config = existsSync(cf) ? await read(cf) : {};
  if (!existsSync(sf) && !existsSync(cf)) throw new Error(`${dir} has neither spec.json nor config/game.json`);
  return derivePromises({ spec, config });
}

/**
 * Settle each promise from its proofs: a verify check that ran (pass/fail; a check the verdict lacks is skipped) and the
 * play-tester's answer ({id, pass: true | false | null}). → [{...promise, status: 'proven' | 'failed' | 'untested', by: [...]}]
 * A promise fails when any proof failed, is proven when at least one ran and none failed, and is untested otherwise.
 */
export function settle(promises, { verifyChecks = [], play = [] } = {}) {
  const checks = new Map(verifyChecks.map(c => [String(c.id ?? c.n), c]));
  const answers = new Map(play.map(a => [a.id, a]));
  return promises.map(p => {
    const by = [];
    for (const proof of p.proofs ?? []) {
      if (proof.startsWith('verify:')) {
        const c = checks.get(proof.slice(7));
        if (!c || c.skipped || c.ok === null) continue;
        by.push({ proof, pass: !!c.ok });
      } else if (proof === 'play') {
        const a = answers.get(p.id);
        if (a && typeof a.pass === 'boolean') by.push({ proof, pass: a.pass, note: a.note ?? null, evidence: a.evidence ?? [] });
      }
    }
    const status = by.some(b => !b.pass) ? 'failed' : by.length ? 'proven' : 'untested';
    return { ...p, status, by };
  });
}
