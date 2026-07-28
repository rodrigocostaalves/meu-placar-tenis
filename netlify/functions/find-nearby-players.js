import { getStore } from '@netlify/blobs';

function haversineKm(lat1, lng1, lat2, lng2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { email, radiusKm } = body;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const store = getStore('players');
    const key = email.trim().toLowerCase();
    const requester = await store.get(key, { type: 'json' });

    if (!requester || requester.lat == null || requester.lng == null) {
      return new Response(JSON.stringify({ players: [], error: 'no_location' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const radius = radiusKm || 25;
    const { blobs } = await store.list();
    const results = [];

    for (const blobInfo of blobs) {
      if (blobInfo.key === key) continue;
      const p = await store.get(blobInfo.key, { type: 'json' });
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
};
