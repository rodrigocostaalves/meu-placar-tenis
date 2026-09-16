import {tokenHash,authenticate} from './competition-auth.js';
import {accountHash,accountState,createPrivateStore,collectEmails,emailKey,failure,privateFamilies,ownedFamilies} from './private-data.js';
import {anonymizeCompetitions} from './competition-anonymization.js';

const ephemeral=new Set(['invites','league-invites','pending-results','pending-league-results','listingref','email-verifications']);
const validJob=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);

// The same request can be retried after a lost response, including after normal
// sessions have been revoked. This hashed receipt is never an API session.
export async function deletionJob(request,env,input) {
  const db=env.COMPETITIONS_DB;
  if(!db) throw failure('setup_required',503);
  const email=emailKey(input.email),hash=await accountHash(email);
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[a-f0-9-]{72}$/.test(token)) throw failure('verify_account',401);
  if(!validJob(input.requestId)) throw failure('request_id_required',400);
  const receipt=await tokenHash(token);
  let job=await db.prepare('SELECT * FROM ds_account_deletions WHERE id=?').bind(input.requestId).first();
  if(job) {
    if(job.account_hash!==hash || job.receipt_hash!==receipt) throw failure('verify_account',401);
  } else {
    const current=await accountState(db,hash);
    if(await authenticate(request,db)!==email) {
      const proof=await db.prepare(`SELECT id FROM ds_deletion_challenges WHERE account_hash=? AND id=? AND receipt_hash=?
        AND ready=1 AND receipt_hash<>'' AND expires>? AND account_epoch=?`).bind(hash,input.requestId,receipt,Date.now(),current.epoch).first();
      if(!proof) throw failure('verify_account',401);
    }
    if(current.state!=='active') throw failure('deletion_already_requested',409);
    const epoch=Math.max(Date.now(),current.epoch+1);
    const result=await db.batch([
      db.prepare(`INSERT INTO ds_data_accounts(account_hash,epoch,state,job_id) VALUES(?,?,'deleting',?)
        ON CONFLICT(account_hash) DO UPDATE SET epoch=excluded.epoch,state='deleting',job_id=excluded.job_id
        WHERE ds_data_accounts.state='active' AND ds_data_accounts.epoch=?`).bind(hash,epoch,input.requestId,current.epoch),
      db.prepare(`INSERT INTO ds_account_deletions(id,account_hash,receipt_hash,epoch)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND state='deleting' AND job_id=?)`)
        .bind(input.requestId,hash,receipt,epoch,hash,input.requestId)
    ]);
    if(result[1].meta.changes!==1) throw failure('deletion_already_requested',409);
    job=await db.prepare('SELECT * FROM ds_account_deletions WHERE id=?').bind(input.requestId).first();
  }
  if(job.state==='done') return {ok:true,done:true,requestId:job.id,accountEpoch:job.epoch};
  const store=await createPrivateStore(env,'',0,job.id);
  async function clean(key,legacyValue) {
    const row=await store.rowFor(key),family=key.split(':')[0];
    if(row?.deleted) {await store.raw.delete(key);return;}
    const owned=ownedFamilies.has(family)&&emailKey(key.slice(family.length+1))===email;
    const value=row?JSON.parse(row.body):legacyValue;
    if(!owned && !collectEmails(value).has(email)) {
      // A prior attempt may have sanitized D1 and failed on KV removal. Do not
      // skip that remaining raw copy just because D1 no longer contains email.
      if(row && collectEmails(legacyValue).has(email)) await store.raw.delete(key);
      return;
    }
    if(owned || ephemeral.has(family)) {
      await store.tombstone(key,{maintenance:true,expectedRevision:row?.revision??-1});
    } else {
      await store.save(key,value,{maintenance:true,forceErased:new Set([email]),expectedRevision:row?.revision??-1});
    }
    // Commit the shadow/tombstone before touching eventual-consistency KV.
    await store.raw.delete(key);
  }
  let phase=job.phase,cursor=job.cursor,work=JSON.parse(job.work||'{}');
  if(phase===0) {
    const {results}=await db.prepare(`SELECT r.key_name FROM ds_private_records r JOIN ds_private_parties p ON p.key_hash=r.key_hash
      WHERE p.account_hash=? AND r.deleted=0 ORDER BY r.key_hash LIMIT 1`).bind(hash).all();
    for(const row of results) await clean(row.key_name);
    if(!results.length) {phase++;cursor='';}
  } else if(phase===1) {
    if(await anonymizeCompetitions(db,email,job.id)) {phase++;cursor='';}
  } else if(phase===2) {
    // One bounded page per request. An empty KV page can still have a cursor.
    const position=cursor?JSON.parse(cursor):{family:0,after:''};
    if(!work.keys) {
      const page=await store.raw.list({prefix:privateFamilies[position.family]+':',limit:10,...(position.after?{cursor:position.after}:{})});
      work={keys:page.keys.map(k=>k.name),complete:page.list_complete,next:page.cursor||''};
    }
    // One potentially large backup per invocation stays within D1 Free limits.
    if(work.keys.length) {const key=work.keys[0];await clean(key,await store.raw.get(key,'json'));work.keys.shift();}
    if(!work.keys.length) {
      if(work.complete) {position.family++;position.after='';} else position.after=work.next;
      work={};
    }
    if(position.family>=privateFamilies.length) {phase++;cursor='';} else cursor=JSON.stringify(position);
  } else if(phase===3) {
    // Also cover own keys absent from an eventually consistent list response.
    for(const family of ownedFamilies) {
      await store.tombstone(family+':'+email,{maintenance:true});
      await store.raw.delete(family+':'+email);
    }
    phase++;cursor='';
  } else if(phase===4) {
    // Ranking endpoints are retired, but their old database can retain identity.
    if(env.RANKING_DB) {
      const tables=await env.RANKING_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ranking_players','ranking_matches')").all();
      const names=new Set(tables.results.map(r=>r.name)),statements=[];
      if(names.has('ranking_matches')) statements.push(env.RANKING_DB.prepare(`UPDATE ranking_matches
        SET player_a_email=CASE WHEN lower(player_a_email)=? THEN '' ELSE player_a_email END,
        player_b_email=CASE WHEN lower(player_b_email)=? THEN '' ELSE player_b_email END
        WHERE lower(player_a_email)=? OR lower(player_b_email)=?`).bind(email,email,email,email));
      if(names.has('ranking_players')) statements.push(env.RANKING_DB.prepare('DELETE FROM ranking_players WHERE lower(email)=?').bind(email));
      if(statements.length) await env.RANKING_DB.batch(statements);
    }
    phase++;cursor='';
  } else {
    const guard="EXISTS(SELECT 1 FROM ds_account_deletions WHERE id=? AND state='pending' AND phase=5 AND revision=?)";
    await db.batch([
      db.prepare('DELETE FROM ds_auth_challenges WHERE email=? AND '+guard).bind(email,job.id,job.revision),
      db.prepare('DELETE FROM ds_deletion_challenges WHERE account_hash=? AND '+guard).bind(hash,job.id,job.revision),
      db.prepare('DELETE FROM ds_competition_imports WHERE email=? AND '+guard).bind(email,job.id,job.revision),
      db.prepare('DELETE FROM ds_private_import_cursors WHERE account_hash=? AND '+guard).bind(hash,job.id,job.revision),
      db.prepare('DELETE FROM ds_competition_sessions WHERE email=? AND '+guard).bind(email,job.id,job.revision),
      db.prepare(`UPDATE ds_account_deletions SET state='done',cursor='',work='{}',revision=revision+1
        WHERE id=? AND state='pending' AND revision=? AND phase=5`).bind(job.id,job.revision),
      db.prepare(`UPDATE ds_data_accounts SET state='deleted' WHERE account_hash=? AND state='deleting' AND job_id=? AND
        EXISTS(SELECT 1 FROM ds_account_deletions WHERE id=? AND state='done')`).bind(hash,job.id,job.id)
    ]);
    job=await db.prepare('SELECT * FROM ds_account_deletions WHERE id=?').bind(job.id).first();
    return {ok:true,done:job.state==='done',requestId:job.id,accountEpoch:job.epoch};
  }
  await db.prepare(`UPDATE ds_account_deletions SET phase=?,cursor=?,work=?,revision=revision+1 WHERE id=? AND revision=? AND state='pending'`)
    .bind(phase,cursor,JSON.stringify(work),job.id,job.revision).run();
  return {ok:true,done:false,requestId:job.id,accountEpoch:job.epoch};
}
