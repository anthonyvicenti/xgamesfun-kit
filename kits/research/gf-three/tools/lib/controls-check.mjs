// verify check 13: controls work. Every control the HUD lists (config/game.json → controls) does something the player
// can see on their own screen.
//
// Creator, T1 run 5 (2026-10-07), on a game that passed 12/12: "I cant seem to fire pee or drink". The stream fired but
// landed behind the player's own body, under a crosshair the body covered; "E: grab a drink" was on the HUD and E did
// nothing (pickups only collected on touch). So one solo page (no bots, nothing else moving) plays each listed control
// with real keys and mouse, from the local player's own view:
//
//   jump       Space → the player rises (≥ JUMP_RISE m).
//   interact   walk (real keys, camera-relative steering) to the nearest thing a mechanic exposes to interact with (a
//              pickup spot, a free station, a free carry item), stopping inside its press distance but outside its
//              touch distance, then press E (hold it for a hold station, tap it for a tap station) → that thing changes
//              (taken, held, worked). A game whose mechanics expose nothing: E where the player stands must change some
//              state. Older kits without the controls observation are read from the shared state (pickups, carry).
//   primary,   held for HOLD_MS while the page takes frames as fast as it can (four released frames first: pixels that
//   secondary  differ among them are noise, e.g. idle animation and bobbing pickups) → the shot shows AT the crosshair:
//              in at least CORE_FRAMES frames, CORE_MIN or more of the pixels within CORE_RADIUS × the screen height of
//              the middle changed (beyond the noise); or, for a quick throw, one frame with twice that and a sum over the
//              frames of four times that; or, when the kit's observation says the shot landed at the crosshair in view,
//              one such frame. A shot that lands somewhere the player cannot see, or beside the body while the
//              crosshair sits on it, does not (Bladder Brawl before the fix: at most 9% in a single frame, a few stray
//              drops, sum 0.24; after: about 47% in every frame; a thrown ball: one to three frames of 11–36%). With the
//              controls observation (current kit) also:
//              the player's own body does not cover the crosshair, the shot lands within LAND_PX × the screen height of
//              the crosshair on screen, and not behind the player's own body. Plus a world effect when the game has one
//              (paint: some cells change). Without a crosshair (top camera, nothing aimed): a change anywhere in the
//              central region (≥ CENTRAL_MIN). NEAR_RADIUS (a wider disc) is reported, not judged.
//
// The HUD's control line must never list a control this check finds dead: the detail names the control, what
// happened, and what to change. Budget: about 25 s on the solo browser.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = v => Math.round(v * 100) / 100;
export const CONTROL_LIMITS = { JUMP_RISE: 0.25, HOLD_MS: 1400, CORE_RADIUS: 0.025, CORE_MIN: 0.12, CORE_FRAMES: 2, NEAR_RADIUS: 0.065, CENTRAL_MIN: 0.01, LAND_PX: 0.1, PIXEL_T: 60, WALK_SECONDS: 14 };
const ACTIONS = ['jump', 'interact', 'primary', 'secondary'];

/** In the page: the observation and the local player. */
const OBS = () => {
  const g = window.__game; if (!g) return null;
  const s = g.snapshot(), me = s.players.find(p => p.local);
  let c = null; try { c = g.controls?.() ?? null; } catch {}
  return { phase: s.phase, me, shared: s.shared ?? {}, rules: s.rules ?? null, controls: c, scores: s.players.map(p => p.score) };
};

/**
 * Things to interact with, nearest first: from the kit's controls observation, else (older kits) from the shared
 * state of the pickup and carry mechanics, with distances from config/game.json.
 */
export function interactablesOf(o, game) {
  if (o.controls?.interactables) return o.controls.interactables;
  const me = o.me, out = [], mech = id => (game.mechanics ?? []).find(m => m.id === id)?.params ?? null;
  const pk = mech('pickup');
  if (pk && Array.isArray(o.shared.pk?.p)) o.shared.pk.p.forEach((q, i) => { if (q[3] === 1) out.push({ kind: 'pickup', id: `pickup:${i}`, x: q[0], y: q[1], z: q[2], reach: 2, touch: pk.radius ?? 1, action: 'interact', legacy: true }); });
  const ca = mech('carry');
  if (ca && (ca.grabAction ?? 'interact') && Array.isArray(o.shared.carry?.i)) for (const e of o.shared.carry.i) if (e[4] === -1 && e[5] !== 1) out.push({ kind: 'carry', id: `carry:${e[0]}`, x: e[1], y: e[2], z: e[3], reach: ca.reach ?? 1.8, touch: 0, action: ca.grabAction ?? 'interact', legacy: true });
  for (const t of out) t.d = Math.hypot(t.x - me.x, t.z - me.z);
  return out.sort((a, b) => a.d - b.d);
}

/** Is interactable `t` still as it was in `o` (present, free, not worked)? → true while unchanged */
function unchanged(t, o, game) {
  const list = interactablesOf(o, game);
  const now = list.find(x => x.id === t.id);
  if (!now) return false;                                            // taken, held or busy: gone from the list
  return true;
}

/** Pixel analysis in a browser page: released frames (noise) vs held frames, near the crosshair and in the middle. */
async function analyse(browser, released, held, L, view) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ([R, Hs, L, view]) => {
      const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = new OffscreenCanvas(im.width, im.height); const g = c.getContext('2d'); g.drawImage(im, 0, 0); return { w: im.width, h: im.height, d: g.getImageData(0, 0, im.width, im.height).data }; };
      const rs = []; for (const s of R) rs.push(await load(s));
      // the frames are the clip view.clip of a view.w × view.h screen: the crosshair is the screen's middle
      const base = rs[rs.length - 1], W = base.w, H = view.h, cx = view.w / 2 - view.clip.x, cy = view.h / 2 - view.clip.y, rad = L.NEAR_RADIUS * H, core = L.CORE_RADIUS * H, T = L.PIXEL_T;
      const diff = (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      const x0 = 0, x1 = base.w, y0 = 0, y1 = base.h;
      // noise: pixels any released frame shows differently from the last one (idle animation, bobbing pickups)
      const noise = new Uint8Array(W * base.h);
      for (const r of rs.slice(0, -1)) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (diff(r.d, base.d, i) > T) noise[y * W + x] = 1; }
      let nNear = 0, noiseNear = 0, nCore = 0, noiseCore = 0, nC = 0, noiseC = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = y * W + x, q = (x - cx) ** 2 + (y - cy) ** 2; nC++; noiseC += noise[k];
        if (q <= rad * rad) { nNear++; noiseNear += noise[k]; }
        if (q <= core * core) { nCore++; noiseCore += noise[k]; }
      }
      const frames = [];
      for (const s of Hs) {
        const h = await load(s);
        let cNear = 0, cCore = 0, cC = 0, sx = 0, sy = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const k = y * W + x; if (noise[k]) continue;
          if (diff(base.d, h.d, k * 4) <= T) continue;
          cC++; sx += x; sy += y;
          const q = (x - cx) ** 2 + (y - cy) ** 2;
          if (q <= rad * rad) cNear++;
          if (q <= core * core) cCore++;
        }
        const r3 = v => Math.round(v * 1000) / 1000;
        frames.push({ core: r3(cCore / Math.max(1, nCore)), near: r3(cNear / Math.max(1, nNear)), central: r3(cC / Math.max(1, nC)), at: cC ? [Math.round(sx / cC + view.clip.x), Math.round(sy / cC + view.clip.y)] : null });
      }
      return { w: view.w, h: view.h, noiseCore: noiseCore / Math.max(1, nCore), noiseNear: noiseNear / Math.max(1, nNear), noiseCentral: noiseC / Math.max(1, nC), frames };
    }, [released.map(b => b.toString('base64')), held.map(b => b.toString('base64')), L, view]);
  } finally { await page.close(); }
}

/**
 * Check 13. newPage(label, {overrides}) → {ctx, page, errors} (verify's own); url: the served game; game: config/game.json;
 * browser: for the pixel analysis; shot(page, name): an evidence screenshot. → {ok, detail, record, warnings}
 */
export async function checkControls({ newPage, browser, url, game, shot = async () => null, log = () => {} }) {
  const L = CONTROL_LIMITS, t0 = Date.now();
  const listed = Object.keys(game.controls ?? {}).filter(k => ACTIONS.includes(k)).sort((a, b) => ACTIONS.indexOf(a) - ACTIONS.indexOf(b));
  const others = Object.keys(game.controls ?? {}).filter(k => !ACTIONS.includes(k));
  const results = [], warnings = [];
  if (others.length) warnings.push(`controls lists ${others.join(', ')}: not kit actions (the HUD line shows only primary, secondary, interact and jump); not tested`);
  if (!listed.length) return { ok: true, detail: 'config/game.json lists no controls (WASD and mouse look only); nothing to test', record: { listed, results, seconds: 0 }, warnings };
  const T = await newPage('controls', { overrides: { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: 180 }] } });
  const p = T.page;
  const obs = () => p.evaluate(OBS);
  const vp = p.viewportSize() ?? { width: 1280, height: 720 };
  const view = { w: vp.width, h: vp.height, clip: { x: Math.floor(vp.width * 0.25), y: Math.floor(vp.height * 0.27), width: Math.round(vp.width * 0.5), height: Math.round(vp.height * 0.55) } };
  const png = (full = false) => p.screenshot(full ? { type: 'png' } : { type: 'png', clip: view.clip });
  try {
    await p.goto(`${url}?seed=7&bots=0`, { waitUntil: 'load' });
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'lobby'; ) { if (Date.now() - t > 90000) throw new Error('no lobby in 90 s'); await sleep(200); }
    const play = await p.locator('#gf-play').boundingBox().catch(() => null);
    if (play) await p.mouse.click(play.x + play.width / 2, play.y + play.height / 2); else await p.keyboard.press('Enter');
    for (let t = Date.now(); (await p.evaluate(() => window.__game?.phase ?? null).catch(() => null)) !== 'playing'; ) { if (Date.now() - t > 20000) throw new Error('the round did not start'); await sleep(120); }
    await sleep(1600);                                              // the "Go!" banner
    await p.mouse.click(640, 400); await sleep(300);                // takes the mouse (pointer lock), as a player does
    const o0 = await obs();
    const hasObs = !!o0.controls;
    const crosshair = hasObs ? !!o0.controls.crosshair : (game.camera ?? 'third') !== 'top';

    for (const action of listed) {
      const words = game.controls[action];
      if (action === 'jump') {
        const a = await obs(); let top = a.me.y;
        await p.keyboard.down('Space'); await sleep(90); await p.keyboard.up('Space');
        for (let i = 0; i < 8; i++) { await sleep(90); const b = await obs(); top = Math.max(top, b.me.y); }
        const rise = r2(top - a.me.y);
        results.push({ action, words, ok: rise >= L.JUMP_RISE, rise, why: rise >= L.JUMP_RISE ? `rose ${rise} m` : `Space: the player rose ${rise} m (needs ${L.JUMP_RISE}); check config/game.json controller.jump (m/s) and that nothing holds the controller (controller.enabled)` });
        await sleep(500);
        continue;
      }
      if (action === 'interact') { results.push(await interact({ p, obs, game, words, shot, L, t0 })); continue; }
      // primary / secondary: held near the crosshair
      results.push(await fire({ p, obs, png, view, browser, action, words, crosshair, hasObs, game, shot, L }));
    }
  } catch (e) {
    results.push({ action: 'run', ok: false, why: `the controls page stopped: ${e.message}` });
  } finally {
    const errors = T.errors.slice();
    await T.ctx.close().catch(() => {});
    if (errors.length) warnings.push(`controls page console errors: ${[...new Set(errors)].slice(0, 2).join(' | ')}`);
  }
  const ok = results.length > 0 && results.every(r => r.ok);
  const line = r => `${r.action}${r.words ? ` ("${r.words}")` : ''}: ${r.ok ? 'ok' : 'DEAD'}, ${r.why}`;
  const detail = ok ? results.map(line).join('; ')
    : `${results.filter(r => !r.ok).map(line).join('; ')}. The HUD lists ${listed.map(a => `${a} "${game.controls[a]}"`).join(', ')}; every listed control must do something the player sees on their own screen. ` +
      'If the game is on an older kit, run node research/gf-three/tools/upgrade.mjs <game> (aim at the crosshair, press to collect, prompts); otherwise fix the binding in rules.js or remove the control from config/game.json → controls.' +
      (results.some(r => r.ok) ? ` Working: ${results.filter(r => r.ok).map(r => r.action).join(', ')}.` : '');
  return { ok, detail, warnings, record: { listed, limits: L, observation: results.some(r => r.legacy) ? 'shared state (older kit)' : 'controls()', results, seconds: Math.round((Date.now() - t0) / 1000) } };
}

/** Walk to the nearest interactable (real keys), press its action, see it change. */
async function interact({ p, obs, game, words, shot, L }) {
  const o0 = await obs();
  let list = interactablesOf(o0, game).filter(t => (t.action ?? 'interact') === 'interact');
  const key = { interact: 'KeyE' };
  if (!list.length) {
    // nothing exposed: E where the player stands must change some state
    const before = JSON.stringify([o0.shared, o0.rules, o0.scores, o0.controls?.me]);
    await p.keyboard.press('KeyE'); await sleep(500);
    const o1 = await obs();
    const changed = JSON.stringify([o1.shared, o1.rules, o1.scores, o1.controls?.me]) !== before;
    return { action: 'interact', words, ok: changed, why: changed ? 'E changed the game state (no mechanic exposes interactables; the rules handle it)' : 'E changed nothing, and no mechanic exposes anything to interact with (pickup spots that take a press, a free station, a carry item): bind interact in a mechanic (pickup collect "both", station action "interact", carry grabAction "interact") or in rules.js, or remove controls.interact' };
  }
  // calibrate: which way W and D move the player (the camera does not turn: the mouse stays still)
  const step = async k => { const a = (await obs()).me; await p.keyboard.down(k); await sleep(200); await p.keyboard.up(k); await sleep(260); const b = (await obs()).me; const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz); return l > 0.05 ? [dx / l, dz / l] : null; };
  const f = await step('KeyW'), rt = await step('KeyD');
  if (!f || !rt) return { action: 'interact', words, ok: false, why: 'the player did not move on W or D, so the check could not walk to anything to interact with (is the controller held?)' };
  const tried = [];
  const deadline = Date.now() + L.WALK_SECONDS * 1000;
  for (const first of list.slice(0, 3)) {
    let t = first, best = Infinity, stall = 0, arrived = false;
    const want = t.touch > 0 ? (t.touch + t.reach) / 2 : t.reach * 0.6;
    while (Date.now() < deadline) {
      const o = await obs(), me = o.me;
      t = interactablesOf(o, game).find(x => x.id === first.id);
      if (!t) break;                                                  // taken by touch on the way, or gone
      const dx = t.x - me.x, dz = t.z - me.z, d = Math.hypot(dx, dz);
      if (d <= want + 0.2 && d >= (t.touch || 0) + 0.15) { arrived = true; break; }
      if (d < best - 0.15) { best = d; stall = 0; } else if (++stall > 6) break;
      const go = d > want ? 1 : -1, ux = dx / d * go, uz = dz / d * go;
      const pf = ux * f[0] + uz * f[1], pr = ux * rt[0] + uz * rt[1];
      const keys = []; if (pf > 0.38) keys.push('KeyW'); if (pf < -0.38) keys.push('KeyS'); if (pr > 0.38) keys.push('KeyD'); if (pr < -0.38) keys.push('KeyA');
      for (const k of keys) await p.keyboard.down(k);
      await sleep(Math.max(45, Math.min(220, Math.abs(d - want) * 85)));
      for (const k of keys) await p.keyboard.up(k);
      await sleep(200);
    }
    if (!arrived || !t) { tried.push(`${first.kind} ${first.id}: ${!t ? 'gone before the press (touched on the way)' : 'could not walk there'}`); continue; }
    await sleep(250);
    const o1 = await obs(), at = r2(Math.hypot(t.x - o1.me.x, t.z - o1.me.z)), prompt = o1.controls?.prompt ?? null;
    if (!unchanged(t, o1, game)) { tried.push(`${t.id}: changed before the press`); continue; }
    await shot(p, 'controls-interact-near');
    const k = key[t.action ?? 'interact'] ?? 'KeyE';
    if (t.kind === 'station' && t.mode === 'tap') { for (let i = 0; i < Math.min(40, t.taps ?? 8); i++) { await p.keyboard.press(k); await sleep(70); } }
    else if (t.kind === 'station' && t.mode === 'hold') { await p.keyboard.down(k); await sleep(Math.min(8000, (t.seconds ?? 3) * 1000 + 400)); await p.keyboard.up(k); }
    else { await p.keyboard.down(k); await sleep(100); await p.keyboard.up(k); }
    await sleep(450);
    const o2 = await obs();
    await shot(p, 'controls-interact-after');
    const changed = !unchanged(t, o2, game);
    const what = t.kind === 'pickup' ? 'took the pickup' : t.kind === 'carry' ? 'picked the item up' : 'worked the station';
    if (changed) return { action: 'interact', words, ok: true, kind: t.kind, at, prompt, why: `E ${at} m from a ${t.kind} (touch ${t.touch || 0} m, press ${t.reach} m) ${what}${prompt ? `; the HUD said "${prompt}"` : ''}`, legacy: !!t.legacy };
    return { action: 'interact', words, ok: false, kind: t.kind, at, prompt, legacy: !!t.legacy,
      why: `E ${at} m from a ${t.kind} (the HUD's "E: ${words}") changed nothing${t.touch ? ` (it is only taken by walking into it, within ${t.touch} m)` : ''}${prompt ? '' : '; no prompt showed near it'}. ` +
        (t.kind === 'pickup' ? 'The kit pickup takes a press of interact within `reach` when collect is "both" (the default since 2026-10-07): upgrade the game\'s kit, and do not set collect "touch" while the HUD lists interact' : t.kind === 'carry' ? 'Check carry grabAction "interact" and reach' : 'Check station action and range') };
  }
  return { action: 'interact', words, ok: false, why: `could not reach anything to interact with in ${L.WALK_SECONDS} s (${tried.join('; ') || 'none tried'})` };
}

/** Hold primary or secondary; look near the crosshair. */
async function fire({ p, obs, png, view, browser, action, words, crosshair, hasObs, game, shot, L }) {
  const released = [];
  for (let i = 0; i < 4; i++) { released.push(await png()); await sleep(170); }
  const o0 = await obs();
  const btn = action === 'primary' ? 'left' : 'right';
  const held = [];
  await p.mouse.down({ button: btn });
  const t1 = Date.now();
  let mid = null;
  let shown = null;
  while (Date.now() - t1 < L.HOLD_MS) { held.push(await png()); if (!mid && Date.now() - t1 > 500) { mid = await obs(); shown = await png(true); } }
  const o1 = await obs();
  await p.mouse.up({ button: btn });
  await sleep(300);
  const o2 = await obs();
  const a = await analyse(browser, released, held, L, view);
  const bestI = a.frames.reduce((bi, f, i) => (f.core + f.near > a.frames[bi].core + a.frames[bi].near ? i : bi), 0), best = a.frames[bestI] ?? { core: 0, near: 0, central: 0 };
  const central = Math.max(0, ...a.frames.map(f => f.central));
  const coreFrames = a.frames.filter(f => f.core >= L.CORE_MIN).length, coreSum = r2(a.frames.reduce((n, f) => n + f.core, 0));
  // what the player saw half a second into the hold (the whole screen, HUD and crosshair included), kept as evidence
  if (shown) await shot(p, `controls-${action}-held`, shown);
  // a world effect: the shared state (paint cells, shots in flight), a score or the rules' observation moved
  const sig = o => JSON.stringify([o.shared, o.scores, o.rules]);
  const world = sig(o0) !== sig(mid ?? o1) || sig(o0) !== sig(o1) || sig(o0) !== sig(o2);
  const paints = (game.mechanics ?? []).some(m => m.id === 'paint' && m.params?.fromProjectile !== false);
  const paintMoved = paints ? JSON.stringify(o0.shared.paint ?? null) !== JSON.stringify(o2.shared.paint ?? null) : null;
  const c = o1.controls ?? mid?.controls ?? null, land = c?.landing ?? mid?.controls?.landing ?? null;
  const landOff = land?.screen ? Math.hypot(land.screen.x - a.w / 2, land.screen.y - a.h / 2) : null;
  // the kit says where it landed: at the crosshair, in view (then one frame that shows it there is enough)
  const landedInView = landOff !== null && landOff <= L.LAND_PX * a.h && !land.hiddenBySelf && !c?.aim?.onSelf;
  const atCrosshair = coreFrames >= L.CORE_FRAMES || (best.core >= 2 * L.CORE_MIN && coreSum >= 4 * L.CORE_MIN) || (landedInView && coreFrames >= 1);
  const fails = [];
  const nearPct = r2(best.near * 100), corePct = r2(best.core * 100), noisePct = r2(a.noiseCore * 100), corePx = Math.round(L.CORE_RADIUS * a.h);
  if (crosshair) {
    if (!atCrosshair) fails.push(`the shot never showed at the crosshair: ${coreFrames} of ${a.frames.length} frames had ${L.CORE_MIN * 100}% or more of the pixels within ${corePx} px of the crosshair changed (the most: ${corePct}%, summed over the frames ${coreSum}; within ${Math.round(L.NEAR_RADIUS * a.h)} px: ${nearPct}%${best.at ? `; what changed was centred at ${best.at[0]},${best.at[1]} px, the crosshair is at ${a.w / 2},${a.h / 2}` : ''})`);
    if (c?.aim?.onSelf) fails.push('the player\'s own character covers the crosshair');
    if (land?.screen) {
      if (landOff > L.LAND_PX * a.h) fails.push(`the shot lands ${Math.round(landOff)} px from the crosshair on screen (limit ${Math.round(L.LAND_PX * a.h)})`);
      if (land.hiddenBySelf) fails.push('where it lands is hidden behind the player\'s own body');
    }
  } else if (central < L.CENTRAL_MIN) fails.push(`nothing changed in the middle of the screen (${r2(central * 100)}%, needs ${L.CENTRAL_MIN * 100}%)`);
  if (paints && !paintMoved) fails.push('no paint changed (the game paints with its shots)');
  if (!world && !fails.length && !crosshair) fails.push('no game state changed');
  const ok = fails.length === 0;
  const holding = (game.mechanics ?? []).some(m => m.id === 'carry') ? ` (holding ${o0.controls?.me?.holding ?? '?'} item${o0.controls?.me?.holding === 1 ? '' : 's'})` : '';
  return {
    action, words, ok, core: corePct, coreFrames, coreSum, near: nearPct, noise: noisePct, central: r2(central * 100), world, paintMoved, frames: a.frames.map(f => [f.core, f.near]),
    aim: c?.aim ?? null, landing: land ?? null, legacy: !hasObs,
    why: ok ? `held ${L.HOLD_MS / 1000} s: the shot showed at the crosshair in ${coreFrames} of ${a.frames.length} frames (up to ${corePct}% of the pixels within ${corePx} px; noise ${noisePct}%)${land?.screen ? `, it lands ${Math.round(Math.hypot(land.screen.x - a.w / 2, land.screen.y - a.h / 2))} px from the crosshair, in view` : ''}${paints ? ', paint changed' : world ? ', the game state changed' : ''}`
      : `held ${L.HOLD_MS / 1000} s${holding}: ${fails.join('; ')}. The player cannot see their own ${action === 'primary' ? 'main' : 'second'} action. ` +
        'Aimed mechanics (projectile, carry throws) land on the point under the crosshair since kit 2026-10-07 (kit/core/aim.js): upgrade the kit; if this action needs something first (an item in hand), make the HUD say so or let the action work without it',
  };
}
