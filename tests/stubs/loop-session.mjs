// A stand-in for the person's agent session that runs the REAL build loop tools (mcp/tools/loop.mjs) with no model:
// it collects the studio page's requests through the real bridge routes (tests/stubs/session-driver.mjs), and answers
// the pitch round with written concepts and the spec round with a written spec. Only verify's browser run is stood in
// (a verdict it is told to write), as in tests/loop-tools.test.mjs. Used by tests/studio-layout-demo.mjs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeVerdict } from '../../kits/research/gf-three/loop/index.mjs';
import { EXAMPLES } from '../../lib/paths.mjs';
import * as loop from '../../mcp/tools/loop.mjs';
import { sessionDriver } from './session-driver.mjs';

const parse = r => (r?.content ? JSON.parse(r.content[0].text) : r);
const tools = Object.fromEntries(loop.tools.map(t => [t.name, t]));
const toolCtx = { log: () => {}, progress: () => {}, runCli: async () => ({ code: 0, stdout: '', stderr: '' }) };
export const call = async (name, args) => parse(await tools[name].handler(args, toolCtx));

/** Three concepts for a pillow-fight idea, each with a complete spec (pitch.schema.json and the pitch step's rules). */
export async function pillowPitch() {
  const pillow = JSON.parse(await readFile(new URL('../fixtures/pillow-brawl.spec.json', import.meta.url), 'utf8').catch(async () => readFile(path.join(EXAMPLES, 'soak-squad', 'spec.json'), 'utf8')));
  const spec = { ...pillow, loop: 'round' };
  const card = (id, title, hook, howItPlays, extra = {}) => ({ id, title, hook, howItPlays, players: '2–4 friends; bots fill empty seats', whyFunny: 'Everyone gets bopped and nobody gets hurt.', similar: [], v1: { has: ['one backyard', 'two pillows to swing', 'feather crates that heal'], notYet: ['pillow forts'] }, conceptPrompt: 'a sunny backyard with a fence, a bench and a sandpit', spec: { ...spec, title, hook, ...extra } });
  return {
    pitchVersion: 0,
    reply: 'Three takes on a backyard pillow fight. Pick one and I will build it.',
    cards: [
      card('a', 'Pillow Brawl', 'Bop your friends, grab feathers, most bops wins.', 'Everyone swings at once for ninety seconds. A bop knocks a friend over for a moment; feather crates patch you up. Most bops when the clock runs out wins.'),
      card('b', 'Feather Frenzy', 'Bop friends to shake feathers loose, then grab them.', 'Every bop knocks feathers out of your friend. Grab them before anyone else does; the most feathers at the end wins.'),
      card('c', 'Last Pillow Standing', 'Three bops and you are out; the last one up wins.', 'Short rounds: each player can take three bops. Get bopped three times and you sit on the bench. The last one standing wins the round.'),
    ],
    questions: [],
    research: { bank: [], web: [], notes: 'stand-in pitch for the studio demo' },
    policy: { ok: true },
    play: { loop: { wants: 'round', why: 'everyone plays at once until the clock ends' }, together: { how: 'versus', from: 'a pillow fight in a backyard with my friends' }, body: { what: 'character' },
      needs: [{ feature: 'swinging a pillow at friends', support: 'supported', by: ['melee'], how: 'the melee part, with a pillow as the weapon', core: true }, { feature: 'feather crates that heal', support: 'supported', by: ['pickup'], how: 'the pickup part with a heal effect', core: false }] },
  };
}

/**
 * Start the stand-in on a running dev server. onStep(what) is told each thing it does. → { session, idea(), choose(), build(), close() }
 * The caller paces it (a recording wants the page to show each step).
 */
export async function loopSession(base, { cwd, onStep = () => {} } = {}) {
  const s = await sessionDriver(base, { id: 'stand-in-1', cwd });
  await s.start();
  await s.prompt('hi');
  const w = await s.wait();
  const next = async (ms = 20000) => {
    const t = Date.now();
    for (;;) {
      const r = await s.collect();
      const list = r.body?.requests ?? r.body ?? [];
      if (Array.isArray(list) && list.length) return list;
      if (Date.now() - t > ms) throw new Error('no request from the page');
      await new Promise(res => setTimeout(res, 300));
    }
  };
  const folderOf = text => text.match(/games\/[A-Za-z0-9._-]+/)?.[0];
  let game = null;
  return {
    session: s,
    /** The idea from the start page: the pitch round, answered with three concepts. */
    async idea() {
      const [r] = await next();
      game = folderOf(r.text);
      const idea = r.text.split('\n\n---\n')[0];
      onStep(`request ${r.id}: pitch ${game}`);
      await s.tool('mcp__gamesfun__gamesfun_step_pitch', { game, idea });
      await call('gamesfun_step_pitch', { game, idea });
      await s.tool('mcp__gamesfun__gamesfun_step_spec', { game });
      const out = await call('gamesfun_step_spec', { game, pitch: await pillowPitch() });
      if (out.valid !== true) throw new Error(`the stand-in pitch was refused: ${JSON.stringify(out.problems ?? out.round ?? out).slice(0, 800)}`);
      await s.done(r.id, 'Here are three takes. Pick the one you like and I will build it.');
      onStep('pitched');
      return game;
    },
    /** The person's pick: the refine round, the locked spec and create. */
    async choose() {
      const [r] = await next(60000);
      const words = r.text.split('\n\n---\n')[0];
      const pick = r.text.match(/card "([a-z0-9-]+)"/)?.[1] ?? 'a';
      onStep(`request ${r.id}: chose ${pick}`);
      await s.tool('mcp__gamesfun__gamesfun_step_pitch', { game, idea: words });
      await call('gamesfun_step_pitch', { game, idea: words });
      const card = (await pillowPitch()).cards.find(c => c.id === pick);
      await s.tool('mcp__gamesfun__gamesfun_step_spec', { game });
      const locked = await call('gamesfun_step_spec', { game, spec: card.spec });
      if (locked.outcome !== 'locked') throw new Error(`the spec was not locked: ${JSON.stringify(locked).slice(0, 800)}`);
      await s.tool('mcp__gamesfun__gamesfun_step_create', { game });
      const made = await call('gamesfun_step_create', { game });
      if (!made.game) throw new Error(`create failed: ${JSON.stringify(made).slice(0, 400)}`);
      await s.done(r.id, `Made ${card.title}. It is in the preview now; I am writing its rules next.`);
      onStep('created');
      return made;
    },
    /** The build round ends, and verify runs (its browser run stood in by a verdict that passes). */
    async build() {
      loop.seams.tools = {
        ownVerify: async () => ({ ok: true, why: 'stand-in' }),
        verify: async (g, out) => {
          const v = { pass: true, quick: false, checks: [{ n: 3, name: 'boots to play', ok: true }, { n: 5, name: 'two players see each other', ok: true }, { n: 6, name: 'a round reaches results and replays', ok: true }, { n: 13, name: 'every listed control does something you can see', ok: true }] };
          await mkdir(out, { recursive: true });
          await writeFile(path.join(out, 'verdict.json'), JSON.stringify(v));
          return { ...normalizeVerdict(v), outDir: out };
        },
      };
      await s.tool('mcp__gamesfun__gamesfun_step_fix', { game });
      await call('gamesfun_step_fix', { game, summary: 'Swing to bop; crates heal; most bops wins.', controls: 'WASD move, mouse aim, click swing, E grab' });
      await s.tool('mcp__gamesfun__gamesfun_step_verify', { game });
      const v = await call('gamesfun_step_verify', { game });
      onStep(`verify: ${v.status ?? ''} ${v.step ?? ''}`);
      await s.stop('Verify passed. The play-test is next.');
      return v;
    },
    close() { loop.seams.tools = null; w.close(); s.closeAll(); },
  };
}
