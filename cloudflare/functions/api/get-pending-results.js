import {privateContext} from '../lib/api-security.js';
export async function onRequestPost(context) {
  context = await privateContext(context);
  const { request, env } = context;
  try {
    const { email, cursor='' } = await request.json();
    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });
    }
    const key = email.trim().toLowerCase();
    const list = await env.DEUCE_KV.related('pending-results',cursor);
    const results = [];
    const responses = [];
    for (const data of list.records) {
      if (!data) continue;
      // waiting for MY confirmation
      if (data.toEmail === key && data.status === 'pending') {
        results.push(data);
      }
      // results I sent that have been answered and I haven't processed yet
      if ((data.fromEmail || '').trim().toLowerCase() === key
          && data.status && data.status !== 'pending'
          && !data.senderSeen) {
        responses.push(data);
      }
    }
    return new Response(JSON.stringify({ results, responses, migrationPending:list.migrationPending, more:list.more, cursor:list.cursor }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
