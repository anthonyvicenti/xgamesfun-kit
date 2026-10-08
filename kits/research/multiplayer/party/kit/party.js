/*! games.fun multiplayer kit: party shell v1.2.2 (race and live rounds). MIT. research/multiplayer/party/kit/party.js
 *
 * Kit-owned and byte-identical in every game (never edit a copy). Standard: research/multiplayer/STANDARD.md
 *
 * Gives an ordinary single-player game "play with friends" with no multiplayer code in the game:
 *   - vendor/gf.js (the host-join kit) draws the Host / Join lobby and carries the room over WebRTC; the host
 *     player's browser runs room.js (the generic race room) in a Web Worker. No game server.
 *   - each round the room hands everyone one seed; this page loads the game's own page in a frame with that seed,
 *     reads the player's live value and result, and sends them to the room; the rail shows everyone's standing.
 *   - the game's result is read through the adapter in ../../multiplayer.json → race:
 *       "observe": poll the game's read-only QA observation (window.__game.snapshot()), no game change at all;
 *       "hooks":   the game calls gf.run.start / progress / end (research/multiplayer/sdk/gf.js).
 * LIVE rounds (multiplayer.json mode "live", kit 1.2.0): the players are in one shared space and see each other.
 * The game imports gf/mp/net.js, which reaches this page through window.__gfParty: poses, the host's world and game
 * events travel through the room; every game is loaded first and then everyone starts together.
 * Layout: <game>/multiplayer.json · <game>/gf/mp/{index.html, party.js, party.css, room.js, bot.js, p2p.json,
 *         vendor/gf.js, p2p/*, kit.json}
 * Query:  ?join=CODE (invite link) · ?signal=<url> (signaling endpoint)
 *         QA only: ?max=<seconds> (round cap) · ?gq=<query> (extra query for the game's page, e.g. a one-lap race)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var gameRoot = new URL('../../', location.href);          // <game>/gf/mp/ → <game>/
  var root = $('party'), frame = $('game'), card = $('card'), rail = $('rail');
  var M = null, R = null, LIVE = false;                      // multiplayer.json, its "race" or "live" block, and which
  var COLORS = ['#4f7cff', '#ff5ea8', '#3ddc84', '#ffd166', '#b388ff', '#ff8a50', '#4dd0e1', '#e57373'];   // one per seat
  var S = { phase: 'boot', you: null, code: null, names: {}, away: {}, standing: null, go: null, goAt: 0, revealed: false,
    results: null, dismissed: 0, sentConfig: false, note: '', fatal: '' };
  var A = freshAdapter();
  var pollTimer = null, countTimer = null, cardKey = null, railKey = null;

  function freshAdapter() { return { kind: null, ok: false, armed: false, started: false, done: false, live: null, progress: null, first: undefined, polls: 0, sent: 0, lastSend: 0, lastP: null, lastV: null, flush: null, moves: 0, value: null, won: null, error: '', url: null, seen: false, loaded: false }; }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.append(c); });
    return e;
  }

  // ---------------- manifest helpers ----------------
  function get(obj, path) {
    if (typeof path !== 'string' || !path) return undefined;
    var parts = path.split('.'), v = obj;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  // A condition on the observation: {path, in|is|gte|gt|lte|lt|truthy} or {any:[…]} / {all:[…]} / {not: …}.
  function test(c, snap) {
    if (!c || typeof c !== 'object') return false;
    if (Array.isArray(c.any)) return c.any.some(function (x) { return test(x, snap); });
    if (Array.isArray(c.all)) return c.all.every(function (x) { return test(x, snap); });
    if (c.not) return !test(c.not, snap);
    var v = get(snap, c.path);
    if (Array.isArray(c['in'])) return c['in'].indexOf(v) >= 0;
    if ('is' in c) return v === c.is;
    if (typeof v === 'number') {
      if (typeof c.gte === 'number') return v >= c.gte;
      if (typeof c.gt === 'number') return v > c.gt;
      if (typeof c.lte === 'number') return v <= c.lte;
      if (typeof c.lt === 'number') return v < c.lt;
    }
    if (c.truthy === true) return !!v;
    if (c.truthy === false) return !v;
    return false;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  // observe.value: a dot path, or {sum: [paths]} for a result kept in parts (a course total plus the hole in play).
  // A part that is empty counts as 0; the value is empty only when every part is.
  function readValue(snap, spec) {
    if (typeof spec === 'string') return num(get(snap, spec));
    if (!spec || !Array.isArray(spec.sum)) return null;
    var total = 0, any = false;
    for (var i = 0; i < spec.sum.length; i++) { var v = num(get(snap, spec.sum[i])); if (v !== null) { total += v; any = true; } }
    return any ? total : null;
  }
  function cfg() { return (S.standing && S.standing.cfg) || (S.go && S.go.cfg) || { metric: R.metric, direction: R.direction, maxSeconds: R.maxSeconds }; }
  function fmt(v) {
    if (num(v) === null) return '';
    if (cfg().metric === 'time') {
      var s = R.unit === 'ms' ? v / 1000 : v, m = Math.floor(s / 60);
      return m ? m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60).toFixed(1) : s.toFixed(2) + ' s';
    }
    var n = Number.isInteger(v) || Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
    return R.unit ? n + ' ' + R.unit : n;
  }
  function goal() { var c = cfg(), low = c.direction === 'lower'; return c.metric === 'time' ? (low ? 'Fastest time wins.' : 'Longest time wins.') : c.metric === 'count' ? (low ? 'Fewest wins.' : 'Most wins.') : (low ? 'Lowest score wins.' : 'Best score wins.'); }
  function me() { return S.standing ? S.standing.racers.filter(function (r) { return r.id === S.you; })[0] || null : null; }
  function isHost() { return !!(S.standing && S.standing.hostId && S.standing.hostId === S.you); }
  function name(id) { return S.names[id] || id; }

  // ---------------- boot ----------------
  function fail(msg, detail) {
    S.fatal = msg; root.dataset.phase = 'boot';
    card.hidden = false;
    card.replaceChildren(el('div', { class: 'panel' }, [el('h2', { text: 'Play with friends' }), el('p', { class: 'err', id: 'mp-fatal', text: msg }),
      detail ? el('p', { class: 'muted', text: detail }) : null,
      el('div', { class: 'row' }, [el('a', { href: new URL('index.html', gameRoot).href }, [el('button', { text: 'Play on your own' })])])]));
  }

  fetch(new URL('multiplayer.json', gameRoot), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('multiplayer.json: HTTP ' + r.status); return r.json(); }).then(function (m) {
    M = m;
    if (!M || typeof M !== 'object') throw new Error('multiplayer.json is not an object');
    if (M.mode === 'solo') return fail('This game is single-player.', typeof M.reason === 'string' ? M.reason : '');
    if (M.mode === 'room') {            // a game written as a room has its own multiplayer page: pass the invite on
      var to = new URL((M.room && M.room.entry) || 'index.html', gameRoot);
      params.forEach(function (v, k) { to.searchParams.set(k, v); });
      location.replace(to.href); return;
    }
    LIVE = M.mode === 'live';
    R = LIVE ? M.live : M.race;
    if ((M.mode !== 'race' && !LIVE) || !R || typeof R !== 'object') throw new Error('multiplayer.json: mode must be "race" or "live", with a block of the same name');
    if (LIVE) R.adapter = 'net';                    // the game reports through gf/mp/net.js
    else if (R.adapter !== 'observe' && R.adapter !== 'hooks') throw new Error('multiplayer.json: race.adapter must be "observe" or "hooks"');
    if (R.adapter === 'observe' && (!R.observe || !R.observe.ended || !R.observe.value)) throw new Error('multiplayer.json: race.observe needs "ended" and "value"');
    R.metric = ['score', 'time', 'count'].indexOf(R.metric) >= 0 ? R.metric : 'score';
    R.direction = R.direction === 'lower' ? 'lower' : 'higher';
    var cap = parseInt(params.get('max') || '', 10);
    R.maxSeconds = cap >= 5 && cap <= 3600 ? cap : (Number.isInteger(R.maxSeconds) && R.maxSeconds >= 5 && R.maxSeconds <= 3600 ? R.maxSeconds : 300);
    A.kind = R.adapter;
    var title = typeof M.title === 'string' && M.title ? M.title.slice(0, 60) : 'this game';
    document.title = title + ' · play with friends';
    $('rail-title').textContent = title;
    applyTheme(title);
    var s = document.createElement('script');
    s.src = 'vendor/gf.js';
    s.onload = wire;
    s.onerror = function () { fail('The multiplayer kit did not load.', 'gf/mp/vendor/gf.js is missing.'); };
    document.body.append(s);
  }).catch(function (e) { fail('This game has no multiplayer set up.', String(e && e.message || e)); });

  // multiplayer.json "theme": the same keys as the host-join kit's GF_P2P_THEME, so lobby, pill and rail match the game.
  function applyTheme(title) {
    var t = M.theme && typeof M.theme === 'object' ? M.theme : {}, keys = { font: 'font', bg: 'bg', panel: 'panel', fg: 'fg', muted: 'muted', faint: 'faint', line: 'line', row: 'row', button: 'button', accent: 'accent', accentFg: 'accent-fg', code: 'code', ok: 'ok', radius: 'radius' };
    for (var k in keys) if (typeof t[k] === 'string' && t[k].length < 200 && !/[;{}<>]/.test(t[k])) document.documentElement.style.setProperty('--mp-' + keys[k], t[k]);
    var theme = { title: title }; for (var j in t) theme[j] = t[j];
    window.GF_P2P_THEME = theme;
    var conf = { bar: 'top-right', inviteParams: Array.isArray(M.inviteParams) ? M.inviteParams.concat(['max', 'gq', 'signal']) : ['max', 'gq', 'signal'] };
    if (params.get('signal')) conf.signal = params.get('signal');
    window.GF_P2P_CONFIG = Object.assign({}, window.GF_P2P_CONFIG || {}, conf);
  }

  function wire() {
    var room = window.gf && window.gf.room;
    if (!room) return fail('The multiplayer kit did not start.');
    S.phase = 'home'; root.dataset.phase = 'home';
    room.on('welcome', function (w) {
      S.you = w.you; S.code = w.code; S.phase = 'room'; root.dataset.phase = 'room';
      (w.players || []).forEach(function (p) { S.names[p.id] = p.name; S.away[p.id] = !p.connected; });
      render();
    });
    room.on('players', function (list) { (list || []).forEach(function (p) { S.names[p.id] = p.name; S.away[p.id] = !p.connected; }); tellPlayers(); render(); });
    room.on('message', function (m) {
      if (!m || typeof m !== 'object') return;
      if (m.k === 'standings') {
        S.standing = m;
        if (isHost() && !S.sentConfig && (m.phase === 'lobby' || m.phase === 'results')) { S.sentConfig = true; room.send({ k: 'config', metric: R.metric, direction: R.direction, maxSeconds: R.maxSeconds, live: LIVE, team: LIVE && R.team === true }); }
        tellPlayers();
        // The round this game page belongs to is over for everyone: tell the game once, so it stops its world and sound.
        if (S.session && !S.session.ended && m.phase === 'results' && m.round === S.session.round) { S.session.ended = true; try { if (S.session.H.onEnd) S.session.H.onEnd(); } catch (e) { console.error(e); } }
        render();
      } else if (m.k === 'net') { if (S.session) { try { S.session.H.onNet(m.t, m.from, m.d); } catch (e) { console.error(e); } } }
      else if (m.k === 'go') startRound(m);
      else if (m.k === 'begin') { S.goAt = performance.now() + Math.max(0, m.startsInMs | 0); render(); }
      else if (m.k === 'error') { S.note = String(m.reason || ''); render(); }
    });
    room.on('ended', function (res) { S.results = res; render(); });
    room.on('error', function (e) { S.note = String((e && e.reason) || ''); render(); });
    room.on('closed', function () { clearInterval(pollTimer); clearInterval(countTimer); });
    $('start').onclick = function () { room.send({ k: 'start' }); };
    $('stop').onclick = function () { room.send({ k: 'stop' }); };
    window.addEventListener('message', onGameMessage);
    render();
  }

  // ---------------- a round ----------------
  function gameUrl(go) {
    var u = new URL(R.entry || 'index.html', gameRoot), q = new URLSearchParams(u.search);
    if (typeof R.query === 'string') new URLSearchParams(R.query).forEach(function (v, k) { q.set(k, v); });
    if (params.get('gq')) new URLSearchParams(params.get('gq')).forEach(function (v, k) { q.set(k, v); });
    if (typeof R.seedParam === 'string' && R.seedParam) q.set(R.seedParam, go.seed);
    q.set('gf_seed', go.seed); q.set('gf_mode', 'race'); q.set('gf_round', String(go.round));   // gf_round: a fresh load every round
    u.search = q.toString();
    return u.href;
  }

  // The page the frame was navigated to, whatever the game has done to its address bar since (replaceState).
  function frameUrl() {
    try { var w = frame.contentWindow, n = w.performance.getEntriesByType('navigation')[0]; return (n && n.name) || w.location.href; } catch (e) { return ''; }
  }
  // Until the frame has loaded THIS round's page it still holds the last round's game, which may be running or ending:
  // nothing is read from the frame before then. Once this round's page has been seen, a game that reloads or
  // navigates itself is still this round's game.
  // (A game that redirects itself at once never shows the exact address: any page loaded since the round began
  // that is not the last round's counts too.)
  function thisRound() {
    if (A.seen) return true;
    var u = frameUrl();
    if (!A.url || !u || u === 'about:blank') return false;
    if (u === A.url || (A.loaded && u !== S.prevUrl)) { A.seen = true; return true; }
    return false;
  }
  frame.addEventListener('load', function () { A.loaded = true; });

  function startRound(go) {
    S.go = go; S.revealed = false; S.results = null; S.note = ''; S.dismissed = 0;
    // A live round waits for the room's 'begin' (every game loaded), then everyone counts down together.
    S.goAt = live() ? Infinity : performance.now() + Math.max(0, go.startsInMs | 0);
    S.session = null; S.info = null;
    S.prevUrl = A.url || frameUrl();
    A = freshAdapter(); A.kind = R.adapter;
    A.url = gameUrl(go);
    frame.hidden = false;
    frame.src = A.url;
    clearInterval(pollTimer);
    if (R.adapter === 'observe') pollTimer = setInterval(poll, 250);
    clearInterval(countTimer);
    countTimer = setInterval(function () {
      if (performance.now() >= S.goAt) {
        clearInterval(countTimer); S.revealed = true; focusGame();
        if (S.session) { try { S.session.H.onStart(); } catch (e) { console.error(e); } }
      }
      render();
    }, 100);
    render();
  }

  // ---------------- live rounds: the bridge gf/mp/net.js talks to ----------------
  function live() { return !!(LIVE && S.go && S.go.cfg && S.go.cfg.live); }
  function seat(id) { var n = parseInt(String(id).slice(1), 10); return isFinite(n) && n > 0 ? n - 1 : 0; }
  function playerList() {
    var st = S.standing, host = st ? st.hostId : null;
    return (st ? st.racers : []).filter(function (r) { return !r.watching; }).map(function (r) {
      return { id: r.id, seat: seat(r.id), name: name(r.id), color: COLORS[seat(r.id) % COLORS.length], host: r.id === host, you: r.id === S.you, connected: !S.away[r.id] };
    }).sort(function (a, b) { return seat(a.id) - seat(b.id); });
  }
  function buildInfo() {
    var list = playerList(), you = list.filter(function (p) { return p.you; })[0] || { id: S.you, seat: seat(S.you), name: name(S.you), color: COLORS[seat(S.you) % COLORS.length], host: isHost(), you: true, connected: true };
    S.info = { you: you, players: list, seed: S.go ? S.go.seed : null, round: S.go ? S.go.round : 0 };
    return S.info;
  }
  function tellPlayers() {
    if (!S.session) return;
    var before = S.info ? JSON.stringify(S.info.players) : '', info = buildInfo();
    if (JSON.stringify(info.players) !== before) { try { S.session.H.onPlayers(info.players); } catch (e) { console.error(e); } }
  }
  // The game's frame is same-origin, so net.js calls this directly: window.parent.__gfParty.attach(window, handlers).
  // Only this round's game page gets a session; a page from the last round, or any other window, gets null.
  window.__gfParty = Object.freeze({
    attach: function (win, H) {
      if (!live() || win !== frame.contentWindow || !H || typeof H.onNet !== 'function') return null;
      A.seen = true; A.ok = true; A.armed = true;
      var round = S.go.round, mine = function () { return S.session === session && S.go && S.go.round === round; };
      var session = { H: H, round: round, ended: false,
        info: function () { return S.info || buildInfo(); },
        send: function (t, d, to) { if (mine()) window.gf.room.send(to && to !== 'all' ? { k: 'net', t: t, to: to, d: d } : { k: 'net', t: t, d: d }); },
        ready: function () { if (!mine()) return; S.gameReady = round; window.gf.room.send({ k: 'ready' }); if (S.revealed) { try { H.onStart(); } catch (e) { console.error(e); } } render(); },
        progress: function (p, v) { if (mine()) { A.started = true; report(p, v); } },
        finish: function (value, won) { if (mine()) finishRun(value, won); } };
      S.session = session; buildInfo();
      return session;
    },
  });

  function focusGame() { try { frame.focus(); frame.contentWindow.focus(); } catch (e) {} }
  function releasePointer() { try { frame.contentDocument.exitPointerLock(); } catch (e) {} try { document.exitPointerLock(); } catch (e) {} }
  function settled() { return performance.now() - (S.resultsAt || 0) > 700; }

  // At most two progress messages a second. A value that arrives inside that window is sent when it closes, so the
  // others never sit on a stale number (a game using the hooks reports in bursts, not on a clock).
  function report(p, v) {
    if (p !== A.progress || v !== A.live) A.moves++;
    A.progress = p; A.live = v;
    if (!S.revealed || A.done || (p === A.lastP && v === A.lastV)) return;
    // The room counts progress only once it says the round is racing; a game shown at this page's own count can report
    // a moment before that. Hold the value and send it then, or an unchanged value would never be sent again.
    if (!(S.standing && S.standing.phase === 'racing')) { if (!A.flush) { var h = A; A.flush = setTimeout(function () { h.flush = null; if (h === A) report(A.progress, A.live); }, 250); } return; }
    var wait = 500 - (performance.now() - A.lastSend);
    if (wait > 0) { if (!A.flush) { var a = A; A.flush = setTimeout(function () { a.flush = null; if (a === A) report(A.progress, A.live); }, wait); } return; }
    var msg = { k: 'progress' };
    if (p !== null) msg.p = Math.round(p * 1000) / 1000;
    if (v !== null) msg.v = v;
    if (msg.p === undefined && msg.v === undefined) return;
    A.lastSend = performance.now(); A.lastP = p; A.lastV = v; A.sent++;
    window.gf.room.send(msg);
  }
  function finishRun(value, won) {
    if (A.done) return;
    if (num(value) === null) { A.error = 'the game ended but reported no number as its result'; render(); return; }
    A.done = true; A.value = value; A.won = won;
    window.gf.room.send({ k: 'finish', value: value, won: won });
    render();
  }

  // Adapter "observe": the game's own read-only observation, polled 4 times a second. Nothing in the game changes.
  function poll() {
    if (A.done || !S.go || !thisRound()) return;
    A.polls++;
    var O = R.observe, snap;
    try {
      var w = frame.contentWindow, o = w[O.object || '__game'];
      if (o == null) return;
      var call = O.call === undefined ? 'snapshot' : O.call;
      snap = call ? (typeof o[call] === 'function' ? o[call]() : undefined) : (typeof o === 'function' ? o() : o);
    } catch (e) { A.error = String(e && e.message || e).slice(0, 200); return; }
    if (!snap || typeof snap !== 'object') return;
    A.ok = true; A.error = '';
    var ended = test(O.ended, snap);
    if (!A.armed) { if (ended) return; A.armed = true; }       // an end only counts after the game was seen not ended
    var v = readValue(snap, O.value);
    if (A.first === undefined) A.first = v;
    if (!A.started && (O.started ? test(O.started, snap) : v !== A.first)) A.started = true;
    var p = null;
    if (O.progress && typeof O.progress === 'object') {
      var raw = num(get(snap, O.progress.path));
      if (raw !== null) p = Math.max(0, Math.min(1, typeof O.progress.max === 'number' && O.progress.max > 0 ? raw / O.progress.max : raw));
    }
    if (ended) return finishRun(v, O.won ? test(O.won, snap) : null);
    report(p, v);
  }

  // Adapter "hooks": the game calls gf.run.* (sdk/gf.js), which posts to its parent, this page.
  function onGameMessage(e) {
    if (e.source !== frame.contentWindow || !e.data || e.data.gf !== 1 || !R) return;
    var m = e.data;
    if (m.type === 'hello') { A.ok = true; frame.contentWindow.postMessage({ gf: 1, type: 'init' }, '*'); return; }
    if (R.adapter !== 'hooks' || !S.go || A.done || !thisRound()) return;
    if (m.type === 'start') { A.armed = true; A.started = true; }
    else if (m.type === 'progress' && num(m.value) !== null) {
      var kind = R.progress && R.progress.kind === 'fraction' ? 'fraction' : 'score', max = R.progress && R.progress.max;
      if (kind === 'fraction') report(Math.max(0, Math.min(1, m.value)), null);
      else report(typeof max === 'number' && max > 0 ? Math.max(0, Math.min(1, m.value / max)) : null, m.value);
    } else if (m.type === 'end' && A.armed) finishRun(m.value, m.won === true ? true : m.won === false ? false : null);
  }

  // ---------------- drawing ----------------
  function inviteLink() {
    var u = new URL(location.href), q = new URLSearchParams();
    q.set('join', S.code || '');
    (window.GF_P2P_CONFIG.inviteParams || []).forEach(function (k) { var v = params.get(k); if (v !== null) q.set(k, v); });
    u.search = q.toString(); u.hash = '';
    return u.href;
  }

  function render() {
    if (S.fatal || S.phase !== 'room') { rail.hidden = true; if (!S.fatal) card.hidden = true; return; }
    var st = S.standing, ph = st ? st.phase : 'lobby', mine = me(), host = isHost();
    rail.hidden = false;
    var left = Math.max(0, Math.ceil((S.goAt - performance.now()) / 1000));
    var counting = !!S.go && !S.revealed;

    // rail
    var rk = JSON.stringify([st && st.racers, S.names, S.away, S.you, ph, host, S.note, A.done, A.error, A.started, st && st.round, LIVE]);
    if (rk !== railKey) {
      railKey = rk;
      $('rail-sub').textContent = 'Room ' + (S.code || '') + (st && st.round ? ' · round ' + st.round : '');
      $('racers').replaceChildren.apply($('racers'), (st ? st.racers : []).map(function (r, i) {
        var val = r.watching ? 'next round' : r.done ? (r.dnf || (cfg().direction === 'lower' && r.won === false) ? 'out' : fmt(r.value)) : r.dnf ? 'did not finish' : ph === 'racing' || ph === 'results' ? (r.live !== null ? fmt(r.live) : '') : '';
        var out = r.done && cfg().direction === 'lower' && r.won === false;   // lost where lower is better: not a result
        return el('li', { class: (r.id === S.you ? 'me ' : '') + (r.done ? (out ? 'out ' : 'done ') : '') + (S.away[r.id] ? 'away' : ''), 'data-id': r.id }, [
          LIVE ? el('span', { class: 'dot', style: 'background:' + COLORS[seat(r.id) % COLORS.length] }) : el('span', { class: 'place', text: r.watching ? '' : String(i + 1) }),
          el('span', { class: 'name', text: name(r.id) + (r.id === S.you ? ' (you)' : '') + (S.away[r.id] ? ' · away' : '') }),
          el('span', { class: 'val', text: val }),
          el('span', { class: 'bar' }, [el('i', { style: 'width:' + Math.round((r.progress || 0) * 100) + '%' })]),
        ]);
      }));
      var status = S.note || A.error;
      if (!status) {
        if (ph === 'lobby') status = host ? 'Start when everyone is here.' : 'Waiting for the host to start.';
        else if (ph === 'racing' && mine && mine.watching) status = 'Round in progress. You are in the next one.';
        else if (ph === 'racing' && A.done) status = 'Your result: ' + fmt(A.value) + '. Waiting for the others.';
        else if (LIVE && ph === 'loading') status = 'Loading the game for everyone.';
        else if (LIVE && (ph === 'racing' || ph === 'countdown')) status = R.team === true ? 'You are all in the same game, on the same side.' : 'You are all in the same game. ' + goal();
        else if (ph === 'racing') status = A.started ? 'Same game for everyone. ' + goal() : 'Start your game when you are ready.';
        else if (ph === 'results') status = host ? 'Start another round when ready.' : 'Waiting for the host to start another round.';
      }
      $('status').textContent = status || '';
      $('stop').hidden = !(host && ph === 'racing');
    }

    // card over the stage
    var loading = counting && S.goAt === Infinity;        // live: games are loading, the room has not said 'begin' yet
    var view = ph === 'lobby' && !S.go ? 'lobby' : loading ? 'loading' : counting ? 'count' : ph === 'results' && S.dismissed !== (st ? st.round : 0) ? 'results'
      : (ph === 'racing' || ph === 'countdown') && mine && mine.watching ? 'watching' : null;
    // The rail's own Start shows only when no card is offering it (the lobby and results cards carry the button).
    $('start').hidden = !(host && (ph === 'lobby' || ph === 'results') && view !== 'lobby' && view !== 'results');
    $('start').textContent = ph === 'results' ? 'Play again' : 'Start';
    var ck = JSON.stringify([view, view === 'count' ? left : 0, view === 'results' ? [st.racers, S.names] : 0, view === 'lobby' ? [S.code, host, st && st.racers.length, S.names] : 0, st && st.round,
      view === 'loading' ? [st && st.racers.map(function (r) { return r.ready; }), S.names] : 0]);
    if (ck === cardKey) return;
    cardKey = ck;
    if (!view) { card.hidden = true; card.replaceChildren(); return; }
    var kids = [];
    if (view === 'lobby') {
      var link = el('input', { id: 'mp-invite', readonly: true, value: inviteLink(), 'aria-label': 'Invite link' });
      var cp = el('button', { id: 'mp-copy', text: 'Copy', onclick: function () {
        var done = function () { cp.textContent = 'Copied'; setTimeout(function () { cp.textContent = 'Copy'; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link.value).then(done, function () { link.select(); }); else link.select();
      } });
      kids.push(el('h2', { text: $('rail-title').textContent }),
        el('p', { text: (host ? 'Your game is open. Share this code or link. ' : 'You are in. The host starts the round. ')
          + (LIVE ? 'Everyone plays in the same game and sees each other.' + (R.team === true ? '' : ' ' + goal()) : (host ? 'Everyone plays the same game at the same time. ' : '') + goal()) }),
        el('div', { class: 'code', id: 'mp-code', text: S.code || '' }), el('div', { class: 'link' }, [link, cp]),
        el('p', { class: 'muted', id: 'mp-count', text: (st ? st.racers.length : 1) + (st && st.racers.length === 1 ? ' player here.' : ' players here.') + (host ? ' Keep this tab open: the game runs on your computer.' : '') }),
        el('div', { class: 'row' }, [host ? el('button', { id: 'mp-start', class: 'primary', text: 'Start', onclick: function () { window.gf.room.send({ k: 'start' }); } }) : null]));
    } else if (view === 'loading') {
      kids.push(el('h2', { text: 'Round ' + S.go.round }), el('p', { id: 'mp-loading', text: 'Loading the game for everyone…' }),
        el('table', {}, [el('tbody', {}, (st ? st.racers : []).filter(function (r) { return !r.watching; }).map(function (r) {
          return el('tr', { class: r.id === S.you ? 'me' : '' }, [el('td', { text: name(r.id) + (r.id === S.you ? ' (you)' : '') }), el('td', { class: 'r', text: r.ready ? 'ready' : 'loading…' })]);
        }))]));
    } else if (view === 'count') {
      kids.push(el('h2', { text: 'Round ' + S.go.round }), el('div', { class: 'count', id: 'mp-countdown', text: String(left || 1) }),
        el('p', { text: LIVE ? 'Everyone starts together.' : 'Everyone gets the same game. Start it when it appears.' }));
    } else if (view === 'watching') {
      kids.push(el('h2', { text: 'Round in progress' }), el('p', { text: 'You are in the next one. The standings are on the side.' }));
    } else if (view === 'results') {
      var teamRound = !!(st.cfg && st.cfg.team);          // one result for everybody: a list of the team, not a ranking
      var rows = st.racers.filter(function (r) { return !r.watching; }).map(function (r, i) {
        return el('tr', { class: r.id === S.you ? 'me' : '', 'data-id': r.id }, [el('td', { text: teamRound ? '' : String(i + 1) }), el('td', { text: name(r.id) + (r.id === S.you ? ' (you)' : '') }),
          el('td', { class: 'r', text: r.done && !r.dnf ? fmt(r.value) : r.done ? 'out · ' + fmt(r.value) : 'did not finish' + (r.live !== null ? ' · ' + fmt(r.live) : '') })]);
      });
      var win = st.racers[0], team = !!(st.cfg && st.cfg.team);
      kids.push(el('h2', { id: 'mp-results', text: team ? (win && win.won === true ? 'You won together' : win && win.won === false ? 'You lost together' : 'Round ' + st.round + ' is over')
          : 'Round ' + st.round + (win && win.done && !win.dnf ? ': ' + name(win.id) + ' wins' : ' is over') }),
        el('table', {}, [el('tbody', {}, rows)]),
        el('div', { class: 'row' }, [
          host ? el('button', { id: 'mp-again', class: 'primary', text: 'Play again', onclick: function () { if (settled()) window.gf.room.send({ k: 'start' }); } }) : el('p', { class: 'muted', text: 'The host starts the next round.' }),
          el('button', { id: 'mp-back', text: 'Back to the game', onclick: function () { if (!settled()) return; S.dismissed = st.round; cardKey = null; render(); focusGame(); } })]));
      // The round can end mid-click: give the mouse back (a shooter holds it) and ignore clicks for a moment, so a
      // press meant for the game does not land on a button that has just appeared under it.
      if (S.shownResults !== st.round) { S.shownResults = st.round; S.resultsAt = performance.now(); releasePointer(); }
    }
    card.replaceChildren(el('div', { class: 'panel', 'data-view': view }, kids));
    card.hidden = false;
  }

  // Read-only QA observation.
  window.__party = Object.freeze({
    snapshot: function () {
      var st = S.standing;
      return JSON.parse(JSON.stringify({ phase: S.phase, fatal: S.fatal, you: S.you, code: S.code, host: isHost(), room: st ? st.phase : null, round: st ? st.round : 0,
        seed: S.go ? S.go.seed : null, revealed: S.revealed, frame: frame.src || null, frameSeen: A.seen, live: LIVE, session: !!S.session, gameReady: S.gameReady === (S.go ? S.go.round : -1), cfg: R ? cfg() : null, racers: st ? st.racers : [], names: S.names,
        results: S.results, card: card.hidden ? null : (card.firstElementChild && card.firstElementChild.dataset.view) || 'fatal',
        adapter: { kind: A.kind, ok: A.ok, armed: A.armed, started: A.started, done: A.done, live: A.live, progress: A.progress, value: A.value, won: A.won, polls: A.polls, sent: A.sent, moves: A.moves, error: A.error } }));
    },
  });
})();
