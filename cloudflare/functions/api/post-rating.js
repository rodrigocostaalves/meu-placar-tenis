// Registers a player in the global ranking. Since the shared rating moved to
// the server (recompute-ratings.js, from confirmed matches only), this no
// longer accepts a rating from the device — it just guarantees the entry
// exists and keeps the name and country in step with the profile.

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
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    if (!player) {
      return new Response(JSON.stringify({ error: 'not_registered' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // The rating itself is now computed on the server from confirmed matches
    // (recompute-ratings.js), so the value the client sends is ignored. This
    // endpoint only makes sure the player HAS a ranking entry and that their
    // name and country stay current.
    const name = player.name || '';
    const cc = player.countryCode || '';
    const existing = await env.DEUCE_KV.get(`ratings:${key}`, 'json');

    if (existing && existing.name === name && (existing.countryCode || '') === cc) {
      return new Response(JSON.stringify({ ok: true, ranked: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await env.DEUCE_KV.put(`ratings:${key}`, JSON.stringify({
      email: key,
      name,
      countryCode: cc,
      rating: existing ? existing.rating : 1500,
      level: existing ? (existing.level || '') : '',
      played: existing ? (existing.played || 0) : 0,
      updatedAt: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ ok: true, ranked: true }), {
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
