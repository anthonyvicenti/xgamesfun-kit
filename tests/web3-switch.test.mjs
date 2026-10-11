// Web3 is off by default in the studio: the Token and Shop tabs are listed only with GAMESFUN_WEB3=1 or a gamesfun.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDevServer } from '../server/index.mjs';
import { tempGame } from './helpers.mjs';

let game, srv, base;
const saved = process.env.GAMESFUN_WEB3;
before(async () => {
  game = await tempGame();
  srv = await startDevServer({ gameDir: game.dir, port: 0, log: () => {}, watch: false });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => {
  if (saved === undefined) delete process.env.GAMESFUN_WEB3; else process.env.GAMESFUN_WEB3 = saved;
  await srv.close(); await game.cleanup();
});
const tabs = async () => (await (await fetch(`${base}/api/studio/tabs`)).json()).map(t => t.file);

test('web3 off: no Token or Shop tab in the list, and the other tabs stay', async () => {
  delete process.env.GAMESFUN_WEB3;
  const files = await tabs();
  assert.ok(!files.includes('token.js') && !files.includes('shop.js'), files.join());
  for (const f of ['session.js', 'build.js', 'tune.js', 'friends.js', 'assets.js', 'verify.js']) assert.ok(files.includes(f), f);
  process.env.GAMESFUN_WEB3 = '0';
  assert.ok(!(await tabs()).includes('token.js'), 'only "1" turns it on');
});

test('GAMESFUN_WEB3=1 lists both web3 tabs', async () => {
  process.env.GAMESFUN_WEB3 = '1';
  const files = await tabs();
  assert.ok(files.includes('token.js') && files.includes('shop.js'));
});

test('a game with a gamesfun.json lists them without the variable', async () => {
  delete process.env.GAMESFUN_WEB3;
  await writeFile(path.join(game.dir, 'gamesfun.json'), JSON.stringify({ network: 'devnet' }));
  const files = await tabs();
  assert.ok(files.includes('token.js') && files.includes('shop.js'));
  await rm(path.join(game.dir, 'gamesfun.json'));
  assert.ok(!(await tabs()).includes('token.js'), 'gone again once the file is');
});
