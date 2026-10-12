// What the loop says to the build agent between rounds (lifted from the Studio worker's lib/v2.mjs, open builder M2-F).
// `paths` are as the agent sees them: {JOB, KIT_TOOLS, PLAYTEST (the play-tester's folder)}. `who` is the caller in
// the agent's eyes ("The worker" in Studio; a tool in a person's session passes its own name).
//
// The words assume the worker's layout unless the host says otherwise (every default below is the worker's exact words):
//   paths.GAME      the game folder as the agent sees it         (default `${JOB}/game`; the game.json it names is `game/config/game.json` until a host gives GAME)
//   paths.OUT       the folder the agent's outputs and verdicts are in (default `${JOB}/out`)
//   paths.DELIVERY  the delivery file, as the agent names it      (default `out/delivery.json`)
//   paths.QUESTIONS the questions file                            (default `${JOB}/out/questions.json`)
//   paths.SPEC      the locked spec                               (default `${JOB}/spec.json`)
//   tools           names of the host's tools, said instead of a shell command: {verify, quick, play, catalog}
//                   (a tools host says "run the tool gamesfun_step_verify" where the worker says "run node …/verify.mjs")
import {isAbsolute} from 'node:path';
import {MAX_REPAIRS,RESCUE_ROUNDS} from './verdict.mjs';

const lay=paths=>({game:paths.GAME??`${paths.JOB}/game`,out:paths.OUT??`${paths.JOB}/out`,delivery:paths.DELIVERY??'out/delivery.json',
  gameJson:paths.GAME?`${paths.GAME}/config/game.json`:'game/config/game.json',questions:paths.QUESTIONS??`${paths.JOB}/out/questions.json`,spec:paths.SPEC??`${paths.JOB}/spec.json`});
const tool=(tools,name)=>tools?.[name]?`the tool ${tools[name]}`:null;
/** The full verify, as the agent runs it: "node …/verify.mjs game", or the host's tool. */
const fullVerify=(paths,tools)=>tool(tools,'verify')??`node ${paths.KIT_TOOLS}/verify.mjs game`;
/** "run verify --quick": or the host's quick tool. */
const runQuick=tools=>tools?.quick?`run the tool ${tools.quick}`:'run verify --quick';

export const firstMessage=paths=>`Read ${paths.JOB}/JOB.md and do the job it describes. Work only inside ${paths.JOB}.`;

/**
 * The failed checks of a verdict as the repair message lists them: each with what verify saw, and the check's own rule
 * and fix (tools/lib/homes.json; verify records them with every failed check), so the rule reaches the agent when it
 * applies. A verdict with no rule or fix on record (an older verify) lists the failed lines as before.
 */
export function failedLines(verdict,max=12){
  const rows=verdict.repair?.length?verdict.repair.slice(0,max).map(r=>[`- ${r.id}${r.name?` ${r.name}`:''}${r.detail?`: ${r.detail.slice(0,1200)}`:''}`,...(r.rule?[`  Rule: ${r.rule}`]:[]),...(r.fix?[`  Fix: ${r.fix}`]:[])].join('\n'))
    :verdict.failed.slice(0,max).map(f=>'- '+f);
  return rows.join('\n')||'- '+verdict.summary;
}

/** The mechanical repairs tools/fix.mjs made after the agent's last round, for the agent's next message ('' when none). */
export const fixNote=repairs=>repairs?.length?`After your last round the loop repaired these by script (tools/fix.mjs; each has one mechanical answer), so the files differ from what you left:\n${repairs.slice(0,12).map(r=>`- ${r.line}`).join('\n')}\n\n`:'';

export function verifyRepair(verdict,n,round,{paths,who='The worker',maxRepairs=MAX_REPAIRS,tools=null}){
  const L=lay(paths);
  return `${who} ran the full verify (${fullVerify(paths,tools)}) and it failed. Its verdict is in ${L.out}/verify-${n}/verdict.json. Failed checks:\n${failedLines(verdict)}\nFix the game in ${L.game} (rules.js and config only), ${runQuick(tools)} until it passes, then rewrite ${L.delivery}. This is repair round ${round} of at most ${maxRepairs}.`;
}

export function rescueRepair(verdict,n,round,{paths,who='the worker',maxRepairs=MAX_REPAIRS,rescueRounds=RESCUE_ROUNDS,tools=null}){
  const L=lay(paths);
  return `The game still doesn't play after ${maxRepairs} repair rounds, so ${who} keeps going: rescue round ${round} of at most ${rescueRounds}. The full verify (${L.out}/verify-${n}/verdict.json) fails:\n${failedLines(verdict)}\nWhat counts now is a game a player can play: it boots and the player moves (check 3), a round reaches results and replays (check 6), and every control on the HUD works (check 13). Fix those first. If a part of the plan keeps breaking them, make it simpler (fewer enemies, a plainer rule, a control taken out of ${L.gameJson} → controls) and say so in the delivery. Fix the game in ${L.game} (rules.js, config/*.json and slots only), ${runQuick(tools)} until it passes, then rewrite ${L.delivery} LAST.`;
}

export function questionsMessage(failed,{paths,tools=null}){
  const L=lay(paths);
  return `After every repair round the game still doesn't play (the latest full verify fails: ${failed.slice(0,6).join('; ')||'see out/verify-*/verdict.json'}). Stop changing the game: the creator decides what happens next. Write ${L.questions} LAST, as JSON: {"message": "one or two plain sentences to the creator on what is in the way (no file names, code or check numbers)", "questions": [up to 3 of {"id": "short-id", "text": "the question", "options": [{"id": "keep", "label": "Keep the plan and try again"}, {"id": "simpler", "label": "a few plain words", "set": {"/json/pointer/into/spec.json": "new value"}}], "default": "keep"}]}. Ids are lowercase letters, digits and dashes; each question has 2–4 options with labels of at most 60 characters; the default is the plan as it stands (no "set"); every other option carries "set": what picking it changes in ${L.spec}, as JSON pointer → value (for example {"/world/template": "arena"} or {"/mechanics/0/params/hp": 2}), so the plan becomes one you can build into a playable game on this kit (${tool(tools,'catalog')??`node ${paths.KIT_TOOLS}/catalog.mjs --json`} lists what it can do). If no question would help, write {"message": "…", "questions": []}.`;
}

export function playRepair(pt,round,{paths,maxRepairs=MAX_REPAIRS,tools=null}){
  const L=lay(paths);
  const dir=paths.PLAYTEST;
  const at=e=>e.map(x=>isAbsolute(x)?x:`${dir}/${x}`).join(', ');
  const promised=pt.failedIds.map(id=>{const p=pt.list.promises.find(x=>x.id===id),a=pt.answers.get(id);return `- ${id}: ${p?.text??id}\n  The play-tester: "${a?.note||'it did not see this happen'}"${a?.evidence?.length?` (${at(a.evidence)})`:''}`;});
  const feel=(pt.feel??[]).filter(f=>f.severity!=='minor').map(f=>`- [${f.severity}] ${f.issue}${f.evidence.length?` (${at(f.evidence)})`:''}`);
  // a game with enemies: "my shots never visibly kill anything" was once answered with one-hit kills ("Hang Up On Them", 2026-10-07)
  const enemies=pt.list?.promises?.some(p=>p.mechanic==='waves'||p.id==='kit.hits');
  return [`A play-tester played your game as a new player (black box: only the screen, the HUD and its play log; it never read your code) and it did not pass. Its report is ${dir}/out/playtest.json. Look at the screenshots named below: they are what a player sees.`,
    `Promises a new player could not see happen on their own screen:\n${promised.join('\n')||'- none'}`,
    ...(feel.length?[`What it found (blockers must be fixed; majors are worth fixing when quick):\n${feel.join('\n')}`]:[]),
    ...(enemies?[`If a player can't see their hits on enemies, never answer by making enemies die in one hit (projectile damage at or above waves hp): the kit already shows every hit that does not kill (a health bar, a flash, a flinch), and verify check 16 fails one-hit kills unless the spec asks for them. Fix the aim, the range or how rules.js fires instead.`]:[]),
    `Fix the game in ${L.game} (rules.js, config/*.json and slots only) so a new player sees each of these happen on their own screen. If a control can't be made to work, take it out of ${L.gameJson} → controls so the HUD stops promising it, and say so in the delivery. You can play it the same way: ${tools?.play?`the tool ${tools.play} with steps like [{"do":"hold","key":"Mouse","seconds":2,"shot":"firing"}] (the tool says which steps it takes)`:`node ${paths.KIT_TOOLS}/play.mjs game --steps '[{"do":"hold","key":"Mouse","seconds":2,"shot":"firing"}]' --out scratch/play-1 (the step list is in ${paths.KIT_TOOLS}/lib/play-script.mjs)`}. Then ${runQuick(tools)} until it passes and rewrite ${L.delivery} last. The full verify runs again, then the play-tester re-tests what failed. This is repair round ${round} of at most ${maxRepairs}.`].join('\n\n');
}

export const ownVerifyReminder=(own,paths,{tools=null,who='The worker'}={})=>{
  const L=lay(paths),q=tools?.quick??tools?.verify;
  return `Your delivery came without a passing verify --quick on the game as you delivered it: ${own.why}. ${q?`Run the tool ${q}`:`Run node ${paths.KIT_TOOLS}/verify.mjs game --quick from ${paths.JOB}`} and fix until it passes (each failed check says what to change; --check 10, 13, 14, 15, 16, 20, 21 or 22 re-runs one check in under a minute), then rewrite ${L.delivery} last. ${who} runs the full verify and a play-tester next.`;
};

/**
 * What the agent is told when the loop refused something it did to the proof (lock.mjs; the codes are state.mjs
 * REFUSALS). `refusals`: [{code, files?: ['spec' | 'game' | 'economy'], ids?: [promise ids]}]. Each says what to do instead.
 * '' when there is none. Said once, before the round's own message.
 */
export function refusalNote(refusals,{paths,who='The worker',tools=null}={}){
  if(!refusals?.length)return '';
  const L=lay(paths),has=code=>refusals.filter(r=>r.code===code),lines=[];
  const spec=has('spec-changed');
  if(spec.length){
    const roles=new Set(spec.flatMap(r=>r.files??[])),files=[...(roles.has('spec')?[L.spec]:[]),...(roles.has('game')?[`${L.game}/spec.json`]:[]),...(roles.has('economy')?[`the economy in ${L.game}/gamesfun.json`]:[])];
    lines.push(`- The locked spec was changed after it was locked (${files.join(', ')||L.spec}), and ${who.replace(/^The /,'the ')} put it back. The spec is the plan the person agreed to, and the game is verified and play-tested against it as locked: editing it passes no check and drops no promise. Make the game do what the spec says. If a part of the plan can't be built, leave the spec alone: ${tools?.ask?`ask the person with the tool ${tools.ask}`:`write ${L.questions} so the person decides`}, or name what is not there yet in ${L.delivery}.`);
  }
  if(has('state-changed').length)lines.push('- The loop\'s state file was changed by something other than the loop, and was written again from the copy the loop holds in memory. The steps, the verdicts and the counts are the loop\'s to write.');
  if(has('lock-changed').length)lines.push('- The loop\'s own record of the locked spec was changed. The record the loop held in memory stands, and the spec was checked against it.');
  const shrunk=[...new Set(has('promises-shrunk').flatMap(r=>r.ids??[]))];
  if(shrunk.length)lines.push(`- The game stopped making ${shrunk.length===1?'a promise':`${shrunk.length} promises`} it made when the spec was locked (${shrunk.slice(0,8).join(', ')}). ${shrunk.length===1?'It is':'They are'} still checked: the play-tester is asked about every promise of the locked spec, never fewer. Make the game keep ${shrunk.length===1?'it':'them'}, or name what is not there yet in ${L.delivery}.`);
  if(has('no-repair').length)lines.push(`- Your last repair round changed no file of the game in ${L.game}, so it repaired nothing and the same verdict stands. A repair changes the game (rules.js, config, slots), never what the game is checked against.`);
  if(has('brief-changed').length)lines.push(`- The play-tester's brief in ${paths.PLAYTEST} was changed after the loop wrote it, so that round does not count: the brief is written again and the play-tester plays again. Only the loop writes the brief, and only the play-tester writes its report.`);
  return lines.length?`The loop refused this (the game is checked against what was promised when the spec was locked):\n${lines.join('\n')}\n\n`:'';
}
