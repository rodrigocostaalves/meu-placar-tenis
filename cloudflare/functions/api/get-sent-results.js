import {privateContext} from '../lib/api-security.js';
export async function onRequestPost(context) {
  context = await privateContext(context);
  const { request, env } = context;
  try {
    const { email, cursor='' } = await request.json();
    const key = String(email || '').trim().toLowerCase();
    if (!key.includes('@')) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400 });

    const results = [];
    const page = await env.DEUCE_KV.related('pending-results',cursor);
      for (const result of page.records) {
        if (result && String(result.fromEmail || '').trim().toLowerCase() === key) {
          // The Android client uses email and date as a safe fallback if it
          // was closed between submitting the score and saving resultId.
          results.push({
            id: result.id,
            matchId: result.matchId || '',
            status: result.status || 'pending',
            toEmail: result.toEmail || '',
            toName: result.toName || '',
            date: result.date || '',
            result: result.result || '',
            sets: Array.isArray(result.sets) ? result.sets : [],
            matchType: result.matchType || 'amistoso',
            surface: result.surface || 'rapida',
            respondedAt: result.respondedAt || ''
          });
        }
      }

    return new Response(JSON.stringify({ ok: true, results, migrationPending:page.migrationPending, more:page.more, cursor:page.cursor }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
}
