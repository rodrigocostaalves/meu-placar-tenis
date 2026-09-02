import { creatorIs, json, readLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { leagueId, creatorEmail } = await request.json();
    const league = await readLeague(env, leagueId);
    if (!league || !league.shared) return json({ error: 'League not found' }, 404);
    if (!creatorIs(league, creatorEmail)) return json({ error: 'Only the creator can delete this league' }, 403);
    await env.DEUCE_KV.delete(`shared-leagues:${leagueId}`);
    // Index entries are harmless stale pointers; get-shared-leagues filters them.
    return json({ ok: true });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
