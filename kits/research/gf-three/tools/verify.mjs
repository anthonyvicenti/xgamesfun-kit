#!/usr/bin/env node
// gf-three verify: is this game good? One command, one verdict (CONTRACT §5).
//
//   node research/gf-three/tools/verify.mjs <game> [--quick] [--all] [--release] [--profile <file>] [--check N[,N…]]
//                                           [--out <dir>] [--json] [--refs <folder>] [--own-tests require]
//
// What it prints: each FAILING check with its rule and its fix (tools/lib/homes.json), then one summary line. --all
// (or --verbose) prints every check and the progress lines as well.
// A build's verify runs every check below except 8, 31 and 34: those test the kit, no game can fail them, and they run
// per release (--release; regress.mjs --corpus passes it). tools/lib/verdict.mjs RELEASE_ONLY.
// --profile <file>: a machine that cannot run everything (a CI runner with no graphics card). The file is
// {name, environment: {VAR: value}, skip: [{check, reason, legs?}]}: the environment is set before any browser starts,
// each skipped check is recorded ok: null with its reason, check 5 with "legs": "lobby" runs the gate's lobby legs only,
// and the verdict carries profile (name, skipped) and profilePass. A profiled run is never a pass: `pass` stays false
// while a required check is skipped. Exit 0 when everything that was not skipped passed.
//
//   1 assets.json valid (research/asset-manifest/validate.mjs) and multiplayer.json valid
//   2 kit copies unedited (gf/three, gf/mp, audio, gf/gf-assets.js) and vendor/ the pinned libraries
//   3 boots to play with no console errors (real mouse and keyboard, headless Chrome via qa/browser.mjs)
//   4 slot coverage 100%: every visible mesh carries userData.gfSlot (in play and in every ?gf-show subject)
//   5 the two-player live gate (research/multiplayer/party/gate.mjs → gate-live.mjs): real WebRTC, each screen draws
//     the other player where they are, the shared state matches, a round ends, replays, reloads, the host leaves; and
//     the loadout leg (tools/lib/loadout-check.mjs, CONTRACT §6e): two players in different test loadouts each draw the
//     other in their own body colour (read from its material) and shot or stream colour, a change mid-round and a
//     reloaded copy follow
//   6 a round runs to results and replays: alone with bots (here, a 25 s round through Studio's overrides) and with
//     two players (the gate's results, play-again and end-round checks)
//   7 audio gate v4 (research/audio/qa-gate-v4.mjs) over the solo round
//   8 swap proof: one body and one prop slot replaced by an override (as Studio does), the new model is on screen
//   9 contact sheet on the real GPU and perf: research/gf-three/lookdev/capture.mjs when it exists (--quick skips it)
//  10 fair play (tools/lib/fair-check.mjs): a scripted human vs 3 bots for 42 s, twice at once (stands and fights;
//     wanders and sprays), real keys, no ?gf-calm: in control ≥ 85% of the time alive, never out of control longer than
//     fair.downSeconds + 1 s while alive, no knock on a protected player (bot score balance is reported, not failed)
//  11 set dressing (tools/lib/dressing.mjs, no browser): the world is clean (nothing overlapping, floating or out of
//     scale, no litter, open floor, readable ground and player colours, clear spawns); errors fail, warnings are notes.
//     Runs in --quick too. The build agent also answers research/studio-v2/prompts/look-rubric.md from the sheet.
//  12 something happens: across the solo round and check 10's two pages (three rounds with 3 bots), some score moved;
//     a game in which nobody ever scores is dead even when everything else passes
//  13 controls work (tools/lib/controls-check.mjs): every control config/game.json lists (the HUD's control line) does
//     something the player sees on their own screen: jump rises; interact, next to a pickup, station or carry item, takes
//     or works it; primary and secondary, held, change the pixels near the crosshair (and, with the kit's observation,
//     land under the crosshair, clear of the player's own body), plus paint when the game paints (creator, T1 run 5:
//     "I cant seem to fire pee or drink")
//  14 looks honoured (tools/lib/looks-check.mjs, no browser, runs in --quick): a character or prop the spec asks to be
//     generated or made from a reference is not still a stand-in (the library bean, a kit stand-in file, create's
//     placeholder) unless game/generated.json records the failed generation and the delivery line naming it; two roles
//     described differently never share one body file (creator, Hang Up On Them: purple jelly-bean zombies)
//  15 the loop is alive (tools/lib/alive-check.mjs): each mechanic shows its own sign of life in the kit's state on the
//     pages above (waves: enemies come and go for their goal, an idle player alone loses the target, an aimed shot hurts
//     one; pickup taken; a hit lands; …), and the goal (a prop whose role is the thing to defend) fills a readable share
//     of the player's first look, with the waves target's health on the HUD (creator, "Hang Up On Them": round 1 passed
//     13/13 with no token on screen and zombies standing at the doors). Runs in --quick
//  16 hits read (tools/lib/hits-check.mjs, runs in --quick): with the kit's staged moment ?gf-demo=waves.hit, the player
//     shoots enemies on real clicks; a hit that does not kill changes the enemy on the player's own screen (its health
//     bar, a flash, a flinch) and the median is at least 2 hits per kill unless the locked spec asks for one-hit kills
//     (creator, "Hang Up On Them": "The zombies are instant killed to I couldn't even tell what was happened"). A game
//     with no waves mechanic passes (nothing to hit)
//  17 the world is complete (tools/lib/world-check.mjs, no browser, runs in --quick): the play area matches the spec's
//     size class, medium and large have rooms or areas, an indoor world is closed (walls all round with gaps only at
//     doorways you can walk through, a ceiling) with a street or skyline outside rather than trees over the walls, the
//     view past the walls or edge shows something, and enemies come in through real doors or gates (creator, "Hang Up
//     On Them": "The open world is small ... we need to make the worlds actually complete and make sense")
//  18 sounds play (tools/lib/sounds-check.mjs, no browser, runs in --quick): one sound list, every listed file there,
//     every audio file played, every id the game's code plays listed (creator, Token Call Centre: "I asked audio to be
//     added to the game but it wasn't added at all")
//  19 bodies hold their shape (tools/lib/bodies-check.mjs → body-judge.mjs, no browser, runs in --quick): every
//     character body, posed by the game's own retarget through every clip, keeps its face, body, arms, hands, legs and
//     feet (creator, Token Call Centre: "the models look good, but the hand is crooked")
//  20–22 the home menu, the HUD and the wallet in the menu (tools/lib/menu-check.mjs, CONTRACT §6g)
//  23 looks like the references (tools/lib/likeness-check.mjs): when the locked spec lists style or character reference
//     images and the job has their files (refs.json beside the game, or --refs <folder>), a vision judge (Claude Opus,
//     like the model judge's look) compares the game's own screenshots (and the contact sheet's, when 9 ran) with each
//     picture on camera angle, palette, light and glow, environment shapes, character proportions and style, and vibe;
//     it fails below the threshold and names what to change; without references it passes as "no references" (creator,
//     the roguelike miss: "The game also doesn't have the right vibe at all")
//  24 plays inside a post (tools/lib/embed-check.mjs, CONTRACT §6d C5): framed 480×480 by a page that refuses the
//     pointer lock (as a post on X does), the camera stays the game's own, the full-screen button works, and in full
//     screen a drag turns the camera and W moves
//  25 playing with friends (tools/lib/friends-check.mjs, CONTRACT §6h): through the kit's friends page, two players over
//     real WebRTC: a name before hosting and joining (never blank, never "Player"), one waiting room (no second copy of
//     the room), no start alone, a rename in the room reaches the other player and the game, each player's dot is the
//     colour the game draws them in, no bots in the round, and after real play the results card (the only one) shows
//     each player the score the game counted for them (creator 2026-10-08: "New users can't name before joining a room
//     or change name in a room before the game. Final scores seem to always be the same regardless. We really
//     shouldn't have bots in multiplayer modes")
//
//  35 the game's own tests (tools/lib/game-tests.mjs; home "game"): every <game>/tests/*.test.json, a play script with
//     "expect" steps that names one of the game's own promises (its loop, its scoring, a mechanic as this game has it,
//     its hook, an accept item), runs alone on a page of its own on stepped time; a test that fails, cannot run or
//     names no promise fails the check. No tests: passes with nothing to run, and the verdict lists the own promises
//     no test names; --own-tests require makes that list a failure
//
// Time: checks 10, 13, 16 and 35 wait in the game's own time (tools/lib/stepped.mjs, kit/core/step.js ?gf-step=1) when
// the game's kit offers it; the solo round (3, 6, 7: the audio gate measures real sound), the menu, HUD, wallet and
// post pages, check 15's own pages and every two-player leg (real WebRTC) run on the wall clock.
//
// Engines (CONTRACT §8): a scenic game's pages run in WebGPU Chrome (its real renderer), a party game's in WebGL Chrome.
//
// --check takes one check or any list (1,2 or 13,16 or 3,4,5). One of 10, 13, 15, 16, 20, 21, 22, 23, 24, 25, 31, 34, 35
// runs alone on a page of its own (a quick repair loop); a list of the static checks (1, 2, 11, 14, 17, 18, 19) runs
// with no browser, in about a second; any other list runs the whole flow with every other check left out. Evidence:
// <game>/evidence/verify-N/ (or --out): verdict.json (`timing`, seconds per step; each check's own `seconds`; a
// failing check's `rule` and `fix`), screenshots, the gate's own record. Append-only. The two-player gate
// and its loadout leg run in their own browser beside the solo session. Exit 0 when every check REQUIRED in
// tools/lib/verdict.mjs for this run passes (requiredFor: a build's list, or a release's; 9 counts when run).
import { isMain } from './lib/main.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, GF3, LIBRARY, STANDIN_ASSETS, KIT_VERSION, launchForGame, engineOfGame, relPosix } from './lib/paths.mjs';
import { checkKitCopies } from './lib/kit-check.mjs';
import { validateGame } from '../../asset-manifest/validate.mjs';
import { readManifest, validateMultiplayer, startParty } from '../../multiplayer/party/lib.mjs';
import { gate } from '../../multiplayer/party/gate.mjs';
import { launchChrome, GPU_TROUBLE } from '../../foundations/qa/browser.mjs';
import { installAudioTap, resetAudioTap, audioReport } from '../../audio/qa-gate-v4.mjs';
import { checkFairPlay } from './lib/fair-check.mjs';
import { checkControls } from './lib/controls-check.mjs';
import { checkHits } from './lib/hits-check.mjs';
import { checkLoadouts } from './lib/loadout-check.mjs';
import { loadSubject, lintDressing, lines as dressingLines } from './lib/dressing.mjs';
import { RECORDER, recordingOf, firstLook, undefended, judgeAlive, goalOf } from './lib/alive-check.mjs';
import { gameFingerprint } from './lib/own-verify.mjs';
import { passes, passesForge, profilePasses, requiredFor, runsHere, checkProfile } from './lib/verdict.mjs';
import { checkHome } from './lib/homes.mjs';
import { checkLooks } from './lib/looks-check.mjs';
import { worldCheck } from './lib/world-check.mjs';
import { checkSounds } from './lib/sounds-check.mjs';
import { checkMenu, checkHud, checkWallet } from './lib/menu-check.mjs';
import { checkEmbed } from './lib/embed-check.mjs';
import { checkScreens } from './lib/screens-check.mjs';
import { checkFriends } from './lib/friends-check.mjs';
import { checkFriendsWatch } from './lib/friends-watch-check.mjs';
import { checkLikeness, likenessTargets } from './lib/likeness-check.mjs';
import { STEP_PRE, STEP_POST } from './lib/stepped.mjs';
import { lockFor } from './lib/lock.mjs';
import { checkGameTests } from './lib/game-tests.mjs';
import { shortRound, flowPulse } from './lib/flow-signs.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(150); } }

export async function verify(gameDir, { quick = false, out = null, log = console.log, only = null, refs = null, release = false, profile = null, all = false, ownTests = null } = {}) {
  const dir = resolve(gameDir);
  const t0 = Date.now();
  const checks = [];
  // the profile's environment, before any browser is launched (GF_VERIFY_SOFTWARE and the like)
  for (const [k, v] of Object.entries(profile?.environment ?? {})) process.env[k] = String(v);
  // what is printed: a failing check with its rule and its fix, always; passes, skips and progress lines with --all
  const say = all ? log : () => {};
  // seconds per check: from begin(n) when the flow marked the check's start, else since the check recorded before it
  // (the world and forge flows, and a check alone); a step that several checks share is passed in as `seconds`
  const started = new Map(); let lastAdd = t0;
  const begin = (...ns) => { const t = Date.now(); for (const n of ns) started.set(n, t); };
  const add = (n, name, ok, detail = '', extra = {}) => {
    const now = Date.now(), home = checkHome(n), failed = ok !== null && !ok;
    const { seconds: given, ...rest } = extra;
    const seconds = ok === null ? null : Math.round((given ?? (now - (started.get(n) ?? lastAdd)) / 1000) * 10) / 10;
    lastAdd = now;
    checks.push({ n, name, ok: ok === null ? null : !!ok, detail: String(detail ?? '').slice(0, 1800), ...(seconds === null ? {} : { seconds }), ...rest, ...(failed && home ? { rule: home.rule, fix: home.fix } : {}) });
    if (failed) log(`FAIL ${n} ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}${home ? `\n  rule: ${home.rule}\n  fix:  ${home.fix}` : ''}`);
    else say(`${ok === null ? 'SKIP' : 'PASS'} ${n} ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
    return !!ok;
  };
  // evidence folder: the next free verify-N
  let outDir = out ? resolve(out) : null;
  if (!outDir) { const root = join(dir, 'evidence'); await mkdir(root, { recursive: true }); const taken = new Set(await readdir(root)); let n = 1; while (taken.has(`verify-${n}`)) n++; outDir = join(root, `verify-${n}`); }
  await mkdir(outDir, { recursive: true });
  const rec = { schema: 'gf-three-verify/1', game: basename(dir), kit: KIT_VERSION, quick, ...(release ? { release: true } : {}), ...(only !== null ? { only } : {}), started: new Date().toISOString(), checks, notes: [], shots: [], timing: {} };
  const lap = (name, since) => { rec.timing[name] = Math.round((Date.now() - since) / 100) / 10; };   // seconds per step
  rec.gameFiles = await gameFingerprint(dir).catch(() => null);   // the files the agent tunes, as verified (own-verify.mjs)
  const list = only === null ? null : [].concat(only);
  const one = list?.length === 1 ? list[0] : null;
  // a world (CONTRACT §9: config/game.json round.mode "world") has its own flow, tools/verify-world.mjs; so has a forge
  // game (CONTRACT §8 forge: tools/verify-forge.mjs, the checks that apply through the forge observation interface; the
  // rest listed "not yet for forge", never passed)
  const roundMode = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8').catch(() => '{}')).round?.mode;
  const kind = roundMode === 'world' ? 'world' : await engineOfGame(dir) === 'forge' ? 'forge' : 'round';
  const required = requiredFor(kind, { release });
  if (kind !== 'round') {
    // a profile here: its checks are left out of the run and recorded as skipped after it (the gate's lobby-only legs
    // are a round game's; here check 5 is skipped whole)
    const skip = profile ? profile.skip.filter(s => (list ?? [...required, 9]).includes(s.check)) : [];
    const run = profile ? (list ?? required).filter(n => !skip.some(s => s.check === n)) : only;
    const flow = kind === 'world' ? (await import('./verify-world.mjs')).verifyWorld : (await import('./verify-forge.mjs')).verifyForge;
    const r = await flow(dir, { rec, outDir, add, log: say, t0, lap, quick, only: run, release,
      statics: { looks: () => looks(dir, rec, add), check18: () => check18(dir, { rec, add }), check19: () => check19(dir, { rec, add }), likeness: shots => likeness(dir, { rec, add, shots, refs }) } });
    if (profile) {
      for (const s of skip) add(s.check, checkHome(s.check)?.name ?? `check ${s.check}`, null, `skipped by profile ${profile.name}: ${s.reason}`, { skippedBy: 'profile', reason: s.reason });
      checks.sort((a, b) => (typeof a.n === 'number' ? a.n : 99) - (typeof b.n === 'number' ? b.n : 99));
      if (!list) r.pass = kind === 'forge' ? passesForge(checks, required) : passes(checks, required);
      stampProfile(r, profile, required);
      await writeFile(join(outDir, 'verdict.json'), JSON.stringify(r, null, 2) + '\n');
    }
    return r;
  }
  const A = { rec, outDir, add, log: say, t0, lap, refs, ownTests };
  if (list && list.every(n => STATIC_ALONE.includes(n))) return staticOnly(dir, list, A);
  if (one === 10) return fairOnly(dir, A);
  if (one === 13) return controlsOnly(dir, A);
  if (one === 15) return aliveOnly(dir, A);
  if (one === 16) return hitsOnly(dir, A);
  if ([20, 21, 22, 24, 31].includes(one)) return menuOnly(dir, one, A);
  if (one === 23) return likenessOnly(dir, A);
  if (one === 25) return friendsOnly(dir, A);
  if (one === 34) return watchOnly(dir, A);
  if (one === 35) return ownTestsOnly(dir, A);

  // ---- which checks this run makes: a list (--check), else every check of a build (a release adds 8, 31 and 34);
  // a profile's skipped checks are recorded first, each with its reason, and never run ----
  const skipBy = new Map((profile?.skip ?? []).map(x => [x.check, x]));
  const asked = n => (list ? list.includes(n) : n === 9 || runsHere(n, { release }));
  const lobbyOnly = asked(5) && skipBy.get(5)?.legs === 'lobby';
  const want = n => asked(n) && !skipBy.has(n);
  for (const n of [...requiredFor('round', { release: true }), 9].sort((a, b) => a - b)) {
    if (asked(n) && skipBy.has(n) && !(n === 5 && lobbyOnly)) add(n, checkHome(n)?.name ?? `check ${n}`, null, `skipped by profile ${profile.name}: ${skipBy.get(n).reason}`, { skippedBy: 'profile', reason: skipBy.get(n).reason });
  }
  const timed = async fn => { const t = Date.now(); const r = await fn(); return [r, (Date.now() - t) / 1000]; };

  // ---- 1. manifests ---- 2. kit copies ----
  const mpm = await readManifest(dir);
  const live = mpm.manifest?.mode === 'live';
  if (want(1)) { begin(1); await check1(dir, { rec, add, mpm }); }
  if (want(2)) { begin(2); await check2(dir, { rec, add }); }

  // ---- 11. set dressing (static, fast; creator feedback on Bladder Wars, 2026-10-06: "maybe some cleanup on the assets") ----
  if (want(11)) {
    begin(11);
    try {
      const dr = lintDressing(await loadSubject(dir));
      const ls = dressingLines(dr);
      add(11, 'set dressing', dr.errors === 0, dr.errors === 0
        ? `clean: 0 errors, ${dr.warnings} warnings, open floor ${(dr.stats.openFloor * 100).toFixed(0)}%`
        : `${dr.errors} errors (fix in config/world.json and the slots named; node ${join(GF3, 'tools/dressing.mjs')} <game> lists them all): ${ls.filter(l => l.startsWith('ERROR')).slice(0, 6).join(' | ')}`);
      if (dr.warnings) rec.notes.push(`set dressing warnings: ${ls.filter(l => l.startsWith('warn')).slice(0, 6).join(' | ')}`);
      rec.dressing = { errors: dr.errors, warnings: dr.warnings, stats: dr.stats };
    } catch (e) { add(11, 'set dressing', false, `the lint could not run: ${e.message}`); }
  }
  // ---- 14. looks honoured (static; creator on Hang Up On Them, 2026-10-07: "the final assets look nothing like the reference image") ----
  if (want(14)) { begin(14); await looks(dir, rec, add); }
  if (want(17)) { begin(17); await check17(dir, { rec, add }); }
  if (want(18)) { begin(18); await check18(dir, { rec, add }); }
  if (want(19)) { begin(19); await check19(dir, { rec, add }); }
  // ---- 35. the game's own tests: with no test files there is nothing to play, and the check is judged here, with no
  // browser (what is untested is listed); with tests it runs in the solo session below ----
  const ownTestFiles = existsSync(join(dir, 'tests')) && (await readdir(join(dir, 'tests'))).some(n => n.endsWith('.test.json'));
  if (want(35) && !ownTestFiles) {
    begin(35);
    const gt = await checkGameTests({ dir, promises: await ownPromiseList(dir), requireTests: ownTests === 'require' });
    rec.gameTests = gt.record; add(35, 'the game\'s own tests', gt.ok, gt.detail);
  }

  // ---- 5. the two-player live gate and its loadout leg: their own server and browsers, beside the solo session ----
  // (they share nothing with it; run one after the other they were 80 of verify's 183 s with --quick, 2026-10-07)
  // each leg runs only when a check of this run needs it; under a profile that keeps check 5's lobby legs, the gate
  // stops once both players are in the room over WebRTC
  const needGate = want(5) || want(6) || lobbyOnly;
  const duo = live && (needGate || want(25) || want(34)) ? (async () => {
    const R = { seconds: {} };
    if (needGate) {
      const t = Date.now();
      R.gateRec = await gate(dir, { out: outDir, seconds: 75, ...(lobbyOnly && !want(6) ? { legs: 'lobby' } : {}), log: line => say(`  gate ${line}`) }).catch(e => ({ verdict: 'fail', checks: [{ name: 'run', ok: false, detail: e.message }] }));
      lap('gate', t); R.seconds.gate = (Date.now() - t) / 1000;
    }
    if (want(5)) {
      const t2 = Date.now();
      // the loadout leg (CONTRACT §6e, tools/lib/loadout-check.mjs): each screen draws the other player in their own look
      R.lo = await checkLoadouts({ dir, outDir, shots: rec.shots, log: line => say(`  ${line}`) }).catch(e => ({ ok: false, detail: `loadouts: ${e.message}`, record: null, warnings: [] }));
      lap('loadouts', t2); R.seconds.loadouts = (Date.now() - t2) / 1000;
    }
    if (want(25)) {
      // 25. playing with friends (tools/lib/friends-check.mjs): the friends page the way a new player meets it
      const t3 = Date.now();
      R.fr = await checkFriends({ dir, outDir, shots: rec.shots, log: line => say(`  ${line}`) }).catch(e => ({ ok: false, detail: `friends: ${e.message}`, record: null, warnings: [] }));
      lap('friends', t3); R.seconds.friends = (Date.now() - t3) / 1000;
    }
    if (want(34)) {
      // 34. watch then play (tools/lib/friends-watch-check.mjs, CONTRACT §9b; a release check): go live in a round, a viewer watches, then joins
      const t4 = Date.now();
      R.wa = await checkFriendsWatch({ dir, outDir, shots: rec.shots, log: line => say(`  ${line}`) }).catch(e => ({ ok: false, detail: `watch: ${e.message}`, record: null, warnings: [] }));
      lap('watch', t4); R.seconds.watch = (Date.now() - t4) / 1000;
    }
    return R;
  })() : null;

  // ---- 3, 4, 6 (alone), 7, 8, 10, 12, 13, 15: one solo session with bots, real input ----
  // the solo round; check 23 looks at its screenshots, but only when the job has reference pictures to compare with
  const refShots = want(23) && ((await likenessTargets(dir, { refs }).catch(() => null))?.targets?.length ?? 0) > 0;
  const needRound = [3, 4, 6, 7, 12, 15].some(want) || refShots;
  const needFair = [10, 12, 15].some(want);                       // check 10's two pages (12 and 15 read them too)
  const needBrowser = needRound || needFair || [8, 13, 16, 20, 21, 22, 24, 31].some(want) || (want(35) && ownTestFiles);
  let solo = null, gateRec = null, soloSeconds = 0;
  if (needBrowser) {
  const assets = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
  const srv = await startParty({ dir, port: 0 });
  // Gameplay checks run on the real GPU when there is one (WebGL through ANGLE; Chrome falls back to SwiftShader on a
  // machine without one, e.g. a GPU-less worker container). SwiftShader made a paint-and-stream game run at about 4 fps,
  // so its round never reached results (Studio v2 T1 run 4). GF_VERIFY_SOFTWARE=1 forces software rendering.
  let tStep = Date.now();
  // a scenic game (CONTRACT §8) runs on WebGPU, its real renderer; a party game on WebGL (paths.mjs launchForGame)
  const launched = await launchForGame(launchChrome, dir);
  const browser = launched.browser;
  rec.chrome = browser.version();
  rec.engine = launched.engine;
  rec.renderer = launched.gpu === 'software' ? 'software' : `gpu (${launched.gpu}) when available`;
  if (launched.note) rec.notes.push(launched.note);
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };   // the name is taken before the await (shots run in parallel)
  // every page records the observation for check 15 (alive-check.mjs RECORDER) and hands it over when it closes
  const recordings = [];
  const newPage = async (label, { overrides = null, audio = false, realLock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await lockFor(page, launched.gpu, { realLock });   // the WebGPU Chrome's pointer lock reports motion that never happened (tools/lib/lock.mjs)
    const errors = [];
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    if (audio) await installAudioTap(page);
    // a page a check runs on stepped time (tools/lib/stepped.mjs: ?gf-step=1) has the recorder sample by the game's
    // time; on any other page the two scripts round it do nothing
    await page.addInitScript(STEP_PRE);
    await page.addInitScript(RECORDER);
    await page.addInitScript(STEP_POST);
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => { const r = await recordingOf(page); if (r?.samples?.length) recordings.push({ label, samples: r.samples }); return close(...a); };
    return { ctx, page, errors };
  };
  const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
  const world = JSON.parse(await readFile(join(dir, 'config/world.json'), 'utf8').catch(() => '{}'));
  let look = null;
  const snap = page => page.evaluate(() => window.__game?.snapshot?.() ?? null);
  const roundSeconds = 25;
  let S = null, sr = null, replayed = null, audio = null, cov = [];
  try {
    if (needRound) {
    // the solo round: real clicks and keys; a 25 s round through Studio's own override mechanism
    // (a flow with a clock of its own says what else the short round cuts: tools/lib/flow-signs.mjs shortRound)
    S = await newPage('solo', { audio: true, overrides: { patches: shortRound(game, roundSeconds) } });
    solo = S;
    const p = S.page;
    await p.goto(`${srv.url}?seed=7&bots=3&gf-calm=6`, { waitUntil: 'load' });   // gf-calm: bots stand still for the walk test
    await until(async () => (await snap(p))?.phase === 'lobby', 90000, 'the lobby');
    await shot(p, 'lobby');
    const play = await p.locator('#gf-play').boundingBox();
    await p.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
    await until(async () => (await snap(p))?.phase === 'playing', 15000, 'the round to start');
    look = await firstLook(p, game, world);                          // check 15: the goal and the HUD in the first look
    await shot(p, 'first-look');
    await resetAudioTap(p);
    await p.mouse.click(640, 400);                                   // takes the mouse (pointer lock)
    // The walk test: the farthest the local player gets from its start while keys are held, sampled, so a bot knocking
    // it over mid-walk does not read as "input does nothing"; one retry after a pause if it still barely moved.
    let moved = 0, s1 = null, walkTries = 0;
    const walk = async () => {
      const start = (await snap(p)).players.find(x => x.local);
      const far = async () => { const m = (await snap(p))?.players.find(x => x.local); if (m) moved = Math.max(moved, Math.hypot(m.x - start.x, m.z - start.z)); };
      await p.keyboard.down('KeyW');
      for (let i = 0; i < 7; i++) { await sleep(200); await far(); }
      await p.mouse.move(700, 380, { steps: 6 }); await p.keyboard.up('KeyW');
      await p.keyboard.press('Space'); await sleep(400);
      await p.keyboard.down('KeyD'); for (let i = 0; i < 4; i++) { await sleep(180); await far(); } await p.keyboard.up('KeyD');
      walkTries++;
    };
    await walk();
    if (moved <= 0.5) { await sleep(3000); await walk(); }
    await p.keyboard.press('KeyE'); await sleep(300); await p.mouse.click(640, 400); await sleep(300);
    s1 = await snap(p);
    await shot(p, 'playing');
    // coverage while things move (balls flying, players knocked over): three samples
    for (let i = 0; i < 3; i++) { cov.push(await p.evaluate(() => window.__game.coverage())); await sleep(2500); }
    await shot(p, 'mid-round');
    await until(async () => (await snap(p))?.phase === 'results', (roundSeconds + 20) * 1000, 'the results');
    sr = await snap(p);
    await shot(p, 'results');
    const again = await p.locator('#gf-again').boundingBox().catch(() => null);
    if (again) await p.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
    replayed = await until(async () => { const s = await snap(p); return s && s.round === 2 && ['countdown', 'playing'].includes(s.phase) ? s : null; }, 10000, 'round 2').catch(() => null);
    await until(async () => (await snap(p))?.phase === 'playing', 8000, 'round 2 to play').catch(() => {});
    await sleep(1500);
    await shot(p, 'round-2');
    audio = await audioReport(p);
    soloSeconds = (Date.now() - tStep) / 1000;
    rec.solo = { moved: +moved.toFixed(2), results: sr.results, winners: sr.winners, coverage: cov.map(c => ({ meshes: c.meshes, tagged: c.tagged, exempt: c.exempt, untagged: c.untagged.length, unknownSlots: c.unknownSlots })), audio: { ok: audio.ok, heard: audio.heard, problems: audio.problems, mix: audio.mix, maxSoundsPer100ms: audio.maxSoundsPer100ms, hidden: audio.hidden } };
    if (want(3)) add(3, 'boots to play with no console errors', S.errors.length === 0 && moved > 0.5, `${S.errors.length ? `console errors: ${[...new Set(S.errors)].slice(0, 3).join(' | ')}` : 'no console errors'}; the player walked ${moved.toFixed(2)} m on real keys${walkTries > 1 ? ' (second try)' : ''}; ${s1.players.length} players`, { seconds: soloSeconds, shares: 'the solo round, with 6 and 7' });
    lap('solo round', tStep); tStep = Date.now();
    }
    if (want(4)) {
    begin(4);   // its seconds are the preview subjects; the three samples in play were taken during the solo round
    // coverage: in play and in every preview subject
    const subjects = (assets.showcase ?? []).map(x => x.query);
    const subjectCov = await pool(subjects, 3, async q => {
      const T = await newPage(`show ${q}`);
      await T.page.goto(srv.url + q, { waitUntil: 'load' });
      await until(async () => (await T.page.evaluate(() => window.__game?.ready === true).catch(() => false)), 60000, `${q} to frame`).catch(() => {});
      await sleep(600);
      const c = await T.page.evaluate(() => window.__game?.coverage?.() ?? null).catch(() => null);
      await T.ctx.close();
      return { q, c, errors: T.errors };
    });
    const allCov = [...cov, ...subjectCov.map(x => x.c)];
    const untagged = allCov.flatMap(c => c?.untagged ?? [{ name: 'no coverage report' }]);
    const unknown = [...new Set(allCov.flatMap(c => c?.unknownSlots ?? []))];
    const showErrors = subjectCov.flatMap(x => x.errors);
    add(4, 'slot coverage 100%', untagged.length === 0 && showErrors.length === 0, `${cov.map(c => `${c.tagged}/${c.meshes}`).join(', ')} tagged in play; ${subjectCov.map(x => `${x.q.replace('?gf-show=', '')} ${x.c ? `${x.c.tagged}/${x.c.meshes}` : 'no report'}`).join(', ')}${untagged.length ? `; untagged: ${untagged.slice(0, 4).map(u => u.path ?? u.name).join(', ')}` : ''}${showErrors.length ? `; errors: ${showErrors.slice(0, 2).join(' | ')}` : ''}`);
    if (unknown.length) rec.notes.push(`meshes tagged with ids assets.json lacks (not counted against coverage; the module should use a declared slot id): ${unknown.join(', ')}`);
    rec.solo.subjects = subjectCov.map(x => ({ q: x.q, meshes: x.c?.meshes, tagged: x.c?.tagged, untagged: x.c?.untagged?.length }));
    lap('coverage subjects', tStep); tStep = Date.now();
    }

    // ---- 8. swap proof: a body and a prop replaced the way Studio does it (a release check) ----
    if (want(8)) {
    begin(8);
    const record = JSON.parse(await readFile(join(dir, 'gf-three.json'), 'utf8').catch(() => '{}'));
    // a model the worker generated and placed (game/generated.json) is the one swapped first: it must swap like any other
    const made = (JSON.parse(await readFile(join(dir, 'generated.json'), 'utf8').catch(() => '{}')).items ?? []).filter(i => i.state === 'placed').map(i => i.slot);
    const bodySlot = assets.slots.find(s => made.includes(s.id) && s.id.startsWith('character.body.')) ?? assets.slots.find(s => s.id.startsWith('character.body.'));
    const named = Object.values(record.named ?? {});
    const rank = id => (made.includes(id) ? 2 : named.includes(id) ? 1 : 0);
    const propSlot = [...assets.slots].sort((a, b) => rank(b.id) - rank(a.id)).find(s => s.id.startsWith('prop.') && s.type === 'model' && (assets.showcase ?? []).some(x => x.query === `?gf-show=${s.id}`));
    const pick = async (cur, list) => { const curBytes = await readFile(join(dir, cur)); for (const f of list) if (existsSync(f) && !(await readFile(f)).equals(curBytes)) return f; return null; };
    const bodyFile = bodySlot && await pick(bodySlot.source.file, record.modules?.character ? ['ual-mannequin', 'quaternius-astronaut', 'bean-chunky', 'bean-classic'].map(n => join(LIBRARY, `bodies/${n}.glb`)) : [join(STANDIN_ASSETS, 'crate.glb')]);
    const propFile = propSlot && await pick(propSlot.source.file, [join(STANDIN_ASSETS, 'crate.glb'), join(STANDIN_ASSETS, 'bench.glb')]);
    const swaps = await pool([[bodySlot, bodyFile, bodySlot && `character.${bodySlot.id.split('.')[2]}`], [propSlot, propFile, propSlot?.id]], 2, async ([slot, file, subject]) => {
      if (!slot || !file) return { slot: slot?.id ?? null, ok: false, why: 'no slot or no replacement file' };
      const look = async overrides => {
        const T = await newPage(`swap ${slot.id}`, { overrides });
        await T.page.goto(`${srv.url}?gf-show=${subject}`, { waitUntil: 'load' });
        await until(async () => (await T.page.evaluate(() => window.__game?.ready === true).catch(() => false)), 60000, `${subject} to frame`).catch(() => {});
        await sleep(800);
        const st = await T.page.evaluate(id => window.__game.slots()[id] ?? null, slot.id).catch(() => null);
        const img = await T.page.screenshot({ type: 'png' });
        return { T, st, img };
      };
      const dataUrl = `data:model/gltf-binary;base64,${(await readFile(file)).toString('base64')}`;
      const [before, after] = await Promise.all([look(null), look({ files: { [slot.source.file]: dataUrl } })]);
      const diff = await pixelDiff(browser, before.img, after.img);
      const f1 = await shot(before.T.page, `swap-${slot.id}-before`), f2 = await shot(after.T.page, `swap-${slot.id}-after`);
      const ok = !!(before.st && after.st && after.st.onScreen && after.st.triangles !== before.st.triangles && diff > 0.01) && after.T.errors.length === 0;
      await before.T.ctx.close(); await after.T.ctx.close();
      return { slot: slot.id, file: relPosix(REPO, file), ok, before: before.st, after: after.st, pixelsChanged: +diff.toFixed(3), errors: after.T.errors.slice(0, 3), shots: [f1, f2] };
    });
    rec.swaps = swaps;
    add(8, 'swap proof', swaps.length === 2 && swaps.every(s => s.ok), swaps.map(s => s.ok ? `${s.slot}: ${s.before.triangles} → ${s.after.triangles} triangles, on screen, ${(s.pixelsChanged * 100).toFixed(1)}% of pixels changed` : `${s.slot}: ${s.why ?? `not shown (${JSON.stringify(s.after)}${s.errors?.length ? `; ${s.errors[0]}` : ''})`}`).join(' · '));
    lap('swaps', tStep); tStep = Date.now();
    }

    // ---- 13. controls work: each listed control, from the player's own view (a page of its own, no bots) ----
    if (S) await S.ctx.close();
    if (want(13)) {
      begin(13);
      const cc = await checkControls({ newPage, browser, url: srv.url, game, log: say, shot: controlsShot(shot, outDir, rec) });
      rec.controls = cc.record;
      if (cc.warnings.length) rec.notes.push(...cc.warnings);
      add(13, 'controls work', cc.ok, cc.detail);
    }
    if (want(16)) {
      // ---- 16. hits read: shoot an enemy from the player's own view (a page of its own, no bots) ----
      begin(16);
      const hc = await checkHits({ newPage, browser, url: srv.url, game, dir, log: say, shot: controlsShot(shot, outDir, rec) });
      rec.hits = hc.record;
      if (hc.warnings.length) rec.notes.push(...hc.warnings);
      add(16, 'hits read', hc.ok, hc.detail);
    }
    lap('controls', tStep); tStep = Date.now();
    if (want(35) && ownTestFiles) {
      // ---- 35. the game's own tests: each of its own promises, as the steps its builder wrote (a page each, stepped time) ----
      begin(35);
      const gt = await checkGameTests({ dir, newPage, url: srv.url, promises: await ownPromiseList(dir), requireTests: ownTests === 'require', log: say });
      rec.gameTests = gt.record; if (gt.warnings.length) rec.notes.push(...gt.warnings);
      add(35, 'the game\'s own tests', gt.ok, gt.detail);
      lap('own tests', tStep); tStep = Date.now();
    }
    // ---- 20, 21, 22: the home menu, the HUD and the wallet in the menu (CONTRACT §6g; creator 2026-10-08: "our games are
    // all missing a home menu and a lot of user HUDs, especially for health ... wallet connect in the home menu") ----
    if (want(20)) {
      begin(20);
      const mc = await checkMenu({ newPage, url: srv.url, game, log: say, shot });
      rec.menu = mc.record; if (mc.warnings.length) rec.notes.push(...mc.warnings);
      add(20, 'the menu works', mc.ok, mc.detail);
    }
    {
      const [[hu, huS], [wa, waS]] = await Promise.all([
        want(21) ? timed(() => checkHud({ newPage, url: srv.url, game, log: say, shot })) : [null, 0],
        want(22) ? timed(() => checkWallet({ newPage, url: srv.url, log: say, shot })) : [null, 0]]);
      if (hu) { rec.hud = hu.record; if (hu.warnings.length) rec.notes.push(...hu.warnings); add(21, 'the HUD shows your state', hu.ok, hu.detail, { seconds: huS }); }
      if (wa) { rec.wallet = wa.record; if (wa.warnings.length) rec.notes.push(...wa.warnings); add(22, 'the wallet in the menu', wa.ok, wa.detail, { seconds: waS }); }
    }
    if (want(24)) {
      // 24. plays inside a post (CONTRACT §6d; creator 2026-10-08, a post on X: "It doesn't stay in the iframe, you can
      // easily move your mouse out")
      begin(24);
      const em = await checkEmbed({ newPage, url: srv.url, game, log: say, shot });
      rec.embed = em.record; if (em.warnings.length) rec.notes.push(...em.warnings);
      add(24, 'plays inside a post', em.ok, em.detail);
    }
    if (want(31)) {
      // 31. sharp on every screen (CONTRACT §6i; creator 2026-10-09: "Different screen sizes make the game look bad"; a release check)
      begin(31);
      const sc = await checkScreens({ browser, url: srv.url, log: say });
      rec.screens = sc.record; if (sc.warnings.length) rec.notes.push(...sc.warnings);
      add(31, 'sharp on every screen', sc.ok, sc.detail);
    }
    lap('menu, HUD, wallet, post and screens', tStep); tStep = Date.now();
    // ---- 10. fair play: a scripted human vs 3 bots, for real (no gf-calm); beside it, check 15's undefended page ----
    const W = goalOf(game, world).waves;
    let fp = null, und = null, fairSeconds = 0;
    if (needFair) {
      [[fp, und], fairSeconds] = await timed(() => Promise.all([
        checkFairPlay({ newPage, url: srv.url, log: say }),
        W && want(15) ? undefended({ newPage, url: srv.url, game, world, shot, log: say }).catch(e => ({ error: e.message })) : null,
      ]));
      rec.fair = fp.record;
      if (fp.warnings.length) rec.notes.push(...fp.warnings);
      if (want(10)) add(10, 'fair play', fp.ok, fp.detail, { seconds: fairSeconds });
      lap('fair play and the undefended page', tStep); tStep = Date.now();
    }
    // ---- 12. the pulse: something happens. Three rounds with bots (the solo round and check 10's two pages) in
    // which no score ever moved means a dead game, whatever else passes (T1 run 5 shipped one: its rules read
    // paint.coverageOf(p).cells, which is undefined, so nobody ever scored and fair play passed with 0 knocks).
    if (want(12)) {
      const vals = (sr?.results ?? []).map(r => Number(r.value) || 0);
      const soloMoved = Math.max(0, ...vals) >= 2;   // the bell's results: a score that built up (a lone 1 can be a flicker)
      const pages = fp?.record.pages ?? [];
      const fairMoved = pages.some(pg => pg.scoreMoved);
      // a flow that says what "something happens" is for it (kit/loops/<id> → signs.pulse: in a turn-taking game, moves
      // played in turn) is judged by that, on the solo round; a timed round by its scores, below
      const fpulse = flowPulse(game, sr);
      if (fpulse) add(12, 'something happens', fpulse.ok, fpulse.ok
        ? `${fpulse.pulse.what}: ${fpulse.n} in the solo round (the ${fpulse.flow} flow's own sign, needs ${fpulse.pulse.min}); results ${vals.join('/') || '—'}`
        : `${fpulse.pulse.what}: ${fpulse.n} in the solo round with bots (needs ${fpulse.pulse.min}; the ${fpulse.flow} flow's own sign, snapshot().flow ${JSON.stringify(sr?.flow ?? null).slice(0, 200)}). The game does nothing a player can see. ${fpulse.pulse.fix}`,
        { seconds: 0, from: 'the solo round' });
      const ok = soloMoved || fairMoved;
      if (!fpulse) add(12, 'something happens', ok, ok
        ? `scores moved: solo round ${vals.join('/') || '—'}; fair-play pages max score ${pages.map(pg => pg.maxScore ?? 0).join(', ')}, held moved ${pages.map(pg => `${pg.scoreHeldSec ?? 0} s`).join(', ')}`
        : `no score moved, built up to 2 and stayed (≥ 1.5 s) in ${1 + pages.length} rounds with 3 bots (solo results ${vals.join('/') || 'none'}; fair-play pages ${pages.map(pg => `${pg.mode} ${pg.observed} s`).join(', ')}; ${pages.reduce((n, pg) => n + (pg.knocks ?? 0), 0)} knocks). ` +
          'The game does nothing a player can see. Check the score code in rules.update against each mechanic\'s API in its README (e.g. paint.coverageOf(owner) returns a share 0..1, not an object; paint.coverage() lists {owner, cells, share}); ' +
          'check that rules.bot makes bots act (ctx.bots.target / attack, p.bot.seek, holding primary) and that scoring does not depend on a score that starts at 0 (stealing from nobody). Play ?bots=3&seed=1 and watch the scoreboard.',
        { seconds: 0, from: 'the solo round and check 10\'s two pages' });
    }
    // ---- 15. the loop is alive: every page's recording, the undefended page and the first look ----
    if (want(15)) {
      if (und?.error) rec.notes.push(`check 15's undefended page stopped: ${und.error}`);
      const al = judgeAlive({ game, world, pages: recordings, firstLook: look, aim: und?.aim ?? null });
      rec.alive = { goal: al.goal, firstLook: look, aim: und?.aim ?? null, undefendedSeconds: und?.seconds ?? null, pages: recordings.map(r => ({ label: r.label, samples: r.samples.length })), items: al.items };
      add(15, 'the loop is alive', al.ok, al.detail, { seconds: 0, from: 'the recordings of every page above and the undefended page' });
    }
    // ---- 5. the two-player live gate ---- (running beside this session since it started; awaited below)
    solo = { errors: S?.errors ?? [], sr, replayed, audio };
  } catch (e) {
    rec.notes.push(`solo session stopped: ${e.message}`);
    for (const [n, name] of [[3, 'boots to play with no console errors'], [4, 'slot coverage 100%'], [8, 'swap proof'], [10, 'fair play'], [12, 'something happens'], [13, 'controls work'], [15, 'the loop is alive'], [16, 'hits read'], [20, 'the menu works'], [21, 'the HUD shows your state'], [22, 'the wallet in the menu'], [24, 'plays inside a post'], [31, 'sharp on every screen'], [35, 'the game\'s own tests']]) if (want(n) && !checks.some(c => c.n === n)) add(n, name, false, `not reached: ${e.message}${solo?.errors?.length ? `; console: ${solo.errors.slice(0, 2).join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
    await srv.close().catch(() => {});
  }
  lap('solo session', t0);
  }
  const NOT_LIVE = `multiplayer.json mode is ${mpm.manifest?.mode ?? 'missing'}, not live`;
  if (duo) {
    const d = await duo;
    lap('solo session and the gate (side by side)', t0);
    gateRec = d.gateRec ?? null;
    const failed = (gateRec?.checks ?? []).filter(c => !c.ok);
    if (gateRec) rec.gate = { verdict: gateRec.verdict, passed: gateRec.passed, total: gateRec.total, run: gateRec.run ?? null, ...(gateRec.legs ? { legs: gateRec.legs } : {}), failed: failed.map(c => `${c.name}${c.soft ? ' (soft)' : ''}: ${c.detail}`) };
    const gateLine = gateRec ? `${gateRec.verdict} ${gateRec.passed ?? 0}/${gateRec.total ?? 0}${gateRec.run ? ` (${gateRec.run})` : ''}${failed.length ? `; failed: ${failed.slice(0, 3).map(c => c.name).join(', ')}` : ''}` : '';
    if (want(5)) {
      const lo = d.lo;
      rec.loadouts = lo.record ? { ok: lo.ok, steps: lo.record.steps, shots: lo.record.shots } : { ok: false, detail: lo.detail };
      rec.notes.push(...lo.warnings);
      add(5, 'two-player live gate', gateRec.verdict === 'pass' && lo.ok, `${gateLine}; ${lo.detail}`, { seconds: d.seconds.gate + d.seconds.loadouts });
    } else if (lobbyOnly) {
      // the profile keeps the lobby legs: a failure there fails the check; passing them is never a pass of check 5
      const why = skipBy.get(5).reason;
      add(5, 'two-player live gate', gateRec.verdict === 'pass' ? null : false, gateRec.verdict === 'pass'
        ? `skipped by profile ${profile.name} after the lobby legs passed (${gateLine}): ${why}`
        : `the lobby legs failed (${gateLine}); the in-round legs and the loadout leg were skipped by profile ${profile.name}`, { skippedBy: 'profile', reason: why, legs: 'lobby' });
    }
    if (want(25)) {
      const fr = d.fr;
      rec.friends = fr.record; if (fr.warnings?.length) rec.notes.push(...fr.warnings);
      add(25, 'playing with friends', fr.ok, fr.detail, { seconds: d.seconds.friends });
    }
    if (want(34)) {
      const wa = d.wa;
      rec.watch = wa.record; if (wa.warnings?.length) rec.notes.push(...wa.warnings);
      add(34, 'watch then play', wa.ok, wa.detail, { seconds: d.seconds.watch });
    }
  } else if (!live) {
    for (const [n, name] of [[5, 'two-player live gate'], [25, 'playing with friends'], [34, 'watch then play']]) if (want(n) || (n === 5 && lobbyOnly)) add(n, name, false, NOT_LIVE, { seconds: 0 });
  }

  // ---- 6. a round to results and replay: alone and with two players ----
  const g = name => (gateRec?.checks ?? []).find(c => c.name === name)?.ok === true;
  const soloOk = !!(solo?.sr && solo.sr.phase === 'results' && solo.sr.results?.length && solo.replayed);
  const duoOk = g('both-see-the-same-results') && g('play-again-starts-a-new-round') && g('host-ends-the-round');
  if (want(6) && !checks.some(c => c.n === 6)) add(6, 'a round reaches results and replays', soloOk && duoOk, `alone with 3 bots: ${soloOk ? `results (${(solo.sr.results ?? []).map(r => `${r.name} ${r.value}`).join(', ')}), Play again → round 2` : 'did not reach results and a second round'}; two players: ${duoOk ? 'the same results on both, play again, the host ends round 2' : 'the gate did not show results, play again and end round'}`, { seconds: soloSeconds, shares: 'the solo round, with 3 and 7, and the gate\'s results (check 5)' });
  // ---- 7. audio ----
  if (want(7) && !checks.some(c => c.n === 7)) {
    const a = solo?.audio;
    add(7, 'audio gate v4', !!(a && a.ok && a.heard), a ? `${a.heard ? 'heard' : 'nothing heard'}${a.mix ? `, ${a.mix.integratedLufs?.toFixed?.(1) ?? a.mix.integrated ?? '?'} LUFS integrated, peak ${a.mix.truePeakDb?.toFixed?.(1) ?? '?'} dBTP` : ''}; ${a.problems.length ? a.problems.join('; ') : 'within the targets'}` : 'not measured', { seconds: soloSeconds, shares: 'the solo round, with 3 and 6' });
  }

  // ---- 9. contact sheet and perf (track L's capture tool) ----
  const capture = join(GF3, 'lookdev/capture.mjs');
  if (!want(9)) {}
  else if (quick) add(9, 'contact sheet and perf', null, '--quick');
  else if (!existsSync(capture)) {
    // a checkout without the lookdev folder (a packaged copy of the tools): say so in the check and in the notes, so a
    // reader of the verdict never takes a full verify for one that measured the frame rate
    const absent = 'not run: the contact-sheet tool (research/gf-three/lookdev/capture.mjs) is not in this checkout, so this full verify made no contact sheet and measured no frame rate';
    add(9, 'contact sheet and perf', null, absent, { absent: true });
    rec.notes.push(`check 9 ${absent}`);
  }
  else {
    const t9 = Date.now(); begin(9);
    const r = await run(process.execPath, [capture, dir, '--out', join(outDir, 'sheet'), '--query', 'bots=3&seed=7&gf-autoplay=1&gf-ui=0'], 600000);
    add(9, 'contact sheet and perf', r.code === 0, r.code === 0 ? `sheet in ${relative(dir, join(outDir, 'sheet'))}` : `capture.mjs exit ${r.code}: ${r.tail}`);
    lap('contact sheet', t9);
  }

  // ---- 23. looks like the references: the player's own view (and the contact sheet's wide shots) beside the creator's
  // pictures (the roguelike miss, 2026-10-08: a flat green yard shipped against three pictures of floating islands) ----
  if (want(23)) {
    const t23 = Date.now(); begin(23);
    const own = ['first-look', 'mid-round', 'playing'].map(n => rec.shots.find(f => f.endsWith(`-${n}.jpg`))).filter(Boolean).map(f => join(outDir, f));
    const sheet = await sheetShots(join(outDir, 'sheet'));
    await likeness(dir, { rec, add, shots: [...own.slice(0, 2), ...sheet, ...own.slice(2)], refs });
    lap('likeness', t23);
  }

  checks.sort((a, b) => a.n - b.n);
  // the pass rule (tools/lib/verdict.mjs): every check this kind of run requires ran and passed (a build's list, or a
  // release's with 8, 31 and 34), nothing failed, and 9 counts only when it ran. A list (--check) passes when each
  // check asked for passed.
  rec.required = required;
  rec.pass = list ? list.every(n => checks.some(c => c.n === n && (c.ok === true || (n === 9 && c.ok === null)))) && checks.every(c => c.ok !== false) : passes(checks, required);
  if (profile) stampProfile(rec, profile, required);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/**
 * A profiled run's stamp: which profile, what it skipped and why, and whether everything that did run passed. `pass`
 * is forced false while a required check is skipped, so no reader (Studio's worker, own-verify) takes it for a pass.
 */
function stampProfile(rec, profile, required) {
  const skipped = rec.checks.filter(c => c.skippedBy === 'profile').map(c => ({ n: c.n, reason: c.reason ?? '', ...(c.legs ? { legs: c.legs } : {}) }));
  rec.profile = { name: profile.name, file: profile.file ?? null, environment: profile.environment ?? {}, skipped };
  rec.profilePass = profilePasses(rec.checks, required);
  if (skipped.some(x => required.includes(x.n))) rec.pass = false;
}

// ---- 1. manifests ----
async function check1(dir, { rec, add, mpm = null }) {
  const v = await validateGame(dir);
  mpm ??= await readManifest(dir);
  const mv = mpm.error ? { ok: false, problems: [`multiplayer.json is ${mpm.error}`] } : validateMultiplayer(mpm.manifest);
  const live = mpm.manifest?.mode === 'live';
  add(1, 'manifests', v.ok && mv.ok && live, [v.ok ? `assets.json valid (${v.stats?.slots ?? '?'} slots, ${v.stats?.mainSlots ?? v.stats?.main ?? '?'} main)` : `assets.json: ${v.errors.slice(0, 4).join('; ')}`, mv.ok ? `multiplayer.json valid, mode ${mpm.manifest?.mode}` : `multiplayer.json: ${mv.problems.join('; ')}`].join(' · '));
  if (v.warnings?.length) rec.notes.push(`assets.json warnings: ${v.warnings.slice(0, 5).join('; ')}`);
}

// ---- 2. kit copies ----
async function check2(dir, { rec, add }) {
  const kc = await checkKitCopies(dir);
  add(2, 'kit copies unedited', kc.ok, kc.ok ? 'gf/three, gf/mp, audio, gf/gf-assets.js and vendor/ match their sources' : kc.problems.slice(0, 6).join('; '));
  rec.notes.push(...kc.notes);
}

// ---- 17. the world is complete (static, fast; creator on "Hang Up On Them", 2026-10-07) ----
async function check17(dir, { rec, add }) {
  try {
    const w = await worldCheck(dir);
    add(17, 'the world is complete', w.ok, w.detail);
    if (w.notes.length) rec.notes.push(`world notes: ${w.notes.slice(0, 4).join(' | ')}`);
    rec.world = { errors: w.report.errors, warnings: w.report.warnings, stats: w.report.stats };
  } catch (e) { add(17, 'the world is complete', false, `the world check could not run: ${e.message}`); }
}

// ---- 18. sounds play (static; creator on Token Call Centre, 2026-10-07: "I asked audio to be added to the game but it
// wasn't added at all"): every listed sound, every audio file and every id the game's code plays meet in one list ----
async function check18(dir, { rec, add }) {
  try {
    const r = await checkSounds(dir);
    add(18, 'sounds play', r.ok, r.detail);
    if (r.notes.length) rec.notes.push(`sound notes: ${r.notes.slice(0, 4).join(' | ')}`);
    rec.sounds = { problems: r.problems, stats: r.stats };
  } catch (e) { add(18, 'sounds play', false, `the sound check could not run: ${e.message}`); }
}

// ---- 19. bodies hold their shape (static; creator on Token Call Centre, 2026-10-07: "the models look good, but the hand is
// crooked"): the model judge's measuring tier on every character body, with the game's own retarget and clips ----
async function check19(dir, { rec, add }) {
  try {
    const t = Date.now();
    // the body judge is loaded here, when check 19 runs: it needs the char-deps packages (tools/lib/char-deps), and a
    // verify that does not judge bodies (--check 1,2 on a machine without them) must still load
    const { checkBodies } = await import('./lib/bodies-check.mjs');
    const r = await checkBodies(dir);
    add(19, 'bodies hold their shape', r.ok, r.detail);
    if (r.notes.length) rec.notes.push(`body notes: ${r.notes.slice(0, 4).join(' | ')}`);
    rec.bodies = r.bodies.map(({ role, file, ok, parts, worst, warnings }) => ({ role, file, ok, parts, worst, warnings }));
    rec.timing.bodies = Math.round((Date.now() - t) / 100) / 10;
  } catch (e) { add(19, 'bodies hold their shape', false, `the model judge could not run: ${e.message}`); }
}

/** --check with any of the static checks (1, 2, 11, 14, 17, 18, 19; one or several): no browser. */
const STATIC_ALONE = [1, 2, 11, 14, 17, 18, 19];
async function staticOnly(dir, list, { rec, outDir, add, t0 }) {
  if (list.includes(1)) await check1(dir, { rec, add });
  if (list.includes(2)) await check2(dir, { rec, add });
  if (list.includes(14)) await looks(dir, rec, add);
  if (list.includes(11)) {
    try { const dr = lintDressing(await loadSubject(dir)); add(11, 'set dressing', dr.errors === 0, dr.errors === 0 ? `clean: 0 errors, ${dr.warnings} warnings` : `${dr.errors} errors: ${dressingLines(dr).filter(l => l.startsWith('ERROR')).slice(0, 6).join(' | ')}`); }
    catch (e) { add(11, 'set dressing', false, `the lint could not run: ${e.message}`); }
  }
  if (list.includes(17)) await check17(dir, { rec, add });
  if (list.includes(18)) await check18(dir, { rec, add });
  if (list.includes(19)) await check19(dir, { rec, add });
  rec.checks.sort((a, b) => a.n - b.n);
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 10: fair play alone (its own browser and server), for a repair loop. */
async function fairOnly(dir, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const { browser, gpu: usedGpu } = await launchForGame(launchChrome, dir); rec.renderer = usedGpu;
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null, realLock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
    await lockFor(page, usedGpu, { realLock });
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    return { ctx, page, errors };
  };
  try {
    const fp = await checkFairPlay({ newPage, url: srv.url, log });
    rec.fair = fp.record; if (fp.warnings.length) rec.notes.push(...fp.warnings);
    add(10, 'fair play', fp.ok, fp.detail);
  } catch (e) { add(10, 'fair play', false, `not reached: ${e.message}`); }
  finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Check 23 (tools/lib/likeness-check.mjs): the game's shots against the creator's reference pictures. */
async function likeness(dir, { rec, add, shots, refs }) {
  try {
    const r = await checkLikeness(dir, { shots, refs });
    rec.likeness = r.record; rec.notes.push(...r.notes);
    add(23, 'looks like the references', r.ok, r.detail);
  } catch (e) { add(23, 'looks like the references', false, `the check could not run: ${e.message}`); }
}
/** The contact sheet's full-size wide and hero frames (lookdev/capture.mjs raw/), when check 9 ran. */
async function sheetShots(sheetDir) {
  let names = [];
  try { names = await readdir(join(sheetDir, 'raw')); } catch { return []; }
  const pick = shot => names.find(n => n.includes(`--${shot}--1920x1080`));
  return ['wide', 'hero'].map(pick).filter(Boolean).map(n => join(sheetDir, 'raw', n));
}

/**
 * --check 23: looks like the references alone. With no references it answers at once (no browser); else a solo page
 * with 3 bots, Play, the first look, a walk, mid-round, then the judge (about a minute and one look).
 */
async function likenessOnly(dir, { rec, outDir, add, log, t0, refs }) {
  const t = await likenessTargets(dir, { refs });
  const shots = [];
  if (t.targets.length) {
    const srv = await startParty({ dir, port: 0 });
    const { browser, gpu: usedGpu, note } = await launchForGame(launchChrome, dir);
    rec.chrome = browser.version(); rec.renderer = usedGpu; if (note) rec.notes.push(note);
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await ctx.newPage();
      const snapOf = () => page.evaluate(() => window.__game?.snapshot?.() ?? null);
      const shot = async name => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 80 }).catch(() => {}); shots.push(join(outDir, f)); };
      await page.goto(`${srv.url}?seed=7&bots=3&gf-calm=6`, { waitUntil: 'load' });
      await until(async () => (await snapOf())?.phase === 'lobby', 90000, 'the lobby');
      const play = await page.locator('#gf-play').boundingBox();
      await page.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
      await until(async () => (await snapOf())?.phase === 'playing', 15000, 'the round to start');
      await sleep(1500); await shot('first-look');
      await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW');
      await sleep(3000); await shot('mid-round');
      await ctx.close();
    } catch (e) { rec.notes.push(`check 23's page stopped: ${e.message}`); log(`  likeness page: ${e.message}`); }
    finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  }
  await likeness(dir, { rec, add, shots, refs });
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Check 14 (tools/lib/looks-check.mjs): generated and reference looks are not stand-ins; roles do not share a body. */
async function looks(dir, rec, add) {
  try { const lk = await checkLooks(dir); rec.looks = lk.record; rec.notes.push(...lk.notes); add(14, 'looks honoured', lk.ok, lk.detail); }
  catch (e) { add(14, 'looks honoured', false, `the check could not run: ${e.message}`); }
}
/** Check 13's evidence: a live screenshot, or a frame it already took (PNG bytes). */
function controlsShot(shot, outDir, rec) {
  return async (page, name, buf = null) => {
    if (!buf) return shot(page, name);
    const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.png`; rec.shots.push(f);
    await writeFile(join(outDir, f), buf).catch(() => {});
    return f;
  };
}

/** --check 13: controls alone (its own browser and server), for a repair loop. */
async function controlsOnly(dir, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const { browser, gpu: usedGpu } = await launchForGame(launchChrome, dir); rec.renderer = usedGpu;
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null, realLock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
    await lockFor(page, usedGpu, { realLock });
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    return { ctx, page, errors };
  };
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };
  try {
    const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
    const cc = await checkControls({ newPage, browser, url: srv.url, game, log, shot: controlsShot(shot, outDir, rec) });
    rec.controls = cc.record; if (cc.warnings.length) rec.notes.push(...cc.warnings);
    add(13, 'controls work', cc.ok, cc.detail);
  } catch (e) { add(13, 'controls work', false, `not reached: ${e.message}`); }
  finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/**
 * --check 15: the loop alone (its own browser and server), for a repair loop: a 25 s round with 3 bots as the solo
 * round plays it (the first look at round start, then the player waits) and, beside it, the undefended page.
 */
async function aliveOnly(dir, { rec, outDir, add, log, t0, lap }) {
  const srv = await startParty({ dir, port: 0 });
  const { browser, gpu: usedGpu } = await launchForGame(launchChrome, dir); rec.renderer = usedGpu;
  rec.chrome = browser.version();
  const recordings = [];
  const newPage = async (label, { overrides = null, realLock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
    await lockFor(page, usedGpu, { realLock });
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    await page.addInitScript(RECORDER);
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => { const r = await recordingOf(page); if (r?.samples?.length) recordings.push({ label, samples: r.samples }); return close(...a); };
    return { ctx, page, errors };
  };
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };
  const phase = page => page.evaluate(() => window.__game?.phase ?? null).catch(() => null);
  try {
    const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
    const world = JSON.parse(await readFile(join(dir, 'config/world.json'), 'utf8').catch(() => '{}'));
    const W = goalOf(game, world).waves;
    let look = null;
    const withBots = (async () => {
      const t = Date.now(), roundSeconds = 25;
      const T = await newPage('solo', { overrides: { patches: shortRound(game, roundSeconds) } });
      try {
        await T.page.goto(`${srv.url}?seed=7&bots=3&gf-calm=6`, { waitUntil: 'load' });
        await until(async () => (await phase(T.page)) === 'lobby', 90000, 'the lobby');
        const play = await T.page.locator('#gf-play').boundingBox();
        await T.page.mouse.click(play.x + play.width / 2, play.y + play.height / 2);
        await until(async () => (await phase(T.page)) === 'playing', 15000, 'the round to start');
        look = await firstLook(T.page, game, world);
        await shot(T.page, 'first-look');
        await T.page.mouse.click(640, 400);
        await until(async () => (await phase(T.page)) === 'results', (roundSeconds + 20) * 1000, 'the results').catch(() => {});
        await shot(T.page, 'results');
      } finally { await T.ctx.close().catch(() => {}); lap('round with bots', t); }
    })();
    const t = Date.now();
    const [, und] = await Promise.all([withBots, W ? undefended({ newPage, url: srv.url, game, world, shot, log }) : null]);
    if (W) lap('undefended page', t);
    const al = judgeAlive({ game, world, pages: recordings, firstLook: look, aim: und?.aim ?? null });
    rec.alive = { goal: al.goal, firstLook: look, aim: und?.aim ?? null, undefendedSeconds: und?.seconds ?? null, pages: recordings.map(r => ({ label: r.label, samples: r.samples.length })), items: al.items };
    add(15, 'the loop is alive', al.ok, al.detail);
  } catch (e) { add(15, 'the loop is alive', false, `not reached: ${e.message}`); }
  finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 16: hits read alone (its own browser and server), for a repair loop. */
async function hitsOnly(dir, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const { browser, gpu: usedGpu } = await launchForGame(launchChrome, dir); rec.renderer = usedGpu;
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null, realLock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
    await lockFor(page, usedGpu, { realLock });
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    return { ctx, page, errors };
  };
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };
  try {
    const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
    const hc = await checkHits({ newPage, browser, url: srv.url, game, dir, log, shot: controlsShot(shot, outDir, rec) });
    rec.hits = hc.record; if (hc.warnings.length) rec.notes.push(...hc.warnings);
    add(16, 'hits read', hc.ok, hc.detail);
  } catch (e) { add(16, 'hits read', false, `not reached: ${e.message}`); }
  finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 20, 21, 22, 24 or 31: the menu, the HUD, the wallet, the post or the screens alone (its own browser and server), for a repair loop. */
async function menuOnly(dir, n, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const { browser, gpu: usedGpu } = await launchForGame(launchChrome, dir); rec.renderer = usedGpu;
  rec.chrome = browser.version();
  const newPage = async label => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    return { ctx, page, errors };
  };
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };
  const name = { 20: 'the menu works', 21: 'the HUD shows your state', 22: 'the wallet in the menu', 24: 'plays inside a post', 31: 'sharp on every screen' }[n];
  try {
    const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
    const r = n === 20 ? await checkMenu({ newPage, url: srv.url, game, log, shot }) : n === 21 ? await checkHud({ newPage, url: srv.url, game, log, shot }) : n === 24 ? await checkEmbed({ newPage, url: srv.url, game, log, shot }) : n === 31 ? await checkScreens({ browser, url: srv.url, log }) : await checkWallet({ newPage, url: srv.url, log, shot });
    rec[{ 20: 'menu', 21: 'hud', 22: 'wallet', 24: 'embed', 31: 'screens' }[n]] = r.record; if (r.warnings.length) rec.notes.push(...r.warnings);
    add(n, name, r.ok, r.detail);
  } catch (e) { add(n, name, false, `not reached: ${e.message}`); }
  finally { await browser.close().catch(() => {}); await srv.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** The game's promise list for check 35 (tools/lib/promises.mjs), or null when it cannot be derived here. */
async function ownPromiseList(dir) {
  try { return await (await import('./lib/promises.mjs')).promisesFor(dir); } catch { return null; }
}

/** --check 35: the game's own tests alone (its own browser and server; none when the game has no tests), for a repair loop. */
async function ownTestsOnly(dir, { rec, outDir, add, log, t0, ownTests }) {
  const promises = await ownPromiseList(dir), requireTests = ownTests === 'require';
  let srv = null, browser = null;
  try {
    // a game with no test files is judged with no browser
    const any = existsSync(join(dir, 'tests')) && (await readdir(join(dir, 'tests'))).some(n => n.endsWith('.test.json'));
    if (!any) {
      const dry = await checkGameTests({ dir, promises, requireTests });
      rec.gameTests = dry.record; add(35, 'the game\'s own tests', dry.ok, dry.detail);
    } else {
      srv = await startParty({ dir, port: 0 });
      const launched = await launchForGame(launchChrome, dir); browser = launched.browser; const usedGpu = launched.gpu; rec.renderer = usedGpu;
      rec.chrome = browser.version();
      const newPage = async (label, { overrides = null, realLock = false } = {}) => {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
            const page = await ctx.newPage(); const errors = [];
        await lockFor(page, usedGpu, { realLock });
        page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
        if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
        return { ctx, page, errors };
      };
      const gt = await checkGameTests({ dir, newPage, url: srv.url, promises, requireTests, log });
      rec.gameTests = gt.record; if (gt.warnings.length) rec.notes.push(...gt.warnings);
      add(35, 'the game\'s own tests', gt.ok, gt.detail);
    }
  } catch (e) { add(35, 'the game\'s own tests', false, `not reached: ${e.message}`); }
  finally { await browser?.close().catch(() => {}); await srv?.close().catch(() => {}); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 34: watch then play alone (its own browser and server), for a repair loop. */
async function watchOnly(dir, { rec, outDir, add, log, t0 }) {
  try {
    const r = await checkFriendsWatch({ dir, outDir, shots: rec.shots, log });
    rec.watch = r.record; if (r.warnings.length) rec.notes.push(...r.warnings);
    add(34, 'watch then play', r.ok, r.detail);
  } catch (e) { add(34, 'watch then play', false, `not reached: ${e.message}`); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 25: playing with friends alone (its own browser and server), for a repair loop. */
async function friendsOnly(dir, { rec, outDir, add, log, t0 }) {
  try {
    const r = await checkFriends({ dir, outDir, shots: rec.shots, log });
    rec.friends = r.record; if (r.warnings.length) rec.notes.push(...r.warnings);
    add(25, 'playing with friends', r.ok, r.detail);
  } catch (e) { add(25, 'playing with friends', false, `not reached: ${e.message}`); }
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relPosix(dir, outDir);   // relative to the game, forward slashes
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Map over items, at most n at a time, keeping the order. */
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}

function run(cmd, args, timeout) {
  return new Promise(res => {
    const c = spawn(cmd, args, { cwd: REPO }); let tail = '';
    const t = setTimeout(() => c.kill('SIGTERM'), timeout);
    const keep = d => { tail = (tail + d).slice(-600); };
    c.stdout.on('data', keep); c.stderr.on('data', keep);
    c.on('close', code => { clearTimeout(t); res({ code, tail: tail.trim().split('\n').slice(-3).join(' | ') }); });
  });
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

if (isMain(import.meta)) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--out', '--check', '--refs', '--profile', '--own-tests'].includes(a[i - 1]));
  if (!dir) { console.error('usage: verify.mjs <game> [--quick] [--all] [--release] [--profile <file>] [--check N[,N…]] [--out <dir>] [--json] [--refs <folder with refs.json>] [--own-tests require]'); process.exit(2); }
  const json = a.includes('--json');
  const ck = opt('--check', null);
  if (ck !== null && !/^\d+(,\d+)*$/.test(ck ?? '')) { console.error('--check takes a check number or a list of them (13 or 1,2 or 13,16)'); process.exit(2); }
  const nums = ck === null ? null : [...new Set(ck.split(',').map(Number))];
  const only = nums === null ? null : nums.length === 1 ? nums[0] : nums;
  // a world (CONTRACT §9) runs any of its checks alone or together: --check 26 or --check 13,26,30
  const worldGame = JSON.parse(await readFile(join(resolve(dir), 'config/game.json'), 'utf8').catch(() => '{}')).round?.mode === 'world';
  // a forge game (CONTRACT §8 forge) runs any of its checks alone or together, its own 32 and 33 among them (and
  // since gf-forge wave 4, 34: watch then play)
  const forgeGame = await engineOfGame(resolve(dir)) === 'forge';
  if (forgeGame && nums && !nums.every(n => n >= 1 && n <= 34)) { console.error('--check takes check numbers 1 to 34 (one, or several: 3,32,34)'); process.exit(2); }
  if (worldGame && nums && !nums.every(n => n >= 1 && n <= 34)) { console.error('--check takes check numbers 1 to 31 and 34 (one, or several: 13,26,30)'); process.exit(2); }
  const roundChecks = [...requiredFor('round', { release: true }), 9];
  if (!worldGame && !forgeGame && nums && !nums.every(n => roundChecks.includes(n))) { console.error(`--check takes the checks of a round game (1 to 25, 31, 34 and 35), one or several: 13 or 1,2 or 13,16. Not one: ${nums.filter(n => !roundChecks.includes(n)).join(', ')}`); process.exit(2); }
  let profile = null;
  if (a.includes('--profile')) {
    const pf = opt('--profile', null);
    try { profile = { ...JSON.parse(await readFile(resolve(pf ?? ''), 'utf8')), file: basename(pf ?? '') }; } catch (e) { console.error(`--profile: cannot read ${pf}: ${e.message}`); process.exit(2); }
    const bad = checkProfile(profile);
    if (bad.length) { console.error(`--profile ${pf}: ${bad.join('; ')}`); process.exit(2); }
  }
  const rec = await verify(dir, { quick: a.includes('--quick'), out: opt('--out', null), log: json ? () => {} : console.log, only, refs: opt('--refs', null), release: a.includes('--release'), profile, all: a.includes('--all') || a.includes('--verbose'), ownTests: opt('--own-tests', null) });
  if (json) process.stdout.write(JSON.stringify(rec, null, 2) + '\n');
  const passed = rec.checks.filter(c => c.ok === true).length, ran = rec.checks.filter(c => c.ok !== null).length;
  const byProfile = (rec.profile?.skipped ?? []).map(c => c.n);
  const skipped = rec.checks.filter(c => c.ok === null && !c.notYet && !byProfile.includes(c.n)).map(c => c.n);
  const notYet = (rec.notYet ?? []).map(c => c.n);
  if (notYet.length) console.log(`not yet for forge: ${notYet.join(', ')} (each with its reason in verdict.json → notYet)`);
  if (rec.profile) console.log(`skipped by profile ${rec.profile.name}: ${byProfile.join(', ') || 'nothing'} (each with its reason in verdict.json → profile.skipped)`);
  const profileOk = !!rec.profile && !rec.pass && rec.profilePass;
  const word = rec.pass ? 'PASS' : profileOk ? `PROFILE ${rec.profile.name} OK (not a full pass)` : 'FAIL';
  console.log(`verify ${relative(process.cwd(), resolve(dir)) || '.'}: ${word} ${passed}/${ran}${skipped.length ? ` (skipped ${skipped.join(', ')})` : ''}${rec.pass || profileOk ? '' : ` failed: ${rec.checks.filter(c => c.ok === false).map(c => c.n).join(', ')}`} in ${rec.seconds} s → ${relPosix(process.cwd(), resolve(resolve(dir), rec.outDir, 'verdict.json'))}`);
  process.exitCode = rec.pass || profileOk ? 0 : 1;
}
