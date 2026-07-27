import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

async function trySend(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      return 'gone';
    }
    console.error('Push send error:', err);
    return false;
  }
}

export default async () => {
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:reminders@example.com';

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('VAPID keys not configured');
    return new Response('Missing VAPID keys', { status: 500 });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const store = getStore('reminders');
  const { blobs } = await store.list();
  const now = Date.now();

  for (const blobInfo of blobs) {
    const key = blobInfo.key;
    const data = await store.get(key, { type: 'json' });
    if (!data) continue;

    const matchTime = new Date(data.dateTime).getTime();
    if (Number.isNaN(matchTime)) {
      await store.delete(key);
      continue;
    }

    const msUntil = matchTime - now;
    const hoursUntil = msUntil / (1000 * 60 * 60);

    if (msUntil < -60 * 60 * 1000) {
      await store.delete(key);
      continue;
    }

    let subscriptionGone = false;
    let updated = false;

    if (!data.sent24h && hoursUntil <= 24.25 && hoursUntil > 23.5) {
      const result = await trySend(data.subscription, {
        title: 'Partida amanhã 🎾',
        body: data.opponent
          ? `Você tem uma partida contra ${data.opponent} em 24 horas.`
          : 'Você tem uma partida agendada em 24 horas.'
      });
      if (result === 'gone') subscriptionGone = true;
      else if (result) { data.sent24h = true; updated = true; }
    }

    if (!subscriptionGone && !data.sent1h && hoursUntil <= 1.25 && hoursUntil > 0.5) {
      const result = await trySend(data.subscription, {
        title: 'Partida em 1 hora 🎾',
        body: data.opponent
          ? `Sua partida contra ${data.opponent} começa em 1 hora.`
          : 'Sua partida começa em 1 hora.'
      });
      if (result === 'gone') subscriptionGone = true;
      else if (result) { data.sent1h = true; updated = true; }
    }

    if (subscriptionGone) {
      await store.delete(key);
    } else if (updated) {
      await store.setJSON(key, data);
    }
  }

  return new Response('ok');
};

export const config = {
  schedule: '*/15 * * * *'
};
