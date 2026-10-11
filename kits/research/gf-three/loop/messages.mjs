// What the loop says to the build agent between rounds (lifted from the Studio worker's lib/v2.mjs, open builder M2-F).
// `paths` are as the agent sees them: {JOB, KIT_TOOLS, PLAYTEST (the play-tester's folder)}. `who` is the caller in
// the agent's eyes ("The worker" in Studio; a tool in a person's session passes its own name).
import {isAbsolute} from 'node:path';
import {MAX_REPAIRS,RESCUE_ROUNDS} from './verdict.mjs';

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

export function verifyRepair(verdict,n,round,{paths,who='The worker',maxRepairs=MAX_REPAIRS}){
  return `${who} ran the full verify (node ${paths.KIT_TOOLS}/verify.mjs game) and it failed. Its verdict is in ${paths.JOB}/out/verify-${n}/verdict.json. Failed checks:\n${failedLines(verdict)}\nFix the game in ${paths.JOB}/game (rules.js and config only), run verify --quick until it passes, then rewrite out/delivery.json. This is repair round ${round} of at most ${maxRepairs}.`;
}

export function rescueRepair(verdict,n,round,{paths,who='the worker',maxRepairs=MAX_REPAIRS,rescueRounds=RESCUE_ROUNDS}){
  return `The game still doesn't play after ${maxRepairs} repair rounds, so ${who} keeps going: rescue round ${round} of at most ${rescueRounds}. The full verify (${paths.JOB}/out/verify-${n}/verdict.json) fails:\n${failedLines(verdict)}\nWhat counts now is a game a player can play: it boots and the player moves (check 3), a round reaches results and replays (check 6), and every control on the HUD works (check 13). Fix those first. If a part of the plan keeps breaking them, make it simpler (fewer enemies, a plainer rule, a control taken out of game/config/game.json → controls) and say so in the delivery. Fix the game in ${paths.JOB}/game (rules.js, config/*.json and slots only), run verify --quick until it passes, then rewrite out/delivery.json LAST.`;
}

export function questionsMessage(failed,{paths}){
  return `After every repair round the game still doesn't play (the latest full verify fails: ${failed.slice(0,6).join('; ')||'see out/verify-*/verdict.json'}). Stop changing the game: the creator decides what happens next. Write ${paths.JOB}/out/questions.json LAST, as JSON: {"message": "one or two plain sentences to the creator on what is in the way (no file names, code or check numbers)", "questions": [up to 3 of {"id": "short-id", "text": "the question", "options": [{"id": "keep", "label": "Keep the plan and try again"}, {"id": "simpler", "label": "a few plain words", "set": {"/json/pointer/into/spec.json": "new value"}}], "default": "keep"}]}. Ids are lowercase letters, digits and dashes; each question has 2–4 options with labels of at most 60 characters; the default is the plan as it stands (no "set"); every other option carries "set": what picking it changes in ${paths.JOB}/spec.json, as JSON pointer → value (for example {"/world/template": "arena"} or {"/mechanics/0/params/hp": 2}), so the plan becomes one you can build into a playable game on this kit (node ${paths.KIT_TOOLS}/catalog.mjs --json lists what it can do). If no question would help, write {"message": "…", "questions": []}.`;
}

export function playRepair(pt,round,{paths,maxRepairs=MAX_REPAIRS}){
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
    `Fix the game in ${paths.JOB}/game (rules.js, config/*.json and slots only) so a new player sees each of these happen on their own screen. If a control can't be made to work, take it out of game/config/game.json → controls so the HUD stops promising it, and say so in the delivery. You can play it the same way: node ${paths.KIT_TOOLS}/play.mjs game --steps '[{"do":"hold","key":"Mouse","seconds":2,"shot":"firing"}]' --out scratch/play-1 (the step list is in ${paths.KIT_TOOLS}/lib/play-script.mjs). Then run verify --quick until it passes and rewrite out/delivery.json last. The full verify runs again, then the play-tester re-tests what failed. This is repair round ${round} of at most ${maxRepairs}.`].join('\n\n');
}

export const ownVerifyReminder=(own,paths)=>`Your delivery came without a passing verify --quick on the game as you delivered it: ${own.why}. Run node ${paths.KIT_TOOLS}/verify.mjs game --quick from ${paths.JOB} and fix until it passes (each failed check says what to change; --check 10, 13, 14, 15, 16, 20, 21 or 22 re-runs one check in under a minute), then rewrite out/delivery.json last. The worker runs the full verify and a play-tester next.`;
