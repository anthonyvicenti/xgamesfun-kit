// The session tab's logic, with no DOM: what the bridge's events and queue mean to a person. The wire shapes of
// /api/session/* live ONLY in this file (bridge/CONTRACT.md is their source); the tab reads the shapes made here.
//   event   { id, at, type: 'session-start'|'prompt'|'tool'|'permission'|'permission-resolved'|'stop'|'session-end', text?, tool?, request? }
//   request { id, text, selection, state: 'waiting'|'handed'|'seen'|'done'|'dropped', at }

export const EVENT_TYPES = ['session-start', 'prompt', 'tool', 'permission', 'permission-resolved', 'stop', 'session-end'];

/** One event off the wire → the shape the tab draws; null for something that is not an event. */
export function normalizeEvent(raw, fallbackType = 'message') {
  let e = raw;
  if (typeof raw === 'string') { try { e = JSON.parse(raw); } catch { return null; } }
  if (!e || typeof e !== 'object') return null;
  const type = String(e.type ?? e.event ?? fallbackType);
  return {
    id: e.id != null ? String(e.id) : null,
    at: e.at ?? e.time ?? null,
    type,
    text: e.text ?? e.prompt ?? e.summary ?? '',
    tool: e.tool ?? e.name ?? null,
    request: e.request ?? e.requestId ?? null,
  };
}

/** The line a person reads for one event. */
export function describeEvent(e) {
  switch (e.type) {
    case 'session-start': return 'Your session started';
    case 'session-end': return 'Your session ended';
    case 'prompt': return e.text ? `You asked: ${clip(e.text, 120)}` : 'You sent a prompt in the terminal';
    case 'tool': return `Used ${e.tool ?? 'a tool'}${e.text ? `: ${clip(e.text, 100)}` : ''}`;
    case 'permission': return `Asks to ${e.tool ? `use ${e.tool}` : 'do something'}${e.text ? `: ${clip(e.text, 100)}` : ''}`;
    case 'permission-resolved': return 'A permission was answered';
    case 'stop': return 'Your session finished its turn';
    default: return clip(e.text || e.type, 120);
  }
}
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Permissions asked and not yet answered, oldest first. `answered` holds ids this page already sent. */
export function pendingPermissions(events, answered = new Set()) {
  const open = new Map();
  for (const e of events) {
    if (e.type === 'permission' && e.id) open.set(e.id, e);
    if (e.type === 'permission-resolved') open.delete(String(e.request ?? e.id));
  }
  return [...open.values()].filter(e => !answered.has(e.id));
}

/** Request state → words a person understands, and whether the person can still edit or remove it, or send it again. */
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

/** { requests } or a bare array → the list, newest last, each with its words. */
export function normalizeQueue(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.requests) ? raw.requests : [];
  return list.filter(r => r && r.id != null).map(r => ({ ...r, id: String(r.id), text: String(r.text ?? ''), state: r.state ?? 'waiting', words: requestWords(r.state ?? 'waiting') }));
}

/**
 * Is the person's session listening? 'listening' (a wait is open: requests arrive at once), 'working' (it is mid-turn),
 * 'idle' (it stopped and no wait is open: press Enter in the terminal to wake it), 'none' (no session seen yet).
 * `queueRaw.wait.open` is the bridge's own word when it has one; otherwise it is derived from the last event.
 */
export function connection(events, queueRaw) {
  if (queueRaw && typeof queueRaw === 'object' && queueRaw.wait && typeof queueRaw.wait.open === 'boolean' && queueRaw.wait.open) return 'listening';
  const last = [...events].reverse().find(e => e.type !== 'permission-resolved');
  if (!last) return 'none';
  if (last.type === 'session-end') return 'none';
  if (last.type === 'stop') return 'idle';
  return 'working';
}

export const IDLE_HINT = 'Your session is idle and no wait is open. Press Enter in the terminal to reconnect.';
