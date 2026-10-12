// The studio with no game open (the start page), a game opened while the server runs, a new idea's folder followed
// until the build loop makes it a game, the conversation's words, and connect's record of having run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildRunning, gameReady, startDevServer } from '../server/index.mjs';
import { freeName, slugOf } from '../server/routes/studio.mjs';
import { createGame } from '../lib/create.mjs';
import { tempDir } from './helpers.mjs';
import { recordConnected } from '../commands/connect.mjs';
import { CHANGE_IDEAS, MARK, STAGES, choiceRequest, compose, ideaRequest, stageOf, wordsOf } from '../studio/chat.js';
import { cardState, iconFor, paletteOf, titleCardSvg, titleCardUrl } from '../studio/lib/pictures.js';
import { pickShot } from '../server/routes/pictures.mjs';

const root = await tempDir();
after(() => root.cleanup());
const games = path.join(root.dir, 'games');
await mkdir(games, { recursive: true });
const srv = await startDevServer({ gamesRoot: games, port: 0, log: () => {}, watch: false });
after(() => srv.close());
const base = `http://127.0.0.1:${srv.port}`;
const call = async (p, body) => {
  const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('no game open: the start page has nothing to play, and every game route says what to do', async () => {
  assert.deepEqual((await call('/api/studio/project')).body, { project: null });
  const info = await call('/api/game/info');
  assert.equal(info.status, 409);
  assert.match(info.body.error, /No game is open yet: pick one on the studio's start page, or describe a new one there/);
  assert.equal((await fetch(`${base}/game/`)).status, 404, 'no game page is served');
  const b = await call('/api/build/state');
  assert.equal(b.body.none, true); assert.equal(b.body.loop, null); assert.equal(b.body.made, false);
  const home = (await call('/api/studio/home')).body;
  assert.deepEqual(home.games, []);
  assert.ok(home.examples.some(e => e.id === 'soak-squad'), 'the examples are offered');
  assert.equal(typeof home.setup.connected, 'boolean');
  for (const f of ['index.html', 'studio.js', 'chat.js', 'start.js', 'studio.css', 'talk.css', 'lib/pictures.js', 'lib/connect-picture.js']) assert.equal((await fetch(`${base}/studio/${f}`)).status, 200, f);
});

test('a new idea: a folder name from its words, opened before anything is written; the conversation follows the loop; the game appears once made', async () => {
  const r = await call('/api/studio/new', { idea: 'A pillow fight in a backyard, with my friends!' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'pillow-fight-backyard-friends');
  assert.deepEqual([r.body.project.name, r.body.project.made], ['pillow-fight-backyard-friends', false]);
  assert.equal(existsSync(path.join(games, r.body.name)), false, 'nothing is written: the build loop makes the folder');
  const { bridgeFor } = await import('../server/routes/session.mjs');
  assert.equal(bridgeFor(srv.url).bridge.game, path.join(games, r.body.name), 'the bridge follows the open game (the stop guard reads its loop)');
  // the loop's talk: the idea and the concepts are what the conversation shows
  const job = path.join(games, r.body.name, '.gf-loop', 'job');
  await mkdir(job, { recursive: true });
  await writeFile(path.join(job, 'idea.txt'), 'A pillow fight in a backyard, with my friends!');
  await writeFile(path.join(path.dirname(job), 'state.json'), JSON.stringify({ schema: 'gf-loop/1', kind: 'pitch', status: 'waiting-on-question', step: 'done', outcome: 'pitched', history: [] }));
  await writeFile(path.join(job, 'pitch.json'), JSON.stringify({ pitchVersion: 0, reply: 'Two takes.', cards: [{ id: 'a', title: 'Pillow Brawl', hook: 'Bop your friends.', howItPlays: 'Swing.', players: '2-4', whyFunny: 'x', similar: [], v1: { has: ['one yard'], notYet: [] }, conceptPrompt: 'x', spec: { secret: 'not sent to the page' } }], questions: [{ id: 'len', text: 'How long?', default: 'short', options: [{ id: 'short', label: '90 s' }, { id: 'long', label: '3 min' }] }] }));
  let b = (await call('/api/build/state')).body;
  assert.equal(b.made, false);
  assert.equal(b.idea, 'A pillow fight in a backyard, with my friends!');
  assert.deepEqual(b.pitch.cards.map(c => c.title), ['Pillow Brawl']);
  assert.equal(b.pitch.cards[0].spec, undefined, 'a card is cut to what the page shows');
  assert.deepEqual(b.pitch.questions[0].options.map(o => o.label), ['90 s', '3 min']);
  assert.equal((await call('/api/studio/home')).body.games[0].made, false, 'a folder being pitched is listed on the start page');
  // create made the folder a game: the page opens it
  await createGame(path.join(games, r.body.name), { from: 'soak-squad', force: true });
  b = (await call('/api/build/state')).body;
  assert.equal(b.made, true);
  assert.equal((await call('/api/game/info')).body.name, r.body.name);
  assert.equal((await fetch(`${base}/game/`)).status, 200, 'the game page is served now');
});

test('opening and closing a game; names are checked; an example is copied into games/ and opened', async () => {
  assert.equal((await call('/api/studio/project', { name: '../etc' })).status, 400);
  assert.equal((await call('/api/studio/project', { name: 'nope' })).status, 404);
  assert.deepEqual((await call('/api/studio/project', { name: null })).body, { project: null });
  assert.equal((await call('/api/game/info')).status, 409);
  const ex = await call('/api/studio/example', { example: 'soak-squad' });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.name, 'soak-squad');
  assert.equal(ex.body.project.made, true);
  assert.equal((await call('/api/game/info')).body.name, 'soak-squad');
  assert.equal((await call('/api/studio/example', { example: 'no-such' })).status, 400);
  const home = (await call('/api/studio/home')).body;
  assert.deepEqual(home.games.map(g => [g.name, g.made]).sort(), [['pillow-fight-backyard-friends', true], ['soak-squad', true]]);
});

test('folder names: the words that matter, and the next free one', async () => {
  assert.equal(slugOf('I want a game where we race boats on a lake'), 'race-boats-lake');
  assert.equal(slugOf('!!!'), 'new-game');
  assert.equal(slugOf('Ünïcödé café'), 'unicode-cafe');
  await mkdir(path.join(games, 'boats'), { recursive: true });
  assert.equal(freeName(games, 'boats'), 'boats-2');
});

test('the conversation\'s words: the person\'s words first, the line for their session after the mark', () => {
  const text = ideaRequest('a pillow fight', 'games/pillow-fight');
  assert.equal(wordsOf(text), 'a pillow fight');
  assert.ok(text.includes(MARK));
  assert.match(text, /gamesfun_step_pitch \{"game": "games\/pillow-fight"/);
  const pick = choiceRequest({ id: 'b', title: 'Feather Frenzy' }, [{ id: 'len', option: 'long', question: 'How long?', answer: '3 min' }], 'games/pillow-fight');
  assert.equal(wordsOf(pick), 'Let\'s make "Feather Frenzy". How long? 3 min');
  assert.match(pick, /chose card "b".*len = long/s);
  assert.equal(compose('hi', ''), 'hi');
});

test('the stages a person follows, from the loop state: pitch, pick, build, check, play-test, deliver', () => {
  assert.deepEqual(STAGES.map(s => s.label), ['Pitch', 'Pick', 'Build', 'Check', 'Play-test', 'Deliver']);
  assert.ok(STAGES.every(s => /^[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/.test(s.icon)), 'each stage has an icon path (no markup)');
  assert.equal(stageOf(null).index, -1, 'no loop (an example): no stages shown');
  assert.deepEqual(stageOf({ kind: 'pitch', status: 'building', step: 'pitch' }), { index: 0, waiting: false, done: false, failed: false });
  assert.deepEqual(stageOf({ kind: 'pitch', status: 'waiting-on-question', step: 'done', outcome: 'pitched' }), { index: 1, waiting: true, done: false, failed: false }, 'the concepts wait on the person: Pick, in amber');
  assert.equal(stageOf({ kind: 'pitch', status: 'building', step: 'pitch' }, { pitch: { cards: [] } }).index, 2, 'picked: the session works on it again');
  assert.equal(stageOf({ kind: 'refine', status: 'building', step: 'done', outcome: 'locked' }).index, 2);
  assert.equal(stageOf({ kind: 'build', status: 'building', step: 'agent' }).index, 2);
  assert.equal(stageOf({ kind: 'build', status: 'building', step: 'verify' }).index, 3);
  assert.equal(stageOf({ kind: 'build', status: 'building', step: 'playtest' }).index, 4);
  assert.equal(stageOf({ kind: 'build', status: 'failed', step: 'repair' }).failed, true);
  assert.deepEqual(stageOf({ kind: 'build', status: 'delivered', step: 'done' }), { index: 5, waiting: false, done: true, failed: false });
  assert.ok(CHANGE_IDEAS.length >= 3 && CHANGE_IDEAS.every(t => t.length < 40), 'the empty conversation offers a few short changes to tap');
});

test('pictures: title cards from words and colours, icons from words, a state chip a game', () => {
  assert.equal(iconFor('Tag in a haunted house: one ghost'), 'ghost');
  assert.equal(iconFor('A backyard pillow fight'), 'pillow');
  assert.equal(iconFor('A side-on platformer where we race to grab coins'), 'coin');
  assert.equal(iconFor('Bumper boats in a pool'), 'water');
  assert.equal(iconFor('A backyard water fight'), 'water', 'a water fight is water, not swords');
  assert.equal(iconFor('something else entirely'), 'pad');
  // own colours first, words next, a hashed hue last; only #hex is ever taken
  assert.deepEqual(paletteOf('x', ['#4f7cff', '#ff5ea8', 'red; background:url(x)']), ['#4f7cff', '#ff5ea8']);
  assert.equal(paletteOf('a sunset race')[0], '#ff8a5c');
  assert.deepEqual(paletteOf('same words'), paletteOf('same words'), 'the same words draw the same card');
  assert.notDeepEqual(paletteOf('Pillow Brawl: bop your friends'), paletteOf('Feather Frenzy: grab the feathers'), 'two concepts about pillows still differ');
  const svgText = titleCardSvg({ words: '<script>alert(1)</script> "quoted"', colours: ['"/><script>'] });
  assert.doesNotMatch(svgText, /script|quoted|alert/, 'no words reach the markup');
  assert.match(svgText, /^<svg [^>]*viewBox="0 0 320 180"/);
  assert.match(titleCardSvg({ words: 'x', shape: 'banner' }), /viewBox="0 0 320 110"/);
  assert.match(titleCardUrl({ words: 'x' }), /^data:image\/svg\+xml;charset=utf-8,/);
  const st = g => cardState(g).label;
  assert.equal(st({ made: true, loop: null }), 'Made');
  assert.equal(st({ made: true, loop: { kind: 'build', status: 'delivered' } }), 'Made');
  assert.equal(st({ made: false, loop: { kind: 'pitch', status: 'waiting-on-question' } }), 'Being pitched');
  assert.equal(cardState({ made: false, loop: { kind: 'pitch', status: 'waiting-on-question' } }).tone, 'warn', 'waiting on the person: amber');
  assert.equal(st({ made: false, loop: { kind: 'build', status: 'building', step: 'agent' } }), 'Building');
  assert.equal(st({ made: true, loop: { kind: 'change', status: 'building', step: 'verify' } }), 'Building');
  assert.equal(cardState({ made: true, loop: { kind: 'build', status: 'failed' } }).tone, 'bad');
});

test('the pictures route: the newest verify screenshot of a game, its colours; refuses names that are not a game folder', async () => {
  assert.equal(pickShot(['01-menu.jpg', '02-first-look.jpg', '03-playing.jpg', 'verdict.json']), '03-playing.jpg');
  assert.equal(pickShot(['01-menu.jpg', '24-no-webgpu.jpg', 'x-world.png']), 'x-world.png');
  assert.equal(pickShot(['01-menu.jpg', 'verdict.json']), null, 'a menu is not the game');
  assert.equal(pickShot(['.hidden-playing.jpg']), null);
  const dir = path.join(games, 'pic-game');
  await createGame(dir, { from: 'coin-hop' });
  let all = (await call('/api/pictures')).body;
  assert.equal(all.games['pic-game'].picture, null, 'no verify run yet: the page draws a title card');
  assert.ok(all.games['pic-game'].colours.includes('#4f7cff'), 'the game\'s own palette');
  assert.ok('soak-squad' in all.examples);
  assert.equal((await fetch(`${base}/api/pictures/game/pic-game`)).status, 404);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  for (const n of [1, 3]) { await mkdir(path.join(dir, 'evidence', `verify-${n}`), { recursive: true }); await writeFile(path.join(dir, 'evidence', `verify-${n}`, '03-playing.jpg'), Buffer.concat([jpg, Buffer.from([n])])); }
  await mkdir(path.join(dir, 'evidence', 'verify-4'), { recursive: true });
  await writeFile(path.join(dir, 'evidence', 'verify-4', 'verdict.json'), '{}');      // the newest run has no picture: the one before it
  all = (await call('/api/pictures')).body;
  assert.equal(all.games['pic-game'].picture, '/api/pictures/game/pic-game?v=verify-3');
  const r = await fetch(`${base}${all.games['pic-game'].picture}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await r.arrayBuffer()).at(-1), 3, 'the newest run');
  // path tricks: only a game folder name, only files found by listing, never a link out of the folder
  // (fetch itself folds %2E%2E into .., which lands on the listing: a list of names, never a file)
  for (const bad of ['..%2F..%2Fetc', '%2E%2E', '.hidden', 'a%5Cb', '%2e%2e%2f%2e%2e%2fsecret.jpg']) {
    const res = await fetch(`${base}/api/pictures/game/${bad}`);
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /^image\//, bad);
    assert.ok([200, 400, 404].includes(res.status), `${bad}: ${res.status}`);
  }
  assert.equal((await fetch(`${base}/api/pictures/game/pic-game/..%2F..`)).status, 404);
  assert.equal((await fetch(`${base}/api/pictures/example/..%2Fcoin-hop`)).status, 404);
  assert.equal((await fetch(`${base}/api/pictures/example/coin-hop`)).status, 404, 'the kit\'s examples have no picture of their own yet');
  const { symlink } = await import('node:fs/promises');
  const out = path.join(root.dir, 'secret.jpg');
  await writeFile(out, 'secret');
  await mkdir(path.join(dir, 'evidence', 'verify-9'), { recursive: true });
  let linked = true;
  try { await symlink(out, path.join(dir, 'evidence', 'verify-9', '03-playing.jpg')); } catch { linked = false; }   // Windows without the right
  if (linked) {
    assert.equal((await call('/api/pictures')).body.games['pic-game'].picture, '/api/pictures/game/pic-game?v=verify-3', 'a link is never served');
    const body = Buffer.from(await (await fetch(`${base}/api/pictures/game/pic-game`)).arrayBuffer()).toString();
    assert.doesNotMatch(body, /secret/);
  }
  assert.equal((await fetch(`${base}/api/pictures/game/pic-game`, { method: 'POST', headers: { origin: base } })).status, 405, 'read only');
});

test('connect leaves a record the studio reads (the one step left), and --remove takes it away', async () => {
  const dir = path.join(root.dir, 'state');
  const ok = { results: [{ id: 'claude', name: 'Claude Code', status: 'registered', plugin: { status: 'installed' } }, { id: 'codex', name: 'Codex', status: 'not installed' }] };
  const v = await recordConnected(ok, { dir });
  assert.deepEqual([v.connected, v.plugin, v.agents.map(a => a.id)], [true, true, ['claude']]);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'connected.json'), 'utf8')).plugin, true);
  assert.equal(await recordConnected({ results: [{ id: 'claude', status: 'failed' }] }, { dir: path.join(root.dir, 'none') }), null, 'nothing is recorded when nothing was added');
  await recordConnected(ok, { dir, remove: true });
  assert.equal(existsSync(path.join(dir, 'connected.json')), false);
  await rm(dir, { recursive: true, force: true });
});

test('a game the build loop is still making on its first build is not shown; a change to a delivered game is', async () => {
  const t = await tempDir();
  try {
    const dir = path.join(t.dir, 'g');
    await createGame(dir, { from: 'soak-squad' });
    assert.equal(gameReady(dir), true, 'a game with no loop (an example the person picked, a game made by hand) is shown');
    await mkdir(path.join(dir, '.gf-loop'), { recursive: true });
    const state = (kind, status) => writeFile(path.join(dir, '.gf-loop', 'state.json'), JSON.stringify({ schema: 'gf-loop/1', kind, status, step: 'verify' }));
    for (const [kind, status, shown] of [['build', 'building', false], ['build', 'waiting-on-question', false], ['build', 'delivered', true], ['build', 'failed', true], ['change', 'building', true], ['pitch', 'waiting-on-question', true]]) {
      await state(kind, status);
      assert.equal(gameReady(dir), shown, `${kind} ${status}`);
      assert.equal(buildRunning(dir), !shown, `${kind} ${status}`);
    }
  } finally { await t.cleanup(); }
});
