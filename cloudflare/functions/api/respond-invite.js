import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { inviteId, response } = await request.json();
    if (!inviteId || !['accepted', 'dismissed'].includes(response)) return Response.json({ error: 'Missing or invalid fields' }, { status: 400 });
    const key = `invites:${inviteId}`;
    const data = await env.DEUCE_KV.get(key, 'json');
    if (!data) return Response.json({ error: 'Invite not found' }, { status: 404 });
    if (data.status !== 'pending') return Response.json({ ok: true, alreadyProcessed: true });

    // Combine status, timestamp and sender visibility into one write. The old
    // implementation put this key twice in one request and triggered KV 429s.
    data.status = response;
    data.respondedAt = new Date().toISOString();
    data.senderSeen = false;
    await env.DEUCE_KV.put(key, JSON.stringify(data));

    if (response === 'accepted' && data.toEmail && data.dateTime) {
      const player = await env.DEUCE_KV.get(`players:${data.toEmail}`, 'json');
      if (player?.subscription) {
        await env.DEUCE_KV.put(`reminders:inv_${inviteId}`, JSON.stringify({
          subscription: player.subscription, dateTime: data.dateTime, opponent: data.fromName || '', sent24h: false, sent1h: false, createdAt: new Date().toISOString()
        }));
      }
    } else {
      await env.DEUCE_KV.delete(`reminders:inv_${inviteId}`);
    }

    const fromKey = (data.fromEmail || '').trim().toLowerCase();
    if (fromKey && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      const sender = await env.DEUCE_KV.get(`players:${fromKey}`, 'json');
      if (sender?.subscription) {
        try {
          const accepted = response === 'accepted';
          const who = data.toName || data.opponent || 'Seu adversário';
          const title = accepted ? '✅ Convite aceito' : '❌ Convite recusado';
          const body = accepted ? `${who} aceitou seu convite para jogar.` : `${who} não vai poder jogar dessa vez.`;
          const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
          const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, sender.subscription, vapid);
          await fetch(sender.subscription.endpoint, payload);
        } catch (err) { console.error('Response push error:', err); }
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
