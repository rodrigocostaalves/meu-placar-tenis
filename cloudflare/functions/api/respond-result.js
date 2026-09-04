import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';
import { json, normalEmail, requireRankingDatabase, upsertRankingPlayer } from './_ranking.js';

// A score confirmation records the match once in D1. Rating calculation is
// intentionally deferred to the two global scheduled runs each day.
export async function onRequestPost({ request, env }) {
  try {
    const { resultId, response } = await request.json();
    if (!resultId || !['accepted', 'dismissed'].includes(response)) return json({ error: 'Missing or invalid fields' }, 400);
    const key = `pending-results:${resultId}`;
    const data = await env.DEUCE_KV.get(key, 'json');
    if (!data) return json({ error: 'Result not found' }, 404);
    if (data.status !== 'pending') return json({ ok: true, alreadyProcessed: true });

    data.status = response;
    data.respondedAt = new Date().toISOString();
    data.senderSeen = false;
    await env.DEUCE_KV.put(key, JSON.stringify(data));

    if (response === 'accepted') {
      const a = normalEmail(data.fromEmail), b = normalEmail(data.toEmail);
      if (a && b && a !== b) {
        const db = requireRankingDatabase(env);
        await upsertRankingPlayer(env, { email: a, name: data.fromName || '' });
        await upsertRankingPlayer(env, { email: b, name: data.toName || '' });
        await db.prepare(`INSERT OR IGNORE INTO ranking_matches (id, player_a_email, player_b_email, match_date, sets_json, winner, match_type, surface, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          resultId, a, b, data.date || '', JSON.stringify(Array.isArray(data.sets) ? data.sets : []), data.result === 'V' ? 'a' : 'b', data.matchType || 'amistoso', data.surface || 'rapida', data.respondedAt
        ).run();
      }
    }

    const senderEmail = normalEmail(data.fromEmail);
    if (senderEmail) {
      const sender = await env.DEUCE_KV.get(`players:${senderEmail}`, 'json');
      const accepted = response === 'accepted';
      const title = accepted ? '✅ Resultado confirmado' : '🎾 Resultado recusado';
      const body = accepted ? `${data.toName || 'Seu adversário'} confirmou o placar da partida.` : 'O resultado que você enviou foi recusado pelo adversário.';
      if (sender?.fcmToken) await sendFcmNotification(env, sender.fcmToken, title, body);
      if (sender?.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        try {
          const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
          const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, sender.subscription, vapid);
          await fetch(sender.subscription.endpoint, payload);
        } catch (error) { console.error('Confirmation web push error:', error); }
      }
    }
    return json({ ok: true, ratingStatus: response === 'accepted' ? 'queued_for_next_global_update' : 'not_changed' });
  } catch (error) { return json({ error: String(error) }, 500); }
}
