/**
 * Schema e Validação Canônica — Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const crypto = require('crypto');
const { canonicalStringify } = require('../../asset_service');
const { ALLOWED_ROOM_TYPES, ALLOWED_FEATURES } = require('../../media_understanding/analysis_schema');

const SCHEMA_VERSION = '1.0.0';
const DEFAULT_ANALYZER_TYPE = 'photo_vlm_understanding';
const DEFAULT_ANALYZER_VERSION = '1.0.0';
const DEFAULT_PROMPT_VERSION = 'photo_vlm_v1';
const DEFAULT_QUALITY_RULES_VERSION = '1.0.0';
const TAXONOMY_VERSION = '1.0.0';

const ALLOWED_UTILITY_LABELS = Object.freeze([
  'high_value_anchor',
  'supporting_detail',
  'marginal_usable',
  'editorial_reject'
]);

/**
 * Validação estrita de formato SHA-256 hexadecimal (exatamente 64 caracteres hex)
 */
function validateSha256Hex(val, fieldName = 'hash') {
  if (!val || typeof val !== 'string') {
    throw new Error(`[SCHEMA_ERROR] ${fieldName} deve ser uma string não-vazia`);
  }
  const clean = val.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) {
    throw new Error(`[SCHEMA_ERROR] ${fieldName} deve ser um hash SHA-256 hexadecimal válido de 64 caracteres, recebido: '${val}'`);
  }
  return clean;
}

/**
 * Validação estrita de score numérico no intervalo [0.0, 1.0].
 * ZERO clamping: qualquer valor fora dos limites, NaN, Infinity ou não-numérico DISPARA ERRO.
 */
function validateStrictScore(val, fieldName = 'score') {
  if (val === null || val === undefined) {
    throw new Error(`[SCORE_OUT_OF_BOUNDS_ERROR] Score '${fieldName}' é obrigatório e não pode ser null/undefined`);
  }
  if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    throw new Error(`[SCORE_OUT_OF_BOUNDS_ERROR] Score '${fieldName}' com valor '${val}' não é um número válido`);
  }
  if (val < 0.0 || val > 1.0) {
    throw new Error(`[SCORE_OUT_OF_BOUNDS_ERROR] Score '${fieldName}' com valor ${val} is outside strict bounds [0.0, 1.0]`);
  }
  return Math.round(val * 100) / 100;
}

/**
 * Validação estrita de room_type contra a taxonomia oficial de 16 ambientes
 */
function validateStrictRoomType(roomType, fieldName = 'primary_room_type') {
  if (!roomType || typeof roomType !== 'string') {
    throw new Error(`[INVALID_ROOM_TYPE_ERROR] ${fieldName} deve ser uma string válida, recebido: ${typeof roomType}`);
  }
  const clean = roomType.toLowerCase().trim();
  if (!ALLOWED_ROOM_TYPES.includes(clean)) {
    throw new Error(`[INVALID_ROOM_TYPE_ERROR] ${fieldName} inválido: '${roomType}' (permitidos: ${ALLOWED_ROOM_TYPES.join(', ')})`);
  }
  return clean;
}

/**
 * Validação estrita de feature contra a taxonomia oficial de 16 características
 */
function validateStrictFeature(feature) {
  if (!feature || typeof feature !== 'string') {
    throw new Error(`[INVALID_FEATURE_ERROR] feature deve ser uma string, recebido: ${typeof feature}`);
  }
  const clean = feature.toLowerCase().trim();
  if (!ALLOWED_FEATURES.includes(clean)) {
    throw new Error(`[INVALID_FEATURE_ERROR] feature inválida: '${feature}' (permitidas: ${ALLOWED_FEATURES.join(', ')})`);
  }
  return clean;
}

/**
 * Validação estrita e normalização de array de features
 */
function normalizeAndValidateFeatures(rawFeatures = []) {
  if (!Array.isArray(rawFeatures)) {
    throw new Error('[SCHEMA_ERROR] features deve ser um array');
  }
  const seen = new Set();
  const normalized = [];
  for (const item of rawFeatures) {
    const clean = validateStrictFeature(item);
    if (!seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  }
  normalized.sort(); // Ordenação determinística
  return normalized;
}

/**
 * Validação estrita e normalização de secondary_room_types
 */
function normalizeAndValidateSecondaryRooms(rawRooms = [], primaryRoom = null) {
  if (!rawRooms) return [];
  if (!Array.isArray(rawRooms)) {
    throw new Error('[SCHEMA_ERROR] secondary_room_types deve ser um array');
  }
  const seen = new Set();
  const normalized = [];
  for (const item of rawRooms) {
    const clean = validateStrictRoomType(item, 'secondary_room_type');
    if (primaryRoom && clean === primaryRoom) continue; // Não duplicar primary no secondary
    if (!seen.has(clean)) {
      seen.add(clean);
      normalized.push(clean);
    }
  }
  normalized.sort(); // Ordenação determinística
  return normalized;
}

/**
 * Cálculo Determinístico do Canonical Photo Analysis Key (photo_analysis_key)
 * Content-addressed, global e agnóstico de propriedade.
 */
function computePhotoAnalysisKey({
  physical_file_hash,
  analyzer_type = DEFAULT_ANALYZER_TYPE,
  analyzer_version = DEFAULT_ANALYZER_VERSION,
  model_id,
  prompt_version = DEFAULT_PROMPT_VERSION,
  schema_version = SCHEMA_VERSION,
  quality_rules_version = DEFAULT_QUALITY_RULES_VERSION,
  taxonomy_version = TAXONOMY_VERSION,
  provider_config = {}
}) {
  const cleanPhysicalHash = validateSha256Hex(physical_file_hash, 'physical_file_hash');
  if (!model_id || typeof model_id !== 'string') {
    throw new Error('[SCHEMA_ERROR] model_id é obrigatório para computePhotoAnalysisKey');
  }

  const canonicalObj = {
    physical_file_hash: cleanPhysicalHash,
    analyzer_type: String(analyzer_type || DEFAULT_ANALYZER_TYPE).trim(),
    analyzer_version: String(analyzer_version || DEFAULT_ANALYZER_VERSION).trim(),
    model_id: String(model_id).trim().toLowerCase(),
    prompt_version: String(prompt_version || DEFAULT_PROMPT_VERSION).trim(),
    schema_version: String(schema_version || SCHEMA_VERSION).trim(),
    quality_rules_version: String(quality_rules_version || DEFAULT_QUALITY_RULES_VERSION).trim(),
    taxonomy_version: String(taxonomy_version || TAXONOMY_VERSION).trim(),
    provider_config: provider_config && typeof provider_config === 'object' ? provider_config : {}
  };

  const canonicalJSON = canonicalStringify(canonicalObj);
  return crypto.createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
}

/**
 * Validação do objeto GlobalPhotoAnalysis persistido no cache global
 * Assegura que nenhum dado property-scoped contamine o cache global.
 */
function validateGlobalPhotoAnalysis(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('[SCHEMA_ERROR] GlobalPhotoAnalysis inválido ou nulo');
  }

  // 1. Proibição estrita de contaminação por contexto de propriedade
  const forbiddenFields = [
    'property_ref',
    'asset_id',
    'crm_photo_id',
    'crm_category',
    'raw_crm_category',
    'crm_position',
    'crm_is_cover',
    'crm_context',
    'divergence_detected',
    'divergence_reason',
    'semantic_reconciliation'
  ];

  for (const field of forbiddenFields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      throw new Error(`[SCHEMA_ERROR] GlobalPhotoAnalysis não pode conter campo property-scoped: '${field}'`);
    }
  }

  // 2. Validação dos campos canônicos obrigatórios com verificação estrita de formato SHA-256
  const cleanAnalysisKey = validateSha256Hex(obj.photo_analysis_key, 'photo_analysis_key');
  const cleanPhysicalHash = validateSha256Hex(obj.physical_file_hash, 'physical_file_hash');

  // 3. Validação Semântica
  if (!obj.semantic || typeof obj.semantic !== 'object') {
    throw new Error('[SCHEMA_ERROR] Bloco semantic ausente ou inválido');
  }
  const primaryRoom = validateStrictRoomType(obj.semantic.primary_room_type, 'primary_room_type');
  const secondaryRooms = normalizeAndValidateSecondaryRooms(obj.semantic.secondary_room_types, primaryRoom);
  const features = normalizeAndValidateFeatures(obj.semantic.features);
  const confidence = validateStrictScore(obj.semantic.confidence, 'confidence');
  const description = obj.semantic.description ? String(obj.semantic.description).slice(0, 500) : '';

  // 4. Validação de Qualidade
  if (!obj.quality || typeof obj.quality !== 'object') {
    throw new Error('[SCHEMA_ERROR] Bloco quality ausente ou inválido');
  }
  const tech = obj.quality.technical_quality;
  const aest = obj.quality.aesthetic_score;
  const edit = obj.quality.editorial_utility;
  const composite = validateStrictScore(obj.quality.composite_quality_score, 'composite_quality_score');

  if (!tech || !aest || !edit) {
    throw new Error('[SCHEMA_ERROR] Sub-blocos de qualidade incompletos em GlobalPhotoAnalysis');
  }

  validateStrictScore(tech.sharpness, 'sharpness');
  validateStrictScore(tech.exposure, 'exposure');
  validateStrictScore(tech.noise_compression, 'noise_compression');
  validateStrictScore(tech.resolution_adequacy, 'resolution_adequacy');
  validateStrictScore(tech.perspective_alignment, 'perspective_alignment');
  validateStrictScore(tech.score, 'technical_quality.score');

  validateStrictScore(aest.composition, 'composition');
  validateStrictScore(aest.framing, 'framing');
  validateStrictScore(aest.visual_balance, 'visual_balance');
  validateStrictScore(aest.lighting_atmosphere, 'lighting_atmosphere');
  validateStrictScore(aest.cleanliness_staging, 'cleanliness_staging');
  validateStrictScore(aest.score, 'aesthetic_score.score');

  validateStrictScore(edit.room_coverage, 'room_coverage');
  validateStrictScore(edit.feature_clarity, 'feature_clarity');
  validateStrictScore(edit.spaciousness_perception, 'spaciousness_perception');
  validateStrictScore(edit.obstruction_level, 'obstruction_level');
  validateStrictScore(edit.score, 'editorial_utility.score');

  if (!ALLOWED_UTILITY_LABELS.includes(edit.utility_label)) {
    throw new Error(`[SCHEMA_ERROR] utility_label inválido: '${edit.utility_label}'`);
  }

  // 5. Validação de Provenance do Analisador
  if (!obj.analyzer_provenance || typeof obj.analyzer_provenance !== 'object') {
    throw new Error('[SCHEMA_ERROR] Bloco analyzer_provenance ausente ou inválido');
  }

  return {
    photo_analysis_key: cleanAnalysisKey,
    physical_file_hash: cleanPhysicalHash,
    semantic: {
      primary_room_type: primaryRoom,
      secondary_room_types: secondaryRooms,
      features: features,
      description: description,
      confidence: confidence
    },
    quality: obj.quality,
    analyzer_provenance: obj.analyzer_provenance
  };
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ANALYZER_TYPE,
  DEFAULT_ANALYZER_VERSION,
  DEFAULT_PROMPT_VERSION,
  DEFAULT_QUALITY_RULES_VERSION,
  TAXONOMY_VERSION,
  ALLOWED_ROOM_TYPES,
  ALLOWED_FEATURES,
  ALLOWED_UTILITY_LABELS,
  validateSha256Hex,
  validateStrictScore,
  validateStrictRoomType,
  validateStrictFeature,
  normalizeAndValidateFeatures,
  normalizeAndValidateSecondaryRooms,
  computePhotoAnalysisKey,
  validateGlobalPhotoAnalysis
};
