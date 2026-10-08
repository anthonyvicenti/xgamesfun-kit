// gf-three ui: the HUD, the lobby and results cards, nameplates and touch controls, as a DOM layer over the canvas
// (text and UI only, never art: CONTRACT §2). Colours are CSS custom properties that gf.applyCss() sets from the
// ui.* slots (--gf-accent, --gf-panel, --gf-text); words come from config/game.json → text (ui.* slots).
//
// For rules.js (ctx.ui):
//   ui.meter(id, {label, value, max, color})  → {set(value, max), remove()}     a bar, top left
//   ui.score(rows | null)                      rows [{name, value, color}] replace the kit's scoreboard; null gives it back
//   ui.banner(text, seconds = 2)               big words in the middle
//   ui.toast(text)                              a short line at the top that fades
//   ui.prompt(text | null, owner?)             a hint at the bottom ("E: pick up"). Each owner (a mechanic id; the rules
//                                               when omitted) keeps its own line; the latest one set shows
//   ui.timer(on)                                show or hide the round clock
//   ui.crosshair(on)                            the reticle in the middle of the screen (the kit shows it in third and
//                                               first person when the game has an aimed mechanic: CONTRACT §6d). A ring
//                                               and a dot in the ui.crosshair colour (--gf-cross) with a dark outline, so
//                                               it reads on bright and dark scenes alike (UI, not world art)
//   ui.bars(owner, rows)                        health bars over things in the world, drawn like nameplates (UI, not a
//                                               model): rows [{id, x, y (screen px, the bar's bottom middle), value, max,
//                                               color, visible, hit (true on the frame of a hit: the bar pulses)}]. What a
//                                               hit took stays light for a moment before it drains, so a hit reads. An
//                                               owner's bar missing from its next call is removed
//   ui.pop(text, x, y, color?)                  a short word that rises and fades at a screen point ("+1" for a kill)
//   meter handle .flash()                       the meter pulses once (the local player was hurt)
const CSS = `
#gf-ui{position:fixed;inset:0;pointer-events:none;font:600 15px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--gf-text,#fff);z-index:5;user-select:none;-webkit-user-select:none}
#gf-ui .gf-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center}
#gf-ui .gf-timer{background:var(--gf-panel,#1c2133cc);padding:6px 14px;border-radius:999px;font-size:20px;font-variant-numeric:tabular-nums;min-width:62px;text-align:center}
#gf-ui .gf-timer.low{color:#ffd166}
#gf-ui .gf-scores{position:absolute;top:10px;right:10px;background:var(--gf-panel,#1c2133cc);border-radius:12px;padding:6px 10px;min-width:150px}
#gf-ui .gf-scores div{display:flex;justify-content:space-between;gap:12px;padding:2px 0}
#gf-ui .gf-scores i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px}
#gf-ui .gf-meters{position:absolute;top:10px;left:10px;display:flex;flex-direction:column;gap:6px}
#gf-ui .gf-meter{background:var(--gf-panel,#1c2133cc);border-radius:10px;padding:4px 8px;min-width:150px}
#gf-ui .gf-meter b{display:block;font-size:12px;opacity:.85}
#gf-ui .gf-meter span{display:block;height:8px;border-radius:4px;background:#ffffff33;overflow:hidden}
#gf-ui .gf-meter u{display:block;height:100%;background:var(--gf-accent,#ff7a59)}
#gf-ui .gf-banner{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%) scale(.9);font-size:44px;font-weight:800;text-shadow:0 3px 0 #0006;opacity:0;transition:opacity .2s,transform .2s;white-space:nowrap}
#gf-ui .gf-banner.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
#gf-ui .gf-toasts{position:absolute;top:58px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
#gf-ui .gf-toast{background:var(--gf-panel,#1c2133cc);padding:4px 12px;border-radius:999px;transition:opacity .4s}
#gf-ui .gf-prompt{position:absolute;bottom:56px;left:50%;transform:translateX(-50%);background:var(--gf-panel,#1c2133cc);padding:6px 14px;border-radius:999px;display:none}
#gf-ui .gf-help{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);font-size:12px;opacity:.75;white-space:nowrap}
#gf-ui .gf-cross{position:absolute;top:50%;left:50%;width:22px;height:22px;margin:-11px;display:none}
#gf-ui .gf-cross::before{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid var(--gf-cross,#fff);box-shadow:0 0 0 1.5px #000a,inset 0 0 0 1.5px #000a}
#gf-ui .gf-cross::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;border-radius:50%;background:var(--gf-cross,#fff);box-shadow:0 0 0 1.5px #000a}
#gf-ui .gf-plates{position:absolute;inset:0}
#gf-ui .gf-plate{position:absolute;left:0;top:0;padding:2px 8px;border-radius:999px;background:#0008;font-size:13px;white-space:nowrap;will-change:transform}
#gf-ui .gf-plate i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:0}
#gf-ui .gf-bars{position:absolute;inset:0}
#gf-ui .gf-hbar{position:absolute;left:0;top:0;width:58px;height:9px;border-radius:5px;background:#000b;box-shadow:0 0 0 1.5px #000d;overflow:hidden;will-change:transform;transition:box-shadow .12s}
#gf-ui .gf-hbar u{position:absolute;left:0;top:0;bottom:0;background:#fff;transition:width .35s ease-in .3s}
#gf-ui .gf-hbar b{position:absolute;left:0;top:0;bottom:0;background:var(--c,#ff4d5e)}
#gf-ui .gf-hbar.hit{box-shadow:0 0 0 2px #fff}
#gf-ui .gf-pop{position:absolute;left:0;top:0;font-size:26px;font-weight:900;-webkit-text-stroke:1px #000a;text-shadow:0 2px 0 #000a,0 0 8px #0008;pointer-events:none;animation:gf-pop 1s ease-out forwards}
@keyframes gf-pop{0%{opacity:0;margin-top:0}12%{opacity:1}60%{opacity:1}100%{opacity:0;margin-top:-46px}}
#gf-ui .gf-meter{transition:box-shadow .15s}
#gf-ui .gf-meter.hit{box-shadow:0 0 0 2px #fff,0 0 12px #ff5e6caa}
#gf-ui .gf-card{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--gf-panel,#1c2133ee);border-radius:18px;padding:22px 26px;min-width:300px;max-width:min(560px,92vw);text-align:center;pointer-events:auto;box-shadow:0 10px 40px #0005}
#gf-ui .gf-card h1{margin:0 0 6px;font-size:30px}
#gf-ui .gf-card p{margin:6px 0;opacity:.9;font-weight:500}
#gf-ui .gf-card ul{list-style:none;padding:0;margin:10px 0;text-align:left;font-weight:500}
#gf-ui .gf-card li{display:flex;justify-content:space-between;gap:16px;padding:3px 0}
#gf-ui .gf-card button{font:inherit;font-size:18px;border:0;border-radius:999px;padding:10px 28px;margin-top:12px;background:var(--gf-accent,#ff7a59);color:#fff;cursor:pointer}
#gf-ui .gf-card .gf-count{font-size:72px;font-weight:800;margin:0}
#gf-ui .gf-card.count{background:transparent;box-shadow:none}
#gf-ui .gf-touch{position:absolute;inset:0;display:none}
#gf-ui .gf-touch.on{display:block}
#gf-ui .gf-touch button{position:absolute;pointer-events:auto;width:66px;height:66px;border-radius:50%;border:0;background:#ffffff33;color:#fff;font:700 13px system-ui;touch-action:none}
#gf-ui .gf-stick{position:absolute;width:120px;height:120px;margin:-60px;border-radius:50%;border:2px solid #fff6;display:none}
#gf-ui .gf-stick u{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px;border-radius:50%;background:#fff8}
@media (max-width:640px){#gf-ui .gf-card h1{font-size:24px}#gf-ui .gf-banner{font-size:32px}#gf-ui .gf-help{display:none}#gf-ui .gf-top{left:10px;transform:none}#gf-ui .gf-timer{font-size:17px}#gf-ui .gf-scores{top:8px;right:8px;min-width:0;font-size:12px;padding:4px 8px}#gf-ui .gf-meters{top:52px}#gf-ui .gf-hbar{width:48px;height:8px}#gf-ui .gf-pop{font-size:20px}}
`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export function createUI(ctx, { text = {}, controls = {} } = {}) {
  const style = el('style'); style.textContent = CSS; document.head.append(style);
  const root = el('div'); root.id = 'gf-ui'; document.body.append(root);
  const top = el('div', 'gf-top'), timerEl = el('div', 'gf-timer'); top.append(timerEl);
  const scores = el('div', 'gf-scores'), meters = el('div', 'gf-meters'), banner = el('div', 'gf-banner'), toasts = el('div', 'gf-toasts');
  const prompt = el('div', 'gf-prompt'), help = el('div', 'gf-help'), cross = el('div', 'gf-cross'), plates = el('div', 'gf-plates'), barsEl = el('div', 'gf-bars');
  const card = el('div', 'gf-card'); card.id = 'gf-card'; card.hidden = true;
  const touch = el('div', 'gf-touch'), stickEl = el('div', 'gf-stick'); stickEl.append(el('u')); touch.append(stickEl);
  root.append(plates, barsEl, top, scores, meters, banner, toasts, prompt, help, cross, card, touch);
  const meterMap = new Map(), plateMap = new Map(), prompts = new Map(), barMap = new Map();
  let customRows = null, timerOn = true, bannerT = 0, lastScores = '', lastTimer = '';

  // touch buttons (shown on the first touch)
  const buttons = [['jump', 'Jump', 'right:22px;bottom:22px'], ['primary', short(controls.primary, 'Action'), 'right:100px;bottom:40px'], ['interact', short(controls.interact, 'Use'), 'right:30px;bottom:104px'], ['secondary', short(controls.secondary, ''), 'right:108px;bottom:118px']];
  for (const [action, label, pos] of buttons) {
    if (!label) continue;
    const b = el('button', null, label); b.style.cssText = pos; b.dataset.action = action;
    const on = e => { e.preventDefault(); ctx.input?.press(action, true); }, off = e => { e.preventDefault(); ctx.input?.press(action, false); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    touch.append(b);
  }
  help.textContent = helpLine(controls);

  const api = {
    root,
    meter(id, { label = '', value = 0, max = 1, color = null } = {}) {
      let m = meterMap.get(id);
      if (!m) { const box = el('div', 'gf-meter'), b = el('b', null, label), bar = el('span'), fill = el('u'); bar.append(fill); box.append(b, bar); meters.append(box); m = { box, b, fill }; meterMap.set(id, m); }
      const h = { set(v, mx = max) { m.fill.style.width = `${Math.max(0, Math.min(1, v / (mx || 1))) * 100}%`; }, remove() { m.box.remove(); meterMap.delete(id); },
        flash() { m.box.classList.add('hit'); clearTimeout(m.t); m.t = setTimeout(() => m.box.classList.remove('hit'), 260); } };
      if (label) m.b.textContent = label; if (color) m.fill.style.background = color;
      h.set(value, max); return h;
    },
    score(rows) { customRows = rows; lastScores = ''; },
    banner(t, seconds = 2) { banner.textContent = t; banner.classList.add('on'); bannerT = seconds; },
    toast(t) { const x = el('div', 'gf-toast', t); toasts.append(x); setTimeout(() => { x.style.opacity = '0'; setTimeout(() => x.remove(), 450); }, 1800); while (toasts.children.length > 4) toasts.firstChild.remove(); },
    prompt(t, owner = 'rules') {
      prompts.delete(owner); if (t) prompts.set(owner, String(t));
      const last = [...prompts.values()].pop();
      if (last) { if (prompt.textContent !== last) prompt.textContent = last; prompt.style.display = 'block'; } else prompt.style.display = 'none';
    },
    /** The hint showing now (or null): QA reads it. */
    get promptText() { return prompt.style.display === 'none' ? null : prompt.textContent; },
    timer(on) { timerOn = !!on; timerEl.style.display = on ? '' : 'none'; },
    crosshair(on) { cross.style.display = on ? 'block' : 'none'; },
    bars(owner, rows = []) {
      const seen = new Set();
      for (const r of rows) {
        const key = `${owner}:${r.id}`; seen.add(key);
        let e = barMap.get(key);
        // a new bar starts full behind the fill: the first hit drains from 100%
        if (!e) { e = el('div', 'gf-hbar'); e.dataset.key = key; e.append(el('u'), el('b')); e.firstChild.style.width = '100%'; barsEl.append(e); void e.offsetWidth; barMap.set(key, e); e._w = -1; e._c = ''; }
        const w = Math.round(Math.max(0, Math.min(1, (r.value ?? 0) / (r.max || 1))) * 1000) / 10;
        if (e._w !== w) { e._w = w; e.lastChild.style.width = `${w}%`; e.firstChild.style.width = `${w}%`; e.dataset.frac = String(w / 100); }
        if (r.color && e._c !== r.color) { e._c = r.color; e.style.setProperty('--c', r.color); }
        if (r.hit) { e.classList.add('hit'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('hit'), 160); }
        e.style.display = r.visible ? '' : 'none';
        if (r.visible) e.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px) translate(-50%, -100%)`;
      }
      for (const [key, e] of barMap) if (key.startsWith(`${owner}:`) && !seen.has(key)) { e.remove(); barMap.delete(key); }
    },
    pop(t, x, y, color = null) {
      const e = el('div', 'gf-pop', t); e.style.left = `${Math.round(x)}px`; e.style.top = `${Math.round(y)}px`; e.style.transform = 'translate(-50%, -100%)';
      if (color) e.style.color = color;
      barsEl.append(e); setTimeout(() => e.remove(), 1050);
      while (barsEl.querySelectorAll('.gf-pop').length > 6) barsEl.querySelector('.gf-pop').remove();
    },
    get crosshairOn() { return cross.style.display === 'block'; },
    get covered() { return !card.hidden && !card.classList.contains('count'); },

    // ---- the kit's cards ----
    lobby({ title, hook, players = [], onPlay }) {
      card.className = 'gf-card'; card.dataset.view = 'lobby'; card.replaceChildren(el('h1', null, title), el('p', null, hook));
      const ul = el('ul'); for (const p of players) { const li = el('li'); const n = el('span'); const dot = el('i'); dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:${p.color}`; n.append(dot, p.name); li.append(n, el('span', null, p.isBot ? 'bot' : p.local ? 'you' : '')); ul.append(li); }
      const b = el('button', null, text.play ?? 'Play'); b.id = 'gf-play'; b.onclick = () => { onPlay?.(); };
      card.append(ul, el('p', null, helpLine(controls)), b); card.hidden = false;
    },
    waiting() { card.className = 'gf-card'; card.dataset.view = 'waiting'; card.replaceChildren(el('p', null, text.waiting ?? 'Waiting for everyone…')); card.hidden = false; },
    countdown(n) { card.className = 'gf-card count'; card.dataset.view = 'count'; card.replaceChildren(el('p', 'gf-count', String(n))); card.hidden = false; },
    results({ title, rows = [], winners = [], onAgain = null }) {
      card.className = 'gf-card'; card.dataset.view = 'results';
      const ul = el('ul'); for (const r of rows) { const li = el('li'); li.append(el('span', null, `${winners.includes(r.id) ? '★ ' : ''}${r.name ?? r.id}`), el('span', null, String(r.value ?? ''))); ul.append(li); }
      card.replaceChildren(el('h1', null, title), ul);
      if (onAgain) { const b = el('button', null, text.again ?? 'Play again'); b.id = 'gf-again'; b.onclick = () => onAgain(); card.append(b); }
      card.hidden = false;
    },
    hideCard() { card.hidden = true; card.dataset.view = ''; },
    get view() { return card.hidden ? null : card.dataset.view || null; },

    /** Every frame: the clock, the scoreboard, nameplates, the banner and the touch stick. */
    update(dt, { left = null, players = [], showTimer = true, plates: plateList = [] } = {}) {
      const t = timerOn && showTimer && left !== null ? fmtTime(left) : '';
      if (t !== lastTimer) { lastTimer = t; timerEl.textContent = t; timerEl.style.display = t ? '' : 'none'; timerEl.classList.toggle('low', left !== null && left <= 10); }
      const rows = customRows ?? players.map(p => ({ name: p.name, value: p.score, color: p.color, me: p.local }));
      const key = JSON.stringify(rows);
      if (key !== lastScores) { lastScores = key; scores.replaceChildren(...[...rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).map(r => { const d = el('div'); const n = el('span'); const i = el('i'); i.style.background = r.color ?? '#fff'; n.append(i, `${r.name}${r.me && r.name !== (text.you ?? 'You') ? ' (you)' : ''}`); d.append(n, el('b', null, String(r.value ?? ''))); return d; })); scores.style.display = rows.length ? '' : 'none'; }
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner.classList.remove('on'); }
      // nameplates: {id, text, color, x, y (screen px), visible}
      const seen = new Set();
      for (const p of plateList) {
        seen.add(p.id);
        let e = plateMap.get(p.id);
        if (!e) { e = el('div', 'gf-plate'); const i = el('i'); e.append(i, el('span')); plates.append(e); plateMap.set(p.id, e); e._k = ''; }
        const k = `${p.text}|${p.color}`; if (e._k !== k) { e._k = k; e.firstChild.style.background = p.color; e.lastChild.textContent = p.text; }
        e.style.display = p.visible ? '' : 'none';
        if (p.visible) e.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      }
      for (const [id, e] of plateMap) if (!seen.has(id)) { e.remove(); plateMap.delete(id); }
      if (ctx.input?.touch && !touch.classList.contains('on')) { touch.classList.add('on'); help.style.display = 'none'; }
      const st = ctx.input?.stickState?.();
      if (st) { stickEl.style.display = 'block'; stickEl.style.left = st.ox + 'px'; stickEl.style.top = st.oy + 'px'; const l = Math.min(1, Math.hypot(st.x, st.y) / st.r) * st.r, a = Math.atan2(st.y, st.x); stickEl.firstChild.style.transform = `translate(${Math.cos(a) * l}px, ${Math.sin(a) * l}px)`; }
      else stickEl.style.display = 'none';
    },
  };
  return api;
}

function short(s, d) { if (!s) return d; const w = String(s).split(/\s+/)[0]; return w.charAt(0).toUpperCase() + w.slice(1, 9); }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function helpLine(c = {}) {
  const parts = ['WASD move', 'mouse look'];
  if (c.primary) parts.push(`click / F: ${c.primary}`);
  if (c.secondary) parts.push(`right click / Q: ${c.secondary}`);
  if (c.interact) parts.push(`E: ${c.interact}`);
  if (c.jump) parts.push(`Space: ${c.jump}`);
  return parts.join(' · ');
}
