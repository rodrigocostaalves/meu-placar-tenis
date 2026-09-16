import {redact} from './private-data.js';

// Keep sporting history. An organiser's deletion never silently transfers
// ownership: participants retain a read-only archive in that case.
export async function anonymizeCompetitions(db,email,jobId) {
  const {results}=await db.prepare(`SELECT c.id,c.owner,c.data,c.version FROM ds_competitions c
    WHERE c.id IN (SELECT id FROM ds_competitions WHERE owner=? UNION SELECT competition_id FROM ds_competition_members WHERE email=?)
    ORDER BY c.id LIMIT 10`).bind(email,email).all();
  for(const row of results) {
    const c=redact(JSON.parse(row.data),new Set([email])).data;
    if(row.owner===email) {c.owner='';c.ownerName='Deleted player';c.ownerDeleted=true;}
    const op=crypto.randomUUID();
    const changed=await db.batch([
      db.prepare(`UPDATE ds_competitions SET owner=?,data=?,version=version+1,last_op=?
        WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM ds_account_deletions WHERE id=? AND state='pending')`)
        .bind(c.owner,JSON.stringify(c),op,row.id,row.version,jobId),
      db.prepare('DELETE FROM ds_competition_members WHERE competition_id=? AND email=? AND EXISTS(SELECT 1 FROM ds_competitions WHERE id=? AND last_op=?)')
        .bind(row.id,email,row.id,op)
    ]);
    if(changed[0].meta.changes!==1) return false;
  }
  return !await db.prepare(`SELECT id FROM ds_competitions WHERE owner=? UNION
    SELECT competition_id FROM ds_competition_members WHERE email=? LIMIT 1`).bind(email,email).first();
}
