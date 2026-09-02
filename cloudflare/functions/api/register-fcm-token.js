export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { email, token } = await request.json();

    if (!email || !token) {
      return new Response(
        JSON.stringify({ error: 'Missing email or token' }),
        { status: 400 }
      );
    }

    const key = email.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');

    if (!player) {
      return new Response(
        JSON.stringify({ error: 'not_registered' }),
        { status: 403 }
      );
    }

    await env.DEUCE_KV.put(
      `players:${key}`,
      JSON.stringify({
        ...player,
        fcmToken: token,
        updatedAt: new Date().toISOString()
      })
    );

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500 }
    );
  }
}
