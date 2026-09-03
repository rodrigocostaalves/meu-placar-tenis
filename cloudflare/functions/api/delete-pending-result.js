export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId, email } = await request.json();
    const owner = String(email || '').trim().toLowerCase();
    if (!resultId || !owner.includes('@')) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    const key = `pending-results:${resultId}`;
    const result = await env.DEUCE_KV.get(key, 'json');
    if (!result) return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    if (String(result.fromEmail || '').trim().toLowerCase() !== owner) return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 });
    if (result.status !== 'pending') return new Response(JSON.stringify({ error: 'Confirmed results cannot be deleted locally' }), { status: 409 });
    await env.DEUCE_KV.delete(key);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
