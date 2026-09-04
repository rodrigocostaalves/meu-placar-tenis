export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, token } = await request.json();
    if (!email || !token) return Response.json({ error: 'Missing email or token' }, { status: 400 });
    const key = email.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) return Response.json({ error: 'not_registered' }, { status: 403 });
    // Firebase often reports the same token more than once. Do not rewrite an
    // unchanged player record, which also avoids a same-key write collision.
    if (player.fcmToken === token) return Response.json({ ok: true, skipped: true });
    await env.DEUCE_KV.put(`players:${key}`, JSON.stringify({ ...player, fcmToken: token, updatedAt: new Date().toISOString() }));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
