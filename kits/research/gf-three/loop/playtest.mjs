// The play-tester's part of the loop (lifted from the Studio worker's lib/v2.mjs, open builder M2-F).
// Creator decision 2026-10-06 (research/foundations/evidence/studio-v2-build-method-decision-2026-10-06.json): every
// build gets a fresh play-tester after verify passes. It plays black box (research/gf-three/tools/play.mjs) and judges
// from its own screen; what it can't see happen fails, and comes back to the build agent as a repair round.
// The library never starts the play-tester: the host passes `run` (Studio: its executor; a person's session: a subagent).
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const PLAYTEST_OUTPUTS=['playtest.json','failure.txt'];
export const PLAYTEST_TIMEOUT_MIN=30;              // the wait for one play-test (it plays for about 6 minutes)
const SEVERITIES=['blocker','major','minor'];
const same=s=>s;
export const fill=(text,values)=>text.replace(/\{\{([A-Z_0-9]+)\}\}/g,(m,k)=>k in values?String(values[k]):m);

/**
 * The words in the play-tester's brief that assume a shell, as placeholders a host fills (P.PLAY_HOW, P.PLAY_STEPS_AT,
 * P.RUN_NODE). Without them they are the worker's exact words: the play.mjs command, where its step list is, and the
 * Node line. A host whose agent plays through a tool names the tool in PLAY_HOW and PLAY_STEPS_AT, and sets RUN_NODE to ''.
 */
export const playWords=(P,game)=>({
  PLAY_HOW:P.PLAY_HOW??`\`\`\`\nnode ${P.KIT_TOOLS}/play.mjs ${game} --script ${P.DIR}/scratch/<name>.json --out ${P.DIR}/runs/<name>\n\`\`\``,
  PLAY_STEPS_AT:P.PLAY_STEPS_AT??`The step list in full is at the top of \`${P.KIT_TOOLS}/lib/play-script.mjs\`.`,
  RUN_NODE:P.RUN_NODE??'Run node through Node 24.19.0 (`source ~/.nvm/nvm.sh && nvm use 24.19.0`). ',
});

/**
 * The play-tester's folder: PLAYTEST.md (prompts/playtest.md, filled) and promises.json. What it sees is the title, the
 * hook, the HUD line and the promises it proves (`play`, from playPromises), never the game's code or config.
 * `game` is the URL (or folder) it plays; P = {DIR, KIT_TOOLS} as the agent sees them; `focus` (a re-test) lists the
 * only promise ids to check again, `blockersBefore` the blockers to re-judge. `prompts`: the folder of playtest.md.
 */
export async function writePlaytestBrief({dir,list,play,game,P,round=1,focus=null,blockersBefore=[],prompts}){
  const md=s=>String(s??'').replace(/[`|\r\n]+/g,' ').trim().slice(0,600);
  await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,'promises.json'),JSON.stringify({title:list.title,hook:list.hook,hud:list.controls.hud,
    promises:play.map(({id,text,core,kind,key,hud})=>({id,text,core,kind,...(key?{key,hud}:{})})),notPromised:list.notPromised,...(focus?{retest:focus}:{})},null,2)+'\n');
  const textOf=id=>md(play.find(p=>p.id===id)?.text??id);
  const roundNote=focus?`**This is a re-test (round ${round}).** The build agent changed the game to fix what you found. Re-test **only** these promises, and report only them (the others keep their earlier results; your earlier report is \`out/playtest.json.round-${round-1}\`):\n\n${focus.map(id=>`- \`${id}\`: ${textOf(id)}`).join('\n')||'- (none)'}${blockersBefore.length?`\n\nAlso say in \`feel\` whether these blockers are still there (list one again only if it is):\n\n${blockersBefore.map(b=>`- ${md(b.issue)}`).join('\n')}`:''}`:'';
  // a forge game (the promise list says so: tools/lib/promises.mjs) is first person: its tester gets prompts/playtest-forge.md
  await writeFile(resolve(dir,'PLAYTEST.md'),fill(await readFile(resolve(prompts,list.engine==='forge'?'playtest-forge.md':'playtest.md'),'utf8'),{...playWords(P,game),DIR:P.DIR,GAME:game,KIT_TOOLS:P.KIT_TOOLS,TITLE:md(list.title)||'(untitled)',HOOK:md(list.hook)||'(none)',HUD:md(list.controls.hud),
    CONTROLS:list.controls.list.map(c=>`| ${md(c.keys)}: ${md(c.does)} | \`${c.key}\` |`).join('\n')||'| (no controls listed) | |',
    PROMISES:play.map(p=>`- \`${p.id}\`${p.core?' (core)':''}: ${md(p.text)}`).join('\n')||'- (none)',
    NOT_PROMISED:list.notPromised.length?list.notPromised.map(md).join('; '):'nothing listed',ROUND_NOTE:roundNote}));
}

/** What the play-tester was handed, as one hash (PLAYTEST.md and its promises.json): a brief changed after the loop
 *  wrote it is not the loop's brief (state.mjs REFUSALS.BRIEF_CHANGED). → 64 hex, or null when there is no brief. */
export async function briefHash(dir){
  try{return createHash('sha256').update(await readFile(resolve(dir,'PLAYTEST.md'))).update('\0').update(await readFile(resolve(dir,'promises.json'))).digest('hex');}catch{return null;}
}

/** The play-tester's out/playtest.json, checked. `asked`: the promise ids it was asked about this round. The verdict is
 *  the loop's own: fail when an asked promise failed or a feel issue is a blocker (whatever the report claims). */
export function readPlaytestReport(raw,asked=[]){
  let r=raw;
  if(typeof r==='string'){try{r=JSON.parse(r);}catch(e){return {errors:[`playtest.json is not JSON (${e.message.slice(0,120)})`]};}}
  if(!r||typeof r!=='object'||Array.isArray(r))return {errors:['playtest.json is not an object']};
  if(!Array.isArray(r.promises))return {errors:['playtest.json has no "promises" list']};
  const strs=v=>(Array.isArray(v)?v:typeof v==='string'?[v]:[]).filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,300));
  const known=new Set(asked);
  const all=r.promises.filter(p=>p&&typeof p.id==='string').map(p=>({id:p.id.slice(0,60),pass:typeof p.pass==='boolean'?p.pass:null,evidence:strs(p.evidence),note:String(p.note??'').slice(0,600)}));
  const promises=all.filter(p=>known.has(p.id));
  const feel=(Array.isArray(r.feel)?r.feel:[]).filter(f=>f&&typeof f.issue==='string').slice(0,20).map(f=>({issue:f.issue.slice(0,600),severity:SEVERITIES.includes(f.severity)?f.severity:'minor',evidence:strs(f.evidence)}));
  const failed=promises.filter(p=>p.pass===false).map(p=>p.id),blockers=feel.filter(f=>f.severity==='blocker');
  return {verdict:failed.length||blockers.length?'fail':'pass',claimed:['pass','fail'].includes(r.verdict)?r.verdict:null,stub:r.stub===true,
    promises,feel,failed,blockers:blockers.length,summary:String(r.summary??'').slice(0,1500),
    unknown:all.filter(p=>!known.has(p.id)).map(p=>p.id),missing:asked.filter(id=>!promises.some(p=>p.id===id)),errors:[]};
}

/** A promise in a few words, for the delivery summary and the creator's failure message. */
export function promiseWords(p){
  if(p.kind==='control')return `“${p.hud}”`;
  if(p.kind==='mechanic')return p.text.replace(/^I can see this working when I play: /,'').replace(/\.$/,'');
  if(p.kind==='loop')return 'the core loop (what you do in your first minute)';
  if(p.kind==='score')return 'your score changing the way the rules say';
  if(p.kind==='hook')return 'what the title card promises';
  return p.text.replace(/\.$/,'');
}
const listWords=(ps,max=6)=>`${ps.slice(0,max).map(promiseWords).join('; ')}${ps.length>max?` and ${ps.length-max} more`:''}`;

/** The line the delivery summary gains from the play-test that is not a failure: what it did not check, or that none
 *  ran. What it could not see is playtestFailure's, and leads the summary (truthFirst). */
export function playtestNote(pt,settled){
  if(!pt||pt.skipped)return pt?.skipped?`No play-tester checked this version (${pt.skipped}).`:'';
  if(pt.stub)return 'No play-tester checked this version (a pipeline test with no agent).';
  const play=(settled??[]).filter(p=>p.proofs?.includes('play'));
  if(pt.error&&!pt.rounds.some(r=>r.verdict==='pass'||r.verdict==='fail'))return `The play-tester could not play this version (${pt.error.slice(0,160)}), so what it promises is not checked yet.`;
  const untested=play.filter(p=>p.status==='untested');
  return untested.length?`Not checked by the play-tester: ${listWords(untested,4)}.`:'';
}
/** What the play-tester saw fail, in a few plain words (null when nothing did): the promises it could not see work and
 *  its blockers (and its majors when a core promise failed). */
export function playtestFailure(pt,settled,{scrub=same}={}){
  if(!pt||pt.skipped||pt.stub)return null;
  if(pt.error&&!pt.rounds.some(r=>r.verdict==='pass'||r.verdict==='fail'))return null;
  const failed=(settled??[]).filter(p=>p.proofs?.includes('play')&&p.status==='failed');
  const serious=(pt.feel??[]).filter(f=>f.severity==='blocker'||(f.severity==='major'&&failed.some(p=>p.core)));
  const parts=[];
  if(failed.length)parts.push(`a play-tester could not see these work on its own screen: ${listWords(failed)}`);
  if(serious.length)parts.push(`${failed.length?'it also reported':'a play-tester reported'}: ${serious.slice(0,2).map(f=>scrub(f.issue).replace(/\.$/,'')).join('; ')}`);
  return parts.length?parts.join('; '):null;
}

/** The ledger's (and the build manifest's) record of the play-test rounds. */
export function playtestRecord(pt,{model=null}={}){
  return {verdict:pt.stub?'stub':pt.verdict,rounds:pt.rounds,failed:pt.failedIds,...(pt.stale?.size?{notRechecked:[...pt.stale]}:{}),
    blockers:(pt.feel??[]).filter(f=>f.severity==='blocker').map(f=>f.issue),majors:(pt.feel??[]).filter(f=>f.severity==='major').map(f=>f.issue),
    minors:(pt.feel??[]).filter(f=>f.severity==='minor').length,summary:pt.summary||null,...(pt.error?{error:pt.error}:{}),requestedModel:model};
}

/** The play-test as the state file keeps it (a Map and a Set become lists), and back. `list` is read again on resume. */
export const packPlaytest=pt=>!pt?null:pt.skipped?{skipped:pt.skipped}:{rounds:pt.rounds,answers:[...pt.answers.values()],feel:pt.feel,summary:pt.summary,stale:[...pt.stale],failedIds:pt.failedIds,
  error:pt.error??null,ok:!!pt.ok,verdict:pt.verdict??null,...(pt.stub?{stub:true}:{})};
export const unpackPlaytest=(m,list=null)=>!m?null:m.skipped?{skipped:m.skipped}:{rounds:m.rounds??[],answers:new Map((m.answers??[]).map(a=>[a.id,a])),feel:m.feel??[],summary:m.summary??'',stale:new Set(m.stale??[]),
  failedIds:m.failedIds??[],error:m.error??null,ok:!!m.ok,verdict:m.verdict??null,...(m.stub?{stub:true}:{}),...(list?{list}:{})};

/**
 * One play-test round, in two halves so a tool can hand the round to a session and stop between them.
 * The first round plays everything; a re-test only what failed, and re-judges the blockers.
 *
 *   h = {dir (the play-tester's folder), P: {DIR, KIT_TOOLS} as the tester sees them, prompts (folder of playtest.md),
 *        promises() → the promise list written again | null, promisesLib() → the kit's promise logic | null,
 *        serveGame() → {url, close} | null, gameRef (what the tester is given when the game is not served),
 *        clock: {now()}, log, scrub}
 *
 * beginPlaytest(prev, h) → {pt, done: true} when it could not start, else {pt, n, focus, message, srv, t0, retest, brief (briefHash)}
 * finishPlaytest(round, {error}, h) → pt: {rounds, answers: Map, feel, summary, stale: Set, failedIds, list, error, ok, verdict}
 */
export async function beginPlaytest(prev,h){
  const n=(prev?.rounds.length??0)+1,dir=h.dir;
  for(const d of ['out','scratch','runs'])await mkdir(resolve(dir,d),{recursive:true});
  const pt=prev??{rounds:[],answers:new Map(),feel:[],summary:'',stale:new Set(),failedIds:[]};
  pt.error=null;
  const list=await h.promises();          // again: the agent may have changed the HUD or the hook
  const lib=list?await h.promisesLib().catch(()=>null):null;
  if(!list||!lib){pt.error='no promise list';pt.rounds.push({round:n,verdict:'error',error:pt.error});pt.verdict=pt.rounds.some(r=>r.verdict!=='error')?pt.verdict:'error';pt.ok=false;return {pt,done:true};}
  pt.list=list;
  const play=lib.playPromises(list),playIds=new Set(play.map(p=>p.id));
  for(const id of [...pt.answers.keys()])if(!playIds.has(id))pt.answers.delete(id);   // a promise the game no longer makes
  const focus=prev?pt.failedIds.filter(id=>playIds.has(id)):play.map(p=>p.id);
  const blockersBefore=prev?(pt.feel??[]).filter(f=>f.severity==='blocker'):[];
  // The game: served by the host for a play-tester on this machine (it gets a URL, never the folder); else h.gameRef.
  let srv=null,game=h.gameRef;
  try{srv=await h.serveGame?.()??null;if(srv?.url)game=srv.url;}
  catch(e){h.log?.(`  could not serve the game for the play-tester (${e.message}); it gets the folder`);}
  await writePlaytestBrief({dir,list,play,game,P:h.P,round:n,focus:prev?focus:null,blockersBefore,prompts:h.prompts});
  const message=prev?`Round ${n}: a re-test. Read ${h.P.DIR}/PLAYTEST.md (the re-test note at the top lists the only promises to check) and play the game it describes. Work only inside ${h.P.DIR}.`
    :`Read ${h.P.DIR}/PLAYTEST.md and play the game it describes, as a new player. Work only inside ${h.P.DIR}.`;
  return {pt,n,focus,message,srv,t0:h.clock.now(),retest:!!prev,brief:await briefHash(dir)};
}

export async function finishPlaytest({pt,n,focus,t0,retest},{error=null}={},h){
  const dir=h.dir,scrub=h.scrub??same;
  let report=null;
  const failure=resolve(dir,'out/failure.txt');
  if(!error&&existsSync(failure))error=`the play-tester could not play: ${scrub((await readFile(failure,'utf8')).trim()).slice(0,300)}`;
  if(!error){
    let text=null;try{text=await readFile(resolve(dir,'out/playtest.json'),'utf8');}catch{error='the play-tester wrote no out/playtest.json';}
    if(text!=null){report=readPlaytestReport(text,focus);if(report.errors.length)error=report.errors.join('; ');}
  }
  const minutes=+((h.clock.now()-t0)/60000).toFixed(1);
  if(error){
    pt.error=error;
    if(retest)for(const id of focus)pt.stale.add(id);        // not re-checked after the fix: not proven, but not confirmed failed
    pt.rounds.push({round:n,verdict:'error',error,asked:focus.length,minutes});
  }else{
    for(const a of report.promises){pt.answers.set(a.id,{...a,round:n});pt.stale.delete(a.id);}
    for(const id of focus)if(!report.promises.some(a=>a.id===id))pt.answers.delete(id);   // asked, not answered: untested
    pt.feel=retest?[...pt.feel.filter(f=>f.severity!=='blocker'),...report.feel]:report.feel;   // a re-test re-judges the blockers
    pt.summary=report.summary||pt.summary;if(report.stub)pt.stub=true;
    pt.rounds.push({round:n,verdict:report.verdict,asked:focus.length,failed:report.failed,blockers:report.blockers,untested:focus.length-report.promises.filter(p=>p.pass!==null).length,minutes,
      ...(report.claimed&&report.claimed!==report.verdict?{claimed:report.claimed}:{}),...(report.unknown.length?{unknown:report.unknown.slice(0,10)}:{})});
  }
  pt.failedIds=[...pt.answers.values()].filter(a=>a.pass===false&&!pt.stale.has(a.id)).map(a=>a.id);
  const blockers=error?[]:(pt.feel??[]).filter(f=>f.severity==='blocker');
  pt.ok=!error&&!pt.failedIds.length&&!blockers.length;
  pt.verdict=pt.rounds.every(r=>r.verdict==='error')?'error':pt.ok?'pass':error?'unconfirmed':'fail';
  h.log?.(`  playtest ${n}: ${error?`could not run (${error})`:`${report.verdict}${report.failed.length?` (failed: ${report.failed.join(', ')})`:''}${report.blockers?`, ${report.blockers} blocker(s)`:''}`}`);
  return pt;
}
