// Versioned rules: existing competitions without this marker keep their history.
export const scheduledLeague = c => c.kind === 'league' && c.leagueRules?.version === 1;
function check(ok, code) { if (!ok) throw Object.assign(new Error(code), {status: 409}); }
export function newLeagueRules(input, count) {
  const system = input?.system || 'round_robin';
  const intervalDays = input?.intervalDays ?? 7;
  const startDate = input?.startDate || new Date().toISOString().slice(0,10);
  const maximum = count % 2 ? count : count - 1;
  const rounds = system === 'round_robin' ? maximum : (input?.rounds ?? Math.min(5, maximum));
  check(['round_robin','swiss'].includes(system) && Number.isInteger(intervalDays) && intervalDays >= 1 && intervalDays <= 365 &&
    Number.isInteger(rounds) && rounds >= 1 && rounds <= maximum && /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    Number.isFinite(Date.parse(startDate)) && new Date(startDate).toISOString().slice(0,10) === startDate, 'invalid_league_rules');
  // Reserve storage for approval/correction history in the competition record.
  check(Math.floor(count/2)*rounds<=2000,'league_schedule_limit');
  return {version:1, scoring:'win3_lossset1', system, intervalDays, startDate, rounds};
}
export function completedLeagueScore(sets) {
  // One set or best-of-three. A deciding match tie-break is allowed at one set all.
  if (!Array.isArray(sets) || !sets.length || sets.length > 3) return false;
  let a = 0, b = 0;
  for (let i=0; i<sets.length; i++) {
    if (a === 2 || b === 2) return false;
    const s=sets[i], hi=Math.max(s.a,s.b), lo=Math.min(s.a,s.b);
    const normal=(hi===6 && lo<=4)||(hi===7 && (lo===5||lo===6));
    const matchTieBreak=i===2 && a===1 && b===1 && hi<=100 && ((hi===10&&lo<=8)||(hi>10&&hi-lo===2));
    if (!normal && !matchTieBreak) return false;
    if(s.a>s.b) a++; else b++;
  }
  return a!==b;
}
export function leagueStandings(c) {
  const rows=c.players.map(p=>({...p,points:0,wins:0,losses:0,setsWon:0,setsLost:0,gamesWon:0,gamesLost:0}));
  for(const m of c.results.filter(m=>m.status==='accepted')) {
    const a=rows.find(p=>p.id===m.a),b=rows.find(p=>p.id===m.b);
    if(!a||!b) continue;
    if(m.outcome==='double_walkover') {a.losses++;b.losses++;continue;}
    const winner=m.winner===a.id?a:b,loser=winner===a?b:a;
    winner.points+=3; winner.wins++; loser.losses++;
    for(const s of m.sets) {
      if(s.a>s.b) {a.setsWon++;b.setsLost++;} else {b.setsWon++;a.setsLost++;}
      // A deciding match tie-break counts as a set, not 10+ ordinary games.
      const tie=Math.max(s.a,s.b)>=10;
      a.gamesWon+=tie?(s.a>s.b?1:0):s.a; a.gamesLost+=tie?(s.b>s.a?1:0):s.b;
      b.gamesWon+=tie?(s.b>s.a?1:0):s.b; b.gamesLost+=tie?(s.a>s.b?1:0):s.a;
    }
    if(m.sets.some(s=>loser===a?s.a>s.b:s.b>s.a)) loser.points++;
  }
  const sporting=(a,b)=>b.points-a.points||b.wins-a.wins||
    (b.setsWon-b.setsLost)-(a.setsWon-a.setsLost)||(b.gamesWon-b.gamesLost)-(a.gamesWon-a.gamesLost);
  rows.sort((a,b)=>sporting(a,b)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  rows.forEach((p,i)=>{p.rank=i && sporting(rows[i-1],p)===0?rows[i-1].rank:i+1;});
  return rows;
}
const pairKey=(a,b)=>[a,b].sort().join(':');
function shuffled(ids) {
  const list=[...ids];
  for(let i=list.length-1;i>0;i--) {
    const range=i+1,limit=Math.floor(0x100000000/range)*range;
    let n; do {n=crypto.getRandomValues(new Uint32Array(1))[0];} while(n>=limit);
    const j=n%range; [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}
export function roundComplete(c, round) {
  return !c.results.some(m=>m.status==='pending' && round.matches.some(s=>s.slot===m.slot)) &&
    round.matches.every(s=>!s.b || s.void || c.players.some(p=>[s.a,s.b].includes(p.id)&&p.deleted) ||
      c.results.some(m=>m.slot===s.slot && m.status==='accepted'));
}
function swissPairs(c, ranked) {
  const previous=new Set(c.leagueRounds.flatMap(r=>r.matches.filter(m=>m.b).map(m=>pairKey(m.a,m.b))));
  const byes=new Map(ranked.map(id=>[id,c.leagueRounds.filter(r=>r.matches.some(m=>m.a===id&&!m.b)).length]));
  // Bounded search prefers nearby standings but never silently repeats opponents.
  let budget=50000;
  function solve(ids) {
    if(!ids.length) return [];
    if(--budget<0) return null;
    const [a,...rest]=ids;
    for(let i=0;i<rest.length;i++) if(!previous.has(pairKey(a,rest[i]))) {
      const tail=solve(rest.filter((_,j)=>j!==i));
      if(tail) return [[a,rest[i]],...tail];
    }
    return null;
  }
  if(ranked.length%2===0) return solve(ranked);
  const candidates=[...ranked].reverse().sort((a,b)=>byes.get(a)-byes.get(b));
  const least=byes.get(candidates[0]);
  for(const bye of candidates.filter(id=>byes.get(id)===least)) {
    const pairs=solve(ranked.filter(id=>id!==bye));
    if(pairs) return [...pairs,[bye,'']];
  }
  return null;
}
export function generateRound(c, requestId) {
  check(scheduledLeague(c), 'legacy_league');
  const last=c.leagueRounds.at(-1);
  check(!last||roundComplete(c,last), 'round_incomplete');
  check(c.leagueRounds.length<c.leagueRules.rounds,'all_rounds_generated');
  const index=c.leagueRounds.length;
  if(!c.drawOrder) c.drawOrder=shuffled(c.players.map(p=>p.id));
  let pairs;
  if(c.leagueRules.system==='round_robin') {
    const ring=[...c.drawOrder]; if(ring.length%2) ring.push('');
    for(let i=0;i<index;i++) ring.splice(1,0,ring.pop());
    pairs=Array.from({length:ring.length/2},(_,i)=>[ring[i],ring[ring.length-1-i]])
      .map(([a,b])=>a?[a,b]:[b,a]);
  } else {
    const ranked=index?leagueStandings(c).filter(p=>!p.deleted).map(p=>p.id):c.drawOrder.filter(id=>!c.players.find(p=>p.id===id)?.deleted);
    check(ranked.length>=2,'not_enough_players');
    pairs=swissPairs(c,ranked);
    check(pairs,'pairing_unavailable');
  }
  const date=new Date(c.leagueRules.startDate+'T00:00:00Z');
  date.setUTCDate(date.getUTCDate()+index*c.leagueRules.intervalDays);
  const startDate=date.toISOString().slice(0,10);
  date.setUTCDate(date.getUTCDate()+c.leagueRules.intervalDays-1);
  c.leagueRounds.push({id:requestId,number:index+1,startDate,endDate:date.toISOString().slice(0,10),
    matches:pairs.map(([a,b],i)=>({slot:`league:${index+1}:${i}`,a,b,
      void:c.players.some(p=>[a,b].includes(p.id)&&p.deleted)}))});
}
