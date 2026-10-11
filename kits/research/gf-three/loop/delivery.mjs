// The delivery: the agent's out/delivery.json, the loop's own when there is none, the first words when the version is
// not yet the game asked for, and the outcome's name (lifted from the Studio worker's lib/v2.mjs, open builder M2-F).
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

/** out/delivery.json when it has a summary and controls, else null. */
export async function usableDelivery(file){
  try{const d=JSON.parse(await readFile(file,'utf8'));return ['summary','controls'].every(k=>typeof d[k]==='string'&&d[k].trim())?d:null;}catch{return null;}
}
/** The loop's own delivery from the plan, when no agent answer can be used. */
export function planDelivery(spec,list,why){
  const hook=String(spec?.hook??'').trim().replace(/\.$/,'');
  return {summary:`${spec?.title??'Your game'}${hook?`: ${hook}`:''}. ${why}`.trim().slice(0,2000),controls:String(list?.controls?.hud||'WASD move · mouse look').slice(0,500)};
}
/**
 * out/delivery.json as a delivery needs it: the agent's, else its latest earlier answer (a host may keep each as
 * delivery.json.round-N), else the loop's own from the plan. → true when the loop wrote it.
 */
export async function ensureDelivery(out,{spec,promises,why=''}){
  const file=resolve(out,'delivery.json');
  if(await usableDelivery(file))return false;
  const rounds=(await readdir(out).catch(()=>[])).map(f=>/^delivery\.json\.round-(\d+)$/.exec(f)).filter(Boolean).sort((a,b)=>b[1]-a[1]);
  for(const m of rounds){const d=await usableDelivery(resolve(out,m[0]));if(d){await writeFile(file,JSON.stringify(d,null,2)+'\n');return false;}}
  await writeFile(file,JSON.stringify(planDelivery(spec,promises,why),null,2)+'\n');
  return true;
}

/**
 * The delivery's first words when the version is not yet the game the creator asked for (gf-scenic wave 1; the
 * roguelike miss: the play-tester failed the build twice, and the delivery said so in the middle of a long paragraph).
 * `failures`: plain-words parts, the play-tester's first. → "Not yet the game you asked for: …." or ''.
 */
export const NOT_YET='Not yet the game you asked for:';
export function truthFirst(failures){
  const parts=failures.filter(Boolean).map(p=>String(p).replace(/\.$/,''));
  return parts.length?`${NOT_YET} ${parts.join('; ')}.`:'';
}

/**
 * The name of what happened to a version that is handed over. What counts as delivered is unchanged from the worker's
 * rule (creator, 2026-10-07), with one refusal added by M2-F: a version whose verify or play-test is older than the
 * last change to its files is never plain "delivered".
 *   fallback: null | {used: 'verified' | 'playable' | 'starter'}    issues: a core promise failed or a blocker stands
 *   stale: the codes proofOf() found ([] when every proof on record is about the files as they are)
 */
export function outcomeOf({verdictOk,fallback=null,issues=false,stale=[]}){
  return fallback?.used==='starter'?'delivered-starter':!verdictOk?'delivered-unverified':issues?'delivered-with-issues':stale.length?'delivered-stale-proof':'delivered';
}

/** The promises settled from verify's checks and the play-tester's answers (an answer not re-checked after a fix counts
 *  as untested). → the settled list, or null without the kit's promise logic or a list. */
export function settlePromises(lib,list,verdict,pt){
  if(!lib||!list)return null;
  return lib.settle(list.promises,{verifyChecks:verdict.checks,play:pt?.answers?[...pt.answers.values()].map(a=>pt.stale.has(a.id)?{...a,pass:null}:a):[]});
}
/**
 * The delivery rule (creator, 2026-10-07): the version is delivered, and what the latest play-test still could not
 * see, or a blocker it still hit, is named ('delivered-with-issues'). → {issues, coreFailed, blockers}
 */
export function issuesOf(pt,settled){
  const coreFailed=(settled??[]).filter(p=>p.core&&p.status==='failed');
  const blockers=pt&&!pt.skipped&&!pt.error?(pt.feel??[]).filter(f=>f.severity==='blocker'):[];
  return {issues:!!(pt&&!pt.skipped&&!pt.stub&&!pt.error&&(coreFailed.length||blockers.length)),coreFailed,blockers};
}
