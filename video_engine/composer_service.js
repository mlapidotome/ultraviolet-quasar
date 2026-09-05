/**
 * Módulo Video Composer Engine — Video Engine V2
 * Bali Imóveis (Fase 3C.1 — Editing Styles & Overlays Dinâmicos)
 * 
 * Responsabilidades:
 * 1. Execução determinística e pura orientada por Creative Blueprint (1.0 e 1.1)
 * 2. Suporte estrito a Editing Styles Versionáveis com style_hash intrínseco
 * 3. Compilação e sanitização de Overlays e Captions via Overlay Engine
 * 4. Cálculo profundo da render_key (composer_v1 para 1.0 e composer_v2 para 1.1)
 * 5. Claim atômico persistente de renderização no PostgreSQL com lease e stale recovery
 * 6. Resolução rigorosa de assets via Asset Resolver com validação de ownership físico do Job
 * 7. Determinação da duração física real (specs.duration) descartando placeholders
 * 8. Pipeline canônico único de re-encode FFmpeg (H.264 1080x1920@30fps + AAC) com trims bilaterais e overlays
 * 9. Escrita atômica via arquivo temporário único (.tmp.<uuid>.mp4) e rename atômico pós-ffprobe
 * 10. Saída física imutável (assets ready nunca são sobrescritos)
 * 11. Modo Shadow 3C (asset_type: 'shadow_creative_3c') com isolamento absoluto do pipeline oficial da Fase 2C
 * 12. Validação semântica e tolerância configurável de duração (COMPOSER_DURATION_TOLERANCE_MS)
 * 13. Proteção estrita contra path traversal e filter injection
 * 14. Invariante estrito: FFmpeg NUNCA executa sem claim.acquired === true
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { getPool } = require('./db');
const assetService = require('./asset_service');
const { resolveEditingStyle, validateFontRegistry } = require('./styles/presets');
const overlayService = require('./overlay_service');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

// Configurações do Composer Engine
const COMPOSER_DURATION_TOLERANCE_MS = parseInt(process.env.COMPOSER_DURATION_TOLERANCE_MS || '250', 10);
const STALE_RENDER_TIMEOUT_MINUTES = 5;
const FFMPEG_TIMEOUT_MS = 180000; // 3 minutos
const CREATIVE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 1. Validação do Contrato do Blueprint (Fail-Fast Pré-FFmpeg)
 * @param {Object} blueprint
 * @returns {boolean}
 */
function validateBlueprintContract(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Blueprint nulo ou inválido');
  }

  const schemaVersion = String(blueprint.schema_version || '1.0');
  if (schemaVersion !== '1.0' && schemaVersion !== '1.1') {
    throw new Error(`[COMPOSER VALIDATION ERROR] schema_version '${blueprint.schema_version}' não suportada (esperado '1.0' ou '1.1')`);
  }

  if (!blueprint.creative_id || typeof blueprint.creative_id !== 'string' || !CREATIVE_ID_REGEX.test(blueprint.creative_id)) {
    throw new Error(`[COMPOSER VALIDATION ERROR] creative_id inválido (${blueprint.creative_id}). Deve conter apenas letras, números, hífen e underscore (1-64 caracteres)`);
  }

  if (!blueprint.format || typeof blueprint.format !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Objeto format é obrigatório');
  }

  const { aspect_ratio, width, height, fps } = blueprint.format;
  if (aspect_ratio !== '9:16' || Number(width) !== 1080 || Number(height) !== 1920 || Number(fps) !== 30) {
    throw new Error(`[COMPOSER VALIDATION ERROR] Formato ${width}x${height}@${fps} (${aspect_ratio}) não suportado (esperado 1080x1920@30fps 9:16)`);
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

    // Contrato Bilateral de Trims
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

  // Validação específica de Blueprint 1.1
  if (schemaVersion === '1.1') {
    if (!blueprint.editing_style || typeof blueprint.editing_style !== 'object') {
      throw new Error('[COMPOSER VALIDATION ERROR] Blueprint 1.1 exige o objeto editing_style');
    }
    const { style_id, version } = blueprint.editing_style;
    if (!style_id || version === undefined) {
      throw new Error('[COMPOSER VALIDATION ERROR] editing_style exige style_id e version');
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
    const asset = await assetService.resolveAndValidateAsset(seg.asset_id, { checkFile: true, checkHash: true });

    if (asset.job_id && String(asset.job_id) !== String(jobId)) {
      throw new Error(`[COMPOSER SECURITY ERROR] Asset ${asset.id} pertence ao Job ${asset.job_id} e não ao Job ${jobId}`);
    }

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
 * @param {Object} [resolvedStyle=null]
 * @returns {string} SHA-256 hex
 */
function computeRenderKey(blueprint, resolvedAssets, resolvedStyle = null) {
  const schemaVersion = String(blueprint.schema_version || '1.0');
  
  const inputAssetsCanonical = resolvedAssets.map(item => ({
    segment_index: item.segment_index,
    role: item.role,
    asset_id: item.asset.id,
    file_hash: item.file_hash
  }));

  const timelineCanonical = blueprint.timeline.map((seg, idx) => ({
    segment_index: seg.segment_index || (idx + 1),
    role: seg.role,
    asset_id: seg.asset_id,
    layer: seg.layer || 0,
    source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
    source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
  }));

  // Caminho 1.0 (Preserva estritamente a fórmula homologada da Fase 3B)
  if (schemaVersion === '1.0') {
    const renderSpec10 = {
      schema_version: '1.0',
      composer_contract_version: 'composer_v1',
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
    const canonicalJSON10 = assetService.canonicalStringify(renderSpec10);
    return crypto.createHash('sha256').update(canonicalJSON10, 'utf8').digest('hex');
  }

  // Caminho 1.1 (Fase 3C — composer_v2 com style_hash, overlays e captions)
  const canonicalOverlays = (blueprint.overlays || [])
    .map(ov => {
      const presetObj = resolvedStyle?.overlay_presets?.[ov.preset] || {};
      return {
        id: String(ov.id),
        layer_order: Number(ov.layer_order),
        type: String(ov.type),
        text: overlayService.sanitizeDrawtextString(ov.text),
        start_ms: Number(ov.start_ms),
        end_ms: Number(ov.end_ms),
        position: String(ov.position),
        preset: String(ov.preset),
        preset_resolved: {
          font_id: presetObj.font_id,
          font_size: presetObj.font_size,
          text_color: presetObj.text_color,
          box_color: presetObj.box_color,
          box_padding: presetObj.box_padding,
          punch_zoom: Boolean(presetObj.punch_zoom)
        }
      };
    })
    .sort((a, b) => a.layer_order - b.layer_order);

  const canonicalCaptions = (blueprint.captions || [])
    .map(c => ({
      start_ms: Number(c.start_ms),
      end_ms: Number(c.end_ms),
      text: overlayService.sanitizeDrawtextString(c.text)
    }))
    .sort((a, b) => a.start_ms - b.start_ms);

  const renderSpec11 = {
    schema_version: '1.1',
    composer_contract_version: 'composer_v2',
    creative_id: String(blueprint.creative_id),
    blueprint_version: Number(blueprint.blueprint_version || 1),
    format: {
      aspect_ratio: String(blueprint.format.aspect_ratio || '9:16').trim(),
      width: Number(blueprint.format.width || 1080),
      height: Number(blueprint.format.height || 1920),
      fps: Number(blueprint.format.fps || 30)
    },
    editing_style: {
      style_id: String(resolvedStyle.id),
      version: Number(resolvedStyle.version),
      style_hash: String(resolvedStyle.style_hash) // SHA-256 físico de todo o preset
    },
    timeline: timelineCanonical,
    overlays: canonicalOverlays,
    captions: canonicalCaptions,
    input_assets: inputAssetsCanonical
  };

  const canonicalJSON11 = assetService.canonicalStringify(renderSpec11);
  return crypto.createHash('sha256').update(canonicalJSON11, 'utf8').digest('hex');
}

/**
 * 4. Construção do Plano de Execução e Linha do Tempo Real
 * @param {Object} blueprint
 * @param {Array} resolvedAssets
 * @returns {Object} Execution plan
 */
function buildExecutionPlan(blueprint, resolvedAssets) {
  let accumulatedTimelineMs = 0;
  const segmentsPlan = [];

  for (const item of resolvedAssets) {
    let segmentDurationMs = item.duration_ms;

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
 * 5. Claim Atômico Persistente no PostgreSQL
 * @returns {Promise<{ acquired: boolean, asset: Object }>}
 */
async function claimRenderLock({
  outputAssetId,
  jobId,
  propertyRef,
  renderKey,
  assetType = 'shadow_creative_3c',
  metadata = {}
}) {
  const pool = getPool();

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

  const existingRes = await pool.query('SELECT * FROM video_assets WHERE id = $1', [outputAssetId]);
  const existingAsset = existingRes.rows[0] || null;

  return { acquired: false, asset: existingAsset };
}

/**
 * 6. Pipeline Canônico de Re-encode FFmpeg com Trims e Overlays Dinâmicos
 * @param {Object} params
 * @returns {Promise<void>}
 */
function renderTimelineFFmpeg({ executionPlan, tempOutputPath, resolvedStyle = null }) {
  return new Promise((resolve, reject) => {
    const segments = executionPlan.segments;
    const blueprint = executionPlan.blueprint;
    const n = segments.length;

    if (n < 1) {
      return reject(new Error('[FFMPEG ERROR] Nenhum segmento para renderizar'));
    }

    const args = ['-y'];

    // Entradas
    for (const seg of segments) {
      args.push('-i', seg.storage_path);
    }

    // 1. Concatenação Canônica dos Segmentos com Trims Bilaterais
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
        vFilter = `[${i}:v]setpts=PTS-STARTPTS[v${i}]`;
        aFilter = `[${i}:a]asetpts=PTS-STARTPTS[a${i}]`;
      }

      filterParts.push(vFilter);
      filterParts.push(aFilter);
      concatInputs += `[v${i}][a${i}]`;
    }

    const concatVLabel = (blueprint.schema_version === '1.1' && (blueprint.overlays?.length > 0 || blueprint.captions?.length > 0))
      ? '[v_concat]'
      : '[outv]';

    const concatFilter = `${concatInputs}concat=n=${n}:v=1:a=1${concatVLabel}[outa]`;
    filterParts.push(concatFilter);

    // 2. Compilação de Overlays e Captions (se Blueprint 1.1)
    let finalVideoMap = concatVLabel;
    if (blueprint.schema_version === '1.1' && resolvedStyle) {
      const overlayCompiled = overlayService.compileOverlayFiltergraph({
        inputStreamLabel: concatVLabel,
        overlays: blueprint.overlays || [],
        captions: blueprint.captions || [],
        style: resolvedStyle
      });

      if (overlayCompiled.filterNodes.length > 0) {
        filterParts.push(...overlayCompiled.filterNodes);
        finalVideoMap = overlayCompiled.outputStreamLabel;
      }
    }

    const filterString = filterParts.join(';');

    args.push(
      '-filter_complex', filterString,
      '-map', finalVideoMap,
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
        if (stderrBuffer.length > 102400) {
          stderrBuffer = stderrBuffer.slice(-102400);
        }
      });
    }
  });
}

/**
 * 7. Inspeção Pós-Render Rigorosa (QC) e Promoção Atômica Segura
 * @param {Object} params
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

          if (videoStream.codec_name !== 'h264') {
            return reject(new Error(`[VALIDATION ERROR] Codec de vídeo inválido: esperado 'h264', obtido '${videoStream.codec_name}'`));
          }
          if (audioStream.codec_name !== 'aac') {
            return reject(new Error(`[VALIDATION ERROR] Codec de áudio inválido: esperado 'aac', obtido '${audioStream.codec_name}'`));
          }

          if (Number(videoStream.width) !== 1080 || Number(videoStream.height) !== 1920) {
            return reject(new Error(`[VALIDATION ERROR] Dimensões inválidas: esperado 1080x1920, obtido ${videoStream.width}x${videoStream.height}`));
          }

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

          const durationDiff = Math.abs(formatDurationMs - expectedDurationMs);
          if (durationDiff > toleranceMs) {
            return reject(new Error(`[VALIDATION ERROR] Duração final (${formatDurationMs}ms) diverge da esperada (${expectedDurationMs}ms) além da tolerância permitida (${toleranceMs}ms)`));
          }

          const vDur = parseFloat(videoStream.duration || formatDuration);
          const aDur = parseFloat(audioStream.duration || formatDuration);
          if (Math.abs(vDur - aDur) > 0.200) {
            return reject(new Error(`[VALIDATION ERROR] Descompasso excessivo entre streams de vídeo (${vDur}s) e áudio (${aDur}s)`));
          }

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
  const schemaVersion = String(blueprint.schema_version || '1.0');

  // 2. Resolução de Assets da Timeline
  const resolvedAssets = await resolveTimelineAssets(jobId, blueprint.timeline);

  // 3. Resolução de Style e Validações Específicas de 1.1
  let resolvedStyle = null;
  const executionPlan = buildExecutionPlan(blueprint, resolvedAssets);

  if (schemaVersion === '1.1') {
    resolvedStyle = resolveEditingStyle(blueprint.editing_style.style_id, blueprint.editing_style.version);
    overlayService.validateOverlays(blueprint.overlays || [], resolvedStyle, executionPlan.total_duration_ms);
    overlayService.validateCaptions(blueprint.captions || [], executionPlan.total_duration_ms);
  }

  // 4. Cálculo Determinístico da render_key
  const renderKey = computeRenderKey(blueprint, resolvedAssets, resolvedStyle);
  const shortRenderKey = renderKey.slice(0, 10);
  const creativeId = blueprint.creative_id;
  
  let prefix = 'composer_';
  let assetType = 'rendered_creative';
  if (isShadow) {
    if (schemaVersion === '1.1') {
      prefix = 'shadow_3c_';
      assetType = 'shadow_creative_3c';
    } else {
      prefix = 'shadow_';
      assetType = 'shadow_creative';
    }
  }

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
    assetType,
    metadata: {
      creative_id: creativeId,
      blueprint_version: blueprint.blueprint_version,
      schema_version: schemaVersion,
      render_key: renderKey,
      temp_filename: tempFilename,
      style_id: resolvedStyle ? resolvedStyle.id : null,
      style_version: resolvedStyle ? resolvedStyle.version : null
    }
  });

  if (!claim.acquired) {
    const existing = claim.asset;
    if (!existing) {
      const err = new Error(`[COMPOSER ERROR] Asset ${outputAssetId} não encontrado no catálogo após falha de claim`);
      err.statusCode = 500;
      throw err;
    }

    if (existing.status === 'ready') {
      const hasValidPath = existing.storage_path && fs.existsSync(existing.storage_path);
      let isValidHash = false;
      if (hasValidPath) {
        const currentHash = assetService.computeFileHash(existing.storage_path);
        isValidHash = (currentHash === existing.file_hash);
      }

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

      // Recuperação controlada de READY quebrado
      console.warn(`[COMPOSER RECOVERY] Asset ${outputAssetId} marcado como READY porém com integridade violada (file: ${hasValidPath}, hash: ${isValidHash}). Invalidando e tentando novo claim...`);
      await assetService.markAssetFailed(outputAssetId, 'CORRUPTED_OR_MISSING_PHYSICAL_FILE');
      
      claim = await claimRenderLock({
        outputAssetId,
        jobId,
        propertyRef: blueprint.property_ref,
        renderKey,
        assetType,
        metadata: {
          creative_id: creativeId,
          blueprint_version: blueprint.blueprint_version,
          schema_version: schemaVersion,
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
      const err = new Error(`[COMPOSER CONCURRENCY] Render para criativo ${creativeId} já está em andamento por outro processo`);
      err.statusCode = 409;
      throw err;
    } else {
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
    console.log(`[COMPOSER] Iniciando renderização para criativo ${creativeId} (schema: ${schemaVersion}, render_key: ${shortRenderKey})...`);
    await renderTimelineFFmpeg({ executionPlan, tempOutputPath, resolvedStyle });

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
        schema_version: schemaVersion,
        is_shadow: isShadow,
        editing_style: resolvedStyle ? { style_id: resolvedStyle.id, version: resolvedStyle.version, style_hash: resolvedStyle.style_hash } : null,
        execution_plan: {
          total_duration_ms: executionPlan.total_duration_ms,
          segments_count: executionPlan.segments.length,
          overlays_count: (blueprint.overlays || []).length,
          captions_count: (blueprint.captions || []).length
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
    if (fs.existsSync(tempOutputPath)) {
      try { fs.unlinkSync(tempOutputPath); } catch (e) {}
    }
    await assetService.markAssetFailed(outputAssetId, renderError.message);
    throw renderError;
  }
}

/**
 * 9. Comparador Técnico Shadow 3C vs Legado (Inspeção Estrutural de Duração e Streams)
 * Nota: 3C deliberadamente altera pixels, portanto a comparação foca em conformidade técnica e integridade.
 * @param {string} legacyFilePath
 * @param {string} shadow3cFilePath
 * @param {number} toleranceMs
 * @returns {Promise<Object>}
 */
function compareShadow3cWithLegacy(legacyFilePath, shadow3cFilePath, toleranceMs = COMPOSER_DURATION_TOLERANCE_MS) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(legacyFilePath) || !fs.existsSync(shadow3cFilePath)) {
      return reject(new Error('Ambos os arquivos devem existir no disco para comparação técnica'));
    }

    execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration', '-show_entries', 'format=duration,size', '-of', 'json', legacyFilePath], (err1, stdout1) => {
      if (err1) return reject(err1);
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,duration', '-show_entries', 'format=duration,size', '-of', 'json', shadow3cFilePath], (err2, stdout2) => {
        if (err2) return reject(err2);

        const leg = JSON.parse(stdout1);
        const sh3c = JSON.parse(stdout2);

        const legDur = Math.round(parseFloat(leg.format?.duration || '0') * 1000);
        const sh3cDur = Math.round(parseFloat(sh3c.format?.duration || '0') * 1000);
        const durDiff = Math.abs(legDur - sh3cDur);

        const legVideo = leg.streams.find(s => s.codec_type === 'video');
        const sh3cVideo = sh3c.streams.find(s => s.codec_type === 'video');
        const legAudio = leg.streams.find(s => s.codec_type === 'audio');
        const sh3cAudio = sh3c.streams.find(s => s.codec_type === 'audio');

        const technicalPass = Boolean(
          durDiff <= toleranceMs &&
          sh3cVideo && legVideo &&
          Number(sh3cVideo.width) === 1080 && Number(sh3cVideo.height) === 1920 &&
          sh3cAudio && legAudio
        );

        resolve({
          technical_pass: technicalPass,
          duration_diff_ms: durDiff,
          tolerance_ms: toleranceMs,
          legacy: { duration_ms: legDur, width: legVideo?.width, height: legVideo?.height, codec_video: legVideo?.codec_name },
          shadow_3c: { duration_ms: sh3cDur, width: sh3cVideo?.width, height: sh3cVideo?.height, codec_video: sh3cVideo?.codec_name, size_bytes: sh3c.format?.size }
        });
      });
    });
  });
}

module.exports = {
  COMPOSER_DURATION_TOLERANCE_MS,
  validateBlueprintContract,
  resolveTimelineAssets,
  computeRenderKey,
  buildExecutionPlan,
  claimRenderLock,
  renderTimelineFFmpeg,
  verifyAndPromoteOutput,
  composeCreative,
  compareShadow3cWithLegacy
};
