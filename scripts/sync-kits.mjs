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
// What is copied and why: SOURCES below. What is never copied: regressions, sandbox, lookdev, evidence, node_modules,
// caches, .env files and anything key-shaped (the copied text is scanned and the sync fails on a hit), and library
// assets whose licence is not CC0 or permissive or that Meshy generated (the Meshy licence tier is unconfirmed).
// Never edit kits/ by hand: fix the kit in games.fun and run this again.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../lib/main.mjs';

const KIT_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const KITS = path.join(KIT_ROOT, 'kits');

export const SCHEMA = 'gamesfun-kits/1';
const LIB = 'research/gf-three/library';

/** What a game, create, verify, dev and slots need from games.fun. Paths are games.fun-relative (files or folders). */
export const SOURCES = [
  { path: 'research/gf-three/README.md', why: 'gf-three overview' },
  { path: 'research/gf-three/CONTRACT.md', why: 'gf-three API: what rules.js and config are written against' },
  { path: 'research/gf-three/kit', why: 'gf-three kit, vendored into each game as gf/three/' },
  { path: 'research/gf-three/tools', why: 'gf-three tools: create, verify, slots, catalog, serve, upgrade, play, promises, meshy-*' },
  { path: LIB, why: 'props, bodies, clips and textures (CC0 or permissive only; no Meshy output)', filter: 'library' },
  { path: 'research/foundations/kits/gf-audio/1.5.0', why: 'gf-audio 1.5.0, vendored into each game as audio/' },
  { path: 'research/foundations/kits/gf-audio/1.2.0/source/meter.mjs', why: 'the loudness meter the audio gate v4 imports (its frozen targets)' },
  { path: 'research/foundations/kits/gf-multiplayer/1.3.0', why: 'gf-multiplayer 1.3.0, vendored into each game as gf/mp/' },
  { path: 'research/foundations/kits/gf-assets/1.3.0', why: 'gf-assets 1.3.0 (gf/gf-assets.js; verify checks its SHA256SUMS)' },
  { path: 'research/foundations/qa/browser.mjs', why: 'how verify launches Chrome' },
  { path: 'research/foundations/trials/fps-arena/source/vendor/three', why: 'three.js 0.186.0 build (pinned)' },
  { path: 'research/foundations/trials/fps-arena/source/vendor/postprocessing', why: 'pmndrs postprocessing (pinned)' },
  { path: 'research/foundations/trials/fps-arena/source/vendor/n8ao', why: 'N8AO (pinned)' },
  { path: 'research/foundations/trials/third-person-adventure/source/vendor/rapier', why: 'Rapier 0.19.2 (pinned)' },
  { path: 'research/multiplayer/STANDARD.md', why: 'the multiplayer bar every game meets' },
  { path: 'research/multiplayer/party/LIVE_HANDBOOK.md', why: 'how a live game shares its world' },
  { path: 'research/multiplayer/party/lib.mjs', why: 'local game server with signaling (verify, play)' },
  { path: 'research/multiplayer/party/manifest.mjs', why: 'multiplayer.json validation and the kit file list' },
  { path: 'research/multiplayer/party/adopt.mjs', why: 'vendors gf-multiplayer into a game (create)' },
  { path: 'research/multiplayer/party/gate.mjs', why: 'the two-player gate (verify check 5)' },
  { path: 'research/multiplayer/party/gate-lib.mjs', why: 'the two-player gate (verify check 5)' },
  { path: 'research/multiplayer/party/gate-live.mjs', why: 'the two-player gate for live games (verify check 5)' },
  { path: 'research/multiplayer/party/serve.mjs', why: 'gf-multiplayer serve tool' },
  { path: 'research/multiplayer/party/kit', why: 'gf-multiplayer dev sources (tools read declarations through them)' },
  { path: 'research/multiplayer/p2p/signal-server.mjs', why: 'local signaling: WebSocket /signal and HTTP /signal/v1' },
  { path: 'research/multiplayer/p2p/vendor', why: 'ws 8.21.3, vendored by the signal server' },
  { path: 'creator-studio/lib/signal-core.mjs', why: 'the HTTP signaling protocol (shared with the play host)' },
  { path: 'creator-studio/lib/asset-kinds.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/lib/code-literals.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/lib/image-size.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/lib/manifest-normalize.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/lib/manifest.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/lib/source-record.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'creator-studio/vendor/gf-audio-1.5.0/sounds.mjs', why: 'sound list validation (verify check 1)' },
  { path: 'research/asset-manifest/validate.mjs', why: 'asset manifest validation (verify check 1)' },
  { path: 'research/asset-manifest/play-driver.mjs', why: 'real input for the gate (verify check 5)' },
  { path: 'research/asset-manifest/runtime/gf-assets.js', why: 'asset manifest runtime (validation)' },
  { path: 'research/audio/qa-gate-v4.mjs', why: 'the audio gate (verify check 7)' },
  { path: 'research/studio-v2/game-spec.schema.json', why: 'the game spec schema create validates' },
  { path: 'research/studio-v2/pitch.schema.json', why: 'the pitch schema (playbook)' },
  { path: 'research/studio-v2/specs/dev-dodgeball.spec.json', why: 'the kit development spec (an example spec)' },
];

/** Never copied, anywhere in a source path. */
export const EXCLUDED_DIRS = ['node_modules', 'evidence', '.cache', 'regressions', 'sandbox', 'lookdev', 'character-bench', '.git'];
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
const LIBRARY_INDEX = new Set(['LICENSES.json', 'props.json', 'bodies.json', 'kits.json', 'sources.json', 'body-sources.json']);

export const isMeshy = (rel, rec) => /(^|\/)meshy-/.test(rel) || /meshy/i.test([rec?.author, rec?.title, rec?.from, rec?.page, rec?.kind].filter(Boolean).join(' '));

/**
 * Decide each library file. rel: path under the library folder. licences: LICENSES.json → files. sidecar(rel): the
 * parsed body sidecar JSON for bodies/<id>.json, or null. → { keep, why }
 */
export function libraryDecision(rel, licences, sidecar = () => null) {
  if (!rel.includes('/')) {
    if (LIBRARY_INDEX.has(rel)) return { keep: true, why: 'library index' };
    return { keep: false, why: 'not a library index or asset' };
  }
  const rec = licences[rel];
  const side = /^bodies\/[^/]+\.json$/.test(rel) ? rel.replace(/\.json$/, '.glb') : null;
  if (side) {
    const body = libraryDecision(side, licences, sidecar);
    const meta = sidecar(rel);
    if (meta && isMeshy(rel, meta)) return { keep: false, why: 'Meshy-generated (licence tier unconfirmed)' };
    return body.keep ? { keep: true, why: `sidecar of ${side}` } : { keep: false, why: `sidecar of a left-out body (${body.why})` };
  }
  if (!rec) return { keep: false, why: 'no LICENSES.json record' };
  if (isMeshy(rel, rec)) return { keep: false, why: 'Meshy-generated (licence tier unconfirmed)' };
  if (rec.spdx == null) {
    if (rec.generated && /^games\.fun/i.test(rec.author ?? '')) {
      if (rec.of) { const of = libraryDecision(rec.of, licences, sidecar); if (!of.keep) return { keep: false, why: `made from a left-out file (${of.why})` }; }
      return { keep: true, why: 'generated by games.fun' };
    }
    return { keep: false, why: 'no licence' };
  }
  if (!ALLOWED_LICENCES.includes(rec.spdx)) return { keep: false, why: `licence ${rec.spdx} is not CC0 or permissive` };
  return { keep: true, why: rec.spdx };
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

// Relative imports in Node-side tooling must resolve inside the snapshot. These are shimmed instead (lib/kit-hooks.mjs).
export const SHIMMED_IMPORTS = [/\/pipeline\/node_modules\/playwright\/index\.mjs$/];
const CLOSURE_ENTRIES = [
  ...['create', 'verify', 'serve', 'slots', 'catalog', 'upgrade', 'world', 'dressing', 'loadouts', 'promises', 'play', 'meshy-prop', 'meshy-character', 'rig-check', 'optimize'].map(t => `research/gf-three/tools/${t}.mjs`),
  'research/multiplayer/p2p/signal-server.mjs', 'research/multiplayer/party/gate.mjs', 'research/multiplayer/party/adopt.mjs', 'research/multiplayer/party/serve.mjs',
];
const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

/** Every relative import reachable from the Node tooling, resolved against the selected file set. → problems[] */
export function closureProblems(files) {
  const problems = [], seen = new Set(), queue = CLOSURE_ENTRIES.filter(f => files.has(f));
  for (const f of CLOSURE_ENTRIES) if (!files.has(f)) problems.push(`entry ${f} is not in the snapshot`);
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue; seen.add(f);
    if (f.startsWith('research/gf-three/kit/')) continue;   // browser modules: tools import them through kit-import's hooks
    if (!/\.m?js$/.test(f)) continue;
    for (const m of stripComments(files.get(f).toString('utf8')).matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec || !spec.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      if (SHIMMED_IMPORTS.some(re => re.test(target))) continue;
      if (files.has(target)) queue.push(target);
      else problems.push(`${f} imports ${spec} (${target}), which is not in the snapshot`);
    }
  }
  return problems;
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

/** Build the snapshot in memory from games.fun at `commit`. → { commit, date, files: Map(rel → Buffer), excluded, sources } */
export async function buildSnapshot(repo, commit = 'HEAD') {
  const full = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  const date = git(repo, ['show', '-s', '--format=%cI', full]).trim();
  const entries = lsTree(repo, full, SOURCES.map(s => s.path));
  const problems = [], excluded = [];
  for (const s of SOURCES) if (!entries.some(e => e.path === s.path || e.path.startsWith(s.path + '/'))) problems.push(`${s.path}: not in games.fun at ${full.slice(0, 12)}`);
  const pick = [];
  for (const e of entries) {
    if (e.mode === '120000') { problems.push(`${e.path}: a symlink (kits must hold plain files only)`); continue; }
    if (e.type !== 'blob') { excluded.push({ path: e.path, why: `a ${e.type}` }); continue; }
    const why = excludedByName(e.path);
    if (why) { excluded.push({ path: e.path, why }); continue; }
    pick.push(e);
  }
  const blobs = await readBlobs(repo, pick.map(e => e.object));
  // the library: licence by licence
  const licRec = pick.find(e => e.path === `${LIB}/LICENSES.json`);
  const licences = licRec ? JSON.parse(blobs.get(licRec.object).toString('utf8')).files ?? {} : {};
  const byPath = new Map(pick.map(e => [e.path, e]));
  const sidecar = rel => { const e = byPath.get(`${LIB}/${rel}`); try { return e ? JSON.parse(blobs.get(e.object).toString('utf8')) : null; } catch { return null; } };
  const files = new Map();
  for (const e of pick) {
    if (e.path.startsWith(LIB + '/')) {
      const d = libraryDecision(e.path.slice(LIB.length + 1), licences, sidecar);
      if (!d.keep) { excluded.push({ path: e.path, why: d.why }); continue; }
    }
    files.set(e.path, blobs.get(e.object));
  }
  // secrets
  for (const [rel, buf] of files) for (const h of scanSecrets(rel, buf)) problems.push(`${rel}:${h.at}: looks like a ${h.kind}`);
  problems.push(...closureProblems(files));
  problems.push(...portabilityProblems([...files.keys()]));
  const sources = SOURCES.map(s => {
    const mine = [...files].filter(([p]) => p === s.path || p.startsWith(s.path + '/'));
    return { path: s.path, why: s.why, files: mine.length, bytes: mine.reduce((n, [, b]) => n + b.length, 0) };
  });
  return { commit: full, date, files, excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)), sources, problems };
}

/** KITS.json for a snapshot: deterministic (the same commit gives the same bytes). */
export function kitsRecord(snap) {
  const text = rel => snap.files.get(rel)?.toString('utf8') ?? '';
  const gf3Version = /KIT_VERSION\s*=\s*'([^']+)'/.exec(text('research/gf-three/tools/lib/paths.mjs'))?.[1] ?? null;
  const mpVersion = /KIT_VERSION\s*=\s*'([^']+)'/.exec(text('research/multiplayer/party/manifest.mjs'))?.[1] ?? null;
  const files = Object.fromEntries([...snap.files.keys()].sort().map(k => [k, sha256(snap.files.get(k))]));
  const bytes = [...snap.files.values()].reduce((n, b) => n + b.length, 0);
  const why = {};
  for (const e of snap.excluded) why[e.why] = (why[e.why] ?? 0) + 1;
  return {
    schema: SCHEMA,
    about: 'A sparse mirror of the games.fun repository at one commit: the kits games are built on and the tools that create and verify them. Written by scripts/sync-kits.mjs; never edited by hand (fix the kit in games.fun and sync again). tests/kits.test.mjs checks kits/ against this file.',
    source: { repo: 'games.fun', commit: snap.commit, date: snap.date },
    kits: {
      'gf-three': { version: gf3Version, path: 'research/gf-three' },
      'gf-multiplayer': { version: mpVersion, path: 'research/foundations/kits/gf-multiplayer/1.3.0' },
      'gf-audio': { version: '1.5.0', path: 'research/foundations/kits/gf-audio/1.5.0' },
      'gf-assets': { version: '1.3.0', path: 'research/foundations/kits/gf-assets/1.3.0' },
    },
    policy: {
      excludedDirs: EXCLUDED_DIRS,
      libraryLicences: ALLOWED_LICENCES,
      libraryRule: 'a library file ships when its LICENSES.json record is CC0 or a permissive licence, or it is generated by games.fun; never Meshy output (licence tier unconfirmed) or a file without a record',
      secrets: 'no .env files; text files are scanned for key-shaped strings and the sync fails on any hit',
      shimmed: 'research/pipeline/node_modules/playwright/index.mjs (browser.mjs) resolves to playwright-core through lib/kit-hooks.mjs',
    },
    totals: { files: snap.files.size, bytes, excluded: snap.excluded.length, excludedBy: Object.fromEntries(Object.entries(why).sort()) },
    sources: snap.sources,
    excluded: snap.excluded.filter(e => e.path.startsWith(LIB + '/')),
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
  if (check) return diff.ok && recSame ? 0 : 1;
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
  return 0;
}

async function pruneEmpty(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules') await pruneEmpty(path.join(dir, e.name));
  if (dir !== KITS && (await readdir(dir)).length === 0) await rm(dir, { recursive: true });
}

if (isMain(import.meta)) process.exitCode = await main();
