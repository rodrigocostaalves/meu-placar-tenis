import { emailKey, json, readLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const email = emailKey((await request.json()).email);
    if (!email.includes('@')) return json({ error: 'Email is required' }, 400);
    const ids = await env.DEUCE_KV.get(`shared-league-index:${email}`, 'json') || [];
    const leagues = (await Promise.all(ids.map(leagueId => readLeague(env, leagueId)))).filter(Boolean);
    return json({ ok: true, leagues });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
