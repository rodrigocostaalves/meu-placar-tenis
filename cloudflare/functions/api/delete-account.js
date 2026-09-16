import {json,readBody,validEmail,emailKey} from '../lib/api-security.js';
import {deletionJob} from '../lib/account-deletion.js';
export async function onRequestPost(context) {
  try {
    const input=await readBody(context.request,4096);
    if(!validEmail(emailKey(input.email))) return json({ok:false,error:'invalid_email'},400);
    return json(await deletionJob(context.request,context.env,input));
  } catch(error) {
    return json({ok:false,error:error.status?error.message:'deletion_unavailable'},error.status||503);
  }
}
