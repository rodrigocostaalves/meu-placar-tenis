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
    return { error: 'VAPID keys not configured' };
  }

  const now = Date.now();
  const stats = { checked: 0, sent24h: 0, sent1h: 0, deleted: 0 };

  let cursor;
  do {
    const list = await env.DEUCE_KV.list({ prefix: 'reminders:', cursor });
    cursor = list.list_complete ? undefined : list.cursor;

    for (const k of list.keys) {
      const data = await env.DEUCE_KV.get(k.name, 'json');
      if (!data) continue;

      stats.checked++;

      const matchTime = new Date(data.dateTime).getTime();
      if (Number.isNaN(matchTime)) {
        await env.DEUCE_KV.delete(k.name);
        stats.deleted++;
        continue;
      }

      const msUntil = matchTime - now;
      const hoursUntil = msUntil / (1000 * 60 * 60);

      // Match is more than an hour in the past: reminder is dead weight.
      if (msUntil < -60 * 60 * 1000) {
        await env.DEUCE_KV.delete(k.name);
        stats.deleted++;
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
        else if (result) { data.sent24h = true; updated = true; stats.sent24h++; }
      }

      if (!subscriptionGone && !data.sent1h && hoursUntil <= 1.25 && hoursUntil > 0.5) {
        const result = await trySend(data.subscription, vapid, {
          title: 'Partida em 1 hora 🎾',
          body: data.opponent
            ? `Sua partida contra ${data.opponent} começa em 1 hora.`
            : 'Sua partida começa em 1 hora.'
        });
        if (result === 'gone') subscriptionGone = true;
        else if (result) { data.sent1h = true; updated = true; stats.sent1h++; }
      }

      if (subscriptionGone) {
        await env.DEUCE_KV.delete(k.name);
        stats.deleted++;
      } else if (updated) {
        await env.DEUCE_KV.put(k.name, JSON.stringify(data));
      }
    }
  } while (cursor);

  return stats;
}

export async function onRequest(context) {
  const { request, env } = context;

  // Simple shared-secret guard so this endpoint isn't publicly triggerable.
  // Set REMINDERS_SECRET in the Pages project variables to enable it.
  if (env.REMINDERS_SECRET) {
    const url = new URL(request.url);
    const provided =
      request.headers.get('x-reminders-secret') || url.searchParams.get('token');
    if (provided !== env.REMINDERS_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    const stats = await checkReminders(env);
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('checkReminders failed:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
