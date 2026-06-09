import {
  STORAGE_KEY,
  createParticipants,
  buildAllMatches
} from './config.js';

export function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

export function normalizeState(raw) {
  const initialParticipants = createParticipants();
  const allMatches = buildAllMatches();

  const participants = Array.isArray(raw?.participants) && raw.participants.length
    ? raw.participants.map(p => ({ name: String(p?.name ?? '').trim() })).filter(p => p.name)
    : initialParticipants;

  const matchMap = new Map(allMatches.map(match => [match.id, match]));
  const matches = Array.isArray(raw?.matches)
    ? raw.matches.filter(match => matchMap.has(match.id)).map(match => {
        const base = matchMap.get(match.id);
        return {
          id: base.id,
          group: base.group,
          teamA: base.teamA,
          teamB: base.teamB,
          realScoreA: toNullableNumber(match.realScoreA),
          realScoreB: toNullableNumber(match.realScoreB),
          isFinished: Boolean(match.isFinished)
        };
      })
    : [];

  const validParticipantNames = new Set(participants.map(p => p.name));
  const validMatchIds = new Set(matches.map(m => m.id));
  const predictions = Array.isArray(raw?.predictions)
    ? raw.predictions
        .filter(p => validMatchIds.has(p.matchId) && validParticipantNames.has(p.participant))
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

  return {
    storageKey: STORAGE_KEY,
    isAdmin: Boolean(raw?.isAdmin),
    participants,
    allMatches,
    matches,
    predictions,
    selectedMatchId
  };
}

export function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Erro ao ler localStorage:', error);
    return null;
  }
}

export function createInitialState() {
  const saved = loadSavedState();
  if (saved) return normalizeState(saved);

  return {
    storageKey: STORAGE_KEY,
    isAdmin: false,
    participants: createParticipants(),
    allMatches: buildAllMatches(),
    matches: [],
    predictions: [],
    selectedMatchId: null
  };
}
