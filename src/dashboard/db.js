const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function getDb() {
  return pool;
}

async function initTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Tabela de Usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'gerente')),
        nome TEXT NOT NULL,
        criado_em TEXT NOT NULL
      );
    `);

    // 2. Tabela de Sessões (Sessões HttpOnly persistentes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        criado_em TEXT NOT NULL,
        expira_em TEXT NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_expira ON sessions(expira_em);`);

    // 3. Tabela de Acompanhamentos (Pautas, Notas, Combinados, Próxima Ação)
    await client.query(`
      CREATE TABLE IF NOT EXISTS acompanhamentos (
        key TEXT PRIMARY KEY,
        lead_id INTEGER NOT NULL,
        funil_id INTEGER NOT NULL,
        na_pauta INTEGER DEFAULT 0,
        status_pauta TEXT DEFAULT NULL,
        dispensado_em TEXT DEFAULT NULL,
        resumo TEXT DEFAULT '',
        proxima_acao TEXT DEFAULT '',
        previsao TEXT DEFAULT '',
        situacao TEXT DEFAULT 'Não informado',
        data_reuniao TEXT DEFAULT NULL,
        autor TEXT DEFAULT 'Sistema',
        encaminhamento_pauta TEXT DEFAULT NULL,
        salvo_em TEXT DEFAULT NULL,
        alterado_por TEXT DEFAULT 'Sistema',
        alterado_em TEXT DEFAULT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acomp_lead_funil ON acompanhamentos(lead_id, funil_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acomp_na_pauta ON acompanhamentos(na_pauta);`);

    // 4. Tabela de Histórico de Acompanhamentos
    await client.query(`
      CREATE TABLE IF NOT EXISTS acompanhamentos_historico (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL,
        lead_id INTEGER NOT NULL,
        funil_id INTEGER NOT NULL,
        resumo TEXT DEFAULT '',
        proxima_acao TEXT DEFAULT '',
        previsao TEXT DEFAULT '',
        situacao TEXT DEFAULT '',
        data_reuniao TEXT DEFAULT '',
        autor TEXT DEFAULT '',
        encaminhamento_pauta TEXT DEFAULT NULL,
        salvo_em TEXT DEFAULT '',
        registrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_acomp_hist_key ON acompanhamentos_historico(key);`);

    // 5. Tabela de Resumos de Reuniões Semanais 1:1
    await client.query(`
      CREATE TABLE IF NOT EXISTS reunioes_resumos (
        key TEXT PRIMARY KEY,
        corretor TEXT NOT NULL,
        data_reuniao TEXT NOT NULL,
        texto TEXT NOT NULL,
        salvo_em TEXT NOT NULL,
        alterado_por TEXT DEFAULT 'Sistema',
        alterado_em TEXT DEFAULT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_resumos_corretor_data ON reunioes_resumos(corretor, data_reuniao);`);

    // 6. Tabela de Metadados de Migração
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_meta (
        key TEXT PRIMARY KEY,
        executado_em TEXT NOT NULL
      );
    `);

    // 7. KV Store
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB,
        updated_at TIMESTAMP
      );
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// KV Store functions
async function getKv(key) {
  const result = await pool.query(`SELECT value FROM kv_store WHERE key = $1`, [key]);
  if (result.rows.length > 0) {
    return result.rows[0].value;
  }
  return null;
}

async function setKv(key, value) {
  const now = new Date();
  await pool.query(`
    INSERT INTO kv_store (key, value, updated_at) 
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `, [key, JSON.stringify(value), now]);
}

// Helpers de Criptografia e Senhas
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  try {
    const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(checkHash, 'hex'));
  } catch {
    return false;
  }
}

// Inicialização de Usuários Padrão
async function initUsers() {
  const result = await pool.query(`SELECT COUNT(*) as total FROM users`);
  const count = parseInt(result.rows[0].total, 10);
  if (count === 0) {
    const adminPass = process.env.ADMIN_PASSWORD || 'BaliAdmin@2026';
    const gerentePass = process.env.GERENTE_PASSWORD || 'BaliGerente@2026';

    const adminHash = hashPassword(adminPass);
    const gerenteHash = hashPassword(gerentePass);
    const now = new Date().toISOString();

    const insert = `
      INSERT INTO users (username, password_hash, salt, role, nome, criado_em)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await pool.query(insert, ['admin', adminHash.hash, adminHash.salt, 'admin', 'Administrador Bali', now]);
    await pool.query(insert, ['gerente', gerenteHash.hash, gerenteHash.salt, 'gerente', 'Gerente Comercial', now]);
    console.log('[PostgreSQL Auth] Usuários padrão "admin" e "gerente" inicializados com sucesso.');
  }
}

// Autenticação e Sessões
async function authenticateUser(username, password) {
  const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  const user = result.rows[0];
  if (!user) return null;
  const valid = verifyPassword(password, user.password_hash, user.salt);
  if (!valid) return null;
  return { id: user.id, username: user.username, role: user.role, nome: user.nome };
}

async function createSession(userId, username, role, ttlHours = 12) {
  await cleanExpiredSessions();
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const criado_em = now.toISOString();
  const expiraDate = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const expira_em = expiraDate.toISOString();

  await pool.query(`
    INSERT INTO sessions (id, user_id, username, role, criado_em, expira_em)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [sessionId, userId, username, role, criado_em, expira_em]);

  return { sessionId, expiraDate };
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  const now = new Date().toISOString();
  const result = await pool.query(`
    SELECT * FROM sessions WHERE id = $1 AND expira_em > $2
  `, [sessionId, now]);
  return result.rows[0] || null;
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

async function cleanExpiredSessions() {
  const now = new Date().toISOString();
  await pool.query(`DELETE FROM sessions WHERE expira_em <= $1`, [now]);
}

// Migração Idempotente de JSON para PostgreSQL
async function migrateJsonData() {
  const acompFile = path.join(__dirname, '..', '..', 'data', 'reunioes_acompanhamento.json');
  const resumosFile = path.join(__dirname, '..', '..', 'data', 'reunioes_resumos.json');

  let migratedAcompanhamentos = 0;
  let migratedHistorico = 0;
  let migratedResumos = 0;

  const metaCheck = await pool.query(`SELECT * FROM migration_meta WHERE key = 'reunioes_json_v1'`);
  if (metaCheck.rows.length > 0) {
    return {
      alreadyMigrated: true,
      executado_em: metaCheck.rows[0].executado_em
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Migrar acompanhamentos
    if (fs.existsSync(acompFile)) {
      const rawData = JSON.parse(fs.readFileSync(acompFile, 'utf8'));
      const keys = Object.keys(rawData);

      const upsertAcomp = `
        INSERT INTO acompanhamentos (
          key, lead_id, funil_id, na_pauta, status_pauta, dispensado_em,
          resumo, proxima_acao, previsao, situacao, data_reuniao,
          autor, encaminhamento_pauta, salvo_em, alterado_por, alterado_em
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        ) ON CONFLICT(key) DO UPDATE SET
          na_pauta = EXCLUDED.na_pauta,
          status_pauta = EXCLUDED.status_pauta,
          dispensado_em = EXCLUDED.dispensado_em,
          resumo = EXCLUDED.resumo,
          proxima_acao = EXCLUDED.proxima_acao,
          previsao = EXCLUDED.previsao,
          situacao = EXCLUDED.situacao,
          data_reuniao = EXCLUDED.data_reuniao,
          autor = EXCLUDED.autor,
          encaminhamento_pauta = EXCLUDED.encaminhamento_pauta,
          salvo_em = EXCLUDED.salvo_em
      `;

      const insertHist = `
        INSERT INTO acompanhamentos_historico (
          key, lead_id, funil_id, resumo, proxima_acao, previsao,
          situacao, data_reuniao, autor, encaminhamento_pauta, salvo_em
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11
        )
      `;

      for (const k of keys) {
        const item = rawData[k];
        const parts = k.split('_');
        const leadId = parseInt(parts[0], 10);
        const funilId = parseInt(parts[1], 10);

        const atual = item.atual || {};
        await client.query(upsertAcomp, [
          k,
          leadId,
          funilId,
          item.na_pauta ? 1 : 0,
          item.status_pauta || null,
          item.dispensado_em || null,
          atual.resumo || '',
          atual.proxima_acao || '',
          atual.previsao || '',
          atual.situacao || 'Não informado',
          atual.data_reuniao || null,
          atual.autor || 'Ambiente Local',
          atual.encaminhamento_pauta || null,
          atual.salvo_em || null,
          'Migração Inicial',
          new Date().toISOString()
        ]);
        migratedAcompanhamentos++;

        if (Array.isArray(item.historico)) {
          for (const h of item.historico) {
            await client.query(insertHist, [
              k,
              leadId,
              funilId,
              h.resumo || '',
              h.proxima_acao || '',
              h.previsao || '',
              h.situacao || '',
              h.data_reuniao || '',
              h.autor || 'Ambiente Local',
              h.encaminhamento_pauta || null,
              h.salvo_em || ''
            ]);
            migratedHistorico++;
          }
        }
      }
    }

    // 2. Migrar resumos
    if (fs.existsSync(resumosFile)) {
      const rawResumos = JSON.parse(fs.readFileSync(resumosFile, 'utf8'));
      const upsertResumo = `
        INSERT INTO reunioes_resumos (key, corretor, data_reuniao, texto, salvo_em, alterado_por, alterado_em)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(key) DO UPDATE SET
          texto = EXCLUDED.texto,
          salvo_em = EXCLUDED.salvo_em
      `;

      for (const k of Object.keys(rawResumos)) {
        const item = rawResumos[k];
        await client.query(upsertResumo, [
          k,
          item.corretor,
          item.data_reuniao,
          item.texto || '',
          item.salvo_em || new Date().toISOString(),
          'Migração Inicial',
          new Date().toISOString()
        ]);
        migratedResumos++;
      }
    }

    await client.query(`
      INSERT INTO migration_meta (key, executado_em) VALUES ('reunioes_json_v1', $1)
    `, [new Date().toISOString()]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    alreadyMigrated: false,
    migratedAcompanhamentos,
    migratedHistorico,
    migratedResumos
  };
}

// Operações de Leitura & Escrita 100% Compatíveis

async function getAcompanhamentosMap() {
  const rowsResult = await pool.query(`SELECT * FROM acompanhamentos`);
  const histRowsResult = await pool.query(`SELECT * FROM acompanhamentos_historico ORDER BY id ASC`);
  
  const rows = rowsResult.rows;
  const histRows = histRowsResult.rows;

  const historyMap = {};
  for (const h of histRows) {
    if (!historyMap[h.key]) historyMap[h.key] = [];
    historyMap[h.key].push({
      resumo: h.resumo,
      proxima_acao: h.proxima_acao,
      previsao: h.previsao,
      situacao: h.situacao,
      data_reuniao: h.data_reuniao,
      autor: h.autor,
      encaminhamento_pauta: h.encaminhamento_pauta,
      salvo_em: h.salvo_em
    });
  }

  const result = {};
  for (const r of rows) {
    result[r.key] = {
      na_pauta: r.na_pauta === 1,
      status_pauta: r.status_pauta,
      dispensado_em: r.dispensado_em,
      alterado_por: r.alterado_por,
      alterado_em: r.alterado_em,
      atual: r.salvo_em ? {
        resumo: r.resumo,
        proxima_acao: r.proxima_acao,
        previsao: r.previsao,
        situacao: r.situacao,
        data_reuniao: r.data_reuniao,
        autor: r.autor,
        salvo_em: r.salvo_em,
        encaminhamento_pauta: r.encaminhamento_pauta,
        alterado_por: r.alterado_por,
        alterado_em: r.alterado_em
      } : null,
      historico: historyMap[r.key] || []
    };
  }

  return result;
}

async function saveAcompanhamento(leadId, funilId, payload, username = 'Sistema') {
  const key = `${leadId}_${funilId}`;
  const now = new Date().toISOString();

  const { resumo, proxima_acao, previsao, situacao, data_reuniao, encaminhamento_pauta } = payload;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Busca registro atual
    const existingResult = await client.query(`SELECT * FROM acompanhamentos WHERE key = $1`, [key]);
    const existing = existingResult.rows[0];

    // 2. Se existia nota anterior com salvo_em, arquiva no histórico
    if (existing && existing.salvo_em) {
      await client.query(`
        INSERT INTO acompanhamentos_historico (
          key, lead_id, funil_id, resumo, proxima_acao, previsao,
          situacao, data_reuniao, autor, encaminhamento_pauta, salvo_em
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        key,
        leadId,
        funilId,
        existing.resumo,
        existing.proxima_acao,
        existing.previsao,
        existing.situacao,
        existing.data_reuniao,
        existing.autor,
        existing.encaminhamento_pauta,
        existing.salvo_em
      ]);
    }

    let naPauta = existing ? existing.na_pauta : 0;
    let statusPauta = existing ? existing.status_pauta : null;
    let dispensadoEm = existing ? existing.dispensado_em : null;

    if (encaminhamento_pauta === 'dispensar') {
      naPauta = 0;
      statusPauta = 'dispensado';
      dispensadoEm = data_reuniao || now.split('T')[0];
    } else if (encaminhamento_pauta === 'manter') {
      naPauta = 1;
      statusPauta = 'manter';
      dispensadoEm = null;
    }

    const currentAuthor = username;

    await client.query(`
      INSERT INTO acompanhamentos (
        key, lead_id, funil_id, na_pauta, status_pauta, dispensado_em,
        resumo, proxima_acao, previsao, situacao, data_reuniao,
        autor, encaminhamento_pauta, salvo_em, alterado_por, alterado_em
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16
      ) ON CONFLICT(key) DO UPDATE SET
        na_pauta = EXCLUDED.na_pauta,
        status_pauta = EXCLUDED.status_pauta,
        dispensado_em = EXCLUDED.dispensado_em,
        resumo = EXCLUDED.resumo,
        proxima_acao = EXCLUDED.proxima_acao,
        previsao = EXCLUDED.previsao,
        situacao = EXCLUDED.situacao,
        data_reuniao = EXCLUDED.data_reuniao,
        autor = EXCLUDED.autor,
        encaminhamento_pauta = EXCLUDED.encaminhamento_pauta,
        salvo_em = EXCLUDED.salvo_em,
        alterado_por = EXCLUDED.alterado_por,
        alterado_em = EXCLUDED.alterado_em
    `, [
      key,
      leadId,
      funilId,
      naPauta,
      statusPauta,
      dispensadoEm,
      resumo || '',
      proxima_acao || '',
      previsao || '',
      situacao || 'Não informado',
      data_reuniao || now.split('T')[0],
      currentAuthor,
      encaminhamento_pauta || null,
      now,
      username,
      now
    ]);

    await client.query('COMMIT');

    return {
      key,
      resumo: resumo || '',
      proxima_acao: proxima_acao || '',
      previsao: previsao || '',
      situacao: situacao || 'Não informado',
      data_reuniao: data_reuniao || now.split('T')[0],
      autor: currentAuthor,
      salvo_em: now,
      na_pauta: naPauta === 1,
      status_pauta: statusPauta,
      dispensado_em: dispensadoEm,
      alterado_por: username,
      alterado_em: now
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function togglePauta(leadId, funilId, checked, username = 'Sistema') {
  const key = `${leadId}_${funilId}`;
  const now = new Date().toISOString();

  const naPauta = checked ? 1 : 0;
  const statusPauta = checked ? 'manter' : null;
  const dispensadoEm = null;

  await pool.query(`
    INSERT INTO acompanhamentos (
      key, lead_id, funil_id, na_pauta, status_pauta, dispensado_em, alterado_por, alterado_em
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(key) DO UPDATE SET
      na_pauta = EXCLUDED.na_pauta,
      status_pauta = CASE WHEN EXCLUDED.na_pauta = 1 THEN 'manter' ELSE acompanhamentos.status_pauta END,
      dispensado_em = CASE WHEN EXCLUDED.na_pauta = 1 THEN NULL ELSE acompanhamentos.dispensado_em END,
      alterado_por = EXCLUDED.alterado_por,
      alterado_em = EXCLUDED.alterado_em
  `, [key, leadId, funilId, naPauta, statusPauta, dispensadoEm, username, now]);

  const updatedResult = await pool.query(`SELECT na_pauta, status_pauta FROM acompanhamentos WHERE key = $1`, [key]);
  const updated = updatedResult.rows[0];
  return {
    success: true,
    na_pauta: updated.na_pauta === 1,
    status_pauta: updated.status_pauta,
    alterado_por: username
  };
}

async function toggleBulkPauta(items, checked, username = 'Sistema') {
  const now = new Date().toISOString();
  const naPauta = checked ? 1 : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const stmt = `
      INSERT INTO acompanhamentos (
        key, lead_id, funil_id, na_pauta, status_pauta, dispensado_em, alterado_por, alterado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(key) DO UPDATE SET
        na_pauta = EXCLUDED.na_pauta,
        status_pauta = CASE WHEN EXCLUDED.na_pauta = 1 THEN 'manter' ELSE acompanhamentos.status_pauta END,
        dispensado_em = CASE WHEN EXCLUDED.na_pauta = 1 THEN NULL ELSE acompanhamentos.dispensado_em END,
        alterado_por = EXCLUDED.alterado_por,
        alterado_em = EXCLUDED.alterado_em
    `;

    for (const it of items) {
      const key = `${it.leadId}_${it.funilId}`;
      await client.query(stmt, [key, it.leadId, it.funilId, naPauta, checked ? 'manter' : null, null, username, now]);
    }
    
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  
  return { success: true, count: items.length, na_pauta: checked, alterado_por: username };
}

async function getResumosMap(corretor, data) {
  if (corretor && data) {
    const key = `${corretor}_${data}`;
    const rowResult = await pool.query(`SELECT * FROM reunioes_resumos WHERE key = $1`, [key]);
    const row = rowResult.rows[0];
    return row ? { corretor: row.corretor, data_reuniao: row.data_reuniao, texto: row.texto, salvo_em: row.salvo_em, alterado_por: row.alterado_por } : null;
  }

  const rowsResult = await pool.query(`SELECT * FROM reunioes_resumos`);
  const rows = rowsResult.rows;
  const map = {};
  for (const r of rows) {
    map[r.key] = {
      corretor: r.corretor,
      data_reuniao: r.data_reuniao,
      texto: r.texto,
      salvo_em: r.salvo_em,
      alterado_por: r.alterado_por,
      alterado_em: r.alterado_em
    };
  }
  return map;
}

async function saveResumo(corretor, dataReuniao, texto, overwrite = false, username = 'Sistema') {
  const key = `${corretor}_${dataReuniao}`;
  const now = new Date().toISOString();

  const existingResult = await pool.query(`SELECT * FROM reunioes_resumos WHERE key = $1`, [key]);
  const existing = existingResult.rows[0];
  if (existing && !overwrite) {
    return { exists: true, message: "Já existe um resumo salvo para este corretor nesta data." };
  }

  await pool.query(`
    INSERT INTO reunioes_resumos (key, corretor, data_reuniao, texto, salvo_em, alterado_por, alterado_em)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT(key) DO UPDATE SET
      texto = EXCLUDED.texto,
      salvo_em = EXCLUDED.salvo_em,
      alterado_por = EXCLUDED.alterado_por,
      alterado_em = EXCLUDED.alterado_em
  `, [key, corretor, dataReuniao, texto || '', now, username, now]);

  return {
    success: true,
    resumo: { corretor, data_reuniao: dataReuniao, texto: texto || '', salvo_em: now, alterado_por: username }
  };
}

module.exports = {
  getDb,
  initTables,
  initUsers,
  authenticateUser,
  createSession,
  getSession,
  deleteSession,
  cleanExpiredSessions,
  migrateJsonData,
  getAcompanhamentosMap,
  saveAcompanhamento,
  togglePauta,
  toggleBulkPauta,
  getResumosMap,
  saveResumo,
  getKv,
  setKv
};
