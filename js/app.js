import { createApp } from 'vue';
import { normalizeState } from './storage.js';
import { calculateRanking, calculateRankingHistory } from './scoring.js';
import { exportarBackup as downloadBackup, resizeImageToBase64 } from './utils.js';
import { buildAllMatches, ALL_TEAMS } from './config.js';

const CHART_COLORS = ['#facc15', '#38bdf8', '#34d399', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#f87171', '#4ade80', '#c084fc'];

const API = '/api';
const TOKEN_KEY = 'bolao_token';

createApp({
  data() {
    return {
      token: localStorage.getItem(TOKEN_KEY) || null,
      user: null,

      view: 'transmissao',
      authMode: 'login',
      authError: '',
      showPassword: { login: false, register: false, current: false, new: false, confirm: false },
      authLoading: false,
      loginForm: { displayName: '', password: '' },
      registerForm: { firstName: '', lastName: '', displayName: '', password: '', photo: null },

      participants: [],
      allMatches: buildAllMatches(),
      matches: [],
      predictions: [],
      selectedMatchId: null,
      settings: { actualChampion: null, actualTopScorer: null, championBonusPoints: 0, topScorerBonusPoints: 0 },

      pollTimer: null,
      predictionSaveTimers: {},

      ALL_TEAMS,

      profileForm: { firstName: '', lastName: '', photo: null, currentPassword: '', newPassword: '', confirmNewPassword: '' },
      profileError: '',
      profileMessage: '',
      profileSaving: false,

      adminUsers: [],
      resetPasswordInfo: null,
      specialSettingsMessage: ''
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
          scoreB: null
        };
      });
    },

    totalFinishedMatches() {
      return this.matches.filter(m => m.isFinished).length;
    },

    ranking() {
      return calculateRanking(this.participants, this.matches, this.predictions, this.settings);
    },

    podium() {
      return this.ranking.slice(0, 3);
    },

    rankingHistory() {
      return calculateRankingHistory(this.participants, this.matches, this.predictions, this.settings);
    },

    rankingChartSeries() {
      return this.participants.map((p, idx) => ({
        name: p.name,
        color: CHART_COLORS[idx % CHART_COLORS.length],
        values: this.rankingHistory.map(step => step.points[p.name] ?? 0)
      }));
    },

    rankingChartMax() {
      let max = 0;
      this.rankingChartSeries.forEach(series => series.values.forEach(v => { if (v > max) max = v; }));
      return Math.max(max, 1);
    }
  },

  methods: {
    authHeaders() {
      return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    },

    async onPhotoSelected(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.registerForm.photo = await resizeImageToBase64(file);
      } catch {
        this.authError = 'Não foi possível carregar essa imagem.';
      }
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

    async fazerRegistro() {
      this.authError = '';
      this.authLoading = true;
      try {
        const res = await fetch(`${API}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.registerForm)
        });
        const data = await res.json();
        if (!res.ok) {
          this.authError = data.erro || 'Erro ao criar conta.';
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
      await this.carregarEstado();
      this.iniciarPolling();
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
      this.matches = [];
      this.predictions = [];
      this.participants = [];
      this.selectedMatchId = null;
      this.view = 'transmissao';
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    async carregarEstado() {
      try {
        const res = await fetch(`${API}/state`, { headers: this.authHeaders() });
        if (res.status === 401) {
          this.logout();
          return;
        }
        if (!res.ok) return;

        const raw = await res.json();
        const normalized = normalizeState(raw);
        this.matches = normalized.matches;
        this.predictions = normalized.predictions;
        this.selectedMatchId = normalized.selectedMatchId;
        this.participants = normalized.participants;
        this.settings = normalized.settings;

        if (this.matches.length && (this.selectedMatchId === null || !this.matches.some(m => m.id === this.selectedMatchId))) {
          this.selectedMatchId = this.matches[0].id;
        }

        this.ensureMyPredictions();
      } catch {
        // mantém o estado atual em caso de falha de rede
      }
    },

    iniciarPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        if (this.user) this.carregarEstado();
      }, 20000);
    },

    ensureMyPredictions() {
      if (!this.user || this.user.isAdmin) return;
      this.matches.forEach(match => {
        const exists = this.predictions.find(
          pred => pred.matchId === match.id && pred.participant === this.user.displayName
        );
        if (!exists) {
          this.predictions.push({ matchId: match.id, participant: this.user.displayName, scoreA: null, scoreB: null });
        }
      });
    },

    getMyPrediction(matchId) {
      return this.predictions.find(
        pred => pred.matchId === matchId && pred.participant === this.user.displayName
      ) || { matchId, participant: this.user.displayName, scoreA: null, scoreB: null };
    },

    salvarMeuPalpite(matchId) {
      if (this.predictionSaveTimers[matchId]) {
        clearTimeout(this.predictionSaveTimers[matchId]);
      }
      this.predictionSaveTimers[matchId] = setTimeout(async () => {
        delete this.predictionSaveTimers[matchId];
        const pred = this.getMyPrediction(matchId);
        try {
          await fetch(`${API}/predictions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify({ predictions: [{ matchId, scoreA: pred.scoreA, scoreB: pred.scoreB }] })
          });
        } catch {
          // ignora falha pontual de rede
        }
      }, 500);
    },

    async saveAdminState() {
      try {
        await fetch(`${API}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({ selectedMatchId: this.selectedMatchId, matches: this.matches })
        });
      } catch {
        // ignora falha pontual de rede
      }
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
          isFinished: false
        });
      }
      this.selectedMatchId = match.id;
      this.saveAdminState();
    },

    exibirPlacar(value) {
      return value === null || value === '' || Number.isNaN(Number(value)) ? '-' : value;
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
        selectedMatchId: this.selectedMatchId
      });
    },

    chartPoints(values) {
      const w = 600, h = 220, pad = 16;
      const n = values.length;
      if (n <= 1) return '';
      const max = this.rankingChartMax;
      return values.map((v, i) => {
        const x = pad + (i * (w - 2 * pad)) / (n - 1);
        const y = h - pad - (v / max) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
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

    async salvarPalpiteEspecial() {
      try {
        const res = await fetch(`${API}/profile/special-pick`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
          body: JSON.stringify({ championPick: this.user.championPick, topScorerPick: this.user.topScorerPick })
        });
        const data = await res.json();
        if (res.ok) {
          this.user = data.user;
          await this.carregarEstado();
        }
      } catch {
        // ignora falha pontual de rede
      }
    },

    async carregarUsuariosAdmin() {
      try {
        const res = await fetch(`${API}/admin/users`, { headers: this.authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        this.adminUsers = data.users;
      } catch {
        // ignora falha pontual de rede
      }
    },

    async redefinirSenha(u) {
      try {
        const res = await fetch(`${API}/admin/users/${u.id}/reset-password`, {
          method: 'POST',
          headers: this.authHeaders()
        });
        const data = await res.json();
        if (res.ok) {
          this.resetPasswordInfo = { displayName: data.displayName, password: data.password };
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
    if (this.token) {
      await this.carregarSessao();
      if (this.user) {
        await this.carregarEstado();
        this.iniciarPolling();
      }
    }
  }
}).mount('#app');
