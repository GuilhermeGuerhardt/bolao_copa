export const STORAGE_KEY = 'bolaoData_2026_copa_v1';

export const PARTICIPANT_NAMES = [
  'Yuri', 'Waldir', 'Rodrigo', 'Lisandra', 'Thiago', 'Guilherme',
  'Edy', 'Philipe', 'Rapha Fontes', 'Ribeiro', 'Carol'
];

export const GROUPS = [
  { name: 'A', teams: ['México', 'África do Sul', 'Coreia do Sul', 'Tchéquia'] },
  { name: 'B', teams: ['Canadá', 'Suíça', 'Catar', 'Bósnia'] },
  { name: 'C', teams: ['Brasil', 'Marrocos', 'Haiti', 'Escócia'] },
  { name: 'D', teams: ['EUA', 'Paraguai', 'Austrália', 'Turquia'] },
  { name: 'E', teams: ['Alemanha', 'Curaçao', 'Costa do Marfim', 'Equador'] },
  { name: 'F', teams: ['Holanda', 'Japão', 'Tunísia', 'Suécia'] },
  { name: 'G', teams: ['Bélgica', 'Egito', 'Irã', 'Nova Zelândia'] },
  { name: 'H', teams: ['Espanha', 'Cabo Verde', 'Arábia Saudita', 'Uruguai'] },
  { name: 'I', teams: ['França', 'Senegal', 'Noruega', 'Iraque'] },
  { name: 'J', teams: ['Argentina', 'Argélia', 'Áustria', 'Jordânia'] },
  { name: 'K', teams: ['Portugal', 'Uzbequistão', 'Colômbia', 'Congo DR'] },
  { name: 'L', teams: ['Inglaterra', 'Croácia', 'Gana', 'Panamá'] }
];

const GROUP_MATCH_PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

export function createParticipants() {
  return PARTICIPANT_NAMES.map(name => ({ name }));
}

export function buildAllMatches() {
  const allMatches = [];
  let matchId = 1;

  GROUPS.forEach(group => {
    const teams = group.teams;
    GROUP_MATCH_PAIRS.forEach(([indexA, indexB]) => {
      allMatches.push({
        id: matchId++,
        group: `Grupo ${group.name}`,
        teamA: teams[indexA],
        teamB: teams[indexB],
        realScoreA: null,
        realScoreB: null,
        isFinished: false
      });
    });
  });

  return allMatches;
}
