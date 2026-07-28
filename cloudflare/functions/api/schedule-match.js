export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { matchId, subscription, dateTime, opponent } = body;

    if (!matchId || !subscription || !dateTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    await env.DEUCE_KV.put(`reminders:${matchId}`, JSON.stringify({
      subscription,
      dateTime,
      opponent: opponent || '',
      sent24h: false,
      sent1h: false,
      createdAt: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
