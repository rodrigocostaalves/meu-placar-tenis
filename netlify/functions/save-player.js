import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { playerId, name, email, subscription } = body;
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const store = getStore('players');
    const key = email.trim().toLowerCase();
    await store.setJSON(key, {
      playerId: playerId || '',
      name: name || '',
      email: key,
      subscription: subscription || null,
      updatedAt: new Date().toISOString()
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
