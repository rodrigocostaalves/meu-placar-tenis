function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, radiusKm } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const requester = await env.DEUCE_KV.get(`players:${key}`, 'json');

    if (!requester || requester.lat == null || requester.lng == null) {
      return new Response(JSON.stringify({ players: [], error: 'no_location' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const radius = radiusKm || 25;
    const list = await env.DEUCE_KV.list({ prefix: 'players:' });
    const results = [];

    for (const k of list.keys) {
      if (k.name === `players:${key}`) continue;
      const p = await env.DEUCE_KV.get(k.name, 'json');
      if (!p || !p.shareLocation || p.lat == null || p.lng == null) continue;
      const dist = haversineKm(requester.lat, requester.lng, p.lat, p.lng);
      if (dist <= radius) {
        results.push({ name: p.name, email: p.email, distanceKm: dist });
      }
    }

    results.sort((a, b) => a.distanceKm - b.distanceKm);

    return new Response(JSON.stringify({ players: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
