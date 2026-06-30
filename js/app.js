import { createApp } from 'vue';
import { normalizeState } from './storage.js';
import { calculateRanking } from './scoring.js';
import { exportarBackup as downloadBackup, resizeImageToBase64, downloadCSV, parseCSV } from './utils.js';
import { buildAllMatches, ALL_TEAMS, MATCH_DATES, TEAM_FLAGS, TEAM_FLAG_CODES, KNOCKOUT_PROGRESSION, FASE_ORDER, getMatchWinner, getMatchLoser } from './config.js';

const API = '/api';
const TOKEN_KEY = 'bolao_token';

createApp({
  data() {
    return {
      token: localStorage.getItem(TOKEN_KEY) || null,
      user: null,

      view: 'tabela',
      showAdminLogin: false,
      authError: '',
      showPassword: { login: false, current: false, new: false, confirm: false },
      authLoading: false,
      loginForm: { displayName: '', password: '' },

      participants: [],
      allMatches: buildAllMatches(),
      matches: [],
      predictions: [],
      selectedMatchId: null,
      settings: { actualChampion: null, actualTopScorer: null, championBonusPoints: 0, topScorerBonusPoints: 0, qualifiedTeams: [] },
      novoTimeClassificado: '',

      pollTimer: null,
      eventSource: null,
      saveTimer: null,
      saveQueue: Promise.resolve(),
      savesInFlight: 0,
      editingPalpiteCount: 0,

      carouselIndex: 0,
      carouselTimer: null,
      bracketScale: 1,

      ALL_TEAMS,
      MATCH_DATES,

      profileForm: { firstName: '', lastName: '', photo: null, currentPassword: '', newPassword: '', confirmNewPassword: '' },
      profileError: '',
      profileMessage: '',
      profileSaving: false,

      adminParticipants: [],
      participantForm: { id: null, name: '', photo: null, whatsapp: '', championPick: null, topScorerPick: '' },
      participantFormError: '',
      participantFormSaving: false,
      participantDeleteConfirm: null,

      specialSettingsMessage: '',

      palpitesCsvMessage: '',
      palpitesCsvError: '',
      backupRestoreMessage: '',
      backupRestoreError: '',

      rankingShowMovimento: false,
      rankingMoveTimer: null
    };
  },

  computed: {
    activeMatch() {
      return this.matches.find(m => m.id === this.selectedMatchId) || null;
    },

    activeMatchPredictions() {
      if (!this.selectedMatchId) return [];
      return this.participants.map(participant => {
        const found = this.predictions.find(
          pred => pred.matchId === this.selectedMatchId && pred.participant === participant.name
        );
        return found || {
          matchId: this.selectedMatchId,
          participant: participant.name,
          scoreA: null,
          scoreB: null,
          predPenaltyWinner: null
        };
      });
    },

    totalFinishedMatches() {
      return this.matches.filter(m => m.isFinished).length;
    },

    rodadaDestaque() {
      const match = this.activeMatch;
      if (!match || !match.isFinished) return null;

      const realA = Number(match.realScoreA);
      const realB = Number(match.realScoreB);
      if (match.realScoreA === null || match.realScoreB === null || Number.isNaN(realA) || Number.isNaN(realB)) return null;

      const campeoes = [];
      const bagres = [];

      this.activeMatchPredictions.forEach(pred => {
        const predA = Number(pred.scoreA);
        const predB = Number(pred.scoreB);
        if (pred.scoreA === null || pred.scoreB === null || Number.isNaN(predA) || Number.isNaN(predB)) return;

        if (predA === realA && predB === realB) {
          campeoes.push(pred.participant);
        } else if (Math.sign(predA - predB) !== Math.sign(realA - realB)) {
          bagres.push(pred.participant);
        }
      });

      return { campeoes, bagres };
    },

    ranking() {
      return calculateRanking(this.participants, this.matches, this.predictions, this.settings);
    },

    rankingTemMovimento() {
      return this.matches.some(m =>
        (m.isFinished || m.isLive) && m.realScoreA !== null && m.realScoreB !== null
      );
    },

    rankingMovimentos() {
      const temPlacar = (m) =>
        m.realScoreA !== null && m.realScoreB !== null &&
        !Number.isNaN(Number(m.realScoreA)) && !Number.isNaN(Number(m.realScoreB));

      // A "rodada" é a partida em andamento (ao vivo com placar). Se não houver
      // nenhuma ao vivo, usa a última partida finalizada como referência.
      const aoVivo = this.matches.filter(m => m.isLive && temPlacar(m));
      let rodada;
      if (aoVivo.length) {
        rodada = aoVivo;
      } else {
        const finalizadas = this.matches.filter(m => m.isFinished && m.finishedAt && temPlacar(m));
        if (!finalizadas.length) return this.ranking.map(() => ({ pontos: 0, tipo: 'same' }));
        rodada = [finalizadas.reduce((a, b) => new Date(a.finishedAt) > new Date(b.finishedAt) ? a : b)];
      }

      const rodadaIds = new Set(rodada.map(m => m.id));

      const pontosRodada = {};
      this.participants.forEach(p => { pontosRodada[p.name] = 0; });

      rodada.forEach(match => {
        const realA = Number(match.realScoreA);
        const realB = Number(match.realScoreB);
        this.predictions
          .filter(pred => pred.matchId === match.id)
          .forEach(pred => {
            if (!Object.prototype.hasOwnProperty.call(pontosRodada, pred.participant)) return;
            const predA = Number(pred.scoreA);
            const predB = Number(pred.scoreB);
            if (pred.scoreA === null || pred.scoreB === null || Number.isNaN(predA) || Number.isNaN(predB)) return;
            if (predA === realA && predB === realB) {
              pontosRodada[pred.participant] += 3;
            } else if (Math.sign(predA - predB) === Math.sign(realA - realB)) {
              pontosRodada[pred.participant] += 1;
            }
          });
      });

      const rankingAnterior = calculateRanking(
        this.participants,
        this.matches.filter(m => !rodadaIds.has(m.id)),
        this.predictions,
        this.settings
      );
      const posAnterior = {};
      rankingAnterior.forEach((r, i) => { posAnterior[r.name] = i + 1; });

      return this.ranking.map((r, i) => {
        const posAtual = i + 1;
        const oldPos = posAnterior[r.name] ?? posAtual;
        const pontos = pontosRodada[r.name] ?? 0;
        if (oldPos > posAtual) return { pontos, tipo: 'up' };
        if (oldPos < posAtual) return { pontos, tipo: 'down' };
        return { pontos, tipo: 'same' };
      });
    },

    podium() {
      return this.ranking.slice(0, 3);
    },

    bagre() {
      const total = this.ranking.length;
      if (total === 0) return [];
      const lastPlaces = this.ranking.slice(-3);
      return lastPlaces.map((item, idx) => ({ ...item, position: total - lastPlaces.length + idx + 1 }));
    },

    proximosJogos() {
      return this.matches
        .filter(m => !m.isFinished && m.matchDate && m.matchTime)
        .slice()
        .sort((a, b) => new Date(`${a.matchDate}T${a.matchTime}`) - new Date(`${b.matchDate}T${b.matchTime}`));
    },

    jogoCarouselAtual() {
      if (!this.proximosJogos.length) return null;
      return this.proximosJogos[this.carouselIndex % this.proximosJogos.length];
    },

    faseGruposCompleta() {
      const grupos = this.allMatches.filter(m => m.group.startsWith('Grupo'));
      return grupos.length > 0 && grupos.every(g => {
        const m = this.matches.find(x => x.id === g.id);
        return m && m.isFinished;
      });
    },

    timesDisponiveisClassificados() {
      return this.ALL_TEAMS.filter(t => !this.settings.qualifiedTeams.includes(t));
    },

    chaveamentoPorFase() {
      const porGrupo = {};
      this.allMatches
        .filter(m => m.teamA === null && m.teamB === null)
        .forEach(catalogMatch => {
          const m = this.matches.find(x => x.id === catalogMatch.id) || {
            id: catalogMatch.id, group: catalogMatch.group, teamA: null, teamB: null,
            realScoreA: null, realScoreB: null, isFinished: false, isLive: false, penaltyWinner: null
          };
          (porGrupo[catalogMatch.group] ??= []).push(m);
        });

      // Reordena as fases na sequência lógica (16 avos → final), já que os IDs
      // dos 16 avos foram adicionados por último no catálogo.
      const fases = {};
      FASE_ORDER.forEach(fase => {
        if (porGrupo[fase]) fases[fase] = porGrupo[fase];
      });
      return fases;
    },

    bracketSides() {
      const dezesseis = this.chaveamentoPorFase['16 avos de Final'] || [];
      const oitavas = this.chaveamentoPorFase['Oitavas de Final'];
      const quartas = this.chaveamentoPorFase['Quartas de Final'];
      const semi = this.chaveamentoPorFase['Semifinal'];
      return {
        left: {
          dezesseis: [[dezesseis[0], dezesseis[1]], [dezesseis[2], dezesseis[3]], [dezesseis[4], dezesseis[5]], [dezesseis[6], dezesseis[7]]],
          oitavas: [[oitavas[0], oitavas[1]], [oitavas[2], oitavas[3]]],
          quartas: [[quartas[0], quartas[1]]],
          semi: semi[0]
        },
        right: {
          dezesseis: [[dezesseis[8], dezesseis[9]], [dezesseis[10], dezesseis[11]], [dezesseis[12], dezesseis[13]], [dezesseis[14], dezesseis[15]]],
          oitavas: [[oitavas[4], oitavas[5]], [oitavas[6], oitavas[7]]],
          quartas: [[quartas[2], quartas[3]]],
          semi: semi[1]
        },
        final: this.chaveamentoPorFase['Final'][0],
        third: this.chaveamentoPorFase['Disputa de 3º Lugar'][0]
      };
    },

    bracketHostStyle() {
      return {
        width: `${1600 * this.bracketScale}px`,
        height: `${640 * this.bracketScale}px`
      };
    },

    bracketTreeStyle() {
      return { transform: `scale(${this.bracketScale})` };
    },

    // Tabela do mata-mata em colunas (16 avos → final), no estilo linear.
    tabelaFases() {
      // Fases que convergem para a fase seguinte (desenham as linhas da chave).
      const ligam = ['16 avos de Final', 'Oitavas de Final', 'Quartas de Final', 'Semifinal'];
      const colunasEspeciais = ['Final', 'Disputa de 3º Lugar'];
      return FASE_ORDER
        .filter(fase => this.chaveamentoPorFase[fase] && !colunasEspeciais.includes(fase))
        .map(fase => ({ fase, jogos: this.chaveamentoPorFase[fase], liga: ligam.includes(fase) }));
    },

    // Altura comum a todas as colunas para o alinhamento de árvore (a fase com
    // mais jogos — os 16 avos — define a altura; as demais distribuem o espaço).
    tabelaAlturaStyle() {
      const max = Math.max(0, ...this.tabelaFases.map(f => f.jogos.length));
      return max ? { height: `${max * 96}px` } : {};
    }
  },

  methods: {
    authHeaders() {
      return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    },

    async fazerLogin() {
      this.authError = '';
      this.authLoading = true;
      try {
        const res = await fetch(`${API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.loginForm)
        });
        const data = await res.json();
        if (!res.ok) {
          this.authError = data.erro || 'Erro ao entrar.';
          return;
        }
        await this.aplicarSessao(data);
      } catch {
        this.authError = 'Erro ao conectar com o servidor.';
      } finally {
        this.authLoading = false;
      }
    },

    async aplicarSessao(data) {
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem(TOKEN_KEY, this.token);
      this.showAdminLogin = false;
      await this.carregarEstado();
    },

    async carregarSessao() {
      try {
        const res = await fetch(`${API}/auth/me`, { headers: this.authHeaders() });
        if (!res.ok) {
          this.logout();
          return;
        }
        const data = await res.json();
        this.user = data.user;
      } catch {
        this.logout();
      }
    },

    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem(TOKEN_KEY);
      this.view = 'tabela';
      this.showAdminLogin = false;
    },

    async carregarEstado() {
      try {
        const res = await fetch(`${API}/state`, { headers: this.authHeaders() });
        if (!res.ok) return;

        const raw = await res.json();
        const normalized = normalizeState(raw);

        // Enquanto houver edições do admin em andamento (placar real com save
        // pendente, ou campo de palpite focado), não sobrescreve o estado local:
        // qualquer reatribuição força o Vue a re-renderizar e reescrever o
        // value dos inputs, apagando o que está sendo digitado.
        if (this.saveTimer !== null || this.savesInFlight > 0 || this.editingPalpiteCount > 0) {
          return;
        }

        this.predictions = normalized.predictions;
        this.participants = normalized.participants;
        this.settings = normalized.settings;
        this.matches = normalized.matches;
        this.selectedMatchId = normalized.selectedMatchId;

        if (this.matches.length && (this.selectedMatchId === null || !this.matches.some(m => m.id === this.selectedMatchId))) {
          this.selectedMatchId = this.matches[0].id;
        }
      } catch {
        // mantém o estado atual em caso de falha de rede
      }
    },

    iniciarPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        this.carregarEstado();
      }, 20000);
    },

    iniciarEventos() {
      if (this.eventSource) this.eventSource.close();
      this.eventSource = new EventSource(`${API}/events`);
      this.eventSource.onmessage = () => {
        this.carregarEstado();
      };
    },

    iniciarRankingCiclo() {
      const mostrarMovimento = () => {
        this.rankingShowMovimento = true;
        this.rankingMoveTimer = setTimeout(() => {
          this.rankingShowMovimento = false;
          this.rankingMoveTimer = setTimeout(mostrarMovimento, 3500);
        }, 2000);
      };
      this.rankingMoveTimer = setTimeout(mostrarMovimento, 3500);
    },

    iniciarCarrossel() {
      if (this.carouselTimer) clearInterval(this.carouselTimer);
      this.carouselTimer = setInterval(() => {
        if (this.proximosJogos.length > 1) {
          this.carouselIndex = (this.carouselIndex + 1) % this.proximosJogos.length;
        }
      }, 5000);
    },

    carrosselAnterior() {
      if (!this.proximosJogos.length) return;
      this.carouselIndex = (this.carouselIndex - 1 + this.proximosJogos.length) % this.proximosJogos.length;
    },

    carrosselProximo() {
      if (!this.proximosJogos.length) return;
      this.carouselIndex = (this.carouselIndex + 1) % this.proximosJogos.length;
    },

    saveAdminState() {
      this.propagarChaveamento();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.flushAdminState();
      }, 400);
    },

    flushAdminState() {
      const payload = JSON.stringify({ selectedMatchId: this.selectedMatchId, matches: this.matches });
      this.savesInFlight++;
      this.saveQueue = this.saveQueue
        .then(() => fetch(`${API}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: payload
        }))
        .catch(() => {
          // ignora falha pontual de rede
        })
        .finally(() => {
          this.savesInFlight--;
        });
    },

    selectMatch(match) {
      if (!this.matches.find(m => m.id === match.id)) {
        this.matches.push({
          id: match.id,
          group: match.group,
          teamA: match.teamA,
          teamB: match.teamB,
          realScoreA: null,
          realScoreB: null,
          isFinished: false,
          isLive: false
        });
      }
      this.selectedMatchId = match.id;
      this.saveAdminState();
    },

    setMatchStatus(match, status) {
      match.isLive = status === 'live';
      match.isFinished = status === 'finished';
      this.saveAdminState();
    },

    matchStatusInfo(match) {
      if (match && match.isFinished) return { class: 'status-finished', label: 'Finalizado' };
      if (match && match.isLive) return { class: 'status-live', label: '🔴 Ao vivo' };
      return { class: 'status-open', label: 'Aberto para palpites' };
    },

    exibirPlacar(value) {
      return value === null || value === '' || Number.isNaN(Number(value)) ? '-' : value;
    },

    bandeira(team) {
      return TEAM_FLAGS[team] || '';
    },

    bandeiraCode(team) {
      return TEAM_FLAG_CODES[team] || '';
    },

    nomeTime(team) {
      return team ? `${this.bandeira(team)} ${team}`.trim() : 'A definir';
    },

    bracketRowClass(match, side) {
      if (!match || !match[side]) return 'tbd';
      if (match.isFinished) return getMatchWinner(match) === match[side] ? 'win' : 'lose';
      return '';
    },

    // Texto de um lado de um jogo do mata-mata: o time, ou o placeholder
    // "Vencedor/Perdedor Jogo X" quando ainda depende de uma fase anterior.
    textoSlot(match, side) {
      if (match[side]) return { team: match[side] };
      const prog = KNOCKOUT_PROGRESSION[match.id];
      if (prog) {
        const src = prog[side === 'teamA' ? 0 : 1];
        const verbo = src.result === 'loser' ? 'Perdedor' : 'Vencedor';
        return { placeholder: `${verbo} Jogo ${src.from}` };
      }
      return { placeholder: 'A definir' };
    },

    dataHoraJogo(match) {
      if (!match || !match.matchDate) return '';
      const [ano, mes, dia] = match.matchDate.split('-').map(Number);
      const data = new Date(ano, mes - 1, dia);
      const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
      let texto = `${dias[data.getDay()]}, ${dia}° ${meses[mes - 1]}`;
      if (match.matchTime) texto += ` - ${match.matchTime}`;
      return texto;
    },

    atualizarBracketScale() {
      const wrap = this.$refs.bracketWrap;
      if (!wrap) return;
      const disponivel = wrap.clientWidth - 28;
      this.bracketScale = Math.min(1, disponivel / 1600);
    },

    adicionarTimeClassificado() {
      if (!this.novoTimeClassificado) return;
      if (!this.settings.qualifiedTeams.includes(this.novoTimeClassificado)) {
        this.settings.qualifiedTeams.push(this.novoTimeClassificado);
        this.salvarTimesClassificados();
      }
      this.novoTimeClassificado = '';
    },

    removerTimeClassificado(team) {
      this.settings.qualifiedTeams = this.settings.qualifiedTeams.filter(t => t !== team);
      this.salvarTimesClassificados();
    },

    async salvarTimesClassificados() {
      try {
        await fetch(`${API}/settings/special`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify(this.settings)
        });
      } catch {
        // ignora falha pontual de rede
      }
    },

    prepararMataMata() {
      let changed = false;
      this.allMatches.filter(m => m.teamA === null && m.teamB === null).forEach(catalogMatch => {
        if (!this.matches.find(m => m.id === catalogMatch.id)) {
          this.matches.push({
            id: catalogMatch.id, group: catalogMatch.group, teamA: null, teamB: null,
            realScoreA: null, realScoreB: null, isFinished: false, isLive: false,
            finishedAt: null, matchDate: null, matchTime: null, penaltyWinner: null
          });
          changed = true;
        }
      });
      if (changed) this.saveAdminState();
    },

    definirTimeChave(match, slot, team) {
      match[slot] = team || null;
      this.saveAdminState();
    },

    definirVencedorPenaltis(match, team) {
      match.penaltyWinner = team;
      this.saveAdminState();
    },

    propagarChaveamento() {
      for (const [targetId, sources] of Object.entries(KNOCKOUT_PROGRESSION)) {
        const target = this.matches.find(m => m.id === Number(targetId));
        if (!target) continue;
        sources.forEach((src, idx) => {
          const source = this.matches.find(m => m.id === src.from);
          const team = source ? (src.result === 'winner' ? getMatchWinner(source) : getMatchLoser(source)) : null;
          target[idx === 0 ? 'teamA' : 'teamB'] = team;
        });
      }
    },

    formatarData(value) {
      if (!value) return '';
      const [ano, mes, dia] = value.split('-');
      return `${dia}/${mes}/${ano}`;
    },

    formatarDataHora(match) {
      const partes = [];
      if (match.matchDate) partes.push(this.formatarData(match.matchDate));
      if (match.matchTime) partes.push(match.matchTime);
      return partes.join(' · ');
    },

    atualizarPlacarReal(match, field, value) {
      if (value === '') {
        match[field] = null;
        return;
      }
      let num = Math.trunc(Number(value));
      if (Number.isNaN(num)) return;
      match[field] = Math.min(20, Math.max(0, num));
    },

    async limparSomentePlacar() {
      try {
        await fetch(`${API}/state/limpar`, { method: 'POST', headers: this.authHeaders() });
      } catch {
        // ignora falha pontual de rede
      }
      await this.carregarEstado();
    },

    exportarBackup() {
      downloadBackup({
        participants: this.participants,
        matches: this.matches,
        predictions: this.predictions,
        settings: this.settings,
        selectedMatchId: this.selectedMatchId
      });
    },

    exportarResultadosCSV() {
      const finalizados = this.matches
        .filter(m => m.isFinished && m.realScoreA !== null && m.realScoreB !== null)
        .sort((a, b) => {
          if (a.matchDate && b.matchDate && a.matchDate !== b.matchDate) return a.matchDate.localeCompare(b.matchDate);
          return a.id - b.id;
        });

      const rows = [['Participante', 'Fase', 'Jogo', 'Data', 'Palpite', 'Resultado', 'Pontos', 'Total parcial']];

      this.ranking.forEach(rank => {
        let total = 0;
        finalizados.forEach(match => {
          const pred = this.predictions.find(p => p.matchId === match.id && p.participant === rank.name);
          const realA = Number(match.realScoreA);
          const realB = Number(match.realScoreB);
          let pontos = 0;
          let palpite = 'Sem palpite';

          if (pred && pred.scoreA !== null && pred.scoreB !== null) {
            const predA = Number(pred.scoreA);
            const predB = Number(pred.scoreB);
            palpite = `${predA} x ${predB}`;
            if (predA === realA && predB === realB) pontos = 3;
            else if (Math.sign(predA - predB) === Math.sign(realA - realB)) pontos = 1;
          }

          total += pontos;
          rows.push([
            rank.name,
            match.group,
            `${match.teamA || '?'} x ${match.teamB || '?'}`,
            match.matchDate ? this.formatarData(match.matchDate) : '',
            palpite,
            `${realA} x ${realB}`,
            pontos,
            total
          ]);
        });
      });

      downloadCSV('resultados-bolao.csv', rows);
    },

    async restaurarBackup(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      this.backupRestoreMessage = '';
      this.backupRestoreError = '';

      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        this.backupRestoreError = 'Arquivo JSON inválido.';
        return;
      }

      if (!confirm('Isso vai substituir os jogos, palpites e configurações atuais pelo conteúdo deste backup. Deseja continuar?')) {
        return;
      }

      try {
        const res = await fetch(`${API}/admin/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify(backup)
        });
        const data = await res.json();
        if (!res.ok) {
          this.backupRestoreError = data.erro || 'Erro ao restaurar backup.';
          return;
        }
        this.backupRestoreMessage = 'Backup restaurado com sucesso!';
        await this.carregarParticipantesAdmin();
        await this.carregarEstado();
      } catch {
        this.backupRestoreError = 'Erro ao conectar com o servidor.';
      }
    },

    nomeArquivoPalpites(prefixo) {
      if (!this.activeMatch) return `${prefixo}.csv`;
      const slug = `${this.activeMatch.teamA}-x-${this.activeMatch.teamB}`
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      return `${prefixo}-${slug}.csv`;
    },

    baixarModeloPalpitesCSV() {
      if (!this.activeMatch) return;
      const rows = [['Participante', `Placar ${this.activeMatch.teamA}`, `Placar ${this.activeMatch.teamB}`]];
      this.activeMatchPredictions.forEach(pred => rows.push([pred.participant, '', '']));
      downloadCSV(this.nomeArquivoPalpites('modelo-palpites'), rows);
    },

    exportarPalpitesCSV() {
      if (!this.activeMatch) return;
      const rows = [['Participante', `Placar ${this.activeMatch.teamA}`, `Placar ${this.activeMatch.teamB}`]];
      this.activeMatchPredictions.forEach(pred => rows.push([pred.participant, pred.scoreA ?? '', pred.scoreB ?? '']));
      downloadCSV(this.nomeArquivoPalpites('palpites'), rows);
    },

    async importarPalpitesCSV(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !this.selectedMatchId) return;

      this.palpitesCsvMessage = '';
      this.palpitesCsvError = '';

      const linhas = parseCSV(await file.text());
      const dados = linhas.slice(1); // ignora cabeçalho

      const participantesValidos = new Set(this.participants.map(p => p.name));
      const predictions = [];
      const naoEncontrados = [];
      const invalidos = [];

      for (const linha of dados) {
        const nome = (linha[0] ?? '').trim();
        if (!nome) continue;

        if (!participantesValidos.has(nome)) {
          naoEncontrados.push(nome);
          continue;
        }

        const scoreA = (linha[1] ?? '').trim();
        const scoreB = (linha[2] ?? '').trim();
        const valido = (v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 99);

        if (!valido(scoreA) || !valido(scoreB)) {
          invalidos.push(nome);
          continue;
        }

        predictions.push({
          participant: nome,
          scoreA: scoreA === '' ? null : Number(scoreA),
          scoreB: scoreB === '' ? null : Number(scoreB)
        });
      }

      if (!predictions.length) {
        this.palpitesCsvError = 'Nenhum palpite válido encontrado no arquivo.';
        return;
      }

      try {
        const res = await fetch(`${API}/admin/predictions/bulk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({ matchId: this.selectedMatchId, predictions })
        });
        const data = await res.json();
        if (!res.ok) {
          this.palpitesCsvError = data.erro || 'Erro ao importar palpites.';
          return;
        }

        const problemas = [...naoEncontrados, ...invalidos, ...(data.notFound || []), ...(data.invalid || [])];
        this.palpitesCsvMessage = `${data.updated} palpite(s) importado(s) com sucesso.`;
        if (problemas.length) {
          this.palpitesCsvMessage += ` Ignorados: ${problemas.join(', ')}.`;
        }
        await this.carregarEstado();
      } catch {
        this.palpitesCsvError = 'Erro ao conectar com o servidor.';
      }
    },

    abrirPerfil() {
      this.profileForm = {
        firstName: this.user.firstName,
        lastName: this.user.lastName,
        photo: this.user.photo,
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      };
      this.profileError = '';
      this.profileMessage = '';
      this.view = 'perfil';
    },

    async onProfilePhotoSelected(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.profileForm.photo = await resizeImageToBase64(file);
      } catch {
        this.profileError = 'Não foi possível carregar essa imagem.';
      }
    },

    async salvarPerfil() {
      this.profileError = '';
      this.profileMessage = '';

      if ((this.profileForm.newPassword || this.profileForm.confirmNewPassword) &&
          this.profileForm.newPassword !== this.profileForm.confirmNewPassword) {
        this.profileError = 'As senhas não coincidem.';
        return;
      }

      this.profileSaving = true;
      try {
        const res = await fetch(`${API}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({
            firstName: this.profileForm.firstName,
            lastName: this.profileForm.lastName,
            photo: this.profileForm.photo,
            currentPassword: this.profileForm.currentPassword || undefined,
            newPassword: this.profileForm.newPassword || undefined
          })
        });
        const data = await res.json();
        if (!res.ok) {
          this.profileError = data.erro || 'Erro ao salvar perfil.';
          return;
        }
        this.user = data.user;
        this.profileForm.currentPassword = '';
        this.profileForm.newPassword = '';
        this.profileForm.confirmNewPassword = '';
        this.profileMessage = 'Perfil atualizado com sucesso!';
      } catch {
        this.profileError = 'Erro ao conectar com o servidor.';
      } finally {
        this.profileSaving = false;
      }
    },

    async carregarParticipantesAdmin() {
      try {
        const res = await fetch(`${API}/admin/participants`, { headers: this.authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        this.adminParticipants = data.participants;
      } catch {
        // ignora falha pontual de rede
      }
    },

    abrirNovoParticipante() {
      this.participantForm = { id: null, name: '', photo: null, whatsapp: '', championPick: null, topScorerPick: '' };
      this.participantFormError = '';
    },

    editarParticipante(p) {
      this.participantForm = {
        id: p.id,
        name: p.name,
        photo: p.photo,
        whatsapp: p.whatsapp || '',
        championPick: p.championPick,
        topScorerPick: p.topScorerPick || ''
      };
      this.participantFormError = '';
    },

    async onParticipantPhotoSelected(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.participantForm.photo = await resizeImageToBase64(file);
      } catch {
        this.participantFormError = 'Não foi possível carregar essa imagem.';
      }
    },

    async salvarParticipante() {
      this.participantFormError = '';
      if (!this.participantForm.name.trim()) {
        this.participantFormError = 'Informe o nome do participante.';
        return;
      }

      this.participantFormSaving = true;
      try {
        const isEdit = this.participantForm.id !== null;
        const url = isEdit ? `${API}/admin/participants/${this.participantForm.id}` : `${API}/admin/participants`;
        const res = await fetch(url, {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({
            name: this.participantForm.name,
            photo: this.participantForm.photo,
            whatsapp: this.participantForm.whatsapp,
            championPick: this.participantForm.championPick,
            topScorerPick: this.participantForm.topScorerPick
          })
        });
        const data = await res.json();
        if (!res.ok) {
          this.participantFormError = data.erro || 'Erro ao salvar participante.';
          return;
        }
        this.abrirNovoParticipante();
        await this.carregarParticipantesAdmin();
        await this.carregarEstado();
      } catch {
        this.participantFormError = 'Erro ao conectar com o servidor.';
      } finally {
        this.participantFormSaving = false;
      }
    },

    async excluirParticipante(p) {
      if (this.participantDeleteConfirm !== p.id) {
        this.participantDeleteConfirm = p.id;
        return;
      }
      this.participantDeleteConfirm = null;
      try {
        await fetch(`${API}/admin/participants/${p.id}`, {
          method: 'DELETE',
          headers: this.authHeaders()
        });
        if (this.participantForm.id === p.id) this.abrirNovoParticipante();
        await this.carregarParticipantesAdmin();
        await this.carregarEstado();
      } catch {
        // ignora falha pontual de rede
      }
    },

    async salvarPalpiteAdmin(pred, field, value) {
      const matchId = this.selectedMatchId;
      if (!matchId) return;

      const scoreA = field === 'scoreA' ? value : pred.scoreA;
      const scoreB = field === 'scoreB' ? value : pred.scoreB;
      const predPenaltyWinner = field === 'predPenaltyWinner' ? value : pred.predPenaltyWinner;

      try {
        const res = await fetch(`${API}/admin/predictions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({ matchId, participant: pred.participant, scoreA, scoreB, predPenaltyWinner })
        });
        if (!res.ok) return;
        const data = await res.json();
        const idx = this.predictions.findIndex(p => p.matchId === matchId && p.participant === pred.participant);
        if (idx >= 0) {
          this.predictions[idx] = { ...this.predictions[idx], ...data.prediction };
        } else {
          this.predictions.push({ matchId, participant: pred.participant, ...data.prediction });
        }
      } catch {
        // ignora falha pontual de rede
      }
    },

    async salvarConfiguracoesEspeciais() {
      this.specialSettingsMessage = '';
      try {
        const res = await fetch(`${API}/settings/special`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify(this.settings)
        });
        if (res.ok) {
          this.specialSettingsMessage = 'Configurações salvas!';
        }
      } catch {
        // ignora falha pontual de rede
      }
    }
  },

  async mounted() {
    await this.carregarEstado();
    this.iniciarPolling();
    this.iniciarEventos();
    this.iniciarCarrossel();
    this.iniciarRankingCiclo();
    if (this.token) await this.carregarSessao();

    this.$nextTick(this.atualizarBracketScale);
    window.addEventListener('resize', this.atualizarBracketScale);
  }
}).mount('#app');
