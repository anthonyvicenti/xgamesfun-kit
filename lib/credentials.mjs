// Where the kit keeps a person's sign-ins (the games.fun publish token; any other service's token the same way), never
// in a game folder or in this checkout, so nothing a game publishes or a repo pushes can carry one.
//
//   macOS    the login keychain, through /usr/bin/security (the secret goes in on stdin, `security -i`, never on a
//            command line another program could read)
//   Linux    the Secret Service (GNOME Keyring, KWallet) through `secret-tool` when it is installed and answers;
//            otherwise the file below
//   Windows  the file below, its secret encrypted for this Windows user with DPAPI (the protection Windows' own
//            Credential Manager uses), through powershell.exe; plain in the file if PowerShell cannot do it
//   anywhere a file, credentials.json in the person's config folder, readable by them only (mode 0600, folder 0700;
//            on Windows the folder is in their own profile, which only they and administrators can read):
//              Windows  %APPDATA%\gamesfun\        macOS  ~/Library/Application Support/gamesfun/
//              Linux    $XDG_CONFIG_HOME/gamesfun/ (default ~/.config/gamesfun/)
// credentials.json always holds the entry's public part (who, until when, which store); the secret itself is in the
// keychain when there is one. GAMESFUN_CONFIG_DIR moves the folder; GAMESFUN_CREDENTIALS=file skips the keychain.
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findProgram, run } from './proc.mjs';

const SERVICE = 'gamesfun-kit';

/** The person's config folder for the kit, per system (above). */
export function configDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.GAMESFUN_CONFIG_DIR) return path.resolve(env.GAMESFUN_CONFIG_DIR);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'gamesfun');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'gamesfun');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'gamesfun');
}
export const credentialsFile = opts => path.join(configDir(opts), 'credentials.json');

async function readAll(file) {
  try { const v = JSON.parse(await readFile(file, 'utf8')); return v && typeof v === 'object' && v.entries ? v : { version: 1, entries: {} }; }
  catch { return { version: 1, entries: {} }; }
}
async function writeAll(file, data) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  try { await rename(tmp, file); } catch { await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rm(tmp, { force: true }); }   // Windows: EPERM/EBUSY
  await chmod(file, 0o600).catch(() => {});
}

// ---- The system keychains -------------------------------------------------------------------------------------------
const quote = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
const keychains = {
  darwin: {
    name: 'the macOS keychain',
    available: () => findProgram(['security']) ?? '/usr/bin/security',
    async set(bin, key, secret) {
      if (/[\r\n"\\]/.test(secret)) return false;
      const r = await run(bin, ['-i'], { input: `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(key)} -w ${quote(secret)}\n`, timeoutMs: 15000 });
      return r.code === 0 && !/error/i.test(r.stderr);
    },
    async get(bin, key) { const r = await run(bin, ['find-generic-password', '-s', SERVICE, '-a', key, '-w'], { timeoutMs: 15000 }); return r.code === 0 ? r.stdout.replace(/\r?\n$/, '') : null; },
    async del(bin, key) { await run(bin, ['delete-generic-password', '-s', SERVICE, '-a', key], { timeoutMs: 15000 }); },
  },
  linux: {
    name: 'the Secret Service (secret-tool)',
    available: () => findProgram(['secret-tool']),
    async set(bin, key, secret) { const r = await run(bin, ['store', '--label', `games.fun kit (${key})`, 'service', SERVICE, 'account', key], { input: secret, timeoutMs: 15000 }); return r.code === 0; },
    async get(bin, key) { const r = await run(bin, ['lookup', 'service', SERVICE, 'account', key], { timeoutMs: 15000 }); return r.code === 0 && r.stdout ? r.stdout.replace(/\r?\n$/, '') : null; },
    async del(bin, key) { await run(bin, ['clear', 'service', SERVICE, 'account', key], { timeoutMs: 15000 }); },
  },
};
// Windows: DPAPI for the current user, through Windows PowerShell 5.1 (on every Windows 10 and 11).
const DPAPI = (verb) => `Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); `
  + (verb === 'protect'
    ? `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($i),$null,'CurrentUser'))`
    : `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($i),$null,'CurrentUser'))`);
async function dpapi(verb, input) {
  const ps = findProgram(['powershell.exe', 'powershell']);
  if (!ps) return null;
  const r = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', DPAPI(verb)], { input, timeoutMs: 20000 });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Which store this system uses for new secrets, in words (`gamesfun login` says it). */
export function storeName({ env = process.env, platform = process.platform } = {}) {
  if (env.GAMESFUN_CREDENTIALS === 'file') return `a file readable by you only (${credentialsFile({ env, platform })})`;
  if (platform === 'win32') return `a file in your profile, encrypted for your Windows user (${credentialsFile({ env, platform })})`;
  const k = keychains[platform === 'darwin' ? 'darwin' : 'linux'];
  return k.available() ? k.name : `a file readable by you only (${credentialsFile({ env, platform })})`;
}

/**
 * Keep `secret` under `key` (e.g. "games.fun https://games-fun-liard.vercel.app"), with `meta` (public: email, expiry).
 * → { store: 'keychain' | 'secret-service' | 'dpapi' | 'file', file }
 */
export async function saveSecret(key, secret, meta = {}, { env = process.env, platform = process.platform } = {}) {
  const file = credentialsFile({ env, platform }), all = await readAll(file);
  let store = 'file', entry = { ...meta, savedAt: new Date().toISOString() };
  if (env.GAMESFUN_CREDENTIALS !== 'file') {
    if (platform === 'win32') {
      const protectedText = await dpapi('protect', secret);
      if (protectedText) { store = 'dpapi'; entry.secret = protectedText; }
    } else {
      const k = keychains[platform === 'darwin' ? 'darwin' : 'linux'], bin = k.available();
      if (bin && await k.set(bin, key, secret) && await k.get(bin, key) === secret) store = platform === 'darwin' ? 'keychain' : 'secret-service';
    }
  }
  if (store === 'file') entry.secret = secret;
  all.entries[key] = { ...entry, store };
  await writeAll(file, all);
  return { store, file };
}

/** → { secret, meta, store } or null. */
export async function loadSecret(key, { env = process.env, platform = process.platform } = {}) {
  const all = await readAll(credentialsFile({ env, platform }));
  const e = all.entries[key];
  if (!e) return null;
  const { secret: stored, store, ...meta } = e;
  let secret = null;
  if (store === 'file') secret = stored ?? null;
  else if (store === 'dpapi') secret = stored ? await dpapi('unprotect', stored) : null;
  else { const k = keychains[platform === 'darwin' ? 'darwin' : 'linux'], bin = k.available(); secret = bin ? await k.get(bin, key) : null; }
  return secret ? { secret, meta, store } : null;
}

/** Forget `key` everywhere it may be. → whether there was one. */
export async function deleteSecret(key, { env = process.env, platform = process.platform } = {}) {
  const file = credentialsFile({ env, platform }), all = await readAll(file);
  const had = Boolean(all.entries[key]);
  if (platform !== 'win32' && env.GAMESFUN_CREDENTIALS !== 'file') {
    const k = keychains[platform === 'darwin' ? 'darwin' : 'linux'], bin = k.available();
    if (bin) await k.del(bin, key).catch(() => {});
  }
  delete all.entries[key];
  await writeAll(file, all);
  return had;
}

/** The public part of every entry (never a secret): for `gamesfun login --status`. */
export async function listEntries(opts = {}) {
  const all = await readAll(credentialsFile(opts));
  return Object.fromEntries(Object.entries(all.entries).map(([k, { secret, ...rest }]) => [k, rest]));
}
