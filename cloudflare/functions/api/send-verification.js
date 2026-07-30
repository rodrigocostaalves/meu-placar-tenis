function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const code = genCode();
    // verify-email.js is still the authority on the 15-minute window; this TTL is
    // just garbage collection, set longer so it can never expire a code early.
    await env.DEUCE_KV.put(`email-verifications:${key}`, JSON.stringify({ code, createdAt: Date.now() }), {
      expirationTtl: 1800
    });

    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
      console.error('BREVO_API_KEY or BREVO_SENDER_EMAIL not configured');
      return new Response(JSON.stringify({ ok: false, error: 'Email service not configured' }), { status: 500 });
    }

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER_EMAIL, name: 'Deuce Score' },
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
}
