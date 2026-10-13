#!/usr/bin/env node
// Maintainers only: snapshot games.fun's kits into kits/ (a sparse mirror of the games.fun repository, so gf-three's
// tools find their neighbours at the same relative paths and run unedited).
//
//   node scripts/sync-kits.mjs [--from <games.fun checkout>] [--commit <rev>] [--check] [--dry-run] [--json]
//
//   --from     the games.fun checkout (default: $GAMESFUN_REPO, else ../games.fun beside this checkout, else beside
//              the main checkout when this is a git worktree)
//   --commit   what to snapshot (default HEAD). Files are read from git objects at that commit, never from the working
//              tree, so the same commit always gives the same bytes (no line-ending or uncommitted-edit surprises).
//   --check    change nothing: exit 1 when kits/ differs from what the recorded commit (KITS.json) gives
//   --dry-run  print what would change and exit
//
// What is copied: the import closure of the tools the CLI runs (ENTRIES), the parts those tools load by path when a game
// needs them (found in the code, see partTargets), and a short list of folders that hold data, not Node modules (DATA).
// What is never copied: LEFT_OUT parts, regressions, sandbox, lookdev, evidence, node_modules, caches, .env files and
// anything key-shaped (the copied text is scanned and the sync fails on a hit), and library assets whose licence is
// not CC0 or permissive or that Meshy generated.
// Never edit kits/ by hand: fix the kit in games.fun and run this again.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from '../lib/main.mjs';

const KIT_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const KITS = path.join(KIT_ROOT, 'kits');

export const SCHEMA = 'gamesfun-kits/2';
const GF3 = 'research/gf-three';
const TOOLS = `${GF3}/tools`;
const PATHS = `${TOOLS}/lib/paths.mjs`;
/** The build loop (games.fun research/gf-three/loop/README.md): the MCP loop tools call it, and it fills AGENTS.md. */
export const LOOP = `${GF3}/loop/index.mjs`;
const MP_MANIFEST = 'research/multiplayer/party/manifest.mjs';
/** Libraries the licence rule reads, file by file (each has its own LICENSES.json). */
export const LIBRARIES = [`${GF3}/library`, 'research/gf-scenic/library'];

/**
 * The Node programs this package starts (games.fun-relative). Everything they import, however deep, is copied; nothing
 * else in a tools folder is. tests/sync-kits.test.mjs fails when the CLI runs a tool that is not listed here.
 */
export const TOOL_ENTRIES = ['catalog', 'create', 'meshy-character', 'meshy-prop', 'play', 'promises', 'rig-check', 'slots', 'upgrade', 'verify'];
/** Tools a check's own message tells the person to run for the full list of problems (verify checks 11 and 17, and 17's reach warning), the one a flat game's map brief names, and the one melee's README names for adding an item. */
export const NAMED_IN_MESSAGES = ['dressing', 'world', 'flat-map', 'items', 'places-reach'];   // flat-map: a flat game's tile map report and --sync (the editors' map painter and the flat map brief name it); items: list, add like, remove a mechanic's table of things (melee's README names it; the studio's Items tab writes the same slot); places-reach: drives the jumps of a 3D world's reach (verify check 17's reach warning names it)
export const ENTRIES = [
  ...[...TOOL_ENTRIES, ...NAMED_IN_MESSAGES].map(t => `${TOOLS}/${t}.mjs`),
  'research/multiplayer/p2p/signal-server.mjs',   // the dev server's signaling (server/index.mjs)
  'research/multiplayer/p2p/serve-signal.mjs',    // a person's own signaling server (docs/ONLINE.md names it; never started for them)
  LOOP,                                           // the build loop as a library (mcp/tools/loop.mjs calls it)
];

/**
 * Folders and files that are data to the tools (copied into a game, served to a page, or read as a document), so no
 * import leads to them. `{mp}`, `{audio}` and `{assets}` are the kit versions the tools at that commit name
 * (kitVersions), never a version written here. `browser: true`: the modules inside run in a page with a game's own
 * layout, so their imports are not followed.
 */
export const DATA = [
  { path: `${GF3}/README.md`, why: 'gf-three overview' },
  { path: `${GF3}/CONTRACT.md`, why: 'gf-three API: what rules.js and config are written against' },
  { path: `${GF3}/kit`, why: 'gf-three kit, vendored into each game as gf/three/', browser: true },
  { path: `${GF3}/library`, why: 'props, bodies, clips and textures (CC0 or permissive only; no Meshy output)', browser: true },
  { path: `${TOOLS}/lib/standin-assets`, why: 'the stand-in body and texture create starts a game with' },
  { path: `${TOOLS}/lib/vendor`, why: 'three.js addons (curated copy, pinned), vendored into each game', browser: true },
  { path: `${TOOLS}/lib/char-deps`, why: 'the 3D tools\' own package list (installed on first use)' },
  { path: `${GF3}/character-bench`, why: 'the page a body\'s pose sheet is drawn on (verify check 19)', browser: true },
  { path: 'research/gf-scenic/README.md', why: 'the scenic engine: overview' },
  { path: 'research/gf-scenic/kit', why: 'the scenic engine\'s look and world, vendored into a scenic game as gf/scenic/', browser: true },
  { path: 'research/gf-scenic/library', why: 'the scenic engine\'s bodies and props (CC0 or permissive only)', browser: true },
  { path: 'research/gf-scenic/tools/lib/vendor', why: 'three.js WebGPU addons (pinned), vendored into a scenic game', browser: true },
  { path: 'research/gf-scenic/specs', why: 'the scenic engine\'s development specs (example specs)' },
  { path: 'research/gf-vista/README.md', why: 'the vista engine: overview' },
  { path: 'research/gf-vista/kit', why: 'the vista engine\'s kit (boot, look, tables, bodies, HUD wiring), vendored into a vista game as gf/vista/kit/', browser: true },
  { path: 'research/gf-vista/hud', why: 'the vista engine\'s HUD, vendored into a vista game as gf/vista/hud/', browser: true },
  { path: 'research/gf-vista/core', why: 'the vista engine\'s WebGPU core (Tidewater, MIT; its public files CC0 or MIT, credited in core/ATTRIBUTION.md), vendored into a vista game as gf/vista/core/ (about 53 MB; its sky-pro clouds are left out below)', browser: true },
  { path: 'research/gf-vista/UPSTREAM.json', why: 'the vista core\'s upstream record (repository, commit, licence), vendored into a vista game' },
  { path: 'research/gf-vista/specs', why: 'the vista engine\'s development spec (an example spec)' },
  { path: 'research/foundations/kits/gf-audio/{audio}', why: 'gf-audio, vendored into each game as audio/', browser: true },
  { path: 'research/foundations/kits/gf-multiplayer/{mp}', why: 'gf-multiplayer, vendored into each game as gf/mp/', browser: true },
  { path: 'research/foundations/kits/gf-multiplayer/{mpDev}', why: 'the newest frozen gf-multiplayer, when it runs ahead of the one create vendors (a game on it passes verify check 2; online signaling needs 1.6.4)', browser: true },
  { path: 'research/foundations/kits/gf-assets/{assets}', why: 'gf-assets (gf/gf-assets.js; verify checks its SHA256SUMS)', browser: true },
  { path: 'creator-studio/lib/voice-capture.mjs', why: 'the streamer\'s voice (our own code, no imports): verify check 34 loads it into a stand-in streamer page with Chrome\'s fake microphone', browser: true },
  { path: 'research/foundations/trials/fps-arena/source/vendor/three', why: 'three.js build (pinned)', browser: true },
  { path: 'research/foundations/trials/fps-arena/source/vendor/postprocessing', why: 'pmndrs postprocessing (pinned)', browser: true },
  { path: 'research/foundations/trials/fps-arena/source/vendor/n8ao', why: 'N8AO (pinned)', browser: true },
  { path: 'research/foundations/trials/third-person-adventure/source/vendor/rapier', why: 'Rapier (pinned)', browser: true },
  { path: 'research/foundations/trials/third-person-adventure/source/vendor/three', why: 'three.js WebGPU build (pinned; the scenic engine)', browser: true },
  { path: 'research/multiplayer/STANDARD.md', why: 'the multiplayer bar every game meets' },
  { path: 'research/multiplayer/party/LIVE_HANDBOOK.md', why: 'how a live game shares its world' },
  { path: 'research/multiplayer/party/kit', why: 'gf-multiplayer dev sources (tools read declarations through them)', browser: true },
  { path: 'research/multiplayer/p2p/vendor', why: 'ws, vendored by the signal server', browser: true },
  { path: 'research/multiplayer/p2p/SELF_HOST.md', why: 'online play: our host\'s limits and refusals, and hosting your own signaling (docs/ONLINE.md is a copy)' },
  { path: 'research/watch/relay/README.md', why: 'the watch relay: what the local stream relay does (verify check 34)' },
  { path: 'research/studio-v2/game-spec.schema.json', why: 'the game spec schema create validates' },
  { path: 'research/studio-v2/prompts', why: 'the prompts, once: the source of the build brief and of AGENTS.md\'s game-building part, the play-tester\'s brief, the look rubrics' },
  { path: 'research/studio-v2/pitch.schema.json', why: 'the pitch schema (playbook)' },
  { path: 'research/studio-v2/specs/dev-dodgeball.spec.json', why: 'the kit development spec (an example spec)' },
];

/** Parts of games.fun this package does not carry. The tools load them by path only when a game needs them (importPart). */
export const LEFT_OUT = [
  { path: 'research/gf-forge', why: 'the forge engine (closed to creators; its core is a prebuilt wasm this package does not ship yet)' },
  { path: `${GF3}/lookdev`, why: 'the contact-sheet tool (verify check 9; --quick skips it and a full verify says it is absent)' },
  { path: 'research/pipeline', why: 'games.fun\'s own Playwright install (this package pins playwright-core)' },
  { path: 'research/pipeline-v2', why: 'games.fun\'s Meshy key file (here the key comes from the environment)' },
  // the creator, 2026-10-12: the open-source kit ships vista with the core's own MIT clouds (core/src/sky/Clouds.js).
  // The core imports SkyProClouds only on demand (core patch 5), and boot-vista picks the MIT clouds when a game's
  // gf/three/kit.js lists no core/src/sky/SkyProClouds.js, which a game made from these kits never does.
  { path: 'research/gf-vista/core/src/sky/SkyProClouds.js', why: 'the vista core\'s volumetric clouds from sky-pro-webgpu, whose notice names a separate licence (the creator, 2026-10-12: the kit uses the core\'s own MIT clouds)' },
  { path: 'research/gf-vista/core/public/clouds', why: 'the sky-pro-webgpu clouds\' noise volumes and their licensing note (only SkyProClouds.js reads them)' },
];
/**
 * Tool faults worked around here until games.fun fixes them: a static import into a LEFT_OUT part. The named file and
 * what it imports are copied, and nothing else of the part. An entry the tools no longer need fails the sync, so it
 * is deleted as soon as the fix lands. docs/DEVELOPING.md lists the request for each.
 */
export const TOOL_FAULTS = [];
const leftOut = rel => LEFT_OUT.find(p => rel === p.path || rel.startsWith(p.path + '/')) ?? null;

/** Never copied, anywhere in a source path. */
export const EXCLUDED_DIRS = ['node_modules', 'evidence', '.cache', 'regressions', 'sandbox', 'lookdev', '.git'];
const EXCLUDED_FILE = [
  [/(^|\/)\.env(\.[^/]*)?$/, 'a .env file (secrets live there)'],
  [/(^|\/)meshy-ledger\.jsonl$/, 'the Meshy credit ledger (internal spend records)'],
  [/\.(pem|key|p12|pfx)$/i, 'a key or certificate file'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$/, 'an SSH key'],
  [/\.keypair\.json$/i, 'a wallet keypair'],
];
/** Library licences that may ship: CC0 and permissive ones (attribution licences carry their credit line). */
export const ALLOWED_LICENCES = ['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'Unlicense', '0BSD'];
/** Library index files at the library root: metadata games.fun wrote, kept whole (entries for files we leave out are
 *  ignored by the tools, which check each file exists). */
const LIBRARY_INDEX = new Set(['LICENSES.json', 'props.json', 'bodies.json', 'kits.json', 'sources.json', 'body-sources.json', 'props-folio.json', 'sources.lock.json']);

export const isMeshy = (rel, rec) => /(^|\/)meshy-/.test(rel) || /meshy/i.test([rec?.author, rec?.title, rec?.from, rec?.page, rec?.kind].filter(Boolean).join(' '));

/**
 * Decide each library file. rel: path under the library folder. licences: LICENSES.json → files. sidecar(rel): the
 * parsed body sidecar JSON for bodies/<id>.json, or null. licenceFile(rel): the SPDX id of the LICENSE text in that
 * file's own folder (licenceOfText), or null. → { keep, why }
 */
export function libraryDecision(rel, licences, sidecar = () => null, licenceFile = () => null) {
  if (!rel.includes('/')) {
    if (LIBRARY_INDEX.has(rel)) return { keep: true, why: 'library index' };
    return { keep: false, why: 'not a library index or asset' };
  }
  const rec = licences[rel];
  const side = /^bodies\/[^/]+\.json$/.test(rel) ? rel.replace(/\.json$/, '.glb') : null;
  if (side) {
    const body = libraryDecision(side, licences, sidecar, licenceFile);
    const meta = sidecar(rel);
    if (meta && isMeshy(rel, meta)) return { keep: false, why: 'Meshy-generated (licence tier unconfirmed)' };
    return body.keep ? { keep: true, why: `sidecar of ${side}` } : { keep: false, why: `sidecar of a left-out body (${body.why})` };
  }
  if (!rec) {
    // a folder that carries its upstream's own licence text (LICENSE beside the files) and no Meshy output
    const spdx = isMeshy(rel, null) ? null : licenceFile(rel);
    if (spdx && ALLOWED_LICENCES.includes(spdx)) return { keep: true, why: `${spdx} (LICENSE beside it)` };
    return { keep: false, why: 'no LICENSES.json record' };
  }
  if (isMeshy(rel, rec)) return { keep: false, why: 'Meshy-generated (licence tier unconfirmed)' };
  if (rec.spdx == null) {
    if (rec.generated && /^games\.fun/i.test(rec.author ?? '')) {
      if (rec.of) { const of = libraryDecision(rec.of, licences, sidecar, licenceFile); if (!of.keep) return { keep: false, why: `made from a left-out file (${of.why})` }; }
      return { keep: true, why: 'generated by games.fun' };
    }
    return { keep: false, why: 'no licence' };
  }
  if (!ALLOWED_LICENCES.includes(rec.spdx)) return { keep: false, why: `licence ${rec.spdx} is not CC0 or permissive` };
  return { keep: true, why: rec.spdx };
}

/** The SPDX id of a licence text, for the few whole texts a library folder carries beside its files. Unknown → null. */
export function licenceOfText(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  if (/Permission is hereby granted, free of charge, to any person obtaining a copy of this software/.test(t) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(t)) return 'MIT';
  if (/Apache License,? Version 2\.0/.test(t)) return 'Apache-2.0';
  if (/CC0 1\.0 Universal/.test(t)) return 'CC0-1.0';
  return null;
}

/**
 * A licence text named for what it covers, beside those files (bodies/rocketbox-LICENSE.md beside the Rocketbox bodies):
 * `<name>-LICENSE`, `LICENSE-<name>`, with .md or .txt. It has no LICENSES.json record of its own (it is not an asset).
 */
export const isNamedLicence = rel => /^(?:[A-Za-z0-9_.]+-)?LICEN[CS]E(?:-[A-Za-z0-9_.-]+)?(?:\.(?:md|txt))?$/.test(rel.split('/').pop()) && !/(^|\/)LICENSE$/.test(rel);
/** A named licence text ships when its own text is a licence that may ship (licenceOfText). → { keep, why } */
export function namedLicenceDecision(text) {
  const spdx = licenceOfText(text);
  return spdx && ALLOWED_LICENCES.includes(spdx) ? { keep: true, why: `licence text (${spdx})` } : { keep: false, why: 'a licence text that is not a permissive licence' };
}

/** Key-shaped strings. A hit fails the sync (the snapshot is public to anyone who can read this repository). */
export const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['OpenAI or Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['Meshy key', /\bmsy_[A-Za-z0-9_-]{16,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/],
  ['secret assigned a literal', /\b[A-Za-z0-9_]*(?:SECRET|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_TOKEN|SERVICE_ROLE|PASSWORD)[A-Za-z0-9_]*["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{16,}["']/i],
  ['Solana secret key (base58)', /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{86,90}(?![A-Za-z0-9])/],
];
const TEXT_EXT = /\.(m?js|cjs|json|jsonl|md|txt|html?|css|ya?ml|toml|ini|cfg|env|sh|ps1|py|ts|tsx|jsx|svg|csv|xml|example)$/i;
const looksText = (rel, buf) => TEXT_EXT.test(rel) || (!buf.subarray(0, 8192).includes(0) && !/\.(glb|gltf|png|jpe?g|webp|ktx2|hdr|wasm|bin|ogg|mp3|wav|zip|gz)$/i.test(rel));

/** → [{ file, kind, at }] for every key-shaped string in a text file (binary assets are not scanned). */
export function scanSecrets(rel, buf) {
  if (!looksText(rel, buf)) return [];
  const text = buf.toString('utf8');
  const hits = [];
  for (const [kind, re] of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ file: rel, kind, at: text.slice(0, m.index).split('\n').length });
  }
  // a Solana keypair file: a JSON array of exactly 64 bytes
  if (/\.json$/i.test(rel)) {
    try { const v = JSON.parse(text); if (Array.isArray(v) && v.length === 64 && v.every(n => Number.isInteger(n) && n >= 0 && n < 256)) hits.push({ file: rel, kind: 'wallet keypair (64-byte array)', at: 1 }); } catch {}
  }
  return hits;
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** Whether a games.fun-relative path is left out by its folder or file name, with the reason. */
export function excludedByName(rel) {
  const segs = rel.split('/');
  for (const d of EXCLUDED_DIRS) if (segs.slice(0, -1).includes(d)) return `inside a ${d}/ folder`;
  for (const [re, why] of EXCLUDED_FILE) if (re.test(rel)) return why;
  return null;
}

// ---------------- reading games.fun at a commit ----------------
function git(repo, args, opts = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: opts.encoding ?? 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').toString().trim()}`);
  return r.stdout;
}

/** Tracked entries at `commit` under `paths`: [{ mode, type, object, path }] */
function lsTree(repo, commit, paths) {
  const out = git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths]);
  return out.split('\0').filter(Boolean).map(line => {
    const [meta, file] = line.split('\t');
    const [mode, type, object] = meta.split(' ');
    return { mode, type, object, path: file };
  });
}

/** Blob contents for many objects in one `git cat-file --batch`. → Map(object → Buffer) */
function readBlobs(repo, objects) {
  return new Promise((ok, no) => {
    const p = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', c => chunks.push(c));
    p.stderr.on('data', c => { err += c; });
    p.on('error', no);
    p.on('close', code => {
      if (code !== 0) return no(new Error(`git cat-file failed: ${err.trim()}`));
      const all = Buffer.concat(chunks), out = new Map();
      let i = 0;
      while (i < all.length) {
        const nl = all.indexOf(0x0a, i);
        const [obj, type, size] = all.subarray(i, nl).toString('utf8').split(' ');
        if (type !== 'blob') return no(new Error(`git cat-file: ${obj} is ${type ?? 'missing'}`));
        const n = Number(size);
        out.set(obj, all.subarray(nl + 1, nl + 1 + n));
        i = nl + 1 + n + 1;
      }
      ok(out);
    });
    p.stdin.end([...new Set(objects)].join('\n') + '\n');
  });
}

/** Find the games.fun checkout. */
export function findSource(explicit = null) {
  const cands = [explicit, process.env.GAMESFUN_REPO, path.join(KIT_ROOT, '..', 'games.fun')];
  // a git worktree: the main checkout's sibling
  try {
    const common = git(KIT_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    cands.push(path.join(path.dirname(common), '..', 'games.fun'));
  } catch {}
  for (const c of cands.filter(Boolean)) if (existsSync(path.join(c, 'research', 'gf-three', 'kit'))) return path.resolve(c);
  return null;
}

// ---------------- what the tools reach ----------------
const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// a file named beside the module: new URL('./x', import.meta.url). The tools use it for files they read or load only
// when present (the watch relay, a package list), so a target that games.fun does not track is not a problem.
const URL_RE = /new URL\(\s*['"](\.{1,2}\/[^'"]*[^'"/])['"]\s*,\s*(?:import\.meta\.url|here)\s*\)/g;
// a resolution hook a module installs for itself: register('./x.mjs', import.meta.url)
const REGISTER_RE = /\bregister\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
const PART_RE = /importPart\(\s*join\(\s*([A-Z0-9_]+)\s*,\s*'([^']+)'\s*\)/g;
/**
 * JavaScript source without its comments. A small scanner, because a pattern cannot tell a slash and a star inside a
 * string, a line comment or a regular expression from the start of a block comment: strings, template literals and
 * regular expressions are kept as they are; a comment becomes nothing (line breaks stay, so line numbers hold).
 */
export function stripComments(t) {
  let out = '', i = 0, last = '';   // last: the last character of code that is not white space
  const n = t.length;
  const quoted = q => { let j = i + 1; while (j < n && t[j] !== q) { if (t[j] === '\\') j++; else if (q !== '`' && t[j] === '\n') break; j++; } return Math.min(j + 1, n); };
  while (i < n) {
    const c = t[i], d = t[i + 1];
    if (c === '/' && d === '/') { while (i < n && t[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = t.indexOf('*/', i + 2), end = e < 0 ? n : e + 2; out += t.slice(i, end).replace(/[^\n]/g, ''); i = end; continue; }
    if (c === '\'' || c === '"' || c === '`') { const e = quoted(c); out += t.slice(i, e); i = e; last = c; continue; }
    if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /(?:^|[^\w$.])(?:return|typeof|case|of|in|do|else|void|delete|throw|yield|await)\s*$/.test(out.slice(-12)))) {
      let j = i + 1, cls = false;   // a regular expression literal
      while (j < n && t[j] !== '\n' && (cls || t[j] !== '/')) { if (t[j] === '\\') j++; else if (t[j] === '[') cls = true; else if (t[j] === ']') cls = false; j++; }
      out += t.slice(i, j + 1); i = j + 1; last = '/'; continue;
    }
    out += c; if (!/\s/.test(c)) last = c; i++;
  }
  return out;
}
/**
 * Code with the text of template literals blanked (line breaks stay). A tool that writes a game's source file as a
 * template (create.mjs writes `import { FEEL_OP } from './gf/forge/feel.js'` into a game's rules) does not import it.
 * Run on stripComments' output, where strings and templates are intact. `${…}` expressions are blanked with the rest.
 */
export function maskTemplates(code) {
  let out = '', i = 0;
  const n = code.length, stack = [];   // stack: brace depth at which each open `${` began
  while (i < n) {
    const c = code[i];
    if (!stack.length || stack.at(-1).tpl === false) {
      if (c === '\'' || c === '"') { let j = i + 1; while (j < n && code[j] !== c) { if (code[j] === '\\') j++; else if (code[j] === '\n') break; j++; } out += code.slice(i, j + 1); i = j + 1; continue; }
      if (c === '`') { stack.push({ tpl: true }); out += c; i++; continue; }
      if (stack.length) { if (c === '{') stack.at(-1).braces++; if (c === '}' && --stack.at(-1).braces < 0) { stack.pop(); out += c; i++; continue; } }
      out += c; i++; continue;
    }
    // inside a template literal
    if (c === '\\') { out += code[i + 1] === '\n' ? ' \n' : '  '; i += 2; continue; }
    if (c === '`') { stack.pop(); out += c; i++; continue; }
    if (c === '$' && code[i + 1] === '{') { stack.push({ tpl: false, braces: 0 }); out += '  '; i += 2; continue; }
    out += c === '\n' ? c : ' '; i++;
  }
  return out;
}
const isModule = f => /\.m?js$/.test(f);

/**
 * The folder constants of tools/lib/paths.mjs (REPO, GF3, FORGE_KIT, …) as games.fun-relative paths, read from its
 * text: `export const NAME = join(BASE, 'rel')`. → Map(name → rel)
 */
export function pathConstants(text) {
  const out = new Map([['REPO', '']]);
  for (let pass = 0; pass < 4; pass++) {
    for (const m of text.matchAll(/export const ([A-Z0-9_]+) = join\(([A-Z0-9_]+), '([^']+)'\)/g)) {
      if (out.has(m[2]) && !out.has(m[1])) out.set(m[1], path.posix.join(out.get(m[2]), m[3]));
    }
  }
  return out;
}

/** Every games.fun path tools/lib/paths.mjs names as a literal ('research/…', or `${T}/…` with T's value). → [rel] */
export function namedPaths(text) {
  const code = stripComments(text), out = new Set();
  const T = /const T = '([^']+)'/.exec(code)?.[1];
  for (const m of code.matchAll(/'((?:research|creator-studio)\/[^'*${}]+)'/g)) out.add(m[1].replace(/\/$/, ''));
  if (T) for (const m of code.matchAll(/`\$\{T\}\/([^`${}]+)`/g)) out.add(`${T}/${m[1]}`);
  if (T) out.delete(T);
  for (const [, rel] of pathConstants(code)) if (rel) out.add(rel);
  return [...out].sort();
}

/** The kit versions the tools at this commit use: read from the code, so a sync never copies a version the tools do not ask for. */
export function kitVersions(read) {
  const paths = read(PATHS) ?? '', mp = read(MP_MANIFEST) ?? '';
  return {
    mp: /export const KIT_VERSION = '([^']+)'/.exec(mp)?.[1] ?? null,
    // the newest frozen version (the manifest's DEV_VERSION). It is KIT_VERSION again once games.fun promotes it.
    mpDev: /export const DEV_VERSION = '([^']+)'/.exec(mp)?.[1] ?? /export const KIT_VERSION = '([^']+)'/.exec(mp)?.[1] ?? null,
    audio: /kits\/gf-audio\/(\d+\.\d+\.\d+)/.exec(paths)?.[1] ?? null,
    assets: /kits\/gf-assets\/(\d+\.\d+\.\d+)/.exec(paths)?.[1] ?? null,
    gf3: /export const KIT_VERSION = '([^']+)'/.exec(paths)?.[1] ?? null,
    scenic: /export const SCENIC_VERSION = '([^']+)'/.exec(paths)?.[1] ?? null,
    vista: /export const VISTA_VERSION = '([^']+)'/.exec(paths)?.[1] ?? null,
  };
}

/**
 * Walk the Node tooling from ENTRIES. `has(rel)`: is this a file games.fun tracks; `read(rel)`: its text;
 * `browser(rel)`: a page module (its imports follow a game's layout, so they are not followed).
 * Follows relative imports (static and import('…')), register('…', import.meta.url), files named with
 * new URL('…', import.meta.url), and the parts
 * loaded by path with importPart(join(CONST, '…')). An import that leaves the tracked files, or a static import into a
 * LEFT_OUT part, is a problem; an importPart or import('…') into a LEFT_OUT part is recorded and skipped.
 * → { modules: Set(rel), parts: [{ path, from, taken, why }], problems }
 */
export function closure({ entries = ENTRIES, has, read, browser = () => false, faults = TOOL_FAULTS, soft = () => true }) {
  const problems = [], modules = new Set(), parts = [], excused = new Set(), usedFaults = new Set();
  const consts = pathConstants(stripComments(read(PATHS) ?? ''));
  const queue = [];
  for (const f of entries) { if (has(f)) queue.push(f); else problems.push(`entry ${f} is not in games.fun at this commit`); }
  while (queue.length) {
    const f = queue.shift();
    if (modules.has(f)) continue;
    modules.add(f);
    if (!isModule(f) || browser(f)) continue;
    const code = maskTemplates(stripComments(read(f)));
    const rel = spec => path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec || !spec.startsWith('.')) continue;
      const target = rel(spec), fault = faults.find(x => x.from === f && x.imports === target);
      if (fault || excused.has(f)) { if (fault) usedFaults.add(fault); if (has(target)) { excused.add(target); queue.push(target); } else problems.push(`${f} imports ${spec} (${target}), which games.fun does not track at this commit`); continue; }
      const out = leftOut(target);
      // import('…') runs only when its line is reached: into a left-out part it is that part's lazy load, as importPart is
      if (out && m[2]) { if (!parts.some(p => p.path === target && p.from === f)) parts.push({ path: target, from: f, taken: false, why: out.why }); }
      else if (out) problems.push(`${f} imports ${spec} (${target}), which is left out: ${out.why}. It must be loaded with importPart, when a game needs it`);
      else if (has(target)) queue.push(target);
      else problems.push(`${f} imports ${spec} (${target}), which games.fun does not track at this commit`);
    }
    for (const m of code.matchAll(REGISTER_RE)) { const target = rel(m[1]); if (has(target)) queue.push(target); else problems.push(`${f} registers ${m[1]} (${target}), which games.fun does not track at this commit`); }
    for (const m of code.matchAll(URL_RE)) { const target = rel(m[1]); if (has(target) && !leftOut(target) && soft(target)) queue.push(target); }
    for (const m of code.matchAll(PART_RE)) {
      if (!consts.has(m[1])) { problems.push(`${f} loads a part from ${m[1]}, which ${PATHS} does not define as a folder`); continue; }
      const target = path.posix.join(consts.get(m[1]), m[2]), out = leftOut(target);
      if (parts.some(p => p.path === target && p.from === f)) continue;
      if (out) parts.push({ path: target, from: f, taken: false, why: out.why });
      else if (has(target)) { parts.push({ path: target, from: f, taken: true, why: 'loaded when a game needs it' }); queue.push(target); }
      else problems.push(`${f} loads ${target} with importPart, which games.fun does not track at this commit`);
    }
  }
  for (const x of faults) if (!usedFaults.has(x) && modules.has(x.from)) problems.push(`TOOL_FAULTS: ${x.from} no longer imports ${x.imports}; delete the entry in scripts/sync-kits.mjs`);
  return { modules, parts: parts.sort((a, b) => (a.path + a.from).localeCompare(b.path + b.from)), problems };
}

/** kits/ on its own (no games.fun): every import of the Node tooling resolves to a file that is there. → problems[] */
export function closureProblems(files, browserRoots = []) {
  const text = rel => files.get(rel)?.toString('utf8') ?? null;
  const r = closure({ has: rel => files.has(rel), read: text, browser: rel => browserRoots.some(b => rel.startsWith(b + '/')) });
  return r.problems;
}

const WIN_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
/**
 * Paths that would break a checkout on Windows or macOS: longer than a safe share of MAX_PATH (260) once cloned
 * somewhere ordinary, two paths differing only in case, Windows device names, characters Windows forbids, or names
 * ending in a dot or a space. → problems[]
 */
export function portabilityProblems(rels, { prefix = 'kits/', maxLength = 170 } = {}) {
  const problems = [], seen = new Map();
  for (const rel of rels) {
    const full = `${prefix}${rel}`;
    if (full.length > maxLength) problems.push(`${full}: path is ${full.length} characters (Windows MAX_PATH)`);
    const low = rel.toLowerCase();
    if (seen.has(low)) problems.push(`${full}: differs from ${prefix}${seen.get(low)} only in case`);
    else seen.set(low, rel);
    for (const seg of rel.split('/')) {
      if (WIN_DEVICE.test(seg)) problems.push(`${full}: "${seg}" is a Windows device name`);
      if (/[<>:"|?*\\\x00-\x1f]/.test(seg)) problems.push(`${full}: "${seg}" has a character Windows forbids`);
      if (/[. ]$/.test(seg)) problems.push(`${full}: "${seg}" ends in a dot or a space`);
    }
  }
  return problems;
}

/** Read blobs as they are asked for, a batch at a time. */
function blobReader(repo, tree) {
  const cache = new Map();
  return {
    async load(rels) {
      const need = rels.filter(r => tree.has(r) && !cache.has(r));
      if (!need.length) return;
      const blobs = await readBlobs(repo, need.map(r => tree.get(r).object));
      for (const r of need) cache.set(r, blobs.get(tree.get(r).object));
    },
    get: rel => cache.get(rel) ?? null,
  };
}

/** Build the snapshot in memory from games.fun at `commit`. → { commit, date, files: Map(rel → Buffer), excluded, sources, parts, versions, problems } */
export async function buildSnapshot(repo, commit = 'HEAD') {
  const full = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  const date = git(repo, ['show', '-s', '--format=%cI', full]).trim();
  const problems = [], excluded = [];
  const tree = new Map(lsTree(repo, full, ['research', 'creator-studio']).map(e => [e.path, e]));
  const blobs = blobReader(repo, tree);
  const isFile = rel => tree.get(rel)?.type === 'blob' && tree.get(rel).mode !== '120000';
  const under = dir => [...tree.keys()].filter(p => p === dir || p.startsWith(dir + '/'));

  // 1. the kit versions the tools name, then the data folders
  await blobs.load([PATHS, MP_MANIFEST]);
  const text = rel => blobs.get(rel)?.toString('utf8') ?? null;
  const versions = kitVersions(text);
  for (const [k, v] of Object.entries(versions)) if (!v) problems.push(`could not read the ${k} version from the tools at ${full.slice(0, 12)}`);
  // a version named twice (the newest frozen multiplayer kit is the one create vendors) is one folder, listed once
  const data = DATA.map(d => ({ ...d, path: d.path.replace(/\{(\w+)\}/g, (m, k) => versions[k] ?? m) })).filter((d, i, all) => all.findIndex(x => x.path === d.path) === i);
  const browserRoots = data.filter(d => d.browser).map(d => d.path);
  const isBrowser = rel => browserRoots.some(b => rel === b || rel.startsWith(b + '/'));
  const chosen = new Map();   // rel → 'data' | 'closure'
  for (const d of data) {
    const mine = under(d.path);
    if (!mine.length) { problems.push(`${d.path}: not in games.fun at ${full.slice(0, 12)}`); continue; }
    for (const rel of mine) {
      const why = excludedByName(rel), out = leftOut(rel);
      if (why) { excluded.push({ path: rel, why }); continue; }
      if (out) { excluded.push({ path: rel, why: `left out: ${out.why}` }); continue; }   // a left-out file inside a data folder
      chosen.set(rel, 'data');
    }
  }

  // 2. the import closure of the tools the CLI runs. Modules are read a round at a time (the walk needs their text).
  let walked;
  for (let round = 0; round < 64; round++) {
    const missing = new Set();
    walked = closure({
      has: isFile, browser: isBrowser, soft: rel => !excludedByName(rel),
      read: rel => { const b = blobs.get(rel); if (b == null) { missing.add(rel); return ''; } return b.toString('utf8'); },
    });
    if (!missing.size) break;
    await blobs.load([...missing]);
  }
  problems.push(...walked.problems);
  for (const rel of walked.modules) {
    const why = excludedByName(rel);
    // a module a tool imports is needed wherever it lives; only a file that must never ship stops the sync
    if (why && !/^inside a /.test(why)) { problems.push(`${rel}: the tools import it, but it is ${why}`); continue; }
    if (!chosen.has(rel)) chosen.set(rel, 'closure');
  }

  // 3. every folder the tools name by path is in the snapshot, or is a part this package leaves out
  for (const rel of namedPaths(text(PATHS) ?? '')) {
    if (leftOut(rel) || !under(rel).length && !tree.has(rel)) { if (!leftOut(rel)) problems.push(`${PATHS} names ${rel}, which is not in games.fun at ${full.slice(0, 12)}`); continue; }
    if (![...chosen.keys()].some(p => p === rel || p.startsWith(rel + '/'))) problems.push(`${PATHS} names ${rel}, and nothing under it is in the snapshot (add it to DATA or LEFT_OUT in scripts/sync-kits.mjs)`);
  }

  // 4. symlinks, then the libraries licence by licence
  const pick = [];
  for (const rel of [...chosen.keys()].sort()) {
    const e = tree.get(rel);
    if (e.mode === '120000') { problems.push(`${rel}: a symlink (kits must hold plain files only)`); continue; }
    if (e.type !== 'blob') { excluded.push({ path: rel, why: `a ${e.type}` }); continue; }
    pick.push(rel);
  }
  await blobs.load(pick);
  const files = new Map();
  const libOf = rel => LIBRARIES.find(l => rel.startsWith(l + '/')) ?? null;
  const licences = Object.fromEntries(LIBRARIES.map(l => { try { return [l, JSON.parse(text(`${l}/LICENSES.json`)).files ?? {}]; } catch { return [l, {}]; } }));
  for (const rel of pick) {
    const lib = libOf(rel);
    if (lib) {
      const sidecar = r => { try { return JSON.parse(text(`${lib}/${r}`)); } catch { return null; } };
      const licenceFile = r => licenceOfText(text(`${lib}/${path.posix.dirname(r)}/LICENSE`));
      const inLib = rel.slice(lib.length + 1);
      const d = /(^|\/)LICENSE$/.test(inLib) && inLib.includes('/') ? { keep: true, why: 'licence text' }
        : isNamedLicence(inLib) ? namedLicenceDecision(text(rel))
        : libraryDecision(inLib, licences[lib], sidecar, licenceFile);
      if (!d.keep) { excluded.push({ path: rel, why: d.why }); continue; }
    }
    files.set(rel, blobs.get(rel));
  }
  // a module the tools import that a rule above dropped
  for (const rel of walked.modules) if (!files.has(rel) && !problems.some(p => p.startsWith(rel + ':'))) problems.push(`${rel}: the tools import it, but the library licence rule leaves it out`);

  // 5. secrets and portability
  for (const [rel, buf] of files) for (const h of scanSecrets(rel, buf)) problems.push(`${rel}:${h.at}: looks like a ${h.kind}`);
  problems.push(...portabilityProblems([...files.keys()]));

  const size = list => ({ files: list.length, bytes: list.reduce((n, p) => n + files.get(p).length, 0) });
  const kept = [...files.keys()];
  const sources = data.map(d => ({ path: d.path, why: d.why, ...size(kept.filter(p => p === d.path || p.startsWith(d.path + '/'))) }));
  const modules = kept.filter(p => chosen.get(p) === 'closure').sort();
  return {
    commit: full, date, files, versions, sources, modules, parts: walked.parts, browserRoots,
    closure: size(modules), excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)), problems,
  };
}

/** KITS.json for a snapshot: deterministic (the same commit gives the same bytes). */
export function kitsRecord(snap) {
  const v = snap.versions;
  const files = Object.fromEntries([...snap.files.keys()].sort().map(k => [k, sha256(snap.files.get(k))]));
  const bytes = [...snap.files.values()].reduce((n, b) => n + b.length, 0);
  const why = {};
  for (const e of snap.excluded) why[e.why] = (why[e.why] ?? 0) + 1;
  return {
    schema: SCHEMA,
    about: 'A sparse mirror of the games.fun repository at one commit: the kits games are built on and the tools that create and verify them. Written by scripts/sync-kits.mjs; never edited by hand (fix the kit in games.fun and sync again). tests/kits.test.mjs checks kits/ against this file.',
    source: { repo: 'games.fun', commit: snap.commit, date: snap.date },
    kits: {
      'gf-three': { version: v.gf3, path: 'research/gf-three' },
      'gf-scenic': { version: v.scenic, path: 'research/gf-scenic' },
      'gf-vista': { version: v.vista, path: 'research/gf-vista' },
      'gf-multiplayer': { version: v.mp, path: `research/foundations/kits/gf-multiplayer/${v.mp}`, ...(v.mpDev && v.mpDev !== v.mp ? { newest: v.mpDev, newestPath: `research/foundations/kits/gf-multiplayer/${v.mpDev}` } : {}) },
      'gf-audio': { version: v.audio, path: `research/foundations/kits/gf-audio/${v.audio}` },
      'gf-assets': { version: v.assets, path: `research/foundations/kits/gf-assets/${v.assets}` },
    },
    policy: {
      how: 'the import closure of `entries`, the parts they load by path (`parts`), and the data folders in `sources`',
      excludedDirs: EXCLUDED_DIRS,
      leftOut: LEFT_OUT,
      libraryLicences: ALLOWED_LICENCES,
      libraryRule: 'a library file ships when its LICENSES.json record is CC0 or a permissive licence, or it is generated by games.fun, or its folder carries a permissive LICENSE text; a licence text named for what it covers (bodies/rocketbox-LICENSE.md) ships when its text is a permissive licence; never Meshy output or a file without a licence',
      secrets: 'no .env files; text files are scanned for key-shaped strings and the sync fails on any hit',
    },
    totals: { files: snap.files.size, bytes, excluded: snap.excluded.length, excludedBy: Object.fromEntries(Object.entries(why).sort()) },
    entries: ENTRIES,
    parts: snap.parts,
    browserRoots: snap.browserRoots,
    closure: { ...snap.closure, modules: snap.modules },
    sources: snap.sources,
    excluded: snap.excluded.filter(e => LIBRARIES.some(l => e.path.startsWith(l + '/'))),
    files,
  };
}

async function walk(dir, base = dir, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules') continue;   // e.g. tools/lib/char-deps/node_modules, installed on demand (git-ignored)
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Compare kits/ on disk with a record. → { missing, changed, extra } */
export async function diffKits(record, kitsDir = KITS) {
  const have = new Set((await walk(kitsDir)).filter(f => f !== 'KITS.json'));
  const missing = [], changed = [], extra = [];
  for (const [rel, h] of Object.entries(record.files)) {
    if (!have.has(rel)) { missing.push(rel); continue; }
    have.delete(rel);
    if (sha256(await readFile(path.join(kitsDir, ...rel.split('/')))) !== h) changed.push(rel);
  }
  extra.push(...[...have].sort());
  return { missing, changed, extra, ok: !missing.length && !changed.length && !extra.length };
}

const json = v => JSON.stringify(v, null, 1) + '\n';

/**
 * AGENTS.md's game-building part is generated by the loop's prompt source in kits/ (placeAgentsPart, between its two
 * marks), so the playbook and the build brief cannot say different things. → { ok, same, text, why }
 */
export async function agentsPart(kitRoot = KIT_ROOT) {
  const file = path.join(kitRoot, 'AGENTS.md');
  const brief = path.join(kitRoot, 'kits', ...LOOP.split('/').slice(0, -1), 'brief.mjs');
  if (!existsSync(brief)) return { ok: false, same: false, text: null, why: `${path.relative(kitRoot, brief)} is not in kits/ (sync first)` };
  const { placeAgentsPart, AGENTS_MARKS } = await import(pathToFileURL(brief).href);
  const md = await readFile(file, 'utf8');
  const text = placeAgentsPart(md);
  if (text == null) return { ok: false, same: false, text: null, why: `AGENTS.md has no game-building marks: put these two lines around the "Write the rules" section\n${AGENTS_MARKS.join('\n')}` };
  return { ok: true, same: text === md, text, why: null };
}

async function main() {
  const a = process.argv.slice(2);
  const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const check = a.includes('--check'), dry = a.includes('--dry-run');
  const repo = findSource(opt('--from'));
  if (!repo) { console.error('sync-kits: no games.fun checkout found. Pass --from <dir> or set GAMESFUN_REPO.'); return 2; }
  const prev = existsSync(path.join(KITS, 'KITS.json')) ? JSON.parse(readFileSync(path.join(KITS, 'KITS.json'), 'utf8')) : null;
  const commit = opt('--commit') ?? (check ? prev?.source?.commit : null) ?? 'HEAD';
  console.log(`sync-kits: games.fun at ${repo}, commit ${commit}`);
  const snap = await buildSnapshot(repo, commit);
  if (snap.problems.length) {
    for (const p of snap.problems) console.error(`problem: ${p}`);
    console.error(`sync-kits: FAILED with ${snap.problems.length} problem(s); kits/ is unchanged`);
    return 1;
  }
  const record = kitsRecord(snap);
  const diff = await diffKits(record);
  const recText = json(record);
  const recSame = prev && json(prev) === recText;
  console.log(`snapshot ${snap.commit.slice(0, 12)} (${snap.date}): ${record.totals.files} files, ${(record.totals.bytes / 1048576).toFixed(1)} MB; left out ${record.totals.excluded} (${Object.entries(record.totals.excludedBy).map(([k, v]) => `${v} ${k}`).join('; ')})`);
  console.log(`kits/ vs snapshot: ${diff.missing.length} missing, ${diff.changed.length} changed, ${diff.extra.length} extra; KITS.json ${recSame ? 'same' : 'differs'}`);
  if (check) {
    const ag = diff.ok ? await agentsPart() : { ok: true, same: true };
    if (!ag.ok || !ag.same) console.log(`AGENTS.md: ${ag.why ?? 'the game-building part differs from the generated one (run the sync)'}`);
    return diff.ok && recSame && ag.ok && ag.same ? 0 : 1;
  }
  if (dry) { for (const f of [...diff.missing.map(x => `+ ${x}`), ...diff.changed.map(x => `~ ${x}`), ...diff.extra.map(x => `- ${x}`)].slice(0, 200)) console.log(f); return 0; }
  for (const rel of diff.extra) await rm(path.join(KITS, ...rel.split('/')));
  for (const rel of [...diff.missing, ...diff.changed]) {
    const p = path.join(KITS, ...rel.split('/'));
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, snap.files.get(rel));
  }
  await writeFile(path.join(KITS, 'KITS.json'), recText);
  // empty folders left behind by removed files
  await pruneEmpty(KITS);
  console.log(`sync-kits: wrote ${diff.missing.length + diff.changed.length}, removed ${diff.extra.length}. Commit kits/ with the games.fun commit in the message.`);
  const ag = await agentsPart();
  if (!ag.ok) { console.error(`sync-kits: ${ag.why}`); return 1; }
  if (!ag.same) { await writeFile(path.join(KIT_ROOT, 'AGENTS.md'), ag.text); console.log('sync-kits: AGENTS.md game-building part rewritten from the prompt source (commit it apart from kits/)'); }
  return 0;
}

async function pruneEmpty(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules') await pruneEmpty(path.join(dir, e.name));
  if (dir !== KITS && (await readdir(dir)).length === 0) await rm(dir, { recursive: true });
}

if (isMain(import.meta)) process.exitCode = await main();
