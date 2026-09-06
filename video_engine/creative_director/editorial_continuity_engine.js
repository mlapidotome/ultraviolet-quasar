/**
 * Módulo de Continuidade Editorial e Regras Cinematográficas — Creative Director (Fase 4A.3)
 * Bali Imóveis
 */

const {
  DEFAULT_CONTINUITY_ENGINE_VERSION,
  DEFAULT_FALLBACK_POLICY_VERSION,
  DEFAULT_SEMANTIC_THRESHOLDS
} = require('./creative_direction_schema');
const { computeSemanticRelevance } = require('./media_ranker');

const CONTINUITY_ENGINE_VERSION = DEFAULT_CONTINUITY_ENGINE_VERSION;
const FALLBACK_POLICY_VERSION = DEFAULT_FALLBACK_POLICY_VERSION;

/**
 * Seleciona a melhor decisão visual para um beat ou gera uma sequência de 2 takes / fallback
 */
function resolveVisualDecisionsForBeat({
  beat,
  rankedCandidates,
  mediaCatalog,
  consumedFootageMap,
  lastVisualDecision = null,
  semanticThresholds = DEFAULT_SEMANTIC_THRESHOLDS
}) {
  const beatDuration = beat.duration_ms;
  const minRelevance = semanticThresholds.min_semantic_relevance || 0.40;
  const minVisualDuration = semanticThresholds.min_visual_duration_ms || 1500;

  // 1. Filtrar candidatos viáveis com relevância >= minRelevance
  const viableCandidates = rankedCandidates.filter(c => c.is_feasible && c.semantic_relevance >= minRelevance);

  // 2. Tentar Take Extension se o beat anterior usou o mesmo cômodo e há footage restante
  if (lastVisualDecision && viableCandidates.length > 0) {
    const prevSegIdx = lastVisualDecision.selected_segment_index;
    const sameSegCandidate = viableCandidates.find(c => c.segment_index === prevSegIdx);

    if (sameSegCandidate) {
      const segStart = sameSegCandidate.available_start_ms;
      const segEnd = sameSegCandidate.available_end_ms;
      if (segEnd - segStart >= beatDuration) {
        // Estender take continuamente
        const sourceIn = segStart;
        const sourceOut = sourceIn + beatDuration;
        consumedFootageMap[prevSegIdx] = sourceOut;

        return [{
          timeline_start_ms: beat.start_ms,
          timeline_end_ms: beat.end_ms,
          timeline_duration_ms: beatDuration,
          selected_asset_id: sameSegCandidate.asset_id,
          selected_segment_index: prevSegIdx,
          source_in_ms: sourceIn,
          source_out_ms: sourceOut,
          source_duration_ms: beatDuration,
          confidence: sameSegCandidate.confidence,
          fallback_used: false,
          fallback_type: null,
          selection_reason: `Take extension contínuo do segmento #${prevSegIdx} (${sameSegCandidate.room_type})`
        }];
      }
    }
  }

  // 3. Caso normal: selecionar o melhor candidato viável único
  if (viableCandidates.length > 0) {
    const winner = viableCandidates[0];
    const sourceIn = winner.available_start_ms;
    const sourceOut = sourceIn + beatDuration;
    consumedFootageMap[winner.segment_index] = sourceOut;

    return [{
      timeline_start_ms: beat.start_ms,
      timeline_end_ms: beat.end_ms,
      timeline_duration_ms: beatDuration,
      selected_asset_id: winner.asset_id,
      selected_segment_index: winner.segment_index,
      source_in_ms: sourceIn,
      source_out_ms: sourceOut,
      source_duration_ms: beatDuration,
      confidence: winner.confidence,
      fallback_used: false,
      fallback_type: null,
      selection_reason: `Vencedor por maior score semântico (${winner.room_type}, score: ${winner.final_match_score})`
    }];
  }

  // 4. Se nenhum take único cobre a duração total, tentar sequência de 2 takes compatíveis
  const partiallyFeasible = rankedCandidates.filter(c =>
    c.semantic_relevance >= minRelevance &&
    c.available_duration_ms >= minVisualDuration
  );

  if (partiallyFeasible.length >= 2) {
    const take1Candidate = partiallyFeasible[0];
    const take1Duration = Math.min(take1Candidate.available_duration_ms, Math.round(beatDuration / 2));
    const take2Duration = beatDuration - take1Duration;

    if (take1Duration >= minVisualDuration && take2Duration >= minVisualDuration) {
      // Encontrar segundo take diferente que cubra take2Duration
      const take2Candidate = partiallyFeasible.find(c =>
        c.segment_index !== take1Candidate.segment_index &&
        c.available_duration_ms >= take2Duration
      );

      if (take2Candidate) {
        const t1SourceIn = take1Candidate.available_start_ms;
        const t1SourceOut = t1SourceIn + take1Duration;
        consumedFootageMap[take1Candidate.segment_index] = t1SourceOut;

        const t2SourceIn = take2Candidate.available_start_ms;
        const t2SourceOut = t2SourceIn + take2Duration;
        consumedFootageMap[take2Candidate.segment_index] = t2SourceOut;

        return [
          {
            timeline_start_ms: beat.start_ms,
            timeline_end_ms: beat.start_ms + take1Duration,
            timeline_duration_ms: take1Duration,
            selected_asset_id: take1Candidate.asset_id,
            selected_segment_index: take1Candidate.segment_index,
            source_in_ms: t1SourceIn,
            source_out_ms: t1SourceOut,
            source_duration_ms: take1Duration,
            confidence: take1Candidate.confidence,
            fallback_used: false,
            fallback_type: null,
            selection_reason: `Parte 1/2 de sequência visual (${take1Candidate.room_type})`
          },
          {
            timeline_start_ms: beat.start_ms + take1Duration,
            timeline_end_ms: beat.end_ms,
            timeline_duration_ms: take2Duration,
            selected_asset_id: take2Candidate.asset_id,
            selected_segment_index: take2Candidate.segment_index,
            source_in_ms: t2SourceIn,
            source_out_ms: t2SourceOut,
            source_duration_ms: take2Duration,
            confidence: take2Candidate.confidence,
            fallback_used: false,
            fallback_type: null,
            selection_reason: `Parte 2/2 de sequência visual (${take2Candidate.room_type})`
          }
        ];
      }
    }
  }

  // 5. Fallback determinístico (quando não há match semântico suficiente ou vídeo disponível)
  // Ordenar segmentos por qualidade geral (estética 60% + técnica 40%)
  const segmentsByQuality = (mediaCatalog?.segments || []).slice().sort((a, b) => {
    const qA = (a.aesthetic_score * 0.60) + (a.technical_quality_score * 0.40);
    const qB = (b.aesthetic_score * 0.60) + (b.technical_quality_score * 0.40);
    return qB - qA;
  });

  // 5.1 Tentativa A: Encontrar um único segmento genérico com footage disponível >= beatDuration
  const singleViableGeneralSegment = segmentsByQuality.find(s => {
    const consumed = consumedFootageMap[s.segment_index] !== undefined ? consumedFootageMap[s.segment_index] : s.start_ms;
    return (s.end_ms - consumed) >= beatDuration;
  });

  if (singleViableGeneralSegment) {
    const consumed = consumedFootageMap[singleViableGeneralSegment.segment_index] !== undefined
      ? consumedFootageMap[singleViableGeneralSegment.segment_index]
      : singleViableGeneralSegment.start_ms;
    const sourceIn = consumed;
    const sourceOut = sourceIn + beatDuration;
    consumedFootageMap[singleViableGeneralSegment.segment_index] = sourceOut;

    return [{
      timeline_start_ms: beat.start_ms,
      timeline_end_ms: beat.end_ms,
      timeline_duration_ms: beatDuration,
      selected_asset_id: mediaCatalog.asset_id,
      selected_segment_index: singleViableGeneralSegment.segment_index,
      source_in_ms: sourceIn,
      source_out_ms: sourceOut,
      source_duration_ms: beatDuration,
      confidence: 0.50,
      fallback_used: true,
      fallback_type: 'generic_property_media',
      selection_reason: `Fallback ativado: sem match semântico >= ${minRelevance}. Selecionado segmento de alta estética geral (#${singleViableGeneralSegment.segment_index} ${singleViableGeneralSegment.room_type})`
    }];
  }

  // 5.2 Tentativa B: Sequência de 2 takes genéricos se nenhum take único cobrir beatDuration
  const partiallyViableGeneral = segmentsByQuality.filter(s => {
    const consumed = consumedFootageMap[s.segment_index] !== undefined ? consumedFootageMap[s.segment_index] : s.start_ms;
    return (s.end_ms - consumed) >= minVisualDuration;
  });

  if (partiallyViableGeneral.length >= 2) {
    const gTake1 = partiallyViableGeneral[0];
    const gTake1Consumed = consumedFootageMap[gTake1.segment_index] !== undefined ? consumedFootageMap[gTake1.segment_index] : gTake1.start_ms;
    const gTake1Avail = gTake1.end_ms - gTake1Consumed;
    const gTake1Dur = Math.min(gTake1Avail, Math.round(beatDuration / 2));
    const gTake2Dur = beatDuration - gTake1Dur;

    if (gTake1Dur >= minVisualDuration && gTake2Dur >= minVisualDuration) {
      const gTake2 = partiallyViableGeneral.find(s => {
        if (s.segment_index === gTake1.segment_index) return false;
        const c = consumedFootageMap[s.segment_index] !== undefined ? consumedFootageMap[s.segment_index] : s.start_ms;
        return (s.end_ms - c) >= gTake2Dur;
      });

      if (gTake2) {
        const gTake2Consumed = consumedFootageMap[gTake2.segment_index] !== undefined ? consumedFootageMap[gTake2.segment_index] : gTake2.start_ms;
        const t1SourceIn = gTake1Consumed;
        const t1SourceOut = t1SourceIn + gTake1Dur;
        consumedFootageMap[gTake1.segment_index] = t1SourceOut;

        const t2SourceIn = gTake2Consumed;
        const t2SourceOut = t2SourceIn + gTake2Dur;
        consumedFootageMap[gTake2.segment_index] = t2SourceOut;

        return [
          {
            timeline_start_ms: beat.start_ms,
            timeline_end_ms: beat.start_ms + gTake1Dur,
            timeline_duration_ms: gTake1Dur,
            selected_asset_id: mediaCatalog.asset_id,
            selected_segment_index: gTake1.segment_index,
            source_in_ms: t1SourceIn,
            source_out_ms: t1SourceOut,
            source_duration_ms: gTake1Dur,
            confidence: 0.50,
            fallback_used: true,
            fallback_type: 'generic_property_media',
            selection_reason: `Fallback sequencial 1/2: alta estética geral (#${gTake1.segment_index} ${gTake1.room_type})`
          },
          {
            timeline_start_ms: beat.start_ms + gTake1Dur,
            timeline_end_ms: beat.end_ms,
            timeline_duration_ms: gTake2Dur,
            selected_asset_id: mediaCatalog.asset_id,
            selected_segment_index: gTake2.segment_index,
            source_in_ms: t2SourceIn,
            source_out_ms: t2SourceOut,
            source_duration_ms: gTake2Dur,
            confidence: 0.50,
            fallback_used: true,
            fallback_type: 'generic_property_media',
            selection_reason: `Fallback sequencial 2/2: alta estética geral (#${gTake2.segment_index} ${gTake2.room_type})`
          }
        ];
      }
    }
  }

  // 5.3 Tentativa C / Fallback final: Modo apresentador fullscreen
  return [{
    timeline_start_ms: beat.start_ms,
    timeline_end_ms: beat.end_ms,
    timeline_duration_ms: beatDuration,
    selected_asset_id: null,
    selected_segment_index: null,
    source_in_ms: beat.start_ms,
    source_out_ms: beat.end_ms,
    source_duration_ms: beatDuration,
    confidence: 1.0,
    fallback_used: true,
    fallback_type: 'presenter_fullscreen',
    selection_reason: 'Fallback ativado: nenhum segmento de vídeo viável com duração suficiente. Apresentador mantido em tela cheia.'
  }];
}

module.exports = {
  CONTINUITY_ENGINE_VERSION,
  FALLBACK_POLICY_VERSION,
  resolveVisualDecisionsForBeat
};
