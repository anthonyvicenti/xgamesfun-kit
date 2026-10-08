// gf-three core: the local player's input. Keyboard, mouse (pointer lock, with click-drag look where the page can't
// lock the pointer), and touch (a stick on the left half, look on the right half, buttons the UI draws).
//
//   const input = createInput(canvas);
//   input.update();                       // once per frame, before anything reads it
//   input.move      {x, y}                x right, y forward, length <= 1
//   input.look      {dx, dy}              pixels of look this frame (mouse or touch)
//   input.actions   {primary, secondary, interact, jump}: each {down, pressed, released} (pressed/released: this frame only)
//   input.sprint    true while Shift is held
//   input.enabled   false: everything reads as idle (a card over the game); the world keeps running
//   input.press(action, down)             for on-screen buttons (touch)
//   input.stickState()                    the touch stick while held, for the UI to draw
//
// Keys: WASD or arrows move, Space jumps, mouse button / F / J is primary, right button / Q is secondary, E / K is
// interact, Shift sprints. Escape always gives the mouse back (the browser does it; we never re-take it on our own).
// A blur clears held keys so nothing sticks; it never pauses anything (CONTRACT §3: a live round never pauses).

export const ACTIONS = ['primary', 'secondary', 'interact', 'jump'];
const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyF: 'primary', KeyJ: 'primary', KeyQ: 'secondary', KeyE: 'interact', KeyK: 'interact', ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
const STICK_RADIUS = 60;

export function createInput(dom, { win = globalThis.window } = {}) {
  const held = new Set();                       // logical names held by keys
  const btn = { primary: 0, secondary: 0, interact: 0, jump: 0 };       // held by mouse / touch buttons (counts)
  const presses = { primary: 0, secondary: 0, interact: 0, jump: 0 };   // presses since the last update
  const releases = { primary: 0, secondary: 0, interact: 0, jump: 0 };
  const actions = Object.fromEntries(ACTIONS.map(a => [a, { down: false, pressed: false, released: false }]));
  const state = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, actions, sprint: false, enabled: true, locked: false, touch: false, lastInput: 0 };
  let lookX = 0, lookY = 0, dragging = false, lastX = 0, lastY = 0, lockFailed = false;
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, lookTouch = { id: null, x: 0, y: 0 };

  const down = name => { if (ACTIONS.includes(name)) { if (!isHeld(name)) presses[name]++; } held.add(name); state.lastInput = performance.now(); };
  const up = name => { held.delete(name); if (ACTIONS.includes(name) && !isHeld(name)) releases[name]++; };
  const isHeld = name => held.has(name) || btn[name] > 0;

  const onKey = e => {
    const name = KEYMAP[e.code];
    if (!name) return;
    if (e.type === 'keydown') { if (!e.repeat) down(name); else held.add(name); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
    else up(name);
  };
  const press = (action, isDown) => {
    if (!ACTIONS.includes(action)) return;
    if (isDown) { if (!isHeld(action)) presses[action]++; btn[action]++; state.lastInput = performance.now(); }
    else { btn[action] = Math.max(0, btn[action] - 1); if (!isHeld(action)) releases[action]++; }
  };
  const mouseAction = b => (b === 0 ? 'primary' : b === 2 ? 'secondary' : null);
  const onMouseDown = e => {
    if (e.target !== dom) return;
    const a = mouseAction(e.button);
    const locked = win.document.pointerLockElement === dom;
    if (!locked && e.button === 0 && dom.requestPointerLock && !lockFailed) {
      // The click that takes the mouse only takes the mouse (a player expects it, and it keeps a menu click from firing).
      try { const r = dom.requestPointerLock(); if (r?.catch) r.catch(() => { lockFailed = true; }); } catch { lockFailed = true; }
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      return;
    }
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    if (a) press(a, true);
  };
  const onMouseUp = e => { dragging = false; const a = mouseAction(e.button); if (a && btn[a] > 0) press(a, false); };
  const onMouseMove = e => {
    if (win.document.pointerLockElement === dom) { lookX += e.movementX || 0; lookY += e.movementY || 0; }
    else if (dragging) { lookX += e.clientX - lastX; lookY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
  };
  const onContext = e => { if (e.target === dom) e.preventDefault(); };
  const onLock = () => { state.locked = win.document.pointerLockElement === dom; };
  const onBlur = () => { held.clear(); for (const a of ACTIONS) btn[a] = 0; dragging = false; stick.id = null; lookTouch.id = null; };

  const onTouchStart = e => {
    state.touch = true;
    for (const t of e.changedTouches) {
      if (t.target !== dom) continue;
      if (t.clientX < win.innerWidth / 2 && stick.id === null) Object.assign(stick, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
      else if (lookTouch.id === null) Object.assign(lookTouch, { id: t.identifier, x: t.clientX, y: t.clientY });
    }
    if (e.target === dom) e.preventDefault();
  };
  const onTouchMove = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { stick.x = t.clientX - stick.ox; stick.y = t.clientY - stick.oy; }
      else if (t.identifier === lookTouch.id) { lookX += (t.clientX - lookTouch.x) * 1.4; lookY += (t.clientY - lookTouch.y) * 1.4; lookTouch.x = t.clientX; lookTouch.y = t.clientY; }
    }
  };
  const onTouchEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; }
      if (t.identifier === lookTouch.id) lookTouch.id = null;
    }
  };

  win.addEventListener('keydown', onKey); win.addEventListener('keyup', onKey);
  win.addEventListener('mousedown', onMouseDown); win.addEventListener('mouseup', onMouseUp); win.addEventListener('mousemove', onMouseMove);
  win.addEventListener('contextmenu', onContext); win.addEventListener('blur', onBlur);
  win.document.addEventListener('pointerlockchange', onLock);
  dom.addEventListener('touchstart', onTouchStart, { passive: false });
  win.addEventListener('touchmove', onTouchMove, { passive: true });
  win.addEventListener('touchend', onTouchEnd); win.addEventListener('touchcancel', onTouchEnd);

  function update() {
    const on = state.enabled;
    let x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0), y = (held.has('fwd') ? 1 : 0) - (held.has('back') ? 1 : 0);
    if (stick.id !== null) { x += stick.x / STICK_RADIUS; y -= stick.y / STICK_RADIUS; }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    state.move.x = on ? x : 0; state.move.y = on ? y : 0;
    state.look.dx = on ? lookX : 0; state.look.dy = on ? lookY : 0; lookX = lookY = 0;
    state.sprint = on && held.has('sprint');
    for (const a of ACTIONS) {
      const s = actions[a];
      s.pressed = on && presses[a] > 0; s.released = on && releases[a] > 0;
      s.down = on && (isHeld(a) || s.pressed);
      presses[a] = 0; releases[a] = 0;
    }
  }

  function dispose() {
    win.removeEventListener('keydown', onKey); win.removeEventListener('keyup', onKey);
    win.removeEventListener('mousedown', onMouseDown); win.removeEventListener('mouseup', onMouseUp); win.removeEventListener('mousemove', onMouseMove);
    win.removeEventListener('contextmenu', onContext); win.removeEventListener('blur', onBlur);
    win.document.removeEventListener('pointerlockchange', onLock);
    dom.removeEventListener('touchstart', onTouchStart); win.removeEventListener('touchmove', onTouchMove);
    win.removeEventListener('touchend', onTouchEnd); win.removeEventListener('touchcancel', onTouchEnd);
  }

  /** The touch stick while a finger holds it (for the UI to draw): {ox, oy, x, y, r}, else null. */
  const stickState = () => (stick.id === null ? null : { ox: stick.ox, oy: stick.oy, x: stick.x, y: stick.y, r: STICK_RADIUS });
  return Object.assign(state, { update, press, dispose, stickState });
}

/** An idle action set (bots and remote players start from it). */
export function idleActions() { return Object.fromEntries(ACTIONS.map(a => [a, { down: false, pressed: false, released: false }])); }
