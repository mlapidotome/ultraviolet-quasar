/**
 * Módulo de Ranking Semântico e Viabilidade Física — Creative Director (Fase 4A.3)
 * Bali Imóveis
 */

const {
  DEFAULT_MEDIA_RANKER_VERSION,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SEMANTIC_THRESHOLDS
} = require('./creative_direction_schema');

const MEDIA_RANKER_VERSION = DEFAULT_MEDIA_RANKER_VERSION;

// Relações semânticas aceitáveis entre ambientes contíguos/compatíveis
const COMPATIBLE_ROOM_PAIRS = new Set([
  'living_room:dining_room',
  'dining_room:living_room',
  'balcony:city_view',
  'city_view:balcony',
  'bedroom:suite',
  'suite:bedroom'
]);

/**
 * Calcula a relevância semântica estrita entre a intenção do beat e um segmento de mídia
 */
function computeSemanticRelevance(semanticIntent, candidate) {
  const reqRooms = semanticIntent.requested_room_types || [];
  const reqFeatures = semanticIntent.requested_features || [];
  const candRoom = candidate.room_type || '';
  const candFeatures = candidate.features || [];

  if (reqRooms.length === 0 && reqFeatures.length === 0) {
    // Fala abstrata sem menção a cômodo ou feature
    return 0.30;
  }

  let isExactRoom = reqRooms.includes(candRoom);
  let isCompatibleRoom = false;

  if (!isExactRoom && reqRooms.length > 0) {
    for (const r of reqRooms) {
      if (COMPATIBLE_ROOM_PAIRS.has(`${r}:${candRoom}`)) {
        isCompatibleRoom = true;
        break;
      }
    }
  }

  // Se o beat pediu cômodo e o candidato é incompatível, relevância é ZERO
  if (reqRooms.length > 0 && !isExactRoom && !isCompatibleRoom) {
    return 0.00;
  }

  // Base score
  let baseScore = 0.0;
  if (isExactRoom) {
    baseScore = 0.80;
  } else if (isCompatibleRoom) {
    baseScore = 0.50;
  } else if (reqRooms.length === 0 && reqFeatures.length > 0) {
    baseScore = 0.60;
  }

  // Bônus de features coincidentes (+0.10 por feature, máx +0.20)
  let matchingFeatureCount = 0;
  for (const f of reqFeatures) {
    if (candFeatures.includes(f)) {
      matchingFeatureCount++;
    }
  }
  const featureBonus = Math.min(0.20, matchingFeatureCount * 0.10);

  return Math.min(1.0, Math.round((baseScore + featureBonus) * 100) / 100);
}

/**
 * Avalia e ranqueia todos os candidatos disponíveis do catálogo 4A.1 para um beat
 */
function evaluateAndRankCandidates({
  semanticIntent,
  requiredDurationMs,
  mediaCatalog,
  lastSelectedSegmentIndex = null,
  consumedFootageMap = {},
  scoringWeights = DEFAULT_SCORING_WEIGHTS,
  semanticThresholds = DEFAULT_SEMANTIC_THRESHOLDS
}) {
  const segments = mediaCatalog.segments || [];
  const evaluatedCandidates = [];

  for (const seg of segments) {
    const segIdx = seg.segment_index;
    const segStart = seg.start_ms;
    const segEnd = seg.end_ms;
    const consumedStart = consumedFootageMap[segIdx] !== undefined ? consumedFootageMap[segIdx] : segStart;
    const availableDuration = Math.max(0, segEnd - consumedStart);

    const isFeasible = availableDuration >= requiredDurationMs;
    const infeasibleReason = isFeasible
      ? null
      : `Duração disponível (${availableDuration}ms) menor que a necessária (${requiredDurationMs}ms)`;

    const relevance = computeSemanticRelevance(semanticIntent, seg);
    const techQuality = Number(seg.technical_quality_score || 0.5);
    const aesthetic = Number(seg.aesthetic_score || 0.5);
    const confidence = Number(seg.confidence || 0.5);

    // Penalidade de repetição se for o mesmo segmento usado imediatamente antes
    const isRepeated = (lastSelectedSegmentIndex !== null && lastSelectedSegmentIndex === segIdx);
    const repetitionPenalty = isRepeated ? 0.25 : 0.00;

    // Fórmula canônica de score: relevância (50%) + tech (30%) + aesthetic (20%) - penalty
    const wRel = scoringWeights.semantic_relevance !== undefined ? scoringWeights.semantic_relevance : 0.50;
    const wTech = scoringWeights.technical_quality !== undefined ? scoringWeights.technical_quality : 0.30;
    const wAes = scoringWeights.aesthetic_score !== undefined ? scoringWeights.aesthetic_score : 0.20;

    const rawScore = (relevance * wRel) + (techQuality * wTech) + (aesthetic * wAes) - repetitionPenalty;
    const finalScore = Math.max(0.0, Math.min(1.0, Math.round(rawScore * 1000) / 1000));

    let selectionRationale = '';
    if (relevance === 0.0) {
      selectionRationale = `Descartado: cômodo incompatível (${seg.room_type} vs pedido: ${semanticIntent.requested_room_types.join(',')})`;
    } else if (!isFeasible) {
      selectionRationale = `Inviável: ${infeasibleReason}`;
    } else if (relevance >= 0.80) {
      selectionRationale = `Match semântico forte (${seg.room_type}) com score ${finalScore}`;
    } else {
      selectionRationale = `Match parcial (${seg.room_type}) com score ${finalScore}`;
    }

    evaluatedCandidates.push({
      candidate_id: `seg_${String(segIdx).padStart(2, '0')}_${seg.room_type}`,
      asset_id: mediaCatalog.asset_id,
      segment_index: segIdx,
      media_type: 'property_video_segment',
      room_type: seg.room_type,
      features: seg.features || [],
      available_start_ms: consumedStart,
      available_end_ms: segEnd,
      available_duration_ms: availableDuration,
      required_duration_ms: requiredDurationMs,
      is_feasible: isFeasible,
      infeasible_reason: infeasibleReason,
      semantic_relevance: relevance,
      technical_quality: techQuality,
      aesthetic_score: aesthetic,
      confidence: confidence,
      repetition_penalty: repetitionPenalty,
      final_match_score: finalScore,
      selection_rationale: selectionRationale
    });
  }

  // Ordenação determinística com tie-break estrito:
  // 1. Viabilidade (feasible primeiro)
  // 2. final_match_score DESC
  // 3. semantic_relevance DESC
  // 4. confidence DESC
  // 5. segment_index ASC
  evaluatedCandidates.sort((a, b) => {
    if (a.is_feasible !== b.is_feasible) return a.is_feasible ? -1 : 1;
    if (Math.abs(b.final_match_score - a.final_match_score) > 0.001) return b.final_match_score - a.final_match_score;
    if (Math.abs(b.semantic_relevance - a.semantic_relevance) > 0.001) return b.semantic_relevance - a.semantic_relevance;
    if (Math.abs(b.confidence - a.confidence) > 0.001) return b.confidence - a.confidence;
    return a.segment_index - b.segment_index;
  });

  return evaluatedCandidates;
}

module.exports = {
  MEDIA_RANKER_VERSION,
  COMPATIBLE_ROOM_PAIRS,
  computeSemanticRelevance,
  evaluateAndRankCandidates
};
