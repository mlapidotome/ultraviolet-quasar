const {
  DEFAULT_MEDIA_RANKER_VERSION,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SEMANTIC_THRESHOLDS
} = require('./creative_direction_schema');

const MEDIA_RANKER_VERSION = '1.1.0';

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
 * Calcula a relevância semântica estrita entre a intenção do beat e um candidato (Vídeo ou Foto)
 * Garante a regra: SEMÂNTICA > QUALIDADE (Ambiente incompatível = 0.00)
 */
function computeSemanticRelevance(semanticIntent, candidate) {
  const reqRooms = semanticIntent.requested_room_types || [];
  const reqFeatures = semanticIntent.requested_features || [];
  const candPrimary = candidate.primary_room_type || candidate.room_type || '';
  const candSecondary = candidate.secondary_room_types || [];
  const candFeatures = candidate.features || [];

  // CASO 3: Beat Abstrato / Conceitual (sem cômodo e sem feature)
  if (reqRooms.length === 0 && reqFeatures.length === 0) {
    return 0.30;
  }

  // CASO 2: Beat Feature-Only (sem cômodo explícito, mas com features específicas)
  if (reqRooms.length === 0 && reqFeatures.length > 0) {
    let matchingCount = 0;
    for (const f of reqFeatures) {
      if (candFeatures.includes(f)) matchingCount++;
    }

    // Se o beat pediu features específicas e o candidato tem ZERO features, relevância é ZERO
    if (matchingCount === 0) {
      return 0.00;
    }

    const baseScore = 0.70;
    const bonus = Math.min(0.20, (matchingCount - 1) * 0.10);
    return Math.min(1.0, Math.round((baseScore + bonus) * 100) / 100);
  }

  // CASO 1: Beat Especifica Cômodo
  const isExactPrimary = reqRooms.includes(candPrimary);
  const isExactSecondary = !isExactPrimary && Array.isArray(candSecondary) && candSecondary.some(r => reqRooms.includes(r));
  let isCompatible = false;

  if (!isExactPrimary && !isExactSecondary && reqRooms.length > 0) {
    for (const r of reqRooms) {
      if (COMPATIBLE_ROOM_PAIRS.has(`${r}:${candPrimary}`)) {
        isCompatible = true;
        break;
      }
    }
  }

  // Se o beat pediu cômodo e o candidato não possui correspondência primária, secundária ou compatível: ZERO
  if (!isExactPrimary && !isExactSecondary && !isCompatible) {
    return 0.00;
  }

  let baseScore = 0.0;
  if (isExactPrimary) {
    baseScore = 0.80;
  } else if (isExactSecondary) {
    baseScore = 0.65;
  } else if (isCompatible) {
    baseScore = 0.50;
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
 * Projeta todos os recursos de mídia do catálogo (Vídeo e Fotos) em UnifiedMediaCandidate
 */
function buildUnifiedMediaCandidates({
  mediaCatalog,
  consumedFootageMap = {}
} = {}) {
  const unifiedCandidates = [];

  // 1. Processar Vídeo Assets (se houver)
  const videoAssets = mediaCatalog.video_assets || (mediaCatalog.segments ? [mediaCatalog] : []);
  for (const v of videoAssets) {
    const assetId = v.asset_id || `ast_pvid_${mediaCatalog.property_ref || 'unknown'}_video`;
    const fileHash = v.physical_file_hash || v.file_hash || '';
    const segments = v.segments || [];

    for (const seg of segments) {
      const segIdx = seg.segment_index;
      const segStart = seg.start_ms;
      const segEnd = seg.end_ms;
      const compositeKey = `${assetId}:${segIdx}`;
      const consumedStart = consumedFootageMap[compositeKey] !== undefined
        ? consumedFootageMap[compositeKey]
        : (consumedFootageMap[segIdx] !== undefined ? consumedFootageMap[segIdx] : segStart);
      const availableDuration = Math.max(0, segEnd - consumedStart);

      unifiedCandidates.push({
        candidate_id: `seg_${String(segIdx).padStart(2, '0')}_${seg.room_type}`,
        media_kind: 'video_segment',
        media_type: 'property_video_segment',
        asset_id: assetId,
        physical_file_hash: fileHash,
        segment_index: segIdx,
        storage_path: v.storage_path || '',
        room_type: seg.room_type,
        primary_room_type: seg.room_type,
        secondary_room_types: seg.secondary_room_types || [],
        features: seg.features || [],
        confidence: Number(seg.confidence !== undefined ? seg.confidence : 0.5),
        technical_quality_score: Number(seg.technical_quality_score !== undefined ? seg.technical_quality_score : 0.5),
        aesthetic_score: Number(seg.aesthetic_score !== undefined ? seg.aesthetic_score : 0.5),
        editorial_utility_score: Number(seg.aesthetic_score !== undefined ? seg.aesthetic_score : 0.5),
        is_static: false,
        available_start_ms: consumedStart,
        available_end_ms: segEnd,
        available_duration_ms: availableDuration
      });
    }
  }

  // 2. Processar Photo Assets (se houver)
  const photoAssets = mediaCatalog.photo_assets || mediaCatalog.photos || [];
  for (let pIdx = 0; pIdx < photoAssets.length; pIdx++) {
    const p = photoAssets[pIdx];
    const sem = p.semantic || {};
    const qual = p.quality || {};
    const primaryRoom = sem.primary_room_type || p.primary_room_type || p.room_type || 'unknown';
    const assetId = p.asset_id || `ast_pimg_${mediaCatalog.property_ref || 'unknown'}_${pIdx + 1}`;
    const fileHash = p.physical_file_hash || p.file_hash || '';

    const techQuality = Number(qual.technical_quality?.score !== undefined ? qual.technical_quality.score : (p.technical_quality_score || 0.8));
    const aesthetic = Number(qual.aesthetic_score?.score !== undefined ? qual.aesthetic_score.score : (p.aesthetic_score || 0.8));
    const editorialUtility = Number(qual.editorial_utility?.score !== undefined ? qual.editorial_utility.score : (p.editorial_utility_score || 0.8));
    const confidence = Number(sem.confidence !== undefined ? sem.confidence : (p.confidence || 0.8));

    const candidateId = p.candidate_id || assetId;
    unifiedCandidates.push({
      candidate_id: candidateId,
      media_kind: 'photo',
      media_type: 'property_photo',
      asset_id: assetId,
      physical_file_hash: fileHash,
      segment_index: null,
      storage_path: p.storage_path || '',
      room_type: primaryRoom,
      primary_room_type: primaryRoom,
      secondary_room_types: sem.secondary_room_types || p.secondary_room_types || [],
      features: sem.features || p.features || [],
      confidence: confidence,
      technical_quality_score: techQuality,
      aesthetic_score: aesthetic,
      editorial_utility_score: editorialUtility,
      is_static: true,
      available_start_ms: 0,
      available_end_ms: Infinity,
      available_duration_ms: Infinity
    });
  }

  return unifiedCandidates;
}

/**
 * Avalia e ranqueia todos os candidatos disponíveis (Vídeo e Fotos) para um beat
 */
function evaluateAndRankCandidates({
  semanticIntent,
  requiredDurationMs,
  mediaCatalog,
  lastSelectedCandidate = null,
  lastSelectedSegmentIndex = null,
  recentPhotosUsageMap = {},
  currentBeatIndex = 0,
  recentModalityFlips = 0,
  consumedFootageMap = {},
  scoringWeights = DEFAULT_SCORING_WEIGHTS,
  semanticThresholds = DEFAULT_SEMANTIC_THRESHOLDS
}) {
  const unifiedCandidates = buildUnifiedMediaCandidates({ mediaCatalog, consumedFootageMap });
  const evaluatedCandidates = [];

  const wRel = scoringWeights.semantic_relevance !== undefined ? scoringWeights.semantic_relevance : 0.50;
  const wTech = scoringWeights.technical_quality !== undefined ? scoringWeights.technical_quality : 0.30;
  const wAes = scoringWeights.aesthetic_score !== undefined ? scoringWeights.aesthetic_score : 0.20;

  for (const c of unifiedCandidates) {
    const isPhoto = (c.media_kind === 'photo');
    const isFeasible = isPhoto ? true : (c.available_duration_ms >= requiredDurationMs);
    const infeasibleReason = isFeasible
      ? null
      : `Duração disponível (${c.available_duration_ms}ms) menor que a necessária (${requiredDurationMs}ms)`;

    const relevance = computeSemanticRelevance(semanticIntent, c);

    // Normalização de qualidade intrínseca e estética por modalidade
    let intrinsicQuality = 0.5;
    let aestheticStrength = 0.5;

    if (isPhoto) {
      intrinsicQuality = (0.35 * c.technical_quality_score) + (0.35 * c.aesthetic_score) + (0.30 * c.editorial_utility_score);
      aestheticStrength = (0.60 * c.editorial_utility_score) + (0.40 * c.aesthetic_score);
    } else {
      intrinsicQuality = (0.50 * c.technical_quality_score) + (0.50 * c.aesthetic_score);
      aestheticStrength = c.aesthetic_score;
    }

    // Penalidade de Repetição Imediata (-0.25)
    let isImmediateRepeat = false;
    if (lastSelectedCandidate) {
      if (isPhoto && lastSelectedCandidate.media_kind === 'photo') {
        isImmediateRepeat = (c.physical_file_hash && lastSelectedCandidate.physical_file_hash === c.physical_file_hash);
      } else if (!isPhoto && lastSelectedCandidate.media_kind === 'video_segment') {
        isImmediateRepeat = (lastSelectedCandidate.segment_index === c.segment_index);
      }
    } else if (lastSelectedSegmentIndex !== null && !isPhoto) {
      isImmediateRepeat = (lastSelectedSegmentIndex === c.segment_index);
    }
    const repetitionPenalty = isImmediateRepeat ? 0.25 : 0.00;

    // Penalidade de Reutilização Recente de Foto (-0.10) se usada nos últimos 3 beats
    let recencyPenalty = 0.00;
    if (isPhoto && !isImmediateRepeat && c.physical_file_hash && recentPhotosUsageMap[c.physical_file_hash] !== undefined) {
      const lastUsedBeat = recentPhotosUsageMap[c.physical_file_hash];
      if ((currentBeatIndex - lastUsedBeat) <= 3) {
        recencyPenalty = 0.10;
      }
    }

    // Bônus de Sequência Fotográfica Complementar (+0.05)
    let complementaryBonus = 0.00;
    if (isPhoto && lastSelectedCandidate && lastSelectedCandidate.media_kind === 'photo') {
      const prevRoom = lastSelectedCandidate.primary_room_type || lastSelectedCandidate.room_type;
      if (prevRoom === c.primary_room_type && lastSelectedCandidate.physical_file_hash !== c.physical_file_hash) {
        complementaryBonus = 0.05;
      }
    }

    // Penalidade Anti-Ping-Pong (-0.15)
    let pingPongPenalty = 0.00;
    if (lastSelectedCandidate && lastSelectedCandidate.media_kind !== c.media_kind && recentModalityFlips >= 2 && requiredDurationMs < 2500) {
      pingPongPenalty = 0.15;
    }

    const totalPenalties = repetitionPenalty + recencyPenalty + pingPongPenalty;
    const rawScore = (relevance * wRel) + (intrinsicQuality * wTech) + (aestheticStrength * wAes) - totalPenalties + complementaryBonus;
    const finalScore = Math.max(0.0, Math.min(1.0, Math.round(rawScore * 1000) / 1000));

    let selectionRationale = '';
    if (relevance === 0.0) {
      selectionRationale = `Descartado: sem match semântico (${c.primary_room_type} vs pedido: ${semanticIntent.requested_room_types.join(',') || semanticIntent.requested_features.join(',')})`;
    } else if (!isFeasible) {
      selectionRationale = `Inviável: ${infeasibleReason}`;
    } else if (relevance >= 0.80) {
      selectionRationale = `Match semântico forte (${c.primary_room_type}, ${c.media_kind}) com score ${finalScore}`;
    } else {
      selectionRationale = `Match parcial (${c.primary_room_type}, ${c.media_kind}) com score ${finalScore}`;
    }

    evaluatedCandidates.push({
      ...c,
      required_duration_ms: requiredDurationMs,
      is_feasible: isFeasible,
      infeasible_reason: infeasibleReason,
      semantic_relevance: relevance,
      intrinsic_quality: intrinsicQuality,
      aesthetic_strength: aestheticStrength,
      repetition_penalty: repetitionPenalty,
      recency_penalty: recencyPenalty,
      ping_pong_penalty: pingPongPenalty,
      complementary_bonus: complementaryBonus,
      complementary_sequence_bonus: complementaryBonus,
      final_match_score: finalScore,
      selection_rationale: selectionRationale
    });
  }

  // 7-Level Deterministic Tie-Breaker
  evaluatedCandidates.sort((a, b) => {
    // 1. Viabilidade (feasible primeiro)
    if (a.is_feasible !== b.is_feasible) return a.is_feasible ? -1 : 1;
    // 2. final_match_score DESC
    if (Math.abs(b.final_match_score - a.final_match_score) > 0.001) return b.final_match_score - a.final_match_score;
    // 3. semantic_relevance DESC
    if (Math.abs(b.semantic_relevance - a.semantic_relevance) > 0.001) return b.semantic_relevance - a.semantic_relevance;
    // 4. editorial_utility / aesthetic DESC
    const utilA = a.editorial_utility_score !== undefined ? a.editorial_utility_score : a.aesthetic_score;
    const utilB = b.editorial_utility_score !== undefined ? b.editorial_utility_score : b.aesthetic_score;
    if (Math.abs(utilB - utilA) > 0.001) return utilB - utilA;
    // 5. technical_quality DESC
    if (Math.abs(b.technical_quality_score - a.technical_quality_score) > 0.001) return b.technical_quality_score - a.technical_quality_score;
    // 6. confidence DESC
    if (Math.abs(b.confidence - a.confidence) > 0.001) return b.confidence - a.confidence;
    // 7. Deterministic Lexicographic Tie-Break ASC
    return String(a.candidate_id || a.asset_id).localeCompare(String(b.candidate_id || b.asset_id));
  });

  return evaluatedCandidates;
}

module.exports = {
  MEDIA_RANKER_VERSION,
  COMPATIBLE_ROOM_PAIRS,
  computeSemanticRelevance,
  buildUnifiedMediaCandidates,
  evaluateAndRankCandidates
};
