export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, code } = await request.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const data = await env.DEUCE_KV.get(`email-verifications:${key}`, 'json');

    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: 'no_code' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const ageMinutes = (Date.now() - data.createdAt) / 60000;
    if (ageMinutes > 15) {
      await env.DEUCE_KV.delete(`email-verifications:${key}`);
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

    await env.DEUCE_KV.delete(`email-verifications:${key}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
