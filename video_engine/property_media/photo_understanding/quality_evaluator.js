/**
 * Avaliador Determinístico de Qualidade e Editorial Utility — Photo Media Understanding (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 */

const { validateStrictScore, ALLOWED_UTILITY_LABELS } = require('./photo_analysis_schema');

const QUALITY_RULES_VERSION = '1.0.0';
const TARGET_SHORT_EDGE_PX = 900;

/**
 * Matriz de Autoridade e Origem dos Componentes de Qualidade
 */
const QUALITY_METRICS_AUTHORITY_MAP = Object.freeze({
  'specs.width': { source: 'deterministic_specs', description: 'Largura física da imagem inspecionada via ffprobe/decode' },
  'specs.height': { source: 'deterministic_specs', description: 'Altura física da imagem inspecionada via ffprobe/decode' },
  'specs.aspect_ratio': { source: 'deterministic_specs', description: 'Razão de aspecto física calculada deterministicamente' },
  'resolution_adequacy': { source: 'deterministic_specs', description: 'Suficiência de resolução para vídeo vertical 1080x1920 (target 900px short edge)' },
  'sharpness': { source: 'vlm', description: 'Nitidez óptica dos contornos avaliada por VLM' },
  'exposure': { source: 'vlm', description: 'Equilíbrio de alcance dinâmico e exposição avaliado por VLM' },
  'noise_compression': { source: 'vlm', description: 'Ausência de ruído ISO e artefatos de compressão JPEG avaliada por VLM' },
  'perspective_alignment': { source: 'vlm', description: 'Nivelamento vertical de paredes e ausência de distorção de lente extrema avaliado por VLM' },
  'composition': { source: 'vlm', description: 'Enquadramento e linhas-guia avaliados por VLM' },
  'framing': { source: 'vlm', description: 'Cortes estruturais e limites de cena avaliados por VLM' },
  'visual_balance': { source: 'vlm', description: 'Distribuição harmoniosa de pesos visuais avaliada por VLM' },
  'lighting_atmosphere': { source: 'vlm', description: 'Sensação acolhedora e iluminação do ambiente avaliada por VLM' },
  'cleanliness_staging': { source: 'vlm', description: 'Organização e ausência de desordem avaliada por VLM' },
  'room_coverage': { source: 'vlm', description: 'Amplitude e cobertura espacial do cômodo avaliada por VLM' },
  'feature_clarity': { source: 'vlm', description: 'Destaque e clareza das características de valor do imóvel avaliada por VLM' },
  'spaciousness_perception': { source: 'vlm', description: 'Sensação perceptível de espaço transmitida pela foto avaliada por VLM' },
  'obstruction_level': { source: 'vlm', description: 'Grau de desobstrução visual (1.0 = desimpedido; 0.0 = bloqueado) avaliado por VLM' },
  'technical_quality.score': { source: 'deterministic_formula', description: 'Média ponderada dos subscores técnicos' },
  'aesthetic_score.score': { source: 'deterministic_formula', description: 'Média ponderada dos subscores estéticos' },
  'editorial_utility.score': { source: 'deterministic_formula', description: 'Média ponderada dos subscores de utilidade editorial' },
  'composite_quality_score': { source: 'deterministic_formula', description: 'Score de qualidade global ponderado' },
  'utility_label': { source: 'deterministic_formula', description: 'Classificação editorial categórica por faixas de corte fixas' }
});

class QualityEvaluator {
  /**
   * Cálculo determinístico de resolution_adequacy
   * Fato físico derivado de specs da imagem (short_edge vs target de 900px)
   */
  static computeResolutionAdequacy(specs = {}) {
    const width = Number(specs.width || 0);
    const height = Number(specs.height || 0);
    const shortEdge = Number(specs.short_edge || Math.min(width, height));

    if (shortEdge <= 0) {
      return 0.0;
    }
    const ratio = shortEdge / TARGET_SHORT_EDGE_PX;
    const clamped = Math.max(0.0, Math.min(1.0, ratio));
    return Math.round(clamped * 100) / 100;
  }

  /**
   * Avaliação e consolidação estrita de todos os pilares de qualidade
   */
  static evaluateQuality({ rawVlmScores = {}, specs = {} }) {
    if (!rawVlmScores || typeof rawVlmScores !== 'object') {
      throw new Error('[QUALITY_EVALUATOR_ERROR] rawVlmScores é obrigatório');
    }

    // 1. Pilar Técnico
    const sharpness = validateStrictScore(rawVlmScores.sharpness, 'sharpness');
    const exposure = validateStrictScore(rawVlmScores.exposure, 'exposure');
    const noiseCompression = validateStrictScore(rawVlmScores.noise_compression, 'noise_compression');
    const perspectiveAlignment = validateStrictScore(rawVlmScores.perspective_alignment, 'perspective_alignment');
    
    // resolution_adequacy é calculado deterministicamente a partir das specs físicas
    const resolutionAdequacy = this.computeResolutionAdequacy(specs);
    validateStrictScore(resolutionAdequacy, 'resolution_adequacy');

    const rawTechScore = (
      0.30 * sharpness +
      0.25 * exposure +
      0.20 * noiseCompression +
      0.15 * resolutionAdequacy +
      0.10 * perspectiveAlignment
    );
    const techScore = Math.round(rawTechScore * 100) / 100;
    validateStrictScore(techScore, 'technical_quality.score');

    const technicalQuality = {
      sharpness,
      exposure,
      noise_compression: noiseCompression,
      resolution_adequacy: resolutionAdequacy,
      perspective_alignment: perspectiveAlignment,
      score: techScore
    };

    // 2. Pilar Estético & Composicional
    const composition = validateStrictScore(rawVlmScores.composition, 'composition');
    const framing = validateStrictScore(rawVlmScores.framing, 'framing');
    const visualBalance = validateStrictScore(rawVlmScores.visual_balance, 'visual_balance');
    const lightingAtmosphere = validateStrictScore(rawVlmScores.lighting_atmosphere, 'lighting_atmosphere');
    const cleanlinessStaging = validateStrictScore(rawVlmScores.cleanliness_staging, 'cleanliness_staging');

    const rawAestScore = (
      0.25 * composition +
      0.20 * framing +
      0.20 * visualBalance +
      0.20 * lightingAtmosphere +
      0.15 * cleanlinessStaging
    );
    const aestScore = Math.round(rawAestScore * 100) / 100;
    validateStrictScore(aestScore, 'aesthetic_score.score');

    const aestheticScore = {
      composition,
      framing,
      visual_balance: visualBalance,
      lighting_atmosphere: lightingAtmosphere,
      cleanliness_staging: cleanlinessStaging,
      score: aestScore
    };

    // 3. Pilar de Utilidade Editorial
    const roomCoverage = validateStrictScore(rawVlmScores.room_coverage, 'room_coverage');
    const featureClarity = validateStrictScore(rawVlmScores.feature_clarity, 'feature_clarity');
    const spaciousnessPerception = validateStrictScore(rawVlmScores.spaciousness_perception, 'spaciousness_perception');
    const obstructionLevel = validateStrictScore(rawVlmScores.obstruction_level, 'obstruction_level');

    const rawEditScore = (
      0.35 * roomCoverage +
      0.30 * featureClarity +
      0.20 * spaciousnessPerception +
      0.15 * obstructionLevel
    );
    const editScore = Math.round(rawEditScore * 100) / 100;
    validateStrictScore(editScore, 'editorial_utility.score');

    let utilityLabel = 'editorial_reject';
    if (editScore >= 0.80) {
      utilityLabel = 'high_value_anchor';
    } else if (editScore >= 0.60) {
      utilityLabel = 'supporting_detail';
    } else if (editScore >= 0.40) {
      utilityLabel = 'marginal_usable';
    }

    const editorialUtility = {
      room_coverage: roomCoverage,
      feature_clarity: featureClarity,
      spaciousness_perception: spaciousnessPerception,
      obstruction_level: obstructionLevel,
      score: editScore,
      utility_label: utilityLabel
    };

    // 4. Composite Quality Score
    const rawCompositeScore = (
      0.45 * editScore +
      0.30 * aestScore +
      0.25 * techScore
    );
    const compositeQualityScore = Math.round(rawCompositeScore * 100) / 100;
    validateStrictScore(compositeQualityScore, 'composite_quality_score');

    return {
      technical_quality: technicalQuality,
      aesthetic_score: aestheticScore,
      editorial_utility: editorialUtility,
      composite_quality_score: compositeQualityScore
    };
  }
}

module.exports = {
  QualityEvaluator,
  QUALITY_RULES_VERSION,
  QUALITY_METRICS_AUTHORITY_MAP,
  TARGET_SHORT_EDGE_PX
};
