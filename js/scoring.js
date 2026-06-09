export function calculateRanking(participants, matches, predictions) {
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

  return Object.values(scores).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}
