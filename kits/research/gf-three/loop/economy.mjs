// A game's economy in the build loop (games.fun research/gf-economy/KIT-PLAN.md, K3: the pitch names it, the spec
// holds it, deliver includes going live). Home: a part (the economy). Nothing here runs for a game whose spec has no
// `economy`, and nothing here signs, holds a key or talks to a chain.
//
// ONE SOURCE OF TRUTH: the economy lives in one place, the `economy` section of the game's gamesfun.json, which the
// kit's economy_save writes (only a spec its checker passes), the Economy tab edits and the go-live flow writes its
// addresses into. The game spec holds a REFERENCE to it, `"economy": {"in": "gamesfun.json"}`, never a copy:
//   - the kit's tab and tools already edit gamesfun.json, and the page that hosts the game reads it there; a copy in
//     the spec would drift from it the first time the creator changed a number in the tab;
//   - going live writes ids and addresses into gamesfun.json as each transaction lands: a copy, or a hash kept in the
//     spec, would go stale at every publish, and a later change run would start from a spec that disagrees with it;
//   - Studio's worker runs the same loop on the same files, so the reference means the same thing in both hosts.
// The lock covers it: when the locked spec references an economy, the run's lock (lock.mjs) also holds the economy as
// it was agreed (its text and hash, without what going live writes), and an edit after the lock is put back and
// refused like an edit to the spec. A change goes through the same path as any spec change (a change run, or the
// host's relock after the person agreed).
//
// Pure apart from reading and writing <game>/gamesfun.json. Node's own modules only (the library's rule).
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export const ECONOMY_FILE='gamesfun.json';
/** The spec's reference, as the schema has it (research/studio-v2/game-spec.schema.json → economy). */
export const ECONOMY_REF={in:ECONOMY_FILE};
/** The question's `about` for the economy (pitch.schema.json → questions[].about). */
export const ECONOMY_ABOUT='economy';

/**
 * Whoever pays for clears confirms the win on their own end (the creator, 2026-10-12: "anyone who wants to give out rewards
 * based on completing the game worries about actually confirming somone beat the game on their own end"; the kit's
 * web3/economy/README.md, Decisions; KIT-PLAN.md §6), said in plain words whenever an economy pays for clears. Shown in the pitch, at the spec and at delivery.
 */
export const KEEPER_HOLE='Checking that a player really beat the game is up to you, on your own server or backend: the kit cannot tell a real win from a faked one, so without that a player who paid for an attempt can claim a clear they didn\'t make, once per attempt, up to the caps.';
/** The outcome's first words while the economy waits for the creator's wallet. */
export const ECONOMY_WAITING='Delivered, economy waiting for your approval.';
export const ECONOMY_LIVE='Delivered, and its economy is live on devnet.';

const sha=text=>createHash('sha256').update(text).digest('hex');
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Does this spec (object or text) reference an economy? */
export function specEconomy(spec){
  let s=spec;
  if(typeof s==='string'){try{s=JSON.parse(s);}catch{return null;}}
  return isObj(s?.economy)?s.economy:null;
}
export const economyFileOf=(game,ref=ECONOMY_REF)=>resolve(game,ref?.in??ECONOMY_FILE);

/** <game>/gamesfun.json as an object, or null. */
async function readConfig(file){try{const v=JSON.parse(await readFile(file,'utf8'));return isObj(v)?v:null;}catch{return null;}}
/** The economy the spec references, as gamesfun.json holds it now, or null. */
export async function readEconomy(game,ref=ECONOMY_REF){const c=await readConfig(economyFileOf(game,ref));return isObj(c?.economy)?c.economy:null;}

// What going live writes into the economy (the kit's web3/node/flows.mjs and compile.mjs carryIds): not part of what
// the creator agreed to, so neither the lock nor a put-back touches it.
const ID_FIELD={items:'id',pools:'index',boxes:'id',recipes:'id',schedules:'id',lotteries:'id',stakes:'id'};
const CURVE_FIELDS=['mint','decimals','program','venue','image','uri'];
const MEDIA_FIELDS=['uri'];
const fieldsWritten=(list,part)=>[
  ...(ID_FIELD[list]?[ID_FIELD[list]]:[]),
  ...(list==='tokens'&&part?.source==='curve'?CURVE_FIELDS:[]),
  ...(list==='items'?[...MEDIA_FIELDS,...(part?.picture?['image']:[])]:[]),
];
const sortKeys=v=>Array.isArray(v)?v.map(sortKeys):isObj(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortKeys(v[k])])):v;

/** The economy as the creator agreed to it: without `live`, `previous` and what going live writes into the parts. */
export function agreedEconomy(economy){
  if(!isObj(economy))return null;
  const e=structuredClone(economy);
  delete e.live;delete e.previous;
  for(const [list,parts] of Object.entries(e))if(Array.isArray(parts))for(const p of parts)if(isObj(p))for(const f of fieldsWritten(list,p))delete p[f];
  if(isObj(e.collection)){delete e.collection.uri;if(e.collection.picture)delete e.collection.image;}
  return e;
}
/** One text per agreed economy: sorted keys, so the hash does not depend on the order a tool wrote them in. */
export const economyText=economy=>JSON.stringify(sortKeys(agreedEconomy(economy)));
export const economyHash=economy=>sha(economyText(economy));

/** The economy's side of a lock: {sha, text} of the economy as agreed, or null when gamesfun.json has none. */
export async function economyLock(game,ref=ECONOMY_REF){
  const e=await readEconomy(game,ref);
  if(!e)return null;
  const text=economyText(e);
  return {file:ref?.in??ECONOMY_FILE,sha:sha(text),text};
}
/** The economy on disk against its lock. → null when it holds, else 'edited' | 'missing'. */
export async function economyProblem(game,lock){
  const e=await readEconomy(game,{in:lock?.file??ECONOMY_FILE});
  if(!e)return 'missing';
  return economyHash(e)===lock.sha?null:'edited';
}
/**
 * Put the economy back as it was agreed, keeping what going live wrote since (a publish the creator approved while
 * the build ran is not undone): `live`, `previous`, part ids and addresses, by each part's key.
 */
export async function restoreEconomy(game,lock){
  const file=economyFileOf(game,{in:lock?.file??ECONOMY_FILE}),config=await readConfig(file)??{};
  const now=isObj(config.economy)?config.economy:{},back=JSON.parse(lock.text);
  for(const k of ['live','previous'])if(now[k]!==undefined)back[k]=now[k];
  for(const [list,parts] of Object.entries(back)){
    if(!Array.isArray(parts)||!Array.isArray(now[list]))continue;
    for(const p of parts){
      const was=isObj(p)?now[list].find(x=>isObj(x)&&x.key===p.key):null;
      if(was)for(const f of fieldsWritten(list,p))if(was[f]!==undefined)p[f]=was[f];
    }
  }
  if(isObj(back.collection)&&isObj(now.collection))for(const f of ['uri',...(back.collection.picture?['image']:[])])if(now.collection[f]!==undefined)back.collection[f]=now.collection[f];
  await writeFile(file,JSON.stringify({...config,economy:back},null,2)+'\n');
}

/**
 * Does this economy pay a player for a clear the game reports, after the player paid for the attempt? A decision
 * that moves value to a player (payout, issue, make) and either names the payment a claim must show (`proof`), or
 * is taken when a player clears, beats, finishes, reaches or wins something in an economy where players pay.
 * The level ladder (pay per attempt, the pot on the last level) is the case; a season's payback is not.
 */
const MOVES=new Set(['payout','issue','make']);
const CLEAR_WHEN=/\b(clear(s|ed|ing)?|beat(s|en|ing)?|finish(es|ed|ing)?|complet(e|es|ed|ing)|reach(es|ed|ing)?|wins?|won|winning|succeed(s|ed)?)\b/i;
export function paysForClears(economy){
  if(!isObj(economy))return false;
  const paid=(economy.payments??[]).length>0;
  return (economy.decisions??[]).some(d=>isObj(d)&&MOVES.has(d.does)&&(!!d.proof?.payment||(paid&&CLEAR_WHEN.test(`${d.when??''}`))));
}

const sentence=s=>{const t=String(s??'').trim().replace(/\s+/g,' ');return t&&!/[.!?]$/.test(t)?`${t}.`:t;};
/**
 * What the creator reads about the economy a pitch names, from its fields (pitch.schema.json → play.economy): what it
 * is, the price, how to drop it when no question asks, and the open hole when it pays for clears. The same words in
 * every host; the agent never words them itself.
 */
export function economyWords(e,{asked=false}={}){
  if(!isObj(e))return '';
  return [
    `This game comes with an economy on devnet: ${sentence(e.what)}`,
    `Putting it live costs ${String(e.price??'').trim()}, approved in your own wallet; nothing is signed for you.`,
    ...(asked?[]:['Say "no economy" and the game is built without it.']),
    ...(e.clears?[KEEPER_HOLE]:[]),
  ].join(' ');
}

/**
 * The economy at delivery: going live is the approval link from the host's `publish` (the kit's economy_publish),
 * shown to the person; nothing is signed and delivery does not wait for it. `adapter`: the host's {status(), publish()}
 * (either may be missing). → {state: 'live' | 'waiting-for-approval' | 'refused', words, link, ...}
 */
export async function economyAtDelivery({game,adapter=null,ref=ECONOMY_REF}={}){
  const economy=await readEconomy(game,ref),clears=paysForClears(economy);
  const hole=clears?{clears:true,hole:KEEPER_HOLE}:{};
  const tail=clears?` ${KEEPER_HOLE}`:'';
  let status=null;
  try{status=await adapter?.status?.()??null;}catch{status=null;}
  if(status?.live&&!(status.parts??[]).some(p=>p.differs||!p.onChain))return {state:'live',words:ECONOMY_LIVE+tail,link:null,...hole};
  let pub=null,error=null;
  try{pub=await adapter?.publish?.()??null;}catch(e){error=String(e?.message??e).slice(0,400);}
  if(pub&&pub.ok===false){
    const r=(pub.refusals??[])[0];
    return {state:'refused',words:`Delivered, but its economy cannot go live yet: ${r?`${sentence(r.message)}${r.fix?` ${sentence(r.fix)}`:''}`:'the economy checker refused it.'}${tail}`,refusals:(pub.refusals??[]).slice(0,8),link:null,...hole};
  }
  const link=pub?.approve?.link??pub?.link??null;
  const step=pub?.approve?.step??(link?`Open ${link} and press "Put it live". Your wallet shows every step and its cost before anything is signed.`:'Open the studio\'s Economy tab and press "Put it live". Your wallet shows every step and its cost before anything is signed.');
  return {state:'waiting-for-approval',words:`${ECONOMY_WAITING} ${step}${tail}`,link,...(pub?.cost?{cost:pub.cost}:{}),...(error?{error}:{}),...hole};
}

/**
 * The economy's state after delivery, refreshed from the host's status (the kit's economy_status, or the `live`
 * section of gamesfun.json): a host shows this until the person has approved. → the state's economy, updated
 */
export function economyNow(current,status){
  if(!current)return null;
  if(current.state==='waiting-for-approval'&&status?.live)return {...current,state:'live',words:ECONOMY_LIVE+(current.clears?` ${KEEPER_HOLE}`:''),link:null};
  return current;
}
