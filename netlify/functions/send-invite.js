import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { fromName, fromEmail, toEmail, dateTime, opponent } = body;
    if (!toEmail || !dateTime) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const playersStore = getStore('players');
    const invitesStore = getStore('invites');
    const key = toEmail.trim().toLowerCase();
    const player = await playersStore.get(key, { type: 'json' });

    const inviteId = 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await invitesStore.setJSON(inviteId, {
      id: inviteId,
      fromName: fromName || '',
      fromEmail: fromEmail || '',
      toEmail: key,
      dateTime,
      opponent: opponent || '',
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    let notified = false;
    if (player && player.subscription) {
      const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
      const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
      const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:reminders@example.com';
      if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        try {
          await webpush.sendNotification(player.subscription, JSON.stringify({
            title: `🎾 Convite de ${fromName || 'um jogador'}`,
            body: 'Você recebeu um convite para jogar. Abra o app para ver os detalhes.'
          }));
          notified = true;
        } catch (err) {
          console.error('Invite push error:', err);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, notified }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
