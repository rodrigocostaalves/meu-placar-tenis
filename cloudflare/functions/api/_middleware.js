import {emailKey, json, readBody, requireActor, takeLimit} from '../lib/api-security.js';
const publicRoutes = new Set(['send-verification','verify-email']);
const accountFields = {
  'sync-pull':'email','sync-push':'email','save-player':'email','register-fcm-token':'email',
  'get-pending-results':'email','get-sent-results':'email','delete-pending-result':'email',
  'send-result':'fromEmail','send-league-invite':'fromEmail','delete-account':'email'
};
const activeRoutes = new Set([...Object.keys(accountFields),'competitions','respond-result','mark-result-seen','logout']);
export async function onRequest(context) {
  try {
    const route = new URL(context.request.url).pathname.replace(/\/$/,'').split('/').pop();
    if (!publicRoutes.has(route) && !activeRoutes.has(route)) return json({ok:false,error:'endpoint_retired'},410);
    if (context.request.method !== 'POST') return json({ok:false,error:'method_not_allowed'},405,{Allow:'POST'});
    if (publicRoutes.has(route)) return await context.next();
    const {actor,response} = await requireActor(context); if (response) return response;
    const body = await readBody(context.request,route === 'sync-push' ? 2200000 : 65536);
    const field = accountFields[route];
    if (field && emailKey(body[field]) !== actor) return json({ok:false,error:'account_mismatch'},403);
    if (field) body[field] = actor;
    if (route === 'respond-result' || route === 'mark-result-seen') {
      if (typeof body.resultId !== 'string' || body.resultId.length > 150) return json({ok:false,error:'invalid_result'},400);
      const result = await context.env.DEUCE_KV.get(`pending-results:${body.resultId}`,'json');
      const owner = route === 'respond-result' ? result?.toEmail : result?.fromEmail;
      if (!result || emailKey(owner) !== actor) return json({ok:false,error:'not_found'},404);
      if (route === 'respond-result' && !['accepted','rejected'].includes(body.response)) return json({ok:false,error:'invalid_response'},400);
      if (route === 'respond-result' && result.status !== 'pending')
        return result.status === body.response ? json({ok:true,skipped:true}) : json({ok:false,error:'result_already_resolved'},409);
    }
    if (['send-result','send-league-invite'].includes(route)) {
      if (!await takeLimit(context.env.COMPETITIONS_DB,`notice:${actor}`,30,3600000))
        return json({ok:false,error:'rate_limited'},429,{'Retry-After':'3600'});
    }
    context.data.actor = actor;
    const downstream = await context.next(new Request(context.request,{body:JSON.stringify(body)}));
    const secured = new Response(downstream.body,downstream);
    secured.headers.set('Cache-Control','no-store');
    return secured;
  } catch (error) {
    const known = ['invalid_json','request_too_large'].includes(error.message);
    return json({ok:false,error:known ? error.message : 'service_unavailable'},known ? (error.message === 'request_too_large' ? 413 : 400) : 503);
  }
}
