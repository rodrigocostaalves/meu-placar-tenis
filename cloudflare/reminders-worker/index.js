import { buildPushPayload } from '@block65/webcrypto-web-push';

let cachedToken = null;

const b64url = (value) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

async function googleToken(env) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const service = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  );

  const claims = b64url(
    JSON.stringify({
      iss: service.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );

  const input = `${header}.${claims}`;

  const pem = service.private_key.replace(
    /-----(BEGIN|END) PRIVATE KEY-----|\s/g,
    ''
  );

  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    raw.buffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input)
  );

  const signatureText = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${input}.${signatureText}`;

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type:
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Google OAuth failed');
  }

  cachedToken = {
    value: data.access_token,
    expires: Date.now() + data.expires_in * 1000
  };

  return cachedToken.value;
}

async function sendFcm(token, env, title, body) {
  if (!token || !env.FCM_SERVICE_ACCOUNT_JSON) {
    return false;
  }

  try {
    const service = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
    const accessToken = await googleToken(env);

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${service.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title,
              body
            },
            android: {
              priority: 'HIGH'
            }
          }
        })
      }
    );

    return response.ok;
  } catch (error) {
    console.error('FCM send error:', error);
    return false;
  }
}

async function sendWeb(subscription, env, payload) {
  if (
    !subscription ||
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_PRIVATE_KEY
  ) {
    return false;
  }

  try {
    const payloadOptions = await buildPushPayload(
      { data: JSON.stringify(payload) },
      subscription,
      {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY
      }
    );

    const response = await fetch(
      subscription.endpoint,
      payloadOptions
    );

    return response.ok;
  } catch (error) {
    console.error('Web push error:', error);
    return false;
  }
}

async function notify(data, env, title, body) {
  const [fcm, web] = await Promise.all([
    sendFcm(data.fcmToken, env, title, body),
    sendWeb(data.subscription, env, { title, body })
  ]);

  return fcm || web;
}

async function checkReminders(env) {
  const now = Date.now();

  const list = await env.DEUCE_KV.list({
    prefix: 'reminders:'
  });

  for (const key of list.keys) {
    const data = await env.DEUCE_KV.get(key.name, 'json');

    if (!data) {
      continue;
    }

    const matchTime = new Date(data.dateTime).getTime();

    if (Number.isNaN(matchTime)) {
      await env.DEUCE_KV.delete(key.name);
      continue;
    }

    const hoursUntil = (matchTime - now) / 3_600_000;

    if (hoursUntil < -1) {
      await env.DEUCE_KV.delete(key.name);
      continue;
    }

    let changed = false;

    if (
      !data.sent24h &&
      hoursUntil <= 24.25 &&
      hoursUntil > 23.5
    ) {
      const sent = await notify(
        data,
        env,
        'Partida amanhã 🎾',
        data.opponent
          ? `Você tem uma partida contra ${data.opponent} em 24 horas.`
          : 'Você tem uma partida agendada em 24 horas.'
      );

      if (sent) {
        data.sent24h = true;
        changed = true;
      }
    }

    if (
      !data.sent1h &&
      hoursUntil <= 1.25 &&
      hoursUntil > 0.5
    ) {
      const sent = await notify(
        data,
        env,
        'Partida em 1 hora 🎾',
        data.opponent
          ? `Sua partida contra ${data.opponent} começa em 1 hora.`
          : 'Sua partida começa em 1 hora.'
      );

      if (sent) {
        data.sent1h = true;
        changed = true;
      }
    }

    if (changed) {
      await env.DEUCE_KV.put(
        key.name,
        JSON.stringify(data)
      );
    }
  }
}

export default {
  scheduled(event, env, ctx) {
    ctx.waitUntil(checkReminders(env));
  },

  async fetch(request, env) {
    await checkReminders(env);
    return new Response('Reminders checked.');
  }
};
