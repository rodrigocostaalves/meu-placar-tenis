const MAX_BYTES = 2 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, payload, updatedAt } = await request.json();
    if (!email || !payload) return Response.json({ error: 'Missing email or payload' }, { status: 400 });
    const key = email.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) return Response.json({ error: 'not_registered' }, { status: 403 });

    const serializedPayload = JSON.stringify(payload);
    if (serializedPayload.length > MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });

    // A refresh, page return or repeated tap must not create another write if
    // the snapshot is exactly the same. Reads are plentiful; writes are not.
    const backupKey = `backup:${key}`;
    const current = await env.DEUCE_KV.get(backupKey, 'json');
    if (current?.payload && JSON.stringify(current.payload) === serializedPayload) {
      return Response.json({ ok: true, skipped: true, savedAt: current.savedAt || current.updatedAt || null });
    }

    const savedAt = new Date().toISOString();
    await env.DEUCE_KV.put(backupKey, JSON.stringify({ payload, updatedAt: updatedAt || savedAt, savedAt }));
    return Response.json({ ok: true, savedAt });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
