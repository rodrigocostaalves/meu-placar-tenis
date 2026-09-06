export async function tokenHash(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
    .map(x => x.toString(16).padStart(2,'0')).join('');
}
export async function issueSession(db, email) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await db.batch([
    db.prepare('DELETE FROM ds_competition_sessions WHERE expires < ?').bind(Date.now()),
    db.prepare('INSERT INTO ds_competition_sessions(token_hash,email,expires) VALUES(?,?,?)')
      .bind(await tokenHash(token), email, Date.now() + 30*86400000)
  ]);
  return token;
}
export async function authenticate(request, db) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (!/^[a-f0-9-]{72}$/.test(token)) return null;
  const row = await db.prepare('SELECT email FROM ds_competition_sessions WHERE token_hash = ? AND expires > ?')
    .bind(await tokenHash(token), Date.now()).first();
  return row?.email || null;
}
