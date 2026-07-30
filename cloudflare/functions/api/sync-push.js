// Stores a snapshot of the player's data so it survives a cleared browser
// or a new device. Deliberately a whole-snapshot, last-write-wins design
// rather than a field-level merge: this is a single-user dataset, and a
// simple model that is easy to reason about beats a clever one that can
// silently lose a match.

const MAX_BYTES = 2 * 1024 * 1024;   // 2 MB guardrail

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { email, payload, updatedAt } = body;

    if (!email || !payload) {
      return new Response(JSON.stringify({ error: 'Missing email or payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = email.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) {
      return new Response(JSON.stringify({ error: 'not_registered' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const record = JSON.stringify({
      payload,
      updatedAt: updatedAt || new Date().toISOString(),
      savedAt: new Date().toISOString()
    });

    if (record.length > MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'too_large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DEUCE_KV.put(`backup:${key}`, record);

    return new Response(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
