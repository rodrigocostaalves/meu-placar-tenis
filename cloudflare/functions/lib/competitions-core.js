export const emailKey = value => String(value || '').trim().toLowerCase();
export function requireThat(condition, code, status = 400) {
  if (!condition) throw Object.assign(new Error(code), {status});
}
const cleanName = value => String(value || '').trim().slice(0, 100);
export function members(c) { return [...new Set([c.owner, ...c.players.map(p => p.email)].filter(Boolean))]; }
function player(input, id) {
  const name = cleanName(input.name), email = emailKey(input.email);
  requireThat(name && (!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)), 'invalid_player');
  return {id, name, email, points: 0};
}
function uniquePlayers(players) {
  requireThat(new Set(players.map(p => p.name.toLowerCase())).size === players.length, 'duplicate_player');
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
  return {id: input.requestId, kind: input.kind, name: cleanName(input.name), owner: actor,
    ownerName: cleanName(input.ownerName) || actor, players, results: [], createdAt: new Date().toISOString()};
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
  const players = c.players.map(p => ({...p, points: Number(p.points) || 0}));
  for (const result of c.results) if (result.status === 'accepted') {
    const winner = players.find(p => p.id === result.winner);
    if (winner) winner.points += Number(result.points) || 0;
  }
  return players.sort((a,b) => b.points - a.points || a.name.localeCompare(b.name));
}
function accept(c, result, method) {
  if (c.kind === 'league') {
    const loser = result.winner === result.a ? result.b : result.a;
    const rank = standings(c).findIndex(p => p.id === loser) + 1;
    result.points = rank <= 10 ? 51-rank : [35,28,22,17,13,10,7,5,3][Math.min(8,Math.ceil(rank/10)-2)];
  }
  result.status = 'accepted'; result.approval = method; result.acceptedAt = new Date().toISOString();
  if (c.kind === 'tournament') invalidateDownstream(c);
}
export function mutateCompetition(original, input, actor) {
  const c = structuredClone(original);
  requireThat(members(c).includes(actor), 'not_member', 403);
  const owner = c.owner === actor;
  if (input.action === 'delete') { requireThat(owner, 'creator_only', 403); c.deleted = true; return c; }
  if (input.action === 'add') {
    requireThat(owner && c.kind === 'league', 'creator_only', 403);
    requireThat(c.players.length < 100, 'invalid_player_count');
    c.players.push(player(input.player || {}, input.requestId)); uniquePlayers(c.players); return c;
  }
  if (input.action === 'respond') {
    requireThat(['accepted','rejected'].includes(input.response), 'invalid_response');
    const result = c.results.find(m => m.id === input.resultId);
    requireThat(result, 'result_not_found', 404);
    requireThat(result.pendingFor === actor && result.reporter !== actor, 'opponent_only', 403);
    if (result.status === input.response) return original; // Safe retry; no second score/advance.
    requireThat(result.status === 'pending', 'result_already_resolved', 409);
    if (input.response === 'accepted') accept(c, result, 'opponent');
    else { result.status = 'rejected'; result.respondedAt = new Date().toISOString(); }
    return c;
  }
  requireThat(input.action === 'submit', 'invalid_action');
  const one = c.players.find(p => p.id === input.a), two = c.players.find(p => p.id === input.b);
  requireThat(one && two && one.id !== two.id, 'invalid_players');
  const isMatchPlayer = [one.email, two.email].includes(actor);
  requireThat(owner || isMatchPlayer, 'match_player_only', 403);
  requireThat(Array.isArray(input.sets) && input.sets.length >= 1 && input.sets.length <= 5 && input.sets.every(s => s && Number.isSafeInteger(s.a) && s.a >= 0 && Number.isSafeInteger(s.b) && s.b >= 0), 'invalid_score');
  // A replay of an already stored legacy operation is read-only. Preserve its
  // original outcome rather than recomputing history or trapping a retry.
  const replay = c.results.find(m => m.id === input.requestId);
  if (replay && replay.reporter === actor &&
      replay.signature === JSON.stringify([input.a,input.b,input.winner,input.sets,input.slot || '']))
    return original;
  // The server derives the same winner as Android; never trust a manual winner.
  const balance = input.sets.reduce((sum, s) => sum + Math.sign(s.a - s.b), 0);
  requireThat(balance !== 0, 'score_tied');
  input = {...input, winner: balance > 0 ? one.id : two.id};
  const reviewer = one.email === actor ? two.email : one.email;
  requireThat(owner || (reviewer && reviewer !== actor), 'creator_required_without_email', 403);
  const signature = JSON.stringify([input.a,input.b,input.winner,input.sets,input.slot || '']);
  const existing = c.results.find(m => m.id === input.requestId);
  if (existing) {
    requireThat(existing.reporter === actor && existing.signature === signature, 'request_conflict', 409);
    return original;
  }
  if (c.kind === 'tournament') {
    const slot = bracket(c).flat().find(s => s.slot === input.slot);
    requireThat(slot && slot.a && slot.b && slot.a === one.id && slot.b === two.id, 'bracket_changed', 409);
    const live = c.results.filter(m => m.slot === input.slot && ['pending','accepted'].includes(m.status));
    requireThat(owner || live.length === 0, 'result_already_pending_or_accepted', 409);
    for (const m of live) m.status = 'superseded';
  }
  const result = {id: input.requestId, a: one.id, b: two.id, winner: input.winner, sets: input.sets,
    slot: input.slot || '', signature, reporter: actor, pendingFor: owner ? '' : reviewer,
    status: 'pending', createdAt: new Date().toISOString()};
  c.results.push(result);
  if (owner) accept(c, result, 'creator');
  return c;
}
export function view(c, version) { return {...c, version, standings: standings(c), rounds: bracket(c)}; }
