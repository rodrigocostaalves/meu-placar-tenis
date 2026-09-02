import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

const APP_URL = 'https://meu-placar-tenis.pages.dev/site/';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sendWebPush(player, env, title, body) {
  if (!player?.subscription || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  try {
    const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
    const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, player.subscription, vapid);
    return (await fetch(player.subscription.endpoint, payload)).ok;
  } catch (error) {
    console.error('League web push error:', error);
    return false;
  }
}

async function sendDownloadEmail(env, recipient, fromName, leagueName) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  const displayName = fromName || 'Um jogador';
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.BREVO_SENDER_EMAIL, name: 'Deuce Score' },
      to: [{ email: recipient }],
      subject: `Convite para a liga ${leagueName} — Deuce Score`,
      textContent: `${displayName} convidou você para participar da liga "${leagueName}" no Deuce Score.\n\nBaixe ou abra o Deuce Score para criar sua conta e acompanhar a liga: ${APP_URL}`
    })
  });
  if (!response.ok) console.error('League invite e-mail error:', await response.text());
  return response.ok;
}

/**
 * Invites a player to a league without changing any existing web route.
 * Registered players receive a push; new players receive a download e-mail.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { fromName, fromEmail, toEmail, leagueName } = await request.json();
    const recipient = String(toEmail || '').trim().toLowerCase();
    const league = String(leagueName || '').trim().slice(0, 100);
    if (!recipient || !recipient.includes('@') || !league) return json({ error: 'Missing recipient or league name' }, 400);

    const player = await env.DEUCE_KV.get(`players:${recipient}`, 'json');
    const inviteId = `league_inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await env.DEUCE_KV.put(`league-invites:${inviteId}`, JSON.stringify({
      id: inviteId, fromName: String(fromName || '').slice(0, 80), fromEmail: String(fromEmail || '').trim().toLowerCase(),
      toEmail: recipient, leagueName: league, status: 'pending', createdAt: new Date().toISOString()
    }));

    if (!player) {
      const emailSent = await sendDownloadEmail(env, recipient, fromName, league);
      return json({ ok: true, registered: false, emailSent });
    }

    const title = `🎾 Convite para a liga ${league}`;
    const body = `${fromName || 'Um jogador'} convidou você para participar. Abra o Deuce Score para ver.`;
    const [webNotified, androidNotified] = await Promise.all([
      sendWebPush(player, env, title, body),
      sendFcmNotification(env, player.fcmToken, title, body, { type: 'league_invite', inviteId })
    ]);
    return json({ ok: true, registered: true, notified: webNotified || androidNotified });
  } catch (error) {
    console.error('League invite error:', error);
    return json({ error: String(error) }, 500);
  }
}
