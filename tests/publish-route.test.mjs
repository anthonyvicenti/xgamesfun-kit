// /api/publish/… on the dev server when the game is opened after the server started (the studio's start page, then a
// new or picked game). The route kept ctx.gameDir from load time, so a fresh game's Publish tab showed
// `The "paths[0]" argument must be of type string. Received null` (the file walk got null). Nothing here reaches games.fun:
// GAMESFUN_STUDIO points at a closed port and the sign-in store is a throwaway folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer } from '../server/index.mjs';
import { tempDir, tempGame } from './helpers.mjs';

test('publish routes read the open game at each request: none open is a plain 409; opened later, the check runs on it', async () => {
  const cfg = await tempDir('gf-publish-route-');
  const saved = { ...process.env };
  Object.assign(process.env, { GAMESFUN_CONFIG_DIR: cfg.dir, GAMESFUN_CREDENTIALS: 'file', GAMESFUN_SECRET_STORE: 'file', GAMESFUN_STUDIO: 'http://127.0.0.1:9' });
  const game = await tempGame('coin-hop');
  const server = await startDevServer({ gameDir: null, gamesRoot: game.root, port: 0, log: () => {}, watch: false });
  const get = async route => { const r = await fetch(`${server.url}api/publish/${route}`); return { status: r.status, body: await r.json() }; };
  try {
    // no game yet: words that say what to do, not a stack trace
    for (const route of ['check', 'status']) {
      const r = await get(route);
      assert.equal(r.status, 409, `${route}: ${JSON.stringify(r.body)}`);
      assert.match(r.body.error, /No game is open yet/);
      assert.doesNotMatch(r.body.error, /paths\[0\]/);
    }
    // the studio opens the game after the routes loaded (this is the fresh-game case)
    server.ctx.setGame(game.dir);
    const check = await get('check');
    assert.equal(check.status, 200, JSON.stringify(check.body));
    assert.ok(check.body.files > 5, `the game's files are counted: ${check.body.files}`);
    assert.equal(check.body.ok, true, JSON.stringify(check.body));
    const status = await get('status');
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.signedIn, null);
    assert.equal(status.body.known, null, 'a fresh game has no link yet');
    assert.equal(status.body.run.running, false);
  } finally {
    await server.close(); await game.cleanup(); await cfg.cleanup();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
