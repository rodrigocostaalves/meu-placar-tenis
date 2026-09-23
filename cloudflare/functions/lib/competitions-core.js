import {scheduledLeague,newLeagueRules,completedLeagueScore,leagueStandings,generateRound,roundComplete} from './league-rules.js';
export const emailKey = value => String(value || '').trim().toLowerCase();
export function requireThat(condition, code, status = 400) {
  if (!condition) throw Object.assign(new Error(code), {status});
}
const cleanName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0, 100);
export function members(c) { return [...new Set([c.owner, ...c.players.map(p => p.email)].filter(Boolean))]; }
function player(input, id) {
  requireThat(input && typeof input==='object' && !Array.isArray(input),'invalid_player');
  const name = cleanName(input.name), email = emailKey(input.email);
  requireThat(name && (!email || (email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))), 'invalid_player');
  return {id, name, email, points: 0};
}
function uniquePlayers(players) {
  requireThat(new Set(players.map(p => cleanName(p.name).toLowerCase())).size === players.length, 'duplicate_player');
  const emails = players.map(p => p.email).filter(Boolean);
  requireThat(new Set(emails).size === emails.length, 'duplicate_email');
}
export function createCompetition(input, actor) {
  requireThat(['league', 'tournament'].includes(input.kind), 'invalid_kind');
  requireThat(cleanName(input.name), 'name_required');
  requireThat(Array.isArray(input.players), 'invalid_players');
  const players = input.players.map((p, i) => player(p, `p${i}`));
  uniquePlayers(players);
  requireThat(input.kind === 'league' ? players.length >= 2 && players.length <= 100 : [4, 8, 16].includes(players.length), 'invalid_player_count');
  const c = {id: input.requestId, kind: input.kind, name: cleanName(input.name), owner: actor,
    ownerName: cleanName(input.ownerName) || actor, players, results: [], createdAt: new Date().toISOString()};
  if(c.kind==='league') {
    c.leagueRules=newLeagueRules(input.leagueRules,players.length);
    c.leagueRounds=[]; c.state='active';
  }
  return c;
}
export function bracket(c) {
  if (c.kind !== 'tournament') return [];
  let pairs = Array.from({length: c.players.length / 2}, (_, i) => [c.players[i*2].id, c.players[i*2+1].id]);
  const rounds = [];
  for (let r = 0; pairs.length; r++) {
    const round = pairs.map(([a,b], index) => {
      const slot = `${r}:${index}`;
      const result = [...c.results].reverse().find(m => m.slot === slot && m.status === 'accepted' && m.a === a && m.b === b);
      return {slot, a: a || '', b: b || '', winner: result?.winner || '', resultId: result?.id || ''};
    });
    rounds.push(round);
    if (pairs.length === 1) break;
    pairs = Array.from({length: pairs.length/2}, (_, i) => [round[i*2].winner, round[i*2+1].winner]);
  }
  return rounds;
}
function invalidateDownstream(c) {
  for (const round of bracket(c)) for (const slot of round) {
    for (const m of c.results) if (m.slot === slot.slot && ['pending','accepted'].includes(m.status) && (m.a !== slot.a || m.b !== slot.b)) m.status = 'superseded';
  }
}
export function standings(c) {
  if(scheduledLeague(c)) return leagueStandings(c);
  const players = c.players.map(p => ({...p, points: Number(p.points) || 0}));
  for (const result of c.results) if (result.status === 'accepted') {
    const winner = players.find(p => p.id === result.winner);
    if (winner) winner.points += Number(result.points) || 0;
  }
  return players.sort((a,b) => b.points - a.points || a.name.localeCompare(b.name));
}
function accept(c, result, method) {
  // A proposed correction leaves the previously accepted score in force until approval.
  if(result.replacesId) {
    const old=c.results.find(m=>m.id===result.replacesId);
    requireThat(old?.status==='accepted' && old.slot===result.slot,'result_already_resolved',409);
    old.status='superseded';
  }
  if (c.kind === 'league') {
    const loser = result.winner === result.a ? result.b : result.a;
    if(scheduledLeague(c)) {
      result.points=result.outcome==='double_walkover'?0:3;
      result.loserPoints=result.sets.some(s=>loser===result.a?s.a>s.b:s.b>s.a)?1:0;
    } else {
      const rank = standings(c).findIndex(p => p.id === loser) + 1;
      result.points = rank <= 10 ? 51-rank : [35,28,22,17,13,10,7,5,3][Math.min(8,Math.ceil(rank/10)-2)];
    }
  }
  result.status = 'accepted'; result.approval = method; result.acceptedAt = new Date().toISOString();
  if (c.kind === 'tournament') invalidateDownstream(c);
}
export function mutateCompetition(original, input, actor) {
  const c = structuredClone(original);
  requireThat(members(c).includes(actor), 'not_member', 403);
  const owner = c.owner === actor;
  if (input.action === 'delete') { requireThat(owner, 'creator_only', 403); c.deleted = true; return c; }
  if(input.action==='generate_round' && c.leagueRounds?.some(r=>r.id===input.requestId)) {
    requireThat(owner,'creator_only',403); return original;
  }
  if(input.action==='finish' && c.finishedOperation===input.requestId) {
    requireThat(owner,'creator_only',403); return original;
  }
  requireThat(c.state!=='finished','league_finished',409);
  if(input.action==='generate_round') {
    requireThat(owner,'creator_only',403); generateRound(c,input.requestId); return c;
  }
  if(input.action==='finish') {
    requireThat(owner && c.kind==='league','creator_only',403);
    requireThat(!c.results.some(m=>m.status==='pending') && (!scheduledLeague(c)||c.leagueRounds.every(r=>roundComplete(c,r))), 'round_incomplete',409);
    c.state='finished';c.finishedAt=new Date().toISOString();c.finishedOperation=input.requestId;return c;
  }
  if (input.action === 'add') {
    requireThat(owner && c.kind === 'league', 'creator_only', 403);
    requireThat(!scheduledLeague(c)||!c.leagueRounds.length,'roster_locked',409);
    requireThat(c.players.length < 100, 'invalid_player_count');
    c.players.push(player(input.player || {}, input.requestId)); uniquePlayers(c.players);
    if(scheduledLeague(c)) c.leagueRules=newLeagueRules(c.leagueRules,c.players.length);
    return c;
  }
  if (input.action === 'respond') {
    requireThat(['accepted','rejected'].includes(input.response), 'invalid_response');
    const result = c.results.find(m => m.id === input.resultId);
    requireThat(result, 'result_not_found', 404);
    // League organizers may resolve any pending score, including their own older submissions.
    requireThat((c.kind === 'league' && owner) || (result.pendingFor === actor && result.reporter !== actor), 'opponent_only', 403);
    if (result.status === input.response) return original; // Safe retry; no second score/advance.
    requireThat(result.status === 'pending', 'result_already_resolved', 409);
    if (input.response === 'accepted') accept(c, result, owner?'organizer':'opponent');
    else { result.status = 'rejected'; result.respondedAt = new Date().toISOString(); }
    return c;
  }
  requireThat(input.action === 'submit', 'invalid_action');
  const one = c.players.find(p => p.id === input.a), two = c.players.find(p => p.id === input.b);
  requireThat(one && two && one.id !== two.id, 'invalid_players');
  requireThat(!one.deleted&&!two.deleted,'invalid_players');
  const isMatchPlayer = [one.email, two.email].includes(actor);
  requireThat(owner || isMatchPlayer, 'match_player_only', 403);
  const walkover=['walkover','double_walkover'].includes(input.outcome);
  if(walkover) {
    requireThat(scheduledLeague(c),'legacy_league');
    requireThat(owner,'creator_only',403);
    requireThat((input.outcome==='double_walkover'?input.winner==='':[one.id,two.id].includes(input.winner)) && Array.isArray(input.sets) && !input.sets.length,'invalid_score');
  } else {
    requireThat(!input.outcome || input.outcome==='played','invalid_score');
    requireThat(Array.isArray(input.sets) && input.sets.length >= 1 && input.sets.length <= 5 && input.sets.every(s => s && Number.isSafeInteger(s.a) && s.a >= 0 && Number.isSafeInteger(s.b) && s.b >= 0), 'invalid_score');
  }
  // A replay of an already stored legacy operation is read-only. Preserve its
  // original outcome rather than recomputing history or trapping a retry.
  const replay = c.results.find(m => m.id === input.requestId);
  if (replay && replay.reporter === actor &&
      replay.signature === JSON.stringify([input.a,input.b,input.winner,input.sets,input.slot || '']))
    return original;
  // The server derives the same winner as Android; never trust a manual winner.
  const balance = input.sets.reduce((sum, s) => sum + Math.sign(s.a - s.b), 0);
  requireThat(walkover || balance !== 0, 'score_tied');
  input = {...input, winner: walkover?input.winner:(balance > 0 ? one.id : two.id), sets:input.sets.map(s=>({a:s.a,b:s.b}))};
  const reviewer = one.email === actor ? two.email : one.email;
  requireThat(c.kind==='league' || owner || (reviewer && reviewer !== actor), 'creator_required_without_email', 403);
  const signature = JSON.stringify([input.a,input.b,input.winner,input.sets,input.slot || '']);
  const existing = c.results.find(m => m.id === input.requestId);
  if (existing) {
    requireThat(existing.reporter === actor && existing.signature === signature, 'request_conflict', 409);
    return original;
  }
  if(scheduledLeague(c)) {
    requireThat(walkover || completedLeagueScore(input.sets),'incomplete_league_score');
    const round=c.leagueRounds.at(-1), match=round?.matches.find(s=>s.slot===input.slot);
    requireThat(match && !match.void && match.a===one.id && match.b===two.id,'round_changed',409);
    requireThat(!c.results.some(m=>m.slot===input.slot&&m.status==='pending'),'result_already_pending_or_accepted',409);
    const accepted=c.results.find(m=>m.slot===input.slot&&m.status==='accepted');
    requireThat(accepted?input.replacesId===accepted.id:!input.replacesId,'result_already_resolved',409);
  }
  if (c.kind === 'tournament') {
    const slot = bracket(c).flat().find(s => s.slot === input.slot);
    requireThat(slot && slot.a && slot.b && slot.a === one.id && slot.b === two.id, 'bracket_changed', 409);
    const live = c.results.filter(m => m.slot === input.slot && ['pending','accepted'].includes(m.status));
    requireThat(owner || live.length === 0, 'result_already_pending_or_accepted', 409);
    for (const m of live) m.status = 'superseded';
  }
  const direct=owner;
  requireThat(direct || (reviewer && reviewer!==actor) || (!owner && c.kind==='league'),'reviewer_required',403);
  const result = {id: input.requestId, a: one.id, b: two.id, winner: input.winner, sets: input.sets,
    slot: input.slot || '', signature, reporter: actor, pendingFor: direct ? '' : reviewer,
    status: 'pending', createdAt: new Date().toISOString()};
  if(walkover) result.outcome=input.outcome;
  if(scheduledLeague(c) && input.replacesId) result.replacesId=input.replacesId;
  c.results.push(result);
  if (direct) accept(c, result, 'creator');
  return c;
}
export function view(c, version) { return {...c, version, standings: standings(c), rounds: bracket(c)}; }
