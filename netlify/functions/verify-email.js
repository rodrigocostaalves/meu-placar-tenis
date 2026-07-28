import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const store = getStore('email-verifications');
    const data = await store.get(key, { type: 'json' });

    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: 'no_code' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ageMinutes = (Date.now() - data.createdAt) / 60000;
    if (ageMinutes > 15) {
      await store.delete(key);
      return new Response(JSON.stringify({ ok: false, error: 'expired' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (data.code !== String(code).trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'wrong_code' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await store.delete(key);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
