export const BASE_RATING = 1500;

export function normalEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function rankOrderSql() {
  return "rating DESC, played DESC, lower(name) ASC, email ASC";
}

export function requireRankingDatabase(env) {
  if (!env.RANKING_DB) throw new Error('RANKING_DB binding is not configured');
  return env.RANKING_DB;
}

export async function upsertRankingPlayer(env, player) {
  const db = requireRankingDatabase(env);
  const email = normalEmail(player.email);
  if (!email) return;
  const name = String(player.name || '').trim();
  const countryCode = String(player.countryCode || player.country_code || '').trim().toUpperCase().slice(0, 2);
  await db.prepare(`
    INSERT INTO ranking_players (email, name, country_code)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE ranking_players.name END,
      country_code = CASE WHEN excluded.country_code <> '' THEN excluded.country_code ELSE ranking_players.country_code END
  `).bind(email, name, countryCode).run();
}

export function parseSets(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch (_) { return []; }
}

export function kFactor(played) {
  if (played < 10) return 40;
  if (played < 30) return 32;
  return 24;
}

export function marginMultiplier(sets) {
  if (!Array.isArray(sets) || !sets.length) return 1;
  let a = 0, b = 0;
  for (const set of sets) {
    const x = Number(set?.a), y = Number(set?.b);
    if (Number.isFinite(x) && Number.isFinite(y)) { a += x; b += y; }
  }
  const total = a + b;
  return total ? 0.75 + 0.5 * (Math.abs(a - b) / total) : 1;
}

export function levelFromRating(rating) {
  const level = 1 + (rating - 1200) / 75;
  return Math.min(10, Math.max(1, level)).toFixed(1);
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
