// Global ranking, highest rating first. Returns the top slice plus the
// requester's own position, so a player outside the top still sees where
// they stand.

const TOP_LIMIT = 100;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const key = (body.email || '').trim().toLowerCase();

    const all = [];
    let cursor;
    do {
      const page = await env.DEUCE_KV.list({ prefix: 'ratings:', cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const k of page.keys) {
        const r = await env.DEUCE_KV.get(k.name, 'json');
        if (r && Number.isFinite(Number(r.rating))) all.push(r);
      }
    } while (cursor);

    all.sort((a, b) => b.rating - a.rating || (b.played || 0) - (a.played || 0));

    let myPosition = null;
    let myRating = null;
    if (key) {
      const idx = all.findIndex(r => r.email === key);
      if (idx > -1) {
        myPosition = idx + 1;
        myRating = all[idx].rating;
      }
    }

    // Email is only needed to flag "this row is me" — don't leak the rest.
    const top = all.slice(0, TOP_LIMIT).map((r, i) => ({
      position: i + 1,
      name: r.name || '',
      rating: r.rating,
      level: r.level || '',
      played: r.played || 0,
      isMe: key ? r.email === key : false
    }));

    return new Response(JSON.stringify({
      total: all.length,
      myPosition,
      myRating,
      top
    }), {
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
