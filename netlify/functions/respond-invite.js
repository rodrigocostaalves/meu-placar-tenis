import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { inviteId, response } = body;
    if (!inviteId || !response) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const store = getStore('invites');
    const data = await store.get(inviteId, { type: 'json' });
    if (data) {
      data.status = response;
      await store.setJSON(inviteId, data);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
