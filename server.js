import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("JWT_SECRET não definido no .env");
  process.exit(1);
}

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
    CREATE TABLE IF NOT EXISTS bolao_users (
      id              SERIAL PRIMARY KEY,
      "displayName"   TEXT UNIQUE NOT NULL,
      "firstName"     TEXT NOT NULL,
      "lastName"      TEXT NOT NULL,
      "passwordHash"  TEXT NOT NULL,
      photo           TEXT,
      "isAdmin"       BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
    VALUES ('selectedMatchId', NULL)
    ON CONFLICT (key) DO NOTHING;

    ALTER TABLE bolao_users ADD COLUMN IF NOT EXISTS "championPick" TEXT;
    ALTER TABLE bolao_users ADD COLUMN IF NOT EXISTS "topScorerPick" TEXT;
    ALTER TABLE bolao_matches ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMPTZ;

    INSERT INTO bolao_settings (key, value) VALUES ('actualChampion', NULL) ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('actualTopScorer', NULL) ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('championBonusPoints', '10') ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('topScorerBonusPoints', '5') ON CONFLICT (key) DO NOTHING;
  `);
  console.log("Banco de dados pronto.");
}

async function seedAdmin() {
  const existing = await queryOne(`SELECT id FROM bolao_users WHERE "displayName" = 'Admin'`);
  if (existing) return null;

  const password = generateRandomPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `INSERT INTO bolao_users ("displayName", "firstName", "lastName", "passwordHash", "isAdmin")
     VALUES ('Admin', 'Admin', 'Imparáveis', $1, TRUE)`,
    [passwordHash]
  );

  return password;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { id: user.id, displayName: user.displayName, isAdmin: user.isAdmin },
    JWT_SECRET,
    { expiresIn: "180d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: "Não autenticado." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ erro: "Acesso restrito ao administrador." });
  next();
}

function sanitizeUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    photo: user.photo ?? null,
    isAdmin: Boolean(user.isAdmin),
    championPick: user.championPick ?? null,
    topScorerPick: user.topScorerPick ?? null,
  };
}

function generateRandomPassword() {
  return crypto.randomBytes(9).toString("base64").replace(/[/+=]/g, "").slice(0, 12);
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_, res) => res.json({ ok: true, api: "bolao", versao: 2 }));

// ─── Autenticação ──────────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  try {
    const { displayName, password, firstName, lastName, photo } = req.body || {};

    const nome = String(displayName ?? "").trim();
    const sobrenome = String(lastName ?? "").trim();
    const primeiroNome = String(firstName ?? "").trim();

    if (!nome || !password || !primeiroNome || !sobrenome) {
      return res.status(400).json({ erro: "Preencha nome de exibição, senha, nome e sobrenome." });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ erro: "A senha deve ter pelo menos 4 caracteres." });
    }
    if (photo && typeof photo === "string" && photo.length > 1_500_000) {
      return res.status(400).json({ erro: "Foto muito grande." });
    }

    const existing = await queryOne(`SELECT id FROM bolao_users WHERE "displayName" = $1`, [nome]);
    if (existing) {
      return res.status(409).json({ erro: "Esse nome de exibição já está em uso." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await queryOne(
      `INSERT INTO bolao_users ("displayName", "firstName", "lastName", "passwordHash", photo, "isAdmin")
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, "displayName", "firstName", "lastName", photo, "isAdmin"`,
      [nome, primeiroNome, sobrenome, passwordHash, photo || null]
    );

    const token = signToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) {
    console.error("POST /api/auth/register", e);
    res.status(500).json({ erro: "Erro ao criar conta." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { displayName, password } = req.body || {};
    const nome = String(displayName ?? "").trim();
    if (!nome || !password) {
      return res.status(400).json({ erro: "Informe o nome de exibição e a senha." });
    }

    const user = await queryOne(`SELECT * FROM bolao_users WHERE "displayName" = $1`, [nome]);
    if (!user) return res.status(401).json({ erro: "Nome de exibição ou senha inválidos." });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ erro: "Nome de exibição ou senha inválidos." });

    const token = signToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) {
    console.error("POST /api/auth/login", e);
    res.status(500).json({ erro: "Erro ao entrar." });
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const user = await queryOne(`SELECT * FROM bolao_users WHERE id = $1`, [req.user.id]);
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });
    res.json({ user: sanitizeUser(user) });
  } catch (e) {
    console.error("GET /api/auth/me", e);
    res.status(500).json({ erro: "Erro ao carregar sessão." });
  }
});

// ─── State (leitura geral) ─────────────────────────────────────────────────────

app.get("/api/state", authMiddleware, async (req, res) => {
  try {
    const [users, matches, predictions, settings] = await Promise.all([
      query(
        `SELECT "displayName" AS name, "championPick", "topScorerPick"
         FROM bolao_users WHERE "isAdmin" = FALSE ORDER BY "displayName"`
      ),
      query(`SELECT * FROM bolao_matches ORDER BY id`),
      query(`SELECT * FROM bolao_predictions`),
      query(`SELECT key, value FROM bolao_settings`),
    ]);

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    res.json({
      participants: users.map((u) => ({
        name: u.name,
        championPick: u.championPick ?? null,
        topScorerPick: u.topScorerPick ?? null,
      })),
      selectedMatchId: settingsMap.selectedMatchId ? Number(settingsMap.selectedMatchId) : null,
      matches: matches.map(normalizeMatch),
      predictions: predictions.map(normalizePrediction),
      settings: {
        actualChampion: settingsMap.actualChampion ?? null,
        actualTopScorer: settingsMap.actualTopScorer ?? null,
        championBonusPoints: Number(settingsMap.championBonusPoints ?? 0),
        topScorerBonusPoints: Number(settingsMap.topScorerBonusPoints ?? 0),
      },
    });
  } catch (e) {
    console.error("GET /api/state", e);
    res.status(500).json({ erro: "Erro ao carregar estado." });
  }
});

// ─── State (gestão de partidas - somente admin) ────────────────────────────────

app.put("/api/state", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { selectedMatchId, matches = [] } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO bolao_settings (key, value) VALUES ('selectedMatchId', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [selectedMatchId != null ? String(selectedMatchId) : null]
      );

      if (matches.length > 0) {
        const ids = matches.map((m) => m.id);
        await client.query(`DELETE FROM bolao_matches WHERE id != ALL($1)`, [ids]);

        const existingRows = await client.query(`SELECT id, "isFinished", "finishedAt" FROM bolao_matches`);
        const existingMap = new Map(existingRows.rows.map((r) => [r.id, r]));

        for (const m of matches) {
          const existing = existingMap.get(m.id);
          const isFinished = Boolean(m.isFinished);
          let finishedAt = null;
          if (isFinished) {
            finishedAt = existing?.isFinished && existing?.finishedAt ? existing.finishedAt : new Date().toISOString();
          }

          await client.query(
            `INSERT INTO bolao_matches (id, "group", "teamA", "teamB", "realScoreA", "realScoreB", "isFinished", "finishedAt", "addedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
               "realScoreA" = EXCLUDED."realScoreA",
               "realScoreB" = EXCLUDED."realScoreB",
               "isFinished" = EXCLUDED."isFinished",
               "finishedAt" = EXCLUDED."finishedAt"`,
            [
              m.id, m.group, m.teamA, m.teamB,
              m.realScoreA ?? null, m.realScoreB ?? null,
              isFinished, finishedAt,
              new Date().toISOString(),
            ]
          );
        }
      } else {
        await client.query(`DELETE FROM bolao_matches`);
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

// ─── Palpites do usuário logado ────────────────────────────────────────────────

app.put("/api/predictions", authMiddleware, async (req, res) => {
  try {
    const { predictions = [] } = req.body || {};
    for (const p of predictions) {
      await query(
        `INSERT INTO bolao_predictions ("matchId", participant, "scoreA", "scoreB")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("matchId", participant) DO UPDATE SET
           "scoreA" = EXCLUDED."scoreA",
           "scoreB" = EXCLUDED."scoreB"`,
        [p.matchId, req.user.displayName, p.scoreA ?? null, p.scoreB ?? null]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/predictions", e);
    res.status(500).json({ erro: "Erro ao salvar palpites." });
  }
});

// ─── Limpar placar (somente admin) ─────────────────────────────────────────────

app.post("/api/state/limpar", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await query(`UPDATE bolao_matches SET "realScoreA" = NULL, "realScoreB" = NULL, "isFinished" = FALSE`);
    await query(`UPDATE bolao_predictions SET "scoreA" = NULL, "scoreB" = NULL`);
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/state/limpar", e);
    res.status(500).json({ erro: "Erro ao limpar placar." });
  }
});

// ─── Perfil do usuário logado ──────────────────────────────────────────────────

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, photo, currentPassword, newPassword } = req.body || {};
    const user = await queryOne(`SELECT * FROM bolao_users WHERE id = $1`, [req.user.id]);
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });

    const primeiroNome = String(firstName ?? user.firstName).trim();
    const sobrenome = String(lastName ?? user.lastName).trim();
    if (!primeiroNome || !sobrenome) {
      return res.status(400).json({ erro: "Nome e sobrenome não podem ficar em branco." });
    }

    let novaFoto = user.photo;
    if (photo !== undefined) {
      if (photo && typeof photo === "string" && photo.length > 1_500_000) {
        return res.status(400).json({ erro: "Foto muito grande." });
      }
      novaFoto = photo || null;
    }

    let novoHash = user.passwordHash;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ erro: "Informe a senha atual para definir uma nova senha." });
      }
      const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
      if (!ok) return res.status(401).json({ erro: "Senha atual incorreta." });
      if (String(newPassword).length < 4) {
        return res.status(400).json({ erro: "A nova senha deve ter pelo menos 4 caracteres." });
      }
      novoHash = await bcrypt.hash(String(newPassword), 10);
    }

    const updated = await queryOne(
      `UPDATE bolao_users SET "firstName" = $1, "lastName" = $2, photo = $3, "passwordHash" = $4
       WHERE id = $5 RETURNING *`,
      [primeiroNome, sobrenome, novaFoto, novoHash, req.user.id]
    );

    res.json({ user: sanitizeUser(updated) });
  } catch (e) {
    console.error("PUT /api/profile", e);
    res.status(500).json({ erro: "Erro ao atualizar perfil." });
  }
});

app.put("/api/profile/special-pick", authMiddleware, async (req, res) => {
  try {
    const { championPick, topScorerPick } = req.body || {};

    const champion = championPick ? String(championPick).trim().slice(0, 100) : null;
    const topScorer = topScorerPick ? String(topScorerPick).trim().slice(0, 100) : null;

    const updated = await queryOne(
      `UPDATE bolao_users SET "championPick" = $1, "topScorerPick" = $2 WHERE id = $3 RETURNING *`,
      [champion || null, topScorer || null, req.user.id]
    );

    res.json({ user: sanitizeUser(updated) });
  } catch (e) {
    console.error("PUT /api/profile/special-pick", e);
    res.status(500).json({ erro: "Erro ao salvar palpite especial." });
  }
});

// ─── Gestão de usuários (somente admin) ────────────────────────────────────────

app.get("/api/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await query(
      `SELECT id, "displayName", "firstName", "lastName", "isAdmin", "createdAt"
       FROM bolao_users ORDER BY "displayName"`
    );
    res.json({ users });
  } catch (e) {
    console.error("GET /api/admin/users", e);
    res.status(500).json({ erro: "Erro ao carregar usuários." });
  }
});

app.post("/api/admin/users/:id/reset-password", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user = await queryOne(`SELECT id, "displayName" FROM bolao_users WHERE id = $1`, [id]);
    if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });

    const novaSenha = generateRandomPassword();
    const passwordHash = await bcrypt.hash(novaSenha, 10);
    await query(`UPDATE bolao_users SET "passwordHash" = $1 WHERE id = $2`, [passwordHash, id]);

    res.json({ displayName: user.displayName, password: novaSenha });
  } catch (e) {
    console.error("POST /api/admin/users/:id/reset-password", e);
    res.status(500).json({ erro: "Erro ao redefinir senha." });
  }
});

// ─── Configurações de campeão/artilheiro (somente admin) ───────────────────────

app.put("/api/settings/special", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { actualChampion, actualTopScorer, championBonusPoints, topScorerBonusPoints } = req.body || {};

    const entries = [
      ["actualChampion", actualChampion ? String(actualChampion).trim().slice(0, 100) : null],
      ["actualTopScorer", actualTopScorer ? String(actualTopScorer).trim().slice(0, 100) : null],
      ["championBonusPoints", String(Number(championBonusPoints) || 0)],
      ["topScorerBonusPoints", String(Number(topScorerBonusPoints) || 0)],
    ];

    for (const [key, value] of entries) {
      await query(
        `INSERT INTO bolao_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/settings/special", e);
    res.status(500).json({ erro: "Erro ao salvar configurações." });
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
  .then(seedAdmin)
  .then((adminPassword) => {
    if (adminPassword) {
      console.log("==============================================");
      console.log(" Usuário admin criado!");
      console.log(" Login: Admin");
      console.log(` Senha: ${adminPassword}`);
      console.log(" Anote esta senha — ela não será exibida novamente.");
      console.log("==============================================");
    }
    app.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
  })
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
    finishedAt: m.finishedAt ?? null,
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
