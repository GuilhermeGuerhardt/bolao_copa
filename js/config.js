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

export const ALL_TEAMS = GROUPS.flatMap(group => group.teams).sort((a, b) => a.localeCompare(b, 'pt-BR'));

export const TEAM_FLAGS = {
  'México': '🇲🇽',
  'África do Sul': '🇿🇦',
  'Coreia do Sul': '🇰🇷',
  'Tchéquia': '🇨🇿',
  'Canadá': '🇨🇦',
  'Suíça': '🇨🇭',
  'Catar': '🇶🇦',
  'Bósnia': '🇧🇦',
  'Brasil': '🇧🇷',
  'Marrocos': '🇲🇦',
  'Haiti': '🇭🇹',
  'Escócia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'EUA': '🇺🇸',
  'Paraguai': '🇵🇾',
  'Austrália': '🇦🇺',
  'Turquia': '🇹🇷',
  'Alemanha': '🇩🇪',
  'Curaçao': '🇨🇼',
  'Costa do Marfim': '🇨🇮',
  'Equador': '🇪🇨',
  'Holanda': '🇳🇱',
  'Japão': '🇯🇵',
  'Tunísia': '🇹🇳',
  'Suécia': '🇸🇪',
  'Bélgica': '🇧🇪',
  'Egito': '🇪🇬',
  'Irã': '🇮🇷',
  'Nova Zelândia': '🇳🇿',
  'Espanha': '🇪🇸',
  'Cabo Verde': '🇨🇻',
  'Arábia Saudita': '🇸🇦',
  'Uruguai': '🇺🇾',
  'França': '🇫🇷',
  'Senegal': '🇸🇳',
  'Noruega': '🇳🇴',
  'Iraque': '🇮🇶',
  'Argentina': '🇦🇷',
  'Argélia': '🇩🇿',
  'Áustria': '🇦🇹',
  'Jordânia': '🇯🇴',
  'Portugal': '🇵🇹',
  'Uzbequistão': '🇺🇿',
  'Colômbia': '🇨🇴',
  'Congo DR': '🇨🇩',
  'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Croácia': '🇭🇷',
  'Gana': '🇬🇭',
  'Panamá': '🇵🇦'
};

const GROUP_MATCH_PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];

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
        isFinished: false,
        isLive: false
      });
    });
  });

  return allMatches;
}

const WEEKDAYS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export function buildMatchDates() {
  const dates = [];
  for (let day = 11; day <= 27; day++) {
    const date = new Date(2026, 5, day);
    const dia = String(day).padStart(2, '0');
    dates.push({ value: `2026-06-${dia}`, label: `${dia}/06 - ${WEEKDAYS_PT[date.getDay()]}` });
  }
  return dates;
}

export const MATCH_DATES = buildMatchDates();
