// Writes the public player record only when a meaningful field changed.
// This keeps repeated app/web openings from exhausting KV's daily write quota.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    if (typeof body.email !== 'string' || !body.email.includes('@')) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    const key = body.email.trim().toLowerCase();
    const previous = await env.DEUCE_KV.get(`players:${key}`, 'json');
    const next = {
      ...(previous || {}),
      playerId: body.playerId || previous?.playerId || '',
      name: body.name ?? previous?.name ?? '', country: body.country ?? previous?.country ?? '',
      countryCode: String(body.countryCode ?? previous?.countryCode ?? '').toUpperCase().slice(0, 2),
      email: key, zip: body.zip ?? previous?.zip ?? '',
      city: body.city ?? previous?.city ?? '', birthdate: body.birthdate ?? previous?.birthdate ?? '',
      shareLocation: body.shareLocation === undefined ? !!previous?.shareLocation : !!body.shareLocation,
      // Do not erase Android FCM when the web site saves its VAPID subscription.
      subscription: previous?.subscription || null,
      fcmToken: previous?.fcmToken || null
    };
    // Include subscription nested keys: JSON.stringify's array replacer would omit them.
    const stable = value => value && typeof value === 'object'
      ? (Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))) : value;
    const withoutTimestamp = ({updatedAt,...value}) => JSON.stringify(stable(value));
    if (previous && withoutTimestamp(previous) === withoutTimestamp(next)) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    next.updatedAt = new Date().toISOString();
    await env.DEUCE_KV.put(`players:${key}`, JSON.stringify(next));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
