import { emailKey, id, indexLeagueMembers, json, saveLeague } from './league-shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { name, creatorName, creatorEmail, players } = await request.json();
    const owner = emailKey(creatorEmail);
    const leagueName = String(name || '').trim().slice(0, 100);
    if (!leagueName || !owner.includes('@')) return json({ error: 'League name and creator email are required' }, 400);

    const normalized = [];
    const add = (player, isOwner = false) => {
      const playerName = String(player?.name || '').trim().slice(0, 80);
      const playerEmail = emailKey(player?.email);
      const duplicate = normalized.some(existing =>
        (playerEmail && existing.email === playerEmail) || existing.name.toLowerCase() === playerName.toLowerCase()
      );
      if (!playerName || duplicate || normalized.length >= 100) return;
      normalized.push({ id: id('league_player'), name: playerName, email: playerEmail, points: 0, isOwner });
    };
    add({ name: creatorName || 'Criador da liga', email: owner }, true);
    (Array.isArray(players) ? players : []).forEach(player => add(player));
    if (normalized.length < 2) return json({ error: 'At least two players are required' }, 400);

    const league = {
      id: id('league'), name: leagueName, createdBy: owner,
      createdByName: String(creatorName || normalized[0].name).trim().slice(0, 80),
      createdAt: new Date().toISOString(), shared: true, players: normalized, matchLog: []
    };
    await saveLeague(env, league);
    await indexLeagueMembers(env, league);
    return json({ ok: true, league });
  } catch (error) {
    return json({ error: String(error) }, 500);
  }
}
