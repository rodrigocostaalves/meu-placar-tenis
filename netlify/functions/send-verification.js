import { getStore } from '@netlify/blobs';

function genCode(){
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  try {
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const code = genCode();
    const store = getStore('email-verifications');
    await store.setJSON(key, { code, createdAt: Date.now() });

    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL;
    if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
      console.error('BREVO_API_KEY or BREVO_SENDER_EMAIL not configured');
      return new Response(JSON.stringify({ ok: false, error: 'Email service not configured' }), { status: 500 });
    }

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: 'Deuce Score' },
        to: [{ email: key }],
        subject: 'Seu código de verificação - Deuce Score',
        textContent: `Seu código de verificação é: ${code}\n\nEsse código expira em 15 minutos. Se você não pediu isso, pode ignorar este e-mail.`
      })
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Brevo error:', errText);
      return new Response(JSON.stringify({ ok: false, error: 'Failed to send email' }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
};
