import {tokenHash} from '../lib/competition-auth.js';
import {json, requireActor} from '../lib/api-security.js';
export async function onRequestPost(context) {
  const {response} = await requireActor(context); if (response) return response;
  const token = context.request.headers.get('Authorization').slice(7);
  await context.env.COMPETITIONS_DB.prepare('DELETE FROM ds_competition_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
  return json({ok:true});
}
