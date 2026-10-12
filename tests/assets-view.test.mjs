// Art & sound (studio/tabs/assets.js): its pure part, studio/lib/assets-view.js. Which tile a slot is, which slots the
// gallery shows by default, the title card, the sections in the game's group order, a sound list as tiles, a dropped
// file checked against its slot, and a waveform's peaks. The page itself is driven in real Chrome by
// tests/studio-layout-shots.mjs and tests/try-it-shots.mjs; a real game's slots are read here too (listSlots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createGame } from '../lib/create.mjs';
import { listSlots } from '../lib/slots.mjs';
import { tempDir } from './helpers.mjs';
import { dropProblem, sheetCell, firstSource, inGallery, licenceWords, mono, peaks, sectionCount, sections, sizeWords, slotDetails, soundDetails, soundsOf, tileKind, titleCard } from '../studio/lib/assets-view.js';

const file = (id, type, f, extra = {}) => ({ id, label: id, kind: 'file', type, file: f, group: 'props', bytes: 2048, ...extra });
const value = (id, type, v, extra = {}) => ({ id, label: id, kind: 'value', type, value: v, group: 'look', ...extra });

test('tileKind: files by type (a texture the page cannot show is its own kind), values by type, numbers are settings', () => {
  assert.equal(tileKind(file('a', 'model', 'a.glb')), 'model');
  assert.equal(tileKind(file('a', 'image', 'a.png')), 'image');
  assert.equal(tileKind(file('a', 'texture', 'a.ktx2')), 'texture');
  assert.equal(tileKind(file('a', 'texture', 'a.png')), 'image');
  assert.equal(tileKind(file('a', 'audio', 'a.ogg')), 'audio');
  assert.equal(tileKind(file('a', 'font', 'a.woff2')), 'font');
  assert.equal(tileKind(file('a', 'data', 'a.json')), 'data');
  assert.equal(tileKind(value('a', 'text', 'Hi')), 'text');
  assert.equal(tileKind(value('a', 'text', 'day', { constraints: { enum: ['day', 'night'] } })), 'setting');
  assert.equal(tileKind(value('a', 'color', '#ff0000')), 'colour');
  assert.equal(tileKind(value('a', 'colors', ['#ff0000'])), 'colours');
  for (const t of ['number', 'integer', 'boolean', 'enum', 'json']) assert.equal(tileKind(value('a', t, 1)), 'setting', t);
  assert.equal(tileKind({ id: 'x', kind: 'other' }), 'other');
  assert.equal(inGallery(value('a', 'number', 3)), false, 'numbers are the Settings tool\'s');
  assert.equal(inGallery(value('a', 'color', '#000000')), true);
});

test('titleCard: the kit\'s title, tagline and goal in that order; without them the text group\'s first three', () => {
  const slots = [value('ui.goal', 'text', 'g', { group: 'text' }), value('ui.title', 'text', 'T', { group: 'text' }), value('ui.hook', 'text', 'h', { group: 'text' }), value('ui.again', 'text', 'Again', { group: 'text' })];
  const c = titleCard(slots);
  assert.equal(c.title.id, 'ui.title');
  assert.deepEqual(c.lines.map(s => s.id), ['ui.hook', 'ui.goal']);
  const other = titleCard([value('name', 'text', 'N', { group: 'text' }), value('line', 'text', 'L', { group: 'text' })]);
  assert.equal(other.title.id, 'name'); assert.deepEqual(other.lines.map(s => s.id), ['line']);
  assert.equal(titleCard([value('n', 'number', 1)]), null);
});

test('sections: the game\'s group order, files and colours and words apart, the card\'s words not twice, numbers only with every, sounds last', () => {
  const groups = [{ id: 'text', label: 'Title & text' }, { id: 'characters', label: 'Characters' }, { id: 'props', label: 'Props' }, { id: 'rules', label: 'Rules' }];
  const slots = [
    value('ui.title', 'text', 'T', { group: 'text' }), value('ui.hook', 'text', 'H', { group: 'text' }), value('ui.again', 'text', 'Again', { group: 'text' }),
    file('prop.bench', 'model', 'b.glb'), value('prop.count', 'integer', 3, { group: 'props' }),
    file('character.body.player', 'model', 'body.glb', { group: 'characters' }), value('character.tint.player', 'colors', ['#ff0000'], { group: 'characters' }),
    value('round.seconds', 'integer', 60, { group: 'rules' }),
    value('odd', 'color', '#123456', { group: null }),
  ];
  const sounds = soundsOf({ sounds: { hit: { label: 'A hit', src: { preset: 'hit' } }, theme: { label: 'Theme', bus: 'music', src: { file: 'audio/theme.ogg' }, loop: true } } });
  const card = titleCard(slots);
  const s = sections({ slots, groups, sounds, card });
  assert.deepEqual(s.map(x => x.id), ['text', 'characters', 'props', 'other', 'sounds', 'music']);
  assert.deepEqual(s[0].texts.map(x => x.id), ['ui.again'], 'the title is on the card, not again in the list');
  assert.deepEqual(s[1].files.map(x => x.id), ['character.body.player']);
  assert.deepEqual(s[1].colours.map(x => x.id), ['character.tint.player']);
  assert.equal(s[2].settings.length, 0, 'no numbers by default');
  assert.equal(s.find(x => x.id === 'other').label, 'Other');
  assert.equal(sectionCount(s.find(x => x.id === 'sounds')), 1);
  const all = sections({ slots, groups, sounds: [], every: true, card });
  assert.deepEqual(all.map(x => x.id), ['text', 'characters', 'props', 'rules', 'other']);
  assert.deepEqual(all.find(x => x.id === 'props').settings.map(x => x.id), ['prop.count']);
});

test('soundsOf: the sound list as tiles; music and ambience apart; a variation list plays its first', () => {
  const list = soundsOf({ version: 1, sounds: { a: { src: [{ preset: 'x' }, { preset: 'y' }] }, b: { label: 'Rain', bus: 'ambient', src: { file: 'r.ogg' }, loop: true }, c: null } });
  assert.deepEqual(list.map(s => [s.id, s.label, s.kind]), [['a', 'a', 'sound'], ['b', 'Rain', 'music']]);
  assert.deepEqual(firstSource(list[0].src), { preset: 'x' });
  assert.deepEqual(soundsOf(null), []);
  const d = Object.fromEntries(soundDetails(list[0]));
  assert.equal(d.Sound, 'sounds.a'); assert.equal(d['Made from'], 'preset "x"'); assert.equal(d.Variations, '2');
});

test('dropProblem: a file of the slot\'s kind is taken, another is refused in words', () => {
  assert.equal(dropProblem(file('m', 'model', 'a.glb'), 'barrel.GLB'), null);
  assert.match(dropProblem(file('m', 'model', 'a.glb'), 'notes.txt'), /takes \.glb files, not \.txt/);
  assert.equal(dropProblem(file('i', 'image', 'a.png'), 'pic.webp'), null);
  assert.equal(dropProblem(file('s', 'audio', 'a.ogg'), 'boom.wav'), null);
});

test('peaks: the loudest sample per bucket, scaled to 1; silence stays flat; mono mixes channels', () => {
  const s = new Float32Array(100);
  for (let i = 0; i < 50; i++) s[i] = (i % 2 ? -0.5 : 0.25);
  const p = peaks(s, 4);
  assert.equal(p.length, 4);
  assert.deepEqual([...p], [1, 1, 0, 0]);
  assert.deepEqual([...peaks(new Float32Array(10), 3)], [0, 0, 0]);
  assert.equal(peaks([], 5).length, 5);
  const quiet = peaks(Float32Array.from([0.01, 0.02, 0.005, 0.01]), 2);
  assert.ok(Math.abs(quiet[0] - 1) < 1e-6 && quiet[1] > 0.4, 'a quiet sound still draws');
  assert.deepEqual([...mono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])], [0.5, 0.5]);
});

test('details: ids, types, sizes and the licence in words (behind the tile\'s ⓘ, never on it)', () => {
  assert.equal(sizeWords(null), 'missing'); assert.equal(sizeWords(500), '500 B'); assert.equal(sizeWords(22580), '22 KB'); assert.equal(sizeWords(3 * 1024 * 1024), '3.0 MB');
  const d = Object.fromEntries(slotDetails(file('prop.bench', 'model', 'assets/models/bench.glb', { tier: 'advanced', license: { spdx: 'CC0-1.0', author: 'Kenney' } })));
  assert.equal(d.Slot, 'prop.bench'); assert.equal(d.File, 'assets/models/bench.glb'); assert.equal(d.Size, '2 KB');
  assert.equal(d.Licence, 'CC0-1.0 · by Kenney');
  assert.equal(licenceWords('MIT'), 'MIT');
});

test('a made game\'s slots: the gallery shows its title card, characters and props, and leaves its numbers to Settings', async t => {
  const tmp = await tempDir();
  t.after(tmp.cleanup);
  const game = path.join(tmp.dir, 'pillow-brawl');
  await createGame(game, { spec: new URL('./fixtures/pillow-brawl.spec.json', import.meta.url).pathname });
  const r = await listSlots(game);
  const slots = r.slots.filter(inGallery);
  const card = titleCard(slots);
  assert.equal(card.title.value, 'Pillow Brawl');
  assert.deepEqual(card.lines.map(s => s.id), ['ui.hook', 'ui.goal']);
  const s = sections({ slots, groups: r.groups, card });
  const ids = s.map(x => x.id);
  assert.ok(ids.includes('characters') && ids.includes('props'), ids.join());
  assert.ok(!ids.includes('rules') && !ids.includes('controls'), 'groups of only numbers are not in the gallery');
  assert.ok(s.find(x => x.id === 'props').files.every(f => tileKind(f) === 'model'));
  assert.ok(s.every(x => x.settings.length === 0));
});

test('sheetCell: a 2D body sheet shows its first frame; a row of square cells is a sheet; a plain picture is not', () => {
  assert.deepEqual(sheetCell({ id: 'character.body.player' }, 1536, 768), { x: 0, y: 0, w: 256, h: 256 });
  assert.deepEqual(sheetCell({ id: 'prop.coin' }, 128, 32), { x: 0, y: 0, w: 32, h: 32 });
  assert.equal(sheetCell({ id: 'prop.coin' }, 64, 64), null);
  assert.equal(sheetCell({ id: 'world.tiles.ground' }, 300, 128), null);
  assert.equal(sheetCell({ id: 'x' }, 0, 0), null);
});
