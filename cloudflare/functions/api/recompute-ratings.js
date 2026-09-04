import { BASE_RATING, json, kFactor, levelFromRating, marginMultiplier, normalEmail, parseSets, requireRankingDatabase } from './_ranking.js';

const MIN_RATING = 800;
const MAX_RATING = 2600;

async function listKvJson(env, prefix) {
  const items = [];
  let cursor;
  do {
    const page = await env.DEUCE_KV.list({ prefix, cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const key of page.keys) {
      const value = await env.DEUCE_KV.get(key.name, 'json');
      if (value) items.push([key.name, value]);
    }
  } while (cursor);
  return items;
}

// Runs once after the D1 binding is added. It imports the existing shared
// ranking history so nobody loses their current global standing.
async function importLegacyRanking(env, db) {
  const done = await db.prepare("SELECT value FROM ranking_meta WHERE key = 'legacy_import_v1'").first();
  if (done) return { imported: false, players: 0, matches: 0 };

  const players = new Map();
  for (const [, p] of await listKvJson(env, 'players:')) {
    const email = normalEmail(p.email);
    if (email) players.set(email, { email, name: p.name || '', countryCode: p.countryCode || '' });
  }
  for (const [key, p] of await listKvJson(env, 'ratings:')) {
    const email = normalEmail(p.email || key.slice('ratings:'.length));
    if (email && !players.has(email)) players.set(email, { email, name: p.name || '', countryCode: p.countryCode || '' });
  }

  const matches = new Map();
  for (const [key, g] of await listKvJson(env, 'cmatch:')) {
    const a = normalEmail(g.a), b = normalEmail(g.b);
    const id = g.id || key.slice('cmatch:'.length);
    if (id && a && b && a !== b) matches.set(id, { id, a, b, date: g.date || '', sets: g.sets || [], winner: g.winner === 'b' ? 'b' : 'a', matchType: g.matchType || 'amistoso', surface: g.surface || 'rapida', confirmedAt: g.confirmedAt || new Date().toISOString() });
  }
  for (const [key, r] of await listKvJson(env, 'pending-results:')) {
    if (r.status !== 'accepted') continue;
    const id = r.id || key.slice('pending-results:'.length);
    const a = normalEmail(r.fromEmail), b = normalEmail(r.toEmail);
    if (!id || !a || !b || a === b || matches.has(id)) continue;
    matches.set(id, { id, a, b, date: r.date || '', sets: r.sets || [], winner: r.result === 'V' ? 'a' : 'b', matchType: r.matchType || 'amistoso', surface: r.surface || 'rapida', confirmedAt: r.respondedAt || r.createdAt || new Date().toISOString() });
  }

  const statements = [];
  for (const player of players.values()) statements.push(db.prepare(`INSERT INTO ranking_players (email, name, country_code) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE ranking_players.name END, country_code = CASE WHEN excluded.country_code <> '' THEN excluded.country_code ELSE ranking_players.country_code END`).bind(player.email, player.name, String(player.countryCode).toUpperCase().slice(0, 2)));
  for (const match of matches.values()) statements.push(db.prepare(`INSERT OR IGNORE INTO ranking_matches (id, player_a_email, player_b_email, match_date, sets_json, winner, match_type, surface, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(match.id, match.a, match.b, match.date, JSON.stringify(match.sets), match.winner, match.matchType, match.surface, match.confirmedAt));
  // D1 batches can contain many statements, but chunks make a large legacy
  // history safe as the community grows.
  for (let index = 0; index < statements.length; index += 100) await db.batch(statements.slice(index, index + 100));
  await db.prepare("INSERT INTO ranking_meta (key, value) VALUES ('legacy_import_v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(new Date().toISOString()).run();
  return { imported: true, players: players.size, matches: matches.size };
}

export async function recomputeRatings(env) {
  const db = requireRankingDatabase(env);
  const legacy = await importLegacyRanking(env, db);
  const playerRows = (await db.prepare('SELECT email, rating, played, level FROM ranking_players').all()).results || [];
  const state = new Map(playerRows.map(p => [p.email, { rating: BASE_RATING, played: 0, oldRating: Number(p.rating), oldPlayed: Number(p.played), oldLevel: p.level || '' }]));
  const matchRows = (await db.prepare('SELECT player_a_email, player_b_email, sets_json, winner FROM ranking_matches ORDER BY match_date ASC, confirmed_at ASC').all()).results || [];
  const ensure = email => {
    if (!state.has(email)) state.set(email, { rating: BASE_RATING, played: 0, oldRating: BASE_RATING, oldPlayed: 0, oldLevel: '' });
    return state.get(email);
  };
  for (const match of matchRows) {
    const a = normalEmail(match.player_a_email), b = normalEmail(match.player_b_email);
    if (!a || !b || a === b) continue;
    const pa = ensure(a), pb = ensure(b);
    const expectedA = 1 / (1 + Math.pow(10, (pb.rating - pa.rating) / 400));
    const actualA = match.winner === 'b' ? 0 : 1;
    const change = kFactor(Math.min(pa.played, pb.played)) * marginMultiplier(parseSets(match.sets_json)) * (actualA - expectedA);
    pa.rating += change; pb.rating -= change; pa.played++; pb.played++;
  }
  const now = new Date().toISOString();
  const statements = [];
  for (const [email, p] of state) {
    const rating = Math.min(MAX_RATING, Math.max(MIN_RATING, Math.round(p.rating)));
    const level = p.played ? levelFromRating(rating) : '';
    if (p.oldRating !== rating || p.oldPlayed !== p.played || p.oldLevel !== level) {
      statements.push(db.prepare('UPDATE ranking_players SET rating = ?, played = ?, level = ?, updated_at = ? WHERE email = ?').bind(rating, p.played, level, now, email));
    }
  }
  for (let index = 0; index < statements.length; index += 100) await db.batch(statements.slice(index, index + 100));
  await db.prepare("INSERT INTO ranking_meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now).run();
  return { games: matchRows.length, players: state.size, updated: statements.length, legacy };
}

export async function onRequestPost({ request, env }) {
  const required = env.RANKING_SECRET || env.REMINDERS_SECRET;
  const supplied = request.headers.get('x-ranking-secret') || request.headers.get('x-reminders-secret');
  if (required && supplied !== required) return json({ error: 'Unauthorized' }, 401);
  try { return json({ ok: true, ...(await recomputeRatings(env)) }); }
  catch (error) { console.error('recomputeRatings failed:', error); return json({ error: String(error) }, 500); }
}
