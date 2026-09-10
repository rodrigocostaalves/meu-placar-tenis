import {emailKey, validEmail, readBody, json, takeLimit} from './api-security.js';
import {issueSession} from './competition-auth.js';
const ttl = 15*60000;
async function digest(env, value) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AUTH_CODE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
}
function randomCode() {
  const values = new Uint32Array(1); let n;
  do { crypto.getRandomValues(values); n = values[0]; } while (n >= 4294000000);
  return String(n % 1000000).padStart(6,'0');
}
export async function emailAuth(context, verify) {
  const {env,request} = context;
  try {
    const db = env.COMPETITIONS_DB;
    if (!db || typeof env.AUTH_CODE_SECRET !== 'string' || env.AUTH_CODE_SECRET.length < 32)
      return json({ok:false,error:'auth_setup_required'},503);
    if (!verify && (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)) return json({ok:false,error:'Email service not configured'},503);
    const body = await readBody(request,4096), email = emailKey(body.email);
    if (!validEmail(email) || (verify && !/^\d{6}$/.test(String(body.code)))) return json({ok:false,error:'invalid_fields'},400);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ipKey = await digest(env,`ip:${ip}`);
    if (!await takeLimit(db,`${verify?'verify':'send'}:${ipKey}`,verify?60:25,3600000))
      return json({ok:false,error:'rate_limited'},429,{'Retry-After':'3600'});
    const now = Date.now();
    await db.prepare('DELETE FROM ds_auth_limits WHERE key IN (SELECT key FROM ds_auth_limits WHERE expires<? LIMIT 20)').bind(now).run();
    await db.prepare('DELETE FROM ds_auth_challenges WHERE email IN (SELECT email FROM ds_auth_challenges WHERE expires<? LIMIT 20)').bind(now-86400000).run();
    if (verify) {
      const row = await db.prepare(`UPDATE ds_auth_challenges SET attempts=attempts+1
        WHERE email=? AND expires>? AND ready=1 AND consumed=0 AND attempts<5
        RETURNING id,code_hash`).bind(email,now).first();
      if (!row) return json({ok:false,error:'invalid_or_expired_code'},400);
      const hash = await digest(env,`${email}\n${row.id}\n${String(body.code)}`);
      if (hash !== row.code_hash) return json({ok:false,error:'invalid_or_expired_code'},400);
      const used = await db.prepare(`UPDATE ds_auth_challenges SET consumed=1
        WHERE email=? AND id=? AND consumed=0 AND ready=1 AND expires>? RETURNING email`).bind(email,row.id,Date.now()).first();
      if (!used) return json({ok:false,error:'invalid_or_expired_code'},400);
      const competitionSession = await issueSession(db,email);
      const player = await env.DEUCE_KV.get(`players:${email}`,'json');
      const existing = player ? {name:player.name||'',zip:player.zip||'',country:player.country||'',countryCode:player.countryCode||'',shareLocation:!!player.shareLocation} : null;
      return json({ok:true,existing,competitionSession});
    }
    if (!await takeLimit(db,`email-send:${email}`,5,3600000)) return json({ok:false,error:'rate_limited'},429,{'Retry-After':'3600'});
    const id = crypto.randomUUID(), code = randomCode(), hash = await digest(env,`${email}\n${id}\n${code}`);
    const reserved = await db.prepare(`INSERT INTO ds_auth_challenges(email,id,code_hash,expires,sent_at,attempts,ready,consumed)
      VALUES(?,?,?,?,?,0,0,0) ON CONFLICT(email) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,
      expires=excluded.expires,sent_at=excluded.sent_at,attempts=0,ready=0,consumed=0
      WHERE sent_at<=? RETURNING id`).bind(email,id,hash,now+ttl,now,now-60000).first();
    if (!reserved) return json({ok:false,error:'resend_wait'},429,{'Retry-After':'60'});
    const messages = {
      pt:['Seu código de verificação - Deuce Score',`Seu código de verificação é: ${code}\n\nExpira em 15 minutos. Não compartilhe este código. Se não pediu, ignore este e-mail.`],
      en:['Your verification code - Deuce Score',`Your verification code is: ${code}\n\nExpires in 15 minutes. Do not share this code. If you did not request it, ignore this email.`],
      es:['Tu código de verificación - Deuce Score',`Tu código de verificación es: ${code}\n\nVence en 15 minutos. No compartas este código. Si no lo solicitaste, ignora este correo.`]
    };
    const [subject,textContent] = messages[body.language] || messages.en;
    let sent = false;
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({sender:{email:env.BREVO_SENDER_EMAIL,name:'Deuce Score'},to:[{email}],subject,textContent})});
      sent = response.ok;
    } catch { /* No provider response, key or OTP in logs. */ }
    if (!sent) {
      await db.prepare('DELETE FROM ds_auth_challenges WHERE email=? AND id=?').bind(email,id).run();
      return json({ok:false,error:'Failed to send email'},503);
    }
    await db.prepare('UPDATE ds_auth_challenges SET ready=1 WHERE email=? AND id=?').bind(email,id).run();
    return json({ok:true});
  } catch (error) {
    const input = ['invalid_json','request_too_large'].includes(error.message);
    return json({ok:false,error:input?error.message:'auth_unavailable'},input?400:503);
  }
}
