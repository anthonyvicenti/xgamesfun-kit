// The loop's reading of a verify verdict (lifted from the Studio worker's lib/v2.mjs, open builder M2-F).
// verify writes verdict.json (gf-three-verify/1: {pass, checks: [{n, name, ok: true | false | null, detail, rule, fix}]});
// the loop reads it defensively, decides "playable", and keeps each failed check's rule and fix for the repair message.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);

export const MAX_REPAIRS=2;                        // repair rounds per build or change, verify and play-test together
export const RESCUE_ROUNDS=3;                      // more rounds, on the stronger model, while no version is playable
// Playable (creator, 2026-10-07): check 3 (boots to play, the player moves on real keys) passed, and neither 6 (a round
// reaches results and replays) nor 13 (the HUD's controls work) failed.
export const PLAYABLE_CHECKS=['3','6','13'];
/** verify's check 3 (the game boots to play) passed: the version plays, whatever else failed. */
export const boots=v=>(v?.checks??[]).some(c=>c.id==='3'&&c.ok);
export const playable=v=>boots(v)&&!(v?.checks??[]).some(c=>PLAYABLE_CHECKS.includes(c.id)&&!c.ok&&!c.skipped);

const flat=(s,n)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);

/**
 * → {ok, checks: [{id, name, ok, skipped?, detail (400 characters: the ledger's and the build manifest's)}], failed:
 * ['<id> <name>: <detail>'], repair: [{id, name, detail (as verify wrote it), rule, fix}] for each failed check,
 * summary, code}
 */
export function normalizeVerdict(v,{code=null,stdout='',stderr=''}={}){
  const passed=c=>typeof c.ok==='boolean'?c.ok:typeof c.pass==='boolean'?c.pass:/^(pass|ok)/i.test(String(c.status??c.verdict??''));
  const raw=Array.isArray(v?.checks)?v.checks:[];
  const idOf=(c,i)=>String(c.id??c.n??c.number??i+1),nameOf=c=>String(c.name??c.title??c.label??''),detailOf=c=>String(c.detail??c.message??c.why??c.reason??'');
  const skippedOf=c=>!!(c.skipped||c.ok===null||/^skip/i.test(String(c.status??'')));
  const checks=raw.map((c,i)=>({id:idOf(c,i),name:nameOf(c),ok:passed(c),...(skippedOf(c)?{skipped:true}:{}),detail:detailOf(c).replace(/\s+/g,' ').slice(0,400)}));
  const ok=typeof v?.ok==='boolean'?v.ok:typeof v?.pass==='boolean'?v.pass:typeof v?.verdict==='string'?/^(pass|ok)/i.test(v.verdict):v?code===0:false;
  const failed=checks.filter(c=>!c.ok&&!c.skipped).map(c=>`${c.id}${c.name?` ${c.name}`:''}${c.detail?`: ${c.detail}`:''}`);
  // what the repair message carries: the whole detail verify wrote (it cuts at 1800), and the check's rule and fix
  const repair=raw.map((c,i)=>({c,i})).filter(({c})=>!passed(c)&&!skippedOf(c)).map(({c,i})=>({id:idOf(c,i),name:nameOf(c),detail:flat(detailOf(c),1800),
    ...(c.rule?{rule:flat(c.rule,600)}:{}),...(c.fix?{fix:flat(c.fix,600)}:{})}));
  const summary=String(v?.summary??v?.message??(typeof v?.verdict==='string'?v.verdict:'')??'').slice(0,500)||String(stdout).trim().split('\n').at(-1)?.slice(0,500)||'';
  return {ok,checks,failed:failed.length||ok?failed:[`verify ${v?'failed':'wrote no verdict.json'}${stderr?`: ${String(stderr).trim().split('\n').at(-1).slice(0,200)}`:''}`],repair,summary,code};
}

/** Reads <outDir>/verdict.json as verify left it. → the normalized verdict with outDir, or null when there is none. */
export async function readVerdict(outDir){
  try{return {...normalizeVerdict(JSON.parse(await readFile(resolve(outDir,'verdict.json'),'utf8'))),outDir};}catch{return null;}
}

/** Runs the kit's verify (tools.verify: the path of verify.mjs) on a game. Started without a shell. */
export async function runVerify(tools,game,outDir,{quick=false,timeoutMs=20*60000,cwd=process.cwd()}={}){
  await mkdir(outDir,{recursive:true});
  let code=0,stdout='',stderr='';
  try{({stdout,stderr}=await run(process.execPath,[tools.verify,game,'--out',outDir,...(quick?['--quick']:[])],{cwd,timeout:timeoutMs,maxBuffer:64<<20}));}
  catch(e){code=typeof e.code==='number'?e.code:1;stdout=e.stdout??'';stderr=e.stderr??e.message;}
  let verdict=null;try{verdict=JSON.parse(await readFile(resolve(outDir,'verdict.json'),'utf8'));}catch{}
  return {...normalizeVerdict(verdict,{code,stdout,stderr}),outDir};
}
