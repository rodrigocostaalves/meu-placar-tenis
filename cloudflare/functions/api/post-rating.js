// Stores a player's rating so it can appear in the global ranking.
// The rating is computed on the device (from that player's own match
// history), so we clamp it to a plausible band and require at least one
// recorded match before it counts.

const MIN_RATING = 800;
const MAX_RATING = 2600;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, rating, level, played } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = email.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) {
      return new Response(JSON.stringify({ error: 'not_registered' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const matches = Number(played);
    const value = Number(rating);
    if (!Number.isFinite(value) || !Number.isFinite(matches) || matches < 1) {
      // nothing worth ranking yet — drop any stale entry and stop
      await env.DEUCE_KV.delete(`ratings:${key}`);
      return new Response(JSON.stringify({ ok: true, ranked: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(value)));

    await env.DEUCE_KV.put(`ratings:${key}`, JSON.stringify({
      email: key,
      name: player.name || '',
      rating: clamped,
      level: level || '',
      played: Math.round(matches),
      updatedAt: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ ok: true, ranked: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
