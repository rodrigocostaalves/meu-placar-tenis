import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { matchId, inviteId, fromEmail } = await request.json();
    if (!matchId) {
      return new Response(JSON.stringify({ error: 'Missing matchId' }), { status: 400 });
    }

    // Keep the previous reminder cancellation working for every scheduled match.
    await env.DEUCE_KV.delete(`reminders:${matchId}`);
    if (!inviteId) {
      return json({ ok: true, cancelled: false, notified: false });
    }

    const invite = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    const sender = String(fromEmail || '').trim().toLowerCase();
    if (!invite || !sender || String(invite.fromEmail || '').trim().toLowerCase() !== sender) {
      return json({ ok: true, cancelled: false, notified: false });
    }

    invite.status = 'cancelled';
    invite.cancelledAt = new Date().toISOString();
    invite.cancelSeen = false;
    await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(invite));
    await env.DEUCE_KV.delete(`reminders:inv_${inviteId}`);

    const recipient = await env.DEUCE_KV.get(`players:${String(invite.toEmail || '').trim().toLowerCase()}`, 'json');
    const title = '❌ Partida cancelada';
    const body = `${invite.fromName || 'Seu adversário'} cancelou a partida agendada.`;
    let notified = false;

    if (recipient?.fcmToken) {
      notified = await sendFcmNotification(env, recipient.fcmToken, title, body, 'inbox');
    }
    if (recipient?.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
        const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, recipient.subscription, vapid);
        const response = await fetch(recipient.subscription.endpoint, payload);
        notified = response.ok || notified;
      } catch (error) {
        console.error('Cancellation web push error:', error);
      }
    }
    return json({ ok: true, cancelled: true, notified });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' }
  });
}
