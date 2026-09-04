export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    const key = String(email || '').trim().toLowerCase();
    if (!key.includes('@')) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });

    const results = [];
    let cursor;
    do {
      const page = await env.DEUCE_KV.list({ prefix: 'pending-results:', cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const entry of page.keys) {
        const result = await env.DEUCE_KV.get(entry.name, 'json');
        if (result && String(result.fromEmail || '').trim().toLowerCase() === key) {
          // The Android client uses email and date as a safe fallback if it
          // was closed between submitting the score and saving resultId.
          results.push({
            id: result.id,
            status: result.status || 'pending',
            toEmail: result.toEmail || '',
            toName: result.toName || '',
            date: result.date || '',
            respondedAt: result.respondedAt || ''
          });
        }
      }
    } while (cursor);

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
