// The build loop, once (open builder M2-F): create → agent round → fix → verify → play-test → repair → deliver.
// Lifted from the Studio worker's handleV2 (research/foundations/studio-worker/lib/v2.mjs), which is now a caller:
// it brings the queue, the uploads and the accounts; the order, the limits and what counts as proof are here.
//
// Each step is a function that returns the next step and why, and the state is saved after every one, so a tool can
// run one step and stop, and a run that was killed resumes at the step it was on. The library never starts an agent:
// the host passes the runner (`agent`, `playtester`). With no runner a round is handed over: the step returns
// {waiting, message}, and the next call to step() takes the round as done. README.md has the whole interface.
import {readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {MAX_REPAIRS,RESCUE_ROUNDS,playable,readVerdict} from './verdict.mjs';
import {STATE_SCHEMA,REFUSALS,stateFileOf,fileStore,proofOf,ignoreStateDir,inside,cancelState} from './state.mjs';
import {createRepairLedger} from './repair-ledger.mjs';
import {beginPlaytest,finishPlaytest,packPlaytest,unpackPlaytest,briefHash,PLAYTEST_TIMEOUT_MIN} from './playtest.mjs';
import {lockFiles,takeLock,lockProblems,restoreLock,sameLock,holdPromises} from './lock.mjs';
import {usableDelivery,ensureDelivery,outcomeOf,issuesOf,settlePromises,proofLead,truthFirst} from './delivery.mjs';
import * as words from './messages.mjs';
import {kitTools} from './tools.mjs';
import {PROMPTS_DIR} from './brief.mjs';
import {specEconomy,economyLock,economyAtDelivery} from './economy.mjs';
import {specBackend,backendAtDelivery} from './backend.mjs';

export const STEPS=['create','agent','fix','verify','playtest','repair','deliver','done'];
const SAY={verify:'repairing',play:'playRepairing',rescue:'rescuing'};
const same=s=>s;

/**
 * Open the build loop of one game (a new run, or the one its state file says was under way).
 *
 * host:
 *   job, game            folders (job holds game/, out/, spec.json, promises.json, playtest/); getters are read at use
 *   kind                 'build' | 'change'
 *   session              an opaque string kept in the state as `session` (a tools host: the id of the session that is building, so a stop guard holds that session only)
 *   paths                as the agent sees them: {JOB, KIT_TOOLS, PLAYTEST}, and for a host with another layout
 *                        {GAME, OUT, DELIVERY, QUESTIONS, SPEC} (messages.mjs has the defaults: the worker's)
 *   playWords            {PLAY_HOW, PLAY_STEPS_AT, RUN_NODE, REPORT_HOW}: the play-tester brief's shell-only words (prompts/playtest.md), as a tools host words them
 *   toolNames            {verify, quick, play, catalog}: the host's own tools, named in the agent's messages instead of a shell command
 *   firstMessage         the first agent round's message
 *   specFile             the locked spec's file (default <job>/spec.json): with no hooks.prepare, the create step runs
 *                        tools.create(specFile, game). It and <game>/spec.json are locked (lock.mjs): an edit is put back and refused
 *   locked               the lock as the host process holds it in memory: specLock(text) from the moment it locked the
 *                        spec, then `loop.lock` after every call. It wins over the lock in the state file, which a
 *                        builder can write when the state is in the game's folder. Ignored while a change run has no lock yet
 *   spec, promises       for the loop's own delivery when the agent leaves none (getters)
 *   flags                {stub, advisory, playtest, resumed}: stub never repairs; advisory records a failed verify
 *                        without gating; playtest false turns the play-tester off; resumed skips the first agent round
 *   limits               {maxRepairs, rescueRounds, rescueModel, playtestModel}
 *   store                the state store ({load, save}); default: a file in the game's folder (.gf-loop/state.json). A host
 *                        whose builder can write that file passes heldStore(file), one per game, kept while the process lives
 *   tools                {verify, fix, hash, ownVerify, promises, promisesLib, serve}; default: kitTools({kit})
 *   versions             {keep(name), restore(name), has(name)}: 'verified' (the last version that passed verify) and
 *                        'created' (the kit's starting game); default: none kept
 *   agent(o)             the runner: o = {kind: 'build' | 'reminder' | 'repair', repair?, message, model, round}. It
 *                        returns when the round is over (a failed session is the host's to swallow or throw). Absent: handed over
 *   playtester(o)        the play-tester's runner: o = {dir, message, round, model, timeoutMinutes}; throws when it could not run
 *   signal               an AbortSignal: aborting it stops a running verify and the browser it started (the step then throws an AbortError)
 *   clock, log, say(key), note(key, value), checkpoint(), scrub(text), isStop(error)
 *   prompts              the folder of playtest.md (default: research/studio-v2/prompts beside this kit)
 *   serveGame(), gameRef what the play-tester is given: a served URL ({url, close}), else gameRef (default: the folder)
 *   ledgerLine(line)     each finished repair round as one JSON line
 *   resume               false: never pick up an earlier run's state
 *   economy              only in a session with web3 on, for a spec that references an economy (economy.mjs, K3):
 *                        {publish() → the kit's economy_publish answer ({approve: {link, step}, cost} | {ok: false,
 *                        refusals}), status() → the kit's economy_status answer ({live, parts})}. The lock then holds
 *                        the economy as agreed, and delivery hands over the approval link without waiting for it
 *                        (outcome.economy, state.economy). Either function may be missing; nothing here signs
 *   backend              for a spec with a `backend` (backend.mjs, wave 11 track L): {status() → {connected, provider,
 *                        url}} (the kit's backend status). Absent: <game>/backend.json is read. Delivery never waits for
 *                        a connection: outcome.backend (and state.backend) says whether one is connected and, when none
 *                        is, what to connect. The spec's `backend` is locked with the spec; the connection is not
 *   hooks                what only the host can do, each optional:
 *     prepare(loop)        make the game folder (the create step). → {end: outcome} to stop there
 *     settle(loop)         after the first agent round and its fix (or straight after create when resumed), before the
 *                          first verify. → {end: outcome} to stop there
 *     declined(loop)       the agent refused the plan (out/failure.txt, or questions with no game). → the outcome
 *     noDelivery(loop)     the first round left no delivery (throw to end the job; return to let the loop write its own)
 *     afterRepair(loop)    after each repair round, before its fix
 *     ask(loop, {failed})  still not playable after every round. → the outcome, or null to fall through to the starter
 *     starter(loop)        put the kit's starting game in place of the game (versions 'created' is restored first)
 *     deliver(loop)        hand the version over. → the outcome. Absent: the loop's own rule (stale proof sends it back)
 * → {state, mem, lock, next(), step(), run(), hash(), proof(), relock()}
 */
export async function openBuildLoop(host){
  const flags=host.flags??{},hooks=host.hooks??{};
  const lim={maxRepairs:MAX_REPAIRS,rescueRounds:RESCUE_ROUNDS,rescueModel:'opus',playtestModel:'sonnet',...host.limits};
  const clock=host.clock??{now:()=>Date.now()},log=host.log??(()=>{}),say=host.say??(()=>{}),note=host.note??(()=>{}),cp=host.checkpoint??(()=>{}),scrub=host.scrub??same;
  const D={get job(){return host.job;},get game(){return host.game??resolve(host.job,'game');},get out(){return resolve(host.job,'out');}};
  const file={get delivery(){return resolve(D.out,'delivery.json');},get failure(){return resolve(D.out,'failure.txt');},get questions(){return resolve(D.out,'questions.json');}};
  let tools=host.tools??null;
  const T=()=>tools??=kitTools({kit:host.kit,log});
  let store=host.store??null;
  const St=()=>store??=fileStore(stateFileOf(D.game));       // default: in the game's folder
  const versions=host.versions??{keep:async()=>{},restore:async()=>{},has:async()=>false};
  const stamp=()=>new Date(clock.now()).toISOString();

  // host.resume === false: always a new run (Studio's worker starts a reclaimed request over)
  const loaded=host.resume===false?null:await St().load();
  const S=loaded??{schema:STATE_SCHEMA,kind:host.kind??'build',status:'building',step:'create',why:'a new build',phase:null,agent:'build',repair:null,after:null,
    round:0,repairs:0,rescues:0,verifies:0,playtests:0,verify:null,kept:null,playtest:null,pt:null,gaveUp:null,fallback:null,fixes:[],ledger:[],done:{},handed:null,outcome:null,history:[],lock:null,refusals:[],before:null,tampered:false};
  S.refusals??=[];
  if(host.session!=null)S.session=String(host.session);      // opaque: which session is building, for a stop guard that holds exactly that one
  const M={verdict:null,kept:null,pt:null,own:null,fixNotes:[],proof:null,workerDelivery:false,resumedRun:!!loaded};
  const ledger=createRepairLedger({rounds:S.ledger,write:host.ledgerLine??null});
  if(loaded){            // a run that was killed: what the files on disk still say
    if(S.verify)M.verdict={...(await readVerdict(resolve(D.out,`verify-${S.verify.n}`))??{ok:S.verify.ok,checks:[],failed:[],repair:[],summary:''}),hash:S.verify.hash};
    if(S.kept)M.kept=S.kept.n===S.verify?.n?M.verdict:{...(await readVerdict(resolve(D.out,`verify-${S.kept.n}`))??{ok:true,checks:[],failed:[],repair:[],summary:''}),hash:S.kept.hash};
    let list=null;try{list=JSON.parse(await readFile(resolve(D.job,'promises.json'),'utf8'));}catch{}
    holdPromises(list,S.lock?.promises);      // promises.json is on disk: never shorter than at the lock
    M.pt=unpackPlaytest(S.pt,list);
    M.fallback=S.fallback;
  }

  const save=async()=>{S.ledger=ledger.rounds;S.pt=packPlaytest(M.pt);S.updated=stamp();await St().save(S);};
  const go=(next,why)=>({next,why});
  const end=(outcome,why)=>({next:'done',why,outcome});
  const hash=()=>T().hash(D.game);
  const usable=()=>usableDelivery(file.delivery);
  const deliveryOr=why=>ensureDelivery(D.out,{spec:host.spec,promises:host.promises,why});
  const msgOpts=()=>({paths:host.paths,maxRepairs:lim.maxRepairs,rescueRounds:lim.rescueRounds,...(host.who?{who:host.who}:{}),...(host.toolNames?{tools:host.toolNames}:{})});
  // what the loop refused since the agent was last told, said once before the round's own message
  const refusalNotes=()=>{const fresh=S.refusals.filter(r=>!r.told);for(const r of fresh)r.told=true;return words.refusalNote(fresh,msgOpts());};
  const withFixNotes=message=>{const n=words.fixNote(M.fixNotes);M.fixNotes=[];return refusalNotes()+n+message;};

  // ---- the locked spec is locked (lock.mjs) ----
  const refuse=(code,what={})=>{const r={code,step:S.step,at:stamp(),...what,told:false};S.refusals=[...S.refusals,r].slice(-30);note('refused',r);log(`  refused (${code})${what.files?`: ${what.files.join(', ')}`:what.ids?`: ${what.ids.join(', ')}`:''}`);return r;};
  const lockAt=()=>lockFiles({job:D.job,game:D.game,specFile:host.specFile});
  // A store that holds the state in the host's memory (heldStore) says when the file was not what the loop last saved.
  if(loaded&&St().takeChanged?.())refuse(REFUSALS.STATE_CHANGED);
  // The lock the host held in memory wins over the state's (a builder can write a state file that is in the game's folder).
  if(host.locked&&!(S.kind==='change'&&!S.lock)){
    if(S.lock&&!sameLock(S.lock,host.locked))refuse(REFUSALS.LOCK_CHANGED);
    if(!S.lock||!sameLock(S.lock,host.locked))S.lock=structuredClone({...S.lock,...host.locked,game:host.locked.game??S.lock?.game??null,promises:host.locked.promises??S.lock?.promises??null});
    holdPromises(M.pt?.list,S.lock.promises);        // the list a resumed play-test was read with, against the lock that stands
  }
  // The promise list from the game and the spec as they are, never shorter than at the lock.
  const promisesNow=async()=>{
    const list=await T().promises?.(D.job,folders())??null;
    const back=holdPromises(list,S.lock?.promises);
    if(back.length){
      if(!S.refusals.some(r=>r.code===REFUSALS.PROMISES_SHRUNK&&r.ids.join()===back.join()))refuse(REFUSALS.PROMISES_SHRUNK,{ids:back});
      await writeFile(resolve(D.job,'promises.json'),JSON.stringify(list,null,2)+'\n').catch(()=>{});
    }
    return list;
  };
  // Take the lock: the two spec files as they are, and the promises the game makes now. A spec the host locked itself
  // (host.locked, before create) stays the host's.
  const lockNow=async when=>{
    const held=S.lock?.when==='host'?S.lock.spec:null;
    const l=await takeLock(lockAt(),{when,at:stamp()});
    S.lock={...l,spec:held??l.spec,promises:null};
    S.lock.promises=(await T().promises?.(D.job,folders())??null)?.promises??null;
    // the economy the locked spec references, as agreed (K3): only for a spec that has one
    const ref=specEconomy(S.lock.spec?.text);
    if(ref){const e=await economyLock(D.game,ref);if(e)S.lock.economy=e;}
    return S.lock;
  };
  // Every step starts here: a locked spec file that was edited is put back, and the edit is refused.
  // → the files that had changed ([] when the lock holds or there is none yet)
  const guard=async()=>{
    if(!S.lock)return [];
    const files=lockAt(),problems=await lockProblems(S.lock,files);
    if(!problems.length)return [];
    const left=await restoreLock(S.lock,files,problems);
    if(left.length)throw new Error(`the locked spec could not be put back (${left.map(p=>p.file).join(', ')})`);
    refuse(REFUSALS.SPEC_CHANGED,{files:problems.map(p=>p.role)});S.tampered=true;
    return problems;
  };

  // One agent round through the host's runner; with no runner the round is handed over once, and the next call
  // takes it as done. → {waiting, message} when handed over, else null.
  const round=async o=>{
    cp();
    if(host.agent){await host.agent(o);return null;}
    if(S.handed?.step===S.step){S.handed=null;return null;}
    S.handed={step:S.step,kind:o.kind,at:stamp()};
    return {waiting:'agent',kind:o.kind,message:o.message,...(o.model?{model:o.model}:{})};
  };
  const readGaveUp=async label=>{
    if(!existsSync(file.failure))return;
    S.gaveUp=scrub((await readFile(file.failure,'utf8')).trim()).slice(0,300);
    await rm(file.failure,{force:true});log(`  ${label}: ${S.gaveUp}`);note('gaveUp',S.gaveUp);
  };
  const runFix=async()=>{
    const r=await T().fix?.(D.game)??null;
    if(!r)return null;
    if(r.repairs.length){
      for(const x of r.repairs){log(`  ${x.line}`);S.fixes.push({round:S.round+S.repairs,after:S.after,fix:x.fix,file:x.file,pointer:x.pointer??null,line:x.line});}
      M.fixNotes.push(...r.repairs);note('fixes',S.fixes);
    }
    return r;
  };
  const verifyRound=async()=>{
    say('verifying');S.verifies++;const n=S.verifies;
    const before=await hash();
    const v=await T().verify(D.game,resolve(D.out,`verify-${n}`),host.signal?{signal:host.signal}:{});
    const after=await hash();
    v.hash=before===after?after:null;      // files that changed while verify ran are not what it proved
    log(`  verify ${n}: ${v.ok?'pass':'FAIL'}${v.failed.length?` (${v.failed.slice(0,3).join('; ')})`:''}`);
    if(ledger.record({verdict:v}))log(`  the repair loop is going nowhere (${ledger.stop}): no more rounds of this kind`);
    // every version that passes the full verify is kept: the first fallback if a later repair breaks a check
    if(v.ok&&!flags.advisory){await versions.keep('verified');M.kept=v;S.kept={n,hash:v.hash};}
    M.verdict=v;
    S.verify={n,ok:v.ok,playable:playable(v),hash:v.hash,at:stamp(),failed:v.checks.filter(c=>!c.ok&&!c.skipped).map(c=>c.id)};
    return v;
  };
  const restoreKept=async()=>{await versions.restore('verified');S.verify={...S.verify,n:S.kept.n,ok:true,playable:true,hash:S.kept.hash,failed:[]};return M.kept;};
  // While no version in this run is playable: up to rescueRounds more repair rounds on the stronger model.
  const rescueOrDeliver=()=>{
    const v=M.verdict;
    if(v&&!flags.advisory&&!v.ok&&!M.kept&&!playable(v)&&!S.gaveUp&&!flags.stub&&S.rescues<lim.rescueRounds&&!(S.rescues&&ledger.stop)){
      S.rescues++;note('rescues',S.rescues);log(`  not playable after ${S.repairs} repair rounds: rescue round ${S.rescues}`);
      S.repair='rescue';return go('repair','no version of this game is playable yet: a rescue round on the stronger model');
    }
    return go('deliver','no more rounds: the version is settled');
  };
  const folders=()=>({game:D.game,...(host.specFile?{spec:host.specFile}:{})});     // where the host keeps the game and the spec
  const playHost=()=>({dir:resolve(D.job,'playtest'),P:{DIR:host.paths.PLAYTEST,KIT_TOOLS:host.paths.KIT_TOOLS,...host.playWords},prompts:host.prompts??PROMPTS_DIR,
    promises:promisesNow,promisesLib:()=>T().promisesLib(),serveGame:host.serveGame??null,gameRef:host.gameRef??D.game,clock,log,scrub});

  const steps={
    async create(){
      const r=await hooks.prepare?.(loop);
      if(r?.end)return end(r.end,'the host ended the build while setting it up');
      // no host preparation: the kit's own create, from the locked spec, when the game folder is not there yet
      if(!hooks.prepare&&host.specFile&&!existsSync(resolve(D.game,'index.html'))){
        const c=await T().create(host.specFile,D.game);
        if(!c.ok)return end({outcome:'asked',why:'create',message:scrub(c.why).slice(0,240)},'create refused the plan twice: the person decides');
        await versions.keep('created');
      }
      S.status='building';
      if(inside(D.game,St().file))await ignoreStateDir(D.game);       // the state file is in the game's folder: not a game asset (decided by where it is, not by who passed the store)
      // the spec is locked from here on (a change is locked when its change round is over: the fix step)
      if(S.kind!=='change'&&(!S.lock||S.lock.when==='host'))await lockNow('create');
      if(flags.resumed){const e=await hooks.settle?.(loop);if(e?.end)return end(e.end,'the host ended the build');cp();return go('verify','a resumed build delivers the game an earlier build made: it is verified again first');}
      S.agent='build';return go('agent','the game folder is ready: the build agent writes the game');
    },

    async agent(){
      if(S.agent==='reminder'){
        say('repairing');
        // M.own is in memory only: after a restart the reminder is built from the copy in the state file
        const w=await round({kind:'reminder',message:withFixNotes(words.ownVerifyReminder(M.own??S.own??{why:'its last verify --quick did not pass'},host.paths,{tools:host.toolNames??null,...(host.who?{who:host.who}:{})}))});if(w)return w;
        cp();
        await readGaveUp('the build agent gave up');
        await deliveryOr('');
        const after=await T().ownVerify?.(D.game)??null;
        note('agentVerifyAfter',after?{ok:after.ok,why:after.why}:null);
        S.after='reminder';return go('fix','an agent round ended: the mechanical repairs first');
      }
      say('building');
      const w=await round({kind:S.kind==='change'?'change':'build',message:host.firstMessage});if(w)return w;
      cp();
      // A build the agent refuses (out/failure.txt, or out/questions.json with no game) asks the creator instead.
      if(existsSync(file.failure)||(S.kind!=='change'&&existsSync(file.questions)&&!await usable())){
        if(hooks.declined)return end(await hooks.declined(loop),'the agent declined the plan');
        return end({outcome:'asked',why:'declined'},'the agent declined the plan: the person decides');
      }
      if(!await usable()){
        await hooks.noDelivery?.(loop);
        await deliveryOr('The build agent stopped before it finished, so this is the game as it left it.');
        M.workerDelivery=true;note('workerDelivery',true);
      }
      S.round=1;S.after='build';return go('fix','an agent round ended: the mechanical repairs first');
    },

    // tools/fix.mjs after every agent round: what has one mechanical answer is repaired and noted, never left to a round
    async fix(){
      await runFix();
      if(S.after==='build'){
        const e=await hooks.settle?.(loop);if(e?.end)return end(e.end,'the host ended the build');
        cp();
        if(!S.lock)await lockNow(S.kind==='change'?'change':'create');     // a change: its round is over, the plan it leaves is locked
        // The agent's own `verify --quick` (tools/lib/own-verify.mjs): a delivery with no passing quick verify on the
        // files it delivered gets one reminder (not a repair round) before a full verify and a play-test are spent on it.
        const own=flags.resumed?null:await T().ownVerify?.(D.game)??null;
        if(own){
          M.own=own;S.own={ok:own.ok,why:own.why};note('agentVerify',{ok:own.ok,why:own.why,runs:own.runs??0});
          if(!own.ok&&!flags.stub){log(`  the agent's own verify: ${own.why}; one reminder`);S.agent='reminder';return go('agent','the delivery came without a passing verify --quick on the files delivered: one reminder');}
        }
        return go('verify','the agent round is done: the full verify');
      }
      if(S.gaveUp){
        // the agent gave up part-way through changing the files: the version that last passed, else what it left, checked
        if(M.kept){M.verdict=await restoreKept();return go('deliver','the agent gave up: the version that last passed verify is back');}
        S.phase='gave-up';return go('verify','the agent gave up: what it left is verified');
      }
      return go('verify','an agent round changed the game: the full verify again');
    },

    async verify(){
      const phase=S.phase;
      if(!S.lock)await lockNow('verify');          // a run from before the lock existed, or a resumed change
      const v=await verifyRound();
      if(phase==='gave-up'||phase==='starter'||phase==='recheck'){S.phase=null;return go('deliver',phase==='starter'?'the starting game has its own verify on record':'verified: the version is settled');}
      if(phase==='rescue')return rescueOrDeliver();
      // At most maxRepairs repair rounds in all. verify must pass before anyone plays, so its failures come first.
      if(!v.ok&&!flags.advisory){
        if(flags.stub||S.repairs>=lim.maxRepairs||ledger.stop)return rescueOrDeliver();
        S.repair='verify';return go('repair','the full verify failed: a repair round with each failed check\'s rule and fix');
      }
      if(flags.playtest===false){M.pt={skipped:'play-testing is off on this worker'};return rescueOrDeliver();}
      return go('playtest','the full verify passed: a play-tester plays the game as a new player');
    },

    async playtest(){
      const late=S.phase==='late',h=playHost();
      let r=null,again=0;
      if(S.handed?.step==='playtest'){          // handed over on an earlier call: the report is in the folder now
        const k=S.handed;S.handed=null;
        if(k.brief&&(k.again??0)<2&&await briefHash(h.dir)!==k.brief){
          // the brief is not the one the loop wrote: the report answers another brief. It is written and handed over again
          refuse(REFUSALS.BRIEF_CHANGED,{round:k.n});again=(k.again??0)+1;
          await rm(resolve(h.dir,'out/playtest.json'),{force:true});
          if(!k.retest)M.pt=null;
        }else{
          r={pt:M.pt??unpackPlaytest({}),n:k.n,focus:k.focus,t0:Date.parse(k.at)||clock.now(),retest:k.retest};
          M.pt=await finishPlaytest(r,{},h);
        }
      }
      if(!r){
        r=await beginPlaytest(late?null:M.pt,h);
        if(!r.done){
          say('playtesting');
          if(!host.playtester){
            M.pt=r.pt;S.handed={step:'playtest',n:r.n,focus:r.focus,retest:r.retest,at:stamp(),brief:r.brief,again};await r.srv?.close?.().catch(()=>{});
            return {waiting:'playtest',message:(again?refusalNotes():'')+r.message,model:lim.playtestModel,...(again?{refused:REFUSALS.BRIEF_CHANGED}:{})};
          }
          let error=null;
          try{await host.playtester({dir:h.dir,message:r.message,round:r.n,model:lim.playtestModel,timeoutMinutes:PLAYTEST_TIMEOUT_MIN});}
          catch(e){if(host.isStop?.(e))throw e;error=String(e.message).split('\n')[0].slice(0,300);}
          finally{await r.srv?.close?.().catch(()=>{});}
          cp();
          M.pt=await finishPlaytest(r,{error},h);
        }else M.pt=r.pt;
      }
      const pt=M.pt,ran=pt.rounds.at(-1)?.verdict!=='error';
      S.playtests++;
      // the play-test's proof is the files it last ran on; a round that could not run proves nothing new
      S.playtest={round:pt.rounds.length,ok:!!pt.ok,verdict:pt.verdict,hash:ran?await hash():S.playtest?.hash??null,at:stamp(),...(pt.error?{error:pt.error}:{})};
      if(late){S.phase=null;return go('deliver','the rescued game was played once, for its notes');}
      if(pt.ok||pt.error)return rescueOrDeliver();          // a play-test that could not run is not the build agent's to repair
      ledger.record({playtest:pt});
      // a resumed build delivers what the earlier build made: that one spent its play-test repairs already
      // ...and a round that changed no file of the game was not a repair: no further round of this kind
      if(flags.stub||S.repairs>=lim.maxRepairs||flags.resumed||ledger.idle)return rescueOrDeliver();
      S.repair='play';return go('repair','the play-tester could not see a promise happen: a repair round with its report');
    },

    // A repair round. The last one asks for the stronger model.
    async repair(){
      const kind=S.repair;
      if(!S.handed){
        say(SAY[kind]);S.repairs++;
        S.before=await hash();S.tampered=false;       // in the state: a round that is handed over ends in another call
      }
      const model=(kind==='rescue'||S.repairs===lim.maxRepairs)&&!flags.stub?lim.rescueModel:null;
      if(model)note('rescueModel',model);
      const message=S.handed?'':kind==='verify'?words.verifyRepair(M.verdict,S.verifies,S.repairs,msgOpts())
        :kind==='play'?words.playRepair(M.pt,S.repairs,msgOpts()):words.rescueRepair(M.verdict,S.verifies,S.rescues,msgOpts());
      const w=await round({kind:'repair',repair:kind,message:withFixNotes(message),model,round:S.repairs});if(w)return w;
      cp();
      // A round that changed no game file is not a repair. The locked spec is put back first, so an edit to the copy
      // in the game does not pass for a change; a round that edited the spec and nothing else is refused by its code.
      await guard();
      const changed=S.before==null?true:await hash()!==S.before;S.before=null;
      ledger.changed(changed);
      if(!changed&&S.tampered)refuse(REFUSALS.NO_REPAIR,{repair:S.repairs});
      await readGaveUp('the build agent gave up repairing');
      await deliveryOr('');
      await hooks.afterRepair?.(loop);
      S.after='repair';S.phase=kind==='rescue'?'rescue':null;
      return go('fix','a repair round ended: the mechanical repairs first');
    },

    // Settle the version and hand it over. A version at all costs (creator, 2026-10-07): when verify still fails after
    // the repairs, the latest version that passed it in this run; else the latest if it is playable; else the person
    // is asked; else (a build) the kit's starting game for the plan.
    async deliver(){
      ledger.flush();if(ledger.stop)note('repairStop',ledger.stop);
      if(S.rescues&&M.verdict?.ok&&flags.playtest!==false&&!M.pt&&!S.done.late){S.done.late=true;S.phase='late';return go('playtest','a rescued game is played once, for its notes');}
      // Stale proof is refused: a verdict counts only for the files it ran on.
      if(M.verdict&&!S.done.recheck&&await hash()!==M.verdict.hash){
        S.done.recheck=true;S.phase='recheck';log('  the game\'s files changed after its last verify: verifying again (stale proof is refused)');
        return go('verify','stale proof: the game\'s files changed after the last verify');
      }
      const v=M.verdict;
      if(v&&!v.ok&&!flags.advisory&&!S.done.fallback){
        S.done.fallback=true;
        const failedNow=v.checks.filter(c=>!c.ok&&!c.skipped).map(c=>`${c.id} ${c.name}`.trim());
        if(M.kept){M.verdict=await restoreKept();M.fallback={used:'verified',latestFailed:failedNow};}
        else if(playable(v))M.fallback={used:'playable',failed:failedNow};
        else if(S.kind!=='change'){
          // still not playable after every round: the person decides (the build agent writes the questions)
          if(hooks.ask){const r=await hooks.ask(loop,{failed:failedNow});if(r)return end(r,'not playable after every round: the creator was asked');}
          else return end({outcome:'asked',why:'not-playable',failed:failedNow},'not playable after every round: the person decides');
        }
        if(!M.fallback&&S.kind!=='change'&&await versions.has('created')){   // only when the host would not take the questions
          await versions.restore('created');
          await hooks.starter?.(loop);
          M.pt={skipped:'this is the kit’s starting game, not a version the play-tester played'};
          M.fallback={used:'starter',latestFailed:failedNow};S.fallback=M.fallback;
          S.phase='starter';return go('verify','the kit\'s starting game is handed over: its own verify, for the record');   // it does not gate
        }
        S.fallback=M.fallback;
      }
      if(M.fallback&&!S.done.fallbackNoted){S.done.fallbackNoted=true;note('fallback',M.fallback);log(`  delivering a fallback: ${M.fallback.used}`);}
      M.proof=proofOf(S,await hash());
      if(hooks.deliver)return end(await hooks.deliver(loop),'the host handed the version over');
      // no host delivery (a tool in a person's session): the loop's own rule. Stale proof sends the loop back.
      const p=M.proof;
      if(p.verify==='stale'){S.phase='recheck';return {...go('verify',`the game's files changed after verify ${S.verify.n} (stale proof): verify again`),refused:REFUSALS.STALE_VERIFY};}
      if(p.playtest==='stale'&&M.verdict.ok){S.phase='late';M.pt=null;return {...go('playtest',`the game's files changed after play-test round ${S.playtest.round} (stale proof): play-test again`),refused:REFUSALS.STALE_PLAYTEST};}
      if(!M.verdict.ok&&!flags.advisory&&!M.fallback)return end({outcome:'verify-failed',failed:M.verdict.failed.slice(0,12)},`verify ${S.verify.n} failed and no earlier version can stand in`);
      const lib=await T().promisesLib?.().catch(()=>null)??null,list=M.pt?.list??await promisesNow();
      const {issues,ownUntested}=issuesOf(M.pt,settlePromises(lib,list,M.verdict,M.pt));
      const notYet=truthFirst(proofLead({ownUntested}));   // own promises nothing checked: the session says so first (question 15)
      const outcome={outcome:outcomeOf({verdictOk:M.verdict.ok,fallback:M.fallback,issues,stale:p.stale}),...(notYet?{notYet}:{})};
      // going live (K3): the approval link, shown; delivery does not wait for the creator's wallet
      const ref=S.lock?.economy?{in:S.lock.economy.file}:specEconomy(host.spec);
      if(ref){outcome.economy=await economyAtDelivery({game:D.game,adapter:host.economy??null,ref});S.economy=outcome.economy;}
      // the backend the locked spec plans (wave 11 track L): connected, or playable in the browser and what to connect
      const backend=specBackend(S.lock?.spec?.text)??specBackend(host.spec);
      if(backend){outcome.backend=await backendAtDelivery({game:D.game,backend,adapter:host.backend??null,verdict:M.verdict});S.backend=outcome.backend;}
      return end(outcome,'verify ran on the files as they are, and no proof on record is stale');
    },
  };

  const loop={
    state:S,mem:M,ledger,
    hash,
    /** The lock as it stands (null until taken): a host whose state file the builder can write keeps this in memory and passes it back as `locked`. */
    get lock(){return S.lock?structuredClone(S.lock):null;},
    /**
     * Lock the spec again, from the files as the HOST has just left them (the person changed the plan: an answered
     * question, a change request the host applied). The loop's own change path; never a builder's. → the new lock
     */
    async relock(why='the host changed the plan'){
      S.lock=null;await lockNow('relock');
      S.history=[...S.history,{step:'relock',next:S.step,why,at:stamp()}].slice(-60);
      await save();return loop.lock;
    },
    /** → {step, why}: what step() would run. */
    next:()=>({step:S.step,why:S.why}),
    /** The stale-proof view of the state against the files now. */
    proof:async()=>proofOf(S,await hash()),
    /** The mechanical repairs, for a host that runs an agent round of its own inside a hook. */
    fix:runFix,
    /**
     * Run the step the state names, save, and say what comes next.
     * → {ran, next, why, outcome?} | {ran, waiting: 'agent' | 'playtest', message, model?} (handed over: do the round, call step() again)
     */
    async step(o={}){
      if(S.step==='done')return {ran:'done',next:'done',why:S.why,outcome:S.outcome};
      const ran=S.step;
      // The locked spec, before anything reads it: an edit is put back and refused, and the step is not run on this
      // call (the caller is told why; the next call runs it on the spec as locked).
      const edited=await guard();
      if(edited.length){
        const why=`the locked spec was changed after it was locked (${edited.map(p=>p.role==='game'?'the copy in the game':p.role==='economy'?'the economy it references':'the spec file').join(' and ')}) and was put back: call step() again`;
        S.history=[...S.history,{step:ran,next:ran,why,at:stamp(),refused:REFUSALS.SPEC_CHANGED}].slice(-60);
        const fresh=S.refusals.filter(x=>!x.told),message=words.refusalNote(fresh,msgOpts());
        // A host that got the message from step() has it, so the agent is not told twice. run() never shows it to
        // anyone (it passes told:false), so there the next round's own message carries it.
        if(o.told!==false)for(const x of fresh)x.told=true;
        await save();
        return {ran,next:ran,why,refused:REFUSALS.SPEC_CHANGED,message};
      }
      const r=await steps[ran]();
      if(r.waiting){await save();return {ran,...r,next:ran,why:`the ${r.waiting==='playtest'?'play-tester':'agent'} has the round: call step() again when it is done`};}
      S.step=r.next;S.why=r.why;
      if(r.next==='done'){
        S.outcome=r.outcome?.outcome??null;
        S.status=/^delivered/.test(String(S.outcome))?'delivered':S.outcome==='asked'?'waiting-on-question':'failed';
      }
      S.history=[...S.history,{step:ran,next:r.next,why:r.why,at:stamp(),...(r.refused?{refused:r.refused}:{})}].slice(-60);
      await save();
      return {ran,...r};
    },
    /**
     * End the run as cancelled: status 'cancelled', outcome 'cancelled', step 'done'. Nothing is delivered and
     * deliverable() stays false. Use it when a change request was started and rolled back, or the person gave up, so
     * that a stop guard reading the state stops holding the session. → {ran: 'cancel', next: 'done', why, outcome} | {refused} when the run had already ended.
     */
    async cancel(reason='cancelled by the host'){
      if(!cancelState(S,reason,stamp()))return {ran:'cancel',next:'done',why:S.why,outcome:S.outcome,refused:'already-ended'};
      await save();
      return {ran:'cancel',next:'done',why:reason,outcome:{outcome:'cancelled'}};
    },
    /** Step until the loop is done or a round is handed over. → the last step's answer (its `outcome` is the host's). */
    async run(){
      for(;;){const r=await loop.step({told:false});if(r.next==='done'||r.waiting)return r;}
    },
  };
  return loop;
}
