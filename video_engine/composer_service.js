/**
 * Módulo Video Composer MVP — Video Engine V2
 * Bali Imóveis (Fase 3B — Final Hardening)
 * 
 * Responsabilidades:
 * 1. Execução determinística e pura orientada por Creative Blueprint
 * 2. Cálculo profundo da render_key (SHA-256 de todas as especificações e hashes físicos de entrada)
 * 3. Claim atômico persistente de renderização no PostgreSQL com lease e stale recovery
 * 4. Resolução rigorosa de assets via Asset Resolver com validação de ownership físico do Job
 * 5. Determinação da duração física real (specs.duration) descartando placeholders
 * 6. Pipeline canônico único de re-encode FFmpeg (H.264 1080x1920@30fps + AAC) com trims bilaterais reais
 * 7. Escrita atômica via arquivo temporário único (.tmp.<uuid>.mp4) e rename atômico pós-ffprobe
 * 8. Saída física imutável (assets ready nunca são sobrescritos)
 * 9. Modo Shadow com isolamento absoluto do pipeline oficial da Fase 2C
 * 10. Validação semântica e tolerância configurável de duração (COMPOSER_DURATION_TOLERANCE_MS)
 * 11. Proteção estrita contra path traversal em creative_id e diretórios de output
 * 12. Invariante estrito: FFmpeg NUNCA executa sem claim.acquired === true (com recuperação controlada para READY quebrado)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { getPool } = require('./db');
const assetService = require('./asset_service');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

// Configurações do Composer MVP
const COMPOSER_CONTRACT_VERSION = 'composer_v1';
const COMPOSER_DURATION_TOLERANCE_MS = parseInt(process.env.COMPOSER_DURATION_TOLERANCE_MS || '250', 10);
const STALE_RENDER_TIMEOUT_MINUTES = 5;
const FFMPEG_TIMEOUT_MS = 120000; // 2 minutos
const CREATIVE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 1. Validação do Contrato do Blueprint (Fail-Fast Pré-FFmpeg)
 * @param {Object} blueprint
 */
function validateBlueprintContract(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Blueprint nulo ou inválido');
  }

  if (blueprint.schema_version !== '1.0') {
    throw new Error(`[COMPOSER VALIDATION ERROR] schema_version '${blueprint.schema_version}' não suportada pelo Composer MVP (esperado '1.0')`);
  }

  if (!blueprint.creative_id || typeof blueprint.creative_id !== 'string' || !CREATIVE_ID_REGEX.test(blueprint.creative_id)) {
    throw new Error(`[COMPOSER VALIDATION ERROR] creative_id inválido (${blueprint.creative_id}). Deve conter apenas letras, números, hífen e underscore (1-64 caracteres)`);
  }

  if (!blueprint.format || typeof blueprint.format !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Objeto format é obrigatório');
  }

  const { aspect_ratio, width, height, fps } = blueprint.format;
  if (aspect_ratio !== '9:16' || Number(width) !== 1080 || Number(height) !== 1920 || Number(fps) !== 30) {
    throw new Error(`[COMPOSER VALIDATION ERROR] Formato ${width}x${height}@${fps} (${aspect_ratio}) não suportado no MVP (esperado 1080x1920@30fps 9:16)`);
  }

  if (!Array.isArray(blueprint.timeline) || blueprint.timeline.length === 0) {
    throw new Error('[COMPOSER VALIDATION ERROR] Timeline do Blueprint está vazia');
  }

  // Validação dos segmentos da timeline
  for (let i = 0; i < blueprint.timeline.length; i++) {
    const seg = blueprint.timeline[i];
    if (!seg.asset_id) {
      throw new Error(`[COMPOSER VALIDATION ERROR] Segmento ${i + 1} sem asset_id definido`);
    }
    if (seg.layer !== undefined && seg.layer !== 0) {
      throw new Error(`[COMPOSER VALIDATION ERROR] layer ${seg.layer} não suportada no MVP (suporte apenas a layer 0)`);
    }

    const hasIn = seg.source_in_ms !== null && seg.source_in_ms !== undefined;
    const hasOut = seg.source_out_ms !== null && seg.source_out_ms !== undefined;

    // Contrato B: Exigência bilateral rigorosa de trims
    if (hasIn !== hasOut) {
      throw new Error(`[COMPOSER VALIDATION ERROR] Segmento ${i + 1} possui trim unilateral inválido: source_in_ms e source_out_ms devem ser fornecidos juntos ou omitidos`);
    }

    if (hasIn && hasOut) {
      const inMs = Number(seg.source_in_ms);
      const outMs = Number(seg.source_out_ms);
      if (isNaN(inMs) || isNaN(outMs) || inMs < 0 || inMs >= outMs) {
        throw new Error(`[COMPOSER VALIDATION ERROR] Segmento ${i + 1} possui trim inválido: 0 <= source_in_ms (${seg.source_in_ms}) < source_out_ms (${seg.source_out_ms}) obrigatório`);
      }
    }
  }

  return true;
}

/**
 * 2. Resolução Segura de Assets da Timeline
 * @param {string} jobId
 * @param {Array} timeline
 * @returns {Promise<Array>} Array de assets resolvidos e validados
 */
async function resolveTimelineAssets(jobId, timeline) {
  const resolved = [];

  for (let i = 0; i < timeline.length; i++) {
    const seg = timeline[i];
    // Validação estrita via Asset Resolver existente (status ready, ownership físico, hash)
    const asset = await assetService.resolveAndValidateAsset(seg.asset_id, { checkFile: true, checkHash: true });

    if (asset.job_id && String(asset.job_id) !== String(jobId)) {
      throw new Error(`[COMPOSER SECURITY ERROR] Asset ${asset.id} pertence ao Job ${asset.job_id} e não ao Job ${jobId}`);
    }

    // Duração física oficial em milissegundos inteiros (conversão única)
    const rawDurationSec = parseFloat(asset.specs?.duration || '0');
    if (isNaN(rawDurationSec) || rawDurationSec <= 0) {
      throw new Error(`[COMPOSER ERROR] Asset ${asset.id} possui duração física inválida ou zero no specs (${asset.specs?.duration})`);
    }
    const duration_ms = Math.round(rawDurationSec * 1000);

    resolved.push({
      segment_index: seg.segment_index || (i + 1),
      role: seg.role || `clip_${i + 1}`,
      asset,
      storage_path: asset.storage_path,
      file_hash: asset.file_hash,
      duration_ms,
      source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
      source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
    });
  }

  return resolved;
}

/**
 * 3. Cálculo da render_key Canônica e Determinística
 * @param {Object} blueprint
 * @param {Array} resolvedAssets
 * @returns {string} SHA-256 hex
 */
function computeRenderKey(blueprint, resolvedAssets) {
  const inputAssetsCanonical = resolvedAssets.map(item => ({
    segment_index: item.segment_index,
    role: item.role,
    asset_id: item.asset.id,
    file_hash: item.file_hash // Hash físico dos bytes de entrada!
  }));

  const timelineCanonical = blueprint.timeline.map((seg, idx) => ({
    segment_index: seg.segment_index || (idx + 1),
    role: seg.role,
    asset_id: seg.asset_id,
    layer: seg.layer || 0,
    source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
    source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
  }));

  const renderSpec = {
    schema_version: String(blueprint.schema_version || '1.0'),
    composer_contract_version: COMPOSER_CONTRACT_VERSION,
    creative_id: String(blueprint.creative_id),
    blueprint_version: Number(blueprint.blueprint_version || 1),
    format: {
      aspect_ratio: String(blueprint.format.aspect_ratio || '9:16').trim(),
      width: Number(blueprint.format.width || 1080),
      height: Number(blueprint.format.height || 1920),
      fps: Number(blueprint.format.fps || 30)
    },
    timeline: timelineCanonical,
    composition_directives: blueprint.composition_directives || {},
    input_assets: inputAssetsCanonical
  };

  const canonicalJSON = assetService.canonicalStringify(renderSpec);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

/**
 * 4. Construção do Plano de Execução e Linha do Tempo Real
 * @param {Object} blueprint
 * @param {Array} resolvedAssets
 * @returns {Object} Execution plan com caminhos, duração esperada e tempos
 */
function buildExecutionPlan(blueprint, resolvedAssets) {
  let accumulatedTimelineMs = 0;
  const segmentsPlan = [];

  for (const item of resolvedAssets) {
    let segmentDurationMs = item.duration_ms;

    // Se houver trims bilaterais explícitos
    if (item.source_in_ms !== null && item.source_out_ms !== null) {
      if (item.source_out_ms > item.duration_ms) {
        throw new Error(`[COMPOSER ERROR] source_out_ms (${item.source_out_ms}) excede a duração física do clipe (${item.duration_ms}ms)`);
      }
      segmentDurationMs = item.source_out_ms - item.source_in_ms;
    }

    const start_ms = accumulatedTimelineMs;
    const end_ms = start_ms + segmentDurationMs;
    accumulatedTimelineMs = end_ms;

    segmentsPlan.push({
      ...item,
      effective_duration_ms: segmentDurationMs,
      timeline_start_ms: start_ms,
      timeline_end_ms: end_ms
    });
  }

  return {
    blueprint,
    segments: segmentsPlan,
    total_duration_ms: accumulatedTimelineMs,
    total_duration_sec: accumulatedTimelineMs / 1000
  };
}

/**
 * 5. Claim Atômico Persistente no PostgreSQL (Controle de Concorrência & Stale Recovery)
 * @returns {Promise<{ acquired: boolean, asset: Object }>}
 */
async function claimRenderLock({
  outputAssetId,
  jobId,
  propertyRef,
  renderKey,
  isShadow = false,
  metadata = {}
}) {
  const pool = getPool();
  const assetType = isShadow ? 'shadow_creative' : 'rendered_creative';

  // Tentativa atômica de INSERT ou UPDATE com proteção contra stale processing (> 5 min)
  const query = `
    INSERT INTO video_assets (
      id, job_id, property_ref, asset_type, storage_type,
      storage_path, file_hash, generation_key, status,
      specs, metadata, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'local_file',
      NULL, NULL, $5, 'processing',
      '{}'::jsonb, $6::jsonb, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = 'processing',
      generation_key = $5,
      updated_at = NOW(),
      metadata = video_assets.metadata || $6::jsonb
    WHERE video_assets.status IN ('pending', 'failed')
       OR (video_assets.status = 'processing' AND video_assets.updated_at < NOW() - INTERVAL '5 minutes')
    RETURNING *;
  `;

  const metaWithContext = {
    ...metadata,
    pid: process.pid,
    is_shadow: isShadow,
    claim_timestamp: new Date().toISOString()
  };

  const res = await pool.query(query, [
    outputAssetId,
    jobId,
    propertyRef ? String(propertyRef) : null,
    assetType,
    renderKey,
    JSON.stringify(metaWithContext)
  ]);

  if (res.rows.length === 1) {
    return { acquired: true, asset: res.rows[0] };
  }

  // Se não adquiriu o claim, consultar o registro atual
  const existingRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [outputAssetId]);
  const existingAsset = existingRes.rows[0] || null;

  return { acquired: false, asset: existingAsset };
}

/**
 * 6. Pipeline Canônico Único de Re-encode FFmpeg (H.264 1080x1920@30fps + AAC) com Trims Reais
 * @param {Object} params
 * @returns {Promise<void>}
 */
function renderTimelineFFmpeg({ executionPlan, tempOutputPath }) {
  return new Promise((resolve, reject) => {
    const segments = executionPlan.segments;
    const n = segments.length;

    if (n < 1) {
      return reject(new Error('[FFMPEG ERROR] Nenhum segmento para renderizar'));
    }

    const args = ['-y'];

    // Entradas
    for (const seg of segments) {
      args.push('-i', seg.storage_path);
    }

    // Construção do filtro complexo com suporte a trims bilaterais reais para vídeo e áudio
    const filterParts = [];
    let concatInputs = '';

    for (let i = 0; i < n; i++) {
      const seg = segments[i];
      const hasIn = seg.source_in_ms !== null && seg.source_in_ms !== undefined;
      const hasOut = seg.source_out_ms !== null && seg.source_out_ms !== undefined;

      let vFilter = '';
      let aFilter = '';

      if (hasIn && hasOut) {
        const inSec = (Number(seg.source_in_ms) / 1000).toFixed(3);
        const outSec = (Number(seg.source_out_ms) / 1000).toFixed(3);
        vFilter = `[${i}:v]trim=start=${inSec}:end=${outSec},setpts=PTS-STARTPTS[v${i}]`;
        aFilter = `[${i}:a]atrim=start=${inSec}:end=${outSec},asetpts=PTS-STARTPTS[a${i}]`;
      } else {
        // Sem trims: consome 100% do asset com normalização de PTS
        vFilter = `[${i}:v]setpts=PTS-STARTPTS[v${i}]`;
        aFilter = `[${i}:a]asetpts=PTS-STARTPTS[a${i}]`;
      }

      filterParts.push(vFilter);
      filterParts.push(aFilter);
      concatInputs += `[v${i}][a${i}]`;
    }

    const concatFilter = `${concatInputs}concat=n=${n}:v=1:a=1[outv][outa]`;
    filterParts.push(concatFilter);

    const filterString = filterParts.join(';');

    args.push(
      '-filter_complex', filterString,
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-s', '1080x1920',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      tempOutputPath
    );

    let stderrBuffer = '';
    const child = execFile('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        const errorDetail = (stderrBuffer || stderr || err.message).slice(-2000);
        return reject(new Error(`[FFMPEG EXECUTION ERROR] Falha no re-encode: ${err.message}. Detalhes: ${errorDetail}`));
      }
      resolve();
    });

    if (child.stderr) {
      child.stderr.on('data', d => {
        stderrBuffer += d.toString();
        if (stderrBuffer.length > 102400) { // Limitar a 100KB
          stderrBuffer = stderrBuffer.slice(-102400);
        }
      });
    }
  });
}

/**
 * 7. Inspeção Pós-Render Rigorosa (QC) e Promoção Atômica Segura
 * @param {string} tempPath
 * @param {string} finalPath
 * @param {number} expectedDurationMs
 * @returns {Promise<Object>} Specs inspecionadas
 */
function verifyAndPromoteOutput({ tempPath, finalPath, expectedDurationMs, toleranceMs = COMPOSER_DURATION_TOLERANCE_MS }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(tempPath)) {
      return reject(new Error(`[COMPOSER ERROR] Arquivo temporário não gerado: ${tempPath}`));
    }

    execFile(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,duration,width,height,r_frame_rate,avg_frame_rate',
        '-show_entries', 'format=duration,size',
        '-of', 'json',
        tempPath
      ],
      { timeout: 15000 },
      (probeErr, stdout) => {
        if (probeErr) {
          return reject(new Error(`[FFPROBE ERROR] Falha ao inspecionar saída temporária: ${probeErr.message}`));
        }

        try {
          const probe = JSON.parse(stdout);
          const formatDuration = parseFloat(probe.format?.duration || '0');
          const formatDurationMs = Math.round(formatDuration * 1000);
          const streams = probe.streams || [];

          const videoStream = streams.find(s => s.codec_type === 'video');
          const audioStream = streams.find(s => s.codec_type === 'audio');

          if (!videoStream) {
            return reject(new Error('[VALIDATION ERROR] Stream de vídeo ausente na saída do Composer'));
          }
          if (!audioStream) {
            return reject(new Error('[VALIDATION ERROR] Stream de áudio ausente na saída do Composer'));
          }

          // Validação rigorosa dos Codecs físicos
          if (videoStream.codec_name !== 'h264') {
            return reject(new Error(`[VALIDATION ERROR] Codec de vídeo inválido: esperado 'h264', obtido '${videoStream.codec_name}'`));
          }
          if (audioStream.codec_name !== 'aac') {
            return reject(new Error(`[VALIDATION ERROR] Codec de áudio inválido: esperado 'aac', obtido '${audioStream.codec_name}'`));
          }

          // Validação rigorosa das Dimensões físicas
          if (Number(videoStream.width) !== 1080 || Number(videoStream.height) !== 1920) {
            return reject(new Error(`[VALIDATION ERROR] Dimensões inválidas: esperado 1080x1920, obtido ${videoStream.width}x${videoStream.height}`));
          }

          // Cálculo e validação do FPS real a partir dos streams físicos
          let physicalFps = 0;
          const rateStr = videoStream.avg_frame_rate || videoStream.r_frame_rate || '';
          if (rateStr.includes('/')) {
            const [num, den] = rateStr.split('/').map(Number);
            if (den && den > 0) physicalFps = Math.round(num / den);
          } else {
            physicalFps = Math.round(parseFloat(rateStr) || 0);
          }

          if (physicalFps < 29 || physicalFps > 31) {
            return reject(new Error(`[VALIDATION ERROR] FPS físico inválido: esperado ~30 fps, obtido ${physicalFps} fps (${rateStr})`));
          }

          // Verificação de tolerância de duração configurável
          const durationDiff = Math.abs(formatDurationMs - expectedDurationMs);
          if (durationDiff > toleranceMs) {
            return reject(new Error(`[VALIDATION ERROR] Duração final (${formatDurationMs}ms) diverge da esperada (${expectedDurationMs}ms) além da tolerância permitida (${toleranceMs}ms)`));
          }

          // Verificação de ausência de corte abrupto de áudio
          const vDur = parseFloat(videoStream.duration || formatDuration);
          const aDur = parseFloat(audioStream.duration || formatDuration);
          if (Math.abs(vDur - aDur) > 0.200) { // máx 200ms de descompasso de trilha
            return reject(new Error(`[VALIDATION ERROR] Descompasso excessivo entre streams de vídeo (${vDur}s) e áudio (${aDur}s)`));
          }

          // Promoção Atômica Segura:
          // Se o destino final já existir (ex: arquivo órfão prévio de tentativa abortada),
          // ele NUNCA é aceito cegamente. O órfão é removido e a nova saída recém-validada é promovida.
          if (fs.existsSync(finalPath)) {
            console.warn(`[COMPOSER WARNING] Arquivo prévio não-homologado encontrado em finalPath (${finalPath}). Removendo órfão antes da promoção.`);
            try {
              fs.unlinkSync(finalPath);
            } catch (uErr) {
              return reject(new Error(`[PROMOTION ERROR] Falha ao remover arquivo órfão existente: ${uErr.message}`));
            }
          }
          fs.renameSync(tempPath, finalPath);

          const fileStats = fs.statSync(finalPath);
          const fileHash = assetService.computeFileHash(finalPath);

          resolve({
            duration: formatDuration,
            duration_ms: formatDurationMs,
            width: Number(videoStream.width),
            height: Number(videoStream.height),
            fps: physicalFps,
            codec_video: videoStream.codec_name,
            codec_audio: audioStream.codec_name,
            hasVideo: true,
            hasAudio: true,
            size_bytes: fileStats.size,
            file_hash: fileHash
          });
        } catch (parseErr) {
          reject(new Error(`[VALIDATION ERROR] Erro no parsing do ffprobe: ${parseErr.message}`));
        }
      }
    );
  });
}

/**
 * 8. Função Principal: composeCreative()
 * Orquestra todo o ciclo determinístico de montagem
 * @param {Object} params
 * @param {string} params.jobId
 * @param {Object} params.blueprint
 * @param {boolean} [params.isShadow=true]
 * @param {Object} [params.options={}]
 * @returns {Promise<Object>} Resultado da composição
 */
async function composeCreative({
  jobId,
  blueprint,
  isShadow = true,
  options = {}
}) {
  if (!jobId) throw new Error('[COMPOSER] jobId é obrigatório');

  // 1. Validação de Contrato (Pré-FFmpeg)
  validateBlueprintContract(blueprint);

  // 2. Resolução de Assets
  const resolvedAssets = await resolveTimelineAssets(jobId, blueprint.timeline);

  // 3. Cálculo Determinístico da render_key
  const renderKey = computeRenderKey(blueprint, resolvedAssets);
  const shortRenderKey = renderKey.slice(0, 10);
  const creativeId = blueprint.creative_id;
  const prefix = isShadow ? 'shadow_' : 'composer_';
  const targetFilename = `${prefix}${creativeId}_${shortRenderKey}.mp4`;

  const jobDir = path.resolve(JOBS_OUTPUTS_DIR, String(jobId));
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }
  const finalOutputPath = path.resolve(jobDir, targetFilename);
  const outputAssetId = `ast_${prefix}${creativeId}_${shortRenderKey}`;

  // Validação estrita de contenção de diretório (Path Traversal Protection)
  const relFinal = path.relative(jobDir, finalOutputPath);
  if (relFinal.startsWith('..') || path.isAbsolute(relFinal) || path.dirname(finalOutputPath) !== jobDir) {
    throw new Error(`[COMPOSER SECURITY ERROR] Caminho final escapa do diretório do job: ${finalOutputPath}`);
  }

  // 4. Construção do Plano de Execução
  const executionPlan = buildExecutionPlan(blueprint, resolvedAssets);

  // 5. Idempotência e Claim Atômico SQL
  const tempUuid = crypto.randomBytes(6).toString('hex');
  const tempFilename = `${prefix}${creativeId}_${shortRenderKey}.tmp.${tempUuid}.mp4`;
  const tempOutputPath = path.resolve(jobDir, tempFilename);

  const relTemp = path.relative(jobDir, tempOutputPath);
  if (relTemp.startsWith('..') || path.isAbsolute(relTemp) || path.dirname(tempOutputPath) !== jobDir) {
    throw new Error(`[COMPOSER SECURITY ERROR] Caminho temporário escapa do diretório do job: ${tempOutputPath}`);
  }

  let claim = await claimRenderLock({
    outputAssetId,
    jobId,
    propertyRef: blueprint.property_ref,
    renderKey,
    isShadow,
    metadata: {
      creative_id: creativeId,
      blueprint_version: blueprint.blueprint_version,
      render_key: renderKey,
      temp_filename: tempFilename
    }
  });

  // Se o claim não foi adquirido
  if (!claim.acquired) {
    const existing = claim.asset;
    if (!existing) {
      const err = new Error(`[COMPOSER ERROR] Asset ${outputAssetId} não encontrado no catálogo após falha de claim`);
      err.statusCode = 500;
      throw err;
    }

    if (existing.status === 'ready') {
      // Verificar integridade física e render_key
      const hasValidPath = existing.storage_path && fs.existsSync(existing.storage_path);
      let isValidHash = false;
      if (hasValidPath) {
        const currentHash = assetService.computeFileHash(existing.storage_path);
        isValidHash = (currentHash === existing.file_hash);
      }

      // Caso A: READY íntegro com arquivo válido, hash coincidente e mesma render_key -> Retorno Idempotente
      if (hasValidPath && isValidHash && existing.generation_key === renderKey) {
        console.log(`[COMPOSER IDEMPOTENCY] Output para render_key ${renderKey} já existe e está READY. Retornando existente.`);
        return {
          success: true,
          idempotent: true,
          asset_id: existing.id,
          output_path: existing.storage_path,
          render_key: renderKey,
          specs: existing.specs
        };
      }

      // Caso C: READY corrompido ou arquivo ausente ou key divergente -> Recuperação controlada
      console.warn(`[COMPOSER RECOVERY] Asset ${outputAssetId} marcado como READY porém com integridade violada (file: ${hasValidPath}, hash: ${isValidHash}). Invalidando e tentando novo claim...`);
      await assetService.markAssetFailed(outputAssetId, 'CORRUPTED_OR_MISSING_PHYSICAL_FILE');
      
      // Tentar novo claim atômico após invalidação
      claim = await claimRenderLock({
        outputAssetId,
        jobId,
        propertyRef: blueprint.property_ref,
        renderKey,
        isShadow,
        metadata: {
          creative_id: creativeId,
          blueprint_version: blueprint.blueprint_version,
          render_key: renderKey,
          temp_filename: tempFilename,
          recovered_from_broken_ready: true
        }
      });

      if (!claim.acquired) {
        const err = new Error(`[COMPOSER CONCURRENCY] Não foi possível adquirir claim para recuperação do asset ${outputAssetId}`);
        err.statusCode = 409;
        throw err;
      }
    } else if (existing.status === 'processing') {
      // Caso B: Processamento concorrente ativo
      const err = new Error(`[COMPOSER CONCURRENCY] Render para criativo ${creativeId} já está em andamento por outro processo`);
      err.statusCode = 409;
      throw err;
    } else {
      // Caso D: Qualquer outro estado inesperado
      const err = new Error(`[COMPOSER ERROR] Estado inesperado do asset ${outputAssetId} (${existing.status}) sem aquisição de claim`);
      err.statusCode = 409;
      throw err;
    }
  }

  // Invariante absoluto: NUNCA prosseguir para FFmpeg sem claim ativo adquirido
  if (!claim || !claim.acquired) {
    throw new Error(`[COMPOSER INVARIANT ERROR] Tentativa de renderização sem claim adquirido para ${outputAssetId}`);
  }

  // 6. Execução da Renderização FFmpeg
  try {
    console.log(`[COMPOSER] Iniciando renderização canônica para criativo ${creativeId} (render_key: ${shortRenderKey})...`);
    await renderTimelineFFmpeg({ executionPlan, tempOutputPath });

    // 7. Validação e Promoção Atômica
    console.log(`[COMPOSER] Validando saída via ffprobe e promovendo atomicamente para ${finalOutputPath}...`);
    const specs = await verifyAndPromoteOutput({
      tempPath: tempOutputPath,
      finalPath: finalOutputPath,
      expectedDurationMs: executionPlan.total_duration_ms,
      toleranceMs: options.toleranceMs !== undefined ? options.toleranceMs : COMPOSER_DURATION_TOLERANCE_MS
    });

    // 8. Marcar Asset como READY no Catálogo
    const finalAsset = await assetService.markAssetReady(outputAssetId, {
      localPath: finalOutputPath,
      fileHash: specs.file_hash,
      specs,
      metadata: {
        creative_id: creativeId,
        render_key: renderKey,
        is_shadow: isShadow,
        execution_plan: {
          total_duration_ms: executionPlan.total_duration_ms,
          segments_count: executionPlan.segments.length
        }
      }
    });

    console.log(`[COMPOSER SUCCESS] Criativo ${creativeId} montado com sucesso (Asset: ${finalAsset.id}, Duração: ${specs.duration}s)!`);

    return {
      success: true,
      idempotent: false,
      asset_id: finalAsset.id,
      output_path: finalOutputPath,
      render_key: renderKey,
      specs
    };
  } catch (renderError) {
    console.error(`[COMPOSER FAILURE] Erro na renderização do criativo ${creativeId}:`, renderError.message);
    // Cleanup do arquivo temporário órfão
    if (fs.existsSync(tempOutputPath)) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) {}
    }
    // Marcar como failed no catálogo para liberar retries
    await assetService.markAssetFailed(outputAssetId, renderError.message);
    throw renderError;
  }
}

/**
 * 9. Validador Semântico de Equivalência (Shadow vs Concat Legado)
 * @param {string} legacyFilePath
 * @param {string} composerFilePath
 * @param {number} toleranceMs
 * @returns {Promise<Object>} Relatório de comparação
 */
function compareLegacyVsComposer(legacyFilePath, composerFilePath, toleranceMs = COMPOSER_DURATION_TOLERANCE_MS) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(legacyFilePath) || !fs.existsSync(composerFilePath)) {
      return reject(new Error('Ambos os arquivos (legado e composer) devem existir no disco para comparação'));
    }

    execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-show_entries', 'format=duration', '-of', 'json', legacyFilePath], (err1, stdout1) => {
      if (err1) return reject(err1);
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-show_entries', 'format=duration', '-of', 'json', composerFilePath], (err2, stdout2) => {
        if (err2) return reject(err2);

        const leg = JSON.parse(stdout1);
        const cmp = JSON.parse(stdout2);

        const legDur = Math.round(parseFloat(leg.format?.duration || '0') * 1000);
        const cmpDur = Math.round(parseFloat(cmp.format?.duration || '0') * 1000);
        const durDiff = Math.abs(legDur - cmpDur);

        const legVideo = leg.streams.find(s => s.codec_type === 'video');
        const cmpVideo = cmp.streams.find(s => s.codec_type === 'video');
        const legAudio = leg.streams.find(s => s.codec_type === 'audio');
        const cmpAudio = cmp.streams.find(s => s.codec_type === 'audio');

        const isEquivalent = Boolean(
          durDiff <= toleranceMs &&
          cmpVideo && legVideo &&
          Number(cmpVideo.width) === 1080 && Number(cmpVideo.height) === 1920 &&
          cmpAudio && legAudio
        );

        resolve({
          is_equivalent: isEquivalent,
          duration_diff_ms: durDiff,
          tolerance_ms: toleranceMs,
          legacy: { duration_ms: legDur, width: legVideo?.width, height: legVideo?.height },
          composer: { duration_ms: cmpDur, width: cmpVideo?.width, height: cmpVideo?.height }
        });
      });
    });
  });
}

module.exports = {
  COMPOSER_CONTRACT_VERSION,
  COMPOSER_DURATION_TOLERANCE_MS,
  validateBlueprintContract,
  resolveTimelineAssets,
  computeRenderKey,
  buildExecutionPlan,
  claimRenderLock,
  renderTimelineFFmpeg,
  verifyAndPromoteOutput,
  composeCreative,
  compareLegacyVsComposer
};
