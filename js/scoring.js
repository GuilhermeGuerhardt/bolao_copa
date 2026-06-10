function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function calculateRanking(participants, matches, predictions, settings = {}) {
  const scores = {};
  participants.forEach(p => {
    scores[p.name] = { name: p.name, points: 0 };
  });

  matches
    .filter(match => match.isFinished)
    .forEach(match => {
      const realA = Number(match.realScoreA);
      const realB = Number(match.realScoreB);
      if (match.realScoreA === null || match.realScoreB === null || Number.isNaN(realA) || Number.isNaN(realB)) return;

      predictions
        .filter(pred => pred.matchId === match.id)
        .forEach(pred => {
          if (!scores[pred.participant]) return;
          const predA = Number(pred.scoreA);
          const predB = Number(pred.scoreB);
          if (pred.scoreA === null || pred.scoreB === null || Number.isNaN(predA) || Number.isNaN(predB)) return;

          if (predA === realA && predB === realB) {
            scores[pred.participant].points += 3;
          } else if (Math.sign(predA - predB) === Math.sign(realA - realB)) {
            scores[pred.participant].points += 1;
          }
        });
    });

  const { actualChampion, actualTopScorer, championBonusPoints = 0, topScorerBonusPoints = 0 } = settings;
  participants.forEach(p => {
    if (!scores[p.name]) return;
    if (actualChampion && p.championPick && p.championPick === actualChampion) {
      scores[p.name].points += Number(championBonusPoints) || 0;
    }
    if (actualTopScorer && p.topScorerPick && normalizeText(p.topScorerPick) === normalizeText(actualTopScorer)) {
      scores[p.name].points += Number(topScorerBonusPoints) || 0;
    }
  });

  return Object.values(scores).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

export function calculateRankingHistory(participants, matches, predictions, settings = {}) {
  const sortedMatches = matches
    .filter(match => match.isFinished && match.realScoreA !== null && match.realScoreB !== null)
    .slice()
    .sort((a, b) => {
      const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
      const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.id - b.id;
    });

  const cumulative = {};
  participants.forEach(p => { cumulative[p.name] = 0; });

  const steps = [{ label: 'Início', matchId: null, points: { ...cumulative } }];

  sortedMatches.forEach(match => {
    const realA = Number(match.realScoreA);
    const realB = Number(match.realScoreB);

    predictions
      .filter(pred => pred.matchId === match.id)
      .forEach(pred => {
        if (!(pred.participant in cumulative)) return;
        const predA = Number(pred.scoreA);
        const predB = Number(pred.scoreB);
        if (pred.scoreA === null || pred.scoreB === null || Number.isNaN(predA) || Number.isNaN(predB)) return;

        if (predA === realA && predB === realB) {
          cumulative[pred.participant] += 3;
        } else if (Math.sign(predA - predB) === Math.sign(realA - realB)) {
          cumulative[pred.participant] += 1;
        }
      });

    steps.push({
      label: `${match.teamA} x ${match.teamB}`,
      matchId: match.id,
      points: { ...cumulative }
    });
  });

  const { actualChampion, actualTopScorer, championBonusPoints = 0, topScorerBonusPoints = 0 } = settings;
  if (actualChampion || actualTopScorer) {
    participants.forEach(p => {
      if (!(p.name in cumulative)) return;
      if (actualChampion && p.championPick && p.championPick === actualChampion) {
        cumulative[p.name] += Number(championBonusPoints) || 0;
      }
      if (actualTopScorer && p.topScorerPick && normalizeText(p.topScorerPick) === normalizeText(actualTopScorer)) {
        cumulative[p.name] += Number(topScorerBonusPoints) || 0;
      }
    });
    steps.push({ label: 'Bônus', matchId: null, points: { ...cumulative } });
  }

  return steps;
}
