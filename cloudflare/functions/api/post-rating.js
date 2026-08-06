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

    // A verified player enters the ranking immediately at the base rating,
    // before playing anything — zero matches is a valid state here.
    const raw = Number(played);
    const matches = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    const value = Number(rating);
    if (!Number.isFinite(value)) {
      return new Response(JSON.stringify({ ok: false, error: 'bad_rating' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const clamped = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(value)));
    const name = player.name || '';
    const playedCount = matches;
    const lvl = level || '';
    const cc = player.countryCode || '';

    // The client re-sends the rating every time the ranking screen opens, which
    // is usually identical to what is already stored. Skip the write in that
    // case so repeated views don't eat into the daily KV write allowance.
    // countryCode MUST be part of this comparison: without it, setting a country
    // never reached the ranking, because nothing else had changed.
    const existing = await env.DEUCE_KV.get(`ratings:${key}`, 'json');
    const unchanged = existing
      && existing.rating === clamped
      && existing.played === playedCount
      && existing.level === lvl
      && existing.name === name
      && (existing.countryCode || '') === cc;

    if (unchanged) {
      return new Response(JSON.stringify({ ok: true, ranked: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DEUCE_KV.put(`ratings:${key}`, JSON.stringify({
      email: key,
      name,
      countryCode: cc,
      rating: clamped,
      level: lvl,
      played: playedCount,
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
