import { applyLeagueResult, creatorIs, emailKey, id, json, memberByEmail, readLeague, saveLeague } from './league-shared.js';

export async function onRequestPost({ request, env }) {
  try {
    const { leagueId, reporterEmail, playerOneId, playerTwoId, winnerId, sets, requestId } = await request.json();
    const reporter = emailKey(reporterEmail);
    const league = await readLeague(env, leagueId);
    if (!league || !league.shared) return json({ error: 'League not found' }, 404);
    const one = league.players.find(p => p.id === playerOneId);
    const two = league.players.find(p => p.id === playerTwoId);
    if (!reporter.includes('@') || !one || !two || one.id === two.id || ![one.id,two.id].includes(winnerId)) return json({ error: 'Invalid players' }, 400);
    const member = memberByEmail(league, reporter);
    const creator = creatorIs(league, reporter);
    if (!creator && (!member || ![one.id,two.id].includes(member.id))) return json({ error: 'Only a match player or the creator can register this result' }, 403);
    const scoreValue = v => (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v));
    if (!Array.isArray(sets) || sets.some(s => !s || !scoreValue(s.a) || !scoreValue(s.b))) return json({ error: 'Use nonnegative whole-number scores' }, 400);
    const stableId = typeof requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(requestId) ? requestId : id('league_result');
    const existing = (league.matchLog || []).find(m => m.id === stableId);
    if (existing) return json({ok:true,status:'accepted',match:existing,skipped:true});
    const result = { id: stableId, leagueId, reporterEmail:reporter, playerOneId, playerTwoId, winnerId,
      loserId: winnerId === one.id ? two.id : one.id, sets, date: new Date().toISOString().slice(0,10) };
    const match = applyLeagueResult(league,result);
    await saveLeague(env,league);
    return json({ ok:true, status:'accepted', match });
  } catch (error) { return json({ error:String(error) },500); }
}
