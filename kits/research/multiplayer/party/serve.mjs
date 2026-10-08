#!/usr/bin/env node
// Try a game with friends on this machine: serves one game folder and the host-join signaling endpoints (WebSocket
// /signal, HTTP /signal/v1) on one port. Add ?signal=http to the party URL to play over HTTP, as the play origin does.
//
//   node research/multiplayer/party/serve.mjs <game-dir> [--port 5780] [--host 127.0.0.1] [--dev-kit]
//   → http://127.0.0.1:5780/            the game on its own, exactly as before
//     http://127.0.0.1:5780/gf/mp/      play with friends: Host a game, then open the invite link in another window
//
// --dev-kit serves the kit from its development sources over whatever is in <game-dir>/gf/mp/ (nothing is written).
// No game traffic passes through here: this only serves files and introduces peers.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIT_DIR, kitFiles, readManifest, startParty, validateMultiplayer } from './lib.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const a = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const dir = a.find((x, i) => !x.startsWith('--') && !['--port', '--host'].includes(a[i - 1]));
  if (!dir) { console.error('usage: serve.mjs <game-dir> [--port 5780] [--host 127.0.0.1] [--dev-kit]'); process.exit(2); }
  const { manifest, error } = await readManifest(dir);
  if (error) console.log(`note: multiplayer.json is ${error}`);
  else { const v = validateMultiplayer(manifest); for (const p of v.problems) console.log(`problem: ${p}`); for (const w of v.warnings) console.log(`warning: ${w}`); }
  let overlay = null;
  if (a.includes('--dev-kit')) { overlay = new Map(); for (const [rel, buf] of await kitFiles({ version: 'dev' })) overlay.set(`${KIT_DIR}/${rel}`, buf); }
  const s = await startParty({ dir, port: Number(opt('--port', 5780)), host: opt('--host', '127.0.0.1'), overlay });
  console.log(`game      ${s.url}`);
  console.log(`friends   ${s.partyUrl}   (signaling: WebSocket /signal; HTTP /signal/v1 with ?signal=http)`);
}
