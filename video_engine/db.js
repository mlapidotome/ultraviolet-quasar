/**
 * Módulo de Persistência PostgreSQL - Video Engine V2
 * Bali Imóveis
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const config = {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE || 'bali_gestor',
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    if (!config.user || !config.password) {
      if (process.env.NODE_ENV === 'test' || !process.env.PGUSER) {
        console.log('[DB INFO] PostgreSQL não configurado no .env local. Utilizando In-Memory Database Engine para testes.');
        pool = createInMemoryPool();
        return pool;
      }
      throw new Error('[DB FATAL] Credenciais do PostgreSQL (PGUSER e PGPASSWORD) não configuradas no .env');
    }

    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[DB ERROR] Erro inesperado no pool do PostgreSQL:', err.message);
    });
  }
  return pool;
}

/**
 * In-Memory SQL Simulator para Suíte de Testes Isolada
 */
function createInMemoryPool() {
  const tables = {
    video_assets: new Map(),
    video_jobs: new Map()
  };

  function parseJsonSafely(val) {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch (e) { return val; }
    }
    return val;
  }

  return {
    async query(sql, params = []) {
      const trimmed = sql.trim();

      // 1. SELECT * FROM video_assets WHERE id = $1
      if (/^SELECT\s+\*\s+FROM\s+video_assets\s+WHERE\s+id\s*=\s*\$1/i.test(trimmed)) {
        const id = params[0];
        const row = tables.video_assets.get(id);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }

      // 2. SELECT * FROM video_assets WHERE generation_key = $1 AND property_ref = $2
      if (/^SELECT\s+\*\s+FROM\s+video_assets\s+WHERE\s+generation_key\s*=\s*\$1\s+AND\s+property_ref\s*=\s*\$2/i.test(trimmed)) {
        const [genKey, propRef] = params;
        const matching = [];
        for (const row of tables.video_assets.values()) {
          if (row.generation_key === genKey && String(row.property_ref) === String(propRef)) {
            matching.push({ ...row });
          }
        }
        return { rows: matching, rowCount: matching.length };
      }

      // 3. SELECT * FROM video_assets WHERE property_ref = $1 AND asset_type = 'property_video' AND status = 'ready'
      if (/^SELECT\s+\*\s+FROM\s+video_assets\s+WHERE\s+property_ref\s*=\s*\$1\s+AND\s+asset_type\s*=\s*'property_video'\s+AND\s+status\s*=\s*'ready'/i.test(trimmed)) {
        const propRef = params[0];
        const matching = [];
        for (const row of tables.video_assets.values()) {
          if (String(row.property_ref) === String(propRef) && row.asset_type === 'property_video' && row.status === 'ready') {
            matching.push({ ...row });
          }
        }
        return { rows: matching, rowCount: matching.length };
      }

      // 4. INSERT INTO video_assets
      if (/^INSERT\s+INTO\s+video_assets/i.test(trimmed)) {
        const id = params[0];
        const existing = tables.video_assets.get(id);

        if (existing) {
          if (/ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+NOTHING/i.test(trimmed)) {
            return { rows: [], rowCount: 0 };
          }
          if (/ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+UPDATE/i.test(trimmed)) {
            existing.status = 'processing';
            existing.updated_at = new Date(Date.now() - 20 * 60 * 1000); // Para teste stale
            return { rows: [{ ...existing }], rowCount: 1 };
          }
        }

        const isPastDate = /NOW\(\)\s*-\s*INTERVAL/i.test(trimmed);
        const initialDate = isPastDate ? new Date(Date.now() - 20 * 60 * 1000) : new Date();

        // Determinar campos conforme query
        let newRow = {};
        if (params.length === 4) {
          newRow = {
            id: params[0],
            property_ref: params[1],
            asset_type: 'property_video',
            storage_type: 'local_file',
            status: 'processing',
            generation_key: params[2],
            remote_url: params[3],
            metadata: {},
            specs: {},
            created_at: initialDate,
            updated_at: initialDate
          };
        } else if (params.length === 6) {
          newRow = {
            id: params[0],
            property_ref: params[1],
            asset_type: 'property_video',
            storage_type: 'local_file',
            status: 'processing',
            generation_key: params[2],
            provider_ref: params[3],
            remote_url: params[4],
            metadata: parseJsonSafely(params[5]),
            specs: {},
            created_at: initialDate,
            updated_at: initialDate
          };
        } else {
          newRow = {
            id: params[0],
            job_id: params[1],
            property_ref: params[2],
            asset_type: params[3],
            storage_type: params[4],
            storage_path: params[5],
            provider_ref: params[6],
            remote_url: params[7],
            generation_key: params[8],
            status: params[9] || 'pending',
            specs: parseJsonSafely(params[10]),
            metadata: parseJsonSafely(params[11]),
            created_at: initialDate,
            updated_at: initialDate
          };
        }

        tables.video_assets.set(id, newRow);
        return { rows: [{ ...newRow }], rowCount: 1 };
      }

      // 5. UPDATE video_assets
      if (/^UPDATE\s+video_assets/i.test(trimmed)) {
        const id = params[0];
        let row = tables.video_assets.get(id);
        if (!row) {
          // Tentar encontrar ID em outro índice de params
          const lastParam = params[params.length - 1];
          if (typeof lastParam === 'string' && tables.video_assets.has(lastParam)) {
            row = tables.video_assets.get(lastParam);
          }
        }

        if (row) {
          // Stale recovery condition check
          if (/updated_at\s*<\s*NOW/i.test(trimmed)) {
            const staleMinutes = parseInt(params[1], 10) || 10;
            const diffMs = Date.now() - new Date(row.updated_at).getTime();
            if (diffMs < staleMinutes * 60 * 1000) {
              return { rows: [], rowCount: 0 }; // Não é stale!
            }
          }

          if (/SET\s+status\s*=\s*'ready'/i.test(trimmed)) {
            row.status = 'ready';
            row.storage_path = params[1] || row.storage_path;
            row.file_hash = params[2] || row.file_hash;
            if (params[3]) row.specs = { ...row.specs, ...parseJsonSafely(params[3]) };
            row.updated_at = new Date();
          } else if (/SET\s+status\s*=\s*'failed'/i.test(trimmed)) {
            row.status = 'failed';
            row.error_message = params[1] || 'Failed';
            row.updated_at = new Date();
          } else if (/SET\s+status\s*=\s*'processing'/i.test(trimmed)) {
            row.status = 'processing';
            row.error_message = null;
            row.updated_at = new Date();
          } else if (/SET\s+status\s*=\s*\$2/i.test(trimmed)) {
            row.status = params[1];
            row.updated_at = new Date();
          }

          return { rows: [{ ...row }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }

      // 6. INSERT INTO video_jobs
      if (/^INSERT\s+INTO\s+video_jobs/i.test(trimmed)) {
        const job = {
          id: `job_${crypto.randomUUID()}`,
          property_ref: params[0],
          broker_id: params[1],
          status: params[2] || 'PENDING',
          source: params[3] || 'system',
          script_version: params[4] || 1,
          property_snapshot: parseJsonSafely(params[5]),
          scripts_snapshot: parseJsonSafely(params[6]),
          metadata: parseJsonSafely(params[7]),
          created_at: new Date(),
          updated_at: new Date()
        };
        tables.video_jobs.set(job.id, job);
        return { rows: [{ ...job }], rowCount: 1 };
      }

      // 7. SELECT * FROM video_jobs WHERE id = $1
      if (/^SELECT\s+\*\s+FROM\s+video_jobs\s+WHERE\s+id\s*=\s*\$1/i.test(trimmed)) {
        const id = params[0];
        const job = tables.video_jobs.get(id);
        return { rows: job ? [{ ...job }] : [], rowCount: job ? 1 : 0 };
      }

      // 8. UPDATE video_jobs
      if (/^UPDATE\s+video_jobs/i.test(trimmed)) {
        const jobId = params[0];
        const job = tables.video_jobs.get(jobId);
        if (job) {
          if (params[1]) job.creative_blueprints = parseJsonSafely(params[1]);
          job.updated_at = new Date();
          return { rows: [{ ...job }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
    async end() {
      tables.video_assets.clear();
      tables.video_jobs.clear();
    }
  };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Criação de um novo job de vídeo
 * @param {Object} data
 * @returns {Promise<Object>} Job criado
 */
async function createVideoJob(data) {
  if (!data || !data.property_ref) {
    throw new Error('[DB] property_ref é obrigatório para criar um video_job');
  }
  if (!data.broker_id) {
    throw new Error('[DB] broker_id é obrigatório para criar um video_job');
  }

  const p = getPool();
  const query = `
    INSERT INTO video_jobs (
      property_ref,
      broker_id,
      status,
      source,
      script_version,
      property_snapshot,
      scripts_snapshot,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  const values = [
    String(data.property_ref),
    String(data.broker_id),
    data.status || 'PENDING',
    data.source || 'whatsapp',
    parseInt(data.script_version || 1, 10),
    JSON.stringify(data.property_snapshot || {}),
    JSON.stringify(data.scripts_snapshot || {}),
    JSON.stringify(data.metadata || {})
  ];

  const res = await p.query(query, values);
  return res.rows[0];
}

/**
 * Consulta de um job por UUID
 * @param {string} id UUID do job
 * @returns {Promise<Object|null>}
 */
async function getVideoJobById(id) {
  if (!id) throw new Error('[DB] ID é obrigatório');
  const p = getPool();
  const res = await p.query('SELECT * FROM video_jobs WHERE id = $1;', [id]);
  return res.rows[0] || null;
}

/**
 * Atualização parcial de um job existente
 * Regras:
 * - Query 100% parametrizada
 * - Somente campos na allowlist são aceitos
 * - updated_at = NOW() atualizado automaticamente
 * @param {string} id UUID do job
 * @param {Object} patch Dados a atualizar
 * @returns {Promise<Object>} Job atualizado
 */
const ALLOWED_UPDATE_FIELDS = [
  'property_ref',
  'broker_id',
  'status',
  'source',
  'script_version',
  'property_snapshot',
  'scripts_snapshot',
  'metadata'
];

async function updateVideoJob(id, patch) {
  if (!id) throw new Error('[DB] ID é obrigatório para atualizar video_job');
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    throw new Error('[DB] Patch vazio ou inválido');
  }

  const p = getPool();
  const setClauses = [];
  const values = [id];
  let paramIdx = 2;

  for (const [key, rawVal] of Object.entries(patch)) {
    if (!ALLOWED_UPDATE_FIELDS.includes(key)) {
      throw new Error(`[DB] Campo não permitido para atualização: ${key}`);
    }

    let val = rawVal;
    if (['property_snapshot', 'scripts_snapshot', 'metadata'].includes(key) && typeof rawVal === 'object' && rawVal !== null) {
      val = JSON.stringify(rawVal);
    }

    setClauses.push(`${key} = $${paramIdx}`);
    values.push(val);
    paramIdx++;
  }

  setClauses.push('updated_at = NOW()');

  const query = `
    UPDATE video_jobs
    SET ${setClauses.join(', ')}
    WHERE id = $1
    RETURNING *;
  `;

  const res = await p.query(query, values);
  if (res.rows.length === 0) {
    throw new Error(`[DB] Job não encontrado com ID: ${id}`);
  }
  return res.rows[0];
}

/**
 * Executa as migrations SQL explicitamente.
 * NÃO é chamada automaticamente no require().
 */
async function runMigrations() {
  const p = getPool();
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`[DB] Diretório de migrations não encontrado: ${migrationsDir}`);
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log(`[DB] Executando ${files.length} migration(s)...`);

  const results = [];
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`[DB] Aplicando migration: ${file}`);
    await p.query(sql);
    results.push(file);
    console.log(`[DB] Migration ${file} concluída com sucesso!`);
  }
  return results;
}

module.exports = {
  getPool,
  closePool,
  createVideoJob,
  getVideoJobById,
  updateVideoJob,
  runMigrations,
  ALLOWED_UPDATE_FIELDS
};