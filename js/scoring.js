function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function calculateRanking(participants, matches, predictions, settings = {}) {
  const scores = {};
  participants.forEach(p => {
    scores[p.name] = { name: p.name, photo: p.photo ?? null, points: 0 };
  });

  matches
    .filter(match => match.isFinished || match.isLive)
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

          if (match.penaltyWinner) {
            const winnerTeam = match.penaltyWinner === 'A' ? match.teamA : match.teamB;
            if (pred.predPenaltyWinner && pred.predPenaltyWinner === winnerTeam) {
              scores[pred.participant].points += 1;
            }
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
