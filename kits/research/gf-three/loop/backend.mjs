// A game's backend in the build loop (open builder wave 11, track L). Home: a part (the backend). The creator,
// 2026-10-12 (research/foundations/evidence/open-builder-backend-optional-2026-10-12.json): "Some people will be ok with
// just a browser game with no backend, and others will want to build backends, leaderboards, or other infra."
//
// No backend is the default. Nothing here runs for a spec without `backend`, and a host that says nothing about
// backends gets the loop as it was, byte for byte. A backend is the person's own account and bill (a database on their
// own Supabase, a server on their own Railway): the open builder connects it, games.fun never hosts it, and nothing
// here signs anyone in, holds a key or talks to a provider.
//
//   pitch     the pitch names a backend only when the creator's words need one (copied into play.backend.from), or
//             offers it as one question (about: backend) with "No backend, play in the browser" as an option; never
//             both. A best score or progress in the browser's own storage is not a backend, and neither is playing with
//             friends online (the kit's gf/mp). The creator reads one sentence built from the fields (backendWords):
//             what it keeps, that it is their own account and bill with the provider's free tier, and how the game
//             plays until it is connected.
//   spec      `backend: {kind, provider?, needs}` inline (research/studio-v2/game-spec.schema.json). The spec file is
//             locked byte for byte, so the lock covers it with nothing added. What a connection writes into the game
//             (<game>/backend.json: the URL and the public key, the kit's lib/backend/config.mjs) is NOT the plan and
//             is not locked: the person connects whenever they like, before or after delivery.
//   deliver   the game is delivered playable whether or not anything is connected; outcome.backend says which and,
//             when nothing is, what to connect (backendAtDelivery). The outcome's name is unchanged.
//
// Pure apart from reading <game>/backend.json. Node's own modules only (the library's rule).
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** The question's `about` for a backend (pitch.schema.json → questions[].about). */
export const BACKEND_ABOUT='backend';
/** Where a connection is written in the game's folder (the kit's lib/backend/config.mjs FILE: public values only). */
export const CONNECTION_FILE='backend.json';
/** The two kinds (the kit's provider files say the same: lib/backend/providers.mjs `kind`). */
export const BACKEND_KINDS=['database','host'];
/** What a backend can be for, in the order the creator reads them. */
export const BACKEND_NEEDS=['leaderboard','saves','accounts','server-rules','trading'];
/** A need in the creator's words: what it keeps, and how the game plays while nothing is connected. */
export const NEED_WORDS={
  leaderboard:{what:'a leaderboard across players',off:'the leaderboard says it needs your {kind}'},
  saves:{what:'progress that follows a player to any device',off:'progress is kept in this browser only, and the game says so'},
  accounts:{what:'player accounts',off:'everyone plays as a guest, and the game says so'},
  'server-rules':{what:'a server that decides what counts (scores, wins)',off:'the browser decides results, and the game says they are not checked'},
  trading:{what:'trading between players',off:'trading says it needs your {kind}'},
};
/**
 * The providers the kit connects, with what they cost the person as their own pages said on 2026-10-12
 * (research/open-builder/findings/providers-2026-10-12.md, read raw). Prices go stale: that file is the source.
 */
export const PROVIDERS={
  supabase:{label:'Supabase',kind:'database',cost:'Supabase\'s free tier: 2 active projects, and a free project pauses after a week with no visits; Pro is from $25 a month'},
  railway:{label:'Railway',kind:'host',cost:'Railway\'s free plan: $1 of credit a month; Hobby is $5 a month, and a small always-on game server costs a few dollars a month'},
};
/** The provider a kind gets when the pitch names none. */
export const DEFAULT_PROVIDER={database:'supabase',host:'railway'};
const KIND_WORD={database:'database',host:'server'};
/** The command that connects a provider (the kit's `gamesfun backend connect <id>`; its studio has the same as a button). */
export const connectCommand=provider=>`npx gamesfun backend connect ${provider}`;

/** The rule the pitch prompt and the creator both read: what is not a backend. */
export const NOT_A_BACKEND='A best score or progress kept in the browser\'s own storage is not a backend, and neither is playing with friends online (the kit does that with no server).';
/** The question's option that leaves the backend out (its words; checked loosely by DROP_BACKEND). */
export const NO_BACKEND='No backend, play in the browser';
const DROP_BACKEND=/\b(no|without|none|skip|drop)\b[^.]*\b(backend|database|server|account)s?\b|\b(in|on)\s+the\s+browser\b|\bbrowser\s+only\b|\blocal(ly)?\b/i;

// What the creator's words say. SAID: words that can only mean something kept beyond one browser (a backend settles
// it). HINT: words that may mean the browser's own storage or a backend (ask). Neither: nothing persistent, no backend.
export const SAID_BACKEND=/\b(back[\s-]?ends?|databases?|supabase|firebase|railway|server[\s-]side|(my|our|your|its|own|dedicated|real)\s+(own\s+)?(game\s+)?servers?|cloud[\s-]?sav(e|es|ed|ing)|across\s+(all\s+)?(devices|phones|computers|browsers)|(on|from)\s+any\s+(device|phone|computer)|(global|online|world(wide)?|all[\s-]time|public|shared)\s+(leader\s?boards?|high[\s-]?scores?|rankings?|score\s?boards?)|leader\s?boards?\s+(across|of|for|with)\s+(all|every(one|body)?)\b|(player|user)\s+accounts?|accounts?\s+for\s+(players|everyone)|log[\s-]?ins?|logs?\s+in|sign[\s-]?(in|up)s?|signs?\s+(in|up)|trad(e|es|ing)\s+(with|between)\s+(other\s+)?(players|each\s+other|friends|strangers)|player[\s-]to[\s-]player\s+trad(e|es|ing)|anti[\s-]?cheat|cheat[\s-]?proof)\b/i;
export const HINT_BACKEND=/\b(leader\s?boards?|rankings?|ranked|hall\s+of\s+fame|high[\s-]?score\s+(table|list|board)s?|sav(e|es|ed|ing)\s+(my|your|their|the|his|her|each\s+player'?s?|players'?)\s+(progress|game|run|stuff|items|pets|coins|town|base|house|levels?|unlocks?)|progress\s+(is\s+)?(saved|kept)|(keeps?|keeping)\s+(your|their|my)\s+(progress|stuff|items|pets|coins|upgrades|unlocks)|come\s+back\s+(tomorrow|later|next\s+time)|trad(e|es|ing))\b/i;
/** Do the creator's words mention anything kept beyond one browser? (A host shows PITCH_BACKEND_STEP only then.) */
export const backendMentioned=words=>SAID_BACKEND.test(String(words??''))||HINT_BACKEND.test(String(words??''));

const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const list=v=>Array.isArray(v)?v:[];
/** The spec's backend (object or text), or null. */
export function specBackend(spec){
  let s=spec;
  if(typeof s==='string'){try{s=JSON.parse(s);}catch{return null;}}
  return isObj(s?.backend)?s.backend:null;
}
/** The provider a backend uses: its own, else the kind's default. */
export const providerOf=b=>b?.provider??DEFAULT_PROVIDER[b?.kind]??null;

/**
 * A backend's own shape, beyond its schema: a known kind, needs from the list (no repeats), and a provider of that
 * kind. `at`: the path the errors start with. → errors
 */
export function backendProblems(b,at='backend'){
  if(!isObj(b))return [`${at}: an object {kind, needs, provider?}`];
  const out=[];
  if(!BACKEND_KINDS.includes(b.kind))out.push(`${at}.kind: "${b.kind}" is not a kind: "database" (scores, saves, accounts in tables) or "host" (the person's own server: rules it decides, trading, anything that runs on its own)`);
  const needs=list(b.needs);
  if(!needs.length)out.push(`${at}.needs: say what the backend is for (${BACKEND_NEEDS.join(', ')})`);
  for(const n of needs)if(!BACKEND_NEEDS.includes(n))out.push(`${at}.needs: "${n}" is not one of ${BACKEND_NEEDS.join(', ')}`);
  if(new Set(needs).size!==needs.length)out.push(`${at}.needs: each need once`);
  if(b.provider!=null){
    const p=PROVIDERS[b.provider];
    if(!p)out.push(`${at}.provider: "${b.provider}" is not a provider the kit connects (${Object.keys(PROVIDERS).join(', ')}); leave it out to let the person choose when they connect`);
    else if(BACKEND_KINDS.includes(b.kind)&&p.kind!==b.kind)out.push(`${at}.provider: ${p.label} is a ${p.kind}, and this backend's kind is "${b.kind}"`);
  }
  return out;
}
const sameNeeds=(a,b)=>[...list(a)].sort().join()===[...list(b)].sort().join();
/** Does a card's spec backend say the same as the pitch's? (kind, needs, and the provider when both name one) */
export const sameBackend=(a,b)=>!!a&&!!b&&a.kind===b.kind&&sameNeeds(a.needs,b.needs)&&(a.provider==null||b.provider==null||a.provider===b.provider);

const joinWords=xs=>xs.length<=1?xs.join(''):`${xs.slice(0,-1).join(', ')} and ${xs.at(-1)}`;
const kindWord=b=>KIND_WORD[b?.kind]??'backend';
/** How the game plays while nothing is connected, per need, in plain words. */
export const offWords=b=>list(b?.needs).filter(n=>NEED_WORDS[n]).map(n=>NEED_WORDS[n].off.replace('{kind}',kindWord(b)));

/**
 * What the creator reads about the backend a pitch names, from its fields (pitch.schema.json → play.backend): what it
 * keeps, whose account and bill it is with the provider's free tier, how the game plays until it is connected, and how
 * to drop it when no question asks. The same words in every host; the agent never words them itself.
 */
export function backendWords(b,{asked=false}={}){
  if(!isObj(b))return '';
  const p=PROVIDERS[providerOf(b)],kw=kindWord(b);
  const keeps=joinWords(list(b.needs).filter(n=>NEED_WORDS[n]).map(n=>NEED_WORDS[n].what));
  const off=offWords(b);
  return [
    `This game keeps ${keeps||'something beyond one browser'} in a ${kw} on your own ${p?`${p.label} account`:'account with a provider you choose'}: you sign in there yourself, and it is your account and your bill${p?` (${p.cost})`:''}.`,
    `Until you connect it, the game plays in the browser${off.length?`: ${joinWords(off)}`:''}.`,
    ...(asked?[]:['Say "no backend" and it is built to play in the browser only.']),
  ].join(' ');
}

/** The pitch prompt's words for the backend, for a host that can connect one. A host shows them only when the creator's words mention something kept (pitchBackendStep), so every other pitch prompt is what it was. */
export const PITCH_BACKEND_STEP=[
  `**A backend** (this session can connect one: a database or a server on the creator's own account). Most games need none. ${NOT_A_BACKEND} Name one in \`play.backend\` only when the creator's words need one, or offer it as one question (checked):`,
  '- **Their words need one** (a leaderboard across all players, progress that follows a player to another device, accounts or signing in, a server that decides results, trading between players, a backend, server or database by name): copy those words exactly into `play.backend.from` and ask nothing about it.',
  `- **Their words leave it open** (a leaderboard, rankings, saving progress, coming back later, trading): leave \`from\` out and ask it as one of your questions (\`"about": "backend"\`), with one option that keeps it and one that is "${NO_BACKEND}", the cards' choice as the default. \`play.backend\` still says what the backend would be, even when the default leaves it out: that is what the question offers.`,
  `- \`play.backend\`: \`kind\` ("database" for scores, saves and accounts; "host" for the creator's own server: rules a server decides, trading), \`needs\` (from ${BACKEND_NEEDS.map(n=>`\`${n}\``).join(', ')}), and \`provider\` when you choose one (${Object.entries(PROVIDERS).map(([id,p])=>`"${id}" is a ${p.kind}`).join(', ')}). The creator reads one sentence the loop builds from these fields: what it keeps, that it is their own account and bill with its free tier, and how the game plays until they connect it. A \`play.needs\` row the backend does names \`"backend"\` in \`by\`.`,
  '- **The locked spec, when the creator kept it:** the same `backend` (`{kind, needs, provider}`); card 1\'s spec has it unless the question\'s default leaves it out. When they dropped it, the spec has no `backend`, and what it would have kept stays in the browser or is left out.',
];
/** The backend step's lines for a pitch prompt: PITCH_BACKEND_STEP when the creator's words mention something kept, else []. */
export const pitchBackendStep=words=>backendMentioned(words)?PITCH_BACKEND_STEP:[];

const flat=s=>String(s??'').toLowerCase().replace(/[‘’]/g,'\'').replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
const quoted=(q,words)=>{const f=flat(q);return f.length>=2&&flat(words).includes(f);};

/**
 * The backend step of checkPlay (pitch-rules.mjs), for a host that can connect one (`backends: true`).
 * → errors with JSON paths from the pitch root
 */
export function backendRules(play,{words,questions,left,cards}){
  const out=[],B=play?.backend??null,qB=questions.find(q=>q?.about===BACKEND_ABOUT)??null;
  const said=words.match(SAID_BACKEND)?.[0]??null,hint=words.match(HINT_BACKEND)?.[0]??null;
  const c1=cards[0]?.spec??null;
  if(!B){
    if(qB)out.push(`$.questions: the question "${qB.id}" asks about a backend the pitch does not name: say what it would keep in play.backend (kind, needs, provider; no from), or drop the question`);
    else if(said)out.push(`$.play.backend: the creator's words need a backend ("${said}"): name it in play.backend ({kind, needs, provider}) with those words copied exactly into from, and ask nothing about it`);
    else if(hint&&left>0)out.push(`$.questions: the creator's words mention "${hint}", which the browser can keep on its own or which needs a backend: offer one in play.backend (kind, needs; no from) and ask it as one of the questions ("about": "backend"), with an option that keeps it and one that is "${NO_BACKEND}"`);
    for(const [i,c] of cards.entries())if(c?.spec?.backend!=null)out.push(`$.cards[${i}].spec.backend: the pitch names no backend (play.backend), so no card's spec has one: take "backend" out of the spec`);
    return out;
  }
  out.push(...backendProblems(B,'$.play.backend'));
  const fromOk=B.from!=null&&quoted(B.from,words);
  if(B.from!=null&&!fromOk)out.push(`$.play.backend.from: "${B.from}" is not in the creator's words: copy the words that need a backend exactly as they wrote them, or leave "from" out and ask (a question with "about": "backend")`);
  else if(fromOk&&!SAID_BACKEND.test(B.from))out.push(`$.play.backend.from: "${B.from}" does not settle it (the browser can keep it on its own): leave "from" out and ask (a question with "about": "backend")`);
  if(B.from!=null&&qB)out.push(`$.questions: the creator's words already need a backend ("${B.from}"): do not ask it again (drop the question "${qB.id}")`);
  // words about nothing kept: no backend, offered or not (an idea is not given a backend it did not ask for)
  if(B.from==null&&!said&&!hint)out.push(`$.play.backend: the creator's words ask for nothing kept beyond one browser, so the game has no backend: leave play.backend out${qB?` and drop the question "${qB.id}"`:''}. ${NOT_A_BACKEND}`);
  else if(B.from==null&&!qB){
    if(said)out.push(`$.play.backend.from: the creator's words need a backend ("${said}"): copy them here`);
    else out.push(left>0?`$.questions: the creator's words do not settle whether a backend is wanted ("${hint}"), so the pitch offers it as a question ("about": "backend"), with an option that keeps it and one that is "${NO_BACKEND}", the cards' choice as the default`:'$.play.backend: the creator\'s words do not settle it and no question is left to offer one: leave play.backend out');
  }
  let dropDefault=false;
  if(qB){
    const opts=list(qB.options),drop=opts.find(o=>DROP_BACKEND.test(`${o?.label??''} ${o?.id??''}`));
    if(opts.length<2||!drop)out.push(`$.questions: the question "${qB.id}" lets the creator play with no backend: one option keeps it, one is "${NO_BACKEND}"`);
    dropDefault=!!drop&&qB.default===drop.id;
  }
  // card 1 plays what the creator said, or the question's default
  if(cards[0]?.spec){
    if(c1.backend!=null&&!sameBackend(c1.backend,B))out.push(`$.cards[0].spec.backend: card 1's backend is not the one play.backend names (kind "${B.kind}", needs ${list(B.needs).join(', ')}${B.provider?`, provider "${B.provider}"`:''}): make them the same`);
    if(c1.backend==null&&!dropDefault&&(fromOk||qB))out.push(`$.cards[0].spec.backend: ${fromOk?'the creator\'s words need a backend':`the question "${qB.id}" keeps the backend by default`}, so card 1's spec has play.backend as its "backend"`);
    if(c1.backend!=null&&dropDefault)out.push(`$.cards[0].spec.backend: the question "${qB.id}" leaves the backend out by default, so card 1's spec has no "backend"`);
  }
  return out;
}

/** With no backend to connect, a pitch names none, asks nothing about one, and no card's spec has one. */
export function backendOff(pitch,cards){
  const out=[];
  if(pitch?.play?.backend!=null)out.push('$.play.backend: this session cannot connect a backend, so no game here has one: leave play.backend out (when the creator\'s words need one, it is a play.needs row marked missing)');
  for(const q of list(pitch?.questions))if(q?.about===BACKEND_ABOUT)out.push(`$.questions: this session cannot connect a backend, so there is none to ask about: drop the question "${q.id}"`);
  for(const [i,c] of cards.entries())if(c?.spec?.backend!=null)out.push(`$.cards[${i}].spec.backend: this session cannot connect a backend: take "backend" out of the spec`);
  return out;
}

/** The spec step's check of a locked spec's backend (talk-loop.mjs). `host`: the talk host's `backends`, or null. → errors */
export function specBackendProblems(spec,host){
  const b=specBackend(spec);
  if(!b)return [];
  if(!host)return ['backend: this session cannot connect a backend, so no game here has one: take "backend" out of the spec'];
  return backendProblems(b,'backend');
}
/** What the locked spec's answer carries about its backend, for the session to tell the person. */
export const lockedBackend=b=>({kind:b.kind,provider:providerOf(b),needs:[...list(b.needs)],words:backendWords(b,{asked:true}),connect:connectCommand(providerOf(b))});

/** <game>/backend.json as the kit wrote it (public values only), or null. */
export async function readConnection(game){
  try{const v=JSON.parse(await readFile(resolve(game,CONNECTION_FILE),'utf8'));return isObj(v)&&typeof v.url==='string'&&v.url?v:null;}catch{return null;}
}
/** Verify's checks about the backend (track B names them: a check whose `part` is "backend", or whose name says backend). */
export const backendChecks=verdict=>list(verdict?.checks).filter(c=>c?.part==='backend'||/\bbackend\b/i.test(`${c?.name??''}`));

/**
 * The backend at delivery. Delivery never waits for it: a game with nothing connected is delivered playable, and this
 * says what to connect. `adapter`: the host's {status() → {connected, provider, url}} (the kit's backend status),
 * else <game>/backend.json is read. `verdict`: the last verify, for the checks about the backend.
 * → {state: 'connected' | 'not-connected', kind, provider, needs, words, connect?, url?, checks?}
 */
export async function backendAtDelivery({game,backend,adapter=null,verdict=null}={}){
  if(!isObj(backend))return null;
  const provider=providerOf(backend),p=PROVIDERS[provider],kw=kindWord(backend);
  let status=null;
  try{status=adapter?.status?await adapter.status():null;}catch{status=null;}
  const conn=status?(status.connected?{provider:status.provider??provider,url:status.url??null}:null):await readConnection(game);
  const base={kind:backend.kind,provider,needs:[...list(backend.needs)]};
  if(conn){
    const checks=backendChecks(verdict).map(c=>({id:String(c.id??c.n??''),name:c.name??'',ok:!!c.ok}));
    const other=conn.provider&&provider&&conn.provider!==provider?` (the plan named ${p?.label??provider}; it is connected to ${PROVIDERS[conn.provider]?.label??conn.provider})`:'';
    const checked=checks.length?` verify checked it: ${checks.map(c=>`${c.name||c.id} ${c.ok?'passed':'failed'}`).join(', ')}.`:' No check of it against your '+kw+' ran in this build.';
    return {...base,state:'connected',url:conn.url,...(checks.length?{checks}:{}),words:`Delivered, connected to your ${PROVIDERS[conn.provider]?.label??conn.provider??''} ${kw}${conn.url?` at ${conn.url}`:''}${other}.${checked}`.replace(/ {2,}/g,' ')};
  }
  const off=offWords(backend),cmd=connectCommand(provider);
  return {...base,state:'not-connected',connect:cmd,
    words:`Delivered, playable in the browser with no ${kw} connected${off.length?`: ${joinWords(off)}`:''}. To connect your own${p?` ${p.label}`:''} ${kw}: ${cmd}, or the studio's Backend tab. You sign in there yourself, and it is your account and your bill${p?` (${p.cost})`:''}.`};
}

/** The backend's state after delivery, refreshed from the host's status: a host shows this until the person connects. */
export function backendNow(current,status){
  if(!current||current.state!=='not-connected'||!status?.connected)return current;
  const {connect,...rest}=current,label=PROVIDERS[status.provider??current.provider]?.label??status.provider??'';
  return {...rest,state:'connected',url:status.url??null,words:`Connected to your ${label} ${kindWord(current)}${status.url?` at ${status.url}`:''}. Nothing in this build checked it against your ${kindWord(current)}: run verify again to check it.`};
}
