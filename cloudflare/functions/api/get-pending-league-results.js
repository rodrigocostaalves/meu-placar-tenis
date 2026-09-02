import { emailKey, json, readLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const email = emailKey((await request.json()).email);
    if (!email.includes('@')) return json({ error: 'Email is required' }, 400);
    const list = await env.DEUCE_KV.list({ prefix: 'pending-league-results:' });
    const results = [];
    for (const key of list.keys) {
      const result = await env.DEUCE_KV.get(key.name, 'json');
      if (!result || result.status !== 'pending' || result.pendingFor !== email) continue;
      const league = await readLeague(env, result.leagueId);
      if (league) results.push({ ...result, leagueName: league.name, createdByName: league.createdByName });
    }
    return json({ ok: true, results });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
