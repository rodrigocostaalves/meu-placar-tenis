import {privateContext} from '../lib/api-security.js';
import {authenticateSession} from '../lib/competition-auth.js';
import {accountHash,collectEmails,redact} from '../lib/private-data.js';
import {createCompetition, mutateCompetition, members, view, requireThat, emailKey} from '../lib/competitions-core.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store'}});
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

async function guards(c,actor,epoch) {
  const hashes=await Promise.all([...collectEmails(c)].map(accountHash));
  return {sql:`NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))
    AND NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash IN (SELECT value FROM json_each(?)) AND state!='active')`,
    args:[await accountHash(actor),epoch,JSON.stringify(hashes)]};
}
async function safeViews(db,rows) {
  const values=rows.map(row=>JSON.parse(row.data)),emails=[...collectEmails(values)],hashes=await Promise.all(emails.map(accountHash));
  const {results}=await db.prepare("SELECT account_hash FROM ds_data_accounts WHERE account_hash IN (SELECT value FROM json_each(?)) AND state!='active'").bind(JSON.stringify(hashes)).all();
  const blocked=new Set(results.map(r=>r.account_hash));
  const erased=new Set(emails.filter((_,i)=>blocked.has(hashes[i])));
  return values.map((c,i)=>view(redact(c,erased).data,rows[i].version));
}
async function safeView(db,row) {return (await safeViews(db,[row]))[0];}
async function insert(db, c, actor, epoch) {
  const op = crypto.randomUUID();
  const guard=await guards(c,actor,epoch);
  const statements = [db.prepare('INSERT OR IGNORE INTO ds_competitions(id,owner,kind,data,last_op) SELECT ?,?,?,?,? WHERE '+guard.sql).bind(c.id,c.owner,c.kind,JSON.stringify(c),op,...guard.args)];
  statements.push(db.prepare('INSERT OR IGNORE INTO ds_competition_members(competition_id,email) SELECT c.id,j.value FROM ds_competitions c,json_each(?) j WHERE c.id=? AND c.last_op=?').bind(JSON.stringify(members(c)),c.id,op));
  return db.batch(statements);
}
export async function onRequestPost(context) {
  const {request,env}=await privateContext(context);
  try {
    const db = env.COMPETITIONS_DB;
    requireThat(db, 'setup_required', 503);
    const session = await authenticateSession(request, db);
    requireThat(session, 'verify_account', 401);
    const {email:actor,epoch}=session;
    const raw = await request.text(); requireThat(raw.length <= 65536, 'request_too_large', 413);
    let input;
    try { input = JSON.parse(raw); } catch { requireThat(false, 'invalid_json'); }
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 'invalid_json');
    if (input.action === 'list') {
      const {results} = await db.prepare('SELECT c.data,c.version FROM ds_competitions c JOIN ds_competition_members m ON m.competition_id=c.id WHERE m.email=? AND c.deleted=0 ORDER BY c.id LIMIT 101').bind(actor).all();
      return json({ok:true, competitions:await safeViews(db,results.slice(0,100)), more:results.length>100});
    }
    // One explicit legacy import; ordinary reads and validation never scan/use KV.
    if (input.action === 'import') {
      const done = await db.prepare('SELECT next_index,complete FROM ds_competition_imports WHERE email=?').bind(actor).first();
      if (!done?.complete) {
        const ids = await env.DEUCE_KV.get(`shared-league-index:${actor}`, 'json') || [];
        requireThat(Array.isArray(ids) && ids.length <= 100, 'legacy_import_too_large');
        const start = done?.next_index || 0;
        for (const id of ids.slice(start,start+10)) {
          const old = await env.DEUCE_KV.get(`shared-leagues:${id}`, 'json');
          if (!old) continue;
          const owner = emailKey(old.createdBy);
          const players = (old.players || []).map(p => ({...p, email:emailKey(p.email)}));
          if (![owner,...players.map(p=>p.email)].includes(actor)) continue;
          const c = {id:old.id, kind:'league', name:old.name, owner, ownerName:old.createdByName || owner,
            players, results:[], legacyHistory:old.matchLog || [], createdAt:old.createdAt || ''};
          await insert(db,c,actor,epoch); // Existing D1 state is never overwritten by an old KV snapshot.
        }
        const next = Math.min(ids.length,start+10), complete = next >= ids.length;
        await db.prepare(`INSERT INTO ds_competition_imports(email,next_index,complete) SELECT ?,?,?
          WHERE NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))
          ON CONFLICT(email) DO UPDATE SET next_index=MAX(next_index,excluded.next_index),complete=MAX(complete,excluded.complete)`)
          .bind(actor,next,complete?1:0,await accountHash(actor),epoch).run();
        return json({ok:true,importMore:!complete});
      }
      return json({ok:true});
    }
    requireThat(validId(input.requestId), 'request_id_required');
    if (input.action === 'create') {
      const c = createCompetition(input,actor);
      await insert(db,c,actor,epoch);
      const row = await db.prepare('SELECT owner,data,version FROM ds_competitions WHERE id=?').bind(c.id).first();
      requireThat(row?.owner === actor, 'request_conflict', 409);
      return json({ok:true, competition:await safeView(db,row)});
    }
    requireThat(typeof input.id === 'string' && input.id.length <= 150, 'invalid_id');
    const row = await db.prepare('SELECT data,version,deleted,last_op FROM ds_competitions WHERE id=?').bind(input.id).first();
    requireThat(row, 'not_found', 404);
    const current = JSON.parse(row.data);
    requireThat(members(current).includes(actor), 'not_member', 403);
    if (row.last_op === input.requestId) return json({ok:true, competition:await safeView(db,row)});
    requireThat(!row.deleted, 'not_found', 404);
    requireThat(!current.ownerDeleted,'organizer_deleted_read_only',409);
    const next = mutateCompetition(current,input,actor);
    if (next === current) return json({ok:true, competition:await safeView(db,row)});
    requireThat(Number.isInteger(input.version) && input.version === row.version, 'changed_reload', 409);
    const op = input.requestId;
    const guard=await guards(next,actor,epoch);
    const statements = [db.prepare('UPDATE ds_competitions SET data=?,version=version+1,last_op=?,deleted=? WHERE id=? AND version=? AND '+guard.sql).bind(JSON.stringify(next),op,next.deleted?1:0,input.id,row.version,...guard.args)];
    statements.push(db.prepare('DELETE FROM ds_competition_members WHERE competition_id=? AND EXISTS(SELECT 1 FROM ds_competitions WHERE id=? AND last_op=?)').bind(input.id,input.id,op));
    statements.push(db.prepare('INSERT OR IGNORE INTO ds_competition_members(competition_id,email) SELECT c.id,j.value FROM ds_competitions c,json_each(?) j WHERE c.id=? AND c.last_op=?').bind(JSON.stringify(members(next)),input.id,op));
    const result = await db.batch(statements); // Atomic compare-and-swap + membership; no lost simultaneous score.
    requireThat(result[0].meta.changes === 1, 'changed_reload', 409);
    return json({ok:true, competition:view(next,row.version+1)});
  } catch (error) {
    console.error('competitions', error.status || 500, error.message);
    return json({ok:false,error:error.status ? error.message : 'server_error'},error.status || 500);
  }
}
