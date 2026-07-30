export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const listing = await env.DEUCE_KV.get(`listings:${email.trim().toLowerCase()}`, 'json');
    return new Response(JSON.stringify({ listing: listing || null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
