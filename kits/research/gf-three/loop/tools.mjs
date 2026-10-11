// The kit's scripts as the loop calls them (open builder M2-F). Each is a plain function a host may replace (a test
// passes fakes). Nothing here starts a shell or an agent: scripts run with process.execPath, modules are imported.
import {writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVerify} from './verdict.mjs';
import {filesHash} from './state.mjs';

const run=promisify(execFile);
/** The kit this copy of the loop sits in (research/gf-three, or the kit snapshot's copy of it). */
export const OWN_KIT=fileURLToPath(new URL('../',import.meta.url));
const load=file=>import(pathToFileURL(file).href);

/** The agent's own last verify, read by the kit's tools/lib/own-verify.mjs. → {ok, why, …}, or null when the kit has none. */
export async function ownVerifyOf(game,kit=OWN_KIT){
  const lib=resolve(kit,'tools/lib/own-verify.mjs');
  if(!existsSync(lib))return null;
  try{return await (await load(lib)).ownVerify(game);}catch{return null;}
}

/** The promise logic: the kit's own (tools/lib/promises.mjs) when it has one, else this copy's. */
export async function promisesLib(kit=OWN_KIT){
  const own=resolve(kit,'tools/lib/promises.mjs');
  return load(existsSync(own)?own:resolve(OWN_KIT,'tools/lib/promises.mjs'));
}
/** Derives <job>/promises.json from game/config/game.json and spec.json. → the list, or null when it can't. */
export async function writePromises(job,{kit=OWN_KIT,log}={}){
  try{
    const lib=await promisesLib(kit);
    const list=await lib.promisesFor(resolve(job,'game'),{spec:resolve(job,'spec.json')});
    await writeFile(resolve(job,'promises.json'),JSON.stringify(list,null,2)+'\n');
    return list;
  }catch(e){log?.(`  no promise list: ${String(e.message).split('\n')[0].slice(0,200)}`);return null;}
}

/**
 * tools/fix.mjs after an agent round: the mistakes with exactly one mechanical answer, repaired, each one noted.
 * No verdict is passed: after an agent round the last verdict is about older files, so the one fix that needs a
 * verdict (dead-controls) is left to the next verify. → {repairs: [{fix, file, pointer, before, after, why, line}],
 * reported, skipped, written} | null when the kit has no fix tool or it could not run (the loop goes on either way).
 */
export async function fixGame(game,{kit=OWN_KIT,log}={}){
  const tool=resolve(kit,'tools/fix.mjs');
  if(!existsSync(tool))return null;
  try{
    const [{fixGame:fix},{repairLine}]=await Promise.all([load(tool),load(resolve(kit,'tools/lib/fix-lib.mjs'))]);
    const r=await fix(game,{apply:true});
    return {...r,repairs:r.repairs.map(x=>({...x,line:repairLine(x)}))};
  }catch(e){log?.(`  fix.mjs could not run (${String(e.message).split('\n')[0].slice(0,160)}); nothing was repaired`);return null;}
}

/**
 * tools/create.mjs: the runnable project from the locked spec. One retry (a create that fails twice is the plan's).
 * → {ok: true} | {ok: false, why (the tool's last lines)}
 */
export async function createGame(specFile,game,{kit=OWN_KIT,cwd=process.cwd(),log,tries=2}={}){
  const tool=resolve(kit,'tools/create.mjs');
  for(let n=1;;n++){
    try{await run(process.execPath,[tool,specFile,game],{cwd,timeout:10*60000,maxBuffer:32<<20});return {ok:true};}
    catch(e){
      const why=`${e.stderr??''}\n${e.stdout??''}`.trim().split('\n').filter(Boolean).slice(-3).join(' ')||e.message;log?.(`  create failed (try ${n}): ${why}`);
      if(n>=tries)return {ok:false,why};
      await rm(game,{recursive:true,force:true});
    }
  }
}

/** Serves a game folder for a play-tester on this machine (the kit's tools/serve.mjs). → {url, close} | null */
export async function serveGame(game,{kit=OWN_KIT}={}){
  const tool=resolve(kit,'tools/serve.mjs');
  if(!existsSync(tool))return null;
  const {serve}=await load(tool);
  return serve(game,{port:0});
}

/** Every tool of one kit, bound: what createBuildLoop takes as `tools` when the host has nothing of its own to add. */
export function kitTools({kit=OWN_KIT,cwd=process.cwd(),log}={}){
  const verifyTool={verify:resolve(kit,'tools/verify.mjs')};
  return {
    verify:(game,outDir,opts={})=>runVerify(verifyTool,game,outDir,{cwd,...opts}),
    fix:game=>fixGame(game,{kit,log}),
    hash:game=>filesHash(game),
    ownVerify:game=>ownVerifyOf(game,kit),
    promises:job=>writePromises(job,{kit,log}),
    promisesLib:()=>promisesLib(kit),
    serve:game=>serveGame(game,{kit}),
    create:(specFile,game)=>createGame(specFile,game,{kit,cwd,log}),
  };
}
