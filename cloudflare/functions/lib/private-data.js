// Private writes are transactional D1 writes. KV is a legacy read source only.
import {tokenHash} from './competition-auth.js';
export const privateFamilies = ['players','backup','ratings','listings','listingref','invites','league-invites','pending-results','cmatch','shared-leagues','shared-league-index','pending-league-results','email-verifications'];
export const ownedFamilies = new Set(['players','backup','ratings','listings','shared-league-index','email-verifications']);
export const emailKey = value => String(value || '').trim().toLowerCase();
export const isEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const accountHash = email => tokenHash('deuce-account:' + emailKey(email));
export const recordHash = key => tokenHash('deuce-record:' + key);
export async function accountState(db, hash) {
  return await db.prepare('SELECT epoch,state,job_id FROM ds_data_accounts WHERE account_hash=?').bind(hash).first() || {epoch:0,state:'active',job_id:''};
}
export function failure(code, status=409) { return Object.assign(new Error(code),{status}); }
export function collectEmails(value, output=new Set()) {
  if (isEmail(value)) output.add(emailKey(value));
  else if (Array.isArray(value)) value.forEach(v=>collectEmails(v,output));
  else if (value && typeof value==='object') Object.values(value).forEach(v=>collectEmails(v,output));
  return output;
}
const nameFields = {
  email:['name','displayName','photo','photoUri','avatar','avatarUrl'],
  fromEmail:['fromName'],toEmail:['toName'],opponentEmail:['opponent'],playerEmail:['playerName'],
  owner:['ownerName'],createdBy:['createdByName'],reporterEmail:['reporterName'],
  winnerEmail:['winnerName'],loserEmail:['loserName'],a:['aName'],b:['bName']
};
const escape = value => encodeURIComponent(String(value));
function selectorHash(value) {
  let hash=14695981039346656037n;
  for(const char of value) hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)))*1099511628211n);
  return hash.toString(16);
}
function childPath(value,index) {
  if(isEmail(value)) return '@value='+selectorHash(emailKey(value));
  if(value && typeof value==='object' && !Array.isArray(value)) {
    if(value.id) return '@id='+(isEmail(value.id)?selectorHash(emailKey(value.id)):escape(value.id));
    if(isEmail(value.email)) return '@email='+selectorHash(emailKey(value.email));
  }
  return String(index);
}
/** A mask is server-owned and keyed by stable object IDs, never accepted from the client. */
export function redact(value, erasedEmails, previousMask={}) {
  const mask={...previousMask}, names=new Set();
  function walk(node,path='') {
    if(Object.hasOwn(mask,path)) return mask[path];
    if(isEmail(node) && erasedEmails.has(emailKey(node))) {mask[path]='';return '';}
    if(Array.isArray(node)) return node.map((v,i)=>walk(v,path+'/'+childPath(v,i)));
    if(!node || typeof node!=='object') return node;
    const out={...node};
    for(const [field,raw] of Object.entries(node)) {
      if(isEmail(raw) && erasedEmails.has(emailKey(raw))) {
        mask[path+'/'+escape(field)]='';
        for(const name of nameFields[field] || []) if(name in node) {
          if(typeof node[name]==='string' && node[name]) names.add(node[name]);
          mask[path+'/'+escape(name)]=/photo|avatar/i.test(name)?'':'Deleted player';
        }
        if(field==='email' && 'name' in node) mask[path+'/deleted']=true;
        if(['pendingFor','reporter','reporterEmail'].includes(field) && node.status==='pending') mask[path+'/status']='rejected';
        // Optional free text in an affected record can contain the erased person's identity.
        for(const text of ['message','notes','comment','description']) if(text in node) mask[path+'/'+text]='';
      }
    }
    for(const [field,raw] of Object.entries(node)) {
      const next=path+'/'+escape(field);
      out[field]=Object.hasOwn(mask,next)?mask[next]:walk(raw,next);
    }
    if(Object.hasOwn(mask,path+'/deleted')) out.deleted=mask[path+'/deleted'];
    return out;
  }
  let data=walk(value);
  // Known names and exact email strings in legacy match logs must not survive a renamed player.
  function scrub(node,path='') {
    if(Array.isArray(node)) return node.map((v,i)=>scrub(v,path+'/'+childPath(v,i)));
    if(!node || typeof node!=='object') return node;
    return Object.fromEntries(Object.entries(node).map(([key,v])=>{
      const next=path+'/'+escape(key);
      if(typeof v==='string' && (names.has(v)||erasedEmails.has(emailKey(v)))) {
        const replacement=erasedEmails.has(emailKey(v))?'':'Deleted player';mask[next]=replacement;return [key,replacement];
      }
      return [key,scrub(v,next)];
    }));
  }
  data=scrub(data);
  return {data,mask};
}

export async function createPrivateStore(env, actor='', actorEpoch=0, deletionId='') {
  const db=env.COMPETITIONS_DB, raw=env.DEUCE_KV;
  if(!db) throw failure('setup_required',503);
  const actorHash=actor?await accountHash(actor):'';
  function parts(key) { const i=key.indexOf(':');return {family:key.slice(0,i),owner:ownedFamilies.has(key.slice(0,i))?key.slice(i+1):''}; }
  async function rowFor(key) {
    const row=await db.prepare('SELECT * FROM ds_private_records WHERE key_hash=?').bind(await recordHash(key)).first();
    if(row && !row.deleted && row.body==='') {
      const {results}=await db.prepare('SELECT body FROM ds_private_chunks WHERE key_hash=? ORDER BY part').bind(row.key_hash).all();
      if(!results.length) throw failure('storage_incomplete',503);
      row.body=results.map(r=>r.body).join('');
    }
    return row;
  }
  async function policies(data,legacy=false,maximum=300) {
    const emails=[...collectEmails(data)];
    if(emails.length>maximum) throw failure('too_many_participants',413);
    const hashes=await Promise.all(emails.map(accountHash));
    const {results}=await db.prepare('SELECT account_hash,epoch,state FROM ds_data_accounts WHERE account_hash IN (SELECT value FROM json_each(?))').bind(JSON.stringify(hashes)).all();
    const blocked=new Set(results.filter(r=>r.state!=='active'||(legacy&&r.epoch>0)).map(r=>r.account_hash));
    return {erased:new Set(emails.filter((_,i)=>blocked.has(hashes[i]))),hashes,emails};
  }
  async function save(key,value,{migration=false,maintenance=false,forceErased=new Set(),expectedRevision=null}={}) {
    const {family,owner}=parts(key);
    if(!privateFamilies.includes(family)) throw failure('unsupported_private_family',400);
    const ownerHash=owner?await accountHash(owner):'';
    const ownerState=owner?await accountState(db,ownerHash):{epoch:0,state:'active'};
    if(owner && ownerState.state!=='active' && !maintenance) throw failure('account_deleting');
    const data=typeof value==='string'?JSON.parse(value):value;
    for(let attempt=0;attempt<3;attempt++) {
      const old=await rowFor(key);
      if(expectedRevision!==null && (old?.revision??-1)!==expectedRevision) throw failure('data_changed');
      if(migration && old) return old;
      const policy=await policies(data,migration);
      forceErased.forEach(e=>policy.erased.add(emailKey(e)));
      const {data:clean,mask}=redact(data,policy.erased,JSON.parse(old?.mask||'{}'));
      const body=JSON.stringify(clean), maskText=JSON.stringify(mask);
      if(new TextEncoder().encode(maskText).length>500000) throw failure('backup_too_large',413);
      const chunks=[];
      if(new TextEncoder().encode(body).length>1000000) {
        for(let start=0;start<body.length;) {
          let end=Math.min(start+200000,body.length);
          if(end<body.length && /[\uD800-\uDBFF]/.test(body[end-1])) end++;
          chunks.push(body.slice(start,end));start=end;
        }
      }
      const references=[...collectEmails(clean)];
      if(owner) references.push(emailKey(owner));
      const hashes=[...new Set(await Promise.all(references.map(accountHash)))];
      // Capture incarnations as well as state: delete + recreate between the read
      // and this batch must not allow a write based on an old identity snapshot.
      const states=await db.prepare('SELECT account_hash,epoch FROM ds_data_accounts WHERE account_hash IN (SELECT value FROM json_each(?))').bind(JSON.stringify(hashes)).all();
      const epochs=new Map(states.results.map(r=>[r.account_hash,r.epoch]));
      const incarnations=hashes.map(h=>({hash:h,epoch:epochs.get(h)||0}));
      const hash=await recordHash(key), op=crypto.randomUUID(), revision=old?.revision??-1;
      const checkActor=deletionId?`EXISTS(SELECT 1 FROM ds_account_deletions WHERE id=? AND state='pending')`:
        maintenance||!actorHash?'1':`NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))`;
      const actorArgs=deletionId?[deletionId]:maintenance||!actorHash?[]:[actorHash,actorEpoch];
      const allowed=`${checkActor} AND NOT EXISTS(SELECT 1 FROM json_each(?) j JOIN ds_data_accounts a ON a.account_hash=json_extract(j.value,'$.hash') WHERE a.state!='active' OR a.epoch!=json_extract(j.value,'$.epoch'))`;
      const statements=[
        db.prepare(`INSERT INTO ds_private_records(key_hash,key_name,family,owner_hash,owner_epoch,body,mask,deleted,revision,last_op)
          SELECT ?,?,?,?,?,?,?,0,0,? WHERE ${allowed}
          ON CONFLICT(key_hash) DO UPDATE SET key_name=excluded.key_name,body=excluded.body,mask=excluded.mask,deleted=0,
          owner_hash=excluded.owner_hash,owner_epoch=excluded.owner_epoch,revision=ds_private_records.revision+1,last_op=excluded.last_op
          WHERE ds_private_records.revision=?`).bind(hash,key,family,ownerHash,ownerState.epoch,chunks.length?'':body,maskText,op,...actorArgs,JSON.stringify(incarnations),revision),
        db.prepare('DELETE FROM ds_private_parties WHERE key_hash=? AND EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,hash,op),
        db.prepare('INSERT OR IGNORE INTO ds_private_parties(key_hash,account_hash) SELECT ?,j.value FROM json_each(?) j WHERE EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,JSON.stringify(hashes),hash,op),
        db.prepare('DELETE FROM ds_private_chunks WHERE key_hash=? AND EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,hash,op),
        ...chunks.map((chunk,index)=>db.prepare('INSERT INTO ds_private_chunks(key_hash,part,body) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,index,chunk,hash,op))
      ];
      const result=await db.batch(statements);
      if(result[0].meta.changes===1) return rowFor(key);
      if(expectedRevision!==null) throw failure('data_changed');
    }
    throw failure('data_changed');
  }
  async function tombstone(key,{maintenance=false,expectedRevision=null}={}) {
    const hash=await recordHash(key), old=await rowFor(key), op=crypto.randomUUID();
    if(expectedRevision!==null && (old?.revision??-1)!==expectedRevision) throw failure('data_changed');
    const condition=deletionId?`EXISTS(SELECT 1 FROM ds_account_deletions WHERE id=? AND state='pending')`:
      maintenance||!actorHash?'1':`NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))`;
    const args=deletionId?[deletionId]:maintenance||!actorHash?[]:[actorHash,actorEpoch];
    const results=await db.batch([
      db.prepare(`INSERT INTO ds_private_records(key_hash,key_name,family,body,deleted,last_op) SELECT ?,NULL,?,NULL,1,? WHERE ${condition}
        ON CONFLICT(key_hash) DO UPDATE SET key_name=NULL,body=NULL,mask='{}',deleted=1,revision=ds_private_records.revision+1,last_op=excluded.last_op WHERE ds_private_records.revision=?`)
        .bind(hash,parts(key).family,op,...args,old?.revision??-1),
      db.prepare('DELETE FROM ds_private_parties WHERE key_hash=? AND EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,hash,op),
      db.prepare('DELETE FROM ds_private_chunks WHERE key_hash=? AND EXISTS(SELECT 1 FROM ds_private_records WHERE key_hash=? AND last_op=?)').bind(hash,hash,op)
    ]);
    if(results[0].meta.changes!==1) throw failure('data_changed');
  }
  const store={
    rowFor,save,tombstone,raw,
    async privacyMask(key) {
      const row=await rowFor(key);
      if(!row || row.deleted)return {};
      const value=JSON.parse(row.body),policy=await policies(value);
      return redact(value,policy.erased,JSON.parse(row.mask||'{}')).mask;
    },
    async get(key,type) {
      let row=await rowFor(key);
      const {owner}=parts(key);
      const state=owner?await accountState(db,await accountHash(owner)):null;
      if(state && state.state!=='active') return null;
      if(!row) {
        if(state?.epoch>0) return null; // Never import an earlier incarnation's legacy backup/profile.
        const value=await raw.get(key,'json');
        if(value===null) return null;
        row=await save(key,value,{migration:true});
      }
      if(row.deleted || (state && row.owner_epoch!==state.epoch)) return null;
      const policy=await policies(JSON.parse(row.body));
      const value=redact(JSON.parse(row.body),policy.erased,JSON.parse(row.mask||'{}')).data;
      return type==='json'?value:JSON.stringify(value);
    },
    async put(key,value) {await save(key,value);},
    async update(key,transform) {
      for(let attempt=0;attempt<3;attempt++) {
        // Import before taking the revision used by this read/modify/write.
        await store.get(key,'json');
        const row=await rowFor(key),previous=row&&!row.deleted?JSON.parse(row.body):null;
        const value=transform(previous);
        if(value===previous) return {data:previous,changed:false};
        try {
          const saved=await save(key,value,{expectedRevision:row?.revision??-1});
          return {data:JSON.parse(saved.body),changed:true};
        } catch(error) {if(error.message!=='data_changed'||attempt===2)throw error;}
      }
    },
    async delete(key) {await tombstone(key);await raw.delete(key);},
    async removeIf(key,predicate) {
      await store.get(key,'json');
      const row=await rowFor(key);
      if(!row || row.deleted) return;
      predicate(JSON.parse(row.body));
      await tombstone(key,{expectedRevision:row.revision});
      await raw.delete(key);
    },
    async related(family,after='') {
      if(family!=='pending-results' || !actorHash) throw failure('invalid_family',400);
      if(after && !/^[a-f0-9]{64}$/.test(after)) throw failure('invalid_cursor',400);
      // Import one old result per refresh, not an unbounded scan in one Worker.
      // Persist the KV page, reducing list calls and surviving interruption.
      const progress=await db.prepare('SELECT * FROM ds_private_import_cursors WHERE account_hash=? AND family=?').bind(actorHash,family).first();
      let migrationPending=actorEpoch===0&&!progress?.complete;
      if(migrationPending) {
        let work=JSON.parse(progress?.work||'{}'),cursor=progress?.cursor||'',complete=0;
        if(!work.keys) {
          const page=await raw.list({prefix:family+':',limit:10,...(cursor?{cursor}:{})});
          work={keys:page.keys.map(k=>k.name),next:page.cursor||'',complete:page.list_complete};
        }
        if(work.keys.length) {
          const key=work.keys[0];
          if(!await rowFor(key)) {
            const value=await raw.get(key,'json');
            if(value && collectEmails(value).has(actor)) await save(key,value,{migration:true});
          }
          work.keys.shift();
        }
        if(!work.keys.length) {cursor=work.next;complete=work.complete?1:0;work={};}
        await db.prepare(`INSERT INTO ds_private_import_cursors(account_hash,family,cursor,work,complete)
          SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ds_data_accounts WHERE account_hash=? AND (state!='active' OR epoch!=?))
          ON CONFLICT(account_hash,family) DO UPDATE SET cursor=excluded.cursor,work=excluded.work,complete=excluded.complete,revision=ds_private_import_cursors.revision+1
          WHERE ds_private_import_cursors.revision=?`).bind(actorHash,family,cursor,JSON.stringify(work),complete,actorHash,actorEpoch,progress?.revision??-1).run();
        migrationPending=!complete;
      }
      const {results}=await db.prepare(`SELECT r.* FROM ds_private_parties p JOIN ds_private_records r ON r.key_hash=p.key_hash
        WHERE p.account_hash=? AND r.family=? AND r.deleted=0 AND r.key_hash>? ORDER BY r.key_hash LIMIT 101`).bind(actorHash,family,after).all();
      const rows=results.slice(0,100),values=rows.map(r=>JSON.parse(r.body));
      const policy=await policies(values,false,5000);
      const more=results.length>100;
      return {records:values.map((v,i)=>redact(v,policy.erased,JSON.parse(rows[i].mask||'{}')).data),migrationPending,more,cursor:more?rows.at(-1).key_hash:''};
    },
    async list({prefix='',cursor='',limit=1000}={}) {
      let position={phase:'d1',after:''};
      if(cursor) {try {position=JSON.parse(atob(cursor));} catch {throw failure('invalid_cursor',400);}}
      limit=Math.max(1,Math.min(1000,limit));
      if(position.phase==='d1') {
        const {results}=await db.prepare('SELECT key_name FROM ds_private_records WHERE deleted=0 AND key_name>=? AND key_name<? AND key_name>? ORDER BY key_name LIMIT ?').bind(prefix,prefix+'\uffff',position.after||'',limit).all();
        const next=results.length===limit?{phase:'d1',after:results.at(-1).key_name}:{phase:'kv',after:''};
        return {keys:results.map(r=>({name:r.key_name})),list_complete:false,cursor:btoa(JSON.stringify(next))};
      }
      const page=await raw.list({prefix,limit,...(position.after?{cursor:position.after}:{})});
      // A migrated key was already emitted in the D1 phase. A tombstone must
      // never be listed, even while KV still returns that key from a stale view.
      const hashes=await Promise.all(page.keys.map(k=>recordHash(k.name)));
      const {results}=await db.prepare('SELECT key_hash FROM ds_private_records WHERE key_hash IN (SELECT value FROM json_each(?))').bind(JSON.stringify(hashes)).all();
      const shadowed=new Set(results.map(r=>r.key_hash));
      return {...page,keys:page.keys.filter((_,i)=>!shadowed.has(hashes[i])),cursor:page.list_complete?'':btoa(JSON.stringify({phase:'kv',after:page.cursor}))};
    }
  };
  return store;
}
