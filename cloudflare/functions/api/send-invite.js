import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { matchId, fromName, fromEmail, toEmail, listingId, dateTime, opponent, location, message } = body;

    // Either an address typed by the user, or a board listing handle that only
    // the server can turn back into an address.
    let resolvedEmail = (toEmail || '').trim().toLowerCase();
    if (!resolvedEmail && listingId) {
      const ref = await env.DEUCE_KV.get(`listingref:${listingId}`, 'json');
      if (ref && ref.email) resolvedEmail = ref.email;
    }

    if (!resolvedEmail || !dateTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const key = resolvedEmail;
    const player = await env.DEUCE_KV.get(`players:${key}`, 'json');

    // The initiating client creates a durable match id before the request.
    // Retries therefore remain idempotent and every device refers to the
    // exact same match, rather than guessing from a date or an opponent.
    const requestedId = String(matchId || '').trim();
    const inviteId = /^[A-Za-z0-9_-]{12,120}$/.test(requestedId)
      ? requestedId
      : `match_${crypto.randomUUID()}`;
    const existing = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (existing) {
      return new Response(JSON.stringify({ ok: true, notified: false, inviteId, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify({
      id: inviteId,
      fromName: fromName || '',
      fromEmail: fromEmail || '',
      toEmail: key,
      dateTime,
      opponent: opponent || '',
      location: (location || '').slice(0, 200),
      message: (message || '').slice(0, 300),
      status: 'pending',
      createdAt: new Date().toISOString()
    }));

    let notified = false;
    // Native Android users receive FCM; browser/PWA users keep using VAPID.
    if (player?.fcmToken) {
      notified = await sendFcmNotification(
        env,
        player.fcmToken,
        `🎾 Convite de ${fromName || 'um jogador'}`,
        message ? String(message).slice(0, 120) : 'Você recebeu um convite para jogar. Abra o Deuce Score para ver os detalhes.'
      );
    }
    if (player && player.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
        const pushMessage = {
          data: JSON.stringify({
            title: `🎾 Convite de ${fromName || 'um jogador'}`,
            body: message
              ? String(message).slice(0, 120)
              : 'Você recebeu um convite para jogar. Abra o app para ver os detalhes.'
          })
        };
        const payload = await buildPushPayload(pushMessage, player.subscription, vapid);
        const res = await fetch(player.subscription.endpoint, payload);
        notified = res.ok || notified;
      } catch (err) {
        console.error('Invite push error:', err);
      }
    }

    // The mobile app saves this id with its local appointment. Responses must
    // be matched by this immutable id, never by an ambiguous email/date pair.
    return new Response(JSON.stringify({ ok: true, notified, inviteId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
