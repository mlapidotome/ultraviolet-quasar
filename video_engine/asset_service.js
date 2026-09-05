/**
 * Módulo de Catálogo de Assets & Creative Blueprints — Video Engine V2
 * Bali Imóveis (Fase 3A)
 * 
 * Responsabilidades:
 * 1. Identidade semântica determinística (generation_key)
 * 2. Hashing físico de bytes (file_hash via SHA-256)
 * 3. Catálogo de assets em video_assets (lifecycle: pending -> processing -> remote_ready -> ready -> failed)
 * 4. Resolução e validação de integridade física e anti-tampering
 * 5. Geração e persistência de Creative Blueprints declarativos em video_jobs.creative_blueprints
 * 6. Suporte estrito a fail-open para não-bloqueio do pipeline de renderização da Fase 2C
 * 7. Invariantes de imutabilidade (assets ready e blueprints publicados não são sobrescritos)
 * 
 * Regra: ZERO reuso cross-job automático nesta fase.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool } = require('./db');

const MARCEL_VOICE_CLONE_ID = process.env.MARCEL_VOICE_CLONE_ID || 'dccd1a85e6b1450facf9ec953b648df2';

/**
 * 1. Normalização e Geração de Chave Semântica Determinística (generation_key)
 * @param {Object} recipe
 * @returns {string} SHA-256 hex (64 chars)
 */
function computeGenerationKey(recipe = {}) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error('[ASSET_SERVICE] Recipe é obrigatória para calcular generation_key');
  }

  const normalizedText = (recipe.script_text || recipe.text || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  const canonicalObj = {
    asset_type: String(recipe.asset_type || '').toLowerCase().trim(),
    provider: String(recipe.provider || 'heygen').toLowerCase().trim(),
    provider_model: String(recipe.provider_model || 'avatar_v2').toLowerCase().trim(),
    script_text: normalizedText,
    look_id: String(recipe.look_id || recipe.look?.id || '').trim(),
    voice_id: String(recipe.voice_id || MARCEL_VOICE_CLONE_ID).trim(),
    output_format: {
      aspect_ratio: recipe.format?.aspect_ratio || '9:16',
      width: Number(recipe.format?.width || 1080),
      height: Number(recipe.format?.height || 1920),
      fps: Number(recipe.format?.fps || 30)
    },
    generation_params: recipe.params || {}
  };

  // Serialização determinística de chaves ordenadas
  const sortedString = JSON.stringify(canonicalObj, Object.keys(canonicalObj).sort());
  return crypto.createHash('sha256').update(sortedString, 'utf8').digest('hex');
}

/**
 * 2. Cálculo do Hash Físico dos Bytes (file_hash)
 * @param {string} filePath
 * @returns {string} SHA-256 hex (64 chars)
 */
function computeFileHash(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('[ASSET_SERVICE] filePath é obrigatório para calcular file_hash');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`[ASSET_SERVICE] Arquivo físico não encontrado para hashing: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * 3. Criar ou Obter Asset no Catálogo (video_assets)
 * Lifecycle inicial: pending / processing
 * storage_path pode ser NULL
 */
async function createAsset({
  id = null,
  job_id = null,
  property_ref = null,
  asset_type,
  storage_type = 'local_file',
  storage_path = null,
  provider_ref = null,
  remote_url = null,
  generation_key,
  status = 'pending',
  specs = {},
  metadata = {}
}) {
  if (!asset_type) {
    throw new Error('[ASSET_SERVICE] asset_type é obrigatório');
  }
  if (!generation_key) {
    throw new Error('[ASSET_SERVICE] generation_key é obrigatória');
  }

  const pool = getPool();
  const assetId = id || `ast_${asset_type.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)}_${crypto.randomBytes(8).toString('hex')}`;

  const query = `
    INSERT INTO video_assets (
      id, job_id, property_ref, asset_type, storage_type,
      storage_path, provider_ref, remote_url, file_hash,
      generation_key, status, specs, metadata, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, NULL,
      $9, $10, $11, $12, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      provider_ref = COALESCE(EXCLUDED.provider_ref, video_assets.provider_ref),
      remote_url = COALESCE(EXCLUDED.remote_url, video_assets.remote_url),
      metadata = video_assets.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    assetId,
    job_id,
    property_ref ? String(property_ref) : null,
    asset_type,
    storage_type,
    storage_path,
    provider_ref,
    remote_url,
    generation_key,
    status,
    JSON.stringify(specs || {}),
    JSON.stringify(metadata || {})
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
}

/**
 * 4. Marcar Asset como READY com Validação de Imutabilidade
 * Exige existência física do arquivo local e calcula file_hash
 */
async function markAssetReady(assetId, {
  localPath,
  specs = {},
  fileHash = null,
  metadata = {}
}) {
  if (!assetId) throw new Error('[ASSET_SERVICE] assetId é obrigatório');
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`[ASSET_SERVICE] Arquivo local inexistente para markAssetReady: ${localPath}`);
  }

  const pool = getPool();
  const existingRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId]);
  if (existingRes.rows.length === 0) {
    throw new Error(`[ASSET_SERVICE] Asset não encontrado: ${assetId}`);
  }

  const existing = existingRes.rows[0];
  const calculatedFileHash = fileHash || computeFileHash(localPath);

  // Invariante de Imutabilidade: Se já estiver READY, não permite sobrescrever com bytes divergentes
  if (existing.status === 'ready') {
    if (existing.file_hash && existing.file_hash !== calculatedFileHash) {
      throw new Error(`[ASSET_SERVICE IMMUTABILITY ERROR] Asset ${assetId} já está READY com hash ${existing.file_hash} e não pode ser sobrescrito com hash ${calculatedFileHash}`);
    }
    // Idempotência limpa se for o mesmo arquivo
    return existing;
  }

  const query = `
    UPDATE video_assets
    SET status = 'ready',
        storage_path = $2,
        file_hash = $3,
        specs = CASE WHEN $4::jsonb = '{}'::jsonb THEN video_assets.specs ELSE video_assets.specs || $4::jsonb END,
        metadata = video_assets.metadata || $5::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const res = await pool.query(query, [
    assetId,
    localPath,
    calculatedFileHash,
    JSON.stringify(specs || {}),
    JSON.stringify(metadata || {})
  ]);

  return res.rows[0];
}

/**
 * 5. Marcar Asset como FAILED
 */
async function markAssetFailed(assetId, errorMessage) {
  if (!assetId) return null;
  const pool = getPool();
  const query = `
    UPDATE video_assets
    SET status = 'failed',
        error_message = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;
  const res = await pool.query(query, [assetId, String(errorMessage)]);
  return res.rows[0] || null;
}

/**
 * 6. Obter Asset por ID
 */
async function getAssetById(assetId) {
  if (!assetId) return null;
  const pool = getPool();
  const res = await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId]);
  return res.rows[0] || null;
}

/**
 * 7. Resolução e Validação de Integridade Física (Asset Resolver)
 */
async function resolveAndValidateAsset(assetId, { checkFile = true, checkHash = true } = {}) {
  const asset = await getAssetById(assetId);
  if (!asset) {
    throw new Error(`[ASSET_RESOLVER] Asset ${assetId} não encontrado no catálogo`);
  }

  if (asset.status !== 'ready') {
    throw new Error(`[ASSET_RESOLVER] Asset ${assetId} não está pronto (status atual: ${asset.status})`);
  }

  if (checkFile) {
    if (!asset.storage_path) {
      throw new Error(`[ASSET_RESOLVER] Asset ${assetId} possui status ready mas storage_path é NULL`);
    }

    if (!fs.existsSync(asset.storage_path)) {
      throw new Error(`[ASSET_RESOLVER] Arquivo físico do asset ${assetId} ausente no disco: ${asset.storage_path}`);
    }

    const stats = fs.statSync(asset.storage_path);
    if (stats.size === 0) {
      throw new Error(`[ASSET_RESOLVER] Arquivo físico do asset ${assetId} tem 0 bytes: ${asset.storage_path}`);
    }

    // Validação de contenção real contra symlink
    const realPhysicalPath = fs.realpathSync(asset.storage_path);
    if (path.resolve(realPhysicalPath) !== path.resolve(asset.storage_path)) {
      // Se for symlink para fora ou nome divergente
      throw new Error(`[ASSET_RESOLVER] Inconsistência de symlink ou caminho físico para asset ${assetId}`);
    }

    if (checkHash && asset.file_hash) {
      const currentHash = computeFileHash(realPhysicalPath);
      if (currentHash !== asset.file_hash) {
        throw new Error(`[ASSET_RESOLVER TAMPERING ERROR] Divergência de file_hash para asset ${assetId}: esperado ${asset.file_hash}, encontrado ${currentHash}`);
      }
    }
  }

  return asset;
}

/**
 * 8. Construir os 3 Creative Blueprints Declarativos do Job
 * NÃO duplica storage_path, file_size, codecs ou status operacional.
 * Mantém recipe_snapshot, resolved_assets, composition_directives e timeline.
 */
function buildCreativeBlueprints(job, resolvedAssetMap = {}) {
  if (!job || !job.id) {
    throw new Error('[ASSET_SERVICE] job válido é obrigatório para construir blueprints');
  }

  const scriptsSnapshot = job.scripts_snapshot || {};
  const hooks = scriptsSnapshot.hooks || [];
  const body = scriptsSnapshot.body || {};
  const shortId = job.id.split('-')[0] || job.id.slice(0, 8);
  const propertyRef = job.property_ref;

  const blueprints = [];

  for (let i = 1; i <= 3; i++) {
    const hookData = hooks.find(h => h.index === i) || {};
    const hookAssetId = resolvedAssetMap[`hook${i}_asset_id`] || `ast_hk_${shortId}_0${i}`;
    const bodyAssetId = resolvedAssetMap.body_asset_id || `ast_bd_${shortId}_01`;
    const renderedAssetId = resolvedAssetMap[`video${i}_asset_id`] || (i === 1 ? `ast_out_pilot_${shortId}` : `ast_out_vid${i}_${shortId}`);
    const expectedFilename = i === 1 ? 'pilot.mp4' : `video_${i}.mp4`;

    const blueprint = {
      schema_version: '1.0',
      creative_id: `crv_${shortId}_v${i}_b1`,
      job_id: job.id,
      property_ref: String(propertyRef),
      blueprint_version: 1,
      variant_index: i,
      name: `Criativo ${i} — ${hookData.tipo || `Gancho ${i}`}`,
      format: {
        aspect_ratio: '9:16',
        width: 1080,
        height: 1920,
        fps: 30
      },
      recipe_snapshot: {
        hook_index: i,
        hook_type: hookData.tipo || `Gancho ${i}`,
        hook_text: hookData.text || '',
        hook_look_id: hookData.look?.id || '',
        hook_look_name: hookData.look?.nome || '',
        body_text: body.text || '',
        body_look_id: body.look?.id || '',
        body_look_name: body.look?.nome || '',
        voice_id: MARCEL_VOICE_CLONE_ID
      },
      resolved_assets: {
        hook_asset_id: hookAssetId,
        body_asset_id: bodyAssetId
      },
      composition_directives: {
        editing_style_id: 'direct_cut_v1',
        transitions: [
          {
            from_segment: 'hook',
            to_segment: 'body',
            type: 'cut'
          }
        ],
        audio_mix: {
          speech_gain_db: 0.0,
          bg_music_gain_db: -22.0,
          ducking_enabled: true
        }
      },
      timeline: [
        {
          segment_index: 1,
          role: 'hook',
          asset_id: hookAssetId,
          layer: 0,
          timeline_start_ms: 0,
          timeline_end_ms: 9500
        },
        {
          segment_index: 2,
          role: 'body',
          asset_id: bodyAssetId,
          layer: 0,
          timeline_start_ms: 9500,
          timeline_end_ms: 38200
        }
      ],
      output_target: {
        asset_id: renderedAssetId,
        expected_filename: expectedFilename
      }
    };

    blueprints.push(blueprint);
  }

  return blueprints;
}

/**
 * 9. Salvar Creative Blueprints no Job (video_jobs.creative_blueprints)
 */
async function saveBlueprintsToJob(jobId, blueprints) {
  if (!jobId || !Array.isArray(blueprints)) return false;
  const pool = getPool();
  const query = `
    UPDATE video_jobs
    SET creative_blueprints = $2::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id;
  `;
  const res = await pool.query(query, [jobId, JSON.stringify(blueprints)]);
  return (res.rowCount || 0) > 0;
}

/**
 * 10. Helper Fail-Open para Instrumentação do Pipeline
 * Executa tarefas de catalogação de forma segura sem propagar erros para o fluxo da 2C
 */
async function safeCatalogOperation(opName, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[ASSET_SERVICE FAIL-OPEN WARNING] Erro não-bloqueante na operação '${opName}':`, err.message);
    return null;
  }
}

module.exports = {
  computeGenerationKey,
  computeFileHash,
  createAsset,
  markAssetReady,
  markAssetFailed,
  getAssetById,
  resolveAndValidateAsset,
  buildCreativeBlueprints,
  saveBlueprintsToJob,
  safeCatalogOperation
};