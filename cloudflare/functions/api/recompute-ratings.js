// Rebuilds every player's rating on ONE shared scale, from matches both
// players confirmed. Until now each device computed its own Elo from its own
// history, so two players' numbers were never strictly comparable — the
// ranking mixed separate scales. This is the fix.
//
// Deliberately a full recompute rather than incremental: the whole point is
// that every rating comes from the same ordered pass, and an incremental
// update would drift the moment a match is confirmed out of order.

const BASE = 1500;
const MIN_RATING = 800;
const MAX_RATING = 2600;

function kFactor(played) {
  if (played < 10) return 40;
  if (played < 30) return 32;
  return 24;
}

function marginMultiplier(sets) {
  if (!Array.isArray(sets) || !sets.length) return 1;
  let a = 0, b = 0;
  for (const s of sets) {
    const x = Number(s.a), y = Number(s.b);
    if (Number.isFinite(x) && Number.isFinite(y)) { a += x; b += y; }
  }
  const total = a + b;
  if (!total) return 1;
  return 0.75 + 0.5 * (Math.abs(a - b) / total);
}

function levelFromRating(r) {
  const lvl = 1 + (r - 1200) / 75;
  return Math.min(10, Math.max(1, lvl)).toFixed(1);
}

export async function recomputeRatings(env) {
  // 1. collect every confirmed match.
  //
  // Two sources on purpose. cmatch:* is the canonical record written from now
  // on, but every result confirmed BEFORE that record existed only lives in
  // pending-results:* with status 'accepted'. Reading both means the history
  // already in KV counts immediately, with no separate backfill step, and the
  // pass stays self-healing if a cmatch write is ever missed.
  const byId = new Map();
  let cursor;

  do {
    const page = await env.DEUCE_KV.list({ prefix: 'cmatch:', cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const k of page.keys) {
      const g = await env.DEUCE_KV.get(k.name, 'json');
      if (g && g.a && g.b) byId.set(g.id || k.name, g);
    }
  } while (cursor);

  let c0;
  do {
    const page = await env.DEUCE_KV.list({ prefix: 'pending-results:', cursor: c0 });
    c0 = page.list_complete ? undefined : page.cursor;
    for (const k of page.keys) {
      const r = await env.DEUCE_KV.get(k.name, 'json');
      if (!r || r.status !== 'accepted') continue;
      const id = r.id || k.name.slice('pending-results:'.length);
      if (byId.has(id)) continue;               // cmatch wins
      const a = (r.fromEmail || '').trim().toLowerCase();
      const b = (r.toEmail || '').trim().toLowerCase();
      if (!a || !b) continue;
      byId.set(id, {
        id,
        a, b,
        date: r.date || '',
        sets: Array.isArray(r.sets) ? r.sets : [],
        winner: r.result === 'V' ? 'a' : 'b',
        confirmedAt: r.respondedAt || r.createdAt || ''
      });
    }
  } while (c0);

  const games = [...byId.values()];

  games.sort((x, y) =>
    String(x.date || '').localeCompare(String(y.date || '')) ||
    String(x.confirmedAt || '').localeCompare(String(y.confirmedAt || ''))
  );

  // 2. one ordered pass
  const rating = {};
  const played = {};
  const seed = (e) => { if (rating[e] === undefined) { rating[e] = BASE; played[e] = 0; } };

  for (const g of games) {
    const a = String(g.a).toLowerCase();
    const b = String(g.b).toLowerCase();
    if (a === b) continue;
    seed(a); seed(b);

    const expectedA = 1 / (1 + Math.pow(10, (rating[b] - rating[a]) / 400));
    const actualA = g.winner === 'b' ? 0 : 1;
    const k = kFactor(Math.min(played[a], played[b]));
    const change = k * marginMultiplier(g.sets) * (actualA - expectedA);

    rating[a] += change;
    rating[b] -= change;
    played[a]++; played[b]++;
  }

  // 3. write the ranking entries, keeping name and country from the profile
  let updated = 0, skipped = 0;
  let c2;
  do {
    const page = await env.DEUCE_KV.list({ prefix: 'ratings:', cursor: c2 });
    c2 = page.list_complete ? undefined : page.cursor;

    for (const k of page.keys) {
      const email = k.name.slice('ratings:'.length);
      const current = await env.DEUCE_KV.get(k.name, 'json');
      if (!current) continue;

      const raw = rating[email] === undefined ? BASE : rating[email];
      const value = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(raw)));
      const count = played[email] || 0;
      const lvl = count ? levelFromRating(value) : '';

      if (current.rating === value && current.played === count && current.level === lvl) {
        skipped++;
        continue;
      }

      await env.DEUCE_KV.put(k.name, JSON.stringify({
        ...current,
        rating: value,
        played: count,
        level: lvl,
        updatedAt: new Date().toISOString()
      }));
      updated++;
    }
  } while (c2);

  return { games: games.length, updated, skipped };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (env.REMINDERS_SECRET) {
    const url = new URL(request.url);
    const provided =
      request.headers.get('x-reminders-secret') || url.searchParams.get('token');
    if (provided !== env.REMINDERS_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    const stats = await recomputeRatings(env);
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('recomputeRatings failed:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
