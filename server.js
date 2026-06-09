import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'imparaveis2026';

// ─── Banco de dados ───────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS bolao_matches (
      id          INTEGER PRIMARY KEY,
      "group"     TEXT NOT NULL,
      "teamA"     TEXT NOT NULL,
      "teamB"     TEXT NOT NULL,
      "realScoreA" INTEGER,
      "realScoreB" INTEGER,
      "isFinished" BOOLEAN NOT NULL DEFAULT FALSE,
      "addedAt"   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bolao_predictions (
      "matchId"     INTEGER NOT NULL REFERENCES bolao_matches(id) ON DELETE CASCADE,
      participant   TEXT NOT NULL,
      "scoreA"      INTEGER,
      "scoreB"      INTEGER,
      PRIMARY KEY ("matchId", participant)
    );

    CREATE TABLE IF NOT EXISTS bolao_settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT INTO bolao_settings (key, value)
    VALUES ('selectedMatchId', NULL), ('isAdmin', 'false')
    ON CONFLICT (key) DO NOTHING;
  `);
  console.log("Banco de dados pronto.");
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_, res) => res.json({ ok: true, api: "bolao", versao: 1 }));

// ─── State (leitura/escrita completa, equivalente ao localStorage) ────────────

app.get("/api/state", async (req, res) => {
  try {
    const [matches, predictions, settings] = await Promise.all([
      query(`SELECT * FROM bolao_matches ORDER BY id`),
      query(`SELECT * FROM bolao_predictions`),
      query(`SELECT key, value FROM bolao_settings`),
    ]);

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    res.json({
      isAdmin: settingsMap.isAdmin === "true",
      selectedMatchId: settingsMap.selectedMatchId ? Number(settingsMap.selectedMatchId) : null,
      matches: matches.map(normalizeMatch),
      predictions: predictions.map(normalizePrediction),
    });
  } catch (e) {
    console.error("GET /api/state", e);
    res.status(500).json({ erro: "Erro ao carregar estado." });
  }
});

app.put("/api/state", async (req, res) => {
  try {
    const { isAdmin, selectedMatchId, matches = [], predictions = [] } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Atualiza settings
      await client.query(
        `INSERT INTO bolao_settings (key, value) VALUES ('isAdmin', $1), ('selectedMatchId', $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(Boolean(isAdmin)), selectedMatchId != null ? String(selectedMatchId) : null]
      );

      // Sincroniza matches: remove os que não estão mais na lista
      if (matches.length > 0) {
        const ids = matches.map((m) => m.id);
        await client.query(`DELETE FROM bolao_matches WHERE id != ALL($1)`, [ids]);

        for (const m of matches) {
          await client.query(
            `INSERT INTO bolao_matches (id, "group", "teamA", "teamB", "realScoreA", "realScoreB", "isFinished", "addedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               "realScoreA" = EXCLUDED."realScoreA",
               "realScoreB" = EXCLUDED."realScoreB",
               "isFinished" = EXCLUDED."isFinished"`,
            [
              m.id, m.group, m.teamA, m.teamB,
              m.realScoreA ?? null, m.realScoreB ?? null,
              Boolean(m.isFinished),
              new Date().toISOString(),
            ]
          );
        }
      } else {
        await client.query(`DELETE FROM bolao_matches`);
      }

      // Sincroniza predictions
      if (predictions.length > 0) {
        for (const p of predictions) {
          await client.query(
            `INSERT INTO bolao_predictions ("matchId", participant, "scoreA", "scoreB")
             VALUES ($1, $2, $3, $4)
             ON CONFLICT ("matchId", participant) DO UPDATE SET
               "scoreA" = EXCLUDED."scoreA",
               "scoreB" = EXCLUDED."scoreB"`,
            [p.matchId, p.participant, p.scoreA ?? null, p.scoreB ?? null]
          );
        }
      }

      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("PUT /api/state", e);
    res.status(500).json({ erro: "Erro ao salvar estado." });
  }
});

// ─── Auth admin ──────────────────────────────────────────────────────────────

app.post("/api/auth/admin", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ erro: "Senha incorreta." });
  }
});

// ─── Limpar placar ────────────────────────────────────────────────────────────

app.post("/api/state/limpar", async (req, res) => {
  try {
    await query(`UPDATE bolao_matches SET "realScoreA" = NULL, "realScoreB" = NULL, "isFinished" = FALSE`);
    await query(`UPDATE bolao_predictions SET "scoreA" = NULL, "scoreB" = NULL`);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/state/limpar", e);
    res.status(500).json({ erro: "Erro ao limpar placar." });
  }
});

// ─── Estáticos ────────────────────────────────────────────────────────────────

app.use(express.static(__dirname));
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ erro: "Rota não encontrada." });
  next();
});

// ─── Start ────────────────────────────────────────────────────────────────────

initDb()
  .then(() => app.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`)))
  .catch((e) => { console.error("Erro ao conectar ao banco:", e.message); process.exit(1); });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeMatch(m) {
  return {
    id: m.id,
    group: m.group,
    teamA: m.teamA,
    teamB: m.teamB,
    realScoreA: m.realScoreA ?? null,
    realScoreB: m.realScoreB ?? null,
    isFinished: Boolean(m.isFinished),
  };
}

function normalizePrediction(p) {
  return {
    matchId: p.matchId,
    participant: p.participant,
    scoreA: p.scoreA ?? null,
    scoreB: p.scoreB ?? null,
  };
}
