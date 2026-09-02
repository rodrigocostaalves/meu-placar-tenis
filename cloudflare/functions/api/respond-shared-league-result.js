import { applyLeagueResult, emailKey, json, notify, readLeague, saveLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId, email, response } = await request.json();
    const reviewer = emailKey(email);
    if (!resultId || !reviewer.includes('@') || !['accepted', 'rejected'].includes(response)) return json({ error: 'Invalid response' }, 400);
    const result = await env.DEUCE_KV.get(`pending-league-results:${resultId}`, 'json');
    if (!result || result.status !== 'pending') return json({ error: 'Pending result not found' }, 404);
    if (emailKey(result.pendingFor) !== reviewer) return json({ error: 'Only the opponent can validate this result' }, 403);
    const league = await readLeague(env, result.leagueId);
    if (!league) return json({ error: 'League not found' }, 404);
    result.status = response;
    result.respondedAt = new Date().toISOString();
    let match = null;
    if (response === 'accepted') {
      match = applyLeagueResult(league, result);
      await saveLeague(env, league);
    }
    await env.DEUCE_KV.put(`pending-league-results:${resultId}`, JSON.stringify(result));
    await notify(env, result.reporterEmail, response === 'accepted' ? '✅ Resultado da liga confirmado' : '🎾 Resultado da liga recusado', response === 'accepted' ? `O placar da liga ${league.name} foi validado.` : `O placar da liga ${league.name} foi recusado.`);
    return json({ ok: true, status: response, match });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
