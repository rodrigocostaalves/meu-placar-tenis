import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { fromName, fromEmail, toEmail, date, result, sets, matchType, surface } = body;
    if (!toEmail || !result) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const key = toEmail.trim().toLowerCase();
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');

    const resultId = 'res_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify({
      id: resultId,
      fromName: fromName || '',
      fromEmail: fromEmail || '',
      toEmail: key,
      date: date || '',
      result,
      sets: Array.isArray(sets) ? sets : [],
      matchType: matchType || 'amistoso',
      surface: surface || 'rapida',
      status: 'pending',
      createdAt: new Date().toISOString()
    }));

    let notified = false;
    // Native Android devices receive FCM. Keep the existing VAPID delivery for
    // the browser/PWA so the web app and iPhone flow continue unchanged.
    if (player?.fcmToken) {
      notified = await sendFcmNotification(
        env,
        player.fcmToken,
        `🎾 Resultado de ${fromName || 'um jogador'}`,
        'Um placar foi registrado com você. Abra a Caixa de Entrada para confirmar.'
      );
    }
    if (player && player.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
        const message = {
          data: JSON.stringify({
            title: `🎾 Resultado de ${fromName || 'um jogador'}`,
            body: 'Alguém registrou um resultado com você. Abra o app para confirmar.'
          })
        };
        const payload = await buildPushPayload(message, player.subscription, vapid);
        const res = await fetch(player.subscription.endpoint, payload);
        notified = res.ok || notified;
      } catch (err) {
        console.error('Result push error:', err);
      }
    }

    return new Response(JSON.stringify({ ok: true, notified, resultId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
