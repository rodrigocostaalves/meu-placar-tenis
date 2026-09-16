export async function tokenHash(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
    .map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function issueSession(db, email, epoch=0) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const results=await db.batch([
    db.prepare('DELETE FROM ds_competition_sessions WHERE expires < ?').bind(Date.now()),
    db.prepare(`INSERT INTO ds_competition_sessions(token_hash,email,expires,account_epoch) SELECT ?,?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))`)
      .bind(await tokenHash(token), email, Date.now() + 30*86400000,epoch,await tokenHash('deuce-account:'+email),epoch)
  ]);
  if(results[1].meta.changes!==1) throw new Error('account_changed');
  return token;
}
export async function authenticateSession(request, db) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (!/^[a-f0-9-]{72}$/.test(token)) return null;
  const row = await db.prepare('SELECT email,account_epoch FROM ds_competition_sessions WHERE token_hash = ? AND expires > ?')
    .bind(await tokenHash(token), Date.now()).first();
  if(!row) return null;
  const account=await db.prepare('SELECT state,epoch FROM ds_data_accounts WHERE account_hash=?')
    .bind(await tokenHash('deuce-account:'+row.email)).first();
  const epoch=account?.epoch||0;
  const clientEpoch=request.headers.get('X-Deuce-Account-Epoch')||'0';
  if((account&&account.state!=='active')||row.account_epoch!==epoch||clientEpoch!==String(epoch)) return null;
  return {email:row.email,epoch};
}
export async function authenticate(request,db) {return (await authenticateSession(request,db))?.email||null;}
