import {emailKey,validEmail,readBody,json,takeLimit} from './api-security.js';
import {tokenHash} from './competition-auth.js';
import {accountHash,accountState} from './private-data.js';
const ttl=15*60000;
async function digest(env,value) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AUTH_CODE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
function randomCode(){let n;const data=new Uint32Array(1);do{crypto.getRandomValues(data);n=data[0];}while(n>=4294000000);return String(n%1000000).padStart(6,'0');}

/** Deliberately separate from email-auth: no session, profile, or automatic account recreation. */
export async function deletionEmail({env,request},verify=false) {
  try {
    const db=env.COMPETITIONS_DB;
    if(!db || typeof env.AUTH_CODE_SECRET!=='string' || env.AUTH_CODE_SECRET.length<32) return json({ok:false,error:'setup_required'},503);
    if(!verify && (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL)) return json({ok:false,error:'email_unavailable'},503);
    const body=await readBody(request,4096),email=emailKey(body.email);
    if(!validEmail(email) || (verify && (!/^\d{6}$/.test(String(body.code)) || body.confirm!==true))) return json({ok:false,error:'confirmation_required'},400);
    const now=Date.now(),hash=await accountHash(email),ip=await digest(env,'deletion-ip:'+(request.headers.get('CF-Connecting-IP')||'unknown'));
    if(!await takeLimit(db,`deletion-${verify?'verify':'send'}:${ip}`,verify?40:15,3600000)) return json({ok:false,error:'rate_limited'},429,{'Retry-After':'3600'});
    await db.prepare('DELETE FROM ds_deletion_challenges WHERE account_hash IN (SELECT account_hash FROM ds_deletion_challenges WHERE expires<? LIMIT 20)').bind(now-86400000).run();
    const state=await accountState(db,hash);
    if(verify) {
      const challenge=await db.prepare(`UPDATE ds_deletion_challenges SET attempts=attempts+1
        WHERE account_hash=? AND expires>? AND ready=1 AND attempts<5 RETURNING *`).bind(hash,now).first();
      if(!challenge || challenge.code_hash!==await digest(env,`delete-code\n${email}\n${challenge.id}\n${body.code}`)) return json({ok:false,error:'invalid_or_expired_code'},400);
      if(challenge.account_epoch!==state.epoch) return json({ok:false,error:'account_changed'},409);
      // A verified deletion request must never reactivate an already deleted account.
      if(state.state==='deleted') return json({ok:true,done:true,accountEpoch:state.epoch});
      const secret=await digest(env,`delete-receipt\n${email}\n${challenge.id}\n${body.code}`);
      const receipt=secret+'-'+secret.slice(0,7),receiptHash=await tokenHash(receipt);
      const issued=await db.prepare(`UPDATE ds_deletion_challenges SET receipt_hash=?
        WHERE account_hash=? AND id=? AND ready=1 AND expires>? AND account_epoch=? RETURNING id`)
        .bind(receiptHash,hash,challenge.id,Date.now(),state.epoch).first();
      if(!issued) return json({ok:false,error:'invalid_or_expired_code'},400);
      if(state.state==='deleting') {
        const rebound=await db.prepare(`UPDATE ds_account_deletions SET receipt_hash=? WHERE id=? AND account_hash=? AND state='pending' AND epoch=?`)
          .bind(receiptHash,state.job_id,hash,state.epoch).run();
        if(rebound.meta.changes!==1) return json({ok:false,error:'account_changed'},409);
      }
      return json({ok:true,done:false,requestId:state.state==='deleting'?state.job_id:challenge.id,deletionSession:receipt,accountEpoch:state.epoch});
    }
    if(!await takeLimit(db,`deletion-email:${hash}`,5,3600000)) return json({ok:false,error:'rate_limited'},429,{'Retry-After':'3600'});
    const id=crypto.randomUUID(),code=randomCode(),codeHash=await digest(env,`delete-code\n${email}\n${id}\n${code}`);
    const reserved=await db.prepare(`INSERT INTO ds_deletion_challenges(account_hash,id,code_hash,expires,sent_at,account_epoch)
      VALUES(?,?,?,?,?,?) ON CONFLICT(account_hash) DO UPDATE SET id=excluded.id,code_hash=excluded.code_hash,
      expires=excluded.expires,sent_at=excluded.sent_at,account_epoch=excluded.account_epoch,attempts=0,ready=0,receipt_hash=''
      WHERE sent_at<=? RETURNING id`).bind(hash,id,codeHash,now+ttl,now,state.epoch,now-60000).first();
    if(!reserved) return json({ok:false,error:'resend_wait'},429,{'Retry-After':'60'});
    const texts={
      pt:['Confirmação de EXCLUSÃO de conta — Deuce Score',`Seu código exclusivo para EXCLUIR permanentemente sua conta Deuce Score é: ${code}\n\nExpira em 15 minutos. Informe-o somente na página de exclusão que você abriu. Não envie este código ao suporte ou a outra pessoa. Este código não serve para entrar no app.\n\nA exclusão remove seus dados pessoais e preserva placares compartilhados sem sua identificação. Se você não solicitou a exclusão, ignore este e-mail. Nada será excluído apenas por receber esta mensagem.`],
      en:['Account DELETION confirmation — Deuce Score',`Your code to permanently DELETE your Deuce Score account is: ${code}\n\nIt expires in 15 minutes. Enter it only on the deletion page you opened. Do not send this code to support or anyone else. It cannot be used to sign in.\n\nDeletion removes personal data while retaining shared scores without your identity. If you did not request deletion, ignore this email. Receiving this message alone does not delete anything.`],
      es:['Confirmación de ELIMINACIÓN de cuenta — Deuce Score',`Tu código para ELIMINAR permanentemente tu cuenta Deuce Score es: ${code}\n\nVence en 15 minutos. Escríbelo solo en la página de eliminación que abriste. No lo envíes al soporte ni a otra persona. No sirve para iniciar sesión.\n\nLa eliminación borra datos personales y conserva marcadores compartidos sin identificarte. Si no solicitaste la eliminación, ignora este correo. Recibir este mensaje no elimina nada.`]
    };
    const [subject,textContent]=texts[body.language]||texts.en;let sent=false;
    try {
      const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:env.BREVO_SENDER_EMAIL,name:'Deuce Score'},to:[{email}],subject,textContent})});sent=response.ok;
    } catch { /* Never log OTP, address or provider credentials. */ }
    if(!sent) {await db.prepare('DELETE FROM ds_deletion_challenges WHERE account_hash=? AND id=?').bind(hash,id).run();return json({ok:false,error:'email_unavailable'},503);}
    await db.prepare('UPDATE ds_deletion_challenges SET ready=1 WHERE account_hash=? AND id=?').bind(hash,id).run();
    return json({ok:true});
  } catch {return json({ok:false,error:'service_unavailable'},503);}
}
