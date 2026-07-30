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
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = email.trim().toLowerCase();
    const requester = await env.DEUCE_KV.get(`players:${key}`, 'json');
    const radius = radiusKm || 25;
    const now = Date.now();
    const listings = [];
    let cursor;

    do {
      const page = await env.DEUCE_KV.list({ prefix: 'listings:', cursor });
      cursor = page.list_complete ? undefined : page.cursor;

      for (const k of page.keys) {
        if (k.name === `listings:${key}`) continue;   // don't show me my own post
        const l = await env.DEUCE_KV.get(k.name, 'json');
        if (!l) continue;

        // A listing whose time has passed is dead weight even if KV hasn't
        // expired it yet, so filter it out here too.
        const when = new Date(l.dateTime).getTime();
        if (Number.isFinite(when) && when < now - 3600 * 1000) continue;

        let distanceKm = null;
        if (requester && requester.lat != null && l.lat != null) {
          distanceKm = haversineKm(requester.lat, requester.lng, l.lat, l.lng);
          if (distanceKm > radius) continue;
        }

        listings.push({
          name: l.name,
          email: l.email,
          rating: l.rating != null ? l.rating : null,
          level: l.level || '',
          dateTime: l.dateTime,
          location: l.location || '',
          format: l.format || 'individual',
          surface: l.surface || 'rapida',
          matchType: l.matchType || 'amistoso',
          note: l.note || '',
          distanceKm
        });
      }
    } while (cursor);

    // soonest first
    listings.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

    return new Response(JSON.stringify({ listings }), {
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
