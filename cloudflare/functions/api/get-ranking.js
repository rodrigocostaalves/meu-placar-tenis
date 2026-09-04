import { json, normalEmail, rankOrderSql, requireRankingDatabase } from './_ranking.js';

const TOP_LIMIT = 10;

export async function onRequestPost({ request, env }) {
  try {
    const { email: rawEmail } = await request.json().catch(() => ({}));
    const email = normalEmail(rawEmail);
    const db = requireRankingDatabase(env);
    const order = rankOrderSql();
    const total = Number((await db.prepare('SELECT COUNT(*) AS total FROM ranking_players').first())?.total || 0);
    const topRows = (await db.prepare(`SELECT email, name, country_code, rating, level, played FROM ranking_players ORDER BY ${order} LIMIT ?`).bind(TOP_LIMIT).all()).results || [];
    const mine = email ? await db.prepare(`
      SELECT position, name, country_code, rating, level, played
      FROM (
        SELECT email, name, country_code, rating, level, played,
          ROW_NUMBER() OVER (ORDER BY ${order}) AS position
        FROM ranking_players
      ) WHERE email = ?
    `).bind(email).first() : null;
    const meta = await db.prepare("SELECT value FROM ranking_meta WHERE key = 'updated_at'").first();
    const mapPlayer = (row, isMe = false) => ({
      position: Number(row.position), name: row.name || '', countryCode: row.country_code || '',
      rating: Number(row.rating), level: row.level || '', played: Number(row.played || 0), isMe
    });
    const top = topRows.map((row, index) => mapPlayer({ ...row, position: index + 1 }, row.email === email));
    return json({
      total,
      myPosition: mine ? Number(mine.position) : null,
      myRating: mine ? Number(mine.rating) : null,
      me: mine && Number(mine.position) > TOP_LIMIT ? mapPlayer(mine, true) : null,
      top,
      updatedAt: meta?.value || null
    });
  } catch (error) { return json({ error: String(error) }, 500); }
}
