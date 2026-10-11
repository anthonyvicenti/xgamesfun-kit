// gf-three verify for a forge game (CONTRACT §8 forge; research/rust-engine/PLAN.md §3): tools/verify.mjs hands a game
// whose engine is forge to verifyForge. Every check that applies runs through the observation interface the forge boot
// gives window.__game (the same names: snapshot, coverage, slots, sight, controls, menu, hud, looks, camera, screen,
// and forge's own: bodies, enemies, hits, wave, forge.*), in WebGPU Chrome (the forge engine draws only with WebGPU). A
// check that cannot apply yet is recorded as "not yet for forge" with its reason (ok: null, `notYet`), printed so, and
// never counted as passed. The pass rule is passesForge (tools/lib/verdict.mjs: REQUIRED_FORGE, NOT_YET_FORGE).
//
// HOW THIS FILE IS BUILT (track S owns its structure; tracks R, F and A each add their own checks):
//   - one async function per check, `checkN(env)`, that calls env.add(n, name, ok, detail) (or env.notYet);
//   - the check is listed once in its stage below: STATIC (no browser), SOLO (the shared WebGPU browser, in order,
//     after the solo round), AFTER (no browser, after the solo session: what the recordings say), or its own browser
//     (5, 25 and 6's two-player half run beside the solo session in their own Chromes, like verify.mjs);
//   - a new check: write `async function checkN(env)`, add it to its stage, add N to REQUIRED_FORGE (and take it out of
//     NOT_YET_FORGE) in tools/lib/verdict.mjs, and a line to CONTRACT §8 forge item 9. Nothing else in the file changes.
//
//   1  manifests                      2  kit copies (gf/three, gf/forge with its pinned wasm, gf/mp, audio)
//   3  boots to play and walks         4  slot coverage 100% (play and every preview subject; the core's instances)
//   5  the two-player live gate, the loadout leg and forge's sight leg (each sees the other's body; prediction feel)
//   6  a round reaches results and replays, alone and with two players (the gate's results, play again, end round)
//   7  audio gate v4                   8  swap proof (the forge way: a model slot and the texture slot, on screen)
//   13 controls work: forge's own (tools/lib/forge-controls-check.mjs: each listed control on a quiet staged page must
//      make the game's state answer and the screen show it)     14 looks honoured · 18 sounds play (static)
//   15 the loop is alive (the goal's share of the first look, from the core's slot-ID pass)
//   20 the menu · 21 the HUD, and forge's own leg (tools/lib/forge-hud-check.mjs: a player with hit points sees its
//      health, and it follows the core's) · 22 the wallet · 23 looks like the references · 24 plays inside a post · 25 friends
//   31 screens
//   32 no WebGPU: the kit's "open in your browser" screen, never a blank canvas (forge's own)
//   33 a lost GPU device is recovered: the scene is drawn again on a new device (forge's own)
//   9  contact sheet and perf · 19 bodies hold their shape: track R's (research/gf-forge/lookdev/forge-checks.mjs): the
//      forge capture's game mode, and the model judge with forge's own poses and GPU skinning
//   16 hits read and 10 fair play's feel half: track F's (tools/lib/forge-feel-check.mjs: a game with weapons, the staged
//      target ?gf-demo=feel.hit; control goes with the evade, a knock-down, death, and keys that do nothing)
//   Seen to fail on a forge game, each for its reason (research/gf-three/regressions/forge-*; README there, "Forge
//   examples"): 4, 5, 10, 11, 12, 13, 16, 17, 18, 19, 21. Not yet seen to fail on forge: 1, 3, 6, 7, 8, 9, 14, 15, 20,
//   22, 23, 24, 25, 31, 32, 33 (2 fails an edited copy in tests/s-forge.test.mjs, with no browser).
//   11 set dressing and 17 the world is complete: track A's forge world lint (gf/forge/arena.js lintWorld)
//   12 something happens: a round with forge bots (?bots=3, forge-ai's bot players) in which something scores (track A)
//   not yet for forge: 34 watch then play (no Go live in a forge game yet), and the mechanic modules
//   (NOT_YET_FORGE.mechanics is why none of them runs)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, GF3, SCENIC, launchForGame, importPart, relPosix } from './lib/paths.mjs';
import { checkKitCopies } from './lib/kit-check.mjs';
import { validateGame } from '../../asset-manifest/validate.mjs';
import { readManifest, validateMultiplayer, startParty } from '../../multiplayer/party/lib.mjs';
import { gate } from '../../multiplayer/party/gate.mjs';
import { launchChrome, GPU_TROUBLE } from '../../foundations/qa/browser.mjs';
import { installAudioTap, resetAudioTap, audioReport } from '../../audio/qa-gate-v4.mjs';
import { checkForgeControls } from './lib/forge-controls-check.mjs';
import { checkMenu, checkHud, checkWallet } from './lib/menu-check.mjs';
import { checkEmbed } from './lib/embed-check.mjs';
import { checkScreens } from './lib/screens-check.mjs';
import { checkLoadouts } from './lib/loadout-check.mjs';
import { checkFriends } from './lib/friends-check.mjs';
import { checkForgeSight } from './lib/forge-sight-check.mjs';
import { RECORDER, recordingOf, firstLook, judgeAlive } from './lib/alive-check.mjs';
import { passesForge, requiredFor, runsHere, NOT_YET_FORGE } from './lib/verdict.mjs';
import { checkForgeHits, checkForgeFair } from './lib/forge-feel-check.mjs';
import { checkForgeHealth } from './lib/forge-hud-check.mjs';
import { forgeWorldProblems, listedCover } from './lib/forge-world-check.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(150); } }
const snap = p => p.evaluate(() => window.__game?.snapshot?.() ?? null);

// ---- the stages: each check once, in the order it runs (see "HOW THIS FILE IS BUILT") ----
const STATIC = [check1, check2, check14, check18, check11, check17, check19];
const SOLO = [soloRound, check4, check8, check13, check16, check10, check20, check21, check12, check22, check24, check31, check33];
const AFTER = [check15, check9, check23];
/** The gate's random-input checks that need a first-person view to turn: in the friends page's frame the pointer-locked
 *  mouse cannot turn one (chrome-headless-shell reports its moves as 0), so forge's sight leg stands in for them. */
const GATE_LOOKS = ['a-friend-is-on-screen', 'both-see-each-other-on-screen'];

export async function verifyForge(dir, { rec, outDir, add, log, t0, lap, quick = false, only = null, release = false, statics }) {
  rec.engine = 'forge';
  rec.notYet = [];
  const checks = rec.checks;
  // a build's verify leaves out the kit's own checks (8 and 31 here: verdict.mjs RELEASE_ONLY); a release run makes them
  const want = n => (only === null ? runsHere(n, { release }) : [].concat(only).includes(n));
  const env = {
    dir, rec, outDir, add, log, lap, quick, want, statics, checks,
    notYet: (n, name, why) => { if (!want(n)) return; checks.push({ n, name, ok: null, notYet: why, detail: `not yet for forge: ${why}` }); rec.notYet.push({ n, name, why }); log(`NOT YET FOR FORGE ${n} ${name} — ${why}`); },
    game: JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8')),
    world: JSON.parse(await readFile(join(dir, 'config/world.json'), 'utf8').catch(() => '{}')),
    mpm: await readManifest(dir),
    shotsForLikeness: [], recordings: [], look: null, t: Date.now(),
  };
  env.section = async (nums, fn) => { try { await fn(); } catch (e) { for (const [n, name] of nums) if (want(n) && !checks.some(c => c.n === n)) add(n, name, false, `not reached: ${e.message}`); } };
  env.lapNow = name => { lap(name, env.t); env.t = Date.now(); };

  for (const c of STATIC) await c(env);
  for (const [n, name] of [[9, 'contact sheet and perf'], [10, 'fair play'], [11, 'set dressing'], [12, 'something happens'], [16, 'hits read'], [17, 'the world is complete'], [19, 'bodies hold their shape'], [34, 'watch then play']]) if (NOT_YET_FORGE[n]) env.notYet(n, name, NOT_YET_FORGE[n]);

  // 5, 25 and 6's two-player half: their own servers and browsers, beside the solo session
  const live = env.mpm.manifest?.mode === 'live';
  const duo = live && [5, 6, 25].some(want) ? runDuo(env) : null;

  // the solo session: WebGPU Chrome, the game's own server
  const needsBrowser = [3, 4, 6, 7, 8, 10, 12, 13, 15, 16, 20, 21, 22, 23, 24, 31, 33].some(want);
  if (needsBrowser || want(32)) env.srv = await startParty({ dir, port: 0 });
  {
    env.shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 80 }).catch(() => {}); return f; };
    env.newPage = async (label, { overrides = null, audio = false, record = false, viewport = { width: 1280, height: 720 }, b = env.browser } = {}) => {
      const ctx = await b.newContext({ viewport });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
      if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
      if (audio) await installAudioTap(page);
      if (record) {
        await page.addInitScript(RECORDER);
        const close = ctx.close.bind(ctx);
        ctx.close = async (...a) => { const r = await recordingOf(page); if (r?.samples?.length) env.recordings.push({ label, samples: r.samples }); return close(...a); };
      }
      return { ctx, page, errors };
    };
  }
  if (needsBrowser) {
    const launched = await launchForGame(launchChrome, dir, { engine: 'forge' });
    env.browser = launched.browser;
    rec.chrome = env.browser.version(); rec.renderer = launched.gpu;
    try { for (const c of SOLO) await c(env); }
    finally { await env.browser.close().catch(() => {}); }
  }
  if (want(32)) await check32(env);
  if (env.srv) await env.srv.close().catch(() => {});
  for (const c of AFTER) await c(env);

  // the two-player results
  if (duo) { const d = await duo; check5(env, d); check6(env, d); check25(env, d); }
  else if (!live) for (const [n, name] of [[5, 'two-player live gate'], [25, 'playing with friends']]) if (want(n)) add(n, name, false, `multiplayer.json mode is ${env.mpm.manifest?.mode ?? 'missing'}, not live`);
  if (want(6) && !checks.some(c => c.n === 6)) check6(env, null);

  checks.sort((a, b) => (typeof a.n === 'number' ? a.n : 99) - (typeof b.n === 'number' ? b.n : 99));
  rec.required = requiredFor('forge', { release });
  rec.pass = only === null ? passesForge(checks, rec.required) : checks.every(c => c.ok !== false);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

// =====================================================================================================================
// static checks

async function check1({ want, dir, mpm, add, rec }) {
  if (!want(1)) return;
  const v = await validateGame(dir);
  const mv = mpm.error ? { ok: false, problems: [`multiplayer.json is ${mpm.error}`] } : validateMultiplayer(mpm.manifest);
  const live = mpm.manifest?.mode === 'live';
  add(1, 'manifests', v.ok && mv.ok && live, [v.ok ? `assets.json valid (${v.stats?.slots ?? '?'} slots)` : `assets.json: ${v.errors.slice(0, 4).join('; ')}`, mv.ok ? `multiplayer.json valid, mode ${mpm.manifest?.mode}` : `multiplayer.json: ${mv.problems.join('; ')}`].join(' · '));
  if (v.warnings?.length) rec.notes.push(`assets.json warnings: ${v.warnings.slice(0, 5).join('; ')}`);
}
async function check2({ want, dir, add, rec }) {
  if (!want(2)) return;
  const kc = await checkKitCopies(dir);
  // unedited is what check 2 holds: each copy is the one create made (the hashes in gf/three/kit.js, the wasm the build
  // it names). A game on an older kit passes, and the detail says how far behind it is, so "passes 2" is never read
  // as "is on today's kit" (tools/upgrade.mjs --plan says the same and upgrade brings it forward)
  const behind = kc.notes.filter(n => /have changed in research\/|not the current|the current kit is/.test(n));
  add(2, 'kit copies unedited', kc.ok, kc.ok
    ? `gf/three (the shared system without three.js), gf/forge (its pinned wasm), gf/mp, audio and gf/gf-assets.js are the copies create made, unedited; no vendor/${behind.length ? `. Behind today's kit: ${behind.join('; ')}` : '; all are today\'s kit'}`
    : kc.problems.slice(0, 6).join('; '));
  rec.notes.push(...kc.notes);
}
async function check14({ want, statics }) { if (want(14)) await statics.looks(); }
async function check18({ want, statics }) { if (want(18)) await statics.check18(); }

/**
 * 11 and 17 on forge (track A): the forge world lint (gf/forge/arena.js lintWorld, the game's own copy) over
 * config/world.json: check 11's rules (overlaps, floating pieces, spawns, emerge mounds, a crowded middle, open floor,
 * loose decor) and check 17's (size, a closed and visible edge, the view past the walls, emerge points for enemies,
 * everything reachable, cover, lanes for ranged enemies, fire lights). The lint runs once; each check reads its rules.
 */
async function forgeWorldLint(env) {
  if (env.worldLint) return env.worldLint;
  const { dir, game, world, rec } = env;
  try {
    const { lintWorld } = await import(pathToFileURL(join(dir, 'gf/forge/arena.js')).href);
    const enemies = game.forge?.enemies ?? [];
    const r = lintWorld(world, { players: game.players?.max ?? 4, enemies: enemies.length > 0 && (game.forge?.waves ?? []).length > 0, casters: enemies.some(e => e.archetype === 'caster' || (e.ranged?.range ?? 0) > 0) });
    rec.forgeWorld = { kind: r.kind, errors: r.errors, warnings: r.warnings, stats: r.stats, problems: r.problems.slice(0, 20) };
    return (env.worldLint = { r });
  } catch (e) { return (env.worldLint = { error: e.message }); }
}
async function worldLintCheck(env, n, name) {
  const { want, add, rec } = env;
  if (!want(n)) return;
  const { r, error } = await forgeWorldLint(env);
  if (error) { add(n, name, false, `the forge world lint (gf/forge/arena.js) did not load: ${error}`); return; }
  // 17 also holds the world's own lists to the world (track S2, tools/lib/forge-world-check.mjs): the kit's lint counts
  // cover from a list the generator wrote, and passed an arena whose cover had all been taken out
  const own = n === 17 ? forgeWorldProblems(env.world) : [];
  if (n === 17) rec.forgeWorld.cover = listedCover(env.world);
  const st = r.stats, mine = [...r.problems.filter(p => p.check === n), ...own], errs = mine.filter(p => p.severity === 'error'), warns = mine.filter(p => p.severity === 'warning');
  if (warns.length) rec.notes.push(`check ${n} on forge, warnings: ${warns.slice(0, 4).map(p => `${p.rule}: ${p.message}`).join(' | ')}`);
  const clean = n === 11 ? `clean (${r.kind}): ${st.pieces} pieces, ${st.colliders} colliders, ${st.spawns} spawns, open floor ${(st.openFloor * 100).toFixed(0)}%, middle ${(st.centreSolid * 100).toFixed(0)}% solid${warns.length ? `, ${warns.length} warnings` : ''}`
    : `complete (${r.kind}): the edge stops a player at ${(st.edgeStopped * 100).toFixed(0)}% of it, ${st.lights} fire lights, ${st.mounds} emerge points, ${st.cover} cover, ${st.lanes} lanes${warns.length ? `, ${warns.length} warnings` : ''}`;
  add(n, name, errs.length === 0, errs.length ? `${errs.length} errors (fix config/world.json; gf/forge/arena.js lintWorld lists them all): ${errs.slice(0, 5).map(p => `${p.rule}: ${p.message}`).join(' | ')}` : clean);
}
async function check11(env) { await worldLintCheck(env, 11, 'set dressing'); }
async function check17(env) { await worldLintCheck(env, 17, 'the world is complete'); }

// =====================================================================================================================
// the solo session (one WebGPU Chrome)

/** 3, 6 (alone), 7, and what 4, 15 and 23 read later: the solo round on real keys and mouse. */
async function soloRound(env) {
  const { want, add, rec, newPage, srv, shot, game, world, outDir } = env;
  await env.section([[3, 'boots to play with no console errors'], [4, 'slot coverage 100%'], [6, 'a round reaches results and replays'], [7, 'audio gate v4']], async () => {
    if (![3, 4, 6, 7, 15, 23].some(want)) return;
    const roundSeconds = 25;
    const S = await newPage('solo', { audio: true, record: true, overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: roundSeconds }] } });
    const p = S.page;
    await p.goto(`${srv.url}?seed=7`, { waitUntil: 'load' });
    await until(async () => (await snap(p))?.phase === 'lobby', 90000, 'the lobby');
    await shot(p, 'lobby');
    const play = await p.locator('#gf-play').boundingBox();
    await p.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
    await until(async () => (await snap(p))?.phase === 'playing', 15000, 'the round to start');
    env.look = await firstLook(p, game, world);
    const fl = await shot(p, 'first-look'); env.shotsForLikeness.push(join(outDir, fl));
    await resetAudioTap(p);
    await p.mouse.click(640, 400);
    let moved = 0;
    const start = (await snap(p)).players.find(x => x.local);
    const far = async () => { const m = (await snap(p))?.players.find(x => x.local); if (m) moved = Math.max(moved, Math.hypot(m.x - start.x, m.z - start.z)); };
    await p.keyboard.down('KeyW'); for (let i = 0; i < 7; i++) { await sleep(200); await far(); } await p.keyboard.up('KeyW');
    await p.keyboard.press('Space'); await sleep(400);
    await p.keyboard.down('KeyD'); for (let i = 0; i < 4; i++) { await sleep(180); await far(); } await p.keyboard.up('KeyD');
    const pl = await shot(p, 'playing'); env.shotsForLikeness.push(join(outDir, pl));
    const cov = [];
    for (let i = 0; i < 3; i++) { cov.push(await p.evaluate(() => window.__game.coverage())); await sleep(1500); }
    await shot(p, 'mid-round');
    await until(async () => (await snap(p))?.phase === 'results', (roundSeconds + 20) * 1000, 'the results');
    const sr = await snap(p);
    await shot(p, 'results');
    const again = await p.locator('#gf-again').boundingBox().catch(() => null);
    if (again) await p.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
    const replayed = await until(async () => { const s = await snap(p); return s && s.round === 2 && ['countdown', 'playing'].includes(s.phase) ? s : null; }, 10000, 'round 2').catch(() => null);
    await sleep(1500);
    await shot(p, 'round-2');
    const audio = await audioReport(p);
    rec.solo = { moved: +moved.toFixed(2), results: sr.results, winners: sr.winners, forge: sr.forge, coverage: cov.map(c => ({ meshes: c.meshes, tagged: c.tagged, untagged: c.untagged.length, unknownSlots: c.unknownSlots })), audio: { ok: audio.ok, heard: audio.heard, problems: audio.problems, mix: audio.mix } };
    env.solo = { ok: sr.phase === 'results' && (sr.results ?? []).length > 0 && !!replayed, results: sr.results ?? [] };
    if (want(3)) add(3, 'boots to play with no console errors', S.errors.length === 0 && moved > 0.5, `${S.errors.length ? `console errors: ${[...new Set(S.errors)].slice(0, 3).join(' | ')}` : 'no console errors'}; the player walked ${moved.toFixed(2)} m on real keys (the Rust core's walk); ${sr.forge?.info ?? ''}`);
    if (want(7)) add(7, 'audio gate v4', !!(audio.ok && audio.heard), `${audio.heard ? 'heard' : 'nothing heard'}${audio.mix ? `, ${audio.mix.integratedLufs?.toFixed?.(1) ?? '?'} LUFS integrated, peak ${audio.mix.truePeakDb?.toFixed?.(1) ?? '?'} dBTP` : ''}; ${audio.problems.length ? audio.problems.join('; ') : 'within the targets'}`);
    rec.coverageInPlay = cov;
    await S.ctx.close();
    env.lapNow('solo round');
  });
}

/** 4: coverage in play (the solo round's) and in every preview subject. */
async function check4(env) {
  const { want, add, rec, dir, newPage, srv, shot } = env;
  await env.section([[4, 'slot coverage 100%']], async () => {
    if (!want(4)) return;
    const assets = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
    const subj = [];
    for (const q of (assets.showcase ?? []).map(x => x.query)) {
      const T = await newPage(`show ${q}`);
      await T.page.goto(srv.url + q, { waitUntil: 'load' });
      await until(() => T.page.evaluate(() => window.__game?.ready === true), 60000, q).catch(() => {});
      await sleep(500);
      subj.push({ q, c: await T.page.evaluate(() => window.__game?.coverage?.() ?? null).catch(() => null), errors: T.errors });
      await shot(T.page, `show-${q.replace('?gf-show=', '')}`);
      await T.ctx.close();
    }
    const cov = rec.coverageInPlay ?? [];
    const all = [...cov, ...subj.map(x => x.c)];
    const untagged = all.flatMap(c => c?.untagged ?? [{ name: 'no coverage report' }]);
    const unknown = [...new Set(all.flatMap(c => c?.unknownSlots ?? []))];
    const empty = all.filter(c => c && !c.meshes).length;
    add(4, 'slot coverage 100%', cov.length > 0 && untagged.length === 0 && unknown.length === 0 && !empty && subj.every(x => !x.errors.length),
      `${cov.map(c => `${c.tagged}/${c.meshes}`).join(', ')} of the core's drawn instances tagged in play; ${subj.map(x => `${x.q.replace('?gf-show=', '')} ${x.c ? `${x.c.tagged}/${x.c.meshes}` : 'no report'}`).join(', ')}${untagged.length ? `; untagged: ${untagged.slice(0, 4).map(u => u.path ?? u.name).join(', ')}` : ''}${unknown.length ? `; slots assets.json lacks: ${unknown.join(', ')}` : ''}${empty ? `; ${empty} report(s) drew nothing` : ''}`);
    rec.subjects = subj.map(x => ({ q: x.q, meshes: x.c?.meshes, tagged: x.c?.tagged }));
    env.lapNow('coverage subjects');
  });
}

/** 8: swap proof, the forge way: a model slot (the game's own prop) and the texture slot, replaced as Studio does. */
async function check8(env) {
  const { want, add, rec, dir, newPage, srv, shot, browser } = env;
  await env.section([[8, 'swap proof']], async () => {
    if (!want(8)) return;
    const assets = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
    const model = assets.slots.find(s => s.type === 'model' && s.id.startsWith('prop.') && (assets.showcase ?? []).some(x => x.query === `?gf-show=${s.id}`));
    const tex = assets.slots.find(s => s.type === 'image' && s.id.startsWith('world.'));
    const pick = async (cur, list) => { const curBytes = await readFile(join(dir, cur)); for (const f of list) if (existsSync(f) && !(await readFile(f)).equals(curBytes)) return f; return null; };
    const modelFile = model && await pick(model.source.file, ['dungeon-barrel', 'dungeon-crates', 'dungeon-chest-gold'].map(n => join(SCENIC, `library/props/${n}.glb`)));
    const texFile = tex && await pick(tex.source.file, ['paving-slabs', 'arena-checker', 'concrete-slabs'].map(n => join(GF3, `library/textures/${n}.png`)));
    const view = async (overrides, q, slot) => {
      const T = await newPage(`swap ${slot}`, { overrides });
      await T.page.goto(`${srv.url}${q}`, { waitUntil: 'load' });
      await until(() => T.page.evaluate(() => window.__game?.ready === true), 60000, q).catch(() => {});
      await sleep(900);
      const st = await T.page.evaluate(id => window.__game?.slots?.()[id] ?? null, slot).catch(() => null);
      const img = await T.page.screenshot({ type: 'png' });
      return { T, st, img };
    };
    const out = [];
    for (const [slot, file, q, kind] of [[model, modelFile, model && `?gf-show=${model.id}`, 'model'], [tex, texFile, '?gf-show=look', 'texture']]) {
      if (!slot || !file) { out.push({ slot: slot?.id ?? null, ok: false, why: `no ${kind} slot or no other file to swap in` }); continue; }
      const mime = kind === 'model' ? 'model/gltf-binary' : 'image/png';
      const data = `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
      const [a, b] = await Promise.all([view(null, q, slot.id), view({ files: { [slot.source.file]: data } }, q, slot.id)]);
      const diff = await pixelDiff(browser, a.img, b.img);
      const f1 = await shot(a.T.page, `swap-${slot.id}-before`), f2 = await shot(b.T.page, `swap-${slot.id}-after`);
      const ok = !!(a.st?.onScreen && b.st?.onScreen) && (kind !== 'model' || a.st.triangles !== b.st.triangles) && diff > 0.01 && b.T.errors.length === 0;
      out.push({ slot: slot.id, kind, file: relPosix(REPO, file), ok, before: a.st, after: b.st, pixelsChanged: +diff.toFixed(3), errors: b.T.errors.slice(0, 2), shots: [f1, f2] });
      await a.T.ctx.close(); await b.T.ctx.close();
    }
    rec.swaps = out;
    add(8, 'swap proof', out.length === 2 && out.every(s => s.ok), out.map(s => s.ok ? `${s.slot}: ${s.kind === 'model' ? `${s.before.triangles} → ${s.after.triangles} triangles, ` : ''}on screen, ${(s.pixelsChanged * 100).toFixed(1)}% of pixels changed` : `${s.slot}: ${s.why ?? `not shown (${JSON.stringify(s.after)}, ${((s.pixelsChanged ?? 0) * 100).toFixed(1)}% changed${s.errors?.length ? `; ${s.errors[0]}` : ''})`}`).join(' · '));
    env.lapNow('swaps');
  });
}

/** 13 (track S2, tools/lib/forge-controls-check.mjs): every control the HUD lists answers and shows, on a quiet staged
 *  page (the shared check passed a dead control on forge: in a wave fight "some state changed" is always true). */
async function check13(env) {
  const { want, add, rec, newPage, browser, srv, game, log, shot } = env;
  if (!want(13)) return;
  await env.section([[13, 'controls work']], async () => {
    const cc = await checkForgeControls({ newPage, browser, url: srv.url, game, log, shot });
    rec.controls = cc.record; if (cc.warnings.length) rec.notes.push(...cc.warnings);
    add(13, 'controls work', cc.ok, cc.detail);
    env.lapNow('controls');
  });
}
/** 16 (track F, tools/lib/forge-feel-check.mjs): hits read: the staged target, real clicks, what the screen showed. */
async function check16(env) {
  const { want, add, rec, newPage, browser, srv, game, log, shot } = env;
  if (!want(16)) return;
  await env.section([[16, 'hits read']], async () => {
    const r = await checkForgeHits({ newPage, browser, url: srv.url, game, shot, log });
    rec.hits = r.record; rec.notes.push(...r.warnings);
    add(16, 'hits read', r.ok, r.detail);
    env.lapNow('hits read');
  });
}
/** 10 (track F): fair play's feel half: the evade and death are the only ways control goes. */
async function check10(env) {
  const { want, add, rec, newPage, srv, game, log } = env;
  if (!want(10)) return;
  await env.section([[10, 'fair play']], async () => {
    const r = await checkForgeFair({ newPage, url: srv.url, game, log });
    rec.fair = r.record; rec.notes.push(...r.warnings);
    add(10, 'fair play', r.ok, r.detail);
    env.lapNow('fair play');
  });
}
// 20, 21, 22, 24, 31: the shared DOM menu, HUD, wallet, the post's frame, the screens
async function check20(env) {
  const { want, add, rec, newPage, srv, game, log, shot } = env;
  if (want(20)) await env.section([[20, 'the menu works']], async () => { const r = await checkMenu({ newPage, url: srv.url, game, log, shot }); rec.menu = r.record; rec.notes.push(...r.warnings); add(20, 'the menu works', r.ok, r.detail); });
}
// the shared checks' words are a three.js game's; on forge the bots are forge-ai's (track A), and the detail says so.
// The shared HUD check knows a game's state from its gf-three mechanics, and none runs on forge: forge's own leg
// (track S2, tools/lib/forge-hud-check.mjs) holds a player with hit points to a health display that follows the core's
async function check21(env) {
  const { want, add, rec, newPage, srv, game, log, shot } = env;
  if (want(21)) await env.section([[21, 'the HUD shows your state']], async () => {
    const r = await checkHud({ newPage, url: srv.url, game, log, shot }); rec.hud = r.record; rec.notes.push(...r.warnings);
    const h = await checkForgeHealth({ newPage, url: srv.url, game, log, shot }); rec.hudHealth = h.record; rec.notes.push(...h.warnings);
    add(21, 'the HUD shows your state', r.ok && h.ok, h.ok ? `${r.detail} (forge: the bots are forge-ai's); ${h.detail}` : r.ok ? `the HUD: ${h.detail}` : `${r.detail}; ${h.detail}`);
  });
}
/**
 * 12 on forge (track A): something happens. A solo round with 3 forge bots (forge-ai's bot players, driven through the
 * same Control and Look an INPUT writes) in which the bots act and something scores: a bot's score above 0, or any
 * score built up to 2.
 */
async function check12(env) {
  const { want, add, rec, newPage, srv, shot, log } = env;
  if (!want(12)) return;
  await env.section([[12, 'something happens']], async () => {
    const seconds = 30;
    const T = await newPage('bots', { overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: seconds }] } });
    const p = T.page;
    try {
      await p.goto(`${srv.url}?seed=7&bots=3`, { waitUntil: 'load' });
      await until(async () => (await snap(p))?.phase === 'lobby', 90000, 'the lobby');
      const play = await p.locator('#gf-play').boundingBox();
      await p.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
      await until(async () => (await snap(p))?.phase === 'playing', 15000, 'the round to start');
      const start = new Map(((await snap(p))?.players ?? []).filter(x => x.bot).map(x => [x.id, x]));
      const moved = new Map(), best = new Map();
      let last = null, shotTaken = false;
      for (const t0 = Date.now(); Date.now() - t0 < (seconds + 20) * 1000;) {
        const s = await snap(p);
        if (!s) break;
        last = s;
        for (const b of (s.players ?? []).filter(x => x.bot)) {
          const a = start.get(b.id); if (a) moved.set(b.id, Math.max(moved.get(b.id) ?? 0, Math.hypot(b.x - a.x, b.z - a.z)));
          best.set(b.id, Math.max(best.get(b.id) ?? 0, Number(b.score) || 0));
        }
        if (!shotTaken && Date.now() - t0 > 6000) { shotTaken = true; await shot(p, 'bots'); }
        if (s.phase === 'results') break;
        await sleep(700);
      }
      const rows = (last?.results ?? []).map(r => ({ name: r.name, value: Number(r.value) || 0 }));
      const bots = [...start.keys()];
      const botScore = Math.max(0, ...bots.map(id => best.get(id) ?? 0));
      const most = Math.max(0, ...rows.map(r => r.value), botScore);
      const walked = bots.filter(id => (moved.get(id) ?? 0) > 2).length;
      const ok = bots.length > 0 && walked > 0 && (botScore > 0 || most >= 2) && T.errors.length === 0;
      rec.forgeBots = { bots: bots.length, walked, scores: Object.fromEntries(bots.map(id => [id, best.get(id) ?? 0])), moved: Object.fromEntries(bots.map(id => [id, +((moved.get(id) ?? 0).toFixed(1))])), results: rows, phase: last?.phase ?? null, ai: last?.rules ?? null, errors: T.errors.slice(0, 3) };
      log(`bots: ${bots.length} bots, ${walked} walked, best bot score ${botScore}, results ${rows.map(r => `${r.name} ${r.value}`).join(', ')}`);
      add(12, 'something happens', ok, ok
        ? `a round with ${bots.length} forge bots (forge-ai, through the same Control and Look an INPUT writes): ${walked} walked more than 2 m, a bot scored ${botScore}; results ${rows.map(r => `${r.name} ${r.value}`).join(', ') || '(round still on)'}`
        : `${bots.length ? `${bots.length} bots, ${walked} walked more than 2 m, best bot score ${botScore}, best score ${most}` : 'no bots joined (?bots=3)'}${T.errors.length ? `; console: ${T.errors[0]}` : ''}. The bots act through forge-ai (gf/forge/ai.js): check rules.bot (p.bot.seek / aimAt / press) and that kills or goals score in rules.event / rules.update.`);
    } finally { await T.ctx.close().catch(() => {}); }
    env.lapNow('bots round');
  });
}
async function check22(env) {
  const { want, add, rec, newPage, srv, log, shot } = env;
  if (!want(22)) return;
  await env.section([[22, 'the wallet in the menu']], async () => {
    const r = await checkWallet({ newPage, url: srv.url, log, shot }); rec.wallet = r.record; rec.notes.push(...r.warnings);
    // alone, the player's own body is not drawn on their own screen (first person): the item's colour reaching the
    // game's loadout is what is checked here; friends see it on the body (check 5's loadout leg)
    const undrawn = r.warnings.some(w => /no drawn colour/.test(w));
    add(22, 'the wallet in the menu', r.ok, undrawn ? `${r.detail.replace(' (the player drawn in its colour)', '')}; the item's colour reached the game's loadout (first person: your own body is drawn on your friends' screens, check 5)` : r.detail);
  });
}
async function check24(env) {
  const { want, add, rec, newPage, srv, game, log, shot } = env;
  if (want(24)) await env.section([[24, 'plays inside a post']], async () => { const r = await checkEmbed({ newPage, url: srv.url, game, log, shot }); rec.embed = r.record; rec.notes.push(...r.warnings); add(24, 'plays inside a post', r.ok, r.detail); });
}
async function check31(env) {
  const { want, add, rec, browser, srv, log } = env;
  if (want(31)) await env.section([[31, 'sharp on every screen']], async () => { const r = await checkScreens({ browser, url: srv.url, log }); rec.screens = r.record; rec.notes.push(...r.warnings); add(31, 'sharp on every screen', r.ok, r.detail); });
  env.lapNow('menu, HUD, wallet, post and screens');
}

/** 33: a lost GPU device is recovered (forge's own). */
async function check33(env) {
  const { want, add, rec, newPage, srv, shot, browser } = env;
  if (!want(33)) return;
  await env.section([[33, 'a lost device is recovered']], async () => {
    const T = await newPage('device-loss');
    const p = T.page;
    await p.goto(`${srv.url}?seed=7`, { waitUntil: 'load' });
    await until(async () => (await snap(p))?.phase === 'lobby', 90000, 'the lobby');
    await p.click('#gf-play');
    await until(async () => (await snap(p))?.phase === 'playing', 15000, 'the round');
    await sleep(800);
    const before = await p.evaluate(() => window.__game.forge.state());
    const img0 = await p.screenshot({ type: 'png' });
    await p.evaluate(() => window.__game.forge.loseDevice());
    const back = await until(async () => { const s = await p.evaluate(() => window.__game.forge.state()); return s.recoveries >= 1 && !s.lost ? s : null; }, 8000, 'the device to come back').catch(() => null);
    await sleep(1000);
    const after = await p.evaluate(() => window.__game.forge.state());
    const cov = await p.evaluate(() => window.__game.coverage());
    const img1 = await p.screenshot({ type: 'png' });
    const f = await shot(p, 'after-device-loss');
    const diff = await pixelDiff(browser, img0, img1);
    const drawn = after.frames > (back?.frames ?? before.frames) + 10;
    // the browser's own words about the destroyed device are expected; anything else is a failure
    const errors = T.errors.filter(e => !/destroyed|device (was )?lost|lost device/i.test(e));
    const ok = !!back && drawn && cov.untagged.length === 0 && cov.meshes > 0 && diff < 0.5 && errors.length === 0;
    rec.deviceLoss = { before, back, after, coverage: { meshes: cov.meshes, tagged: cov.tagged }, pixelsChanged: +diff.toFixed(3), errors: T.errors.slice(0, 4), shot: f };
    add(33, 'a lost device is recovered', ok, back ? `the device was destroyed mid-round; a new one drew the scene again (${after.recoveries} recovery, ${after.frames - before.frames} frames since, ${cov.tagged}/${cov.meshes} instances tagged, ${(diff * 100).toFixed(1)}% of pixels differ from before the loss)${errors.length ? `; console: ${errors.slice(0, 2).join(' | ')}` : ''}` : 'the device did not come back within 8 s');
    await T.ctx.close();
    env.lapNow('device loss');
  });
}

/** 32: no WebGPU → the kit's own screen (a Chrome with no GPU flags finds no WebGPU adapter). */
async function check32(env) {
  const { add, rec, srv, shot, newPage } = env;
  await env.section([[32, 'no WebGPU: the kit\'s screen']], async () => {
    const plain = await launchChrome({});
    try {
      const T = await newPage('no-webgpu', { b: plain });
      const p = T.page;
      await p.goto(`${srv.url}?seed=7`, { waitUntil: 'load' });
      const s = await until(() => p.evaluate(() => (window.__game?.ready ? { phase: window.__game.phase, unsupported: window.__game.unsupported ?? null, gpu: !!navigator.gpu } : null)), 30000, 'the game to answer').catch(() => null);
      const screen = await p.evaluate(() => { const d = document.getElementById('gf-forge-unsupported'); if (!d) return null; const r = d.getBoundingClientRect(); const a = d.querySelector('#gf-forge-open'); return { w: r.width, h: r.height, text: d.innerText.slice(0, 300), link: a?.href ?? null, shown: getComputedStyle(d).display !== 'none' }; }).catch(() => null);
      const f = await shot(p, 'no-webgpu');
      const ok = s?.phase === 'unsupported' && !!screen?.shown && screen.w > 200 && /WebGPU/.test(screen.text) && !!screen.link && T.errors.length === 0;
      rec.noWebgpu = { state: s, screen, shot: f, errors: T.errors.slice(0, 3) };
      add(32, 'no WebGPU: the kit\'s screen', ok, s?.phase === 'unsupported' ? `in a Chrome with no WebGPU adapter (navigator.gpu ${s.gpu ? 'present, no adapter' : 'missing'}) the game shows the kit's screen: "${(screen?.text ?? '').split('\n').slice(0, 2).join(' ').slice(0, 140)}", with its link${T.errors.length ? `; console: ${T.errors[0]}` : ''}` : `phase ${s?.phase ?? 'none'}: no "open in your browser" screen (a blank canvas fails)`);
      await T.ctx.close();
    } finally { await plain.close().catch(() => {}); }
  });
}

// =====================================================================================================================
// after the solo session

/** 15: the loop is alive: the recording and the goal's share of the first look (the core's slot-ID pass). */
async function check15({ want, add, rec, game, world, recordings, look }) {
  if (!want(15)) return;
  const al = judgeAlive({ game, world, pages: recordings, firstLook: look, aim: null });
  rec.alive = { goal: al.goal, firstLook: look, pages: recordings.map(r => ({ label: r.label, samples: r.samples.length })), items: al.items };
  const mech = (game.mechanics ?? []).length;
  add(15, 'the loop is alive', al.ok, `${al.detail}${mech ? `; mechanics: not yet for forge (${NOT_YET_FORGE.mechanics})` : ''}`);
}
/**
 * 9 (track R, research/gf-forge/lookdev/forge-checks.mjs): the forge capture's contact sheet and perf (its own browser
 * and server; --quick skips it, as on gf-three).
 */
async function check9({ want, dir, add, rec, log, outDir, quick }) {
  if (!want(9)) return;
  try {
    const R = await importPart(join(REPO, 'research/gf-forge/lookdev/forge-checks.mjs'), 'the forge engine (research/gf-forge)');
    const r = await R.check9Forge(dir, { outDir, quick, log: m => log(`  9: ${m}`) });
    add(9, 'contact sheet and perf', r.ok, r.detail);
    if (r.record) rec.capture = { verdict: r.record.verdict, perf: r.record.perf, gates: r.record.gates, shots: r.record.shots.map(s => ({ shot: s.shot, size: s.size, luma: s.luma, coverage: s.coverage })) };
  } catch (e) { add(9, 'contact sheet and perf', false, `the forge capture could not run: ${e.message}`); }
}
/**
 * 19 (track R): the model judge's measuring tier on every body the game ships, with forge's own poses (forge-anim) and
 * GPU skinning held to rig.js's.
 */
async function check19({ want, dir, add, rec, log }) {
  if (!want(19)) return;
  try {
    const R = await importPart(join(REPO, 'research/gf-forge/lookdev/forge-checks.mjs'), 'the forge engine (research/gf-forge)');
    const r = await R.check19Forge(dir, { log: m => log(`  19: ${m}`) });
    add(19, 'bodies hold their shape', r.ok, r.detail);
    if (r.notes.length) rec.notes.push(...r.notes.map(x => `bodies: ${x}`));
    rec.bodies = r.bodies.map(b => ({ slot: b.slot, file: b.file, judge: b.judge, forge: b.forge && { ok: b.forge.ok, compared: b.forge.compared, worst: b.forge.worst } }));
  } catch (e) { add(19, 'bodies hold their shape', false, `the model judge could not run on forge: ${e.message}`); }
}
/** 23: looks like the references (no references → passes as "no references"). */
async function check23({ want, statics, shotsForLikeness }) { if (want(23)) await statics.likeness(shotsForLikeness); }

// =====================================================================================================================
// two players (their own browsers, beside the solo session)

/** The gate, the loadout leg, the friends page and forge's sight leg, one after another. → {gate, lo, fr, sight} */
async function runDuo(env) {
  const { dir, outDir, rec, log, lap, want } = env;
  const out = {};
  const t = Date.now();
  if (want(5) || want(6)) out.gate = await gate(dir, { out: outDir, seconds: 75, log: line => log(`  gate ${line}`) }).catch(e => ({ verdict: 'fail', checks: [{ name: 'run', ok: false, detail: e.message }] }));
  if (want(5)) {
    out.lo = await checkLoadouts({ dir, outDir, shots: rec.shots, log: line => log(`  ${line}`) }).catch(e => ({ ok: false, detail: `loadouts: ${e.message}`, record: null, warnings: [] }));
    out.sight = await checkForgeSight({ dir, outDir, shots: rec.shots, log: line => log(`  ${line}`) }).catch(e => ({ ok: false, detail: `forge sight: ${e.message}`, record: null, warnings: [] }));
  }
  if (want(25)) out.fr = await checkFriends({ dir, outDir, shots: rec.shots, log: line => log(`  ${line}`) }).catch(e => ({ ok: false, detail: `friends: ${e.message}`, record: null, warnings: [] }));
  lap('two players (gate, loadouts, sight, friends)', t);
  return out;
}

/** 5: the live gate (its random-look on-screen sample stood in for by the sight leg), the loadout leg, the sight leg. */
function check5({ want, add, rec }, { gate: g, lo, sight }) {
  if (!want(5) || !g) return;
  const replaced = [], failed = [];
  for (const c of g.checks ?? []) {
    if (c.ok) continue;
    if (GATE_LOOKS.includes(c.name) && sight?.ok) replaced.push(c.name);
    else failed.push(c);
  }
  const gateOk = failed.filter(c => !c.soft).length === 0 && g.verdict !== 'end-unproven';
  rec.gate = { verdict: g.verdict, passed: g.passed, total: g.total, run: g.run ?? null, failed: failed.map(c => `${c.name}${c.soft ? ' (soft)' : ''}: ${c.detail}`), replacedBySight: replaced };
  rec.loadouts = lo?.record ? { ok: lo.ok, steps: lo.record.steps, shots: lo.record.shots } : { ok: false, detail: lo?.detail };
  rec.forgeSight = sight?.record ?? { ok: false, detail: sight?.detail };
  if (lo?.warnings?.length) rec.notes.push(...lo.warnings);
  if (replaced.length) rec.notes.push(`check 5: the gate's ${replaced.join(' and ')} (random input: in the friends page's frame a pointer-locked first-person view cannot be turned by a script) stood in for by forge's sight leg, where each player walks ahead of the other with real keys`);
  add(5, 'two-player live gate', gateOk && !!lo?.ok && !!sight?.ok,
    `gate ${g.verdict} ${g.passed ?? 0}/${g.total ?? 0}${replaced.length ? ` (${replaced.join(', ')}: the sight leg's)` : ''}${failed.length ? `; failed: ${failed.slice(0, 3).map(c => c.name).join(', ')}` : ''}; ${lo?.detail ?? 'no loadout leg'}; sight: ${sight?.detail ?? 'not run'}`);
}
/** 6: a round to results and replay, alone (the solo round) and with two players (the gate's own steps). */
function check6({ want, add, solo }, duo) {
  if (!want(6)) return;
  const g = name => (duo?.gate?.checks ?? []).find(c => c.name === name)?.ok === true;
  const soloOk = !!solo?.ok;
  const duoOk = !!duo?.gate && g('both-see-the-same-results') && g('play-again-starts-a-new-round') && g('host-ends-the-round');
  add(6, 'a round reaches results and replays', soloOk && duoOk, `alone: ${soloOk ? `results (${(solo.results ?? []).map(r => `${r.name} ${r.value}`).join(', ')}), Play again → round 2` : 'did not reach results and a second round'}; two players: ${duo?.gate ? (duoOk ? 'the same results on both, play again, the host ends round 2' : 'the gate did not show results, play again and end round') : 'not run'}`);
}
/** 25: playing with friends (tools/lib/friends-check.mjs, unchanged for forge). */
function check25({ want, add, rec }, { fr }) {
  if (!want(25) || !fr) return;
  rec.friends = fr.record; if (fr.warnings?.length) rec.notes.push(...fr.warnings);
  add(25, 'playing with friends', fr.ok, fr.detail);
}

/** Share of pixels that differ between two PNG screenshots (compared in a page, at 160x90). */
async function pixelDiff(browser, a, b) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([A, B]) => {
      const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(160, 90); const g = c.getContext('2d'); g.drawImage(im, 0, 0, 160, 90); return g.getImageData(0, 0, 160, 90).data; };
      const [x, y] = [await load(A), await load(B)];
      let n = 0; for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 40) n++;
      return n / (x.length / 4);
    }, [a.toString('base64'), b.toString('base64')]);
  } finally { await page.close(); }
}
