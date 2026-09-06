import {authenticate} from '../lib/competition-auth.js';
import {createCompetition, mutateCompetition, members, view, requireThat, emailKey} from '../lib/competitions-core.js';
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json','Cache-Control':'no-store'}});
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);

async function insert(db, c) {
  const op = crypto.randomUUID();
  const statements = [db.prepare('INSERT OR IGNORE INTO ds_competitions(id,owner,kind,data,last_op) VALUES(?,?,?,?,?)').bind(c.id,c.owner,c.kind,JSON.stringify(c),op)];
  statements.push(db.prepare('INSERT OR IGNORE INTO ds_competition_members(competition_id,email) SELECT c.id,j.value FROM ds_competitions c,json_each(?) j WHERE c.id=? AND c.last_op=?').bind(JSON.stringify(members(c)),c.id,op));
  return db.batch(statements);
}
export async function onRequestPost({request, env}) {
  try {
    const db = env.COMPETITIONS_DB;
    requireThat(db, 'setup_required', 503);
    const actor = await authenticate(request, db);
    requireThat(actor, 'verify_account', 401);
    const raw = await request.text(); requireThat(raw.length <= 65536, 'request_too_large', 413);
    let input;
    try { input = JSON.parse(raw); } catch { requireThat(false, 'invalid_json'); }
    requireThat(input && typeof input === 'object' && !Array.isArray(input), 'invalid_json');
    if (input.action === 'list') {
      const {results} = await db.prepare('SELECT c.data,c.version FROM ds_competitions c JOIN ds_competition_members m ON m.competition_id=c.id WHERE m.email=? AND c.deleted=0 ORDER BY c.id LIMIT 101').bind(actor).all();
      return json({ok:true, competitions:results.slice(0,100).map(row => view(JSON.parse(row.data),row.version)), more:results.length>100});
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
          await insert(db,c); // Existing D1 state is never overwritten by an old KV snapshot.
        }
        const next = Math.min(ids.length,start+10), complete = next >= ids.length;
        await db.prepare('INSERT INTO ds_competition_imports(email,next_index,complete) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET next_index=MAX(next_index,excluded.next_index),complete=MAX(complete,excluded.complete)').bind(actor,next,complete?1:0).run();
        return json({ok:true,importMore:!complete});
      }
      return json({ok:true});
    }
    requireThat(validId(input.requestId), 'request_id_required');
    if (input.action === 'create') {
      const c = createCompetition(input,actor);
      await insert(db,c);
      const row = await db.prepare('SELECT owner,data,version FROM ds_competitions WHERE id=?').bind(c.id).first();
      requireThat(row?.owner === actor, 'request_conflict', 409);
      return json({ok:true, competition:view(JSON.parse(row.data),row.version)});
    }
    requireThat(typeof input.id === 'string' && input.id.length <= 150, 'invalid_id');
    const row = await db.prepare('SELECT data,version,deleted,last_op FROM ds_competitions WHERE id=?').bind(input.id).first();
    requireThat(row, 'not_found', 404);
    const current = JSON.parse(row.data);
    requireThat(members(current).includes(actor), 'not_member', 403);
    if (row.last_op === input.requestId) return json({ok:true, competition:view(current,row.version)});
    requireThat(!row.deleted, 'not_found', 404);
    const next = mutateCompetition(current,input,actor);
    if (next === current) return json({ok:true, competition:view(current,row.version)});
    requireThat(Number.isInteger(input.version) && input.version === row.version, 'changed_reload', 409);
    const op = input.requestId;
    const statements = [db.prepare('UPDATE ds_competitions SET data=?,version=version+1,last_op=?,deleted=? WHERE id=? AND version=?').bind(JSON.stringify(next),op,next.deleted?1:0,input.id,row.version)];
    statements.push(db.prepare('INSERT OR IGNORE INTO ds_competition_members(competition_id,email) SELECT c.id,j.value FROM ds_competitions c,json_each(?) j WHERE c.id=? AND c.last_op=?').bind(JSON.stringify(members(next)),input.id,op));
    const result = await db.batch(statements); // Atomic compare-and-swap + membership; no lost simultaneous score.
    requireThat(result[0].meta.changes === 1, 'changed_reload', 409);
    return json({ok:true, competition:view(next,row.version+1)});
  } catch (error) {
    console.error('competitions', error.status || 500, error.message);
    return json({ok:false,error:error.status ? error.message : 'server_error'},error.status || 500);
  }
}
