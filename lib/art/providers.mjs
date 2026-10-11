// The art makers: lib/art/providers.json is data, this is its reader, and the ORDER OF CHOICE lives here:
//   art the person provided → a connection they offered → the session's own maker → the kit's stand-ins.
// Nothing here calls a service or a model, and a key is only ever looked at as "set or not".
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { KIT_ROOT } from '../paths.mjs';

const FILE = fileURLToPath(new URL('./providers.json', import.meta.url));
const TIERS = ['provided', 'connection', 'session', 'stand-in'];
const VIA = ['files', 'env', 'mcp', 'session', 'library'];
export const KINDS = ['picture', 'sheet', 'tile', 'model'];

export function loadProviders(file = FILE) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const problems = providerProblems(data);
  if (problems.length) throw new Error(`providers.json: ${problems.join('; ')}`);
  return data;
}

/** What is wrong with the table, as plain sentences ([] when it is fine). */
export function providerProblems(data) {
  const out = [];
  if (data?.schema !== 'gamesfun-art-providers/1') out.push('schema must be gamesfun-art-providers/1');
  if (JSON.stringify(data?.order) !== JSON.stringify(TIERS)) out.push(`order must be ${TIERS.join(' → ')}`);
  const ids = new Set();
  for (const p of data?.providers ?? []) {
    const at = `maker ${p?.id ?? '?'}`;
    if (!/^[a-z0-9-]+$/.test(p?.id ?? '')) out.push(`${at}: id`);
    if (ids.has(p.id)) out.push(`${at}: duplicate id`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name) out.push(`${at}: name`);
    if (!TIERS.includes(p.tier)) out.push(`${at}: tier must be one of ${TIERS.join(', ')}`);
    if (!Array.isArray(p.kinds) || !p.kinds.length || p.kinds.some(k => !KINDS.includes(k))) out.push(`${at}: kinds must be some of ${KINDS.join(', ')}`);
    if (!VIA.includes(p.reach?.via)) out.push(`${at}: reach.via must be one of ${VIA.join(', ')}`);
    if (p.reach?.via === 'env' && (!Array.isArray(p.reach.env) || !p.reach.env.length || p.reach.env.some(n => !/^[A-Z][A-Z0-9_]*$/.test(n)))) out.push(`${at}: reach.env must name its environment variables`);
    if (p.reach?.via === 'env' && !p.adapter) out.push(`${at}: a maker reached by a key needs an adapter`);
    if (p.adapter != null && !/^[a-z0-9-]+$/.test(p.adapter)) out.push(`${at}: adapter is a file name in lib/art/adapters/ without .mjs`);
    if (typeof p.cost?.note !== 'string') out.push(`${at}: cost.note`);
    if (typeof p.licence?.note !== 'string') out.push(`${at}: licence.note`);
    if (p.tier === 'connection' && p.reach?.via === 'env' && !(p.cost.url && p.cost.checked && p.licence.url && p.licence.checked)) out.push(`${at}: a paid maker's cost and licence each need a url and the date they were checked`);
    if (typeof p.run !== 'string') out.push(`${at}: run (what was really run against it)`);
    if (JSON.stringify(p).match(/sk-[A-Za-z0-9]{16,}|msy_[A-Za-z0-9]{16,}/)) out.push(`${at}: something that looks like a key is in the row`);
  }
  for (const t of TIERS) if (!(data?.providers ?? []).some(p => p.tier === t)) out.push(`no maker in tier ${t}`);
  return out;
}

/** The kit's .env (the documented place for MESHY_API_KEY), as names → values. Never printed. */
export function kitEnvFile(file = path.join(KIT_ROOT, '.env')) {
  if (!existsSync(file)) return {};
  try { return parseEnv(readFileSync(file, 'utf8')); } catch { return {}; }
}

/** Are a key-based row's variables all set? → { set, where } with no value in it. */
export function keyState(row, { env = process.env, envFile = null } = {}) {
  const file = row.reach.envFile ? (envFile ?? kitEnvFile()) : {};
  const where = row.reach.env.map(n => (env[n] ? 'the environment' : file[n] ? '.env in the kit' : null));
  return { set: where.every(Boolean), where: where.find(Boolean) ?? null, names: row.reach.env };
}

/** Which agent is running us, from what it sets in the environment or told the MCP server. → 'claude' | 'codex' | null */
export function detectAgent({ env = process.env, client = null } = {}) {
  const c = String(client ?? '').toLowerCase();
  if (c.includes('claude')) return 'claude';
  if (c.includes('codex')) return 'codex';
  if (env.GF_AGENT) return String(env.GF_AGENT).toLowerCase();
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (Object.keys(env).some(k => k.startsWith('CODEX_'))) return 'codex';
  return null;
}

/**
 * Who makes this piece of art, and why. `provided` is a file the person gave for it (a path, or true).
 * → { maker: row, connection (the name, for an MCP connection), why, passedOver: [{ id, why }] }
 */
export function chooseMaker({ kind, style = null, provided = null, env = process.env, envFile = null, agent = undefined, data = null } = {}) {
  data ??= loadProviders();
  if (!KINDS.includes(kind)) throw new Error(`kind "${kind}" is not one of ${KINDS.join(', ')}`);
  const rows = data.providers.filter(p => p.kinds.includes(kind));
  const by = tier => rows.filter(p => p.tier === tier);
  const passedOver = [];
  const styled = p => !style || !p.styles || p.styles.includes(style) || (passedOver.push({ id: p.id, why: `makes ${p.styles.join(' and ')} art, and this game is ${style}` }), false);
  if (provided) return { maker: by('provided')[0], why: 'you provided the art, and what a person provides always wins', passedOver };
  passedOver.push({ id: 'provided', why: 'no file was given for this' });

  const prefVar = data.prefer?.env?.[kind], pref = prefVar ? String(env[prefVar] ?? '').trim() : '';
  const skipConnections = pref === 'session' || pref === 'stand-in';
  if (!skipConnections) {
    const offered = [];
    for (const p of by('connection')) {
      if (p.reach.via === 'env') {
        const k = keyState(p, { env, envFile });
        if (!k.set) { passedOver.push({ id: p.id, why: `${k.names.join(' and ')} is not set` }); continue; }
        if (styled(p)) offered.push({ maker: p, why: `${k.names.join(' and ')} is set in ${k.where}` });
      } else if (p.reach.via === 'mcp') {
        if (pref.startsWith('connection:') && pref.length > 11) offered.push({ maker: p, connection: pref.slice(11), why: `you named the connection "${pref.slice(11)}" in ${prefVar}` });
        else passedOver.push({ id: p.id, why: `no connection is named (${prefVar}=connection:<name> offers one)` });
      }
    }
    if (offered.length) {
      const named = offered.find(o => o.maker.id === pref || (o.connection && pref.startsWith('connection:')));
      const pick = named ?? offered[0];
      const others = offered.filter(o => o !== pick);
      for (const o of others) passedOver.push({ id: o.maker.id, why: named ? `also offered; ${prefVar} names ${pick.connection ? 'a connection' : pick.maker.id}` : `also offered; ${pick.maker.id} comes first in the table (${prefVar}=${o.maker.id} picks this one)` });
      return { ...pick, why: pick.why + (named && !pick.connection ? `, and ${prefVar} names it` : ''), passedOver };
    }
  } else passedOver.push({ id: 'connection', why: `${prefVar}=${pref} skips connections` });

  if (pref !== 'stand-in') {
    const who = agent === undefined ? detectAgent({ env }) : agent;
    for (const p of by('session')) {
      const agents = p.reach.agents ?? ['*'];
      if (!agents.includes('*') && !agents.includes(who)) { passedOver.push({ id: p.id, why: `needs ${agents.join(' or ')}${who ? `; this session is ${who}` : '; the agent is not known'}` }); continue; }
      if (!styled(p)) continue;
      return { maker: p, agent: who, why: p.id === 'session-draws' ? 'no art was given and no connection is offered, so your own session draws it (no extra key)' : `no art was given and no connection is offered, and your ${who} session has its own image tool`, passedOver };
    }
  } else passedOver.push({ id: 'session', why: `${prefVar}=stand-in` });
  if (kind === 'model') passedOver.push({ id: 'session', why: 'a session does not make 3D models' });
  return { maker: by('stand-in')[0], why: kind === 'model' ? 'no model was given and no 3D connection is offered, so the kit\'s library models are used' : 'nothing else is available, so the stand-in stays', passedOver };
}

/** The `doctor` line for art: which maker pictures and 3D models will come from, and why. Never a failure. */
export function artDoctor({ env = process.env, envFile = null, agent = undefined, data = null } = {}) {
  try {
    data ??= loadProviders();
    const pic = chooseMaker({ kind: 'picture', env, envFile, agent, data }), model = chooseMaker({ kind: 'model', env, envFile, agent, data });
    const name = c => (c.connection ? `the connection "${c.connection}"` : c.maker.name);
    const waiting = data.providers.filter(p => p.reach.via === 'env' && !keyState(p, { env, envFile }).set).map(p => `${p.name} (${p.reach.env.join(', ')})`);
    return { id: 'art', label: 'Art', status: 'ok', fix: null,
      detail: `pictures: ${name(pic)} (${pic.why}); 3D models: ${name(model)} (${model.why}).${waiting.length ? ` Not connected: ${waiting.join(', ')}; see docs/ART.md` : ''}` };
  } catch (e) { return { id: 'art', label: 'Art', status: 'warn', detail: `the art makers' table did not load: ${e.message}`, fix: null }; }
}
