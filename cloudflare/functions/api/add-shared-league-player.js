import { creatorIs, emailKey, id, indexLeagueMembers, json, readLeague, saveLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { leagueId, creatorEmail, name, email } = await request.json();
    const league = await readLeague(env, leagueId);
    const playerName = String(name || '').trim().slice(0, 80);
    const playerEmail = emailKey(email);
    if (!league || !league.shared) return json({ error: 'League not found' }, 404);
    if (!creatorIs(league, creatorEmail)) return json({ error: 'Only the creator can add participants' }, 403);
    if (!playerName || league.players.length >= 100) return json({ error: 'Invalid participant or participant limit reached' }, 400);
    const duplicate = league.players.some(player => (playerEmail && emailKey(player.email) === playerEmail) || (!playerEmail && player.name.toLowerCase() === playerName.toLowerCase()));
    if (duplicate) return json({ error: 'Participant already exists' }, 409);
    league.players.push({ id: id('league_player'), name: playerName, email: playerEmail, points: 0 });
    await saveLeague(env, league);
    await indexLeagueMembers(env, league);
    return json({ ok: true, league });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
