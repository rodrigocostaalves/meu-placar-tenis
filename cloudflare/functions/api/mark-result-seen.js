// Marks a result response as processed, so the sender's device only reacts once.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId } = await request.json();
    if (!resultId) {
      return new Response(JSON.stringify({ error: 'Missing resultId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const data = await env.DEUCE_KV.get(`pending-results:${resultId}`, 'json');
    if (data) {
      data.senderSeen = true;
      await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify(data));
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
