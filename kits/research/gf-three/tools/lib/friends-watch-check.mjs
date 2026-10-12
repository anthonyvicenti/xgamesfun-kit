// Verify check 34 for a live game (CONTRACT §9b; research/watch/PLAN.md): watch then play, on the friends page
// (gf-multiplayer 1.6.x) over real WebRTC, the stream relay on the same server (research/watch/relay/node.mjs).
//
//   H hosts and J joins; the round starts; J (a guest) opens the game's menu and presses Go live: the share sheet, LIVE on
//   both screens without covering the round's clock, and the stream's secret kept out of the origin's shared storage. V
//   opens the link: V's page loads this round's game page, draws J where J really is after a walk with its camera on J
//   and no player of its own, keeps the clock and scores in view, puts each name over its character, and J's count
//   says 1 watching. A message sent to the relay as a viewer closes that socket (1008). J reloads: J's stream carries on,
//   on the same link. X watches in a frame the size of a post: beside Join its bar offers Start a room and Play solo,
//   all inside the frame and clear of the full-screen button; Start a room takes X to the friends page, where X hosts a
//   room of its own. V presses Join: the room's own link, and V joins that room, clicking Join while the lobby's backdrop
//   is still loading the character clips (held until the click), so the friends page swaps the frame mid-load. W watches; J stops; W's bar says the
//   stream ended, with Play and no stray words; W presses Play solo: the game's own page, nobody else in it. K, J on
//   another day (a new browser), opens the streamer link J copied from the share sheet, hosts a room and goes live from
//   the waiting room: the same link as before, the secret gone from the address bar and kept out of localStorage, and
//   Y, opening the old link, sees K live. K locks the room, starts a round alone and is live in it: Y's Join reads Room
//   locked and can't be pressed, and Z, opening K's invite link, is refused (the room is locked). No console errors.
// Play-test 1 (research/watch/evidence/playtest-1/report.md) found the defects the later steps hold: the secret in
// localStorage, the badge over the clock, no clock or scores for viewers, misplaced name tags, "null" in the bar, a
// reload that ended the stream. The creator, 2026-10-10: "add an option to start own lobby or play solo" (gf-multiplayer
// 1.6.3; research/watch/evidence/own-room-or-solo-request-2026-10-10.json). The creator, 2026-10-11: "If I close my game
// but want to stream live from the same link as before, how can I do that?" (gf-multiplayer 1.6.5, the streamer link;
// research/watch/evidence/same-link-and-phone-card-report-2026-10-11.json). The creator, 2026-10-11: "We cant lock it
// so others cant join. We also cant play solo", then chose "Lock room, stream solo" (gf-multiplayer 1.6.6;
// research/watch/evidence/lock-room-and-solo-stream-request-2026-10-11.json).
//
//   const r = await checkFriendsWatch({ dir, outDir, shots, log });   → { ok, detail, record, warnings }
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startParty } from '../../../multiplayer/party/lib.mjs';
import { snap, sleep, until } from '../../../multiplayer/party/gate-lib.mjs';
import { launchChrome, GPU_TROUBLE } from '../../../foundations/qa/browser.mjs';
import { launchForGame } from './paths.mjs';

// The share sheet's "Copy my streamer link" (kit 1.6.5), read back from the clipboard as the streamer would paste it.
export async function streamerLinkFrom(page) {
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await page.bringToFront();
    if (!(await page.locator('#mp-live-keep').count())) return null;
    await page.click('#mp-live-keep');
    await sleep(200);
    const t = await page.evaluate(() => navigator.clipboard.readText());
    return /#gf-stream=/.test(t) ? t : null;
  } catch { return null; }
}

const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export async function checkFriendsWatch({ dir, outDir = null, shots = [], log = () => {} } = {}) {
  const mp = JSON.parse(await readFile(join(dir, 'multiplayer.json'), 'utf8'));
  // the character clips the game lists (a gf-three character game; forge lists none): V's Join is clicked while they load
  const clips = /"(assets\/clips\/[^"]+\.glb)"/.exec(await readFile(join(dir, 'assets.json'), 'utf8').catch(() => ''))?.[1] ?? null;
  const record = { steps: [], shots: [] }, warnings = [];
  const step = (name, ok, detail = '') => { record.steps.push({ name, ok: !!ok, detail }); log(`${ok ? 'pass' : 'FAIL'} watch ${name}: ${detail}`); return !!ok; };
  if (mp.mode !== 'live') return { ok: false, detail: `multiplayer.json mode is ${mp.mode}, not live`, record, warnings };
  const srv = await startParty({ dir, port: 0 });
  const { browser, note } = await launchForGame(launchChrome, dir);
  if (note) warnings.push(`watch: ${note}`);
  const errors = [];
  const open = async (who, viewport = { width: 1280, height: 720 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text().slice(0, 240)}`); });
    return { who, ctx, page };
  };
  const shot = async (P, name) => {
    if (!outDir) return;
    const f = `watch-${String(record.shots.length + 1).padStart(2, '0')}-${name}.jpg`;
    record.shots.push(f); shots.push(f);
    await P.page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 75 }).catch(() => {});
  };
  const frameOf = P => P.page.frames().find(f => f.parentFrame() === P.page.mainFrame());
  const game = P => frameOf(P)?.evaluate(() => window.__game?.snapshot?.() ?? null).catch(() => null) ?? null;
  const cam = P => frameOf(P)?.evaluate(() => window.__game?.camera?.() ?? null).catch(() => null) ?? null;
  const party = P => P.page.evaluate(() => window.__party.snapshot()).catch(() => null);
  const clickGame = async P => { const b = await P.page.locator('#game').boundingBox(); await P.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  let ok = true;
  try {
    // ---- a round with two friends ----
    const H = await open('host'), J = await open('joiner');
    await H.page.goto(`${srv.partyUrl}?max=600`, { waitUntil: 'load' });
    await until(async () => (await snap(H.page))?.phase === 'home', 30000, 'the Host / Join screen');
    await H.page.click('#gfp-name', { clickCount: 3 }).catch(() => {}); await H.page.keyboard.type('Hosta');
    await H.page.click('#gfp-host');
    const hs = await until(async () => { const s = await snap(H.page); return s?.phase === 'room' && s.code ? s : null; }, 30000, 'the room');
    await J.page.goto(await H.page.inputValue('#mp-invite'), { waitUntil: 'load' });
    await until(async () => (await snap(J.page))?.phase === 'home', 30000, "the joiner's Host / Join screen");
    await J.page.click('#gfp-name', { clickCount: 3 }).catch(() => {}); await J.page.keyboard.type('Jules');
    await J.page.click('#gfp-join');
    await until(async () => (await snap(H.page))?.racers.length === 2 && (await snap(J.page))?.phase === 'room', 30000, 'both in the room');
    const js = await snap(J.page);
    await sleep(500);
    await H.page.click('#mp-start');
    await until(async () => (await game(H))?.net?.started && (await game(J))?.net?.started, 120000, 'both games to start');
    await sleep(1500);
    // ---- J goes live from the game's menu ----
    await clickGame(J); await sleep(200);
    await J.page.keyboard.press('Escape'); await sleep(500);
    const offered = await frameOf(J).evaluate(() => !!document.querySelector('#gf-live')).catch(() => false);
    ok = step('the menu offers Go live in a round with friends', offered, offered ? '#gf-live' : 'no #gf-live in the pause menu') && ok;
    await frameOf(J).click('#gf-live');
    const live = await until(async () => { const s = (await party(J))?.live; return s?.state === 'on' ? s : null; }, 10000, 'J live');
    const sheet = await J.page.evaluate(() => ({ shown: !!document.querySelector('#mp-live-share:not([hidden])'), post: document.querySelector('#mp-live-post')?.getAttribute('href') ?? '' }));
    const hBadge = await until(async () => H.page.evaluate(() => document.querySelector('#mp-live:not([hidden])')?.textContent ?? null), 8000, 'LIVE on H').catch(() => null);
    ok = step('Go live: the share sheet, and LIVE for everyone in the room', sheet.shown && decodeURIComponent(sheet.post).includes(live.link) && /LIVE/.test(hBadge ?? '') && /Jules/.test(hBadge ?? ''), `link ${live.link}; H sees "${hBadge}"`) && ok;
    // the secret stays in this tab: nothing a game on the origin can read from localStorage (play-test 1)
    const leaked = await J.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gf-watch:')).map(k => localStorage.getItem(k))).catch(() => ['?']);
    ok = step('the stream\'s secret is not in the origin\'s shared storage', leaked.length === 0, leaked.length ? `localStorage holds ${leaked.length} gf-watch entr${leaked.length === 1 ? 'y' : 'ies'}` : 'sessionStorage only') && ok;
    // the same link next time: the share sheet's private streamer link (kit 1.6.5)
    const keep = await streamerLinkFrom(J.page);
    ok = step('the share sheet hands the streamer a private link for the same stream next time', !!keep && keep.includes(`#gf-stream=${live.id}.`) && !keep.includes('watch='), keep ? keep.replace(/(#gf-stream=[a-z0-9]{12}\.).*/, '$1…') : 'no #mp-live-keep, or it copied nothing') && ok;
    await J.page.click('#mp-live-close').catch(() => {});
    // LIVE never covers the round's clock (play-test 1: it sat over the timer all round)
    const hTimer = await frameOf(H).evaluate(() => { const t = document.querySelector('.gf-timer'); if (!t || t.offsetParent === null) return null; const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).catch(() => null);
    const hFrame = await H.page.locator('#game').boundingBox();
    const hBadgeBox = await H.page.locator('#mp-live').boundingBox().catch(() => null);
    const timerOnPage = hTimer && hFrame ? { x: hTimer.x + hFrame.x, y: hTimer.y + hFrame.y, width: hTimer.width, height: hTimer.height } : null;
    ok = step('LIVE leaves the round\'s clock in view', !timerOnPage || !overlap(timerOnPage, hBadgeBox), timerOnPage ? `clock at ${Math.round(timerOnPage.x)},${Math.round(timerOnPage.y)}; badge at ${Math.round(hBadgeBox?.x)},${Math.round(hBadgeBox?.y)}` : 'this game shows no clock') && ok;
    await shot(J, 'live');
    // ---- V watches J ----
    const V = await open('viewer');
    await V.page.goto(live.link, { waitUntil: 'load' });
    const keyed = await until(async () => { const w = (await party(V))?.watch; return w?.keyed ? w : null; }, 60000, 'V tuned in').catch(() => null);
    ok = step('a viewer tunes in: this round\'s game page, the streamer followed', !!keyed && keyed.follow?.id === js.you, keyed ? `following ${keyed.follow?.name} (${keyed.follow?.id}); ${keyed.roster} in the stream` : JSON.stringify((await party(V))?.watch)) && ok;
    await clickGame(J); await sleep(300);
    const j0 = (await game(J))?.players?.find(p => p.local);
    await J.page.keyboard.down('KeyW'); await sleep(1300); await J.page.keyboard.up('KeyW'); await sleep(1500);
    const jMe = (await game(J))?.players?.find(p => p.local);
    const moved = j0 && jMe ? Math.hypot(jMe.x - j0.x, jMe.z - j0.z) : 0;
    const seen = await until(async () => { const g = await game(V); const p = g?.players?.find(x => x.id === js.you); return p && jMe && Math.hypot(p.x - jMe.x, p.z - jMe.z) < 2 ? g : null; }, 6000, 'J on V').catch(() => null);
    ok = step('the viewer draws the streamer where they really are (after a walk)', !!seen && moved >= 1, `J walked ${moved.toFixed(2)} m to ${jMe?.x},${jMe?.z}; V draws ${JSON.stringify(((await game(V))?.players ?? []).map(p => [p.id, p.x, p.z]))}`) && ok;
    // A forge game (first person, CONTRACT §8 forge; gf-forge wave 4): the viewer looks out of the streamer's eyes, so
    // the streamer has no name of their own on a viewer's screen. The streamer turns to their friend (the engine's QA
    // call, as tools/play.mjs's `face`): the steps below then hold the viewer's view to a turn as well as a walk, and
    // the friend's name must stand over the friend.
    const faced = await frameOf(J).evaluate(() => { const g = window.__game, o = g?.snapshot?.()?.players?.find(p => !p.local); if (g?.engine !== 'forge' || !g.forge?.face || !o) return null; g.forge.face(o.x, o.y + 1.2, o.z); return o.name; }).catch(() => null);
    if (faced) { record.faced = faced; await sleep(1800); }
    const gv = seen ?? await game(V);
    ok = step('the viewer has no player of its own in the game, and follows the streamer', !(gv?.players ?? []).some(p => p.local) && gv?.watch?.target === js.you && (gv?.players ?? []).length === 2, `players ${JSON.stringify((gv?.players ?? []).map(p => p.name))}; target ${gv?.watch?.target}`) && ok;
    const [cj, cv] = [await cam(J), await cam(V)];
    const deg = cj && cv ? Math.acos(Math.max(-1, Math.min(1, cj.dir.reduce((t, v, i) => t + v * cv.dir[i], 0)))) * 180 / Math.PI : 999;
    const gap = cj && cv ? Math.hypot(...cj.eye.map((v, i) => v - cv.eye[i])) : 999;
    // third: the streamer's own rig, over the shoulder (until 2026-10-10 a viewer looked from the head: 1.8 m and 10° off
    // across a room, 4.7 m and 44° with a desk in front, and the bound was 12 m and 40°)
    ok = step('the viewer sees as the streamer does', cj?.mode === 'first' ? gap < 0.4 && deg < 12 : cj?.mode === 'third' ? gap < 1 && deg < 8 : gap < 12 && deg < 40, `${cj?.mode}: cameras ${gap.toFixed(2)} m and ${deg.toFixed(1)}° apart${faced ? ` (after the streamer turned to face ${faced})` : ''}`) && ok;
    // the viewer keeps the round's clock and scores (play-test 1: only the 3D view and the bar)
    const vHud = await frameOf(V).evaluate(() => { const shown = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; }; return { timer: shown('.gf-timer'), scores: shown('.gf-scores'), card: shown('#gf-hud'), menu: shown('#gf-menu-button') }; }).catch(() => null);
    const hHud = await frameOf(H).evaluate(() => ({ timer: !!document.querySelector('.gf-timer') && getComputedStyle(document.querySelector('.gf-timer')).display !== 'none', scores: !!document.querySelector('.gf-scores')?.getBoundingClientRect().width })).catch(() => null);
    ok = step('the viewer sees the round\'s clock and scores, not a player\'s own card or menu', !!vHud && vHud.timer === !!hHud?.timer && vHud.scores === !!hHud?.scores && !vHud.card && !vHud.menu, `viewer ${JSON.stringify(vHud)}; a player sees clock ${hHud?.timer}, scores ${hHud?.scores}`) && ok;
    // each name over its character on the viewer's screen (play-test 1: tags 90-300 px off, one pinned in place)
    const tags = await frameOf(V).evaluate(() => {
      const s = window.__game.snapshot(), out = [];
      const plates = [...document.querySelectorAll('.gf-plate')].filter(e => e.style.display !== 'none');
      for (const p of s.players) {
        const e = plates.find(x => x.lastChild?.textContent === p.name); if (!e) continue;
        const r = e.getBoundingClientRect(), at = window.__game.project(p.x, p.y + 1.7, p.z);
        if (!at?.front) continue;
        // (half: how many pixels half a metre is at that character's depth, for a first-person view of a friend close by)
        const up = window.__game.project(p.x, p.y + 2.2, p.z);
        out.push({ name: p.name, dx: Math.round(r.left + r.width / 2 - at.x), dy: Math.round(r.bottom - at.y), half: up ? Math.round(Math.abs(up.y - at.y)) : 0 });
      }
      return out;
    }).catch(() => []);
    // 120 px either way. Through a forge streamer's eyes a friend can stand at arm's length, where the kit's plate (0.3 m
    // over the head) is more than 120 px above the 1.7 m this step measures from (hello forge's two spawns, 2026-10-11:
    // 150 px): there the bound is half a metre at the friend's depth, when that is more.
    const far = t => (faced ? Math.max(120, t.half) : 120);
    ok = step('a viewer\'s nameplates sit over the characters', tags.length >= 1 && tags.every(t => Math.abs(t.dx) <= 40 && Math.abs(t.dy) <= far(t)), JSON.stringify(tags)) && ok;
    const count = await until(async () => { const s = await J.page.evaluate(() => document.querySelector('#mp-live')?.textContent ?? ''); return /1 watching/.test(s) ? s : null; }, 6000, 'the count').catch(() => null);
    ok = step('the streamer sees how many watch', !!count, count ?? 'no count') && ok;
    await shot(V, 'viewer');
    // read-only: the relay closes a viewer socket that sends
    const relay = new URL(`/watch/v1/${live.id}`, srv.url.replace(/^http/, 'ws')).href;
    const code = await V.page.evaluate(url => new Promise(r => { const ws = new WebSocket(url); ws.onopen = () => ws.send('{"k":"d","t":0,"m":[]}'); ws.onclose = e => r(e.code); setTimeout(() => r('timeout'), 5000); }), relay);
    ok = step('a viewer can\'t send: the relay closes a socket that tries (1008)', code === 1008, `close ${code}`) && ok;
    // ---- J reloads mid-round: the stream carries on, on the same link (play-test 1: it ended) ----
    await J.page.reload({ waitUntil: 'load' });
    const back = await until(async () => { const s = (await party(J))?.live; return s?.state === 'on' ? s : null; }, 30000, 'J live again').catch(() => null);
    const vBack = back ? await until(async () => { const w = (await party(V))?.watch; return w?.live && !w.ended ? w : null; }, 15000, 'V still watching').catch(() => null) : null;
    ok = step('a streamer who reloads carries on, on the same link', !!back && back.id === live.id && !!vBack, back ? `live again on ${back.id} (was ${live.id}); V ${vBack ? 'watching' : 'lost it'}` : `after the reload J's stream is ${(await party(J))?.live?.state}`) && ok;
    // ---- X watches in a frame the size of a post: a room of one's own and the game alone, beside Join (kit 1.6.3) ----
    const X = await open('viewer 3', { width: 480, height: 480 });
    await X.page.goto(live.link, { waitUntil: 'load' });
    await until(async () => (await party(X))?.watch?.keyed || null, 60000, 'X tuned in').catch(() => {});
    const ways = await X.page.evaluate(() => {
      const box = s => { const e = document.querySelector(s); if (!e || e.disabled) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), text: e.textContent } : null; };
      return { join: box('#mp-watch-join'), own: box('#mp-watch-own'), solo: box('#mp-watch-solo'), bar: box('#mp-watch'), w: innerWidth, h: innerHeight };
    }).catch(() => ({}));
    const xFs = await frameOf(X)?.evaluate(() => { const e = document.querySelector('.gf-fsbtn'); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; }).catch(() => null);
    const xFrame = await X.page.locator('#game').boundingBox().catch(() => null);
    const fsOnPage = xFs && xFrame ? { x: xFs.x + xFrame.x, y: xFs.y + xFrame.y, width: xFs.width, height: xFs.height } : null;
    const inside = b => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= ways.w && b.y + b.height <= ways.h;
    ok = step('beside Join, a viewer is offered a room of their own and the game alone, inside a post-sized frame', inside(ways.join) && inside(ways.own) && inside(ways.solo) && inside(ways.bar) && !overlap(ways.bar, fsOnPage),
      `${ways.w}x${ways.h}: bar ${JSON.stringify(ways.bar ? [ways.bar.x, ways.bar.y, ways.bar.width, ways.bar.height] : null)}; buttons ${[ways.join, ways.own, ways.solo].map(b => b ? `"${b.text}"` : 'none').join(', ')}; full-screen button ${fsOnPage ? `at ${Math.round(fsOnPage.x)},${Math.round(fsOnPage.y)}` : 'not shown'}`) && ok;
    await shot(X, 'viewer-ways');
    await X.page.click('#mp-watch-own').catch(() => {});
    await until(async () => (await snap(X.page))?.phase === 'home', 30000, "X's Host / Join screen").catch(() => {});
    const ownUrl = new URL(X.page.url());
    await X.page.click('#gfp-host').catch(() => {});
    const own = await until(async () => { const s = await snap(X.page); return s?.phase === 'room' && s.code ? s : null; }, 30000, "X's own room").catch(() => null);
    ok = step('Start a room: the viewer hosts a room of their own', !!own && own.code !== hs.code && !ownUrl.searchParams.has('watch') && !ownUrl.searchParams.has('join'), own ? `${ownUrl.href}; X hosts ${own.code} (the stream's room is ${hs.code})` : `${ownUrl.href}; no room`) && ok;
    await X.ctx.close().catch(() => {});
    // ---- V joins while live: the room's own link ----
    // A player who clicks Join at once: the lobby's backdrop is still loading when the friends page gives the frame the
    // round's page, which cancels the backdrop's loads. The backdrop's clips are held until the click, so that happens on
    // every run (the corpus saw it now and then: token-call-centre, Recess Rumble, 2026-10-11), and a game that reports
    // its own cancelled loads fails "no console errors" with V's page named.
    let held = false, release = () => {};
    const gate = new Promise(r => { release = r; });
    if (clips) await V.ctx.route(`**/${clips}`, async r => {
      let backdrop = false; try { backdrop = /gf_mode=backdrop/.test(r.request().frame().url()); } catch {}
      if (backdrop) { held = true; await gate; }
      await r.continue().catch(() => {});      // the backdrop's page may be gone by then
    });
    await V.page.click('#mp-watch-join');
    await until(async () => (await snap(V.page))?.phase === 'home', 30000, "V's Host / Join screen");
    const joinUrl = V.page.url();
    const backdropOn = clips && await until(async () => /gf_mode=backdrop/.test(frameOf(V)?.url() ?? '') || null, 3000, 'the backdrop').catch(() => null);
    if (backdropOn) await until(async () => held || null, 15000, 'the backdrop loading its clips').catch(() => {});
    await V.page.click('#gfp-join');
    setTimeout(release, 1000);
    const inRoom = await until(async () => { const s = await snap(V.page); return s?.phase === 'room' && s.code === hs.code ? s : null; }, 30000, 'V in the room').catch(() => null);
    release();
    ok = step('Join opens the room\'s own link and the viewer joins that room', !!inRoom && new URL(joinUrl).searchParams.get('join') === hs.code, `${joinUrl}; V's room ${inRoom?.code ?? '(none)'} (the host's ${hs.code})${!clips ? '' : held ? '; Join clicked while the backdrop was loading its clips' : '; the backdrop never asked for its clips before Join'}`) && ok;
    // ---- W watches; J stops; W sees the end ----
    const Wv = await open('viewer 2');
    await Wv.page.goto(live.link, { waitUntil: 'load' });
    await until(async () => (await party(Wv))?.watch?.keyed || null, 60000, 'W tuned in').catch(() => {});
    await frameOf(J)?.evaluate(() => document.exitPointerLock?.()).catch(() => {});
    await J.page.keyboard.press('Escape').catch(() => {}); await sleep(300);
    await J.page.click('#mp-live');
    await J.page.click('#mp-live-stop');
    const ended = await until(async () => { const w = (await party(Wv))?.watch; return w?.ended ? w : null; }, 8000, 'the end on W').catch(() => null);
    const bar = await Wv.page.evaluate(() => document.querySelector('#mp-watch')?.textContent ?? '');
    ok = step('Stop ends the stream for viewers, with Play and no stray words', !!ended && /ended/.test(bar) && /Play/.test(bar) && !/null|undefined/.test(bar), bar) && ok;
    // ---- W plays alone: the game's own page, nobody else in it (kit 1.6.3) ----
    await Wv.page.click('#mp-watch-solo').catch(() => {});
    const solo = await until(() => Wv.page.evaluate(() => window.__game?.ready === true && document.querySelector('#gf-play') ? { url: location.href, net: window.__game.snapshot().net ?? null } : null), 60000, 'the game alone on W').catch(() => null);
    ok = step('Play solo: the game on its own page, with nobody else', !!solo && solo.net === null && !/\/gf\/mp\//.test(new URL(solo.url).pathname) && !new URL(solo.url).searchParams.has('watch'), solo ? `${solo.url}; its home menu, no room` : `still at ${Wv.page.url()}`) && ok;
    // ---- another day: J's streamer link in a new browser, the same public link (kit 1.6.5) ----
    let again = null, kUrl = '', kNote = false, kLeak = -1, yLive = null, kLocked = false, kSolo = null, yShut = null, zRefused = null, kAlone = -1, yRound = null;
    if (keep) {
      const K = await open('streamer, another day');
      await K.page.goto(keep, { waitUntil: 'load' });
      await until(async () => (await snap(K.page))?.phase === 'home', 30000, "K's Host / Join screen").catch(() => {});
      kUrl = K.page.url();
      kNote = await until(() => K.page.evaluate(() => !!document.querySelector('#mp-live-saved:not([hidden])')), 8000, 'the saved-link note').catch(() => false);
      await K.page.click('#gfp-name', { clickCount: 3 }).catch(() => {}); await K.page.keyboard.type('Jules');
      await K.page.click('#gfp-host').catch(() => {});
      await until(async () => { const s = await snap(K.page); return s?.phase === 'room' && s.code ? s : null; }, 30000, "K's room").catch(() => {});
      await K.page.click('#mp-golive').catch(() => {});
      again = await until(async () => { const s = (await party(K))?.live; return s?.state === 'on' ? s : null; }, 15000, 'K live').catch(() => null);
      kLeak = await K.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gf-watch:')).length).catch(() => -1);
      if (again) {
        const Y = await open('viewer 4');
        await Y.page.goto(live.link, { waitUntil: 'load' });
        yLive = await until(async () => { const w = (await party(Y))?.watch; return w?.live && !w.ended ? w : null; }, 30000, 'Y sees K live').catch(() => null);
        // ---- K locks the room and plays alone, live (kit 1.6.6) ----
        const kInvite = await K.page.inputValue('#mp-invite').catch(() => null);   // the waiting room's link, before the round hides it
        await K.page.click('#mp-lock').catch(() => {});
        kLocked = await until(async () => (await party(K))?.locked === true && K.page.evaluate(() => { const b = document.querySelector('#mp-start'); return !!b && !b.disabled; }), 8000, 'K locked, Start enabled').catch(() => false);
        await K.page.click('#mp-start').catch(() => {});
        kSolo = await until(async () => (await game(K))?.net?.started ? await game(K) : null, 120000, 'K\'s round alone').catch(() => null);
        yShut = await until(() => Y.page.evaluate(() => { const b = document.querySelector('#mp-watch-join'); return b && b.disabled && /locked/i.test(b.textContent) ? b.textContent : null; }), 15000, 'Y\'s Join locked').catch(() => null);
        // Y watches K's round alone (its game page loaded and caught up) before anything closes
        yRound = await until(async () => { const w = (await party(Y))?.watch; return w?.keyed && (await game(Y)) ? w : null; }, 60000, 'Y watching K\'s round').catch(() => null);
        const yOwn = await Y.page.evaluate(() => !!document.querySelector('#mp-watch-own:not([disabled])') && !!document.querySelector('#mp-watch-solo:not([disabled])')).catch(() => false);
        if (!yOwn) yShut = null;
        const Z = await open('locked out');
        if (kInvite) await Z.page.goto(kInvite, { waitUntil: 'load' }).catch(() => {});
        await until(async () => (await snap(Z.page))?.phase === 'home', 30000, "Z's Host / Join screen").catch(() => {});
        await Z.page.click('#gfp-join').catch(() => {});
        // the host-join kit draws its lobby in a shadow root: a text locator reads what the player sees
        zRefused = await Z.page.locator('text=/room is locked/i').first().textContent({ timeout: 20000 }).catch(() => null);
        kAlone = (await snap(K.page))?.racers?.length ?? -1;
        await Z.ctx.close().catch(() => {});
        await Y.ctx.close().catch(() => {});
      }
      await K.ctx.close().catch(() => {});
    }
    ok = step('another day, the streamer link goes live on the same link, and the old link shows it', !!again && again.id === live.id && again.link === live.link && !!yLive && !/gf-stream/.test(kUrl) && kNote && kLeak === 0,
      again ? `live on ${again.id} (was ${live.id}); the old link ${yLive ? 'shows it live' : 'does not show it live'}; the address bar ${/gf-stream/.test(kUrl) ? 'still holds the secret' : 'is clean'}; the note ${kNote ? 'shown' : 'not shown'}; localStorage ${kLeak} gf-watch entries` : `K is ${keep ? 'not live' : 'never opened: no streamer link'}`) && ok;
    ok = step('a streamer locks their room and plays alone, live: viewers can\'t join, an invite is refused', !!kLocked && !!kSolo && !!yRound && !!yShut && !!zRefused && kAlone === 1,
      `lock ${kLocked ? 'on, Start enabled' : 'not taken'}; round alone ${kSolo ? 'started' : 'not started'}, ${yRound ? 'watched' : 'not watched'}; the viewer's Join ${yShut ? `"${yShut}", disabled, beside Start a room and Play solo` : 'still open'}; the invite ${zRefused ? `refused: "${zRefused.trim().slice(0, 80)}"` : 'not refused'}; ${kAlone} in the room`) && ok;
    ok = step('no console errors', errors.length === 0, errors.slice(0, 4).join(' | ') || 'none') && ok;
  } catch (e) {
    ok = step('the flow ran to the end', false, e.message.split('\n')[0]) && ok;
  } finally {
    await browser.close().catch(() => {});
    await srv.close().catch(() => {});
  }
  const failed = record.steps.filter(s => !s.ok);
  return { ok: ok && !failed.length, detail: failed.length ? failed.map(s => `${s.name}: ${s.detail}`).slice(0, 3).join(' · ') : `${record.steps.length} steps: Go live in a round, watch the streamer (clock, scores, names), read-only, a reload, a room of one's own, Join, Stop, the game alone, the same link another day, a locked room played alone`, record, warnings };
}
