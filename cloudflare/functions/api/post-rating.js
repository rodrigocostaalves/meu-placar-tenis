import { json, normalEmail, upsertRankingPlayer } from './_ranking.js';

// Kept as the same public endpoint used by Android and the web app.
// It now registers a player in D1 instead of creating a per-user KV rating.
export async function onRequestPost({ request, env }) {
  try {
    const { email: rawEmail } = await request.json();
    const email = normalEmail(rawEmail);
    if (!email) return json({ error: 'Missing email' }, 400);
    const player = await env.DEUCE_KV.get(`players:${email}`, 'json');
    if (!player) return json({ error: 'not_registered' }, 403);
    await upsertRankingPlayer(env, player);
    return json({ ok: true, ranked: true });
  } catch (error) { return json({ error: String(error) }, 500); }
}
