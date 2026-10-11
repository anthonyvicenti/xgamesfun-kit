// verify check 24: plays inside a post (CONTRACT §6d C5, §5). The creator played a game inside a post on X (2026-10-08):
// "The issue is the mouse controls are pretty janky. It doesn't stay in the iframe, you can easily move your mouse out".
// X frames the card sandboxed without allow-pointer-lock, so the lock is refused and looking is click-drag in a small
// card the cursor walks off. The kit offers a full-screen button where the frame allows it (kit/ui/hud.js); full screen
// keeps the cursor on the game. (A cursor-aim camera for refused locks was tried the same day and taken out: "I am not
// sure I like the top down. Can we undo the top down and just have the full screen button".)
//
// The check frames the game the way a post does: a stand-in post page on another origin, a 480×480 iframe sandboxed
// without allow-pointer-lock (allow-scripts allow-same-origin allow-popups allow-forms) that allows full screen.
// With real mouse and keys it:
//   - plays from the home menu (Play);
//   - clicks the game: the frame refuses the lock, and the camera stays the game's own;
//   - the full-screen button is offered; a click makes the game full screen;
//   - in full screen, a drag turns the camera (a third or first camera; others don't look with the mouse) and W moves;
//   - a world in first person (CONTRACT §9): there a click on a block builds on it (where the lock is refused, the aim
//     follows the cursor; the bare page is a practice copy, so nothing is saved);
//   - the button again leaves full screen;
//   - no console errors but the browser's own refusal of the lock.
import { createServer } from 'node:http';
import { findBuildSpot, faces, actOn } from './worlds-check.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(150); } }

export const CARD = 480;
export const POST_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms';
/** The stand-in post: the game in a card-sized frame that refuses the pointer lock and allows full screen. */
export const POST_HTML = gameUrl => `<!doctype html><meta charset="utf-8"><title>A post</title>
<body style="margin:0;background:#000;color:#fff;font:15px system-ui">
<p style="margin:12px">Someone posted a game:</p>
<iframe id="card" src="${gameUrl}" width="${CARD}" height="${CARD}" style="border:0;margin:0 12px;display:block"
 sandbox="${POST_SANDBOX}" allow="autoplay; fullscreen"></iframe></body>`;
// The browser's own words when the frame refuses the lock: expected here, never a game error.
const LOCK_REFUSED = /pointer lock.*sandboxed|allow-pointer-lock/i;
const GPU_NOISE = /GPU stall|ReadPixels|GL_CLOSE_PATH|WebGL: too many errors/i;

export async function checkEmbed({ newPage, url, game = {}, log = () => {}, shot = null }) {
  const gameUrl = `${url}${url.includes('?') ? '&' : '?'}seed=4&bots=1`;
  const html = POST_HTML(gameUrl);
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const postUrl = `http://127.0.0.1:${server.address().port}/status/1`;
  const T = await newPage('post');
  const p = T.page, steps = [], fail = [], warnings = [];
  // the orbit camera (CONTRACT §9) never asks for the lock: the mouse stays free, a drag turns it, a click acts
  // The follow camera (CONTRACT §8, scenic) never asks either: the cursor aims and nothing turns the camera
  // (kit/core/input.js: input.cursorMode true). Until 2026-10-10 it was held to "the frame refused the lock", which a
  // camera that never asks cannot show, so every game with the follow camera failed here on create's untouched output.
  const camera = game.camera ?? 'third', orbit = camera === 'orbit', free = orbit || camera === 'follow', looks = camera === 'third' || camera === 'first' || orbit;
  const record = { camera, steps };
  const step = (name, ok, detail = '') => { steps.push({ name, ok: !!ok, detail }); if (!ok) fail.push(`${name}${detail ? ` (${detail})` : ''}`); return !!ok; };
  const F = p.frameLocator('#card');
  const frame = () => p.frames().find(f => f !== p.mainFrame());
  const gm = fn => frame()?.evaluate(fn).catch(() => null);
  const cam = () => gm(() => window.__game?.camera?.() ?? null);
  const me = () => gm(() => window.__game.players.find(x => x.local));
  try {
    await p.goto(postUrl, { waitUntil: 'load' });
    await until(() => gm(() => window.__game?.menu?.()?.view === 'home'), 90000, 'the game\'s home menu');
    await F.locator('#gf-play').first().click({ timeout: 5000 });
    await until(() => gm(() => window.__game?.phase === 'playing'), 30000, 'the round to start');
    step('plays from the home menu inside the post', true);
    const b = await p.locator('#card').boundingBox();
    await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.62); await sleep(600);
    const c1 = await cam(); record.afterClick = c1;
    if (!c1) throw new Error('the game has no camera observation (window.__game.camera): a kit before 2026-10-08');
    if (free) step('the camera needs no pointer lock (it never asks), and stays the game\'s own', !c1.locked && c1.mode === camera && c1.cursorMode,
      `locked ${c1.locked}, cursor mode ${c1.cursorMode}, camera ${c1.mode} (the game's: ${camera})`);
    else step('the post\'s frame refuses the pointer lock, and the camera stays the game\'s own', c1.lockRefused && !c1.locked && c1.mode === camera,
      `lock refused ${c1.lockRefused}, locked ${c1.locked}, camera ${c1.mode} (the game's: ${camera})`);
    if (shot) await shot(p, 'post-card');
    // full screen: the frame allows it, so the kit's button must be there and work
    const fs0 = c1.fullscreen;
    if (step('the full-screen button is offered', fs0?.shown, JSON.stringify(fs0))) {
      await F.locator('#gf-fullscreen').click({ timeout: 4000 });
      const on = await until(async () => ((await cam())?.fullscreen?.on ? true : null), 3000, 'full screen').catch(() => false);
      step('the button makes the game full screen', on, '');
      if (on) {
        await sleep(500);
        const vp = p.viewportSize();
        if (looks) {
          // a drag across the screen turns the camera (the lock is still refused: looking is click-drag)
          const y0 = (await cam())?.yaw;
          await p.mouse.move(vp.width * 0.35, vp.height * 0.5); await p.mouse.down();
          await p.mouse.move(vp.width * 0.75, vp.height * 0.5, { steps: 12 }); await p.mouse.up(); await sleep(300);
          const y1 = (await cam())?.yaw;
          const turned = Number.isFinite(y0) && Number.isFinite(y1) ? Math.abs(y1 - y0) : 0;
          step('in full screen a drag turns the camera', turned > 0.2, `yaw ${Number.isFinite(y0) ? y0.toFixed(2) : y0} → ${Number.isFinite(y1) ? y1.toFixed(2) : y1}`);
        } else warnings.push(`plays inside a post: the ${camera} camera does not look with the mouse; the drag step is skipped`);
        const a = await me(); await p.keyboard.down('KeyW'); await sleep(1200); await p.keyboard.up('KeyW'); await sleep(200); const z = await me();
        const moved = a && z ? Math.hypot(z.x - a.x, z.z - a.z) : 0;
        step('in full screen W moves the player', moved > 1, `${Math.round(moved * 10) / 10} m`);
        if (game.round?.mode === 'world' && camera === 'first') {
          // the game's frame as a page: its own reading, the post's keyboard and mouse moved by the frame's offset
          const fr = frame(), box = async () => (await (await fr.frameElement()).boundingBox()) ?? { x: 0, y: 0 };
          const as = { evaluate: (...x) => fr.evaluate(...x), keyboard: p.keyboard, mouse: { move: async (x, y, o) => { const b = await box(); return p.mouse.move(b.x + x, b.y + y, o); }, down: o => p.mouse.down(o), up: o => p.mouse.up(o) } };
          const spot = await findBuildSpot(as);
          if (spot) await actOn(as, faces(spot).ground);
          const placed = spot ? await until(() => fr.evaluate(s => window.__game.voxelAt(s.x, s.top, s.z) || null, spot), 2000, 'the block').catch(() => 0) : 0;
          const c = await cam();
          step('a click on a block builds there (the aim follows the cursor)', placed > 0 && c?.aimFree && !c?.crosshair, spot ? `cell ${spot.x},${spot.top},${spot.z} = ${placed}; aim free ${c?.aimFree}, crosshair ${c?.crosshair}` : 'no spot on screen');
        }
        if (shot) await shot(p, 'post-fullscreen');
        await F.locator('#gf-fullscreen').click({ timeout: 4000 }).catch(() => {});
        const off = await until(async () => ((await cam())?.fullscreen?.on === false ? true : null), 3000, 'back from full screen').catch(() => false);
        step('the button leaves full screen', off, '');
      }
    }
    const errors = T.errors.filter(e => !LOCK_REFUSED.test(e) && !GPU_NOISE.test(e));
    step('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) { if (!fail.length) fail.push(e.message); }
  finally { await T.ctx.close().catch(() => {}); await new Promise(r => server.close(r)); }
  const ok = fail.length === 0 && steps.length > 0;
  const detail = ok ? `in a ${CARD}×${CARD} post frame that refuses the lock: the camera stays ${camera}, the full-screen button works${looks ? ', a drag turns the camera' : ''}, W moves` : fail.join('; ');
  log(`embed: ${ok ? 'ok' : 'FAIL'} ${detail.slice(0, 200)}`);
  return { ok, detail, record, warnings };
}
