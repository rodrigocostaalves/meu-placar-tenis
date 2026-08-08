import { buildPushPayload } from '@block65/webcrypto-web-push';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { resultId, response } = await request.json();
    if (!resultId || !response) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const data = await env.DEUCE_KV.get(`pending-results:${resultId}`, 'json');
    if (data) {
      data.status = response;
      await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify(data));

      data.respondedAt = new Date().toISOString();
      data.senderSeen = false;
      await env.DEUCE_KV.put(`pending-results:${resultId}`, JSON.stringify(data));

      // Confirmation used to go nowhere: the sender had no way to know their
      // result had been accepted, so nothing could ever be marked confirmed.
      if (response === 'accepted' && data.fromEmail && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        const senderKey = data.fromEmail.trim().toLowerCase();
        const sender = await env.DEUCE_KV.get(`players:${senderKey}`, 'json');
        if (sender && sender.subscription) {
          try {
            const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
            const pushMessage = {
              data: JSON.stringify({
                title: '✅ Resultado confirmado',
                body: `${data.toName || 'Seu adversário'} confirmou o placar da partida.`
              })
            };
            const payload = await buildPushPayload(pushMessage, sender.subscription, vapid);
            await fetch(sender.subscription.endpoint, payload);
          } catch (err) {
            console.error('Confirmation push error:', err);
          }
        }
      }

      if (response === 'dismissed' && data.fromEmail && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        const senderKey = data.fromEmail.trim().toLowerCase();
        const sender = await env.DEUCE_KV.get(`players:${senderKey}`, 'json');
        if (sender && sender.subscription) {
          try {
            const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
            const message = {
              data: JSON.stringify({
                title: '🎾 Resultado recusado',
                body: 'O resultado que você enviou foi recusado pelo adversário.'
              })
            };
            const payload = await buildPushPayload(message, sender.subscription, vapid);
            await fetch(sender.subscription.endpoint, payload);
          } catch (err) {
            console.error('Rejection push error:', err);
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
