// One active listing per player, keyed by email. Publishing again replaces it.
// KV expirationTtl does the cleanup for us, so no cron job is needed here:
// the listing disappears on its own a few hours after the proposed time.

const MIN_TTL = 3600;              // 1 hour
const MAX_TTL = 30 * 24 * 3600;    // 30 days
const GRACE_SECONDS = 6 * 3600;    // keep it around 6h past the start time

function ttlFor(dateTime) {
  const target = new Date(dateTime).getTime();
  if (Number.isNaN(target)) return 7 * 24 * 3600;
  const seconds = Math.floor((target - Date.now()) / 1000) + GRACE_SECONDS;
  return Math.min(MAX_TTL, Math.max(MIN_TTL, seconds));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { email, dateTime } = body;

    if (!email || !dateTime) {
      return new Response(JSON.stringify({ error: 'Missing email or dateTime' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = email.trim().toLowerCase();

    // Only verified, registered players can post — and we reuse their stored
    // coordinates so a listing can never carry a location the player didn't set.
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) {
      return new Response(JSON.stringify({ error: 'not_registered' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const listing = {
      email: key,
      name: player.name || '',
      rating: Number.isFinite(body.rating) ? Math.round(body.rating) : null,
      level: body.level || '',
      dateTime,
      location: (body.location || '').slice(0, 120),
      format: body.format === 'duplas' ? 'duplas' : 'individual',
      surface: body.surface || 'rapida',
      matchType: body.matchType || 'amistoso',
      note: (body.note || '').slice(0, 200),
      lat: player.lat != null ? player.lat : null,
      lng: player.lng != null ? player.lng : null,
      createdAt: new Date().toISOString()
    };

    await env.DEUCE_KV.put(`listings:${key}`, JSON.stringify(listing), {
      expirationTtl: ttlFor(dateTime)
    });

    return new Response(JSON.stringify({ ok: true }), {
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
