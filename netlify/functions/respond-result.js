import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { resultId, response } = body;
    if (!resultId || !response) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }
    const store = getStore('pending-results');
    const data = await store.get(resultId, { type: 'json' });
    if (data) {
      data.status = response;
      await store.setJSON(resultId, data);

      if (response === 'dismissed' && data.fromEmail) {
        const playersStore = getStore('players');
        const senderKey = data.fromEmail.trim().toLowerCase();
        const sender = await playersStore.get(senderKey, { type: 'json' });
        if (sender && sender.subscription) {
          const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
          const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
          const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:reminders@example.com';
          if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
            webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
            try {
              await webpush.sendNotification(sender.subscription, JSON.stringify({
                title: '🎾 Resultado recusado',
                body: 'O resultado que você enviou foi recusado pelo adversário.'
              }));
            } catch (err) {
              console.error('Rejection push error:', err);
            }
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
};
