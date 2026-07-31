import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { fromName, fromEmail, toEmail, listingId, dateTime, opponent, location, message } = body;

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

    const inviteId = 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
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
    if (player && player.subscription && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
        const message = {
          data: JSON.stringify({
            title: `🎾 Convite de ${fromName || 'um jogador'}`,
            body: message
              ? String(message).slice(0, 120)
              : 'Você recebeu um convite para jogar. Abra o app para ver os detalhes.'
          })
        };
        const payload = await buildPushPayload(message, player.subscription, vapid);
        const res = await fetch(player.subscription.endpoint, payload);
        notified = res.ok;
      } catch (err) {
        console.error('Invite push error:', err);
      }
    }

    return new Response(JSON.stringify({ ok: true, notified }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
