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
    ALTER TABLE bolao_matches ADD COLUMN IF NOT EXISTS "matchDate" TEXT;
    ALTER TABLE bolao_matches ADD COLUMN IF NOT EXISTS "matchTime" TEXT;

    INSERT INTO bolao_settings (key, value) VALUES ('actualChampion', NULL) ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('actualTopScorer', NULL) ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('championBonusPoints', '10') ON CONFLICT (key) DO NOTHING;
    INSERT INTO bolao_settings (key, value) VALUES ('topScorerBonusPoints', '5') ON CONFLICT (key) DO NOTHING;

    CREATE TABLE IF NOT EXISTS bolao_participants (
      id              SERIAL PRIMARY KEY,
      name            TEXT UNIQUE NOT NULL,
      photo           TEXT,
      whatsapp        TEXT UNIQUE,
      "championPick"  TEXT,
      "topScorerPick" TEXT,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO bolao_participants (name, photo, "championPick", "topScorerPick", "createdAt")
    SELECT "displayName", photo, "championPick", "topScorerPick", "createdAt"
    FROM bolao_users
    WHERE "isAdmin" = FALSE
    ON CONFLICT (name) DO NOTHING;
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

function normalizeDisplayNameInput(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
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

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function matchHasStarted(match) {
  if (!match.matchDate || !match.matchTime) return false;
  const start = new Date(`${match.matchDate}T${match.matchTime}:00-03:00`);
  return Date.now() >= start.getTime();
}

function n8nMiddleware(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!process.env.N8N_API_KEY || key !== process.env.N8N_API_KEY) {
    return res.status(401).json({ erro: "Não autorizado." });
  }
  next();
}

function sanitizeParticipant(p) {
  return {
    id: p.id,
    name: p.name,
    photo: p.photo ?? null,
    whatsapp: p.whatsapp ?? null,
    championPick: p.championPick ?? null,
    topScorerPick: p.topScorerPick ?? null,
  };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_, res) => res.json({ ok: true, api: "bolao", versao: 2 }));

// ─── Autenticação ──────────────────────────────────────────────────────────────

app.post("/api/auth/login", async (req, res) => {
  try {
    const { displayName, password } = req.body || {};
    const nome = normalizeDisplayNameInput(displayName);
    if (!nome || !password) {
      return res.status(400).json({ erro: "Informe o nome de exibição e a senha." });
    }

    const user = await queryOne(`SELECT * FROM bolao_users WHERE LOWER("displayName") = LOWER($1)`, [nome]);
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

app.get("/api/state", async (req, res) => {
  try {
    const [participants, matches, predictions, settings] = await Promise.all([
      query(`SELECT name, photo, "championPick", "topScorerPick" FROM bolao_participants ORDER BY name`),
      query(`SELECT * FROM bolao_matches ORDER BY id`),
      query(`SELECT * FROM bolao_predictions`),
      query(`SELECT key, value FROM bolao_settings`),
    ]);

    const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    res.json({
      participants: participants.map((p) => ({
        name: p.name,
        photo: p.photo ?? null,
        championPick: p.championPick ?? null,
        topScorerPick: p.topScorerPick ?? null,
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
            `INSERT INTO bolao_matches (id, "group", "teamA", "teamB", "realScoreA", "realScoreB", "isFinished", "finishedAt", "matchDate", "matchTime", "addedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO UPDATE SET
               "realScoreA" = EXCLUDED."realScoreA",
               "realScoreB" = EXCLUDED."realScoreB",
               "isFinished" = EXCLUDED."isFinished",
               "finishedAt" = EXCLUDED."finishedAt",
               "matchDate" = EXCLUDED."matchDate",
               "matchTime" = EXCLUDED."matchTime"`,
            [
              m.id, m.group, m.teamA, m.teamB,
              m.realScoreA ?? null, m.realScoreB ?? null,
              isFinished, finishedAt, m.matchDate ?? null, m.matchTime ?? null,
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

// ─── Gestão de participantes (somente admin) ───────────────────────────────────

app.get("/api/admin/participants", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const participants = await query(`SELECT * FROM bolao_participants ORDER BY name`);
    res.json({ participants: participants.map(sanitizeParticipant) });
  } catch (e) {
    console.error("GET /api/admin/participants", e);
    res.status(500).json({ erro: "Erro ao carregar participantes." });
  }
});

app.post("/api/admin/participants", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, photo, whatsapp, championPick, topScorerPick } = req.body || {};

    const nome = normalizeDisplayNameInput(name);
    if (!nome) {
      return res.status(400).json({ erro: "Informe o nome do participante." });
    }
    if (photo && typeof photo === "string" && photo.length > 1_500_000) {
      return res.status(400).json({ erro: "Foto muito grande." });
    }

    const existingName = await queryOne(`SELECT id FROM bolao_participants WHERE LOWER(name) = LOWER($1)`, [nome]);
    if (existingName) {
      return res.status(409).json({ erro: "Já existe um participante com esse nome." });
    }

    const phone = whatsapp ? normalizePhone(whatsapp) : null;
    if (phone) {
      const existingPhone = await queryOne(`SELECT id FROM bolao_participants WHERE whatsapp = $1`, [phone]);
      if (existingPhone) {
        return res.status(409).json({ erro: "Já existe um participante com esse WhatsApp." });
      }
    }

    const champion = championPick ? String(championPick).trim().slice(0, 100) : null;
    const topScorer = topScorerPick ? String(topScorerPick).trim().slice(0, 100) : null;

    const participant = await queryOne(
      `INSERT INTO bolao_participants (name, photo, whatsapp, "championPick", "topScorerPick")
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nome, photo || null, phone || null, champion, topScorer]
    );

    res.json({ participant: sanitizeParticipant(participant) });
  } catch (e) {
    console.error("POST /api/admin/participants", e);
    res.status(500).json({ erro: "Erro ao criar participante." });
  }
});

app.put("/api/admin/participants/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await queryOne(`SELECT * FROM bolao_participants WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ erro: "Participante não encontrado." });

    const { name, photo, whatsapp, championPick, topScorerPick } = req.body || {};

    let novoNome = existing.name;
    if (name !== undefined) {
      novoNome = normalizeDisplayNameInput(name);
      if (!novoNome) {
        return res.status(400).json({ erro: "Informe o nome do participante." });
      }
      if (novoNome.toLowerCase() !== existing.name.toLowerCase()) {
        const existingName = await queryOne(
          `SELECT id FROM bolao_participants WHERE LOWER(name) = LOWER($1) AND id != $2`,
          [novoNome, id]
        );
        if (existingName) {
          return res.status(409).json({ erro: "Já existe um participante com esse nome." });
        }
      }
    }

    let novaFoto = existing.photo;
    if (photo !== undefined) {
      if (photo && typeof photo === "string" && photo.length > 1_500_000) {
        return res.status(400).json({ erro: "Foto muito grande." });
      }
      novaFoto = photo || null;
    }

    let novoWhatsapp = existing.whatsapp;
    if (whatsapp !== undefined) {
      novoWhatsapp = whatsapp ? normalizePhone(whatsapp) : null;
      if (novoWhatsapp && novoWhatsapp !== existing.whatsapp) {
        const existingPhone = await queryOne(`SELECT id FROM bolao_participants WHERE whatsapp = $1 AND id != $2`, [novoWhatsapp, id]);
        if (existingPhone) {
          return res.status(409).json({ erro: "Já existe um participante com esse WhatsApp." });
        }
      }
    }

    const champion = championPick !== undefined
      ? (championPick ? String(championPick).trim().slice(0, 100) : null)
      : existing.championPick;
    const topScorer = topScorerPick !== undefined
      ? (topScorerPick ? String(topScorerPick).trim().slice(0, 100) : null)
      : existing.topScorerPick;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (novoNome !== existing.name) {
        await client.query(`UPDATE bolao_predictions SET participant = $1 WHERE participant = $2`, [novoNome, existing.name]);
      }

      const updated = await client.query(
        `UPDATE bolao_participants SET name = $1, photo = $2, whatsapp = $3, "championPick" = $4, "topScorerPick" = $5
         WHERE id = $6 RETURNING *`,
        [novoNome, novaFoto, novoWhatsapp, champion, topScorer, id]
      );

      await client.query("COMMIT");
      res.json({ participant: sanitizeParticipant(updated.rows[0]) });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("PUT /api/admin/participants/:id", e);
    res.status(500).json({ erro: "Erro ao atualizar participante." });
  }
});

app.delete("/api/admin/participants/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await queryOne(`SELECT * FROM bolao_participants WHERE id = $1`, [id]);
    if (!existing) return res.status(404).json({ erro: "Participante não encontrado." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM bolao_predictions WHERE participant = $1`, [existing.name]);
      await client.query(`DELETE FROM bolao_participants WHERE id = $1`, [id]);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("DELETE /api/admin/participants/:id", e);
    res.status(500).json({ erro: "Erro ao excluir participante." });
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

// ─── Palpites (somente admin) ───────────────────────────────────────────────────

app.put("/api/admin/predictions", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { matchId, participant, scoreA, scoreB } = req.body || {};

    const id = Number(matchId);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ erro: "Jogo inválido." });
    }

    const match = await queryOne(`SELECT * FROM bolao_matches WHERE id = $1`, [id]);
    if (!match) {
      return res.status(404).json({ erro: "Jogo não encontrado." });
    }

    const nome = normalizeDisplayNameInput(participant);
    const part = await queryOne(`SELECT * FROM bolao_participants WHERE name = $1`, [nome]);
    if (!part) {
      return res.status(404).json({ erro: "Participante não encontrado." });
    }

    const isValidScore = (v) => v === null || v === undefined || v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 99);
    if (!isValidScore(scoreA) || !isValidScore(scoreB)) {
      return res.status(400).json({ erro: "Placar inválido. Use números inteiros entre 0 e 99." });
    }

    const placarA = scoreA === null || scoreA === undefined || scoreA === "" ? null : Number(scoreA);
    const placarB = scoreB === null || scoreB === undefined || scoreB === "" ? null : Number(scoreB);

    await query(
      `INSERT INTO bolao_predictions ("matchId", participant, "scoreA", "scoreB")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("matchId", participant) DO UPDATE SET
         "scoreA" = EXCLUDED."scoreA",
         "scoreB" = EXCLUDED."scoreB"`,
      [match.id, part.name, placarA, placarB]
    );

    res.json({ ok: true, participant: part.name, matchId: match.id, prediction: { scoreA: placarA, scoreB: placarB } });
  } catch (e) {
    console.error("PUT /api/admin/predictions", e);
    res.status(500).json({ erro: "Erro ao salvar palpite." });
  }
});

// ─── Integração N8N ─────────────────────────────────────────────────────────────

app.get("/api/n8n/current-match", n8nMiddleware, async (req, res) => {
  try {
    const setting = await queryOne(`SELECT value FROM bolao_settings WHERE key = 'selectedMatchId'`);
    const matchId = setting?.value ? Number(setting.value) : null;
    if (!matchId) return res.json({ matchId: null });

    const match = await queryOne(`SELECT * FROM bolao_matches WHERE id = $1`, [matchId]);
    if (!match) return res.json({ matchId: null });

    res.json({
      matchId: match.id,
      group: match.group,
      teamA: match.teamA,
      teamB: match.teamB,
      isFinished: Boolean(match.isFinished),
      matchDate: match.matchDate ?? null,
      matchTime: match.matchTime ?? null,
      hasStarted: matchHasStarted(match),
    });
  } catch (e) {
    console.error("GET /api/n8n/current-match", e);
    res.status(500).json({ erro: "Erro ao carregar jogo do dia." });
  }
});

app.get("/api/n8n/participants", n8nMiddleware, async (req, res) => {
  try {
    const participants = await query(
      `SELECT name, whatsapp FROM bolao_participants WHERE whatsapp IS NOT NULL AND whatsapp != '' ORDER BY name`
    );

    const matchId = req.query.matchId ? Number(req.query.matchId) : null;
    let predicted = new Set();
    if (matchId) {
      const predictions = await query(
        `SELECT participant FROM bolao_predictions WHERE "matchId" = $1`,
        [matchId]
      );
      predicted = new Set(predictions.map(p => p.participant));
    }

    res.json({
      participants: participants.map(p => ({
        name: p.name,
        whatsapp: p.whatsapp,
        ...(matchId ? { hasPrediction: predicted.has(p.name) } : {}),
      })),
    });
  } catch (e) {
    console.error("GET /api/n8n/participants", e);
    res.status(500).json({ erro: "Erro ao carregar participantes." });
  }
});

app.post("/api/n8n/predictions", n8nMiddleware, async (req, res) => {
  try {
    const { whatsapp, scoreA, scoreB, matchId } = req.body || {};

    const phone = normalizePhone(whatsapp);
    if (!phone) {
      return res.status(400).json({ erro: "Informe o número de WhatsApp." });
    }

    const participant = await queryOne(`SELECT * FROM bolao_participants WHERE whatsapp = $1`, [phone]);
    if (!participant) {
      return res.status(404).json({ erro: "Participante não encontrado para esse WhatsApp." });
    }

    let targetMatchId = matchId != null ? Number(matchId) : null;
    if (!targetMatchId) {
      const setting = await queryOne(`SELECT value FROM bolao_settings WHERE key = 'selectedMatchId'`);
      targetMatchId = setting?.value ? Number(setting.value) : null;
    }
    if (!targetMatchId) {
      return res.status(400).json({ erro: "Nenhum jogo selecionado no momento." });
    }

    const match = await queryOne(`SELECT * FROM bolao_matches WHERE id = $1`, [targetMatchId]);
    if (!match) {
      return res.status(404).json({ erro: "Jogo não encontrado." });
    }
    if (match.isFinished) {
      return res.status(409).json({ erro: "Esse jogo já foi encerrado." });
    }
    if (matchHasStarted(match)) {
      return res.status(409).json({ erro: "Esse jogo já começou. Não é mais possível enviar palpites." });
    }

    const placarA = Number(scoreA);
    const placarB = Number(scoreB);
    if (!Number.isInteger(placarA) || !Number.isInteger(placarB) || placarA < 0 || placarA > 99 || placarB < 0 || placarB > 99) {
      return res.status(400).json({ erro: "Placar inválido. Use números inteiros entre 0 e 99." });
    }

    await query(
      `INSERT INTO bolao_predictions ("matchId", participant, "scoreA", "scoreB")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("matchId", participant) DO UPDATE SET
         "scoreA" = EXCLUDED."scoreA",
         "scoreB" = EXCLUDED."scoreB"`,
      [match.id, participant.name, placarA, placarB]
    );

    res.json({
      ok: true,
      participant: participant.name,
      match: { teamA: match.teamA, teamB: match.teamB, group: match.group },
      prediction: { scoreA: placarA, scoreB: placarB },
    });
  } catch (e) {
    console.error("POST /api/n8n/predictions", e);
    res.status(500).json({ erro: "Erro ao salvar palpite." });
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
    matchDate: m.matchDate ?? null,
    matchTime: m.matchTime ?? null,
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
