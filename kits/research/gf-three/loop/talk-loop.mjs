// The two steps before a build (open builder M2-F): the pitch (an agent round that answers with ideas or a locked
// spec) and the spec check (the answer is held to its schema and the catalog; one repair round when it fails).
// Lifted from the Studio worker's talkFlow; the checker is passed in, because the pitch's rules are the host's
// (Studio: creator-studio/lib/pitch.mjs through tools/check-v2.mjs; a person's session: `create` checks the spec).
import {STATE_SCHEMA,memoryStore,cancelState} from './state.mjs';
import {specEconomy,readEconomy,paysForClears,KEEPER_HOLE,ECONOMY_FILE} from './economy.mjs';
import {specBackend,specBackendProblems,lockedBackend} from './backend.mjs';

export const TALK_STEPS=['pitch','spec','deliver','done'];

/**
 * host:
 *   kind              'pitch' | 'refine'
 *   firstMessage      the agent round's message
 *   flags             {stub}: the stub is never sent back
 *   store             the state store (default: in memory; a pitch has no game folder yet)
 *   agent(o)          the runner: o = {kind: 'pitch' | 'refine' | 'repair', message}. Absent: the round is handed over
 *   check()           → {failure} | {errors, file} | {file, value}: the answer as the host's checker reads it
 *   repairMessage(errors)  what the agent is told when its answer is not valid yet
 *   economy           only in a session with web3 on (economy.mjs): {game, read?() → the economy, check?(economy) →
 *                     refusals [{code, message, fix}]}. A locked spec that references an economy is held to it: the
 *                     economy is saved in <game>/gamesfun.json and its checker passes it. Absent (web3 off): a spec that
 *                     references an economy is not valid, and nothing else changes
 *   backends          only in a session that can connect a backend (backend.mjs, wave 11 track L): true, or {check?(backend)
 *                     → errors}. A locked spec with a `backend` is held to its shape and its answer carries the backend's
 *                     words (`backend`). Absent: a spec with a backend is not valid, and nothing else changes
 *   say(key), log, checkpoint()
 *   hooks: prepare(loop) (the job folder), fastLock(loop) → true when the host locked the spec with no agent,
 *          beforeAgent(loop), afterAgent(loop), deliver(loop, answer) → the outcome
 * → {state, mem, next(), step(), run()}
 */
export async function openTalkLoop(host){
  const flags=host.flags??{},hooks=host.hooks??{};
  const say=host.say??(()=>{}),log=host.log??(()=>{}),cp=host.checkpoint??(()=>{});
  const store=host.store??memoryStore();
  const S=(host.resume===false?null:await store.load())??{schema:STATE_SCHEMA,kind:host.kind,status:'building',step:'pitch',why:'a new request',fast:false,repaired:false,handed:null,outcome:null,history:[]};
  const M={answer:null};
  const go=(next,why)=>({next,why});
  // The host's checker, then the economy a locked spec references (K3). A spec with no `economy` is the host's answer as it was.
  // A spec with no `backend` (wave 11 track L) is the answer as the economy step left it.
  const check=async()=>{
    const out=await checkEconomy();
    if(out?.errors||out?.failure||out?.file!=='spec.json'||!specBackend(out.value))return out;
    const B=host.backends,errors=[...specBackendProblems(out.value,B||null),...(B&&typeof B.check==='function'?(await B.check(specBackend(out.value)))??[]:[])];
    if(errors.length)return {errors:errors.slice(0,12),file:out.file};
    return {...out,backend:lockedBackend(specBackend(out.value))};
  };
  const checkEconomy=async()=>{
    const out=await host.check();
    if(out?.errors||out?.failure||out?.file!=='spec.json'||!specEconomy(out.value))return out;
    const E=host.economy,ref=specEconomy(out.value);
    if(!E)return {errors:['economy: this session runs with web3 off, so no game here carries an economy: take "economy" out of the spec'],file:out.file};
    const economy=E.read?await E.read():await readEconomy(E.game,ref);
    if(!economy)return {errors:[`economy: the spec references the economy in ${ref.in??ECONOMY_FILE}, and there is none there yet: save it with economy_save (only an economy its checker passes is saved), then have the spec checked again`],file:out.file};
    const refusals=(await E.check?.(economy))??[];
    if(refusals.length)return {errors:refusals.slice(0,12).map(r=>`economy: ${r.code?`${r.code}: `:''}${r.message??r}${r.fix?` Fix: ${r.fix}`:''}`),file:out.file};
    return {...out,economy:{in:ref.in??ECONOMY_FILE,...(paysForClears(economy)?{clears:true,hole:KEEPER_HOLE}:{})}};
  };
  const round=async o=>{
    cp();
    if(host.agent){await host.agent(o);return null;}
    if(S.handed?.step===S.step){S.handed=null;return null;}
    S.handed={step:S.step,kind:o.kind};
    return {waiting:'agent',kind:o.kind,message:o.message};
  };
  const steps={
    async pitch(){
      if(!S.handed){
        await hooks.prepare?.(loop);cp();
        if(await hooks.fastLock?.(loop)){S.fast=true;return go('spec','every answer was a default or a preset: the spec is locked with no agent round');}
        say(S.kind==='pitch'?'researching':'thinking');
        await hooks.beforeAgent?.(loop);
      }
      const w=await round({kind:S.kind,message:host.firstMessage});if(w)return w;
      await hooks.afterAgent?.(loop);
      return go('spec','the agent answered: its pitch or spec is checked');
    },
    async spec(){
      cp();
      // The repair round was handed over on an earlier call and the host has done it: take it as done, so `handed`
      // does not outlive a repaired answer that is valid (the check below then sees the repaired answer).
      if(S.handed?.step==='spec'&&S.handed.kind==='repair'){S.handed=null;S.repaired=true;}
      let out=await check();
      if(out.errors&&!flags.stub&&!S.fast&&!S.repaired){
        if(!S.handed)log(`  ${S.kind} output invalid; one repair round`);
        const w=await round({kind:'repair',message:host.repairMessage(out.errors)});if(w)return w;
        S.repaired=true;
        out=await check();
      }
      M.answer=out;
      return go('deliver',out.errors?'the answer is still not valid after its repair round':out.failure?'the agent declined':'the answer is valid');
    },
    async deliver(){
      cp();
      const r=await hooks.deliver?.(loop,M.answer??await check())??{outcome:M.answer?.errors?'invalid-output':M.answer?.failure?'agent-declined':M.answer?.file==='spec.json'?'locked':'pitched',...(M.answer?.economy&&!M.answer.errors?{economy:M.answer.economy}:{}),...(M.answer?.backend&&!M.answer.errors?{backend:M.answer.backend}:{})};
      return {next:'done',why:'the answer was handed over',outcome:r};
    },
  };
  const loop={
    state:S,mem:M,
    next:()=>({step:S.step,why:S.why}),
    async step(){
      if(S.step==='done')return {ran:'done',next:'done',why:S.why,outcome:S.outcome};
      const ran=S.step,r=await steps[ran]();
      if(r.waiting){await store.save(S);return {ran,...r,next:ran,why:'the agent has the round: call step() again when it is done'};}
      S.step=r.next;S.why=r.why;
      if(r.next==='done'){S.outcome=r.outcome?.outcome??null;S.status=S.outcome==='pitched'?'waiting-on-question':S.outcome==='locked'?'building':'failed';}
      S.history=[...S.history,{step:ran,next:r.next,why:r.why}].slice(-20);
      await store.save(S);
      return {ran,...r};
    },
    /** End the request as cancelled (status and outcome say so). → as BuildLoop's cancel(). */
    async cancel(reason='cancelled by the host'){
      if(!cancelState(S,reason))return {ran:'cancel',next:'done',why:S.why,outcome:S.outcome,refused:'already-ended'};
      await store.save(S);return {ran:'cancel',next:'done',why:reason,outcome:{outcome:'cancelled'}};
    },
    async run(){for(;;){const r=await loop.step();if(r.next==='done'||r.waiting)return r;}},
  };
  return loop;
}
