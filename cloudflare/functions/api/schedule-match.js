export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { matchId, subscription, dateTime, opponent, email } = body;

    if (!matchId || !dateTime || (!subscription && !email)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    const player = email
      ? await env.DEUCE_KV.get(
          `players:${email.trim().toLowerCase()}`,
          'json'
        )
      : null;

    await env.DEUCE_KV.put(
      `reminders:${matchId}`,
      JSON.stringify({
        subscription: subscription || null,
        fcmToken: player?.fcmToken || null,
        dateTime,
        opponent: opponent || '',
        sent24h: false,
        sent1h: false,
        createdAt: new Date().toISOString()
      })
    );

    return new Response(
      JSON.stringify({ ok: true }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500 }
    );
  }
}
