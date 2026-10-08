#!/usr/bin/env node
// gf-three play: a small black-box play harness for the play-tester (research/studio-v2/prompts/playtest.md).
// It plays a game the way a new player does, with real keys and mouse in headless Chrome on the real GPU
// (research/foundations/qa/browser.mjs), and records what the player sees: screenshots of their own view and the
// HUD text. It never reads the game's code or config.
//
//   node research/gf-three/tools/play.mjs <game dir | url> --script steps.json --out <dir> [--steps '<json>'] [--size 1280x720] [--headed] [--json]
//
// A game folder is served by tools/serve.mjs on a free port; a URL is played as it is. The step language is in
// tools/lib/play-script.mjs (start, hold, press, move, look, wait, shot, snap, until, again, click). Prints one line per
// step (the phase, the round clock, my score and state, the HUD meters and hints, any screenshot path) and writes
// <out>/play.json (every step with its state, the console errors) and <out>/NN-<name>.jpg screenshots.
// A 60 s script takes about a minute. GF_PLAY_SOFTWARE=1 renders in software (slow; for a machine with no GPU).
// Exit: 0 every step ran, 1 a step failed (play.json still written), 2 bad usage or a bad script.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript } from './lib/play-script.mjs';
import { launchChrome, GPU_TROUBLE } from '../../foundations/qa/browser.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;

// What a player can see, read in the page: the phase and clock, every player's score and state, and the HUD's words
// (meters with their fill, the hint line, the banner, toasts, the scoreboard, the help line, a card and its text).
const OBSERVE = () => {
  const s = window.__game?.snapshot?.() ?? null;
  const ui = document.getElementById('gf-ui');
  let hud = null;
  if (ui && ui.style.display !== 'none') {
    const shown = e => { if (!e) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.05; };
    const q = sel => ui.querySelector(sel);
    const text = e => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const card = document.getElementById('gf-card');
    hud = {
      timer: shown(q('.gf-timer')) ? text(q('.gf-timer')) || null : null,
      meters: [...ui.querySelectorAll('.gf-meter')].filter(shown).map(m => ({ label: text(m.querySelector('b')), pct: Math.round(parseFloat(m.querySelector('u')?.style.width) || 0) })),
      prompt: shown(q('.gf-prompt')) ? text(q('.gf-prompt')) : null,
      banner: q('.gf-banner')?.classList.contains('on') ? text(q('.gf-banner')) : null,
      toasts: [...ui.querySelectorAll('.gf-toast')].map(text).filter(Boolean),
      scores: [...ui.querySelectorAll('.gf-scores > div')].map(d => `${text(d.children[0])} ${text(d.children[1])}`.trim()),
      help: shown(q('.gf-help')) ? text(q('.gf-help')) : null,
      crosshair: shown(q('.gf-cross')),
      card: card && !card.hidden ? { view: card.dataset.view || null, text: (card.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) } : null,
    };
  }
  if (!s) return { phase: null, hud };
  const me = s.players?.find(p => p.local) ?? null;
  const pl = p => ({ name: p.name, you: !!p.local, bot: !!p.bot, score: p.score, anim: p.anim ?? null, control: p.control ?? null, alive: p.alive !== false, down: p.down ?? null });
  return {
    phase: s.phase, round: s.round ?? null, t: s.time?.round ?? null, left: s.time?.left ?? null,
    me: me ? { ...pl(me), x: me.x, z: me.z } : null,
    players: (s.players ?? []).map(pl),
    results: s.phase === 'results' ? (s.results ?? []).map(r => ({ name: r.name ?? r.id, value: r.value })) : undefined,
    winners: s.phase === 'results' ? s.winners ?? [] : undefined,
    hud,
    locked: document.pointerLockElement != null,
  };
};

/** One compact line for a state (what a player would glance at). */
export function stateLine(st) {
  if (!st) return 'no state';
  if (!st.phase) return 'no game on the page (window.__game is missing)';
  const parts = [`${st.phase}${st.t != null ? ` t=${r1(st.t)}s` : ''}`];
  if (st.hud?.timer) parts.push(`clock ${st.hud.timer}`);
  if (st.me) parts.push(`me: ${st.me.score} pts, ${st.me.anim ?? '?'}${st.me.control === false ? ', NOT in control' : ''}${st.me.alive ? '' : ', out'}`);
  for (const m of st.hud?.meters ?? []) parts.push(`${m.label || 'meter'} ${m.pct}%`);
  if (st.hud?.prompt) parts.push(`hint "${st.hud.prompt}"`);
  if (st.hud?.banner) parts.push(`banner "${st.hud.banner}"`);
  if (st.hud?.toasts?.length) parts.push(`toast "${st.hud.toasts.at(-1)}"`);
  if (st.hud?.card) parts.push(`card ${st.hud.card.view}: "${st.hud.card.text.slice(0, 90)}"`);
  return parts.join(' | ');
}

/**
 * Plays `script` (parsed or not) on `target` (a game folder or a URL). → the record written to <out>/play.json.
 * Options: out (required), log (a line printer), size ('1280x720'), headed.
 */
export async function play(target, script, { out, log = console.log, size = '1280x720', headed = false } = {}) {
  if (!out) throw new Error('play: --out <dir> is required');
  const parsed = script?.steps && Array.isArray(script.steps) && script.seconds !== undefined ? script : parseScript(script);
  const outDir = resolve(out); await mkdir(outDir, { recursive: true });
  const [w, h] = String(size).split('x').map(Number);
  const isUrl = /^https?:\/\//.test(String(target));
  if (!isUrl && !(existsSync(target) && statSync(target).isDirectory())) throw new Error(`play: ${target} is neither a URL nor a game folder`);
  const t0 = Date.now();
  const rec = { schema: 'gf-three-play/1', target: isUrl ? target : resolve(target), started: new Date().toISOString(), size: `${w}x${h}`, notes: [...parsed.notes], steps: [], shots: [], errors: [], ok: true };
  for (const n of parsed.notes) log(`note: ${n}`);
  let srv = null, browser = null;
  try {
    let url = target;
    if (!isUrl) { const { serve } = await import('./serve.mjs'); srv = await serve(target, { port: 0 }); url = srv.url; }
    url = String(url).replace(/[?#].*$/, '');
    const software = process.env.GF_PLAY_SOFTWARE === '1';
    browser = await launchChrome({ headless: !headed, ...(software ? {} : { gpu: 'webgl' }) });
    rec.chrome = browser.version(); rec.renderer = software ? 'software' : 'gpu (webgl)';
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => rec.errors.push(String(e.message).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && !GPU_TROUBLE.test(m.text())) rec.errors.push(m.text().slice(0, 300)); });
    const center = { x: Math.round(w / 2), y: Math.round(h / 2) };
    const cursor = { ...center };
    const observe = () => page.evaluate(OBSERVE).catch(e => ({ phase: null, error: e.message.split('\n')[0] }));
    const phase = () => page.evaluate(() => window.__game?.phase ?? null).catch(() => null);
    const until = async (want, seconds) => { const end = Date.now() + seconds * 1000; for (;;) { const p = await phase(); if (want.includes(p)) return p; if (Date.now() > end) throw new Error(`the game did not reach ${want.join(' or ')} within ${seconds} s (it is in ${p ?? 'no phase'})`); await sleep(200); } };
    const shoot = async (n, name) => { const f = `${String(n).padStart(2, '0')}-${name}.jpg`; await page.screenshot({ path: join(outDir, f), type: 'jpeg', quality: 80 }); rec.shots.push(f); return join(outDir, f); };
    const down = async k => { if (k === 'Mouse') await page.mouse.down({ button: 'left' }); else if (k === 'MouseRight') await page.mouse.down({ button: 'right' }); else await page.keyboard.down(k); };
    const up = async k => { if (k === 'Mouse') await page.mouse.up({ button: 'left' }); else if (k === 'MouseRight') await page.mouse.up({ button: 'right' }); else await page.keyboard.up(k); };
    // Turning: with the mouse taken (pointer lock) the game reads the movement between mouse events.
    const turn = async (dx, dy, ms = 0) => {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 30)), each = ms / n;
      for (let i = 1; i <= n; i++) { cursor.x += dx / n; cursor.y += dy / n; await page.mouse.move(cursor.x, cursor.y); if (each) await sleep(each); }
    };
    const holdFor = async (st) => {
      for (const k of st.keys) await down(k);
      try {
        if (st.look) await turn(st.look.dx, st.look.dy, st.seconds * 1000 * 0.9);
        else await sleep(st.seconds * 1000);
        return st.shot ? await shoot(rec.steps.length + 1, st.shot) : null;
      } finally { for (const k of [...st.keys].reverse()) await up(k).catch(() => {}); }
    };
    const takeMouse = async () => { await page.mouse.click(cursor.x, cursor.y); await sleep(250); return page.evaluate(() => document.pointerLockElement != null).catch(() => false); };

    for (const [i, st] of parsed.steps.entries()) {
      const n = i + 1, ts = Date.now(), entry = { n, ...st };
      let shot = null;
      try {
        switch (st.do) {
          case 'start': {
            const q = new URLSearchParams({ seed: String(st.seed), bots: String(st.bots), ...(st.quality ? { quality: st.quality } : {}) });
            if (st.round) await page.addInitScript(o => { globalThis.__GF_ASSET_OVERRIDES = o; }, { patches: [{ file: 'config/game.json', pointer: '/round/seconds', value: st.round }] });
            await page.goto(`${url}?${q}`, { waitUntil: 'load', timeout: 90000 });
            await until(['lobby', 'countdown', 'playing'], 90);
            shot = await shoot(0, 'lobby');
            if (await phase() === 'lobby') {
              const b = await page.locator('#gf-play').boundingBox().catch(() => null);
              if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); else await page.keyboard.press('Enter');
            }
            await until(['playing'], 20);
            await page.mouse.move(center.x, center.y); Object.assign(cursor, center);
            entry.mouseTaken = await takeMouse();
            if (!entry.mouseTaken) rec.notes.push('the page did not take the mouse (no pointer lock): looking turns only while a button is held');
            break;
          }
          case 'hold': case 'move': shot = await holdFor(st); break;
          case 'press':
            for (let k = 0; k < st.times; k++) { await down(st.key); await sleep(90); await up(st.key); await sleep(60); }
            if (st.shot) { await sleep(250); shot = await shoot(n, st.shot); }
            break;
          case 'look': await turn(st.dx, st.dy, 250); break;
          case 'wait': await sleep(st.seconds * 1000); break;
          case 'shot': shot = await shoot(n, st.name); break;
          case 'snap': break;
          case 'until': await until([st.phase], st.timeout); break;
          case 'again': {
            const b = await page.locator('#gf-again').boundingBox().catch(() => null);
            if (!b) throw new Error('no "Play again" button on screen (is the round over? this game may not replay)');
            await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
            await until(['countdown', 'playing'], 15); await until(['playing'], 15);
            await page.mouse.move(center.x, center.y); Object.assign(cursor, center);
            entry.mouseTaken = await takeMouse();
            break;
          }
          case 'click': await page.mouse.click(st.x, st.y, { button: st.button }); Object.assign(cursor, { x: st.x, y: st.y }); break;
        }
      } catch (e) { entry.error = e.message.split('\n')[0]; rec.ok = false; }
      const state = await observe();
      entry.state = st.do === 'snap' ? state : { phase: state.phase, t: state.t, left: state.left, me: state.me, hud: state.hud ? { meters: state.hud.meters, prompt: state.hud.prompt, banner: state.hud.banner, toasts: state.hud.toasts, card: state.hud.card } : null };
      if (shot) entry.shot = shot;
      entry.took = r1((Date.now() - ts) / 1000);
      rec.steps.push(entry);
      const what = st.do === 'hold' || st.do === 'move' ? `${st.do} ${st.keys.join('+')} ${st.seconds}s` : st.do === 'press' ? `press ${st.key}${st.times > 1 ? ` x${st.times}` : ''}` : st.do === 'look' ? `look ${st.dx},${st.dy}` : st.do === 'wait' ? `wait ${st.seconds}s` : st.do === 'until' ? `until ${st.phase}` : st.do === 'shot' || st.do === 'snap' ? `${st.do} ${st.name}` : st.do;
      log(`#${n} ${what} → ${entry.error ? `FAILED: ${entry.error} | ` : ''}${stateLine(state)}${shot ? ` | shot ${shot}` : ''}`);
      if (st.do === 'snap') log(`   snap ${st.name}: ${JSON.stringify({ players: state.players?.map(p => `${p.you ? 'YOU' : p.name} ${p.score}${p.bot ? ' (bot)' : ''} ${p.anim ?? ''}${p.control === false ? ' not-in-control' : ''}`), hud: state.hud ? { help: state.hud.help, scores: state.hud.scores, crosshair: state.hud.crosshair } : null, results: state.results })}`);
      if (entry.error || (state.phase === null && st.do !== 'start')) { if (!entry.error) { entry.error = 'the game is gone from the page'; rec.ok = false; } break; }
    }
  } catch (e) {
    rec.ok = false; rec.error = e.message.split('\n')[0]; log(`play stopped: ${rec.error}`);
  } finally {
    await browser?.close().catch(() => {});
    await srv?.close().catch(() => {});
  }
  rec.errors = [...new Set(rec.errors)].slice(0, 20);
  rec.seconds = r1((Date.now() - t0) / 1000);
  await writeFile(join(outDir, 'play.json'), JSON.stringify(rec, null, 2) + '\n');
  log(`play ${rec.ok ? 'ran' : 'FAILED'}: ${rec.steps.length}/${parsed.steps.length} steps in ${rec.seconds} s, ${rec.shots.length} screenshots, ${rec.errors.length} console errors${rec.errors.length ? ` (first: ${rec.errors[0].slice(0, 120)})` : ''} → ${relative(process.cwd(), join(outDir, 'play.json')) || join(outDir, 'play.json')}`);
  return rec;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const target = a.find((x, i) => !x.startsWith('--') && !['--script', '--out', '--steps', '--size'].includes(a[i - 1]));
  const usage = 'usage: play.mjs <game dir | url> --script steps.json --out <dir> [--steps \'<json>\'] [--size 1280x720] [--headed] [--json]';
  if (!target || !opt('--out') || !(opt('--script') || opt('--steps'))) { console.error(usage); process.exit(2); }
  let parsed;
  try { parsed = parseScript(opt('--steps') ?? await readFile(opt('--script'), 'utf8')); }
  catch (e) { console.error(`bad script:\n${e.message}`); process.exit(2); }
  const json = a.includes('--json');
  try {
    const rec = await play(target, parsed, { out: opt('--out'), size: opt('--size') ?? '1280x720', headed: a.includes('--headed'), log: json ? () => {} : console.log });
    if (json) process.stdout.write(JSON.stringify(rec, null, 2) + '\n');
    process.exitCode = rec.ok ? 0 : 1;
  } catch (e) { console.error(e.message); process.exit(2); }
}
