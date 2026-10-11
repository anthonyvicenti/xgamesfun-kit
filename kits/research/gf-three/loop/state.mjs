// The loop's state file, the hash of a game's files, and the rule that refuses stale proof (open builder M2-F).
//
// State is one small JSON file (schema gf-loop/1). By default it sits in the game's folder, at .gf-loop/state.json; a
// host may keep it elsewhere (Studio's worker keeps it beside game/, because a delivered file tree must not carry it).
// It is written after every step (to a temporary file, then renamed), so a run that is killed resumes at the step it
// was on. `status` is the flag a session's Stop hook reads (findings/bridge-spike-2026-10-10.md): building,
// waiting-on-question, delivered, failed.
//
// Stale proof: a verify verdict and a play-test count only for the files they ran on. Each is recorded with the hash
// of the game's files; "delivered" is refused when either hash is not the hash of the files now.
import {readFile,writeFile,mkdir,rename,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';

export const STATE_SCHEMA='gf-loop/1';
export const STATE_DIR='.gf-loop';
export const STATUSES=['building','waiting-on-question','delivered','failed'];
/** Where the state file is unless the host says otherwise. */
export const stateFileOf=game=>resolve(game,STATE_DIR,'state.json');

/** A state store on one file. load() → the state, or null when there is none (or it is not ours). */
export function fileStore(file){
  return {
    file,
    async load(){try{const s=JSON.parse(await readFile(file,'utf8'));return s?.schema===STATE_SCHEMA?s:null;}catch{return null;}},
    async save(state){
      await mkdir(dirname(file),{recursive:true});
      const tmp=`${file}.${process.pid}.tmp`;
      await writeFile(tmp,JSON.stringify(state,null,1)+'\n');
      await rename(tmp,file);            // one rename: a kill leaves the old state or the new one, never half a file
    },
  };
}
/**
 * A state file inside the game's folder must not count as a game asset: assets.json's coverage rule (verify check 1)
 * fails a file with no slot and no ignore entry. This adds the ignore entry once (as the worker does for evidence/).
 * → true when it wrote assets.json. A game with no assets.json is left alone.
 */
export async function ignoreStateDir(game){
  const file=resolve(game,'assets.json');
  let m;try{m=JSON.parse(await readFile(file,'utf8'));}catch{return false;}
  if((m.ignore??[]).some(g=>String(g?.path??'').startsWith(STATE_DIR)))return false;
  m.ignore=[...(m.ignore??[]),{path:`${STATE_DIR}/**`,reason:'the build loop\'s state (research/gf-three/loop), not a game asset'}];
  await writeFile(file,JSON.stringify(m,null,2)+'\n');
  return true;
}

/** A store that keeps the state in memory (tests, and a host that persists it its own way). */
export function memoryStore(initial=null){let s=initial;return {async load(){return s?structuredClone(s):null;},async save(v){s=structuredClone(v);},get value(){return s;}};}

// Not the game: the loop's own folder, QA evidence (verify and play-test records ride along with a version), and what
// no version carries. A change to any other file is a change to the game.
const SKIP_TOP=new Set([STATE_DIR,'evidence']);
const SKIP_ANY=new Set(['node_modules','.git','.DS_Store']);

/**
 * One hash over the game's files: every file's path and sha256, sorted by path (so it is the same on every system),
 * without the folders above and without symbolic links. → 64 hex characters.
 */
export async function filesHash(game){
  const rows=[];
  const walk=async(dir,rel)=>{
    for(const e of (await readdir(dir,{withFileTypes:true}).catch(()=>[])).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      if(SKIP_ANY.has(e.name)||e.isSymbolicLink()||(!rel&&SKIP_TOP.has(e.name)))continue;
      const p=join(dir,e.name),r=rel?`${rel}/${e.name}`:e.name;
      if(e.isDirectory())await walk(p,r);
      else if(e.isFile())rows.push(`${r}\0${createHash('sha256').update(await readFile(p)).digest('hex')}`);
    }
  };
  await walk(resolve(game),'');
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

/** Refusal codes (stable: a tool and a test match on them, never on the words). */
export const REFUSALS={
  NO_VERIFY:'no-verify',            // nothing was verified
  VERIFY_FAILED:'verify-failed',    // the last verify failed
  STALE_VERIFY:'stale-verify',      // the files changed after the last verify
  STALE_PLAYTEST:'stale-playtest',  // the files changed after the last play-test
};

/**
 * Is each proof on record still about the files as they are? Pure.
 *   state.verify   = {n, ok, hash, at} | null       state.playtest = {round, ok, hash, at} | null (hash null: it never ran)
 * → {hash, verify: 'fresh' | 'stale' | 'none', playtest: 'fresh' | 'stale' | 'none', stale: [codes]}
 */
export function proofOf(state,hashNow){
  const one=p=>!p?'none':p.hash==null?(p===state.verify?'stale':'none'):p.hash===hashNow?'fresh':'stale';
  const verify=one(state.verify??null),playtest=one(state.playtest??null);
  return {hash:hashNow,verify,playtest,stale:[...(verify==='stale'?[REFUSALS.STALE_VERIFY]:[]),...(playtest==='stale'?[REFUSALS.STALE_PLAYTEST]:[])]};
}

/**
 * May this game be called delivered? The one rule, for every host. Pure.
 * → {ok: true} | {ok: false, code, next: the step that would make it true, why}
 * A play-test that never ran is not stale proof (the host's own rules say whether a play-test is required).
 */
export function deliverable(state,hashNow){
  const p=proofOf(state,hashNow);
  if(p.verify==='none')return {ok:false,code:REFUSALS.NO_VERIFY,next:'verify',why:'no verify has run on this game'};
  if(p.verify==='stale')return {ok:false,code:REFUSALS.STALE_VERIFY,next:'verify',why:`the game's files changed after verify ${state.verify.n} (stale proof): verify again`};
  if(!state.verify.ok)return {ok:false,code:REFUSALS.VERIFY_FAILED,next:'repair',why:`verify ${state.verify.n} failed`};
  if(p.playtest==='stale')return {ok:false,code:REFUSALS.STALE_PLAYTEST,next:'playtest',why:`the game's files changed after play-test round ${state.playtest.round} (stale proof): play-test again`};
  return {ok:true,proof:p};
}
