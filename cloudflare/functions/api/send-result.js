import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { matchId, fromName, fromEmail, toEmail, toName, date, result, sets, matchType, surface } = body;
    if (!toEmail || !result) return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });

    const key = toEmail.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');
    const resultId = 'res_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify({
      id: resultId, matchId: String(matchId || '').trim(), fromName: fromName || '', fromEmail: fromEmail || '', toEmail: key, toName: toName || '',
      date: date || '', result, sets: Array.isArray(sets) ? sets : [], matchType: matchType || 'amistoso',
      surface: surface || 'rapida', status: 'pending', createdAt: new Date().toISOString()
    }));

    let notified = false;
    const title = `🎾 Resultado de ${fromName || 'um jogador'}`;
    const message = 'Um placar foi registrado com você. Abra a Caixa de Entrada para confirmar.';
    if (player?.fcmToken) notified = await sendFcmNotification(env, player.fcmToken, title, message);
    if (player?.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
        const payload = await buildPushPayload({ data: JSON.stringify({ title, body: message }) }, player.subscription, vapid);
        notified = (await fetch(player.subscription.endpoint, payload)).ok || notified;
      } catch (error) { console.error('Result push error:', error); }
    }
    return new Response(JSON.stringify({ ok: true, notified, resultId }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
