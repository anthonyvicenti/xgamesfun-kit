// The locked spec is locked (open builder, loop integrity, 2026-10-11). Home: invariant, as a refusal.
//
// A delivered game is checked against what was promised at the lock, never against a spec the builder edited
// afterwards (the repo's rule 2, honest status). On 2026-10-11 a session building through the loop's tools took a
// failing control out of the locked spec, twice: once so verify's check 13 stopped looking for it, once so the
// play-tester was no longer asked about it. The loop held its order and delivered.
//
// What is locked: the spec file the host names (the worker's <job>/spec.json) and the copy `create` leaves in the game
// (<game>/spec.json, which verify reads), byte for byte, and the promises the game makes at that moment. The lock is
// taken at the end of the create step for a build, and when the change round is over for a change (that round is
// where a change may alter the plan). It is kept in the loop's state, text and all, so the files can be put back.
//
// What a library can and cannot do is in README.md ("The locked spec"): when the state file is inside the game's
// folder the builder can write it too, so the host must hand back the lock it holds in memory (`host.locked`).
//
// The economy (K3, economy.mjs): when the locked spec references one (`"economy": {"in": "gamesfun.json"}`), the lock
// also holds the economy as it was agreed (`lock.economy`: {file, sha, text}). It is role 'economy' below: an edit is
// put back and refused like an edit to the spec; what going live writes into gamesfun.json is neither compared nor put
// back. A lock with no `economy` (every spec without one) is checked exactly as before.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {economyProblem,restoreEconomy} from './economy.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const read=async file=>{try{return await readFile(file,'utf8');}catch{return null;}};

/** A spec's text as one side of a lock: what a host keeps in memory from the moment it locks the spec, before create. */
export const specLock=text=>({at:null,when:'host',spec:{sha:sha(String(text)),text:String(text)},game:null,promises:null});

/** Where the two locked files are. `specFile`: the host's own, else <job>/spec.json. */
export const lockFiles=({job,game,specFile=null})=>({spec:specFile?resolve(specFile):job?resolve(job,'spec.json'):null,game:game?resolve(game,'spec.json'):null});

/** Take the lock from the files as they are now. `promises`: the promises the game makes now (the floor), or null. */
export async function takeLock(files,{when='create',at=null,promises=null}={}){
  const one=async file=>{const text=file?await read(file):null;return text==null?null:{sha:sha(text),text};};
  return {at,when,spec:await one(files.spec),game:await one(files.game),promises};
}

/**
 * The locked files against the disk. → [{role: 'spec' | 'game' | 'economy', file, how: 'edited' | 'missing'}] ([] when
 * they hold). Reads only: a stop guard can call it with the lock from the state file.
 */
export async function lockProblems(lock,files){
  const out=[];
  for(const role of ['spec','game']){
    const want=lock?.[role],file=files[role];
    if(!want||!file)continue;
    const text=await read(file);
    if(text==null)out.push({role,file,how:'missing'});
    else if(sha(text)!==want.sha)out.push({role,file,how:'edited'});
  }
  // the economy the spec references, in the game's folder (beside the game's copy of the spec)
  if(lock?.economy&&files.game){
    const game=dirname(files.game),how=await economyProblem(game,lock.economy);
    if(how)out.push({role:'economy',file:resolve(game,lock.economy.file),how});
  }
  return out;
}

/** Put the locked files back as they were locked. → the problems it could not undo ([] when the disk holds again). */
export async function restoreLock(lock,files,problems){
  for(const p of problems){
    if(p.role==='economy'){await restoreEconomy(dirname(p.file),lock.economy);continue;}
    const text=lock[p.role]?.text;
    if(typeof text!=='string')continue;
    await mkdir(dirname(p.file),{recursive:true});
    await writeFile(p.file,text);
  }
  return lockProblems(lock,files);
}

/** Do two locks name the same spec and the same promises? (The state's against the one the host held in memory.) */
export function sameLock(a,b){
  const ids=l=>(l?.promises??[]).map(p=>p.id).join('\n');
  return (a?.spec?.sha??null)===(b?.spec?.sha??null)&&(!a?.game||!b?.game||a.game.sha===b.game.sha)&&(!a?.promises||!b?.promises||ids(a)===ids(b))&&(!a?.economy||!b?.economy||a.economy.sha===b.economy.sha);
}

/**
 * The promise list is never shorter than at the lock: a promise the game made then and no longer lists is put back,
 * as it was worded then. `list` is changed in place. → the ids put back ([] when none was missing).
 */
export function holdPromises(list,floor){
  if(!list||!Array.isArray(list.promises)||!floor?.length)return [];
  const have=new Set(list.promises.map(p=>p.id)),back=floor.filter(p=>!have.has(p.id));
  for(const p of back){
    list.promises.push(structuredClone(p));
    // a control the HUD stopped listing is still in the play-tester's table of keys
    if(p.kind==='control'&&p.key&&Array.isArray(list.controls?.list)&&!list.controls.list.some(c=>c.action===p.action))
      list.controls.list.push({action:p.action,keys:p.keys,key:p.key,does:String(p.hud??'').replace(/^[^:]*:\s*/,'')});
  }
  return back.map(p=>p.id);
}
