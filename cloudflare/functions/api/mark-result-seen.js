import {privateContext} from '../lib/api-security.js';
// Marks a result response as processed, so the sender's device only reacts once.
export async function onRequestPost(context) {
  context = await privateContext(context);
  const { request, env } = context;
  try {
    const { resultId } = await request.json();
    if (!resultId) {
      return new Response(JSON.stringify({ error: 'Missing resultId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    await env.DEUCE_KV.update(`pending-results:${resultId}`,data=>!data||data.senderSeen?data:{...data,senderSeen:true});
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
