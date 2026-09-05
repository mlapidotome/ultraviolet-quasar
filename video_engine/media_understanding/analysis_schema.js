/**
 * Módulo de Schema e Validação Semântica — Media Understanding (Fase 4A.1)
 * Bali Imóveis
 */

const crypto = require('crypto');
const { canonicalStringify } = require('../asset_service');

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_ANALYZER_TYPE = 'vlm_temporal_sampling';
const DEFAULT_ANALYZER_VERSION = '1.0.0';
const DEFAULT_PROMPT_VERSION = 'vlm_prompt_v1';

const ALLOWED_ROOM_TYPES = Object.freeze([
  'living_room',
  'dining_room',
  'kitchen',
  'balcony',
  'bedroom',
  'suite',
  'bathroom',
  'facade',
  'hallway',
  'laundry',
  'garage',
  'leisure',
  'city_view',
  'exterior',
  'other',
  'unknown'
]);

const ALLOWED_FEATURES = Object.freeze([
  'city_view',
  'gourmet',
  'glass_enclosure',
  'planned_cabinets',
  'porcelain_tile',
  'high_ceiling',
  'pool',
  'barbecue_grill',
  'air_conditioning',
  'open_concept',
  'natural_lighting',
  'modern_fixtures',
  'wooden_floor',
  'spacious',
  'bright',
  'furnished'
]);

/**
 * Normaliza e clampa scores matematicamente entre 0.0 e 1.0
 */
function clampScore(val, defaultVal = 0.5) {
  const num = parseFloat(val);
  if (isNaN(num)) return defaultVal;
  return Math.max(0.0, Math.min(1.0, Math.round(num * 100) / 100));
}

/**
 * Validação rigorosa do resultado de análise de um sample/frame
 */
function validateFrameSampleResult(sample) {
  if (!sample || typeof sample !== 'object') {
    throw new Error('[SCHEMA_ERROR] Sample de análise nulo ou inválido');
  }

  let roomType = String(sample.room_type || '').toLowerCase().trim();
  if (!ALLOWED_ROOM_TYPES.includes(roomType)) {
    throw new Error(`[SCHEMA_ERROR] room_type inválido: '${sample.room_type}' (permitidos: ${ALLOWED_ROOM_TYPES.join(', ')})`);
  }

  const rawFeatures = Array.isArray(sample.features) ? sample.features : [];
  const normalizedFeatures = rawFeatures
    .map(f => String(f).toLowerCase().trim())
    .filter(f => f.length > 0);

  const technicalQuality = clampScore(sample.technical_quality_score, 0.5);
  const aestheticScore = clampScore(sample.aesthetic_score, 0.5);
  const confidence = clampScore(sample.confidence, 0.5);

  if (sample.technical_quality_score !== undefined) {
    const rawT = parseFloat(sample.technical_quality_score);
    if (isNaN(rawT) || rawT < 0.0 || rawT > 1.0) {
      throw new Error(`[SCHEMA_ERROR] technical_quality_score fora dos limites [0.0, 1.0]: ${sample.technical_quality_score}`);
    }
  }

  if (sample.aesthetic_score !== undefined) {
    const rawA = parseFloat(sample.aesthetic_score);
    if (isNaN(rawA) || rawA < 0.0 || rawA > 1.0) {
      throw new Error(`[SCHEMA_ERROR] aesthetic_score fora dos limites [0.0, 1.0]: ${sample.aesthetic_score}`);
    }
  }

  if (sample.confidence !== undefined) {
    const rawC = parseFloat(sample.confidence);
    if (isNaN(rawC) || rawC < 0.0 || rawC > 1.0) {
      throw new Error(`[SCHEMA_ERROR] confidence fora dos limites [0.0, 1.0]: ${sample.confidence}`);
    }
  }

  return {
    room_type: roomType,
    features: normalizedFeatures,
    technical_quality_score: technicalQuality,
    aesthetic_score: aestheticScore,
    confidence: confidence,
    description: sample.description ? String(sample.description).slice(0, 300) : ''
  };
}

/**
 * Validação de um Segmento Temporal
 */
function validateTemporalSegment(seg, totalDurationMs = null) {
  if (!seg || typeof seg !== 'object') {
    throw new Error('[SCHEMA_ERROR] Segmento nulo ou inválido');
  }

  const startMs = Number(seg.start_ms);
  const endMs = Number(seg.end_ms);

  if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de tempo inválido no segmento: 0 <= start_ms (${seg.start_ms}) < end_ms (${seg.end_ms}) obrigatório`);
  }

  if (totalDurationMs !== null && endMs > totalDurationMs + 50) {
    throw new Error(`[SCHEMA_ERROR] Segmento extrapola a duração física do vídeo: end_ms (${endMs}ms) > total (${totalDurationMs}ms)`);
  }

  if (!ALLOWED_ROOM_TYPES.includes(seg.room_type)) {
    throw new Error(`[SCHEMA_ERROR] room_type inválido no segmento: '${seg.room_type}'`);
  }

  return true;
}

/**
 * Cálculo determinístico do Analysis Fingerprint (analysis_key)
 */
function computeAnalysisKey({
  physical_file_hash,
  analyzer_type = DEFAULT_ANALYZER_TYPE,
  analyzer_version = DEFAULT_ANALYZER_VERSION,
  model_id,
  prompt_version = DEFAULT_PROMPT_VERSION,
  schema_version = SCHEMA_VERSION
}) {
  if (!physical_file_hash || typeof physical_file_hash !== 'string') {
    throw new Error('[SCHEMA_ERROR] physical_file_hash é obrigatório para computeAnalysisKey');
  }
  if (!model_id || typeof model_id !== 'string') {
    throw new Error('[SCHEMA_ERROR] model_id é obrigatório para computeAnalysisKey');
  }

  const canonicalObj = {
    physical_file_hash: physical_file_hash.trim().toLowerCase(),
    analyzer_type: analyzer_type.trim(),
    analyzer_version: analyzer_version.trim(),
    model_id: model_id.trim().toLowerCase(),
    prompt_version: prompt_version.trim(),
    schema_version: schema_version.trim()
  };

  const canonicalJSON = canonicalStringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ANALYZER_TYPE,
  DEFAULT_ANALYZER_VERSION,
  DEFAULT_PROMPT_VERSION,
  ALLOWED_ROOM_TYPES,
  ALLOWED_FEATURES,
  clampScore,
  validateFrameSampleResult,
  validateTemporalSegment,
  computeAnalysisKey
};
