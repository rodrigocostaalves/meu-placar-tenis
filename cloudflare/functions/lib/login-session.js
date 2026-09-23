import {json} from './api-security.js';
import {issueSession,tokenHash} from './competition-auth.js';
import {accountHash,accountState,createPrivateStore} from './private-data.js';

// Call ONLY after proving ownership (consumed email OTP or dedicated review key).
// Both methods use exactly the same account epochs, deletion barriers and sessions.
export async function completeAccountLogin(env,email,defaultName='') {
  const db=env.COMPETITIONS_DB,ownerHash=await accountHash(email),state=await accountState(db,ownerHash);
  if(state.state==='deleting') {
    const receipt=crypto.randomUUID()+crypto.randomUUID();
    const rebound=await db.prepare("UPDATE ds_account_deletions SET receipt_hash=? WHERE id=? AND account_hash=? AND state='pending'")
      .bind(await tokenHash(receipt),state.job_id,ownerHash).run();
    if(rebound.meta.changes!==1) return json({ok:false,error:'account_changed'},409);
    return json({ok:true,existing:null,deletionPending:true,deletionSession:receipt,requestId:state.job_id,accountEpoch:state.epoch});
  }
  if(state.state==='deleted') await db.prepare("UPDATE ds_data_accounts SET state='active' WHERE account_hash=? AND state='deleted' AND epoch=?")
    .bind(ownerHash,state.epoch).run();
  const competitionSession=await issueSession(db,email,state.epoch);
  const store=await createPrivateStore(env,email,state.epoch);
  const player=await store.get(`players:${email}`,'json');
  const existing=player?{name:player.name||'',zip:player.zip||'',country:player.country||'',countryCode:player.countryCode||'',shareLocation:!!player.shareLocation}
    :defaultName?{name:defaultName,zip:'',country:'',countryCode:'',shareLocation:false}:null;
  return json({ok:true,existing,competitionSession,accountEpoch:state.epoch});
}
