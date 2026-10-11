// Repair ledger (open builder M2-E): notices when the repair loop is repeating itself. Pure functions plus one small
// tracker; the only side effect is the `write` callback the caller gives for the JSON-lines ledger. Written fresh from
// the idea in GameFactory-3A's code_asset.py repair loop (Apache-2.0); no code is ported, so no attribution file.
import {createHash} from 'node:crypto';

export const MAX_REPEATS=2;       // the same failing set may follow itself this many times; the second repeat stops
export const PROGRESS_WINDOW=3;   // this many verdicts in a row that shed no failing item = no progress

// Numbers change run to run inside messages (41% vs 43%, 7.13 m vs 7.06 m): digits become #, case and spacing fold.
export const normalizeMessage=s=>String(s??'').toLowerCase().replace(/\d+(?:[.,]\d+)*/g,'#').replace(/\s+/g,' ').trim();

// items: [{key, message}]. Verify failures look like "23 looks like the references: 41% ..." (normalizeVerdict.failed);
// play-test items are promise ids with the play-tester's note.
export function itemsOf({verdict=null,playtest=null}={}){
  const items=[];
  for(const f of verdict?.failed??[]){
    const s=String(f),i=s.indexOf(': ');
    items.push({key:`check ${(i<0?s:s.slice(0,i)).trim()}`,message:i<0?'':s.slice(i+2).trim()});
  }
  for(const id of playtest?.failedIds??[]){
    items.push({key:`play ${id}`,message:String(playtest.answers?.get?.(id)?.note??'')});
  }
  return items;
}

// Stable under reordering and under changing numbers. The empty set (a pass) has a fingerprint too.
export function fingerprint(items){
  const lines=[...new Set(items.map(x=>`${x.key}|${normalizeMessage(x.message)}`))].sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0,12);
}

// The stop reason for the latest of `rounds` ({fingerprint, items}): 'repeat' | 'oscillation' | 'no-progress' | null.
export function stopReason(rounds,{maxRepeats=MAX_REPEATS,window=PROGRESS_WINDOW}={}){
  const last=rounds.at(-1);
  if(!last||!last.items.length)return null;
  let run=0;
  for(let i=rounds.length-2;i>=0&&rounds[i].fingerprint===last.fingerprint;i--)run++;
  if(run>=maxRepeats)return 'repeat';
  if(!run&&rounds.slice(0,-1).some(r=>r.fingerprint===last.fingerprint))return 'oscillation';   // A, B, A
  if(rounds.length>=window){
    const w=rounds.slice(-window);
    if(w.every(r=>r.items.length)){
      const lastKeys=new Set(w.at(-1).items.map(x=>x.key));
      if(w[0].items.every(x=>lastKeys.has(x.key)))return 'no-progress';   // nothing the window began with has been fixed
    }
  }
  return null;
}

// One tracker per job. `write(line)` receives each finished round as one JSON line.
// `rounds`: the rounds an earlier process recorded (the loop's state file), so a resumed run still sees a repeat.
export function createRepairLedger({write=null,rounds:earlier=[],...opts}={}){
  const rounds=[...earlier],lines=[];
  const emit=r=>{
    const line={round:r.round,fingerprint:r.fingerprint,items:r.items,changed:r.changed??null,nextPassed:r.nextPassed??null,stop:r.stop??null};
    lines.push(line);
    if(write)write(JSON.stringify(line)+'\n');
  };
  return {
    get stop(){return rounds.at(-1)?.stop??null;},
    get rounds(){return rounds;},
    get lines(){return lines;},
    // After each verify (and play-test): the round that was repaired before this one is complete. → the stop reason.
    record({verdict=null,playtest=null}={}){
      const items=itemsOf({verdict,playtest}),prev=rounds.at(-1);
      if(prev){prev.nextPassed=items.length===0;emit(prev);}
      const r={round:rounds.length+1,fingerprint:fingerprint(items),items,stop:null};
      rounds.push(r);
      r.stop=stopReason(rounds,opts);
      return r.stop;
    },
    // After the repair round that followed the latest record: did the game's files change?
    changed(did){const r=rounds.at(-1);if(r)r.changed=!!did;},
    // End of the job: the last round has no next verify to say whether it passed.
    flush(){const r=rounds.at(-1);if(r&&!lines.some(l=>l.round===r.round)){r.nextPassed=r.items.length===0?true:null;emit(r);}},
  };
}
