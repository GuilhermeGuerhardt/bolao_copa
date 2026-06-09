import { createApp } from 'vue';
import { createInitialState, normalizeState } from './storage.js';
import { calculateRanking } from './scoring.js';
import { exportarBackup as downloadBackup } from './utils.js';

const API = '/api';

async function apiGet() {
  const res = await fetch(`${API}/state`);
  if (!res.ok) return null;
  return res.json();
}

async function apiSave(payload) {
  await fetch(`${API}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

createApp({
  data() {
    return {
      ...createInitialState(),
      showAdminModal: false,
      adminPasswordInput: '',
      adminPasswordError: ''
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
      return calculateRanking(this.participants, this.matches, this.predictions);
    },

    podium() {
      return this.ranking.slice(0, 3);
    }
  },

  watch: {
    participants: { deep: true, handler() { this.save(); } },
    matches:      { deep: true, handler() { this.save(); } },
    predictions:  { deep: true, handler() { this.save(); } },
    selectedMatchId() {
      if (this.selectedMatchId !== null) this.ensurePredictionsForMatch(this.selectedMatchId);
      this.save();
    },
    isAdmin() { this.save(); }
  },

  methods: {
    toggleAdmin() {
      if (this.isAdmin) {
        this.isAdmin = false;
      } else {
        this.adminPasswordInput = '';
        this.adminPasswordError = '';
        this.showAdminModal = true;
      }
    },

    async confirmarAdmin() {
      try {
        const res = await fetch(`${API}/auth/admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.adminPasswordInput })
        });
        if (res.ok) {
          this.isAdmin = true;
          this.showAdminModal = false;
        } else {
          this.adminPasswordError = 'Senha incorreta. Tente novamente.';
          this.adminPasswordInput = '';
        }
      } catch {
        this.adminPasswordError = 'Erro ao verificar senha.';
      }
    },

    cancelarAdmin() {
      this.showAdminModal = false;
      this.adminPasswordInput = '';
      this.adminPasswordError = '';
    },

    save() {
      const payload = {
        isAdmin: this.isAdmin,
        participants: this.participants,
        matches: this.matches,
        predictions: this.predictions,
        selectedMatchId: this.selectedMatchId
      };
      apiSave(payload).catch(() => {
        localStorage.setItem(this.storageKey, JSON.stringify(payload));
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
          isFinished: false
        });
      }
      this.selectedMatchId = match.id;
      this.ensurePredictionsForMatch(match.id);
      this.save();
    },

    ensurePredictionsForMatch(matchId) {
      const participantNames = new Set(this.participants.map(p => p.name));
      this.participants.forEach(participant => {
        const exists = this.predictions.find(
          pred => pred.matchId === matchId && pred.participant === participant.name
        );
        if (!exists) {
          this.predictions.push({ matchId, participant: participant.name, scoreA: null, scoreB: null });
        }
      });
      this.predictions = this.predictions.filter(
        pred => pred.matchId !== matchId || participantNames.has(pred.participant)
      );
    },

    exibirPlacar(value) {
      return value === null || value === '' || Number.isNaN(Number(value)) ? '-' : value;
    },

    limparSomentePlacar() {
      this.matches.forEach(match => {
        match.realScoreA = null;
        match.realScoreB = null;
        match.isFinished = false;
      });
      this.predictions.forEach(pred => {
        pred.scoreA = null;
        pred.scoreB = null;
      });
      fetch(`${API}/state/limpar`, { method: 'POST' }).catch(() => {});
      this.save();
    },

    exportarBackup() {
      downloadBackup({
        isAdmin: this.isAdmin,
        participants: this.participants,
        matches: this.matches,
        predictions: this.predictions,
        selectedMatchId: this.selectedMatchId
      });
    }
  },

  async mounted() {
    const apiState = await apiGet().catch(() => null);

    if (apiState) {
      const normalized = normalizeState(apiState);
      this.isAdmin = normalized.isAdmin;
      this.matches = normalized.matches;
      this.predictions = normalized.predictions;
      this.selectedMatchId = normalized.selectedMatchId;
    }

    if (this.matches.length && (this.selectedMatchId === null || !this.matches.some(m => m.id === this.selectedMatchId))) {
      this.selectedMatchId = this.matches[0].id;
    }

    this.matches.forEach(match => this.ensurePredictionsForMatch(match.id));
    this.save();
  }
}).mount('#app');
