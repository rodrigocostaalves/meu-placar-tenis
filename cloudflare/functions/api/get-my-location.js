export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const p = await env.DEUCE_KV.get(`players:${key}`, 'json');
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
}
