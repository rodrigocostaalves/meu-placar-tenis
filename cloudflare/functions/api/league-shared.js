import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sendFcmNotification } from './fcm.js';

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' }
});

export const emailKey = value => String(value || '').trim().toLowerCase();
export const id = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;

export function pointsForRank(rank) {
  if (rank <= 10) return 50 - (rank - 1);
  for (const [max, points] of [[20, 35], [30, 28], [40, 22], [50, 17], [60, 13], [70, 10], [80, 7], [90, 5], [100, 3]]) {
    if (rank <= max) return points;
  }
  return 3;
}

export const ranking = league => [...league.players].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

export async function readLeague(env, leagueId) {
  return env.DEUCE_KV.get(`shared-leagues:${leagueId}`, 'json');
}

export async function saveLeague(env, league) {
  await env.DEUCE_KV.put(`shared-leagues:${league.id}`, JSON.stringify(league));
}

async function putLeagueInIndex(env, email, leagueId) {
  const key = emailKey(email);
  if (!key.includes('@')) return;
  const index = await env.DEUCE_KV.get(`shared-league-index:${key}`, 'json') || [];
  if (!index.includes(leagueId)) {
    index.push(leagueId);
    await env.DEUCE_KV.put(`shared-league-index:${key}`, JSON.stringify(index));
  }
}

export async function indexLeagueMembers(env, league) {
  await Promise.all(league.players.map(player => putLeagueInIndex(env, player.email, league.id)));
}

export function memberByEmail(league, email) {
  const key = emailKey(email);
  return league.players.find(player => emailKey(player.email) === key);
}

export function creatorIs(league, email) {
  return emailKey(league.createdBy) === emailKey(email);
}

export async function registeredPlayer(env, email) {
  const key = emailKey(email);
  return key.includes('@') ? env.DEUCE_KV.get(`players:${key}`, 'json') : null;
}

async function webPush(player, env, title, body) {
  if (!player?.subscription || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  try {
    const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
    const payload = await buildPushPayload({ data: JSON.stringify({ title, body }) }, player.subscription, vapid);
    return (await fetch(player.subscription.endpoint, payload)).ok;
  } catch (error) {
    console.error('Shared league web push error:', error);
    return false;
  }
}

export async function notify(env, email, title, body) {
  const player = await registeredPlayer(env, email);
  if (!player) return false;
  const [web, android] = await Promise.all([
    webPush(player, env, title, body),
    sendFcmNotification(env, player.fcmToken, title, body)
  ]);
  return web || android;
}

/** Applies a result only after acceptance, or for the creator's offline-player exception. */
export function applyLeagueResult(league, result) {
  const ordered = ranking(league);
  const winner = league.players.find(player => player.id === result.winnerId);
  const loser = league.players.find(player => player.id === result.loserId);
  if (!winner || !loser || winner.id === loser.id) throw new Error('Invalid league players');
  const points = pointsForRank(ordered.findIndex(player => player.id === loser.id) + 1);
  winner.points = (winner.points || 0) + points;
  const accepted = {
    id: result.id || id('league_match'), date: result.date || new Date().toISOString().slice(0, 10),
    winnerId: winner.id, loserId: loser.id, winnerName: winner.name, loserName: loser.name,
    points, sets: Array.isArray(result.sets) ? result.sets : [], reporterEmail: emailKey(result.reporterEmail),
    status: 'accepted', acceptedAt: new Date().toISOString()
  };
  league.matchLog = Array.isArray(league.matchLog) ? league.matchLog : [];
  league.matchLog.push(accepted);
  return accepted;
}
