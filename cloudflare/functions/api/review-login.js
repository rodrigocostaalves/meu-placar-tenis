import {emailKey,validEmail,readBody,json,takeLimit} from '../lib/api-security.js';
import {tokenHash} from '../lib/competition-auth.js';
import {completeAccountLogin} from '../lib/login-session.js';

export async function onRequestPost({env,request}) {
  try {
    const email=emailKey(env.PLAY_REVIEW_EMAIL),expected=env.PLAY_REVIEW_ACCESS_HASH;
    if(!env.COMPETITIONS_DB || !validEmail(email) || typeof expected!=='string' || !/^[a-f0-9]{64}$/.test(expected))
      return json({ok:false,error:'review_access_unavailable'},503);
    const body=await readBody(request,2048);
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    if(!await takeLimit(env.COMPETITIONS_DB,`review-login-ip:${ip}`,30,15*60000))
      return json({ok:false,error:'rate_limited'},429,{'Retry-After':'900'});
    const attempted=emailKey(body.email),key=typeof body.accessKey==='string'?body.accessKey.trim():'';
    if(!validEmail(attempted) || !/^[a-f0-9]{64}$/.test(key)) return json({ok:false,error:'invalid_review_credentials'},401);
    // Bind the hash to the exact dedicated identity: changing the configured email
    // alone can never turn a review credential into access to another account.
    const actual=await tokenHash(`deuce-review:${attempted}\n${key}`);
    let difference=0;for(let i=0;i<64;i++) difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
    if(attempted!==email || difference!==0) return json({ok:false,error:'invalid_review_credentials'},401);
    return await completeAccountLogin(env,email,'Deuce Score Review');
  } catch(error) {
    const input=['invalid_json','request_too_large'].includes(error.message);
    return json({ok:false,error:input?error.message:'auth_unavailable'},input?400:503);
  }
}
