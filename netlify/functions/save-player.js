import { getStore } from '@netlify/blobs';

async function geocodeZip(zip){
  if (!zip) return null;
  const digits = zip.replace(/\D/g, '');
  try {
    if (digits.length === 5) {
      // US ZIP code
      const res = await fetch(`https://api.zippopotam.us/us/${digits}`);
      if (res.ok) {
        const data = await res.json();
        const place = data.places && data.places[0];
        if (place) {
          return { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) };
        }
      }
    } else if (digits.length === 8) {
      // Brazilian CEP
      const formatted = `${digits.slice(0,5)}-${digits.slice(5)}`;
      const res = await fetch(`https://api.zippopotam.us/br/${formatted}`);
      if (res.ok) {
        const data = await res.json();
        const place = data.places && data.places[0];
        if (place) {
          return { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) };
        }
      }
    }
  } catch (err) {
    console.error('Geocode error:', err);
  }
  return null;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { playerId, name, email, zip, shareLocation, subscription } = body;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const store = getStore('players');
    const key = email.trim().toLowerCase();

    let coords = null;
    if (zip) {
      coords = await geocodeZip(zip);
    }

    await store.setJSON(key, {
      playerId: playerId || '',
      name: name || '',
      email: key,
      zip: zip || '',
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      shareLocation: !!shareLocation,
      subscription: subscription || null,
      updatedAt: new Date().toISOString()
    });
    return new Response(JSON.stringify({ ok: true, geocoded: !!coords }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
