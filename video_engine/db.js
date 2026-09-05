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
      throw new Error('[DB FATAL] Credenciais do PostgreSQL (PGUSER e PGPASSWORD) não configuradas no .env');
    }

    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[DB ERROR] Erro inesperado no pool do PostgreSQL:', err.message);
    });
  }
  return pool;
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