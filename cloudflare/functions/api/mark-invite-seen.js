// Dismisses an accepted/declined notice from the sender's inbox.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId } = await request.json();
    if (!inviteId) {
      return new Response(JSON.stringify({ error: 'Missing inviteId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const data = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (data) {
      data.senderSeen = true;
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
