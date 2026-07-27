import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { matchId, subscription, dateTime, opponent } = body;

    if (!matchId || !subscription || !dateTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const store = getStore('reminders');
    await store.setJSON(matchId, {
      subscription,
      dateTime,
      opponent: opponent || '',
      sent24h: false,
      sent1h: false,
      createdAt: new Date().toISOString()
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
