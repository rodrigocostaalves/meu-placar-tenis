// A bounded, retryable part of the existing explicit account-deletion flow.
export async function cleanupCompetitions(db, email) {
  const {results} = await db.prepare('SELECT c.id,c.owner,c.data,c.version FROM ds_competitions c JOIN ds_competition_members m ON m.competition_id=c.id WHERE m.email=? LIMIT 10').bind(email).all();
  for (const row of results) {
    if (row.owner === email) {
      await db.batch([
        db.prepare('DELETE FROM ds_competition_members WHERE competition_id=?').bind(row.id),
        db.prepare('DELETE FROM ds_competitions WHERE id=? AND owner=?').bind(row.id,email)
      ]);
    } else {
      const c = JSON.parse(row.data), names = new Set();
      for (const player of c.players) if (player.email === email) {
        names.add(player.name); player.email = ''; player.name = `Deleted player ${player.id}`; player.deleted = true;
      }
      for (const r of c.results) {
        if (r.reporter === email) r.reporter = '';
        if (r.pendingFor === email) { r.pendingFor = ''; if (r.status === 'pending') r.status = 'rejected'; }
      }
      for (const r of c.legacyHistory || []) {
        if (r.reporterEmail === email) r.reporterEmail = '';
        if (names.has(r.winnerName)) r.winnerName = 'Deleted player';
        if (names.has(r.loserName)) r.loserName = 'Deleted player';
      }
      const op = crypto.randomUUID();
      const changed = await db.batch([
        db.prepare('UPDATE ds_competitions SET data=?,version=version+1,last_op=? WHERE id=? AND version=?').bind(JSON.stringify(c),op,row.id,row.version),
        db.prepare('DELETE FROM ds_competition_members WHERE competition_id=? AND email=? AND EXISTS(SELECT 1 FROM ds_competitions WHERE id=? AND last_op=?)').bind(row.id,email,row.id,op)
      ]);
      if (changed[0].meta.changes !== 1) return false;
    }
  }
  const remaining = await db.prepare('SELECT competition_id FROM ds_competition_members WHERE email=? LIMIT 1').bind(email).first();
  if (remaining) return false;
  await db.prepare('DELETE FROM ds_competition_imports WHERE email=?').bind(email).run();
  return true;
}
