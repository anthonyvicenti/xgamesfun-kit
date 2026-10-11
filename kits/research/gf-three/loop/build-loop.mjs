// The build loop, once (open builder M2-F): create → agent round → fix → verify → play-test → repair → deliver.
// Lifted from the Studio worker's handleV2 (research/foundations/studio-worker/lib/v2.mjs), which is now a caller:
// it brings the queue, the uploads and the accounts; the order, the limits and what counts as proof are here.
//
// Each step is a function that returns the next step and why, and the state is saved after every one, so a tool can
// run one step and stop, and a run that was killed resumes at the step it was on. The library never starts an agent:
// the host passes the runner (`agent`, `playtester`). With no runner a round is handed over: the step returns
// {waiting, message}, and the next call to step() takes the round as done. README.md has the whole interface.
import {readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {MAX_REPAIRS,RESCUE_ROUNDS,playable,readVerdict} from './verdict.mjs';
import {STATE_SCHEMA,REFUSALS,stateFileOf,fileStore,proofOf,ignoreStateDir} from './state.mjs';
import {createRepairLedger} from './repair-ledger.mjs';
import {beginPlaytest,finishPlaytest,packPlaytest,unpackPlaytest,PLAYTEST_TIMEOUT_MIN} from './playtest.mjs';
import {usableDelivery,ensureDelivery,outcomeOf,issuesOf,settlePromises} from './delivery.mjs';
import * as words from './messages.mjs';
import {kitTools} from './tools.mjs';
import {PROMPTS_DIR} from './brief.mjs';

export const STEPS=['create','agent','fix','verify','playtest','repair','deliver','done'];
const SAY={verify:'repairing',play:'playRepairing',rescue:'rescuing'};
const same=s=>s;

/**
 * Open the build loop of one game (a new run, or the one its state file says was under way).
 *
 * host:
 *   job, game            folders (job holds game/, out/, spec.json, promises.json, playtest/); getters are read at use
 *   kind                 'build' | 'change'
 *   paths                as the agent sees them: {JOB, KIT_TOOLS, PLAYTEST}
 *   firstMessage         the first agent round's message
 *   specFile             the locked spec's file: with no hooks.prepare, the create step runs tools.create(specFile, game)
 *   spec, promises       for the loop's own delivery when the agent leaves none (getters)
 *   flags                {stub, advisory, playtest, resumed}: stub never repairs; advisory records a failed verify
 *                        without gating; playtest false turns the play-tester off; resumed skips the first agent round
 *   limits               {maxRepairs, rescueRounds, rescueModel, playtestModel}
 *   store                the state store ({load, save}); default: a file in the game's folder (.gf-loop/state.json)
 *   tools                {verify, fix, hash, ownVerify, promises, promisesLib, serve}; default: kitTools({kit})
 *   versions             {keep(name), restore(name), has(name)}: 'verified' (the last version that passed verify) and
 *                        'created' (the kit's starting game); default: none kept
 *   agent(o)             the runner: o = {kind: 'build' | 'reminder' | 'repair', repair?, message, model, round}. It
 *                        returns when the round is over (a failed session is the host's to swallow or throw). Absent: handed over
 *   playtester(o)        the play-tester's runner: o = {dir, message, round, model, timeoutMinutes}; throws when it could not run
 *   clock, log, say(key), note(key, value), checkpoint(), scrub(text), isStop(error)
 *   prompts              the folder of playtest.md (default: research/studio-v2/prompts beside this kit)
 *   serveGame(), gameRef what the play-tester is given: a served URL ({url, close}), else gameRef (default: the folder)
 *   ledgerLine(line)     each finished repair round as one JSON line
 *   resume               false: never pick up an earlier run's state
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
 * → {state, mem, next(), step(), run(), hash(), proof()}
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
    round:0,repairs:0,rescues:0,verifies:0,playtests:0,verify:null,kept:null,playtest:null,pt:null,gaveUp:null,fallback:null,fixes:[],ledger:[],done:{},handed:null,outcome:null,history:[]};
  const M={verdict:null,kept:null,pt:null,own:null,fixNotes:[],proof:null,workerDelivery:false,resumedRun:!!loaded};
  const ledger=createRepairLedger({rounds:S.ledger,write:host.ledgerLine??null});
  if(loaded){            // a run that was killed: what the files on disk still say
    if(S.verify)M.verdict={...(await readVerdict(resolve(D.out,`verify-${S.verify.n}`))??{ok:S.verify.ok,checks:[],failed:[],repair:[],summary:''}),hash:S.verify.hash};
    if(S.kept)M.kept=S.kept.n===S.verify?.n?M.verdict:{...(await readVerdict(resolve(D.out,`verify-${S.kept.n}`))??{ok:true,checks:[],failed:[],repair:[],summary:''}),hash:S.kept.hash};
    let list=null;try{list=JSON.parse(await readFile(resolve(D.job,'promises.json'),'utf8'));}catch{}
    M.pt=unpackPlaytest(S.pt,list);
    M.fallback=S.fallback;
  }

  const save=async()=>{S.ledger=ledger.rounds;S.pt=packPlaytest(M.pt);S.updated=stamp();await St().save(S);};
  const go=(next,why)=>({next,why});
  const end=(outcome,why)=>({next:'done',why,outcome});
  const hash=()=>T().hash(D.game);
  const usable=()=>usableDelivery(file.delivery);
  const deliveryOr=why=>ensureDelivery(D.out,{spec:host.spec,promises:host.promises,why});
  const msgOpts=()=>({paths:host.paths,maxRepairs:lim.maxRepairs,rescueRounds:lim.rescueRounds,...(host.who?{who:host.who}:{})});
  const withFixNotes=message=>{const n=words.fixNote(M.fixNotes);M.fixNotes=[];return n+message;};

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
    const v=await T().verify(D.game,resolve(D.out,`verify-${n}`));
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
  const playHost=()=>({dir:resolve(D.job,'playtest'),P:{DIR:host.paths.PLAYTEST,KIT_TOOLS:host.paths.KIT_TOOLS},prompts:host.prompts??PROMPTS_DIR,
    promises:()=>T().promises(D.job),promisesLib:()=>T().promisesLib(),serveGame:host.serveGame??null,gameRef:host.gameRef??D.game,clock,log,scrub});

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
      if(!host.store)await ignoreStateDir(D.game);       // the state file is in the game's folder: not a game asset
      if(flags.resumed){const e=await hooks.settle?.(loop);if(e?.end)return end(e.end,'the host ended the build');cp();return go('verify','a resumed build delivers the game an earlier build made: it is verified again first');}
      S.agent='build';return go('agent','the game folder is ready: the build agent writes the game');
    },

    async agent(){
      if(S.agent==='reminder'){
        say('repairing');
        const w=await round({kind:'reminder',message:withFixNotes(words.ownVerifyReminder(M.own,host.paths))});if(w)return w;
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
        // The agent's own `verify --quick` (tools/lib/own-verify.mjs): a delivery with no passing quick verify on the
        // files it delivered gets one reminder (not a repair round) before a full verify and a play-test are spent on it.
        const own=flags.resumed?null:await T().ownVerify?.(D.game)??null;
        if(own){
          M.own=own;note('agentVerify',{ok:own.ok,why:own.why,runs:own.runs??0});
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
      let r;
      if(S.handed?.step==='playtest'){          // handed over on an earlier call: the report is in the folder now
        const k=S.handed;S.handed=null;
        r={pt:M.pt??unpackPlaytest({}),n:k.n,focus:k.focus,t0:Date.parse(k.at)||clock.now(),retest:k.retest};
        M.pt=await finishPlaytest(r,{},h);
      }else{
        r=await beginPlaytest(late?null:M.pt,h);
        if(!r.done){
          say('playtesting');
          if(!host.playtester){
            M.pt=r.pt;S.handed={step:'playtest',n:r.n,focus:r.focus,retest:r.retest,at:stamp()};await r.srv?.close?.().catch(()=>{});
            return {waiting:'playtest',message:r.message,model:lim.playtestModel};
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
      if(flags.stub||S.repairs>=lim.maxRepairs||flags.resumed)return rescueOrDeliver();
      S.repair='play';return go('repair','the play-tester could not see a promise happen: a repair round with its report');
    },

    // A repair round. The last one asks for the stronger model.
    async repair(){
      const kind=S.repair;
      if(!S.handed){
        say(SAY[kind]);S.repairs++;
        M.before=await hash();
      }
      const model=(kind==='rescue'||S.repairs===lim.maxRepairs)&&!flags.stub?lim.rescueModel:null;
      if(model)note('rescueModel',model);
      const message=S.handed?'':kind==='verify'?words.verifyRepair(M.verdict,S.verifies,S.repairs,msgOpts())
        :kind==='play'?words.playRepair(M.pt,S.repairs,msgOpts()):words.rescueRepair(M.verdict,S.verifies,S.rescues,msgOpts());
      const w=await round({kind:'repair',repair:kind,message:withFixNotes(message),model,round:S.repairs});if(w)return w;
      cp();
      ledger.changed(M.before==null?true:await hash()!==M.before);
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
      const lib=await T().promisesLib?.().catch(()=>null)??null,list=M.pt?.list??await T().promises?.(D.job)??null;
      const {issues}=issuesOf(M.pt,settlePromises(lib,list,M.verdict,M.pt));
      return end({outcome:outcomeOf({verdictOk:M.verdict.ok,fallback:M.fallback,issues,stale:p.stale})},'verify ran on the files as they are, and no proof on record is stale');
    },
  };

  const loop={
    state:S,mem:M,ledger,
    hash,
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
    async step(){
      if(S.step==='done')return {ran:'done',next:'done',why:S.why,outcome:S.outcome};
      const ran=S.step;
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
    /** Step until the loop is done or a round is handed over. → the last step's answer (its `outcome` is the host's). */
    async run(){
      for(;;){const r=await loop.step();if(r.next==='done'||r.waiting)return r;}
    },
  };
  return loop;
}
