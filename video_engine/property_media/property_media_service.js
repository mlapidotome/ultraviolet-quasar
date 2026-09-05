/**
 * Módulo Property Media Service — Video Engine V2
 * Bali Imóveis (Property Video Ingestion)
 * 
 * Responsabilidades:
 * 1. Resolução e orquestração de adapters de mídia do imóvel (YouTube / CRM link_video)
 * 2. Cálculo determinístico de generation_key e asset_id canônico (Zero Migrations)
 * 3. Lock atômico persistente via PostgreSQL com lease e stale recovery
 * 4. Materialização e staging no mesmo filesystem (Zero EXDEV)
 * 5. Inspeção física rigorosa via ffprobe como autoridade absoluta
 * 6. Cálculo de integridade via streaming SHA-256 (O(N))
 * 7. Exposição unificada via Property Media Pool
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { getPool } = require('../db');
const YouTubeAdapter = require('./adapters/youtube_adapter');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const PROPERTIES_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'properties');

// Configurações operacionais com defaults seguros
const PROPERTY_VIDEO_MAX_SIZE_MB = parseInt(process.env.PROPERTY_VIDEO_MAX_SIZE_MB || '150', 10);
const PROPERTY_VIDEO_MAX_DURATION_SEC = parseInt(process.env.PROPERTY_VIDEO_MAX_DURATION_SEC || '300', 10);
const PROPERTY_VIDEO_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.PROPERTY_VIDEO_DOWNLOAD_TIMEOUT_MS || '60000', 10);
const PROPERTY_VIDEO_POLL_TIMEOUT_MS = parseInt(process.env.PROPERTY_VIDEO_POLL_TIMEOUT_MS || '30000', 10);
const PROPERTY_VIDEO_STALE_TIMEOUT_MINUTES = parseInt(process.env.PROPERTY_VIDEO_STALE_TIMEOUT_MINUTES || '10', 10);

class PropertyMediaService {
  constructor() {
    this.adapters = [];
    this.registerAdapter(new YouTubeAdapter());
  }

  registerAdapter(adapter) {
    if (!adapter || typeof adapter.canHandle !== 'function') {
      throw new Error('[PROPERTY_MEDIA_SERVICE] Adapter inválido');
    }
    this.adapters.unshift(adapter);
  }

  resolveProvider(url) {
    if (!url || typeof url !== 'string') return null;
    for (const adapter of this.adapters) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * Cálculo Canônico de generation_key
   */
  computeGenerationKey({ propertyRef, provider, providerMediaId, canonicalUrl }) {
    const canonicalObj = {
      asset_type: 'property_video',
      canonical_url: String(canonicalUrl).trim(),
      property_ref: String(propertyRef).trim(),
      provider: String(provider).toLowerCase().trim(),
      provider_media_id: String(providerMediaId).trim()
    };

    // Ordenação estrita das chaves
    const sortedKeys = Object.keys(canonicalObj).sort();
    const sortedObj = {};
    for (const k of sortedKeys) {
      sortedObj[k] = canonicalObj[k];
    }

    const canonicalJSON = JSON.stringify(sortedObj);
    return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
  }

  /**
   * Identificador Canônico Determinístico asset_id (41 chars <= 64 chars)
   */
  computeAssetId(propertyRef, generationKey) {
    const raw = `${String(propertyRef).trim()}:${String(generationKey).trim()}`;
    const hash32 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
    return `ast_pvid_${hash32}`;
  }

  /**
   * Cálculo de Hash Físico via Streaming SHA-256 (O(N) nos bytes do arquivo)
   */
  async computeFileHashStream(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE] Arquivo físico não encontrado: ${filePath}`);
    }

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  /**
   * Inspeção Física via FFPROBE como Autoridade
   */
  async inspectVideoFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE] Arquivo para ffprobe não encontrado: ${filePath}`);
    }

    const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

    const args = [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath
    ];

    const probeResult = await new Promise((resolve, reject) => {
      execFile(ffprobePath, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`[FFPROBE ERROR] Falha ao inspecionar arquivo (${err.message}): ${stderr}`));
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`[FFPROBE JSON ERROR] Resposta inválida: ${stdout}`));
        }
      });
    });

    const streams = probeResult.streams || [];
    const videoStream = streams.find(s => s.codec_type === 'video');
    if (!videoStream) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE VALIDATION] Arquivo não possui stream de vídeo válido: ${filePath}`);
    }

    const audioStream = streams.find(s => s.codec_type === 'audio');

    const width = parseInt(videoStream.width || '0', 10);
    const height = parseInt(videoStream.height || '0', 10);
    if (width <= 0 || height <= 0) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE VALIDATION] Dimensões inválidas (${width}x${height})`);
    }

    let durationSec = parseFloat(videoStream.duration || probeResult.format?.duration || '0');
    if (isNaN(durationSec) || durationSec <= 0) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE VALIDATION] Duração de vídeo inválida (${durationSec}s)`);
    }

    if (durationSec > PROPERTY_VIDEO_MAX_DURATION_SEC) {
      throw new Error(`[PROPERTY_MEDIA_SERVICE LIMIT] Duração de vídeo (${durationSec.toFixed(1)}s) excede o limite máximo permitido (${PROPERTY_VIDEO_MAX_DURATION_SEC}s)`);
    }

    let fps = 30;
    if (videoStream.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      if (parts.length === 2 && parseFloat(parts[1]) > 0) {
        fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
      } else if (!isNaN(parseFloat(videoStream.r_frame_rate))) {
        fps = Math.round(parseFloat(videoStream.r_frame_rate));
      }
    }

    const fileSizeBytes = parseInt(probeResult.format?.size || fs.statSync(filePath).size, 10);

    return {
      width,
      height,
      duration_sec: durationSec,
      duration_ms: Math.round(durationSec * 1000),
      fps: fps > 0 ? fps : 30,
      codec_video: videoStream.codec_name || 'unknown',
      codec_audio: audioStream ? (audioStream.codec_name || 'unknown') : null,
      audio_channels: audioStream ? parseInt(audioStream.channels || '1', 10) : 0,
      format_name: probeResult.format?.format_name || 'unknown',
      file_size_bytes: fileSizeBytes
    };
  }

  /**
   * Validação Estrita de Contenção de Diretório (Path Traversal Protection)
   */
  isPathContained(targetPath, baseDir) {
    if (!targetPath || !baseDir) return false;
    const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
    return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  }

  /**
   * Validação Física Unificada de Integridade do Asset (SHA-256 + FFprobe + Contenção + Specs)
   */
  async validatePhysicalAssetIntegrity(asset, expectedPropertyRef = null) {
    if (!asset || typeof asset !== 'object') {
      return { valid: false, reason: 'ASSET_NULL_OR_INVALID' };
    }
    if (asset.status !== 'ready') {
      return { valid: false, reason: `STATUS_NOT_READY: ${asset.status}` };
    }
    if (expectedPropertyRef && String(asset.property_ref) !== String(expectedPropertyRef)) {
      return { valid: false, reason: `PROPERTY_REF_MISMATCH: expected ${expectedPropertyRef}, got ${asset.property_ref}` };
    }
    if (asset.asset_type !== 'property_video') {
      return { valid: false, reason: `INVALID_ASSET_TYPE: ${asset.asset_type}` };
    }
    if (!asset.storage_path) {
      return { valid: false, reason: 'STORAGE_PATH_MISSING' };
    }
    if (!asset.file_hash || typeof asset.file_hash !== 'string' || !asset.file_hash.trim()) {
      return { valid: false, reason: 'FILE_HASH_MISSING' };
    }

    const expectedDir = path.resolve(PROPERTIES_OUTPUTS_DIR, String(asset.property_ref), 'videos');
    const resolvedPath = path.resolve(asset.storage_path);
    if (!this.isPathContained(resolvedPath, expectedDir)) {
      return { valid: false, reason: `PATH_CONTAINMENT_VIOLATION: ${resolvedPath} not contained in ${expectedDir}` };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, reason: `PHYSICAL_FILE_MISSING: ${resolvedPath}` };
    }

    // 1. Streaming SHA-256 Validation O(N)
    let physicalHash;
    try {
      physicalHash = await this.computeFileHashStream(resolvedPath);
    } catch (err) {
      return { valid: false, reason: `HASH_COMPUTATION_ERROR: ${err.message}` };
    }

    if (physicalHash !== asset.file_hash) {
      return { valid: false, reason: `FILE_HASH_MISMATCH: expected ${asset.file_hash}, got ${physicalHash}` };
    }

    // 2. FFprobe Physical Validation
    let inspectedSpecs;
    try {
      inspectedSpecs = await this.inspectVideoFile(resolvedPath);
    } catch (err) {
      return { valid: false, reason: `FFPROBE_VALIDATION_ERROR: ${err.message}` };
    }

    if (!inspectedSpecs || inspectedSpecs.width <= 0 || inspectedSpecs.height <= 0 || inspectedSpecs.duration_sec <= 0) {
      return { valid: false, reason: 'INVALID_PHYSICAL_SPECS' };
    }

    return { valid: true, specs: inspectedSpecs, physicalHash };
  }

  /**
   * Validação Estrita de Cache Hit (O(N) nos bytes via validatePhysicalAssetIntegrity)
   */
  async validateCacheHit(asset, propertyRef, generationKey) {
    if (!asset || asset.status !== 'ready') return false;
    if (String(asset.property_ref) !== String(propertyRef)) return false;
    if (asset.generation_key !== generationKey) return false;

    const integrity = await this.validatePhysicalAssetIntegrity(asset, propertyRef);
    if (!integrity.valid) {
      console.warn(`[PROPERTY_MEDIA_SERVICE] Cache hit rejeitado (${integrity.reason}) para asset ${asset.id}`);
      return false;
    }

    return true;
  }

  /**
   * Ingestão / Materialização com Mutex Atômico, Lease Fencing (claim_token), Polling e Stale Recovery
   */
  async ensurePropertyVideoByUrl(propertyRef, rawUrl, options = { failOpen: true, timeoutMs: PROPERTY_VIDEO_POLL_TIMEOUT_MS }) {
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { status: 'NO_VIDEO', asset: null };
    }

    const adapter = this.resolveProvider(rawUrl);
    if (!adapter) {
      const errMsg = `Provedor de vídeo não suportado ou URL não autorizada: ${rawUrl}`;
      console.warn(`[PROPERTY_MEDIA_SERVICE] ${errMsg}`);
      return { status: 'FAILED', error: errMsg, asset: null };
    }

    let videoId, canonicalUrl;
    try {
      videoId = adapter.parseVideoId(rawUrl);
      canonicalUrl = adapter.getCanonicalUrl(videoId);
    } catch (err) {
      return { status: 'FAILED', error: err.message, asset: null };
    }

    const generationKey = this.computeGenerationKey({
      propertyRef,
      provider: adapter.getName(),
      providerMediaId: videoId,
      canonicalUrl
    });

    const assetId = this.computeAssetId(propertyRef, generationKey);
    const pool = getPool();

    // 1. Verificação de Cache Hit
    try {
      const cacheRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId]);
      if (cacheRes.rows.length > 0) {
        const cachedAsset = cacheRes.rows[0];
        if (cachedAsset.status === 'ready') {
          const isCacheValid = await this.validateCacheHit(cachedAsset, propertyRef, generationKey);
          if (isCacheValid) {
            return { status: 'READY', asset: cachedAsset };
          }
          // Arquivo corrompido, sem hash ou ausente: marcar como failed para possibilitar recuperação
          console.warn(`[PROPERTY_MEDIA_SERVICE] Marcando asset corrompido ${assetId} como failed para recuperação.`);
          await pool.query(
            "UPDATE video_assets SET status = 'failed', error_message = 'CORRUPTED_CACHE_RECOVERY', updated_at = NOW() WHERE id = $1",
            [assetId]
          );
        }
      }
    } catch (dbErr) {
      console.error(`[PROPERTY_MEDIA_SERVICE DB ERROR] Falha ao consultar cache:`, dbErr.message);
    }

    // 2. Tentativa de Aquisição de Claim Atômico com claim_token Fencing
    let claimWon = false;
    let currentAsset = null;
    let claimToken = crypto.randomBytes(16).toString('hex');

    try {
      const metadataObj = {
        provider: adapter.getName(),
        provider_media_id: videoId,
        claim_token: claimToken
      };

      const insertQuery = `
        INSERT INTO video_assets (
          id, property_ref, asset_type, storage_type, status, generation_key,
          provider_ref, remote_url, metadata, created_at, updated_at
        ) VALUES (
          $1, $2, 'property_video', 'local_file', 'processing', $3,
          $4, $5, $6::jsonb, NOW(), NOW()
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *;
      `;

      const insertRes = await pool.query(insertQuery, [
        assetId,
        String(propertyRef),
        generationKey,
        `${adapter.getName()}:${videoId}`,
        canonicalUrl,
        JSON.stringify(metadataObj)
      ]);

      if (insertRes.rows.length > 0) {
        claimWon = true;
        currentAsset = insertRes.rows[0];
      }
    } catch (insertErr) {
      console.error(`[PROPERTY_MEDIA_SERVICE] Erro ao tentar insert claim:`, insertErr.message);
    }

    // Se não inseriu, verificar estado existente e tentar recuperação se for FAILED ou STALE
    if (!claimWon) {
      const rowRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId]);
      if (rowRes.rows.length > 0) {
        currentAsset = rowRes.rows[0];

        if (currentAsset.status === 'ready') {
          const isCacheValid = await this.validateCacheHit(currentAsset, propertyRef, generationKey);
          if (isCacheValid) {
            return { status: 'READY', asset: currentAsset };
          }
        }

        // Caso FAILED: Recuperar claim atomicamente com NOVO claim_token sobre o mesmo asset_id
        if (currentAsset.status === 'failed') {
          claimToken = crypto.randomBytes(16).toString('hex');
          const recoverFailedRes = await pool.query(
            `UPDATE video_assets 
             SET status = 'processing',
                 error_message = NULL,
                 updated_at = NOW(),
                 metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{claim_token}', to_jsonb($2::text))
             WHERE id = $1 AND status = 'failed'
             RETURNING *;`,
            [assetId, claimToken]
          );
          if (recoverFailedRes.rows.length > 0) {
            claimWon = true;
            currentAsset = recoverFailedRes.rows[0];
          }
        } else if (currentAsset.status === 'processing') {
          // Caso PROCESSING: Verificar se está stale e recuperar com NOVO claim_token
          claimToken = crypto.randomBytes(16).toString('hex');
          const recoverStaleRes = await pool.query(
            `UPDATE video_assets 
             SET status = 'processing',
                 updated_at = NOW(),
                 error_message = NULL,
                 metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{claim_token}', to_jsonb($2::text))
             WHERE id = $1 AND status = 'processing' AND updated_at < NOW() - ($3 || ' minutes')::interval
             RETURNING *;`,
            [assetId, claimToken, PROPERTY_VIDEO_STALE_TIMEOUT_MINUTES]
          );
          if (recoverStaleRes.rows.length > 0) {
            claimWon = true;
            currentAsset = recoverStaleRes.rows[0];
          }
        }
      }
    }

    // 3. Processo Ganhador: Executar Materialização Física no Staging com Fenced Transitions
    if (claimWon) {
      const propertyVideosDir = path.join(PROPERTIES_OUTPUTS_DIR, String(propertyRef), 'videos');
      const stagingDir = path.join(propertyVideosDir, '.tmp');
      const stagingBaseName = `ingest_${assetId}_${crypto.randomBytes(4).toString('hex')}`;

      let lostOwnership = false;

      // Heartbeat periódico protegido por claim_token fencing
      const heartbeatInterval = setInterval(async () => {
        try {
          const hbRes = await pool.query(
            "UPDATE video_assets SET updated_at = NOW() WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $2 RETURNING id",
            [assetId, claimToken]
          );
          if (hbRes.rowCount === 0) {
            lostOwnership = true;
            console.warn(`[PROPERTY_MEDIA_SERVICE] Worker perdeu ownership do claim ${assetId} durante heartbeat.`);
          }
        } catch (hbErr) {}
      }, 20000);

      let materializedStagingPath = null;

      try {
        const downloadRes = await adapter.materialize({
          canonicalUrl,
          videoId,
          stagingDir,
          stagingBaseName,
          timeoutMs: PROPERTY_VIDEO_DOWNLOAD_TIMEOUT_MS,
          maxSizeMb: PROPERTY_VIDEO_MAX_SIZE_MB
        });

        materializedStagingPath = downloadRes.localPath;

        if (lostOwnership) {
          throw new Error('CLAIM_OWNERSHIP_LOST');
        }

        // Inspeção FFPROBE física
        const specs = await this.inspectVideoFile(materializedStagingPath);

        // Cálculo SHA-256 via streaming
        const physicalHash = await this.computeFileHashStream(materializedStagingPath);

        // Publicação Atômica no mesmo filesystem com isolamento estrito de Owner/Claim
        const finalExt = path.extname(materializedStagingPath).toLowerCase();
        const finalPath = path.join(propertyVideosDir, `${assetId}.${claimToken}${finalExt}`);

        fs.renameSync(materializedStagingPath, finalPath);
        materializedStagingPath = null; // Renomeado com sucesso para candidate exclusivo do claim_token

        // Publicação Fenced para READY no PostgreSQL
        const readyRes = await pool.query(
          `UPDATE video_assets
           SET status = 'ready',
               storage_path = $2,
               file_hash = $3,
               specs = $4::jsonb,
               metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{materialized_at}', to_jsonb(NOW()::text)),
               updated_at = NOW()
           WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $5
           RETURNING *;`,
          [assetId, finalPath, physicalHash, JSON.stringify(specs), claimToken]
        );

        if (readyRes.rowCount === 0) {
          console.warn(`[PROPERTY_MEDIA_SERVICE] Publicação READY abortada: processo perdeu ownership do claim ${assetId}`);
          try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch (e) {}
          return { status: 'LOST_OWNERSHIP', error: 'Claim ownership lost to another worker', asset: null };
        }

        return { status: 'READY', asset: readyRes.rows[0] };
      } catch (matErr) {
        console.error(`[PROPERTY_MEDIA_SERVICE MATERIALIZATION ERROR] Falha ao materializar vídeo ${assetId}:`, matErr.message);

        // Limpeza do arquivo de staging se ainda existir
        if (materializedStagingPath && fs.existsSync(materializedStagingPath)) {
          try { fs.unlinkSync(materializedStagingPath); } catch (e) {}
        }

        // Marcar como FAILED no DB apenas se ainda possuir o claim_token
        if (matErr.message !== 'CLAIM_OWNERSHIP_LOST') {
          try {
            await pool.query(
              `UPDATE video_assets 
               SET status = 'failed', error_message = $2, updated_at = NOW() 
               WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $3`,
              [assetId, matErr.message.slice(0, 500), claimToken]
            );
          } catch (failErr) {}
        }

        return { status: 'FAILED', error: matErr.message, asset: null };
      } finally {
        clearInterval(heartbeatInterval);
      }
    }

    // 4. Processos Concorrentes: Polling Ativo
    const pollStart = Date.now();
    const pollTimeoutMs = options.timeoutMs || PROPERTY_VIDEO_POLL_TIMEOUT_MS;

    while (Date.now() - pollStart < pollTimeoutMs) {
      await new Promise(r => setTimeout(r, 1000));

      try {
        const pollRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId]);
        if (pollRes.rows.length > 0) {
          const row = pollRes.rows[0];
          if (row.status === 'ready') {
            const isCacheValid = await this.validateCacheHit(row, propertyRef, generationKey);
            if (isCacheValid) {
              return { status: 'READY', asset: row };
            }
          }
          if (row.status === 'failed') {
            return { status: 'FAILED', error: row.error_message || 'Materialização falhou em outro processo', asset: null };
          }
        }
      } catch (pErr) {
        console.warn(`[PROPERTY_MEDIA_SERVICE POLL] Erro de polling:`, pErr.message);
      }
    }

    // Polling timeout: Não rouba claim ativo
    console.warn(`[PROPERTY_MEDIA_SERVICE] Timeout de polling atingido para ${assetId}. Claim de outro processo permanece ativo.`);
    return { status: 'INGESTION_IN_PROGRESS', asset: null };
  }

  /**
   * Ponto de Entrada Oficial para Inicialização de Jobs
   * Integração com o CRM ImobTotal / Snapshot
   */
  async ensurePropertyVideo(propertyRef, options = { failOpen: true, timeoutMs: PROPERTY_VIDEO_POLL_TIMEOUT_MS }) {
    if (!propertyRef) {
      return { status: 'NO_VIDEO', asset: null };
    }

    // Buscar dados do imóvel (via job_service.fetchImovelData)
    let imovel = null;
    try {
      const jobService = require('../job_service');
      imovel = await jobService.fetchImovelData(propertyRef);
    } catch (e) {
      console.warn(`[PROPERTY_MEDIA_SERVICE] Não foi possível consultar CRM para ref ${propertyRef}:`, e.message);
    }

    const rawUrl = imovel?.link_video || null;
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { status: 'NO_VIDEO', asset: null };
    }

    return await this.ensurePropertyVideoByUrl(propertyRef, rawUrl, options);
  }

  /**
   * Property Media Pool: Coleção Completa e Validada de Mídias do Imóvel
   * Exige integridade física estrita (READY + CONTAINMENT + FILE_HASH + STREAMING SHA-256 + FFPROBE)
   */
  async getPropertyMediaPool(propertyRef) {
    if (!propertyRef) {
      return { property_ref: null, photos: [], videos: [] };
    }

    const pool = getPool();
    const cleanRef = String(propertyRef).trim();

    // 1. Buscar fotos do snapshot via CRM / Banco local
    let photos = [];
    try {
      const jobService = require('../job_service');
      const imovel = await jobService.fetchImovelData(cleanRef);
      if (Array.isArray(imovel?.fotos)) {
        photos = imovel.fotos.map((f, idx) => ({
          asset_id: `ast_crm_photo_${cleanRef}_${idx + 1}`,
          asset_type: 'image',
          role: 'property_photo',
          url: typeof f === 'string' ? f : (f.url || f.link),
          index: idx + 1
        }));
      }
    } catch (e) {}

    // 2. Buscar vídeos com status READY no banco com validação física rigorosa
    const videos = [];
    try {
      const vidRes = await pool.query(
        "SELECT * FROM video_assets WHERE property_ref = $1 AND asset_type = 'property_video' AND status = 'ready' ORDER BY created_at ASC",
        [cleanRef]
      );

      for (const row of vidRes.rows) {
        const integrity = await this.validatePhysicalAssetIntegrity(row, cleanRef);
        if (integrity.valid) {
          videos.push({
            asset_id: row.id,
            asset_type: 'property_video',
            role: 'property_footage',
            storage_path: row.storage_path,
            duration_ms: row.specs?.duration_ms || Math.round((row.specs?.duration_sec || 0) * 1000),
            specs: row.specs || {},
            file_hash: row.file_hash,
            remote_url: row.remote_url
          });
        } else {
          console.warn(`[PROPERTY_MEDIA_SERVICE] Asset ${row.id} ignorado no pool por falha na integridade física: ${integrity.reason}`);
          try {
            await pool.query(
              "UPDATE video_assets SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1 AND status = 'ready'",
              [row.id, `CORRUPTED_POOL_RECOVERY: ${integrity.reason}`]
            );
          } catch (e) {}
        }
      }
    } catch (dbErr) {
      console.error(`[PROPERTY_MEDIA_SERVICE] Erro ao consultar videos do pool para ref ${cleanRef}:`, dbErr.message);
    }

    return {
      property_ref: cleanRef,
      photos,
      videos
    };
  }
}

const instance = new PropertyMediaService();

module.exports = instance;
