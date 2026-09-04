import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';
import { recomputeRatings } from './recompute-ratings.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId, response } = await request.json();
    if (!resultId || !['accepted', 'dismissed'].includes(response)) return Response.json({ error: 'Missing or invalid fields' }, { status: 400 });
    const key = `pending-results:${resultId}`;
    const data = await env.DEUCE_KV.get(key, 'json');
    if (!data) return Response.json({ error: 'Result not found' }, { status: 404 });
    if (data.status !== 'pending') return Response.json({ ok: true, alreadyProcessed: true });

    // One KV write only. Two immediate puts to this same key were the direct
    // source of 429 responses because KV allows one write/key/second.
    data.status = response;
    data.respondedAt = new Date().toISOString();
    data.senderSeen = false;
    await env.DEUCE_KV.put(key, JSON.stringify(data));

    let ranking = null;
    if (response === 'accepted') {
      await env.DEUCE_KV.put(`cmatch:${resultId}`, JSON.stringify({
        id: resultId, a: (data.fromEmail || '').trim().toLowerCase(), b: (data.toEmail || '').trim().toLowerCase(),
        aName: data.fromName || '', bName: data.toName || '', date: data.date || '', sets: Array.isArray(data.sets) ? data.sets : [],
        winner: data.result === 'V' ? 'a' : 'b', matchType: data.matchType || 'amistoso', surface: data.surface || 'rapida', confirmedAt: data.respondedAt
      }));
      // A ranking changes only when a validated result changes it.
      ranking = await recomputeRatings(env);
    }

    const senderKey = (data.fromEmail || '').trim().toLowerCase();
    if (senderKey) {
      const sender = await env.DEUCE_KV.get(`players:${senderKey}`, 'json');
      const accepted = response === 'accepted';
      const title = accepted ? '✅ Resultado confirmado' : '🎾 Resultado recusado';
      const body = accepted ? `${data.toName || 'Seu adversário'} confirmou o placar da partida.` : 'O resultado que você enviou foi recusado pelo adversário.';
      if (sender?.fcmToken) await sendFcmNotification(env, sender.fcmToken, title, body);
      if (sender?.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        try {
          const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
          const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, sender.subscription, vapid);
          await fetch(sender.subscription.endpoint, payload);
        } catch (err) { console.error('Confirmation push error:', err); }
      }
    }
    return Response.json({ ok: true, ranking });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
