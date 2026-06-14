import { buildAllMatches } from './config.js';

export function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

export function normalizeState(raw) {
  const allMatches = buildAllMatches();
  const matchMap = new Map(allMatches.map(match => [match.id, match]));

  const matches = Array.isArray(raw?.matches)
    ? raw.matches.filter(match => matchMap.has(match.id)).map(match => {
        const base = matchMap.get(match.id);
        const isKnockoutSlot = base.teamA === null && base.teamB === null;
        return {
          id: base.id,
          group: base.group,
          teamA: isKnockoutSlot ? (match.teamA ?? null) : base.teamA,
          teamB: isKnockoutSlot ? (match.teamB ?? null) : base.teamB,
          realScoreA: toNullableNumber(match.realScoreA),
          realScoreB: toNullableNumber(match.realScoreB),
          isFinished: Boolean(match.isFinished),
          isLive: Boolean(match.isLive),
          finishedAt: match.finishedAt ?? null,
          matchDate: match.matchDate ?? null,
          matchTime: match.matchTime ?? null,
          penaltyWinner: match.penaltyWinner ?? null
        };
      })
    : [];

  const validMatchIds = new Set(matches.map(m => m.id));
  const predictions = Array.isArray(raw?.predictions)
    ? raw.predictions
        .filter(p => validMatchIds.has(p.matchId))
        .map(p => ({
          matchId: Number(p.matchId),
          participant: String(p.participant),
          scoreA: toNullableNumber(p.scoreA),
          scoreB: toNullableNumber(p.scoreB)
        }))
    : [];

  let selectedMatchId = raw?.selectedMatchId ?? null;
  if (!matches.some(m => m.id === selectedMatchId)) {
    selectedMatchId = matches.length ? matches[0].id : null;
  }

  const participants = Array.isArray(raw?.participants)
    ? raw.participants
        .map(p => ({
          name: String(p?.name ?? '').trim(),
          photo: p?.photo ?? null,
          championPick: p?.championPick ?? null,
          topScorerPick: p?.topScorerPick ?? null
        }))
        .filter(p => p.name)
    : [];

  const settings = {
    actualChampion: raw?.settings?.actualChampion ?? null,
    actualTopScorer: raw?.settings?.actualTopScorer ?? null,
    championBonusPoints: Number(raw?.settings?.championBonusPoints ?? 0),
    topScorerBonusPoints: Number(raw?.settings?.topScorerBonusPoints ?? 0),
    qualifiedTeams: Array.isArray(raw?.settings?.qualifiedTeams) ? raw.settings.qualifiedTeams : []
  };

  return {
    allMatches,
    matches,
    predictions,
    selectedMatchId,
    participants,
    settings
  };
}
