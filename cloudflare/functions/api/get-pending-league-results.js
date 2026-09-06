// Keep existing KV records for the explicit D1 import; never mutate two sources of truth.
export function onRequest() {
  return new Response(JSON.stringify({ok:false,error:'competition_upgrade_required'}), {
    status:410, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}
