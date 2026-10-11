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
export const STATUSES=['building','waiting-on-question','delivered','failed','cancelled'];
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
 * A state file the host process also holds in memory, for a host whose builder can write the file (the tools host:
 * <game>/.gf-loop/state.json is inside the folder the session works in). Keep ONE of these per state file for as long
 * as the process lives. While it lives, load() answers from memory; a file that is no longer what the loop last saved
 * (edited, deleted) is written again from memory, and takeChanged() says so once (REFUSALS.STATE_CHANGED). After the
 * process restarts the memory is gone and the file is all there is: that is the limit of what a library can do.
 */
export function heldStore(file){
  const base=fileStore(file);
  let held=null,text=null,changed=false;
  return {
    file,
    async load(){
      if(!held)return base.load();
      let disk=null;try{disk=await readFile(file,'utf8');}catch{}
      if(disk!==text){changed=true;await base.save(held);}
      return structuredClone(held);
    },
    async save(state){await base.save(state);held=structuredClone(state);text=JSON.stringify(state,null,1)+'\n';},
    /** → true once after a load() that found the file changed. */
    takeChanged(){const c=changed;changed=false;return c;},
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
  CANCELLED:'cancelled',            // the run was ended on purpose: nothing it holds is deliverable
  // loop integrity (lock.mjs): the game is checked against what was promised at the lock
  SPEC_CHANGED:'spec-changed',      // a locked spec file was edited after the lock: it was put back
  STATE_CHANGED:'state-changed',    // the state file was not what the loop last saved (heldStore): written again from memory
  LOCK_CHANGED:'lock-changed',      // the lock in the state file is not the one the host held in memory: the host's stands
  PROMISES_SHRUNK:'promises-shrunk',// the game stopped making a promise it made at the lock: the promise is still checked
  NO_REPAIR:'no-repair',            // a repair round changed the spec and no file of the game: it repaired nothing
  BRIEF_CHANGED:'brief-changed',    // the play-tester's brief was edited after the loop wrote it: the round is handed over again
};

/**
 * End a run as cancelled (a change request that was started and rolled back, a person who gave up): status
 * 'cancelled', step 'done', outcome 'cancelled', so a stop guard that reads `status` lets the session go. Pure on the
 * state it is given; the loop saves it. A run that already ended (delivered, failed, waiting on a question) is left
 * as it is. → true when the state changed.
 */
export function cancelState(state,reason='cancelled by the host',at=new Date().toISOString()){
  if(state.step==='done'||state.status!=='building')return false;
  state.status='cancelled';state.outcome='cancelled';state.step='done';state.why=reason;state.handed=null;state.updated=at;
  state.history=[...(state.history??[]),{step:'cancel',next:'done',why:reason,at}].slice(-60);
  return true;
}

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
  if(state.status==='cancelled')return {ok:false,code:REFUSALS.CANCELLED,next:'done',why:'this run was cancelled'};
  const p=proofOf(state,hashNow);
  if(p.verify==='none')return {ok:false,code:REFUSALS.NO_VERIFY,next:'verify',why:'no verify has run on this game'};
  if(p.verify==='stale')return {ok:false,code:REFUSALS.STALE_VERIFY,next:'verify',why:`the game's files changed after verify ${state.verify.n} (stale proof): verify again`};
  if(!state.verify.ok)return {ok:false,code:REFUSALS.VERIFY_FAILED,next:'repair',why:`verify ${state.verify.n} failed`};
  if(p.playtest==='stale')return {ok:false,code:REFUSALS.STALE_PLAYTEST,next:'playtest',why:`the game's files changed after play-test round ${state.playtest.round} (stale proof): play-test again`};
  return {ok:true,proof:p};
}
