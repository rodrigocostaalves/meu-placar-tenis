import { json, normalEmail, upsertRankingPlayer } from './_ranking.js';

async function geocodeZip(zip) {
  if (!zip) return null;
  const compact = String(zip).trim().replace(/\s/g, '');
  const digits = compact.replace(/\D/g, '');
  try {
    const endpoint = /^\d{5}(-?\d{4})?$/.test(compact)
      ? `https://api.zippopotam.us/us/${digits.slice(0, 5)}`
      : digits.length === 8
        ? `https://api.zippopotam.us/br/${digits.slice(0, 5)}-${digits.slice(5)}`
        : '';
    if (!endpoint) return null;
    const response = await fetch(endpoint);
    const place = response.ok ? (await response.json()).places?.[0] : null;
    return place ? { lat: Number(place.latitude), lng: Number(place.longitude) } : null;
  } catch (_) { return null; }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const email = normalEmail(body.email);
    if (!email) return json({ error: 'Missing email' }, 400);
    const coords = await geocodeZip(body.zip);
    const old = await env.DEUCE_KV.get(`players:${email}`, 'json');
    const player = {
      ...old,
      playerId: body.playerId || old?.playerId || '',
      name: body.name || old?.name || '', email,
      country: body.country || old?.country || '',
      countryCode: (body.countryCode || old?.countryCode || '').toUpperCase().slice(0, 2),
      city: body.city || old?.city || '', birthdate: body.birthdate || old?.birthdate || '',
      zip: body.zip || old?.zip || '',
      lat: coords?.lat ?? old?.lat ?? null, lng: coords?.lng ?? old?.lng ?? null,
      shareLocation: body.shareLocation ?? old?.shareLocation ?? false,
      subscription: body.subscription || old?.subscription || null,
      updatedAt: new Date().toISOString()
    };
    await env.DEUCE_KV.put(`players:${email}`, JSON.stringify(player));
    await upsertRankingPlayer(env, player);
    return json({ ok: true, geocoded: !!coords });
  } catch (error) { return json({ error: String(error) }, 500); }
}
