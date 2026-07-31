// Removes everything this player has on the server. Required by both stores
// (Apple 5.1.1(v) and Google's Data Safety form) — asking people to email for
// deletion is not accepted.

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const key = email.trim().toLowerCase();
    const deleted = [];

    // The board listing carries an opaque handle with its own pointer key,
    // so read it before deleting or the pointer would be orphaned.
    const listing = await env.DEUCE_KV.get(`listings:${key}`, 'json');
    if (listing && listing.id) {
      await env.DEUCE_KV.delete(`listingref:${listing.id}`);
      deleted.push('listingref');
    }

    for (const prefix of ['players', 'ratings', 'backup', 'listings', 'email-verifications']) {
      await env.DEUCE_KV.delete(`${prefix}:${key}`);
      deleted.push(prefix);
    }

    // Invites are keyed by their own id, so they need a scan to find the ones
    // this player sent or received.
    let cursor;
    let invitesRemoved = 0;
    do {
      const page = await env.DEUCE_KV.list({ prefix: 'invites:', cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const k of page.keys) {
        const inv = await env.DEUCE_KV.get(k.name, 'json');
        if (inv && (inv.toEmail === key || (inv.fromEmail || '').toLowerCase() === key)) {
          await env.DEUCE_KV.delete(k.name);
          invitesRemoved++;
        }
      }
    } while (cursor);

    return new Response(JSON.stringify({ ok: true, deleted, invitesRemoved }), {
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
