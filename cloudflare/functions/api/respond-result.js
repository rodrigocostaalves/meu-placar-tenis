import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

// A response is persisted once. Two immediate puts to the same KV key cause
// free-plan 429 errors and leave the sender with an inconsistent state.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId, response } = await request.json();
    if (!resultId || !response) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    const data = await env.DEUCE_KV.get(`pending-results:${resultId}`, 'json');
    if (!data) return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    data.status = response;
    data.respondedAt = new Date().toISOString();
    data.senderSeen = false;
    await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify(data));
    if (response === 'accepted') {
      await env.DEUCE_KV.put(`cmatch:${resultId}`, JSON.stringify({
        id: resultId, a: (data.fromEmail || '').trim().toLowerCase(), b: (data.toEmail || '').trim().toLowerCase(),
        aName: data.fromName || '', bName: data.toName || '', date: data.date || '',
        sets: Array.isArray(data.sets) ? data.sets : [], winner: data.result === 'V' ? 'a' : 'b',
        matchType: data.matchType || 'amistoso', surface: data.surface || 'rapida', confirmedAt: data.respondedAt
      }));
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
        } catch (error) { console.error('Result response web push error:', error); }
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
