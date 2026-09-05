// Retired feature: intentionally performs zero KV reads, writes or lists.
export function onRequest() {
  return new Response(JSON.stringify({ok:true,disabled:true,reason:'feature_retired'}), {
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}
