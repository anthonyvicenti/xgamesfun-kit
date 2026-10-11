// The session tab's logic, with no DOM: what the bridge's queue and events mean to a person. Built against
// bridge/CONTRACT.md version 1 (track M3-B). The wire shapes of /api/session/* live ONLY in this file and in
// session-client.js; the tab reads the shapes made here.

export const CONTRACT = 1;
export const EVENT_KINDS = ['hello', 'session-start', 'session-end', 'prompt', 'tool-start', 'tool-end', 'permission-request', 'permission-resolved', 'stop', 'request', 'wait', 'guard', 'notification'];
export const TERMINAL_NOTE = 'Your terminal can answer this too, and your session\'s own permission mode and rules decide whether a question is asked at all.';

const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? ''));

/** One SSE `data:` payload → the event the tab draws; null for something that is not an event. */
export function normalizeEvent(raw) {
  let e = raw;
  if (typeof raw === 'string') { try { e = JSON.parse(raw); } catch { return null; } }
  if (!e || typeof e !== 'object' || typeof e.kind !== 'string') return null;
  return { run: e.run ?? null, seq: e.seq ?? null, at: e.t ?? null, kind: e.kind, session: e.session ?? null, tool: e.tool ?? null, text: e.text ?? '', input: e.input ?? null,
    ok: e.ok, denied: e.denied, allowed: e.allowed, reasons: e.reasons ?? [], reason: e.reason ?? null, open: e.open, message: e.message ?? e.why ?? '', permission: e.permission ?? null, request: e.request ?? null };
}

/** What a tool's input says, in a short plain line. */
export function inputLine(input) {
  if (input == null) return '';
  if (typeof input === 'string') return clip(input, 120);
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description ?? Object.values(input).find(x => typeof x === 'string');
  return v ? clip(v, 120) : '';
}

/** The line a person reads for one event; null for events the timeline leaves out. */
export function describeEvent(e) {
  switch (e.kind) {
    case 'session-start': return 'Your session started';
    case 'session-end': return 'Your session ended';
    case 'prompt': return /GF_REQUEST \{/.test(e.text ?? '') ? 'Your request was handed to your session' : e.text ? `You asked: ${clip(e.text, 120)}` : 'A prompt reached your session';
    case 'tool-start': return `Using ${e.tool ?? 'a tool'}${inputLine(e.input) ? `: ${inputLine(e.input)}` : ''}`;
    case 'tool-end': return e.denied ? `${e.tool ?? 'A tool'} was denied` : e.ok === false ? `${e.tool ?? 'A tool'} failed` : null;
    case 'permission-request': return `Asks to use ${e.permission?.tool ?? 'a tool'}`;
    case 'stop': return e.allowed === false ? `Your session was asked to carry on (${(e.reasons ?? []).map(r => ({ build: 'the build is not finished', unanswered: 'a request is unanswered', 'new-requests': 'new requests arrived', 'rolled-back': 'you rolled back: it is told to leave the game as it is', lock: 'the locked spec was changed' }[r] ?? r)).join(', ')})` : 'Your session finished its turn';
    case 'wait': return e.open ? 'Your session is listening for requests' : null;
    case 'guard': return `The build is waiting for you${e.message ? `: ${clip(e.message, 100)}` : ''}`;
    case 'notification': return e.message ? clip(e.message, 120) : null;
    default: return null;                      // hello, request, permission-resolved: the queue shows those
  }
}

/** Request state → words a person understands, and what the person can still do with it. */
export function requestWords(state) {
  switch (state) {
    case 'waiting': return { label: 'Waiting for your session', tone: 'wait', editable: true, again: false };
    case 'handed': return { label: 'Handed over to your session', tone: 'go', editable: false, again: false };
    case 'seen': return { label: 'Your session has seen it', tone: 'go', editable: false, again: false };
    case 'done': return { label: 'Done', tone: 'ok', editable: false, again: false };
    case 'dropped': return { label: 'Not done: send again', tone: 'bad', editable: false, again: true };
    default: return { label: String(state ?? 'unknown'), tone: 'wait', editable: false, again: false };
  }
}

/** The queue answer → what the tab needs: requests with words (`hide` = ids the person removed here), pending permissions, sessions. */
export function readQueue(raw, hide = new Set()) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const requests = (Array.isArray(q.requests) ? q.requests : []).filter(r => r && r.id != null && !hide.has(String(r.id)))
    .map(r => ({ ...r, id: String(r.id), text: String(r.text ?? ''), state: r.state ?? 'waiting', words: requestWords(r.state ?? 'waiting') }));
  const permissions = (Array.isArray(q.permissions) ? q.permissions : []).filter(p => p && p.state === 'waiting')
    .map(p => ({ id: String(p.id), tool: p.tool ?? null, line: inputLine(p.input), input: p.input ?? null, mode: p.mode ?? null }));
  return { requests, permissions, sessions: Array.isArray(q.sessions) ? q.sessions : [], loop: q.loop ?? null, transport: q.transport ?? null };
}

/** No session has reached the studio. What gets one here is the same whether the session is new or already running. */
export const NONE_HINT = 'In your agent\'s terminal run "node bin/gamesfun.mjs connect" in the kit folder once, then in Claude Code type /reload-plugins and say anything: your session appears here with its next message.';
export const IDLE_HINT = 'Press Enter in the terminal once to reconnect.';

/**
 * What to say about the person's session: { state: 'none'|'idle'|'working'|'listening'|'ended', hint, mode, guard }.
 * Per the contract: idle and not connected → press Enter; working and not connected is normal; no session → start one;
 * a permissionMode other than "default" answers before this page does.
 */
export function connection(queue) {
  const live = (queue?.sessions ?? []).filter(s => s.state !== 'ended');
  const s = live.find(x => x.primary) ?? live[0];
  if (!s) return { state: 'none', hint: NONE_HINT, mode: null, guard: null };
  const mode = s.permissionMode && s.permissionMode !== 'default' ? s.permissionMode : null;
  const base = { mode, guard: s.guard ?? null, agent: s.agent ?? null };
  if (s.connected) return { ...base, state: 'listening', hint: 'Requests reach it at once.' };
  // a wake has just handed it a request: its wait closed with the wake, and its first step is on the way
  if (s.state === 'idle' && s.waking) return { ...base, state: 'working', hint: 'Waking up with your request.' };
  if (s.state === 'idle') return { ...base, state: 'idle', hint: IDLE_HINT };
  return { ...base, state: 'working', hint: 'Requests are handed over when its turn ends.' };
}
export const modeNote = mode => `Your session's own permission mode (${mode}) answers before this page does; some actions will never ask here.`;
