import {privateContext} from '../lib/api-security.js';
export async function onRequestPost(context) {
  context = await privateContext(context);
  const { request, env } = context;
  try {
    const { resultId, email } = await request.json();
    const owner = String(email || '').trim().toLowerCase();
    if (!resultId || !owner.includes('@')) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    const key = `pending-results:${resultId}`;
    await env.DEUCE_KV.removeIf(key,result=>{
      if(String(result.fromEmail||'').trim().toLowerCase()!==owner) throw Object.assign(new Error('not_allowed'),{status:403});
      if(result.status!=='pending') throw Object.assign(new Error('result_already_resolved'),{status:409});
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.status?error.message:'service_unavailable' }), { status: error.status||503 });
  }
}
