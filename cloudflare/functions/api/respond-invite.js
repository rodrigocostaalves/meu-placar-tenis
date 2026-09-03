import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId, response } = await request.json();
    if (!inviteId || !response) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

    const data = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (data) {
      data.status = response;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(data));

      if (response === 'accepted' && data.toEmail && data.dateTime) {
        const player = await env.DEUCE_KV.get(`players:${data.toEmail}`, 'json');
        if (player?.subscription) {
          await env.DEUCE_KV.put(`reminders:inv_${inviteId}`, JSON.stringify({
            subscription: player.subscription, dateTime: data.dateTime, opponent: data.fromName || '',
            sent24h: false, sent1h: false, createdAt: new Date().toISOString()
          }));
        }
      }
      if (response !== 'accepted') await env.DEUCE_KV.delete(`reminders:inv_${inviteId}`);

      data.respondedAt = new Date().toISOString();
      data.senderSeen = false;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(data));

      const fromKey = (data.fromEmail || '').trim().toLowerCase();
      const accepted = response === 'accepted';
      const who = data.toName || data.opponent || 'Seu adversário';
      const title = accepted ? '✅ Convite aceito' : '❌ Convite recusado';
      const body = accepted ? `${who} aceitou seu convite para jogar.` : `${who} não vai poder jogar dessa vez.`;
      if (fromKey) {
        const sender = await env.DEUCE_KV.get(`players:${fromKey}`, 'json');
        if (sender?.fcmToken) await sendFcmNotification(env, sender.fcmToken, title, body);
        if (sender?.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
          try {
            const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
            const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, sender.subscription, vapid);
            await fetch(sender.subscription.endpoint, payload);
          } catch (err) { console.error('Response push error:', err); }
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
