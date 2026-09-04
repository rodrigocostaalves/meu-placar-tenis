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
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  if (!vapid.publicKey || !vapid.privateKey) return { error: 'VAPID keys not configured' };

  const now = Date.now();
  const stats = { checked: 0, sent24h: 0, sent1h: 0, sentResult: 0, deleted: 0 };
  let cursor;
  do {
    const list = await env.DEUCE_KV.list({ prefix: 'reminders:', cursor });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const key of list.keys) {
      const data = await env.DEUCE_KV.get(key.name, 'json');
      if (!data) continue;
      stats.checked++;
      const matchTime = new Date(data.dateTime).getTime();
      if (Number.isNaN(matchTime) || matchTime - now < -30 * 60 * 60 * 1000) {
        await env.DEUCE_KV.delete(key.name); stats.deleted++; continue;
      }

      const hoursUntil = (matchTime - now) / (60 * 60 * 1000);
      let gone = false, updated = false;
      if (!data.sent24h && hoursUntil <= 24.25 && hoursUntil > 23.5) {
        const sent = await trySend(data.subscription, vapid, { title: 'Partida amanhã 🎾', body: data.opponent ? `Você tem uma partida contra ${data.opponent} em 24 horas.` : 'Você tem uma partida agendada em 24 horas.' });
        if (sent === 'gone') gone = true;
        else if (sent) { data.sent24h = true; updated = true; stats.sent24h++; }
      }
      if (!gone && !data.sent1h && hoursUntil <= 1.25 && hoursUntil > 0.5) {
        const sent = await trySend(data.subscription, vapid, { title: 'Partida em 1 hora 🎾', body: data.opponent ? `Sua partida contra ${data.opponent} começa em 1 hora.` : 'Sua partida começa em 1 hora.' });
        if (sent === 'gone') gone = true;
        else if (sent) { data.sent1h = true; updated = true; stats.sent1h++; }
      }
      if (!gone && !data.sentResult && hoursUntil <= -2.5 && hoursUntil > -26) {
        const sent = await trySend(data.subscription, vapid, { title: 'Como foi o jogo? 🎾', body: data.opponent ? `Registre o placar da partida contra ${data.opponent}.` : 'Registre o placar da sua partida.' });
        if (sent === 'gone') gone = true;
        else if (sent) { data.sentResult = true; updated = true; stats.sentResult++; }
      }
      if (gone) { await env.DEUCE_KV.delete(key.name); stats.deleted++; }
      else if (updated) await env.DEUCE_KV.put(key.name, JSON.stringify(data));
    }
  } while (cursor);
  return stats;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (env.REMINDERS_SECRET) {
    const url = new URL(request.url);
    const provided = request.headers.get('x-reminders-secret') || url.searchParams.get('token');
    if (provided !== env.REMINDERS_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    // Ranking is intentionally NOT rebuilt here. This endpoint runs on a
    // schedule; ranking is rebuilt when a score is accepted instead.
    return Response.json({ ok: true, ...(await checkReminders(env)) });
  } catch (err) {
    console.error('checkReminders failed:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
