// Writes the public player record only when a meaningful field changed.
// This keeps repeated app/web openings from exhausting KV's daily write quota.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (!body.email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    const key = body.email.trim().toLowerCase();
    const previous = await env.DEUCE_KV.get(`players:${key}`, 'json');
    const next = {
      ...(previous || {}),
      playerId: body.playerId || previous?.playerId || '',
      name: body.name || '', country: body.country || '',
      countryCode: (body.countryCode || '').toUpperCase().slice(0, 2),
      email: key, zip: body.zip || '', shareLocation: !!body.shareLocation,
      // Do not erase Android FCM when the web site saves its VAPID subscription.
      subscription: body.subscription || previous?.subscription || null,
      fcmToken: previous?.fcmToken || null
    };
    const comparable = ({ updatedAt, ...value }) => value;
    if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(next))) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    next.updatedAt = new Date().toISOString();
    await env.DEUCE_KV.put(`players:${key}`, JSON.stringify(next));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
