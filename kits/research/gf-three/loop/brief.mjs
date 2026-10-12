#!/usr/bin/env node
// The prompts, once (open builder M2-F). One source, research/studio-v2/prompts/source/, feeds the build brief, the
// revise brief and the game-building part of the kit's AGENTS.md:
//
//   rules.json           every rule a game-building agent reads, each written once, some tagged with the part they concern
//   <kind>.frame.md      what only that kind of job says, with {{RULE:<id>}} where a rule goes and {{PARTS}} for the
//                        notes of the mechanics in the spec (each mechanic's manifest.note, from the kit itself)
//
// composeBrief({kind, spec, parts}) fills a frame for one game: a rule with a part is left out when the spec does not
// use that part. With no spec it writes the whole brief (every rule, {{PARTS}} left as a placeholder): that is what
// research/studio-v2/prompts/build.md and revise.md are, generated files a test holds to this output.
// Placeholders such as {{JOB}} and {{KIT}} are left for the host to fill (the worker's own values, or a session's).
//
//   node research/gf-three/loop/brief.mjs --write            regenerate build.md and revise.md
//   node research/gf-three/loop/brief.mjs --check            exit 1 when either differs from the source
//   node research/gf-three/loop/brief.mjs agents             print the AGENTS.md part (for the kit's sync to place)
//   node research/gf-three/loop/brief.mjs build --spec f.json   one game's brief, placeholders unfilled
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isMain} from '../tools/lib/main.mjs';

export const BRIEF_KINDS=['build','revise','agents'];
/** The prompts folder this copy of the loop sits beside (research/studio-v2/prompts, or the kit snapshot's copy). */
export const PROMPTS_DIR=fileURLToPath(new URL('../../studio-v2/prompts/',import.meta.url));
/** The generated files: the whole brief of each kind a job reads. */
export const GENERATED={build:'build.md',revise:'revise.md'};
/** The markers the kit's AGENTS.md keeps around its generated game-building part. */
export const AGENTS_MARKS=['<!-- gf:game-building:start (generated: kits/research/gf-three/loop/brief.mjs agents; edit research/studio-v2/prompts/source/ in games.fun) -->','<!-- gf:game-building:end -->'];

const ids=spec=>new Set((spec?.mechanics??[]).map(m=>m?.id));
const any=(spec,...list)=>list.some(id=>ids(spec).has(id));
const MADE=new Set(['generate','reference']);
/**
 * Does this spec use the part? One line per part a rule names (the names are homes.json's). A part with no entry
 * here is always read, so a new tag never silently hides a rule.
 */
export const USES={
  // players and bots fight: something in the game can hit a player
  fair:spec=>any(spec,'projectile','melee','health','waves','boss','shove'),
  // enemies that take hits
  'mechanic:waves':spec=>any(spec,'waves','boss'),
  // the party engine's laid-out worlds (rooms, doors, gates); a voxel world, a scenic isle and a forge room are their own
  world:spec=>(spec?.engine??'party')==='party'&&spec?.world?.template!=='voxel',
  // players drawn as characters with their own loadout
  'character:loadout':spec=>spec?.engine!=='forge',
  // a model the worker makes, or more than one role (two roles must not share a body)
  'assets:generated':spec=>(spec?.characters??[]).some(c=>MADE.has(c?.body?.from))||(spec?.world?.props??[]).some(p=>MADE.has(p?.from))||(spec?.characters?.length??0)>1,
  // a game played in rounds (a persistent world has no round to play with bots)
  'loop:round':spec=>spec?.round?.mode!=='world'&&spec?.engine!=='forge',
  // the person's own database or server (loop/backend.mjs): only a spec that names one
  backend:spec=>!!spec?.backend&&typeof spec.backend==='object',
};
export const usesPart=(part,spec)=>!part||!USES[part]||USES[part](spec);

export function loadSource(dir=resolve(PROMPTS_DIR,'source')){
  const data=JSON.parse(readFileSync(resolve(dir,'rules.json'),'utf8'));
  const rules=new Map();
  for(const r of data.rules){
    if(rules.has(r.id))throw new Error(`rules.json: the rule "${r.id}" is written twice`);
    if(/\n/.test(r.text))throw new Error(`rules.json: the rule "${r.id}" must be one line`);
    rules.set(r.id,r);
  }
  return {dir,rules,frame:kind=>readFileSync(resolve(dir,`${kind}.frame.md`),'utf8')};
}

/**
 * The parts of a kit that carry notes: [{id, note: [lines]}] from each mechanic's manifest (tools/catalog.mjs
 * mechanicParts), or null when the kit has no catalog of parts.
 */
export async function loadParts(kit=fileURLToPath(new URL('../',import.meta.url))){
  const tool=resolve(kit,'tools/catalog.mjs');
  if(!existsSync(tool))return null;
  try{
    const m=await import(pathToFileURL(tool).href);
    if(typeof m.mechanicParts!=='function')return null;
    return (await m.mechanicParts({kit:resolve(kit,'kit')})).filter(p=>p.manifest).map(p=>({id:p.id,note:[].concat(p.manifest.note??[]).map(String)}));
  }catch{return null;}
}

/** The parts a spec uses, by the names the rules are tagged with (for a host that wants to show them). */
export const partsOf=spec=>[...Object.keys(USES).filter(p=>USES[p](spec)),...[...ids(spec)].filter(Boolean).map(id=>`mechanic:${id}`)].filter((p,i,a)=>a.indexOf(p)===i);

/** {{PARTS}} for one game: each mechanic in the spec with its own note. The notes are the kit's words, never the creator's. */
export function partsWords(spec,parts){
  if(spec?.engine==='forge')return 'This game\'s play is in its data tables, not in mechanics (see "On the forge engine" above).';
  const used=(spec?.mechanics??[]).map(m=>m?.id).filter(Boolean).filter((id,i,a)=>a.indexOf(id)===i);
  if(!used.length)return 'This plan uses no mechanics: the game is `rules.js` and its config alone.';
  if(!parts)return `The plan's mechanics: ${used.map(id=>`\`${id}\``).join(', ')}. Their own notes are in \`node {{KIT_TOOLS}}/catalog.mjs --json\` and in the \`rules.js\` stub.`;
  const one=id=>{const p=parts.find(x=>x.id===id);return `- \`${id}\`: ${p?.note?.length?p.note.join(' '):'(the kit carries no note for it; see its folder)'}`;};
  return [`Each mechanic in the plan brings its own notes (its folder is \`{{KIT}}/kit/mechanics/<id>/\`, and the \`rules.js\` stub names its callbacks at the point of use):`,'',...used.map(one)].join('\n');
}

/**
 * One brief. kind: 'build' | 'revise' | 'agents'. spec: the game's spec, or null for the whole brief (every rule).
 * parts: loadParts(kit), or null. → markdown with the host's placeholders ({{JOB}}, {{KIT}}, …) still in it.
 */
export function composeBrief({kind,spec=null,parts=null,source=loadSource()}){
  if(!BRIEF_KINDS.includes(kind))throw new Error(`composeBrief: kind is one of ${BRIEF_KINDS.join(', ')}`);
  const out=[];
  let n=0;
  for(const line of source.frame(kind).split('\n')){
    const m=/^\{\{RULE:([a-z0-9-]+)\}\}$/.exec(line.trim());
    let text=line;
    if(m){
      const r=source.rules.get(m[1]);
      if(!r)throw new Error(`${kind}.frame.md names the rule "${m[1]}", which rules.json does not have`);
      if(r.kinds&&!r.kinds.includes(kind))throw new Error(`${kind}.frame.md names the rule "${m[1]}", which is only for ${r.kinds.join(', ')}`);
      if(spec&&!usesPart(r.part,spec))continue;          // this game does not have the part: it does not read the rule
      text=r.text;
    }else if(line.trim()==='{{PARTS}}'&&spec)text=partsWords(spec,parts);
    // a numbered list keeps counting when a rule in it was left out
    const item=/^(\d+)\. /.exec(text);
    if(item){n++;text=`${n}. ${text.slice(item[0].length)}`;}
    else if(!/^\s+\S/.test(text))n=0;
    out.push(text);
  }
  let md=out.join('\n');
  if(kind==='agents')md=md.replaceAll('{{KIT_TOOLS}}','kits/research/gf-three/tools').replaceAll('{{KIT}}','kits/research/gf-three').replace(/`game\//g,'`games/<name>/').replace(/\.mjs game\b/g,'.mjs games/<name>');
  return md;
}

/** The kit's AGENTS.md with its game-building part replaced by the generated one (between AGENTS_MARKS). → the new
 *  text, or null when the file has no marks yet. */
export function placeAgentsPart(agentsMd,part=composeBrief({kind:'agents'})){
  const [a,b]=AGENTS_MARKS,i=agentsMd.indexOf(a),j=agentsMd.indexOf(b);
  if(i<0||j<i)return null;
  return `${agentsMd.slice(0,i)}${a}\n${part.trimEnd()}\n${agentsMd.slice(j)}`;
}

/** The generated files against the source. → [{file, path, want, have, same}] */
export function generatedFiles(dir=PROMPTS_DIR){
  const source=loadSource(resolve(dir,'source'));
  return Object.entries(GENERATED).map(([kind,file])=>{
    const path=resolve(dir,file),want=composeBrief({kind,source}),have=existsSync(path)?readFileSync(path,'utf8'):null;
    return {kind,file,path,want,have,same:want===have};
  });
}

if(isMain(import.meta)){
  const a=process.argv.slice(2),opt=k=>{const i=a.indexOf(k);return i>=0?a[i+1]:null;};
  if(a.includes('--write')||a.includes('--check')){
    let bad=0;
    for(const f of generatedFiles()){
      if(f.same){console.log(`${f.file}: up to date`);continue;}
      if(a.includes('--write')){writeFileSync(f.path,f.want);console.log(`${f.file}: written`);}
      else{bad++;console.log(`${f.file}: differs from research/studio-v2/prompts/source (run brief.mjs --write)`);}
    }
    process.exitCode=bad?1:0;
  }else if(BRIEF_KINDS.includes(a[0])){
    const spec=opt('--spec')?JSON.parse(readFileSync(opt('--spec'),'utf8')):null;
    process.stdout.write(composeBrief({kind:a[0],spec,parts:spec?await loadParts():null}));
  }else{
    console.error('usage: brief.mjs --write | --check | <build|revise|agents> [--spec spec.json]');process.exitCode=2;
  }
}
