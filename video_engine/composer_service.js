/**
 * Módulo Video Composer Engine — Video Engine V2
 * Bali Imóveis (Fase 3C.2 — B-Roll Dinâmico & Picture-in-Picture)
 * 
 * Responsabilidades:
 * 1. Execução determinística e pura orientada por Creative Blueprint (1.0, 1.1 e 1.2)
 * 2. Suporte a Blueprint 1.2 (visual_timeline multicamada, B-roll de fotos/vídeos, PIP com lip-sync)
 * 3. Suporte estrito a Editing Styles Versionáveis com style_hash intrínseco
 * 4. Compilação e sanitização de Overlays, Captions e PIP via Overlay Engine
 * 5. Cálculo profundo da render_key (composer_v1 para 1.0, composer_v2 para 1.1, composer_v3 para 1.2)
 * 6. Claim atômico persistente de renderização no PostgreSQL com lease e stale recovery
 * 7. Resolução rigorosa de assets via Asset Resolver com validação de ownership físico e file_hash dos bytes
 * 8. Determinação da duração física real (specs.duration) descartando placeholders
 * 9. Pipeline canônico único de re-encode FFmpeg (H.264 1080x1920@30fps + AAC) com Ken Burns, PIP e overlays
 * 10. Escrita atômica via arquivo temporário único (.tmp.<uuid>.mp4) e rename atômico pós-ffprobe
 * 11. Saída física imutável (assets ready nunca são sobrescritos)
 * 12. Modo Shadow 3C.2 (asset_type: 'shadow_creative_3c2') com isolamento absoluto do pipeline oficial
 * 13. Validação semântica e tolerância configurável de duração (COMPOSER_DURATION_TOLERANCE_MS)
 * 14. Proteção estrita contra path traversal, filter injection e colisões espaço-temporais
 * 15. Invariante estrito: FFmpeg NUNCA executa sem claim.acquired === true
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { getPool } = require('./db');
const assetService = require('./asset_service');
const { resolveEditingStyle, validateFontRegistry } = require('./styles/presets');
const overlayService = require('./overlay_service');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

// Configurações do Composer Engine
const COMPOSER_DURATION_TOLERANCE_MS = parseInt(process.env.COMPOSER_DURATION_TOLERANCE_MS || '250', 10);
const STALE_RENDER_TIMEOUT_MINUTES = 10;
const FFMPEG_TIMEOUT_MS = parseInt(process.env.COMPOSER_FFMPEG_TIMEOUT_MS || '600000', 10); // 10 minutos
const CREATIVE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Helper para resolver geometria do PIP a partir de preset ou custom
 */
function resolvePipGeometry(win, resolvedStyle) {
  if (win.position === 'custom' || win.geometry) {
    const g = win.geometry || {};
    const x = Number(g.x !== undefined ? g.x : 680);
    const y = Number(g.y !== undefined ? g.y : 1140);
    const width = Number(g.width !== undefined ? g.width : 340);
    const height = Number(g.height !== undefined ? g.height : 510);
    return {
      x,
      y,
      width,
      height,
      shape: win.shape || 'rounded_rect',
      border_radius: win.border?.radius !== undefined ? Number(win.border.radius) : 24,
      border_width: win.border?.width !== undefined ? Number(win.border.width) : 4,
      border_color: win.border?.color || '#FFFFFF'
    };
  }

  const preset = resolvedStyle?.pip_presets?.[win.position] || resolvedStyle?.pip_presets?.bottom_right || {
    x: 680,
    y: 1140,
    width: 340,
    height: 510,
    shape: 'rounded_rect',
    border_radius: 24,
    border_width: 4,
    border_color: '#FFFFFF'
  };

  return {
    x: preset.x,
    y: preset.y,
    width: preset.width,
    height: preset.height,
    shape: win.shape || preset.shape || 'rounded_rect',
    border_radius: win.border?.radius !== undefined ? Number(win.border.radius) : (preset.border_radius || 24),
    border_width: win.border?.width !== undefined ? Number(win.border.width) : (preset.border_width || 4),
    border_color: win.border?.color || preset.border_color || '#FFFFFF'
  };
}

/**
 * Validação de Colisão Espaço-Temporal entre PIP e Overlays/Captions
 */
function validateSpatiotemporalCollisions(blueprint, resolvedStyle) {
  if (!blueprint.pip || !blueprint.pip.enabled || !Array.isArray(blueprint.pip.windows) || blueprint.pip.windows.length === 0) {
    return;
  }

  const overlays = blueprint.overlays || [];
  const captions = blueprint.captions || [];

  const aabbOverlap = (b1, b2) => {
    return b1.x < b2.x + b2.w && b1.x + b1.w > b2.x &&
           b1.y < b2.y + b2.h && b1.y + b1.h > b2.y;
  };

  const timeOverlap = (t1_start, t1_end, t2_start, t2_end) => {
    return Math.max(t1_start, t2_start) < Math.min(t1_end, t2_end);
  };

  for (let wIdx = 0; wIdx < blueprint.pip.windows.length; wIdx++) {
    const win = blueprint.pip.windows[wIdx];
    const pipGeom = resolvePipGeometry(win, resolvedStyle);
    const pipBox = { x: pipGeom.x, y: pipGeom.y, w: pipGeom.width, h: pipGeom.height };

    // 1. Colisão contra Overlays Ativos
    for (const ov of overlays) {
      const ovSafe = resolvedStyle?.safe_rectangles?.[ov.position] || { x_min: 60, x_max: 1020, y_min: 1540, y_max: 1720 };
      const ovBox = { x: ovSafe.x_min, y: ovSafe.y_min, w: ovSafe.x_max - ovSafe.x_min, h: ovSafe.y_max - ovSafe.y_min };

      if (timeOverlap(win.start_ms, win.end_ms, ov.start_ms, ov.end_ms) && aabbOverlap(pipBox, ovBox)) {
        throw new Error(`[COMPOSER COLLISION ERROR] Janela de PIP ${wIdx + 1} (${win.start_ms}-${win.end_ms}ms) colide espaço-temporalmente com o overlay '${ov.id}' (${ov.start_ms}-${ov.end_ms}ms) na região [${ov.position}]`);
      }
    }

    // 2. Colisão contra Captions Ativos
    if (resolvedStyle?.safe_rectangles?.captions) {
      const capSafe = resolvedStyle.safe_rectangles.captions;
      const capBox = { x: capSafe.x_min, y: capSafe.y_min, w: capSafe.x_max - capSafe.x_min, h: capSafe.y_max - capSafe.y_min };

      for (const cap of captions) {
        if (timeOverlap(win.start_ms, win.end_ms, cap.start_ms, cap.end_ms) && aabbOverlap(pipBox, capBox)) {
          throw new Error(`[COMPOSER COLLISION ERROR] Janela de PIP ${wIdx + 1} (${win.start_ms}-${win.end_ms}ms) colide espaço-temporalmente com a legenda (${cap.start_ms}-${cap.end_ms}ms: "${cap.text.slice(0, 20)}...")`);
        }
      }
    }
  }
}

/**
 * 1. Validação do Contrato do Blueprint (Fail-Fast Pré-FFmpeg)
 * Suporta Blueprint 1.0, 1.1 e 1.2
 * @param {Object} blueprint
 * @returns {boolean}
 */
function validateBlueprintContract(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Blueprint nulo ou inválido');
  }

  const schemaVersion = String(blueprint.schema_version || '1.0');
  if (schemaVersion !== '1.0' && schemaVersion !== '1.1' && schemaVersion !== '1.2') {
    throw new Error(`[COMPOSER VALIDATION ERROR] schema_version '${blueprint.schema_version}' não suportada (esperado '1.0', '1.1' ou '1.2')`);
  }

  if (!blueprint.creative_id || typeof blueprint.creative_id !== 'string' || !CREATIVE_ID_REGEX.test(blueprint.creative_id)) {
    throw new Error(`[COMPOSER VALIDATION ERROR] creative_id inválido (${blueprint.creative_id}). Deve conter apenas letras, números, hífen e underscore (1-64 caracteres)`);
  }

  if (typeof blueprint.format === 'string') {
    if (blueprint.format.trim() !== '9:16') {
      throw new Error(`[COMPOSER VALIDATION ERROR] Formato '${blueprint.format}' não suportado (esperado 1080x1920@30fps 9:16)`);
    }
    blueprint.format = { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 };
  } else if (!blueprint.format || typeof blueprint.format !== 'object') {
    throw new Error('[COMPOSER VALIDATION ERROR] Objeto format é obrigatório');
  } else {
    const { aspect_ratio = '9:16', width = 1080, height = 1920, fps = 30 } = blueprint.format;
    if (aspect_ratio !== '9:16' || Number(width) !== 1080 || Number(height) !== 1920 || Number(fps) !== 30) {
      throw new Error(`[COMPOSER VALIDATION ERROR] Formato ${width}x${height}@${fps} (${aspect_ratio}) não suportado (esperado 1080x1920@30fps 9:16)`);
    }
  }

  // Validação específica de Blueprint 1.0 e 1.1 (Timeline Sequencial Simples)
  if (schemaVersion === '1.0' || schemaVersion === '1.1') {
    if (!Array.isArray(blueprint.timeline) || blueprint.timeline.length === 0) {
      throw new Error('[COMPOSER VALIDATION ERROR] Timeline do Blueprint está vazia');
    }

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

  // Validação específica de Blueprint 1.2 (Fase 3C.2 — B-Roll + PIP)
  if (schemaVersion === '1.2') {
    if (!blueprint.editing_style || typeof blueprint.editing_style !== 'object') {
      throw new Error('[COMPOSER VALIDATION ERROR] Blueprint 1.2 exige o objeto editing_style');
    }
    const { style_id, version } = blueprint.editing_style;
    if (!style_id || version === undefined) {
      throw new Error('[COMPOSER VALIDATION ERROR] editing_style exige style_id e version');
    }

    // 1. Validar audio_track
    if (!blueprint.audio_track || typeof blueprint.audio_track !== 'object') {
      throw new Error('[COMPOSER VALIDATION ERROR] Blueprint 1.2 exige o objeto audio_track');
    }
    if (!blueprint.audio_track.primary_asset_id || typeof blueprint.audio_track.primary_asset_id !== 'string') {
      throw new Error('[COMPOSER VALIDATION ERROR] audio_track.primary_asset_id é obrigatório');
    }
    if (blueprint.audio_track.broll_audio_policy && blueprint.audio_track.broll_audio_policy !== 'mute_all_broll') {
      throw new Error(`[COMPOSER VALIDATION ERROR] broll_audio_policy '${blueprint.audio_track.broll_audio_policy}' inválida. Apenas 'mute_all_broll' é suportada na Fase 3C.2.`);
    }

    // 2. Validar visual_timeline
    if (!Array.isArray(blueprint.visual_timeline) || blueprint.visual_timeline.length === 0) {
      throw new Error('[COMPOSER VALIDATION ERROR] visual_timeline do Blueprint 1.2 está vazia');
    }

    for (let i = 0; i < blueprint.visual_timeline.length; i++) {
      const seg = blueprint.visual_timeline[i];
      if (!seg.asset_id || typeof seg.asset_id !== 'string') {
        throw new Error(`[COMPOSER VALIDATION ERROR] Segmento visual ${i + 1} sem asset_id válido`);
      }

      const assetType = seg.asset_type || 'image';
      if (assetType !== 'image' && assetType !== 'video') {
        throw new Error(`[COMPOSER VALIDATION ERROR] Segmento visual ${i + 1} (${seg.asset_id}) possui asset_type inválido '${seg.asset_type}' (esperado 'image' ou 'video')`);
      }

      const startMs = Number(seg.start_ms);
      const endMs = Number(seg.end_ms);
      if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
        throw new Error(`[COMPOSER VALIDATION ERROR] Segmento visual ${i + 1} (${seg.asset_id}) possui intervalo de tempo inválido: 0 <= start_ms (${seg.start_ms}) < end_ms (${seg.end_ms}) obrigatório`);
      }
      const segDurationMs = endMs - startMs;

      // Regra: Imagem NÃO aceita source trim
      if (assetType === 'image') {
        if ((seg.source_in_ms !== null && seg.source_in_ms !== undefined) || (seg.source_out_ms !== null && seg.source_out_ms !== undefined)) {
          throw new Error(`[COMPOSER VALIDATION ERROR] Segmento de imagem ${i + 1} (${seg.asset_id}) não aceita source_in_ms/source_out_ms`);
        }
      }

      // Regra: Vídeo com trim 1:1 rigoroso
      if (assetType === 'video') {
        const hasIn = seg.source_in_ms !== null && seg.source_in_ms !== undefined;
        const hasOut = seg.source_out_ms !== null && seg.source_out_ms !== undefined;

        if (hasIn !== hasOut) {
          throw new Error(`[COMPOSER VALIDATION ERROR] Segmento de vídeo ${i + 1} (${seg.asset_id}) possui trim unilateral: source_in_ms e source_out_ms devem ser fornecidos juntos`);
        }

        if (hasIn && hasOut) {
          const inMs = Number(seg.source_in_ms);
          const outMs = Number(seg.source_out_ms);
          if (isNaN(inMs) || isNaN(outMs) || inMs < 0 || inMs >= outMs) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Segmento de vídeo ${i + 1} (${seg.asset_id}) possui trim inválido: 0 <= source_in_ms < source_out_ms obrigatório`);
          }

          const trimDurationMs = outMs - inMs;
          if (trimDurationMs !== segDurationMs) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Divergência de duração no segmento ${i + 1}: source trim (${trimDurationMs}ms) deve ser exatamente igual à duração do segmento na timeline (${segDurationMs}ms). Alteração de playback rate não é suportada na Fase 3C.2.`);
          }
        }
      }

      // Validação de Sequencialidade e Transições
      if (i === 0) {
        if (startMs !== 0) {
          throw new Error(`[COMPOSER VALIDATION ERROR] Primeiro segmento da timeline visual deve iniciar exatamente em start_ms = 0 (obtido: ${startMs})`);
        }
        if (seg.transition_in && seg.transition_in.type === 'crossfade') {
          throw new Error(`[COMPOSER VALIDATION ERROR] Primeiro segmento da timeline visual não pode ter transition_in 'crossfade' vindo do vazio`);
        }
      } else {
        const prev = blueprint.visual_timeline[i - 1];
        const isCrossfade = seg.transition_in && seg.transition_in.type === 'crossfade';

        if (isCrossfade) {
          const transDur = Number(seg.transition_in.duration_ms || 250);
          if (isNaN(transDur) || transDur < 100 || transDur > 600) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Segmento ${i + 1} possui duration_ms de crossfade inválido (${seg.transition_in.duration_ms}). Deve estar entre 100 e 600ms.`);
          }
          const expectedStart = prev.end_ms - transDur;
          if (startMs !== expectedStart) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Segmento ${i + 1} com crossfade deve ter start_ms (${startMs}) exatamente igual a end_ms anterior (${prev.end_ms}) menos duration_ms (${transDur}) = ${expectedStart}ms`);
          }
        } else {
          // CUT (sem gap e sem overlap)
          if (startMs > prev.end_ms) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Gap na visual_timeline detectado entre segmento ${i} (fim: ${prev.end_ms}ms) e segmento ${i + 1} (início: ${startMs}ms)`);
          }
          if (startMs < prev.end_ms) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Overlap arbitrário não declarado como crossfade entre segmento ${i} (fim: ${prev.end_ms}ms) e segmento ${i + 1} (início: ${startMs}ms)`);
          }
        }
      }
    }

    // 3. Validar PIP (se presente)
    if (blueprint.pip && blueprint.pip.enabled) {
      if (!blueprint.pip.asset_id || typeof blueprint.pip.asset_id !== 'string') {
        throw new Error('[COMPOSER VALIDATION ERROR] pip.asset_id é obrigatório quando pip.enabled = true');
      }

      if (Array.isArray(blueprint.pip.windows)) {
        for (let w = 0; w < blueprint.pip.windows.length; w++) {
          const win = blueprint.pip.windows[w];
          const wStart = Number(win.start_ms);
          const wEnd = Number(win.end_ms);
          if (isNaN(wStart) || isNaN(wEnd) || wStart < 0 || wStart >= wEnd) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} possui intervalo inválido: 0 <= start_ms < end_ms`);
          }

          if (win.position && !['bottom_right', 'bottom_left', 'center_right', 'custom'].includes(win.position)) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} possui position inválida '${win.position}'`);
          }

          if (win.position === 'custom') {
            if (!win.geometry || typeof win.geometry !== 'object') {
              throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} com position 'custom' exige objeto geometry`);
            }
            const { x, y, width, height } = win.geometry;
            if (x === undefined || y === undefined || width === undefined || height === undefined) {
              throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} custom exige x, y, width e height explícitos`);
            }
            if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1080 || y + height > 1920) {
              throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} possui geometria fora dos limites 1080x1920: x=${x}, y=${y}, w=${width}, h=${height}`);
            }
          }

          // Validação de Lip-Sync Trim no PIP
          const hasIn = win.source_in_ms !== null && win.source_in_ms !== undefined;
          const hasOut = win.source_out_ms !== null && win.source_out_ms !== undefined;
          if (hasIn !== hasOut) {
            throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} possui trim unilateral: source_in_ms e source_out_ms devem ser fornecidos juntos`);
          }
          if (hasIn && hasOut) {
            const inMs = Number(win.source_in_ms);
            const outMs = Number(win.source_out_ms);
            if (inMs < 0 || inMs >= outMs || (outMs - inMs) !== (wEnd - wStart)) {
              throw new Error(`[COMPOSER VALIDATION ERROR] Janela de PIP ${w + 1} possui divergência de duração de trim (${outMs - inMs}ms) vs timeline (${wEnd - wStart}ms)`);
            }
          }
        }
      }
    }
  }

  return true;
}

/**
 * 2. Resolução Segura de Assets da Timeline (com Verificação Física de file_hash)
 * @param {string} jobId
 * @param {Object} blueprint
 * @returns {Promise<Object>} Assets resolvidos e mapa indexado
 */
async function resolveTimelineAssets(jobId, blueprint) {
  const schemaVersion = String(blueprint.schema_version || '1.0');
  const uniqueAssetIds = new Set();

  if (schemaVersion === '1.0' || schemaVersion === '1.1') {
    for (const seg of blueprint.timeline || []) {
      if (seg.asset_id) uniqueAssetIds.add(seg.asset_id);
    }
  } else if (schemaVersion === '1.2') {
    if (blueprint.audio_track?.primary_asset_id) {
      uniqueAssetIds.add(blueprint.audio_track.primary_asset_id);
    }
    for (const seg of blueprint.visual_timeline || []) {
      if (seg.asset_id) uniqueAssetIds.add(seg.asset_id);
    }
    if (blueprint.pip?.enabled && blueprint.pip.asset_id) {
      uniqueAssetIds.add(blueprint.pip.asset_id);
    }
  }

  const assetMap = new Map();
  const resolvedList = [];

  for (const assetId of uniqueAssetIds) {
    const asset = await assetService.resolveAndValidateAsset(assetId, { checkFile: true, checkHash: true });

    if (asset.job_id && String(asset.job_id) !== String(jobId)) {
      throw new Error(`[COMPOSER SECURITY ERROR] Asset ${asset.id} pertence ao Job ${asset.job_id} e não ao Job ${jobId}`);
    }

    if (!fs.existsSync(asset.storage_path)) {
      throw new Error(`[COMPOSER ERROR] Arquivo físico do asset ${asset.id} não encontrado em: ${asset.storage_path}`);
    }

    // Validação física de bytes contra file_hash esperado
    const physicalHash = assetService.computeFileHash(asset.storage_path);
    if (asset.file_hash && physicalHash !== asset.file_hash) {
      throw new Error(`[COMPOSER INTEGRITY ERROR] Hash físico do arquivo (${physicalHash}) diverge do file_hash cadastrado (${asset.file_hash}) para asset ${asset.id}`);
    }

    const rawDurationSec = parseFloat(asset.specs?.duration || '0');
    const duration_ms = (!isNaN(rawDurationSec) && rawDurationSec > 0) ? Math.round(rawDurationSec * 1000) : 0;

    const resolvedItem = {
      asset_id: asset.id,
      asset,
      storage_path: asset.storage_path,
      file_hash: physicalHash,
      duration_ms,
      media_type: asset.specs?.media_type || (asset.specs?.width && asset.specs?.height && !rawDurationSec ? 'image' : 'video')
    };

    assetMap.set(asset.id, resolvedItem);
    resolvedList.push(resolvedItem);
  }

  // Para 1.0 e 1.1, manter formato de array sequencial
  if (schemaVersion === '1.0' || schemaVersion === '1.1') {
    const legacyResolved = [];
    for (let i = 0; i < (blueprint.timeline || []).length; i++) {
      const seg = blueprint.timeline[i];
      const item = assetMap.get(seg.asset_id);
      legacyResolved.push({
        segment_index: seg.segment_index || (i + 1),
        role: seg.role || `clip_${i + 1}`,
        asset: item.asset,
        storage_path: item.storage_path,
        file_hash: item.file_hash,
        duration_ms: item.duration_ms,
        source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
        source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
      });
    }
    return legacyResolved;
  }

  return { assetMap, resolvedList };
}

/**
 * 3. Cálculo da render_key Canônica e Determinística (composer_v1, composer_v2, composer_v3)
 * @param {Object} blueprint
 * @param {Object|Array} resolvedAssets
 * @param {Object} [resolvedStyle=null]
 * @returns {string} SHA-256 hex
 */
function computeRenderKey(blueprint, resolvedAssets, resolvedStyle = null) {
  const schemaVersion = String(blueprint.schema_version || '1.0');

  // Caminho 1.0 (Preserva estritamente a fórmula homologada da Fase 3B)
  if (schemaVersion === '1.0') {
    const resolvedList = Array.isArray(resolvedAssets) ? resolvedAssets : Object.values(resolvedAssets || {});
    const inputAssetsCanonical = resolvedList.map(item => ({
      segment_index: item.segment_index,
      role: item.role,
      asset_id: item.asset?.id || item.asset_id,
      file_hash: item.file_hash
    }));

    const timelineCanonical = (blueprint.timeline || []).map((seg, idx) => ({
      segment_index: seg.segment_index || (idx + 1),
      role: seg.role,
      asset_id: seg.asset_id,
      layer: seg.layer || 0,
      source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
      source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
    }));

    const renderSpec10 = {
      schema_version: '1.0',
      composer_contract_version: 'composer_v1',
      creative_id: String(blueprint.creative_id),
      blueprint_version: Number(blueprint.blueprint_version || 1),
      format: {
        aspect_ratio: String(blueprint.format?.aspect_ratio || '9:16').trim(),
        width: Number(blueprint.format?.width || 1080),
        height: Number(blueprint.format?.height || 1920),
        fps: Number(blueprint.format?.fps || 30)
      },
      timeline: timelineCanonical,
      composition_directives: blueprint.composition_directives || {},
      input_assets: inputAssetsCanonical
    };
    const canonicalJSON10 = assetService.canonicalStringify(renderSpec10);
    return crypto.createHash('sha256').update(canonicalJSON10, 'utf8').digest('hex');
  }

  // Caminho 1.1 (Fase 3C.1 — composer_v2)
  if (schemaVersion === '1.1') {
    const resolvedList = Array.isArray(resolvedAssets) ? resolvedAssets : Object.values(resolvedAssets || {});
    const inputAssetsCanonical = resolvedList.map(item => ({
      segment_index: item.segment_index,
      role: item.role,
      asset_id: item.asset?.id || item.asset_id,
      file_hash: item.file_hash
    }));

    const timelineCanonical = (blueprint.timeline || []).map((seg, idx) => ({
      segment_index: seg.segment_index || (idx + 1),
      role: seg.role,
      asset_id: seg.asset_id,
      layer: seg.layer || 0,
      source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
      source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null
    }));

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
        style_hash: String(resolvedStyle.style_hash)
      },
      timeline: timelineCanonical,
      overlays: canonicalOverlays,
      captions: canonicalCaptions,
      input_assets: inputAssetsCanonical
    };

    const canonicalJSON11 = assetService.canonicalStringify(renderSpec11);
    return crypto.createHash('sha256').update(canonicalJSON11, 'utf8').digest('hex');
  }

  // Caminho 1.2 (Fase 3C.2 — composer_v3: B-Roll + PIP + Master Audio)
  const resolvedList = Array.isArray(resolvedAssets) ? resolvedAssets : (resolvedAssets.resolvedList || []);
  const inputAssetsCanonical = resolvedList
    .map(item => ({
      asset_id: item.asset_id,
      file_hash: item.file_hash
    }))
    .sort((a, b) => a.asset_id.localeCompare(b.asset_id));

  const visualTimelineCanonical = (blueprint.visual_timeline || []).map((seg, idx) => ({
    id: seg.id || `vseg_${idx + 1}`,
    asset_id: seg.asset_id,
    asset_type: seg.asset_type || 'image',
    role: seg.role || null,
    start_ms: Number(seg.start_ms),
    end_ms: Number(seg.end_ms),
    source_in_ms: seg.source_in_ms !== undefined ? seg.source_in_ms : null,
    source_out_ms: seg.source_out_ms !== undefined ? seg.source_out_ms : null,
    fit: seg.fit || 'cover',
    motion: seg.motion ? {
      type: String(seg.motion.type || 'static'),
      start_scale: Number(seg.motion.start_scale || 1.00),
      target_scale: Number(seg.motion.target_scale || 1.10)
    } : null,
    transition_in: seg.transition_in ? {
      type: String(seg.transition_in.type || 'cut'),
      duration_ms: Number(seg.transition_in.duration_ms || 250)
    } : null
  }));

  const pipCanonical = (blueprint.pip && blueprint.pip.enabled) ? {
    enabled: true,
    asset_id: String(blueprint.pip.asset_id),
    windows: (blueprint.pip.windows || []).map(w => {
      const geom = resolvePipGeometry(w, resolvedStyle);
      return {
        start_ms: Number(w.start_ms),
        end_ms: Number(w.end_ms),
        source_in_ms: w.source_in_ms !== undefined ? w.source_in_ms : null,
        source_out_ms: w.source_out_ms !== undefined ? w.source_out_ms : null,
        position: String(w.position || 'bottom_right'),
        shape: String(geom.shape),
        geometry: {
          x: geom.x,
          y: geom.y,
          width: geom.width,
          height: geom.height
        },
        border: {
          radius: geom.border_radius,
          width: geom.border_width,
          color: geom.border_color
        },
        transition_in: w.transition_in ? { type: String(w.transition_in.type || 'cut'), duration_ms: Number(w.transition_in.duration_ms || 200) } : null,
        transition_out: w.transition_out ? { type: String(w.transition_out.type || 'cut'), duration_ms: Number(w.transition_out.duration_ms || 200) } : null
      };
    })
  } : { enabled: false };

  const canonicalOverlays12 = (blueprint.overlays || [])
    .map(ov => {
      const presetObj = resolvedStyle?.overlay_presets?.[ov.preset] || {};
      return {
        id: String(ov.id),
        layer_order: Number(ov.layer_order || 0),
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

  const canonicalCaptions12 = (blueprint.captions || [])
    .map(c => ({
      start_ms: Number(c.start_ms),
      end_ms: Number(c.end_ms),
      text: overlayService.sanitizeDrawtextString(c.text)
    }))
    .sort((a, b) => a.start_ms - b.start_ms);

  const renderSpec12 = {
    schema_version: '1.2',
    composer_contract_version: 'composer_v3',
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
      style_hash: String(resolvedStyle.style_hash)
    },
    audio_track: {
      primary_asset_id: String(blueprint.audio_track.primary_asset_id),
      source_in_ms: blueprint.audio_track.source_in_ms !== undefined ? blueprint.audio_track.source_in_ms : null,
      source_out_ms: blueprint.audio_track.source_out_ms !== undefined ? blueprint.audio_track.source_out_ms : null,
      broll_audio_policy: 'mute_all_broll'
    },
    visual_timeline: visualTimelineCanonical,
    pip: pipCanonical,
    overlays: canonicalOverlays12,
    captions: canonicalCaptions12,
    input_assets: inputAssetsCanonical
  };

  const canonicalJSON12 = assetService.canonicalStringify(renderSpec12);
  return crypto.createHash('sha256').update(canonicalJSON12, 'utf8').digest('hex');
}

/**
 * 4. Construção do Plano de Execução e Linha do Tempo Real
 * @param {Object} blueprint
 * @param {Object|Array} resolvedAssets
 * @returns {Object} Execution plan
 */
function buildExecutionPlan(blueprint, resolvedAssets) {
  const schemaVersion = String(blueprint.schema_version || '1.0');

  // Caminho 1.0 e 1.1
  if (schemaVersion === '1.0' || schemaVersion === '1.1') {
    let accumulatedTimelineMs = 0;
    const segmentsPlan = [];

    for (const item of resolvedAssets) {
      let segmentDurationMs = item.duration_ms;

      if (item.source_in_ms !== null && item.source_in_ms !== undefined && item.source_out_ms !== null && item.source_out_ms !== undefined) {
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

  // Caminho 1.2 (B-Roll + PIP + Audio Master)
  const assetMap = resolvedAssets.assetMap;
  const primaryAudioItem = assetMap.get(blueprint.audio_track.primary_asset_id);
  if (!primaryAudioItem) {
    throw new Error(`[COMPOSER ERROR] Asset de áudio principal ${blueprint.audio_track.primary_asset_id} não resolvido`);
  }

  let masterAudioDurationMs = primaryAudioItem.duration_ms;
  if (blueprint.audio_track.source_in_ms !== null && blueprint.audio_track.source_in_ms !== undefined &&
      blueprint.audio_track.source_out_ms !== null && blueprint.audio_track.source_out_ms !== undefined) {
    masterAudioDurationMs = blueprint.audio_track.source_out_ms - blueprint.audio_track.source_in_ms;
  }

  // Validar visual_timeline
  let totalVisualDurationMs = 0;
  const visualPlan = [];

  for (let i = 0; i < blueprint.visual_timeline.length; i++) {
    const vSeg = blueprint.visual_timeline[i];
    const assetItem = assetMap.get(vSeg.asset_id);
    if (!assetItem) {
      throw new Error(`[COMPOSER ERROR] Asset visual ${vSeg.asset_id} não resolvido no catálogo`);
    }

    const durationMs = vSeg.end_ms - vSeg.start_ms;
    totalVisualDurationMs = Math.max(totalVisualDurationMs, vSeg.end_ms);

    visualPlan.push({
      ...vSeg,
      assetItem,
      duration_ms: durationMs,
      duration_sec: durationMs / 1000
    });
  }

  // Validar que visual_timeline cobre o áudio master
  const durationDiff = Math.abs(totalVisualDurationMs - masterAudioDurationMs);
  if (durationDiff > COMPOSER_DURATION_TOLERANCE_MS) {
    throw new Error(`[COMPOSER VALIDATION ERROR] Duração da visual_timeline (${totalVisualDurationMs}ms) diverge da duração do áudio master (${masterAudioDurationMs}ms) além da tolerância permitida (${COMPOSER_DURATION_TOLERANCE_MS}ms)`);
  }

  return {
    blueprint,
    assetMap,
    resolvedList: resolvedAssets.resolvedList,
    visualSegments: visualPlan,
    masterAudio: {
      assetItem: primaryAudioItem,
      duration_ms: masterAudioDurationMs,
      source_in_ms: blueprint.audio_track.source_in_ms,
      source_out_ms: blueprint.audio_track.source_out_ms
    },
    total_duration_ms: masterAudioDurationMs,
    total_duration_sec: masterAudioDurationMs / 1000
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
 * 6. Pipeline Canônico de Re-encode FFmpeg com Trims, B-Roll, Ken Burns, PIP e Overlays
 * @param {Object} params
 * @returns {Promise<void>}
 */
function renderTimelineFFmpeg({ executionPlan, tempOutputPath, resolvedStyle = null }) {
  return new Promise((resolve, reject) => {
    const blueprint = executionPlan.blueprint;
    const schemaVersion = String(blueprint.schema_version || '1.0');

    // ==========================================
    // CAMINHO LEGADO 1.0 e 1.1 (Fase 3B e 3C.1)
    // ==========================================
    if (schemaVersion === '1.0' || schemaVersion === '1.1') {
      const segments = executionPlan.segments;
      const n = segments.length;

      if (n < 1) {
        return reject(new Error('[FFMPEG ERROR] Nenhum segmento para renderizar'));
      }

      const args = ['-y'];
      for (const seg of segments) {
        args.push('-i', seg.storage_path);
      }

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

      const concatVLabel = (schemaVersion === '1.1' && (blueprint.overlays?.length > 0 || blueprint.captions?.length > 0))
        ? '[v_concat]'
        : '[outv]';

      const concatFilter = `${concatInputs}concat=n=${n}:v=1:a=1${concatVLabel}[outa]`;
      filterParts.push(concatFilter);

      let finalVideoMap = concatVLabel;
      if (schemaVersion === '1.1' && resolvedStyle) {
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

      return spawnFfmpeg(args, tempOutputPath, resolve, reject);
    }

    // ==========================================
    // CAMINHO NOVO 1.2 (Fase 3C.2 — B-Roll + PIP)
    // ==========================================
    const args = ['-y'];
    const filterParts = [];
    let currentInputIdx = 0;

    // 1. Áudio Master (Layer de Áudio)
    const masterAudioAsset = executionPlan.resolvedList.find(a => a.asset_id === blueprint.audio_track.primary_asset_id) || executionPlan.resolvedList[0];
    args.push('-i', masterAudioAsset.storage_path);
    const masterAudioIdx = currentInputIdx++;

    const audioTrack = blueprint.audio_track;
    if (audioTrack.source_in_ms !== null && audioTrack.source_in_ms !== undefined &&
        audioTrack.source_out_ms !== null && audioTrack.source_out_ms !== undefined) {
      const aIn = (audioTrack.source_in_ms / 1000).toFixed(3);
      const aOut = (audioTrack.source_out_ms / 1000).toFixed(3);
      filterParts.push(`[${masterAudioIdx}:a]atrim=start=${aIn}:end=${aOut},asetpts=PTS-STARTPTS[master_audio]`);
    } else {
      filterParts.push(`[${masterAudioIdx}:a]asetpts=PTS-STARTPTS[master_audio]`);
    }

    // 2. Layer 0: Visual Timeline (B-Roll de Fotos com Ken Burns e Vídeos)
    const vSegs = executionPlan.visualSegments;
    const numVisuals = vSegs.length;

    for (let i = 0; i < numVisuals; i++) {
      const seg = vSegs[i];
      const segAsset = executionPlan.resolvedList.find(a => a.asset_id === seg.asset_id) || executionPlan.resolvedList[0];
      const segDurSec = seg.duration_sec;
      const numFrames = Math.max(1, Math.round(segDurSec * 30));
      const inIdx = currentInputIdx++;

      const isVideoFile = segAsset.storage_path?.endsWith('.mp4') || seg.asset_type === 'video';
      if (seg.asset_type === 'image' && !isVideoFile) {
        args.push('-loop', '1', '-framerate', '30', '-t', segDurSec.toFixed(3), '-i', segAsset.storage_path);

        const motionType = seg.motion?.type || 'static';
        let startScale = Number(seg.motion?.start_scale || 1.00);
        let targetScale = Number(seg.motion?.target_scale || (motionType === 'static' ? 1.00 : 1.10));

        if (motionType === 'ken_burns_zoom_out') {
          startScale = 1.10;
          targetScale = 1.00;
        } else if (motionType === 'static') {
          startScale = 1.00;
          targetScale = 1.00;
        }

        const scaleDelta = (targetScale - startScale).toFixed(4);
        const zoomExpr = scaleDelta === '0.0000'
          ? `${startScale.toFixed(2)}`
          : `${startScale.toFixed(2)}+(${scaleDelta}*on/${numFrames})`;

        // Ken Burns streaming determinístico (d=1, baixíssimo footprint de RAM)
        const vNode = `[${inIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
          `zoompan=z='${zoomExpr}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,` +
          `trim=duration=${segDurSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,fps=30[v_seg_${i}]`;
        filterParts.push(vNode);
      } else {
        // Video clip B-roll
        args.push('-i', segAsset.storage_path);
        let vNode = `[${inIdx}:v]`;
        if (seg.source_in_ms !== null && seg.source_in_ms !== undefined && seg.source_out_ms !== null && seg.source_out_ms !== undefined) {
          const vIn = (seg.source_in_ms / 1000).toFixed(3);
          const vOut = (seg.source_out_ms / 1000).toFixed(3);
          vNode += `trim=start=${vIn}:end=${vOut},setpts=PTS-STARTPTS,`;
        } else {
          vNode += `trim=duration=${segDurSec.toFixed(3)},setpts=PTS-STARTPTS,`;
        }
        vNode += `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[v_seg_${i}]`;
        filterParts.push(vNode);
      }
    }

    // Concatenação / Crossfades da Visual Timeline
    let currentVStream = '';
    const hasCrossfades = vSegs.some(s => s.transition_in?.type === 'crossfade');

    if (!hasCrossfades || numVisuals === 1) {
      let concatInputs = '';
      for (let i = 0; i < numVisuals; i++) {
        concatInputs += `[v_seg_${i}]`;
      }
      filterParts.push(`${concatInputs}concat=n=${numVisuals}:v=1:a=0[v_broll_base]`);
      currentVStream = '[v_broll_base]';
    } else {
      // Execução de xfade sequencial
      let prevStream = '[v_seg_0]';
      let accumulatedOffsetSec = vSegs[0].duration_sec;

      for (let i = 1; i < numVisuals; i++) {
        const seg = vSegs[i];
        const nextStream = `[v_seg_${i}]`;
        const outStream = (i === numVisuals - 1) ? '[v_broll_base]' : `[v_xf_${i}]`;

        if (seg.transition_in?.type === 'crossfade') {
          const transDurSec = (seg.transition_in.duration_ms / 1000);
          const offsetSec = Math.max(0, accumulatedOffsetSec - transDurSec);
          filterParts.push(`${prevStream}${nextStream}xfade=transition=fade:duration=${transDurSec.toFixed(3)}:offset=${offsetSec.toFixed(3)}${outStream}`);
          accumulatedOffsetSec = offsetSec + seg.duration_sec;
        } else {
          // Cut sequencial
          filterParts.push(`${prevStream}${nextStream}concat=n=2:v=1:a=0${outStream}`);
          accumulatedOffsetSec += seg.duration_sec;
        }
        prevStream = outStream;
      }
      currentVStream = '[v_broll_base]';
    }

    // 3. Layer 1: Presenter PIP (quando ativo)
    if (blueprint.pip && blueprint.pip.enabled && Array.isArray(blueprint.pip.windows) && blueprint.pip.windows.length > 0) {
      const pipAsset = executionPlan.resolvedList.find(a => a.asset_id === blueprint.pip.asset_id) || executionPlan.resolvedList[0];

      for (let w = 0; w < blueprint.pip.windows.length; w++) {
        const win = blueprint.pip.windows[w];
        const geom = resolvePipGeometry(win, resolvedStyle);
        const wStartSec = (win.start_ms / 1000).toFixed(3);
        const wEndSec = (win.end_ms / 1000).toFixed(3);

        const srcInSec = (win.source_in_ms !== null && win.source_in_ms !== undefined)
          ? (win.source_in_ms / 1000).toFixed(3)
          : wStartSec;
        const srcOutSec = (win.source_out_ms !== null && win.source_out_ms !== undefined)
          ? (win.source_out_ms / 1000).toFixed(3)
          : wEndSec;

        const pipInputIdx = currentInputIdx++;
        args.push('-i', pipAsset.storage_path);

        const pipStreamLabel = `[pip_crop_${w}]`;
        const nextVStream = `[v_pip_layer_${w}]`;

        let pipFilter = `[${pipInputIdx}:v]trim=start=${srcInSec}:end=${srcOutSec},setpts=PTS-STARTPTS+${wStartSec}/TB,` +
          `scale=${geom.width}:${geom.height}:force_original_aspect_ratio=increase,crop=${geom.width}:${geom.height},format=yuva420p`;

        if (geom.shape === 'circle') {
          const r = Math.floor(Math.min(geom.width, geom.height) / 2);
          pipFilter += `,geq=lum='p(X,Y)':a='if(gt(sqrt(pow(X-${r},2)+pow(Y-${r},2)),${r}),0,255)'`;
        }

        pipFilter += `${pipStreamLabel}`;
        filterParts.push(pipFilter);

        // Overlay do PIP sobre o fluxo de vídeo corrente
        filterParts.push(`${currentVStream}${pipStreamLabel}overlay=x=${geom.x}:y=${geom.y}:enable='between(t,${wStartSec},${wEndSec})':eof_action=pass${nextVStream}`);
        currentVStream = nextVStream;
      }
    }

    // 4. Layers 2, 3, 4: Overlays, Captions e CTA (Overlay Engine)
    if (resolvedStyle) {
      const overlayCompiled = overlayService.compileOverlayFiltergraph({
        inputStreamLabel: currentVStream,
        overlays: blueprint.overlays || [],
        captions: blueprint.captions || [],
        style: resolvedStyle
      });

      if (overlayCompiled.filterNodes.length > 0) {
        filterParts.push(...overlayCompiled.filterNodes);
        currentVStream = overlayCompiled.outputStreamLabel;
      }
    }

    const filterString = filterParts.join(';');

    args.push(
      '-filter_complex', filterString,
      '-map', currentVStream,
      '-map', '[master_audio]',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-threads', '0',
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

    return spawnFfmpeg(args, tempOutputPath, resolve, reject);
  });
}

function spawnFfmpeg(args, tempOutputPath, resolve, reject) {
  let stderrBuffer = '';
  const child = spawn('ffmpeg', args);

  const timeoutTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch (e) {}
    reject(new Error(`[FFMPEG EXECUTION ERROR] Timeout de ${FFMPEG_TIMEOUT_MS}ms excedido na renderização FFmpeg`));
  }, FFMPEG_TIMEOUT_MS);

  if (child.stderr) {
    child.stderr.on('data', d => {
      stderrBuffer += d.toString();
      if (stderrBuffer.length > 102400) {
        stderrBuffer = stderrBuffer.slice(-102400);
      }
    });
  }

  child.on('error', (err) => {
    clearTimeout(timeoutTimer);
    reject(new Error(`[FFMPEG SPAWN ERROR] ${err.message}`));
  });

  child.on('close', (code) => {
    clearTimeout(timeoutTimer);
    if (code !== 0) {
      const errorDetail = (stderrBuffer || '').slice(-2000);
      return reject(new Error(`[FFMPEG EXECUTION ERROR] Falha no re-encode (código ${code}). Detalhes: ${errorDetail}`));
    }
    resolve();
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

          if (physicalFps !== 30) {
            return reject(new Error(`[VALIDATION ERROR] Taxa de quadros inválida: esperado 30 fps, obtido ${physicalFps} fps`));
          }

          const durDiff = Math.abs(formatDurationMs - expectedDurationMs);
          if (durDiff > toleranceMs) {
            return reject(new Error(`[VALIDATION ERROR] Duração da saída (${formatDurationMs}ms) diverge do esperado (${expectedDurationMs}ms) além da tolerância permitida (${toleranceMs}ms)`));
          }

          const fileHash = assetService.computeFileHash(tempPath);
          const stats = fs.statSync(tempPath);

          fs.renameSync(tempPath, finalPath);

          const specs = {
            duration: formatDuration,
            duration_ms: formatDurationMs,
            width: 1080,
            height: 1920,
            fps: physicalFps,
            codec_video: videoStream.codec_name,
            codec_audio: audioStream.codec_name,
            file_size_bytes: stats.size,
            file_hash: fileHash
          };

          resolve(specs);
        } catch (e) {
          reject(new Error(`[QC PARSE ERROR] Falha no processamento das specs do ffprobe: ${e.message}`));
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

  // 2. Resolução Segura de Assets da Timeline com Verificação de Hash Físico
  const resolvedAssets = await resolveTimelineAssets(jobId, blueprint);

  // 3. Resolução de Style e Validações de Overlays/Captions/PIP
  let resolvedStyle = null;
  const executionPlan = buildExecutionPlan(blueprint, resolvedAssets);

  if (schemaVersion === '1.1' || schemaVersion === '1.2') {
    resolvedStyle = resolveEditingStyle(blueprint.editing_style.style_id, blueprint.editing_style.version);
    overlayService.validateOverlays(blueprint.overlays || [], resolvedStyle, executionPlan.total_duration_ms);
    overlayService.validateCaptions(blueprint.captions || [], resolvedStyle, executionPlan.total_duration_ms);

    if (schemaVersion === '1.2') {
      validateSpatiotemporalCollisions(blueprint, resolvedStyle);
    }
  }

  // 4. Cálculo Determinístico da render_key
  const renderKey = computeRenderKey(blueprint, resolvedAssets, resolvedStyle);
  const shortRenderKey = renderKey.slice(0, 10);
  const creativeId = blueprint.creative_id;
  
  let prefix = 'composer_';
  let assetType = 'rendered_creative';
  if (isShadow) {
    if (schemaVersion === '1.2') {
      prefix = 'shadow_3c2_';
      assetType = 'shadow_creative_3c2';
    } else if (schemaVersion === '1.1') {
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
      expectedDurationMs: options.forceExpectedDurationMs !== undefined ? options.forceExpectedDurationMs : executionPlan.total_duration_ms,
      toleranceMs: options.maxDurationToleranceMs !== undefined ? options.maxDurationToleranceMs : (options.toleranceMs !== undefined ? options.toleranceMs : COMPOSER_DURATION_TOLERANCE_MS)
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
          visual_segments_count: executionPlan.visualSegments ? executionPlan.visualSegments.length : (executionPlan.segments ? executionPlan.segments.length : 0),
          overlays_count: (blueprint.overlays || []).length,
          captions_count: (blueprint.captions || []).length,
          pip_enabled: Boolean(blueprint.pip?.enabled)
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
 * 9. Comparador Técnico Shadow vs Legado (Inspeção Estrutural de Duração e Streams)
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
  resolvePipGeometry,
  validateSpatiotemporalCollisions,
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
