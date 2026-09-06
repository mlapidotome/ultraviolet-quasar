/**
 * Módulo de Schema e Fingerprinting — Creative Director (Fase 4A.3)
 * Bali Imóveis
 */

const crypto = require('crypto');
const { canonicalStringify, canonicalizeValue } = require('../asset_service');

const SCHEMA_VERSION = '1.1.0';
const DEFAULT_DIRECTOR_VERSION = '1.1.0';
const DEFAULT_INTENT_EXTRACTOR_VERSION = '1.0.0';
const DEFAULT_MEDIA_RANKER_VERSION = '1.1.0';
const DEFAULT_CONTINUITY_ENGINE_VERSION = '1.1.0';
const DEFAULT_FALLBACK_POLICY_VERSION = '1.1.0';

const DEFAULT_SCORING_WEIGHTS = Object.freeze({
  semantic_relevance: 0.50,
  technical_quality: 0.30,
  aesthetic_score: 0.20
});

const DEFAULT_SEMANTIC_THRESHOLDS = Object.freeze({
  min_semantic_relevance: 0.40,
  min_visual_duration_ms: 1500,
  max_photo_visual_duration_ms: 6000
});

const ALLOWED_FALLBACK_TYPES = Object.freeze([
  'generic_property_media',
  'presenter_fullscreen',
  'presenter_pip',
  'no_semantic_match'
]);

/**
 * Validação de uma decisão visual individual (Suporta Video e Foto)
 */
function validateVisualDecision(decision, maxVideoDurationMs = null) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('[SCHEMA_ERROR] Visual decision nula ou inválida');
  }

  const tStart = Number(decision.timeline_start_ms);
  const tEnd = Number(decision.timeline_end_ms);

  if (isNaN(tStart) || isNaN(tEnd) || tStart < 0 || tStart >= tEnd) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de timeline inválido: 0 <= timeline_start_ms (${decision.timeline_start_ms}) < timeline_end_ms (${decision.timeline_end_ms})`);
  }

  const tDuration = tEnd - tStart;
  const isPhoto = (decision.media_kind === 'property_photo' || decision.media_kind === 'photo' || decision.asset_type === 'image');
  const isPresenterFullscreen = (decision.fallback_used && decision.fallback_type === 'presenter_fullscreen');

  if (isPhoto) {
    // Foto NÃO pode ter source trim
    if ((decision.source_in_ms !== null && decision.source_in_ms !== undefined) ||
        (decision.source_out_ms !== null && decision.source_out_ms !== undefined)) {
      throw new Error(`[SCHEMA_ERROR] Decisão de foto (${decision.selected_asset_id}) não aceita source_in_ms/source_out_ms (deve ser null)`);
    }

    if (tDuration < 1495) {
      throw new Error(`[SCHEMA_ERROR] Duração de foto na timeline (${tDuration}ms) inferior ao mínimo de 1500ms`);
    }
  } else if (isPresenterFullscreen) {
    // Presenter fullscreen: source trim segue timeline do apresentador
    const sIn = Number(decision.source_in_ms);
    const sOut = Number(decision.source_out_ms);
    if (!isNaN(sIn) && !isNaN(sOut)) {
      const sDuration = sOut - sIn;
      if (Math.abs(tDuration - sDuration) > 5) {
        throw new Error(`[SCHEMA_ERROR] Invariante violado em presenter fullscreen: timeline_duration (${tDuration}ms) != source_duration (${sDuration}ms)`);
      }
    }
  } else {
    // Vídeo de propriedade: trim 1:1 rigoroso
    const sIn = Number(decision.source_in_ms);
    const sOut = Number(decision.source_out_ms);

    if (isNaN(sIn) || isNaN(sOut) || sIn < 0 || sIn >= sOut) {
      throw new Error(`[SCHEMA_ERROR] Intervalo de source inválido: 0 <= source_in_ms (${decision.source_in_ms}) < source_out_ms (${decision.source_out_ms})`);
    }

    const sDuration = sOut - sIn;

    // Invariante temporal estrito: timeline_duration === source_duration (tolerância técnica 5ms)
    if (Math.abs(tDuration - sDuration) > 5) {
      throw new Error(`[SCHEMA_ERROR] Invariante violado: timeline_duration (${tDuration}ms) != source_duration (${sDuration}ms)`);
    }
  }

  if (decision.fallback_used) {
    if (decision.fallback_type && !ALLOWED_FALLBACK_TYPES.includes(decision.fallback_type)) {
      throw new Error(`[SCHEMA_ERROR] fallback_type inválido: '${decision.fallback_type}' (permitidos: ${ALLOWED_FALLBACK_TYPES.join(', ')})`);
    }
  }

  return true;
}

/**
 * Validação de uma decisão editorial de beat
 */
function validateBeatDecision(beatDecision) {
  if (!beatDecision || typeof beatDecision !== 'object') {
    throw new Error('[SCHEMA_ERROR] Beat decision nula ou inválida');
  }

  if (typeof beatDecision.beat_index !== 'number' || beatDecision.beat_index < 0) {
    throw new Error(`[SCHEMA_ERROR] beat_index inválido: ${beatDecision.beat_index}`);
  }

  if (!Array.isArray(beatDecision.visual_decisions) || beatDecision.visual_decisions.length === 0) {
    throw new Error(`[SCHEMA_ERROR] Beat #${beatDecision.beat_index} sem visual_decisions`);
  }

  for (const vd of beatDecision.visual_decisions) {
    validateVisualDecision(vd);
  }

  return true;
}

/**
 * Cálculo Canônico do Hash Determinístico do Media Pool (property_semantic_media_pool_key)
 */
function computePropertySemanticMediaPoolKey({ video_assets = [], photo_assets = [] } = {}) {
  // 1. Ordenação canônica estrita dos vídeos por asset_id ASC
  const sortedVideos = (video_assets || []).slice().sort((a, b) => {
    return String(a.asset_id || '').localeCompare(String(b.asset_id || ''));
  }).map(v => ({
    asset_id: String(v.asset_id || '').trim(),
    physical_file_hash: String(v.physical_file_hash || v.file_hash || '').toLowerCase().trim(),
    analysis_key: String(v.analysis_key || '').trim(),
    segments: (v.segments || []).map(s => ({
      segment_index: Number(s.segment_index),
      start_ms: Number(s.start_ms),
      end_ms: Number(s.end_ms),
      room_type: String(s.room_type || '').trim(),
      features: (s.features || []).slice().sort(),
      technical_quality_score: Number(s.technical_quality_score || 0),
      aesthetic_score: Number(s.aesthetic_score || 0),
      confidence: Number(s.confidence || 0)
    }))
  }));

  // 2. Ordenação canônica estrita das fotos por asset_id ASC
  const sortedPhotos = (photo_assets || []).slice().sort((a, b) => {
    return String(a.asset_id || '').localeCompare(String(b.asset_id || ''));
  }).map(p => {
    const sem = p.semantic || {};
    const qual = p.quality || {};
    return {
      asset_id: String(p.asset_id || '').trim(),
      physical_file_hash: String(p.physical_file_hash || p.file_hash || '').toLowerCase().trim(),
      photo_analysis_key: String(p.photo_analysis_key || '').trim(),
      primary_room_type: String(sem.primary_room_type || p.primary_room_type || '').trim(),
      secondary_room_types: (sem.secondary_room_types || p.secondary_room_types || []).slice().sort(),
      features: (sem.features || p.features || []).slice().sort(),
      quality: canonicalizeValue(qual)
    };
  });

  const canonicalPoolObj = {
    schema_version: SCHEMA_VERSION,
    video_assets: sortedVideos,
    photo_assets: sortedPhotos
  };

  const canonicalJSON = canonicalStringify(canonicalPoolObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

/**
 * Cálculo determinístico do Creative Direction Fingerprint (creative_direction_key)
 */
function computeCreativeDirectionKey({
  script_timing_key,
  beat_analysis_key,
  media_understanding_key = null,
  property_semantic_media_pool_key = null,
  intent_extractor_version = DEFAULT_INTENT_EXTRACTOR_VERSION,
  media_ranker_version = DEFAULT_MEDIA_RANKER_VERSION,
  continuity_engine_version = DEFAULT_CONTINUITY_ENGINE_VERSION,
  fallback_policy_version = DEFAULT_FALLBACK_POLICY_VERSION,
  director_version = DEFAULT_DIRECTOR_VERSION,
  scoring_weights = DEFAULT_SCORING_WEIGHTS,
  semantic_thresholds = DEFAULT_SEMANTIC_THRESHOLDS,
  min_visual_duration_ms = DEFAULT_SEMANTIC_THRESHOLDS.min_visual_duration_ms,
  max_photo_visual_duration_ms = DEFAULT_SEMANTIC_THRESHOLDS.max_photo_visual_duration_ms,
  schema_version = SCHEMA_VERSION
}) {
  if (!script_timing_key || typeof script_timing_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] script_timing_key é obrigatório para computeCreativeDirectionKey');
  }
  if (!beat_analysis_key || typeof beat_analysis_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] beat_analysis_key é obrigatório para computeCreativeDirectionKey');
  }

  const poolKey = property_semantic_media_pool_key || media_understanding_key;
  if (!poolKey || typeof poolKey !== 'string') {
    throw new Error('[SCHEMA_ERROR] property_semantic_media_pool_key ou media_understanding_key é obrigatório para computeCreativeDirectionKey');
  }

  const canonicalObj = {
    script_timing_key: script_timing_key.trim().toLowerCase(),
    beat_analysis_key: beat_analysis_key.trim().toLowerCase(),
    property_semantic_media_pool_key: poolKey.trim().toLowerCase(),
    intent_extractor_version: intent_extractor_version.trim(),
    media_ranker_version: media_ranker_version.trim(),
    continuity_engine_version: continuity_engine_version.trim(),
    fallback_policy_version: fallback_policy_version.trim(),
    director_version: director_version.trim(),
    scoring_weights: canonicalizeValue(scoring_weights),
    semantic_thresholds: canonicalizeValue(semantic_thresholds),
    min_visual_duration_ms: Number(min_visual_duration_ms),
    max_photo_visual_duration_ms: Number(max_photo_visual_duration_ms || 6000),
    schema_version: schema_version.trim()
  };

  const canonicalJSON = canonicalStringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_DIRECTOR_VERSION,
  DEFAULT_INTENT_EXTRACTOR_VERSION,
  DEFAULT_MEDIA_RANKER_VERSION,
  DEFAULT_CONTINUITY_ENGINE_VERSION,
  DEFAULT_FALLBACK_POLICY_VERSION,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SEMANTIC_THRESHOLDS,
  ALLOWED_FALLBACK_TYPES,
  validateVisualDecision,
  validateBeatDecision,
  computePropertySemanticMediaPoolKey,
  computeCreativeDirectionKey
};
