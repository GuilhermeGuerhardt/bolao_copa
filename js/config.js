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

export const TEAM_FLAG_CODES = {
  'México': 'mx',
  'África do Sul': 'za',
  'Coreia do Sul': 'kr',
  'Tchéquia': 'cz',
  'Canadá': 'ca',
  'Suíça': 'ch',
  'Catar': 'qa',
  'Bósnia': 'ba',
  'Brasil': 'br',
  'Marrocos': 'ma',
  'Haiti': 'ht',
  'Escócia': 'gb-sct',
  'EUA': 'us',
  'Paraguai': 'py',
  'Austrália': 'au',
  'Turquia': 'tr',
  'Alemanha': 'de',
  'Curaçao': 'cw',
  'Costa do Marfim': 'ci',
  'Equador': 'ec',
  'Holanda': 'nl',
  'Japão': 'jp',
  'Tunísia': 'tn',
  'Suécia': 'se',
  'Bélgica': 'be',
  'Egito': 'eg',
  'Irã': 'ir',
  'Nova Zelândia': 'nz',
  'Espanha': 'es',
  'Cabo Verde': 'cv',
  'Arábia Saudita': 'sa',
  'Uruguai': 'uy',
  'França': 'fr',
  'Senegal': 'sn',
  'Noruega': 'no',
  'Iraque': 'iq',
  'Argentina': 'ar',
  'Argélia': 'dz',
  'Áustria': 'at',
  'Jordânia': 'jo',
  'Portugal': 'pt',
  'Uzbequistão': 'uz',
  'Colômbia': 'co',
  'Congo DR': 'cd',
  'Inglaterra': 'gb-eng',
  'Croácia': 'hr',
  'Gana': 'gh',
  'Panamá': 'pa'
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

  const suicaCatar = allMatches.find(m => m.teamA === 'Suíça' && m.teamB === 'Catar');
  if (suicaCatar) {
    [suicaCatar.teamA, suicaCatar.teamB] = [suicaCatar.teamB, suicaCatar.teamA];
  }

  const tunisiaSuecia = allMatches.find(m => m.teamA === 'Tunísia' && m.teamB === 'Suécia');
  if (tunisiaSuecia) {
    [tunisiaSuecia.teamA, tunisiaSuecia.teamB] = [tunisiaSuecia.teamB, tunisiaSuecia.teamA];
  }

  const noruegaIraque = allMatches.find(m => m.teamA === 'Noruega' && m.teamB === 'Iraque');
  if (noruegaIraque) {
    [noruegaIraque.teamA, noruegaIraque.teamB] = [noruegaIraque.teamB, noruegaIraque.teamA];
  }

  const africaTchequia = allMatches.find(m => m.teamA === 'África do Sul' && m.teamB === 'Tchéquia');
  if (africaTchequia) {
    [africaTchequia.teamA, africaTchequia.teamB] = [africaTchequia.teamB, africaTchequia.teamA];
  }

  const marrocosEscocia = allMatches.find(m => m.teamA === 'Marrocos' && m.teamB === 'Escócia');
  if (marrocosEscocia) {
    [marrocosEscocia.teamA, marrocosEscocia.teamB] = [marrocosEscocia.teamB, marrocosEscocia.teamA];
  }

  const paraguaiTurquia = allMatches.find(m => m.teamA === 'Paraguai' && m.teamB === 'Turquia');
  if (paraguaiTurquia) {
    [paraguaiTurquia.teamA, paraguaiTurquia.teamB] = [paraguaiTurquia.teamB, paraguaiTurquia.teamA];
  }

  const curacaoEquador = allMatches.find(m => m.teamA === 'Curaçao' && m.teamB === 'Equador');
  if (curacaoEquador) {
    [curacaoEquador.teamA, curacaoEquador.teamB] = [curacaoEquador.teamB, curacaoEquador.teamA];
  }

  const japaoTunisia = allMatches.find(m => m.teamA === 'Japão' && m.teamB === 'Tunísia');
  if (japaoTunisia) {
    [japaoTunisia.teamA, japaoTunisia.teamB] = [japaoTunisia.teamB, japaoTunisia.teamA];
  }

  // Os "16 avos de Final" entram por último (IDs 89-104) para preservar os IDs
  // já existentes das demais fases. A ordem visual/lógica é resolvida em outro
  // lugar (FASE_ORDER / KNOCKOUT_PROGRESSION), não pela ordem dos IDs.
  const knockoutStages = [
    { label: 'Oitavas de Final', count: 8 },
    { label: 'Quartas de Final', count: 4 },
    { label: 'Semifinal', count: 2 },
    { label: 'Disputa de 3º Lugar', count: 1 },
    { label: 'Final', count: 1 },
    { label: '16 avos de Final', count: 16 }
  ];
  knockoutStages.forEach(stage => {
    for (let i = 0; i < stage.count; i++) {
      allMatches.push({
        id: matchId++,
        group: stage.label,
        teamA: null,
        teamB: null,
        realScoreA: null,
        realScoreB: null,
        isFinished: false,
        isLive: false
      });
    }
  });

  return allMatches;
}

// Ordem lógica das fases do mata-mata (usada na UI e no bracket). Independe dos IDs.
export const FASE_ORDER = [
  '16 avos de Final',
  'Oitavas de Final',
  'Quartas de Final',
  'Semifinal',
  'Disputa de 3º Lugar',
  'Final'
];

export const KNOCKOUT_PROGRESSION = {
  73: [{ from: 89, result: 'winner' }, { from: 90, result: 'winner' }],
  74: [{ from: 91, result: 'winner' }, { from: 92, result: 'winner' }],
  75: [{ from: 93, result: 'winner' }, { from: 94, result: 'winner' }],
  76: [{ from: 95, result: 'winner' }, { from: 96, result: 'winner' }],
  77: [{ from: 97, result: 'winner' }, { from: 98, result: 'winner' }],
  78: [{ from: 99, result: 'winner' }, { from: 100, result: 'winner' }],
  79: [{ from: 101, result: 'winner' }, { from: 102, result: 'winner' }],
  80: [{ from: 103, result: 'winner' }, { from: 104, result: 'winner' }],
  81: [{ from: 73, result: 'winner' }, { from: 74, result: 'winner' }],
  82: [{ from: 75, result: 'winner' }, { from: 76, result: 'winner' }],
  83: [{ from: 77, result: 'winner' }, { from: 78, result: 'winner' }],
  84: [{ from: 79, result: 'winner' }, { from: 80, result: 'winner' }],
  85: [{ from: 81, result: 'winner' }, { from: 82, result: 'winner' }],
  86: [{ from: 83, result: 'winner' }, { from: 84, result: 'winner' }],
  87: [{ from: 85, result: 'loser' }, { from: 86, result: 'loser' }],
  88: [{ from: 85, result: 'winner' }, { from: 86, result: 'winner' }]
};

export function getMatchWinner(match) {
  if (!match || !match.teamA || !match.teamB || !match.isFinished) return null;
  if (match.realScoreA === null || match.realScoreB === null) return null;
  if (match.realScoreA > match.realScoreB) return match.teamA;
  if (match.realScoreB > match.realScoreA) return match.teamB;
  if (match.penaltyWinner === 'A') return match.teamA;
  if (match.penaltyWinner === 'B') return match.teamB;
  return null;
}

export function getMatchLoser(match) {
  const winner = getMatchWinner(match);
  if (!winner) return null;
  return winner === match.teamA ? match.teamB : match.teamA;
}

const WEEKDAYS_PT = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export function buildMatchDates() {
  const dates = [];
  const cursor = new Date(2026, 5, 11);
  const end = new Date(2026, 6, 19);
  while (cursor <= end) {
    const dia = String(cursor.getDate()).padStart(2, '0');
    const mes = String(cursor.getMonth() + 1).padStart(2, '0');
    dates.push({ value: `2026-${mes}-${dia}`, label: `${dia}/${mes} - ${WEEKDAYS_PT[cursor.getDay()]}` });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export const MATCH_DATES = buildMatchDates();
