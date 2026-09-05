const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' }
});
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function mergeHistory(oldPayload, incoming) {
  const deleted = [...new Set([...(oldPayload.deletedMatchIds || []), ...(incoming.deletedMatchIds || [])])];
  const tombstones = new Set(deleted);
  const byId = new Map();
  for (const m of oldPayload.matches || []) if (m && m.id) byId.set(m.id,m);
  for (const m of incoming.matches || []) if (m && m.id) {
    const old = byId.get(m.id);
    const newerOld = Date.parse(old?.modifiedAt) > Date.parse(m.modifiedAt);
    byId.set(m.id,newerOld ? old : {...old,...m});
  }
  // Preserve the caller's display order, then retain records absent from its snapshot.
  const order = [...new Set([...(incoming.matches || []).map(m=>m?.id), ...byId.keys()])];
  return {...oldPayload,...incoming,deletedMatchIds:deleted,matches:order.filter(id=>byId.has(id)&&!tombstones.has(id)).map(id=>byId.get(id))};
}
export async function onRequestPost({request,env}) {
  try {
    const {email,payload} = await request.json();
    if(typeof email !== 'string' || !email.includes('@') || !payload || Array.isArray(payload) || typeof payload !== 'object')
      return json({error:'invalid_payload'},400);
    for(const key of ['matches','deletedMatchIds','leagues','tournaments','friends'])
      if(key in payload && !Array.isArray(payload[key])) return json({error:'invalid_payload'},400);
    const key=email.trim().toLowerCase();
    const player=await env.DEUCE_KV.get('players:'+key,'json');
    if(!player) return json({error:'not_registered'},403);
    const old=await env.DEUCE_KV.get('backup:'+key,'json');
    const merged=mergeHistory(old?.payload || {},payload);
    const content=canonical(merged);
    if(new TextEncoder().encode(content).length > 2*1024*1024) return json({error:'too_large'},413);
    if(old && canonical(old.payload)===content) {
      console.log('kv_usage sync-push reads=2 writes=0 unchanged');
      return json({ok:true,skipped:true,savedAt:old.savedAt});
    }
    const now=new Date().toISOString();
    await env.DEUCE_KV.put('backup:'+key,JSON.stringify({payload:merged,updatedAt:now,savedAt:now}));
    console.log('kv_usage sync-push reads=2 writes=1 changed');
    return json({ok:true,savedAt:now});
  } catch(error) {
    console.error('sync-push failed',String(error));
    return json({error:'sync_unavailable'},503);
  }
}
