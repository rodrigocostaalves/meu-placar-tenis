export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId, response } = await request.json();
    if (!inviteId || !response) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const data = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (data) {
      data.status = response;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(data));
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
