export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId } = await request.json();
    if (!inviteId) return new Response(JSON.stringify({ error: 'Missing inviteId' }), { status: 400 });
    const invite = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (invite && invite.status === 'cancelled') {
      invite.cancelSeen = true;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(invite));
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
