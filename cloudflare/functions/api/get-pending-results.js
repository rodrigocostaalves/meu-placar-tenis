export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const list = await env.DEUCE_KV.list({ prefix: 'pending-results:' });
    const results = [];
    const responses = [];
    for (const k of list.keys) {
      const data = await env.DEUCE_KV.get(k.name, 'json');
      if (!data) continue;
      // waiting for MY confirmation
      if (data.toEmail === key && data.status === 'pending') {
        results.push(data);
      }
      // results I sent that have been answered and I haven't processed yet
      if ((data.fromEmail || '').trim().toLowerCase() === key
          && data.status && data.status !== 'pending'
          && !data.senderSeen) {
        responses.push(data);
      }
    }
    return new Response(JSON.stringify({ results, responses }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
