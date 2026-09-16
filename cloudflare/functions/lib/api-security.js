import {authenticateSession, tokenHash} from './competition-auth.js';
import {createPrivateStore} from './private-data.js';
export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json','Cache-Control':'no-store',...extra}
});
export const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export async function readBody(request, limit = 65536) {
  const reader = request.clone().body?.getReader();
  if (!reader) throw new Error('invalid_json');
  const parts = []; let size = 0;
  for (;;) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { void reader.cancel(); throw new Error('request_too_large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part,offset); offset += part.length; }
  let body; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('invalid_json'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_json');
  return body;
}
// Atomic SQLite counters, not eventually-consistent KV counters.
export async function takeLimit(db, key, maximum, windowMs, now = Date.now()) {
  const row = await db.prepare(`INSERT INTO ds_auth_limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
    WHERE expires<=? OR count<? RETURNING count`).bind(await tokenHash(key),now+windowMs,now,now,now,maximum).first();
  return !!row;
}
export async function requireActor(context) {
  if (!context.env.COMPETITIONS_DB) return {response:json({ok:false,error:'setup_required'},503)};
  const session = await authenticateSession(context.request,context.env.COMPETITIONS_DB);
  return session ? {actor:session.email,epoch:session.epoch} : {response:json({ok:false,error:'verify_account'},401)};
}
// Request-local environment: never mutate Cloudflare's shared binding object.
export async function privateContext(context) {
  if(context.data?.privateEnv) return {...context,env:context.data.privateEnv};
  const session=await authenticateSession(context.request,context.env.COMPETITIONS_DB);
  if(!session) throw Object.assign(new Error('verify_account'),{status:401});
  return {...context,data:{...context.data,actor:session.email},env:{...context.env,DEUCE_KV:await createPrivateStore(context.env,session.email,session.epoch)}};
}
