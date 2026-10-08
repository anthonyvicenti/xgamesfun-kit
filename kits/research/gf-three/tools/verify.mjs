#!/usr/bin/env node
// gf-three verify: is this game good? One command, one verdict (CONTRACT §5).
//
//   node research/gf-three/tools/verify.mjs <game> [--quick] [--out <dir>] [--json] [--check 10|13|14|15|16]
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
//
// --check 10, 13, 14, 15 or 16 runs that check alone (a quick repair loop); --check 17, --check 11 or --check 11,17 runs
// the static checks alone (no browser, about a second). Evidence: <game>/evidence/verify-N/ (or --out):
// verdict.json (with `timing`, seconds per step), screenshots, the gate's own record. Append-only. The two-player gate
// and its loadout leg run in their own browser beside the solo session. Exit 0 when every check REQUIRED in
// tools/lib/verdict.mjs passes (9 counts when run).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, GF3, LIBRARY, STANDIN_ASSETS, KIT_VERSION } from './lib/paths.mjs';
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
import { passes } from './lib/verdict.mjs';
import { checkLooks } from './lib/looks-check.mjs';
import { worldCheck } from './lib/world-check.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(150); } }

export async function verify(gameDir, { quick = false, out = null, log = console.log, only = null } = {}) {
  const dir = resolve(gameDir);
  const t0 = Date.now();
  const checks = [];
  const add = (n, name, ok, detail = '', extra = {}) => { checks.push({ n, name, ok: ok === null ? null : !!ok, detail: String(detail ?? '').slice(0, 1800), ...extra }); log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${n} ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`); return !!ok; };
  // evidence folder: the next free verify-N
  let outDir = out ? resolve(out) : null;
  if (!outDir) { const root = join(dir, 'evidence'); await mkdir(root, { recursive: true }); const taken = new Set(await readdir(root)); let n = 1; while (taken.has(`verify-${n}`)) n++; outDir = join(root, `verify-${n}`); }
  await mkdir(outDir, { recursive: true });
  const rec = { schema: 'gf-three-verify/1', game: relative(REPO, dir), kit: KIT_VERSION, quick, ...(only ? { only } : {}), started: new Date().toISOString(), checks, notes: [], shots: [], timing: {} };
  const lap = (name, since) => { rec.timing[name] = Math.round((Date.now() - since) / 100) / 10; };   // seconds per step
  rec.gameFiles = await gameFingerprint(dir).catch(() => null);   // the files the agent tunes, as verified (own-verify.mjs)
  if (only === 10) return fairOnly(dir, { rec, outDir, add, log, t0 });
  if (only === 13) return controlsOnly(dir, { rec, outDir, add, log, t0 });
  if (only === 14) return looksOnly(dir, { rec, outDir, add, t0 });
  if (only === 15) return aliveOnly(dir, { rec, outDir, add, log, t0, lap });
  if (only === 16) return hitsOnly(dir, { rec, outDir, add, log, t0 });
  if (only !== null && [].concat(only).every(n => STATIC_ALONE.includes(n))) return staticOnly(dir, [].concat(only), { rec, outDir, add, t0 });

  // ---- 1. manifests ----
  const v = await validateGame(dir);
  const mpm = await readManifest(dir);
  const mv = mpm.error ? { ok: false, problems: [`multiplayer.json is ${mpm.error}`] } : validateMultiplayer(mpm.manifest);
  const live = mpm.manifest?.mode === 'live';
  add(1, 'manifests', v.ok && mv.ok && live, [v.ok ? `assets.json valid (${v.stats?.slots ?? '?'} slots, ${v.stats?.mainSlots ?? v.stats?.main ?? '?'} main)` : `assets.json: ${v.errors.slice(0, 4).join('; ')}`, mv.ok ? `multiplayer.json valid, mode ${mpm.manifest?.mode}` : `multiplayer.json: ${mv.problems.join('; ')}`].join(' · '));
  if (v.warnings?.length) rec.notes.push(`assets.json warnings: ${v.warnings.slice(0, 5).join('; ')}`);

  // ---- 2. kit copies ----
  const kc = await checkKitCopies(dir);
  add(2, 'kit copies unedited', kc.ok, kc.ok ? 'gf/three, gf/mp, audio, gf/gf-assets.js and vendor/ match their sources' : kc.problems.slice(0, 6).join('; '));
  rec.notes.push(...kc.notes);

  // ---- 11. set dressing (static, fast; creator feedback on Bladder Wars, 2026-10-06: "maybe some cleanup on the assets") ----
  try {
    const dr = lintDressing(await loadSubject(dir));
    const ls = dressingLines(dr);
    add(11, 'set dressing', dr.errors === 0, dr.errors === 0
      ? `clean: 0 errors, ${dr.warnings} warnings, open floor ${(dr.stats.openFloor * 100).toFixed(0)}%`
      : `${dr.errors} errors (fix in config/world.json and the slots named; node ${join(GF3, 'tools/dressing.mjs')} <game> lists them all): ${ls.filter(l => l.startsWith('ERROR')).slice(0, 6).join(' | ')}`);
    if (dr.warnings) rec.notes.push(`set dressing warnings: ${ls.filter(l => l.startsWith('warn')).slice(0, 6).join(' | ')}`);
    rec.dressing = { errors: dr.errors, warnings: dr.warnings, stats: dr.stats };
  } catch (e) { add(11, 'set dressing', false, `the lint could not run: ${e.message}`); }
  // ---- 14. looks honoured (static; creator on Hang Up On Them, 2026-10-07: "the final assets look nothing like the reference image") ----
  await looks(dir, rec, add);
  await check17(dir, { rec, add });

  // ---- 5. the two-player live gate and its loadout leg: their own server and browsers, beside the solo session ----
  // (they share nothing with it; run one after the other they were 80 of verify's 183 s with --quick, 2026-10-07)
  const duo = live ? (async () => {
    const t = Date.now();
    const g = await gate(dir, { out: outDir, seconds: 75, log: line => log(`  gate ${line}`) }).catch(e => ({ verdict: 'fail', checks: [{ name: 'run', ok: false, detail: e.message }] }));
    lap('gate', t);
    const t2 = Date.now();
    // the loadout leg (CONTRACT §6e, tools/lib/loadout-check.mjs): each screen draws the other player in their own look
    const lo = await checkLoadouts({ dir, outDir, shots: rec.shots, log: line => log(`  ${line}`) }).catch(e => ({ ok: false, detail: `loadouts: ${e.message}`, record: null, warnings: [] }));
    lap('loadouts', t2);
    return { gateRec: g, lo };
  })() : null;

  // ---- 3, 4, 6 (alone), 7, 8, 10, 12, 13, 15: one solo session with bots, real input ----
  const assets = JSON.parse(await readFile(join(dir, 'assets.json'), 'utf8'));
  const srv = await startParty({ dir, port: 0 });
  // Gameplay checks run on the real GPU when there is one (WebGL through ANGLE; Chrome falls back to SwiftShader on a
  // machine without one, e.g. a GPU-less worker container). SwiftShader made a paint-and-stream game run at about 4 fps,
  // so its round never reached results (Studio v2 T1 run 4). GF_VERIFY_SOFTWARE=1 forces software rendering.
  let tStep = Date.now();
  const browser = await launchChrome(process.env.GF_VERIFY_SOFTWARE ? {} : { gpu: 'webgl' });
  rec.chrome = browser.version();
  rec.renderer = process.env.GF_VERIFY_SOFTWARE ? 'software' : 'gpu (webgl) when available';
  const shot = async (page, name) => { const f = `${String(rec.shots.length + 1).padStart(2, '0')}-${name}.jpg`; rec.shots.push(f); await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {}); return f; };   // the name is taken before the await (shots run in parallel)
  // every page records the observation for check 15 (alive-check.mjs RECORDER) and hands it over when it closes
  const recordings = [];
  const newPage = async (label, { overrides = null, audio = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) errors.push(`${label}: ${m.text().slice(0, 300)}`); });
    if (overrides) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, overrides);
    if (audio) await installAudioTap(page);
    await page.addInitScript(RECORDER);
    const close = ctx.close.bind(ctx);
    ctx.close = async (...a) => { const r = await recordingOf(page); if (r?.samples?.length) recordings.push({ label, samples: r.samples }); return close(...a); };
    return { ctx, page, errors };
  };
  const game = JSON.parse(await readFile(join(dir, 'config/game.json'), 'utf8'));
  const world = JSON.parse(await readFile(join(dir, 'config/world.json'), 'utf8').catch(() => '{}'));
  let look = null;
  const snap = page => page.evaluate(() => window.__game?.snapshot?.() ?? null);
  const roundSeconds = 25;
  let solo = null, gateRec = null;
  try {
    // the solo round: real clicks and keys; a 25 s round through Studio's own override mechanism
    const S = await newPage('solo', { audio: true, overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: roundSeconds }] } });
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
    const cov = [];
    for (let i = 0; i < 3; i++) { cov.push(await p.evaluate(() => window.__game.coverage())); await sleep(2500); }
    await shot(p, 'mid-round');
    await until(async () => (await snap(p))?.phase === 'results', (roundSeconds + 20) * 1000, 'the results');
    const sr = await snap(p);
    await shot(p, 'results');
    const again = await p.locator('#gf-again').boundingBox().catch(() => null);
    if (again) await p.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
    const replayed = await until(async () => { const s = await snap(p); return s && s.round === 2 && ['countdown', 'playing'].includes(s.phase) ? s : null; }, 10000, 'round 2').catch(() => null);
    await until(async () => (await snap(p))?.phase === 'playing', 8000, 'round 2 to play').catch(() => {});
    await sleep(1500);
    await shot(p, 'round-2');
    const audio = await audioReport(p);
    rec.solo = { moved: +moved.toFixed(2), results: sr.results, winners: sr.winners, coverage: cov.map(c => ({ meshes: c.meshes, tagged: c.tagged, exempt: c.exempt, untagged: c.untagged.length, unknownSlots: c.unknownSlots })), audio: { ok: audio.ok, heard: audio.heard, problems: audio.problems, mix: audio.mix, maxSoundsPer100ms: audio.maxSoundsPer100ms, hidden: audio.hidden } };
    add(3, 'boots to play with no console errors', S.errors.length === 0 && moved > 0.5, `${S.errors.length ? `console errors: ${[...new Set(S.errors)].slice(0, 3).join(' | ')}` : 'no console errors'}; the player walked ${moved.toFixed(2)} m on real keys${walkTries > 1 ? ' (second try)' : ''}; ${s1.players.length} players`);
    lap('solo round', tStep); tStep = Date.now();
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

    // ---- 8. swap proof: a body and a prop replaced the way Studio does it ----
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
      return { slot: slot.id, file: relative(REPO, file), ok, before: before.st, after: after.st, pixelsChanged: +diff.toFixed(3), errors: after.T.errors.slice(0, 3), shots: [f1, f2] };
    });
    rec.swaps = swaps;
    add(8, 'swap proof', swaps.length === 2 && swaps.every(s => s.ok), swaps.map(s => s.ok ? `${s.slot}: ${s.before.triangles} → ${s.after.triangles} triangles, on screen, ${(s.pixelsChanged * 100).toFixed(1)}% of pixels changed` : `${s.slot}: ${s.why ?? `not shown (${JSON.stringify(s.after)}${s.errors?.length ? `; ${s.errors[0]}` : ''})`}`).join(' · '));
    lap('swaps', tStep); tStep = Date.now();

    // ---- 13. controls work: each listed control, from the player's own view (a page of its own, no bots) ----
    await S.ctx.close();
    {
      const cc = await checkControls({ newPage, browser, url: srv.url, game, log, shot: controlsShot(shot, outDir, rec) });
      rec.controls = cc.record;
      if (cc.warnings.length) rec.notes.push(...cc.warnings);
      add(13, 'controls work', cc.ok, cc.detail);
      // ---- 16. hits read: shoot an enemy from the player's own view (a page of its own, no bots) ----
      const hc = await checkHits({ newPage, browser, url: srv.url, game, dir, log, shot: controlsShot(shot, outDir, rec) });
      rec.hits = hc.record;
      if (hc.warnings.length) rec.notes.push(...hc.warnings);
      add(16, 'hits read', hc.ok, hc.detail);
    }
    lap('controls', tStep); tStep = Date.now();
    // ---- 10. fair play: a scripted human vs 3 bots, for real (no gf-calm); beside it, check 15's undefended page ----
    const W = goalOf(game, world).waves;
    const [fp, und] = await Promise.all([
      checkFairPlay({ newPage, url: srv.url, log }),
      W ? undefended({ newPage, url: srv.url, game, world, shot, log }).catch(e => ({ error: e.message })) : null,
    ]);
    rec.fair = fp.record;
    if (fp.warnings.length) rec.notes.push(...fp.warnings);
    add(10, 'fair play', fp.ok, fp.detail);
    lap('fair play and the undefended page', tStep); tStep = Date.now();
    // ---- 12. the pulse: something happens. Three rounds with bots (the solo round and check 10's two pages) in
    // which no score ever moved means a dead game, whatever else passes (T1 run 5 shipped one: its rules read
    // paint.coverageOf(p).cells, which is undefined, so nobody ever scored and fair play passed with 0 knocks).
    {
      const vals = (sr.results ?? []).map(r => Number(r.value) || 0);
      const soloMoved = Math.max(0, ...vals) >= 2;   // the bell's results: a score that built up (a lone 1 can be a flicker)
      const pages = fp.record.pages ?? [];
      const fairMoved = pages.some(pg => pg.scoreMoved);
      const ok = soloMoved || fairMoved;
      add(12, 'something happens', ok, ok
        ? `scores moved: solo round ${vals.join('/') || '—'}; fair-play pages max score ${pages.map(pg => pg.maxScore ?? 0).join(', ')}, held moved ${pages.map(pg => `${pg.scoreHeldSec ?? 0} s`).join(', ')}`
        : `no score moved, built up to 2 and stayed (≥ 1.5 s) in ${1 + pages.length} rounds with 3 bots (solo results ${vals.join('/') || 'none'}; fair-play pages ${pages.map(pg => `${pg.mode} ${pg.observed} s`).join(', ')}; ${pages.reduce((n, pg) => n + (pg.knocks ?? 0), 0)} knocks). ` +
          'The game does nothing a player can see. Check the score code in rules.update against each mechanic\'s API in its README (e.g. paint.coverageOf(owner) returns a share 0..1, not an object; paint.coverage() lists {owner, cells, share}); ' +
          'check that rules.bot makes bots act (ctx.bots.target / attack, p.bot.seek, holding primary) and that scoring does not depend on a score that starts at 0 (stealing from nobody). Play ?bots=3&seed=1 and watch the scoreboard.');
    }
    // ---- 15. the loop is alive: every page's recording, the undefended page and the first look ----
    {
      if (und?.error) rec.notes.push(`check 15's undefended page stopped: ${und.error}`);
      const al = judgeAlive({ game, world, pages: recordings, firstLook: look, aim: und?.aim ?? null });
      rec.alive = { goal: al.goal, firstLook: look, aim: und?.aim ?? null, undefendedSeconds: und?.seconds ?? null, pages: recordings.map(r => ({ label: r.label, samples: r.samples.length })), items: al.items };
      add(15, 'the loop is alive', al.ok, al.detail);
    }
    // ---- 5. the two-player live gate ---- (running beside this session since it started; awaited below)
    solo = { ...solo, sr, replayed, audio };
  } catch (e) {
    rec.notes.push(`solo session stopped: ${e.message}`);
    for (const [n, name] of [[3, 'boots to play with no console errors'], [4, 'slot coverage 100%'], [8, 'swap proof'], [10, 'fair play'], [12, 'something happens'], [13, 'controls work'], [15, 'the loop is alive'], [16, 'hits read']]) if (!checks.some(c => c.n === n)) add(n, name, false, `not reached: ${e.message}${solo?.errors?.length ? `; console: ${solo.errors.slice(0, 2).join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
    await srv.close().catch(() => {});
  }
  lap('solo session', t0);
  if (live) {
    const d = await duo;
    lap('solo session and the gate (side by side)', t0);
    gateRec = d.gateRec;
    const lo = d.lo;
    const failed = (gateRec.checks ?? []).filter(c => !c.ok);
    rec.gate = { verdict: gateRec.verdict, passed: gateRec.passed, total: gateRec.total, run: gateRec.run ?? null, failed: failed.map(c => `${c.name}${c.soft ? ' (soft)' : ''}: ${c.detail}`) };
    rec.loadouts = lo.record ? { ok: lo.ok, steps: lo.record.steps, shots: lo.record.shots } : { ok: false, detail: lo.detail };
    rec.notes.push(...lo.warnings);
    add(5, 'two-player live gate', gateRec.verdict === 'pass' && lo.ok, `${gateRec.verdict} ${gateRec.passed ?? 0}/${gateRec.total ?? 0}${gateRec.run ? ` (${gateRec.run})` : ''}${failed.length ? `; failed: ${failed.slice(0, 3).map(c => c.name).join(', ')}` : ''}; ${lo.detail}`);
  } else add(5, 'two-player live gate', false, `multiplayer.json mode is ${mpm.manifest?.mode ?? 'missing'}, not live`);

  // ---- 6. a round to results and replay: alone and with two players ----
  const g = name => (gateRec?.checks ?? []).find(c => c.name === name)?.ok === true;
  const soloOk = !!(solo?.sr && solo.sr.phase === 'results' && solo.sr.results?.length && solo.replayed);
  const duoOk = g('both-see-the-same-results') && g('play-again-starts-a-new-round') && g('host-ends-the-round');
  if (!checks.some(c => c.n === 6)) add(6, 'a round reaches results and replays', soloOk && duoOk, `alone with 3 bots: ${soloOk ? `results (${(solo.sr.results ?? []).map(r => `${r.name} ${r.value}`).join(', ')}), Play again → round 2` : 'did not reach results and a second round'}; two players: ${duoOk ? 'the same results on both, play again, the host ends round 2' : 'the gate did not show results, play again and end round'}`);
  // ---- 7. audio ----
  if (!checks.some(c => c.n === 7)) {
    const a = solo?.audio;
    add(7, 'audio gate v4', !!(a && a.ok && a.heard), a ? `${a.heard ? 'heard' : 'nothing heard'}${a.mix ? `, ${a.mix.integratedLufs?.toFixed?.(1) ?? a.mix.integrated ?? '?'} LUFS integrated, peak ${a.mix.truePeakDb?.toFixed?.(1) ?? '?'} dBTP` : ''}; ${a.problems.length ? a.problems.join('; ') : 'within the targets'}` : 'not measured');
  }

  // ---- 9. contact sheet and perf (track L's capture tool) ----
  const capture = join(GF3, 'lookdev/capture.mjs');
  if (quick) add(9, 'contact sheet and perf', null, '--quick');
  else if (!existsSync(capture)) add(9, 'contact sheet and perf', null, 'research/gf-three/lookdev/capture.mjs does not exist yet (track L)');
  else {
    const t9 = Date.now();
    const r = await run(process.execPath, [capture, dir, '--out', join(outDir, 'sheet'), '--query', 'bots=3&seed=7&gf-autoplay=1&gf-ui=0'], 600000);
    add(9, 'contact sheet and perf', r.code === 0, r.code === 0 ? `sheet in ${relative(dir, join(outDir, 'sheet'))}` : `capture.mjs exit ${r.code}: ${r.tail}`);
    lap('contact sheet', t9);
  }

  checks.sort((a, b) => a.n - b.n);
  rec.pass = passes(checks);   // the pass rule (tools/lib/verdict.mjs): REQUIRED lists 1–8, 10–14 and 16; 9 counts only when it ran
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
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

/** --check 11 / 17 (or 11,17): the static checks alone, no browser. */
const STATIC_ALONE = [11, 17];
async function staticOnly(dir, list, { rec, outDir, add, t0 }) {
  if (list.includes(11)) {
    try { const dr = lintDressing(await loadSubject(dir)); add(11, 'set dressing', dr.errors === 0, dr.errors === 0 ? `clean: 0 errors, ${dr.warnings} warnings` : `${dr.errors} errors: ${dressingLines(dr).filter(l => l.startsWith('ERROR')).slice(0, 6).join(' | ')}`); }
    catch (e) { add(11, 'set dressing', false, `the lint could not run: ${e.message}`); }
  }
  if (list.includes(17)) await check17(dir, { rec, add });
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 10: fair play alone (its own browser and server), for a repair loop. */
async function fairOnly(dir, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const browser = await launchChrome(process.env.GF_VERIFY_SOFTWARE ? {} : { gpu: 'webgl' });
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
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
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Check 14 (tools/lib/looks-check.mjs): generated and reference looks are not stand-ins; roles do not share a body. */
async function looks(dir, rec, add) {
  try { const lk = await checkLooks(dir); rec.looks = lk.record; rec.notes.push(...lk.notes); add(14, 'looks honoured', lk.ok, lk.detail); }
  catch (e) { add(14, 'looks honoured', false, `the check could not run: ${e.message}`); }
}
/** --check 14: looks alone (no browser, under a second). */
async function looksOnly(dir, { rec, outDir, add, t0 }) {
  await looks(dir, rec, add);
  rec.pass = rec.checks.every(c => c.ok);
  rec.finished = new Date().toISOString(); rec.seconds = Math.round((Date.now() - t0) / 1000);
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
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
  const browser = await launchChrome(process.env.GF_VERIFY_SOFTWARE ? {} : { gpu: 'webgl' });
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
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
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/**
 * --check 15: the loop alone (its own browser and server), for a repair loop: a 25 s round with 3 bots as the solo
 * round plays it (the first look at round start, then the player waits) and, beside it, the undefended page.
 */
async function aliveOnly(dir, { rec, outDir, add, log, t0, lap }) {
  const srv = await startParty({ dir, port: 0 });
  const browser = await launchChrome(process.env.GF_VERIFY_SOFTWARE ? {} : { gpu: 'webgl' });
  rec.chrome = browser.version();
  const recordings = [];
  const newPage = async (label, { overrides = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
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
      const T = await newPage('solo', { overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: roundSeconds }] } });
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
  rec.outDir = relative(REPO, outDir);
  await writeFile(join(outDir, 'verdict.json'), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** --check 16: hits read alone (its own browser and server), for a repair loop. */
async function hitsOnly(dir, { rec, outDir, add, log, t0 }) {
  const srv = await startParty({ dir, port: 0 });
  const browser = await launchChrome(process.env.GF_VERIFY_SOFTWARE ? {} : { gpu: 'webgl' });
  rec.chrome = browser.version();
  const newPage = async (label, { overrides = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage(); const errors = [];
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
  rec.outDir = relative(REPO, outDir);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const dir = a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--out' && a[i - 1] !== '--check');
  if (!dir) { console.error('usage: verify.mjs <game> [--quick] [--out <dir>] [--json] [--check 10|13|14|15|16|17|11,17]'); process.exit(2); }
  const json = a.includes('--json');
  const ck = opt('--check', null);
  const only = ck === null ? null : /^\d+(,\d+)+$/.test(ck) ? ck.split(',').map(Number) : Number(ck);
  if (only !== null && !(Array.isArray(only) ? only.every(n => STATIC_ALONE.includes(n)) : [10, 13, 14, 15, 16, ...STATIC_ALONE].includes(only))) { console.error('--check takes 10 (fair play), 13 (controls work), 14 (looks honoured), 15 (the loop is alive), 16 (hits read), or the static checks 11, 17 (11,17 for both)'); process.exit(2); }
  const rec = await verify(dir, { quick: a.includes('--quick'), out: opt('--out', null), log: json ? () => {} : console.log, only });
  if (json) process.stdout.write(JSON.stringify(rec, null, 2) + '\n');
  const passed = rec.checks.filter(c => c.ok === true).length, ran = rec.checks.filter(c => c.ok !== null).length;
  const skipped = rec.checks.filter(c => c.ok === null).map(c => c.n);
  console.log(`verify ${relative(process.cwd(), resolve(dir)) || '.'}: ${rec.pass ? 'PASS' : 'FAIL'} ${passed}/${ran}${skipped.length ? ` (skipped ${skipped.join(', ')})` : ''}${rec.pass ? '' : ` failed: ${rec.checks.filter(c => c.ok === false).map(c => c.n).join(', ')}`} in ${rec.seconds} s → ${rec.outDir}/verdict.json`);
  process.exitCode = rec.pass ? 0 : 1;
}
