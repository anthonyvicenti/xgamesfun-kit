// The editors (Map, Skins, Items; track G): their pure parts, and the one route that writes (POST /api/editors/map) on a
// real created flat game. The pages themselves are driven in tests/editors-shots.mjs (real Chrome, real dev server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGame } from '../lib/create.mjs';
import { GF3 } from '../lib/paths.mjs';
import { startDevServer } from '../server/index.mjs';
import { tempDir } from './helpers.mjs';
import { createHistory } from '../studio/lib/editors/history.js';
import { charFor, checkMap, entryAt, fillCells, gridOf, jumpShade, lineCells, paintCells, paletteOf, rectCells, resizeGrid, withGrid } from '../studio/lib/editors/paint.js';
import { addProp, clampTo, duplicateProp, fitView, hitProp, moveProp, propsView, removeProp, rotateProp, scaleProp, snap } from '../studio/lib/editors/layout.js';
import { addRequest, balanceRequest, clampField, fieldRange, firstWords, itemsOf, peersOf } from '../studio/lib/editors/items.js';
import { bodyChoices, drawRequest, loadoutParam, lookAlike, modelRequest, setSeat, sheetFrames, tryOnPath } from '../studio/lib/editors/skins.js';

const kitFlat = async () => ({
  ...(await import(pathToFileURL(path.join(GF3, 'kit/flat/index.js')).href)),
  ...(await import(pathToFileURL(path.join(GF3, 'kit/flat/tilemap.js')).href)),
  SIDE: (await import(pathToFileURL(path.join(GF3, 'kit/flat/slots.js')).href)).SIDE,
});

// a side-on map like the flat example "Coin Hop" (research/gf-three/flat-examples/coin-hop in games.fun)
const ROWS = [
  'B............................B',
  'B............................B',
  'B............o..o............B',
  'B............................B',
  'B..o........======........o..B',
  'B............................B',
  'B.===..====..o..o..====..===.B',
  'B............................B',
  'B....====..========..====....B',
  'B..o......................o..B',
  'B.1...BB..1...BB...1..BB...1.B',
  '##############################',
];
const SIDE_MAP = { format: 'gf-tilemap-1', plane: 'side', tile: 1, kinds: { ground: { solid: true }, brick: { solid: true }, ledge: { solid: 'top' } },
  legend: { '1': 'spawn', '.': null, '#': 'ground', B: 'brick', '=': 'ledge', o: 'mark:coin' }, rows: ROWS };

test('history: push, undo, redo; an edit that changes nothing is not a step; push drops the redo side', () => {
  const h = createHistory({ a: 1 });
  assert.equal(h.canUndo, false);
  assert.equal(h.push({ a: 1 }), false);
  h.push({ a: 2 }); h.push({ a: 3 });
  assert.deepEqual(h.undo(), { a: 2 });
  assert.deepEqual(h.redo(), { a: 3 });
  h.undo(); h.push({ a: 9 });
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.undo(), { a: 2 });
  assert.deepEqual(h.undo(), { a: 1 });
  assert.deepEqual(h.undo(), { a: 1 }, 'nothing left to undo: stays');
});

test('paint: grid round trip, strokes, box, fill, pick, and a new legend character only when one is missing', () => {
  const g = gridOf(SIDE_MAP);
  assert.equal(withGrid(SIDE_MAP, g).rows.join('\n'), ROWS.join('\n'));
  assert.deepEqual(charFor(SIDE_MAP, 'ledge'), { map: SIDE_MAP, ch: '=' });
  const added = charFor(SIDE_MAP, 'mark:gem');
  assert.notEqual(added.map, SIDE_MAP);
  assert.equal(added.map.legend[added.ch], 'mark:gem');
  assert.ok(!(added.ch in SIDE_MAP.legend));
  const line = lineCells({ c: 1, r: 1 }, { c: 6, r: 3 });
  assert.deepEqual(line[0], { c: 1, r: 1 }); assert.deepEqual(line.at(-1), { c: 6, r: 3 });
  for (let i = 1; i < line.length; i++) assert.ok(Math.abs(line[i].c - line[i - 1].c) <= 1 && Math.abs(line[i].r - line[i - 1].r) <= 1, 'a fast drag leaves no gap');
  assert.equal(rectCells({ c: 3, r: 2 }, { c: 1, r: 1 }).length, 6);
  const painted = paintCells(g, [{ c: 1, r: 1 }, { c: 99, r: 1 }], '=');
  assert.equal(painted[1][1], '='); assert.equal(g[1][1], '.', 'the old grid is untouched');
  const filled = fillCells(g, 5, 1, '#');
  assert.equal(filled[0][5], '#', 'the sky joins the top row');
  assert.equal(filled[11][5], '#'); assert.equal(filled[4][12], '=', 'a ledge is not the sky: the fill stops at it');
  assert.equal(entryAt(SIDE_MAP, g, 13, 2), 'mark:coin');
  const pal = paletteOf(SIDE_MAP, { tiles: { ground: 'assets/tiles/ground.png' }, marks: { coin: 'assets/sprites/coin.png' } });
  assert.deepEqual(pal.map(p => p.entry), ['ground', 'brick', 'ledge', 'spawn', 'mark:coin', null]);
  assert.equal(pal.find(p => p.entry === 'mark:coin').slot, 'prop.coin');
});

test('paint: resizing keeps a side-on floor whole and moves the right wall out', () => {
  const g = resizeGrid(gridOf(SIDE_MAP), { cols: 32, rows: 13 }, '.', { plane: 'side' });
  assert.equal(g.length, 13); assert.equal(g[0].length, 32);
  assert.equal(g.at(-1).join(''), '#'.repeat(32), 'the floor runs on');
  assert.equal(g[5].at(-1), 'B', 'the right wall moved out with the edge');
  assert.equal(g[0].join(''), '.'.repeat(32), 'a new row is added at the top');
  assert.equal(resizeGrid(g, { cols: 30, rows: 12 }, '.', { plane: 'side' }).at(-1).length, 30);
});

test('checkMap: the kit says the example map is playable; a ledge painted out of reach is red with words', async () => {
  const kit = await kitFlat();
  const ok = checkMap(SIDE_MAP, { kit, seats: 4 });
  assert.equal(ok.ok, true, ok.errors.join('; '));
  assert.equal(ok.spawns, 4); assert.equal(ok.bad.size, 0);
  assert.ok(ok.reached.size > 20, 'standing places are known');
  // a ledge across the top-left, five rows above anything: nothing reaches it
  const g = paintCells(gridOf(SIDE_MAP), rectCells({ c: 3, r: 1 }, { c: 8, r: 1 }), '=');
  const bad = checkMap(withGrid(SIDE_MAP, g), { kit, seats: 4 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /ledge at column 4, row 1/.test(e) && /cannot be reached/.test(e)), bad.errors.join('; '));
  assert.ok(bad.bad.has('4,1') && bad.bad.has('4,0'), 'the ledge and the place above it are coloured');
  // the shade under the cursor is the reach model's: from the floor it does not reach row 1
  const M = kit.readMap(SIDE_MAP);
  const shade = jumpShade(M, ok.reach, 5, 10);
  assert.ok(shade.some(q => q.r === 8) && !shade.some(q => q.r <= 6));
  // a map the kit refuses outright (a spawn in no legend) says why
  const broken = checkMap({ ...SIDE_MAP, rows: ROWS.map(r => r.replace('1', 'Z')) }, { kit });
  assert.equal(broken.ok, false); assert.ok(broken.errors.some(e => /legend does not name/.test(e)));
});

test('checkMap: from above, a start spot walled in on every side is red', async () => {
  const kit = await kitFlat();
  const rows = ['##########', '#1.......#', '#........#', '#....###.#', '#....#1#.#', '#....###.#', '#........#', '##########'];
  const map = { format: 'gf-tilemap-1', plane: 'top', tile: 1, base: 'grass', kinds: { grass: { solid: false }, wall: { solid: true } }, legend: { '.': null, '#': 'wall', '1': 'spawn' }, rows };
  const r = checkMap(map, { kit, seats: 2 });
  assert.equal(r.ok, false);
  assert.ok(r.bad.has('6,4'));
  assert.ok(r.errors.some(e => /walled in/.test(e)));
});

test('layout: snap, move inside the ground, turn, size, copy, remove, pick the smallest under the cursor', () => {
  assert.equal(snap(1.26), 1.5); assert.equal(snap(1.26, 0), 1.26);
  const props = [{ prop: 'house', at: [0, 0, 0], rot: 0, scale: 1 }, { prop: 'bench', at: [0.5, 0, 0], rot: 90, scale: 1 }];
  const sizes = { house: [6, 4, 6], bench: [2, 1, 0.6] };
  const v = propsView(props, sizes);
  assert.deepEqual([v[1].w, v[1].d], [2, 0.6]);
  assert.equal(hitProp(v, 0.5, 0.8), 1, 'the bench turned 90° covers z 0.8; it is smaller than the house');
  assert.equal(hitProp(v, 2.5, 2.5), 0);
  assert.equal(hitProp(v, 20, 20), -1);
  const moved = moveProp(props, 1, 30.2, -3.7, { size: [40, 32] });
  assert.deepEqual(moved[1].at, [20, 0, -3.5], 'clamped to the ground, snapped');
  assert.equal(rotateProp(props, 1, 300)[1].rot, 30);
  assert.equal(rotateProp(props, 1, -120)[1].rot, 330);
  assert.equal(scaleProp(props, 0, 9)[0].scale, 4);
  const d = duplicateProp(props, 1, { size: [40, 32] });
  assert.equal(d.props.length, 3); assert.equal(d.index, 2); assert.deepEqual(d.props[2].at, [2, 0, 0]);
  assert.equal(removeProp(props, 0).length, 1);
  assert.deepEqual(addProp(props, 'bench', 1.2, 2.9).at(-1), { prop: 'bench', at: [1, 0, 3], rot: 0, scale: 1 });
  assert.deepEqual(clampTo([10, 6], 9, -9), [5, -3]);
  const f = fitView([40, 20], 440, 240, 20);
  assert.equal(f.k, 10); assert.deepEqual(f.toPx(0, 0), [220, 120]); assert.deepEqual(f.toWorld(...f.toPx(3, -4)), [3, -4]);
});

// slot rows in the shape GET /api/game/slots gives (lib/slots listSlots), from a melee and pickup party game
const s = (id, type, value, extra = {}) => ({ id, label: extra.label ?? id, type, kind: ['model', 'image'].includes(type) ? 'file' : 'value', value, tier: extra.tier ?? 'advanced', constraints: extra.constraints ?? {}, file: extra.file });
const SLOTS = [
  s('prop.crate', 'model', undefined, { tier: 'main', label: 'Crate', file: 'assets/models/crate.glb' }),
  s('prop.crate.count', 'integer', 6, { tier: 'main', label: 'How many crates', constraints: { min: 1, max: 60 } }),
  s('prop.crate.size', 'number', 0.6, { label: 'Crate size', constraints: { min: 0.05, max: 5, unit: 'm' } }),
  s('mechanic.pickup.prop', 'text', 'crate', { constraints: { maxLength: 40 } }),
  s('mechanic.pickup.respawn-seconds', 'number', 10, { tier: 'main', label: 'Respawn time', constraints: { min: 0, max: 120, unit: 's' } }),
  s('mechanic.pickup.count', 'integer', -1, { label: 'Spots at the start', constraints: { min: -1, max: 40 } }),
  s('mechanic.pickup.value', 'number', 20, { label: 'Value of a pickup', constraints: { min: 0, max: 100 } }),
  s('mechanic.melee.pillow.color', 'color', '#f4f1ea', { tier: 'main', label: 'Pillow: colour' }),
  s('mechanic.melee.pillow.combo-1.damage', 'number', 1, { label: 'Pillow, swing 1: damage', constraints: { min: 0, max: 100 } }),
  s('mechanic.melee.pillow.combo-1.reach', 'number', 2.2, { label: 'Pillow, swing 1: reach', constraints: { min: 0.5, max: 8, unit: 'm' } }),
  s('mechanic.melee.big-pillow.color', 'color', '#ffc94d', { label: 'Big pillow: colour' }),
  s('mechanic.melee.big-pillow.combo-1.damage', 'number', 2, { label: 'Big pillow, swing 1: damage', constraints: { min: 0, max: 100 } }),
  s('mechanic.melee.trail-color', 'color', '#ffffff', { tier: 'main', label: 'Slash trail colour' }),
  s('mechanic.projectile.speed', 'number', 18, { tier: 'main', label: 'Throw speed', constraints: { min: 2, max: 45, unit: 'm/s' } }),
  s('mechanic.projectile.prop', 'text', '', {}),
];

test('items: cards from slots (a pickup with its mechanic\'s numbers, a card per weapon, an aimed mechanic), one meaning per field', () => {
  const cards = itemsOf(SLOTS, { mechanics: [{ id: 'pickup', as: 'feather crates that patch you up' }, { id: 'projectile', as: 'your water soaker, limited by its tank' }] });
  assert.deepEqual(cards.map(c => c.id), ['prop:crate', 'weapon:pillow', 'weapon:big-pillow', 'mechanic:projectile']);
  const crate = cards[0];
  assert.equal(crate.what, 'feather crates that patch you up');
  assert.deepEqual(crate.main.map(f => f.id), ['prop.crate.count', 'mechanic.pickup.respawn-seconds', 'mechanic.pickup.value'], 'main fields first; the mechanic\'s "count" is a second count and goes to More');
  assert.ok(crate.more.some(f => f.id === 'mechanic.pickup.count'));
  const pillow = cards[1];
  assert.equal(pillow.name, 'Pillow');
  assert.equal(pillow.main[0].label, 'Swing 1: damage', 'a field drops its weapon\'s name inside its own card');
  assert.deepEqual(peersOf(cards, pillow, 'mechanic.melee.pillow.combo-1.damage'), [{ name: 'Big pillow', value: 2 }]);
  assert.deepEqual(peersOf(cards, pillow, 'mechanic.melee.pillow.combo-1.reach'), []);
  assert.equal(cards[3].name, 'Water soaker');
  assert.equal(firstWords('a shiny gold coin (collected)'), 'Shiny gold coin');
});

test('items: a slider never leaves its slot\'s range; requests carry the numbers and their ranges', () => {
  const dmg = SLOTS.find(x => x.id === 'mechanic.melee.pillow.combo-1.damage'), count = SLOTS[1];
  assert.deepEqual(fieldRange(dmg), { min: 0, max: 100, step: 0.5 });
  assert.equal(clampField(dmg, 140), 100); assert.equal(clampField(dmg, -3), 0); assert.equal(clampField(dmg, 'x'), 1);
  assert.equal(clampField(count, 7.6), 8);
  const cards = itemsOf(SLOTS);
  const b = balanceRequest(cards[1], 'pillows should feel even');
  assert.match(b, /Swing 1: damage \(mechanic\.melee\.pillow\.combo-1\.damage\) = 1 \[0\.\.100\]/);
  assert.match(b, /pillows should feel even/);
  assert.match(addRequest(cards[1], { name: 'Feather duster', idea: 'quick and weak' }), /new melee weapon .* copied from "Pillow", named "Feather duster"\. What it should be like: quick and weak/);
  assert.match(addRequest(cards[0], { name: 'Golden Crate!' }), /new prop "golden-crate"/);
});

test('skins: the try-on address carries a loadout the kit reads; seats, look-alikes, sheet frames, bodies, requests', () => {
  const p = loadoutParam({ values: { 'character.tint.player': '#23c64a' } });
  assert.doesNotMatch(p, /[+/=]/, 'base64url');
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString('utf8')), { values: { 'character.tint.player': '#23c64a' }, files: {}, pass: null });
  const url = new URL(tryOnPath('player', { colour: '#ABCDEF' }), 'http://x');
  assert.equal(url.searchParams.get('gf-show'), 'character.player');
  assert.equal(JSON.parse(Buffer.from(url.searchParams.get('gf-loadout'), 'base64url')).values['character.tint.player'], '#abcdef');
  assert.equal(new URL(tryOnPath('player'), 'http://x').searchParams.has('gf-loadout'), false);
  assert.deepEqual(setSeat(['#111111'], 2, '#FF0000'), ['#111111', '#111111', '#ff0000']);
  assert.throws(() => setSeat([], 0, 'red'));
  assert.deepEqual(lookAlike(['#ff0000', '#fe0101', '#0000ff']), [[0, 1]]);
  const f = sheetFrames(1536, 256);
  assert.equal(f.length, 6); assert.deepEqual(f[3], { name: 'air', row: 0, x: 768, y: 0, w: 256, h: 256 });
  assert.equal(sheetFrames(192, 96).length, 18, 'three rows by heading');
  const bodies = bodyChoices([{ id: 'a', license: { spdx: 'CC0-1.0' } }, { id: 'b', license: { spdx: 'CC-BY-4.0' } }], { current: 'a' });
  assert.deepEqual(bodies.map(b => [b.id, b.current]), [['a', true]]);
  assert.match(drawRequest({ slot: 'character.body.player', subject: 'a knight', style: 'pixel', plane: 'side' }), /gamesfun_art_request .* gamesfun_art_take/);
  assert.match(modelRequest({ slot: 'character.body.player', subject: 'a robot' }), /do not spend money without asking me/);
});

test('POST /api/editors/map on a created flat game: refuses a ledge out of reach, writes a good map through the slot and rewrites the spawn list', async t => {
  const tmp = await tempDir();
  t.after(() => tmp.cleanup());
  const spec = {
    specVersion: 0, engine: 'flat', plane: 'side', loop: 'round', title: 'Painter Test', hook: 'A side-on coin grab.', prompt: 'a 2D side-on coin grab',
    players: { min: 1, max: 4, bots: true, teams: 0, mode: 'versus' }, round: { seconds: 60, winBy: 'most coins', replay: true }, camera: 'side',
    controls: { interact: 'grab a coin', jump: 'jump' },
    world: { template: 'stage', size: 'small', props: [{ name: 'coin', describe: 'a gold coin', count: 12, from: 'library', role: 'collected' }], map: { legend: { o: 'mark:coin' }, rows: ROWS } },
    mechanics: [{ id: 'pickup', as: 'coins to collect', params: { prop: 'coin', count: 0, effect: 'score', value: 1, respawnSeconds: 4, size: 0.8, collect: 'both' } }],
    rules: { summary: 'Grab coins.', scoring: '+1 per coin', params: {} }, characters: [{ role: 'player', describe: 'a kid', body: { from: 'sprite' } }],
    look: { preset: 'drawn-day' }, sounds: [{ id: 'coin', describe: 'a chime' }], content: { rating: 'E' }, accept: ['coins'],
  };
  const specFile = path.join(tmp.dir, 'spec.json');
  await writeFile(specFile, JSON.stringify(spec));
  const dir = path.join(tmp.dir, 'game');
  await createGame(dir, { spec: specFile });
  const srv = await startDevServer({ gameDir: dir, port: 0, log: () => {}, watch: false });
  t.after(() => srv.close());
  const post = async body => { const r = await fetch(`http://127.0.0.1:${srv.port}/api/editors/map`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const world = JSON.parse(await readFile(path.join(dir, 'config/world.json'), 'utf8'));
  const high = withGrid(world.map, paintCells(gridOf(world.map), rectCells({ c: 3, r: 1 }, { c: 8, r: 1 }), '='));
  const refused = await post({ map: high });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /out of reach: the ledge at column 4, row 1/);
  // a good change: a start spot moved along the floor, and the floor ledge widened
  const g = gridOf(world.map); g[10][2] = '.'; g[10][4] = '1';
  const good = withGrid(world.map, g);
  const ok = await post({ map: good });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.id, 'world.map');
  const after = JSON.parse(await readFile(path.join(dir, 'config/world.json'), 'utf8'));
  assert.deepEqual(after.map.rows, good.rows, 'the map is what was painted');
  assert.deepEqual(ok.body.derived, ['config/world.json'], 'the spawn list was rewritten from the map');
  assert.equal(after.spawns[0][0], -10.5, 'the first spawn is now at column 5');
  const tabs = await (await fetch(`http://127.0.0.1:${srv.port}/api/studio/tabs`)).json();
  for (const f of ['map.js', 'skins.js', 'items.js']) assert.ok(tabs.some(x => x.file === f), f);
  for (const f of ['history.js', 'paint.js', 'layout.js', 'items.js', 'skins.js', 'ui.js', 'map-flat.js', 'map-layout.js']) assert.equal((await fetch(`http://127.0.0.1:${srv.port}/studio/lib/editors/${f}`)).status, 200, f);
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/studio/editors.css`)).status, 200);
  const lib = await fetch(`http://127.0.0.1:${srv.port}/api/editors/library/bodies/..%2fbodies.json`);
  assert.equal(lib.status, 404, 'only a library file by its plain name');
});
