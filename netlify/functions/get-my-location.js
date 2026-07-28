import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { email } = body;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const store = getStore('players');
    const key = email.trim().toLowerCase();
    const p = await store.get(key, { type: 'json' });
    if (p && p.lat != null && p.lng != null) {
      return new Response(JSON.stringify({ lat: p.lat, lng: p.lng }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ lat: null, lng: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
