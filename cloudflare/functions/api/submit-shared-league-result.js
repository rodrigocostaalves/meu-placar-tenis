import { applyLeagueResult, creatorIs, emailKey, id, json, memberByEmail, notify, readLeague, registeredPlayer, saveLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { leagueId, reporterEmail, playerOneId, playerTwoId, winnerId, sets } = await request.json();
    const reporter = emailKey(reporterEmail);
    const league = await readLeague(env, leagueId);
    if (!league || !league.shared) return json({ error: 'League not found' }, 404);
    const one = league.players.find(player => player.id === playerOneId);
    const two = league.players.find(player => player.id === playerTwoId);
    const winner = league.players.find(player => player.id === winnerId);
    if (!reporter.includes('@') || !one || !two || !winner || one.id === two.id || (winner.id !== one.id && winner.id !== two.id)) return json({ error: 'Invalid result' }, 400);
    const reporterPlayer = memberByEmail(league, reporter);
    const isCreator = creatorIs(league, reporter);
    if (!reporterPlayer && !isCreator) return json({ error: 'Only league members can register a result' }, 403);
    if (!isCreator && reporterPlayer.id !== one.id && reporterPlayer.id !== two.id) return json({ error: 'Only a match player or the creator can register this result' }, 403);

    const [oneRegistered, twoRegistered] = await Promise.all([registeredPlayer(env, one.email), registeredPlayer(env, two.email)]);
    const result = {
      id: id('league_result'), leagueId: league.id, reporterEmail: reporter, playerOneId: one.id, playerTwoId: two.id,
      winnerId: winner.id, loserId: winner.id === one.id ? two.id : one.id,
      sets: Array.isArray(sets) ? sets.slice(0, 5) : [], date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString()
    };

    // If either player has no Deuce Score account, no opponent is able to
    // validate. Only the owner may record it and it becomes official at once.
    if (!oneRegistered || !twoRegistered) {
      if (!isCreator) return json({ error: 'Only the league creator can record a match with a player without an account' }, 403);
      const match = applyLeagueResult(league, result);
      await saveLeague(env, league);
      return json({ ok: true, status: 'accepted', match });
    }

    const reviewer = reporterPlayer?.id === one.id ? two : one;
    result.status = 'pending';
    result.pendingFor = emailKey(reviewer.email);
    await env.DEUCE_KV.put(`pending-league-results:${result.id}`, JSON.stringify(result));
    const notified = await notify(env, result.pendingFor, `🎾 Resultado da liga ${league.name}`, `${league.players.find(p => p.id === result.winnerId)?.name || 'Um jogador'} registrou um placar. Abra o Deuce Score para validar.`);
    return json({ ok: true, status: 'pending', notified, resultId: result.id });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
