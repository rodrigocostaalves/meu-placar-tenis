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
    const key = email.trim().toLowerCase();
    const store = getStore('pending-results');
    const { blobs } = await store.list();
    const results = [];
    for (const blobInfo of blobs) {
      const data = await store.get(blobInfo.key, { type: 'json' });
      if (data && data.toEmail === key && data.status === 'pending') {
        results.push(data);
      }
    }
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
