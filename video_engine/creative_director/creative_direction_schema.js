/**
 * Módulo de Schema e Fingerprinting — Creative Director (Fase 4A.3)
 * Bali Imóveis
 */

const crypto = require('crypto');
const { canonicalStringify, canonicalizeValue } = require('../asset_service');

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_DIRECTOR_VERSION = '1.0.0';
const DEFAULT_INTENT_EXTRACTOR_VERSION = '1.0.0';
const DEFAULT_MEDIA_RANKER_VERSION = '1.0.0';
const DEFAULT_CONTINUITY_ENGINE_VERSION = '1.0.0';
const DEFAULT_FALLBACK_POLICY_VERSION = '1.0.0';

const DEFAULT_SCORING_WEIGHTS = Object.freeze({
  semantic_relevance: 0.50,
  technical_quality: 0.30,
  aesthetic_score: 0.20
});

const DEFAULT_SEMANTIC_THRESHOLDS = Object.freeze({
  min_semantic_relevance: 0.40,
  min_visual_duration_ms: 1500
});

const ALLOWED_FALLBACK_TYPES = Object.freeze([
  'generic_property_media',
  'presenter_fullscreen',
  'presenter_pip',
  'no_semantic_match'
]);

/**
 * Validação de uma decisão visual individual
 */
function validateVisualDecision(decision, maxVideoDurationMs = null) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('[SCHEMA_ERROR] Visual decision nula ou inválida');
  }

  const tStart = Number(decision.timeline_start_ms);
  const tEnd = Number(decision.timeline_end_ms);
  const sIn = Number(decision.source_in_ms);
  const sOut = Number(decision.source_out_ms);

  if (isNaN(tStart) || isNaN(tEnd) || tStart < 0 || tStart >= tEnd) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de timeline inválido: 0 <= timeline_start_ms (${decision.timeline_start_ms}) < timeline_end_ms (${decision.timeline_end_ms})`);
  }

  if (isNaN(sIn) || isNaN(sOut) || sIn < 0 || sIn >= sOut) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de source inválido: 0 <= source_in_ms (${decision.source_in_ms}) < source_out_ms (${decision.source_out_ms})`);
  }

  const tDuration = tEnd - tStart;
  const sDuration = sOut - sIn;

  // Invariante temporal estrito: timeline_duration === source_duration (tolerância técnica 5ms)
  if (Math.abs(tDuration - sDuration) > 5) {
    throw new Error(`[SCHEMA_ERROR] Invariante violado: timeline_duration (${tDuration}ms) != source_duration (${sDuration}ms)`);
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
 * Cálculo determinístico do Creative Direction Fingerprint (creative_direction_key)
 */
function computeCreativeDirectionKey({
  script_timing_key,
  beat_analysis_key,
  media_understanding_key,
  intent_extractor_version = DEFAULT_INTENT_EXTRACTOR_VERSION,
  media_ranker_version = DEFAULT_MEDIA_RANKER_VERSION,
  continuity_engine_version = DEFAULT_CONTINUITY_ENGINE_VERSION,
  fallback_policy_version = DEFAULT_FALLBACK_POLICY_VERSION,
  director_version = DEFAULT_DIRECTOR_VERSION,
  scoring_weights = DEFAULT_SCORING_WEIGHTS,
  semantic_thresholds = DEFAULT_SEMANTIC_THRESHOLDS,
  min_visual_duration_ms = DEFAULT_SEMANTIC_THRESHOLDS.min_visual_duration_ms,
  schema_version = SCHEMA_VERSION
}) {
  if (!script_timing_key || typeof script_timing_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] script_timing_key é obrigatório para computeCreativeDirectionKey');
  }
  if (!beat_analysis_key || typeof beat_analysis_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] beat_analysis_key é obrigatório para computeCreativeDirectionKey');
  }
  if (!media_understanding_key || typeof media_understanding_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] media_understanding_key é obrigatório para computeCreativeDirectionKey');
  }

  const canonicalObj = {
    script_timing_key: script_timing_key.trim().toLowerCase(),
    beat_analysis_key: beat_analysis_key.trim().toLowerCase(),
    media_understanding_key: media_understanding_key.trim().toLowerCase(),
    intent_extractor_version: intent_extractor_version.trim(),
    media_ranker_version: media_ranker_version.trim(),
    continuity_engine_version: continuity_engine_version.trim(),
    fallback_policy_version: fallback_policy_version.trim(),
    director_version: director_version.trim(),
    scoring_weights: canonicalizeValue(scoring_weights),
    semantic_thresholds: canonicalizeValue(semantic_thresholds),
    min_visual_duration_ms: Number(min_visual_duration_ms),
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
  computeCreativeDirectionKey
};
