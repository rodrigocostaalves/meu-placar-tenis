export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { matchId } = await request.json();
    if (!matchId) {
      return new Response(JSON.stringify({ error: 'Missing matchId' }), { status: 400 });
    }
    await env.DEUCE_KV.delete(`reminders:${matchId}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
