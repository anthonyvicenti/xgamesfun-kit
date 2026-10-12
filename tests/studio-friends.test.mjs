// The Play with friends tab's pure parts (studio/tabs/friends/room.js): the room read from the multiplayer kit's
// snapshot, the steps that tick off, the controls drawn as keys, and when online play is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlRows, initial, onlineOn, roomFrom, stepsFor } from '../studio/tabs/friends/room.js';

const snap = (racers, extra = {}) => ({ code: 'ABCD', host: true, you: 'p1', round: 0, room: 'lobby', racers: racers.map(id => ({ id })), names: { p1: 'Ana', p2: 'Ben' }, colors: [{ id: 'p1', color: '#ff0' }, { id: 'p2', color: '#0ff' }], ...extra });

test('the room from the kit\'s snapshot', () => {
  const r = roomFrom(snap(['p1', 'p2']));
  assert.equal(r.code, 'ABCD');
  assert.deepEqual(r.players.map(p => [p.name, p.color, p.you, p.host]), [['Ana', '#ff0', true, true], ['Ben', '#0ff', false, false]]);
  assert.equal(roomFrom(null).code, null);
  assert.equal(roomFrom(null, 'WXYZ').code, 'WXYZ');
  assert.equal(roomFrom({ code: '<script>' }).code, null);
  assert.equal(roomFrom({ ...snap(['p1', 'p2']), racers: [{ id: 'p1' }, { id: 'p2', watching: true }] }).players.length, 1);
});

test('the steps tick off as they happen, one is "now"', () => {
  const states = s => s.map(x => x.state).join(' ');
  assert.equal(states(stepsFor(roomFrom(null))), 'now todo todo todo');
  assert.equal(states(stepsFor(roomFrom(snap(['p1'])))), 'done now todo todo');
  assert.equal(states(stepsFor(roomFrom(snap(['p1'])), { opened: true })), 'done done now todo');
  assert.equal(states(stepsFor(roomFrom(snap(['p1', 'p2'])))), 'done done done now');
  assert.equal(states(stepsFor(roomFrom(snap(['p1', 'p2'], { round: 1, room: 'playing' })))), 'done done done done');
  assert.match(stepsFor(roomFrom(snap(['p1'])))[0].note, /ABCD/);
  assert.deepEqual(stepsFor(roomFrom(null)).map(s => s.label), ['Host a room', 'Open your friend\'s tab', 'Your friend joins', 'Start playing']);
});

test('the controls as keys: moving and looking first, then the game\'s own words', () => {
  const rows = controlRows({ primary: 'swing your pillow', secondary: 'big swing', interact: 'grab a feather', jump: 'dash' }, { camera: 'third' });
  assert.deepEqual(rows.map(r => r.id), ['move', 'look', 'primary', 'secondary', 'interact', 'jump']);
  assert.deepEqual(rows[0].keys.map(k => k.label), ['W', 'A', 'S', 'D']);
  assert.equal(rows[1].keys[0].kind, 'mouse');
  assert.equal(rows[2].words, 'Swing your pillow');
  assert.deepEqual(rows[2].keys.map(k => k.kind === 'mouse' ? `mouse:${k.button}` : k.label), ['mouse:left', 'F']);
  assert.deepEqual(rows[3].keys.map(k => k.kind === 'mouse' ? `mouse:${k.button}` : k.label), ['mouse:right', 'Q']);
  assert.deepEqual(rows[4].keys.map(k => k.label), ['E']);
  assert.deepEqual(rows[5].keys.map(k => k.label), ['Space']);
  // a side view: left and right only, no mouse look
  const side = controlRows({ jump: 'jump' }, { camera: 'side' });
  assert.deepEqual(side.map(r => r.id), ['move', 'jump']);
  assert.deepEqual(side[0].keys.map(k => k.label), ['A', 'D']);
  // a control the kit does not know: its own name as the key
  assert.equal(controlRows({ R: 'reload' }, { camera: 'first' }).at(-1).keys[0].label, 'R');
  assert.deepEqual(controlRows(undefined).map(r => r.id), ['move', 'look']);
});

test('online play: the game info first, else the page\'s online line', () => {
  assert.equal(onlineOn({ online: { use: 'online' } }, null), true);
  assert.equal(onlineOn({ online: { use: 'this-machine' } }, { signal: 'online' }), false);
  assert.equal(onlineOn({}, { signal: 'online' }), true);
  assert.equal(onlineOn({}, null), false);
});

test('initials', () => {
  assert.equal(initial('ana'), 'A');
  assert.equal(initial('  ✨ Zed'), 'Z');
  assert.equal(initial(''), '?');
});
