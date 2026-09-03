function base64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function accessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(serviceAccount.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const assertion = `${header}.${claim}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!response.ok) throw new Error(`Google OAuth ${response.status}`);
  return (await response.json()).access_token;
}

/** Sends a native Android notification, independently from web VAPID. */
export async function sendFcmNotification(env, token, title, body) {
  if (!token || !env.FCM_SERVICE_ACCOUNT_JSON) return false;
  try {
    const serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
    const bearer = await accessToken(serviceAccount);
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      // Data-only delivery makes Android call DeuceMessagingService in the background.
      body: JSON.stringify({
        message: {
          token,
          data: {
            type: 'deuce_score',
            title: String(title || 'Deuce Score'),
            body: String(body || 'Você tem uma nova atualização.'),
            screen: 'inbox'
          },
          android: { priority: 'high' }
        }
      })
    });
    if (!response.ok) console.error('FCM error:', await response.text());
    return response.ok;
  } catch (error) {
    console.error('FCM notification error:', error);
    return false;
  }
}
