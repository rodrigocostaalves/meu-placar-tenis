import { buildPushPayload } from '@block65/webcrypto-web-push';

async function trySend(subscription, vapid, payloadData) {
  try {
    const message = { data: JSON.stringify(payloadData) };
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(subscription.endpoint, payload);
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok;
  } catch (err) {
    console.error('Push send error:', err);
    return false;
  }
}

async function checkReminders(env) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  if (!vapid.publicKey || !vapid.privateKey) {
    console.error('VAPID keys not configured');
    return;
  }

  const list = await env.DEUCE_KV.list({ prefix: 'reminders:' });
  const now = Date.now();

  for (const k of list.keys) {
    const data = await env.DEUCE_KV.get(k.name, 'json');
    if (!data) continue;

    const matchTime = new Date(data.dateTime).getTime();
    if (Number.isNaN(matchTime)) {
      await env.DEUCE_KV.delete(k.name);
      continue;
    }

    const msUntil = matchTime - now;
    const hoursUntil = msUntil / (1000 * 60 * 60);

    if (msUntil < -60 * 60 * 1000) {
      await env.DEUCE_KV.delete(k.name);
      continue;
    }

    let subscriptionGone = false;
    let updated = false;

    if (!data.sent24h && hoursUntil <= 24.25 && hoursUntil > 23.5) {
      const result = await trySend(data.subscription, vapid, {
        title: 'Partida amanhã 🎾',
        body: data.opponent
          ? `Você tem uma partida contra ${data.opponent} em 24 horas.`
          : 'Você tem uma partida agendada em 24 horas.'
      });
      if (result === 'gone') subscriptionGone = true;
      else if (result) { data.sent24h = true; updated = true; }
    }

    if (!subscriptionGone && !data.sent1h && hoursUntil <= 1.25 && hoursUntil > 0.5) {
      const result = await trySend(data.subscription, vapid, {
        title: 'Partida em 1 hora 🎾',
        body: data.opponent
          ? `Sua partida contra ${data.opponent} começa em 1 hora.`
          : 'Sua partida começa em 1 hora.'
      });
      if (result === 'gone') subscriptionGone = true;
      else if (result) { data.sent1h = true; updated = true; }
    }

    if (subscriptionGone) {
      await env.DEUCE_KV.delete(k.name);
    } else if (updated) {
      await env.DEUCE_KV.put(k.name, JSON.stringify(data));
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkReminders(env));
  },
  async fetch(request, env, ctx) {
    // Allows manually triggering a check via browser/curl for testing
    await checkReminders(env);
    return new Response('Reminders checked.');
  }
};
