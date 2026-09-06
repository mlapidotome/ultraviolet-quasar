/**
 * Módulo de Schema e Validação — Script Timing & Semantic Beats (Fase 4A.2)
 * Bali Imóveis
 */

const crypto = require('crypto');
const { canonicalStringify } = require('../asset_service');

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_ALIGNMENT_ENGINE = 'whisper_word_timestamp';
const DEFAULT_ENGINE_VERSION = '1.0.0';
const DEFAULT_MODEL_ID = 'whisper-1';
const DEFAULT_NORMALIZATION_VERSION = '1.0.0';
const DEFAULT_BEAT_PARSER_VERSION = '1.0.0';
const DEFAULT_BEAT_PROMPT_VERSION = 'beat_v1';
const MIN_TOKEN_COVERAGE = 0.90;

/**
 * Validação rigorosa de palavra alinhada
 */
function validateWordAlignment(word, totalDurationMs = null) {
  if (!word || typeof word !== 'object') {
    throw new Error('[SCHEMA_ERROR] Word alignment nulo ou inválido');
  }

  if (typeof word.raw_word !== 'string' || !word.raw_word.trim()) {
    if (typeof word.word !== 'string' || !word.word.trim()) {
      throw new Error('[SCHEMA_ERROR] Palavra alinhada sem texto válido (raw_word ou word)');
    }
  }

  const startMs = Number(word.start_ms);
  const endMs = Number(word.end_ms);

  if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de tempo inválido na palavra: 0 <= start_ms (${word.start_ms}) < end_ms (${word.end_ms}) obrigatório`);
  }

  if (totalDurationMs !== null && endMs > totalDurationMs + 100) {
    throw new Error(`[SCHEMA_ERROR] Palavra extrapola a duração física do áudio: end_ms (${endMs}ms) > total (${totalDurationMs}ms)`);
  }

  const conf = Number(word.confidence !== undefined ? word.confidence : 1.0);
  if (isNaN(conf) || conf < 0.0 || conf > 1.0) {
    throw new Error(`[SCHEMA_ERROR] confidence fora dos limites [0.0, 1.0]: ${word.confidence}`);
  }

  return true;
}

/**
 * Validação de um Semantic Beat
 */
function validateSemanticBeat(beat, totalDurationMs = null) {
  if (!beat || typeof beat !== 'object') {
    throw new Error('[SCHEMA_ERROR] Semantic Beat nulo ou inválido');
  }

  if (typeof beat.beat_index !== 'number' || beat.beat_index < 0) {
    throw new Error(`[SCHEMA_ERROR] beat_index inválido: ${beat.beat_index}`);
  }

  if (typeof beat.text !== 'string' || !beat.text.trim()) {
    throw new Error('[SCHEMA_ERROR] beat sem texto textual válido');
  }

  const startMs = Number(beat.start_ms);
  const endMs = Number(beat.end_ms);

  if (isNaN(startMs) || isNaN(endMs) || startMs < 0 || startMs >= endMs) {
    throw new Error(`[SCHEMA_ERROR] Intervalo de tempo inválido no beat #${beat.beat_index}: 0 <= start_ms (${beat.start_ms}) < end_ms (${beat.end_ms}) obrigatório`);
  }

  if (totalDurationMs !== null && endMs > totalDurationMs + 100) {
    throw new Error(`[SCHEMA_ERROR] Beat #${beat.beat_index} extrapola a duração total: end_ms (${endMs}ms) > total (${totalDurationMs}ms)`);
  }

  if (!Array.isArray(beat.word_indices) || beat.word_indices.length === 0) {
    throw new Error(`[SCHEMA_ERROR] Beat #${beat.beat_index} sem lista de word_indices associada`);
  }

  const expectedDuration = endMs - startMs;
  if (beat.duration_ms !== undefined && Math.abs(beat.duration_ms - expectedDuration) > 2) {
    throw new Error(`[SCHEMA_ERROR] Inconsistência de duration_ms no beat #${beat.beat_index}: informado ${beat.duration_ms}, calculado ${expectedDuration}`);
  }

  return true;
}

/**
 * Cálculo determinístico do Alignment Fingerprint (alignment_key)
 */
function computeAlignmentKey({
  audio_physical_hash,
  normalized_script_hash,
  alignment_engine = DEFAULT_ALIGNMENT_ENGINE,
  engine_version = DEFAULT_ENGINE_VERSION,
  model_id = DEFAULT_MODEL_ID,
  normalization_version = DEFAULT_NORMALIZATION_VERSION,
  schema_version = SCHEMA_VERSION
}) {
  if (!audio_physical_hash || typeof audio_physical_hash !== 'string') {
    throw new Error('[SCHEMA_ERROR] audio_physical_hash é obrigatório para computeAlignmentKey');
  }
  if (!normalized_script_hash || typeof normalized_script_hash !== 'string') {
    throw new Error('[SCHEMA_ERROR] normalized_script_hash é obrigatório para computeAlignmentKey');
  }
  if (!model_id || typeof model_id !== 'string') {
    throw new Error('[SCHEMA_ERROR] model_id é obrigatório para computeAlignmentKey');
  }

  const canonicalObj = {
    audio_physical_hash: audio_physical_hash.trim().toLowerCase(),
    normalized_script_hash: normalized_script_hash.trim().toLowerCase(),
    alignment_engine: alignment_engine.trim(),
    engine_version: engine_version.trim(),
    model_id: model_id.trim().toLowerCase(),
    normalization_version: normalization_version.trim(),
    schema_version: schema_version.trim()
  };

  const canonicalJSON = canonicalStringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

/**
 * Cálculo determinístico do Beat Analysis Fingerprint (beat_analysis_key)
 */
function computeBeatAnalysisKey({
  alignment_key,
  beat_parser_version = DEFAULT_BEAT_PARSER_VERSION,
  prompt_version = DEFAULT_BEAT_PROMPT_VERSION,
  schema_version = SCHEMA_VERSION
}) {
  if (!alignment_key || typeof alignment_key !== 'string') {
    throw new Error('[SCHEMA_ERROR] alignment_key é obrigatório para computeBeatAnalysisKey');
  }

  const canonicalObj = {
    alignment_key: alignment_key.trim().toLowerCase(),
    beat_parser_version: beat_parser_version.trim(),
    prompt_version: prompt_version.trim(),
    schema_version: schema_version.trim()
  };

  const canonicalJSON = canonicalStringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ALIGNMENT_ENGINE,
  DEFAULT_ENGINE_VERSION,
  DEFAULT_MODEL_ID,
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_BEAT_PARSER_VERSION,
  DEFAULT_BEAT_PROMPT_VERSION,
  MIN_TOKEN_COVERAGE,
  validateWordAlignment,
  validateSemanticBeat,
  computeAlignmentKey,
  computeBeatAnalysisKey
};
