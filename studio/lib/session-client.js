// The page's calls to /api/session/*: the run token (contract section 1), and the one EventSource. No DOM beyond fetch and EventSource.
import { EVENT_KINDS, normalizeEvent } from './session.js';

let tokenPromise = null;
const token = () => (tokenPromise ??= fetch('/api/session/token', { cache: 'no-store' }).then(async r => {
  if (!r.ok) throw new Error(`no session bridge on this server (${r.status})`);
  return (await r.json()).token;
}).catch(e => { tokenPromise = null; throw e; }));

/** A call with the token; resolves to the parsed JSON, rejects with the server's plain sentence. */
export async function sessionApi(path, body, method) {
  const t = await token();
  const init = { cache: 'no-store', headers: { 'x-gamesfun-token': t }, method: method ?? (body === undefined ? 'GET' : 'POST') };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  const res = await fetch(`/api/session/${path.replace(/^\/+/, '')}`, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

/** The event stream; onEvent(event) for each, resuming by itself (EventSource sends Last-Event-ID). → close() */
export function openEvents(onEvent, onState = () => {}) {
  let es = null, closed = false;
  token().then(t => {
    if (closed) return;
    es = new EventSource(`/api/session/events?token=${encodeURIComponent(t)}`);
    es.onopen = () => onState(true);
    es.onerror = () => onState(false);
    for (const k of EVENT_KINDS) es.addEventListener(k, m => { const e = normalizeEvent(m.data); if (e) onEvent(e); });
  }).catch(() => onState(false));
  return () => { closed = true; es?.close(); };
}
