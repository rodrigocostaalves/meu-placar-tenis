import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId, response } = await request.json();
    if (!inviteId || !response) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const data = await env.DEUCE_KV.get(`invites:${inviteId}`, 'json');
    if (data) {
      data.status = response;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(data));

      // Only the player who scheduled the match used to get the 24h/1h
      // reminders. Whoever accepts the invite should be reminded too, so give
      // them their own entry keyed by the invite (not the match) to avoid
      // colliding with reminders:<matchId>.
      if (response === 'accepted' && data.toEmail && data.dateTime) {
        const player = await env.DEUCE_KV.get(`players:${data.toEmail}`, 'json');
        if (player && player.subscription) {
          await env.DEUCE_KV.put(`reminders:inv_${inviteId}`, JSON.stringify({
            subscription: player.subscription,
            dateTime: data.dateTime,
            opponent: data.fromName || '',
            sent24h: false,
            sent1h: false,
            createdAt: new Date().toISOString()
          }));
        }
      }

      // Declining after having accepted should not leave a reminder behind.
      if (response !== 'accepted') {
        await env.DEUCE_KV.delete(`reminders:inv_${inviteId}`);
      }

      // Tell the person who sent the invite what happened. Until now the
      // answer went nowhere: the inviter had no way to learn they'd been
      // accepted short of asking.
      data.respondedAt = new Date().toISOString();
      data.senderSeen = false;
      await env.DEUCE_KV.put(`invites:${inviteId}`, JSON.stringify(data));

      const fromKey = (data.fromEmail || '').trim().toLowerCase();
      if (fromKey && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        const sender = await env.DEUCE_KV.get(`players:${fromKey}`, 'json');
        if (sender && sender.subscription) {
          try {
            const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
            const who = data.toName || data.opponent || 'Seu adversário';
            const accepted = response === 'accepted';
            const pushMessage = {
              data: JSON.stringify({
                title: accepted ? '✅ Convite aceito' : '❌ Convite recusado',
                body: accepted
                  ? `${who} aceitou seu convite para jogar.`
                  : `${who} não vai poder jogar dessa vez.`
              })
            };
            const payload = await buildPushPayload(pushMessage, sender.subscription, vapid);
            await fetch(sender.subscription.endpoint, payload);
          } catch (err) {
            console.error('Response push error:', err);
          }
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
