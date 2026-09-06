const {
  DEFAULT_CONTINUITY_ENGINE_VERSION,
  DEFAULT_FALLBACK_POLICY_VERSION,
  DEFAULT_SEMANTIC_THRESHOLDS
} = require('./creative_direction_schema');

const CONTINUITY_ENGINE_VERSION = '1.1.0';
const FALLBACK_POLICY_VERSION = '1.1.0';

/**
 * Seleciona a melhor decisão visual para um beat ou gera uma sequência de 2 takes / fallback
 * Suporta candidatos multimodais (Vídeo e Fotos)
 */
function resolveVisualDecisionsForBeat({
  beat,
  rankedCandidates,
  mediaCatalog,
  consumedFootageMap = {},
  recentPhotosUsageMap = {},
  lastVisualDecision = null,
  semanticThresholds = DEFAULT_SEMANTIC_THRESHOLDS
}) {
  const beatDuration = beat.duration_ms;
  const minRelevance = semanticThresholds.min_semantic_relevance || 0.40;
  const minVisualDuration = semanticThresholds.min_visual_duration_ms || 1500;
  const maxPhotoVisualDuration = semanticThresholds.max_photo_visual_duration_ms || 6000;

  // 1. Filtrar candidatos viáveis com relevância >= minRelevance
  // Se a duração do beat for inferior a minVisualDuration, fotos não podem ser usadas diretamente como take curto isolado
  const viableCandidates = rankedCandidates.filter(c => {
    if (!c.is_feasible || c.semantic_relevance < minRelevance) return false;
    if (c.media_kind === 'photo' && beatDuration < (minVisualDuration - 5)) return false;
    return true;
  });

  // 2. Tentar Take Extension (exclusivo para Vídeo contínuo no mesmo segmento)
  if (lastVisualDecision && viableCandidates.length > 0) {
    const prevSegIdx = (lastVisualDecision.selected_segment_index !== null && lastVisualDecision.selected_segment_index !== undefined)
      ? lastVisualDecision.selected_segment_index
      : (lastVisualDecision.segment_index !== null && lastVisualDecision.segment_index !== undefined ? lastVisualDecision.segment_index : null);
    const isPrevVideo = (lastVisualDecision.media_kind === 'video_segment' || prevSegIdx !== null);
    if (isPrevVideo && prevSegIdx !== null) {
      const sameSegCandidate = viableCandidates.find(c => c.media_kind === 'video_segment' && c.segment_index === prevSegIdx);

      if (sameSegCandidate) {
        const compositeKey = `${sameSegCandidate.asset_id}:${prevSegIdx}`;
        let segStart = sameSegCandidate.available_start_ms;
        if (segStart === undefined || segStart === null) {
          segStart = consumedFootageMap[compositeKey] !== undefined
            ? consumedFootageMap[compositeKey]
            : (consumedFootageMap[prevSegIdx] !== undefined ? consumedFootageMap[prevSegIdx] : (sameSegCandidate.start_ms !== undefined ? sameSegCandidate.start_ms : 0));
        }
        let segEnd = sameSegCandidate.available_end_ms !== undefined && sameSegCandidate.available_end_ms !== null
          ? sameSegCandidate.available_end_ms
          : (sameSegCandidate.segment_end_ms !== undefined ? sameSegCandidate.segment_end_ms : (sameSegCandidate.end_ms !== undefined ? sameSegCandidate.end_ms : 1000000));

        if (segEnd - segStart >= beatDuration) {
          // Estender take continuamente
          const sourceIn = segStart;
          const sourceOut = sourceIn + beatDuration;
          consumedFootageMap[prevSegIdx] = sourceOut;
          consumedFootageMap[compositeKey] = sourceOut;

          return [{
            timeline_start_ms: beat.start_ms,
            timeline_end_ms: beat.end_ms,
            timeline_duration_ms: beatDuration,
            media_kind: 'video_segment',
            asset_type: 'video',
            selected_asset_id: sameSegCandidate.asset_id,
            physical_file_hash: sameSegCandidate.physical_file_hash,
            primary_room_type: sameSegCandidate.primary_room_type || sameSegCandidate.room_type,
            room_type: sameSegCandidate.primary_room_type || sameSegCandidate.room_type,
            selected_segment_index: prevSegIdx,
            source_in_ms: sourceIn,
            source_out_ms: sourceOut,
            source_duration_ms: beatDuration,
            confidence: sameSegCandidate.confidence,
            fallback_used: false,
            fallback_type: null,
            selection_reason: `Take extension contínuo do segmento #${prevSegIdx} (${sameSegCandidate.primary_room_type || sameSegCandidate.room_type})`
          }];
        }
      }
    }
  }

  // 3. Caso Normal: Seleção do Melhor Candidato Viável Único
  if (viableCandidates.length > 0) {
    const winner = viableCandidates[0];
    const isPhoto = (winner.media_kind === 'photo');

    if (isPhoto) {
      // 3.1 Vencedor é Foto
      if (beatDuration <= maxPhotoVisualDuration || viableCandidates.length === 1) {
        if (winner.physical_file_hash) {
          recentPhotosUsageMap[winner.physical_file_hash] = beat.beat_index;
        }

        const reason = (beatDuration > maxPhotoVisualDuration)
          ? `Vencedor por maior score semântico (${winner.primary_room_type}, foto estendida Ken Burns)`
          : `Vencedor por maior score semântico (${winner.primary_room_type}, score: ${winner.final_match_score})`;

        return [{
          timeline_start_ms: beat.start_ms,
          timeline_end_ms: beat.end_ms,
          timeline_duration_ms: beatDuration,
          media_kind: 'photo',
          asset_type: 'image',
          selected_asset_id: winner.asset_id,
          physical_file_hash: winner.physical_file_hash,
          primary_room_type: winner.primary_room_type || winner.room_type,
          room_type: winner.primary_room_type || winner.room_type,
          selected_segment_index: null,
          source_in_ms: null,
          source_out_ms: null,
          source_duration_ms: null,
          confidence: winner.confidence,
          fallback_used: false,
          fallback_type: null,
          selection_reason: reason
        }];
      } else {
        // Beat longo (> maxPhotoVisualDuration) e múltiplos candidatos: dividir em 2 takes complementares
        const secondCandidate = viableCandidates.find(c =>
          c.candidate_id !== winner.candidate_id &&
          (c.media_kind === 'photo' ? (c.physical_file_hash !== winner.physical_file_hash) : (c.available_duration_ms >= minVisualDuration))
        );

        if (secondCandidate) {
          const t1Dur = Math.round(beatDuration / 2);
          const t2Dur = beatDuration - t1Dur;

          if (winner.physical_file_hash) recentPhotosUsageMap[winner.physical_file_hash] = beat.beat_index;
          if (secondCandidate.physical_file_hash) recentPhotosUsageMap[secondCandidate.physical_file_hash] = beat.beat_index;

          const isTake2Photo = (secondCandidate.media_kind === 'photo');
          let t2SourceIn = null;
          let t2SourceOut = null;
          if (!isTake2Photo) {
            t2SourceIn = secondCandidate.available_start_ms;
            t2SourceOut = t2SourceIn + t2Dur;
            consumedFootageMap[secondCandidate.segment_index] = t2SourceOut;
          }

          return [
            {
              timeline_start_ms: beat.start_ms,
              timeline_end_ms: beat.start_ms + t1Dur,
              timeline_duration_ms: t1Dur,
              media_kind: 'photo',
              asset_type: 'image',
              selected_asset_id: winner.asset_id,
              physical_file_hash: winner.physical_file_hash,
              primary_room_type: winner.primary_room_type || winner.room_type,
              room_type: winner.primary_room_type || winner.room_type,
              selected_segment_index: null,
              source_in_ms: null,
              source_out_ms: null,
              source_duration_ms: null,
              confidence: winner.confidence,
              fallback_used: false,
              fallback_type: null,
              selection_reason: `Parte 1/2 de sequência visual (${winner.primary_room_type})`
            },
            {
              timeline_start_ms: beat.start_ms + t1Dur,
              timeline_end_ms: beat.end_ms,
              timeline_duration_ms: t2Dur,
              media_kind: isTake2Photo ? 'photo' : 'video_segment',
              asset_type: isTake2Photo ? 'image' : 'video',
              selected_asset_id: secondCandidate.asset_id,
              physical_file_hash: secondCandidate.physical_file_hash,
              primary_room_type: secondCandidate.primary_room_type || secondCandidate.room_type,
              room_type: secondCandidate.primary_room_type || secondCandidate.room_type,
              selected_segment_index: isTake2Photo ? null : secondCandidate.segment_index,
              source_in_ms: t2SourceIn,
              source_out_ms: t2SourceOut,
              source_duration_ms: isTake2Photo ? null : t2Dur,
              confidence: secondCandidate.confidence,
              fallback_used: false,
              fallback_type: null,
              selection_reason: `Parte 2/2 de sequência visual (${secondCandidate.primary_room_type || secondCandidate.room_type})`
            }
          ];
        }
      }
      const compositeKey = `${winner.asset_id}:${winner.segment_index}`;
      const consumedStart = consumedFootageMap[compositeKey] !== undefined
        ? consumedFootageMap[compositeKey]
        : (consumedFootageMap[winner.segment_index] !== undefined ? consumedFootageMap[winner.segment_index] : (winner.available_start_ms !== undefined ? winner.available_start_ms : (winner.start_ms || 0)));
      const sourceIn = consumedStart;
      const sourceOut = sourceIn + beatDuration;
      consumedFootageMap[winner.segment_index] = sourceOut;
      if (winner.asset_id) consumedFootageMap[compositeKey] = sourceOut;

      return [{
        timeline_start_ms: beat.start_ms,
        timeline_end_ms: beat.end_ms,
        timeline_duration_ms: beatDuration,
        media_kind: 'video_segment',
        asset_type: 'video',
        selected_asset_id: winner.asset_id,
        physical_file_hash: winner.physical_file_hash,
        primary_room_type: winner.primary_room_type || winner.room_type,
        room_type: winner.primary_room_type || winner.room_type,
        selected_segment_index: winner.segment_index,
        source_in_ms: sourceIn,
        source_out_ms: sourceOut,
        source_duration_ms: beatDuration,
        confidence: winner.confidence,
        fallback_used: false,
        fallback_type: null,
        selection_reason: `Vencedor por maior score semântico (${winner.primary_room_type || winner.room_type}, score: ${winner.final_match_score})`
      }];
    }
  }

  // 4. Se nenhum take único cobre a duração total, tentar sequência de 2 takes compatíveis
  const partiallyFeasible = rankedCandidates.filter(c =>
    c.semantic_relevance >= minRelevance &&
    (c.media_kind === 'photo' || c.available_duration_ms >= minVisualDuration)
  );

  if (partiallyFeasible.length >= 2) {
    const take1Candidate = partiallyFeasible[0];
    const isTake1Photo = (take1Candidate.media_kind === 'photo');
    const take1Available = isTake1Photo ? Infinity : take1Candidate.available_duration_ms;
    const take1Duration = Math.min(take1Available, Math.round(beatDuration / 2));
    const take2Duration = beatDuration - take1Duration;

    if (take1Duration >= minVisualDuration && take2Duration >= minVisualDuration) {
      const take2Candidate = partiallyFeasible.find(c =>
        c.candidate_id !== take1Candidate.candidate_id &&
        (c.media_kind === 'photo' ? true : (c.available_duration_ms >= take2Duration))
      );

      if (take2Candidate) {
        const isTake2Photo = (take2Candidate.media_kind === 'photo');
        let t1SourceIn = null;
        let t1SourceOut = null;
        if (!isTake1Photo) {
          t1SourceIn = take1Candidate.available_start_ms;
          t1SourceOut = t1SourceIn + take1Duration;
          consumedFootageMap[take1Candidate.segment_index] = t1SourceOut;
        }

        let t2SourceIn = null;
        let t2SourceOut = null;
        if (!isTake2Photo) {
          t2SourceIn = take2Candidate.available_start_ms;
          t2SourceOut = t2SourceIn + take2Duration;
          consumedFootageMap[take2Candidate.segment_index] = t2SourceOut;
        }

        return [
          {
            timeline_start_ms: beat.start_ms,
            timeline_end_ms: beat.start_ms + take1Duration,
            timeline_duration_ms: take1Duration,
            media_kind: isTake1Photo ? 'photo' : 'video_segment',
            asset_type: isTake1Photo ? 'image' : 'video',
            selected_asset_id: take1Candidate.asset_id,
            physical_file_hash: take1Candidate.physical_file_hash,
            primary_room_type: take1Candidate.primary_room_type || take1Candidate.room_type,
            room_type: take1Candidate.primary_room_type || take1Candidate.room_type,
            selected_segment_index: isTake1Photo ? null : take1Candidate.segment_index,
            source_in_ms: t1SourceIn,
            source_out_ms: t1SourceOut,
            source_duration_ms: isTake1Photo ? null : take1Duration,
            confidence: take1Candidate.confidence,
            fallback_used: false,
            fallback_type: null,
            selection_reason: `Parte 1/2 de sequência visual (${take1Candidate.primary_room_type || take1Candidate.room_type})`
          },
          {
            timeline_start_ms: beat.start_ms + take1Duration,
            timeline_end_ms: beat.end_ms,
            timeline_duration_ms: take2Duration,
            media_kind: isTake2Photo ? 'photo' : 'video_segment',
            asset_type: isTake2Photo ? 'image' : 'video',
            selected_asset_id: take2Candidate.asset_id,
            physical_file_hash: take2Candidate.physical_file_hash,
            primary_room_type: take2Candidate.primary_room_type || take2Candidate.room_type,
            room_type: take2Candidate.primary_room_type || take2Candidate.room_type,
            selected_segment_index: isTake2Photo ? null : take2Candidate.segment_index,
            source_in_ms: t2SourceIn,
            source_out_ms: t2SourceOut,
            source_duration_ms: isTake2Photo ? null : take2Duration,
            confidence: take2Candidate.confidence,
            fallback_used: false,
            fallback_type: null,
            selection_reason: `Parte 2/2 de sequência visual (${take2Candidate.primary_room_type || take2Candidate.room_type})`
          }
        ];
      }
    }
  }

  // 5. Fallback Determinístico Multimodal (Nível 2: generic_property_media / Nível 3: presenter_fullscreen)
  // Montar lista de todas as mídias disponíveis ordenadas por qualidade estética geral
  const allGeneralMedia = [];

  // 5.1 Adicionar Fotos Gerais
  const photoList = mediaCatalog.photo_assets || mediaCatalog.photos || [];
  for (let idx = 0; idx < photoList.length; idx++) {
    const p = photoList[idx];
    const qual = p.quality || {};
    const tech = Number(qual.technical_quality?.score !== undefined ? qual.technical_quality.score : (p.technical_quality_score || 0.8));
    const aest = Number(qual.aesthetic_score?.score !== undefined ? qual.aesthetic_score.score : (p.aesthetic_score || 0.8));
    const edit = Number(qual.editorial_utility?.score !== undefined ? qual.editorial_utility.score : (p.editorial_utility_score || 0.8));
    const generalScore = (aest * 0.40) + (edit * 0.40) + (tech * 0.20);
    const primaryRoom = p.semantic?.primary_room_type || p.primary_room_type || p.room_type || 'property_photo';

    allGeneralMedia.push({
      media_kind: 'photo',
      asset_type: 'image',
      asset_id: p.asset_id || `ast_pimg_${mediaCatalog.property_ref || 'unknown'}_${idx + 1}`,
      physical_file_hash: p.physical_file_hash || p.file_hash || '',
      room_type: primaryRoom,
      general_score: generalScore,
      available_duration_ms: Infinity
    });
  }

  // 5.2 Adicionar Segmentos de Vídeo Gerais
  const videoList = mediaCatalog.video_assets || (mediaCatalog.segments ? [mediaCatalog] : []);
  for (const v of videoList) {
    const assetId = v.asset_id || `ast_pvid_${mediaCatalog.property_ref || 'unknown'}_video`;
    for (const s of (v.segments || [])) {
      const consumed = consumedFootageMap[s.segment_index] !== undefined ? consumedFootageMap[s.segment_index] : s.start_ms;
      const avail = Math.max(0, s.end_ms - consumed);
      const tech = Number(s.technical_quality_score || 0.5);
      const aest = Number(s.aesthetic_score || 0.5);
      const generalScore = (aest * 0.60) + (tech * 0.40);

      allGeneralMedia.push({
        media_kind: 'video_segment',
        asset_type: 'video',
        asset_id: assetId,
        physical_file_hash: v.physical_file_hash || v.file_hash || '',
        segment_index: s.segment_index,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        consumed_start_ms: consumed,
        room_type: s.room_type,
        general_score: generalScore,
        available_duration_ms: avail
      });
    }
  }

  // Ordenar mídias gerais por general_score DESC
  allGeneralMedia.sort((a, b) => b.general_score - a.general_score);

  // 5.3 Tentativa A: Encontrar um único asset genérico viável (Foto ou Vídeo)
  const singleViableGeneral = allGeneralMedia.find(m => {
    if (m.media_kind === 'photo') return beatDuration >= (minVisualDuration - 5);
    return m.available_duration_ms >= beatDuration;
  });

  if (singleViableGeneral) {
    if (singleViableGeneral.media_kind === 'photo') {
      return [{
        timeline_start_ms: beat.start_ms,
        timeline_end_ms: beat.end_ms,
        timeline_duration_ms: beatDuration,
        media_kind: 'photo',
        asset_type: 'image',
        selected_asset_id: singleViableGeneral.asset_id,
        physical_file_hash: singleViableGeneral.physical_file_hash,
        primary_room_type: singleViableGeneral.room_type,
        room_type: singleViableGeneral.room_type,
        selected_segment_index: null,
        source_in_ms: null,
        source_out_ms: null,
        source_duration_ms: null,
        confidence: 0.50,
        fallback_used: true,
        fallback_type: 'generic_property_media',
        selection_reason: `Fallback ativado: sem match semântico >= ${minRelevance}. Selecionada foto de alta estética geral (${singleViableGeneral.room_type})`
      }];
    } else {
      const sourceIn = singleViableGeneral.consumed_start_ms;
      const sourceOut = sourceIn + beatDuration;
      consumedFootageMap[singleViableGeneral.segment_index] = sourceOut;

      return [{
        timeline_start_ms: beat.start_ms,
        timeline_end_ms: beat.end_ms,
        timeline_duration_ms: beatDuration,
        media_kind: 'video_segment',
        asset_type: 'video',
        selected_asset_id: singleViableGeneral.asset_id,
        physical_file_hash: singleViableGeneral.physical_file_hash,
        primary_room_type: singleViableGeneral.room_type,
        room_type: singleViableGeneral.room_type,
        selected_segment_index: singleViableGeneral.segment_index,
        source_in_ms: sourceIn,
        source_out_ms: sourceOut,
        source_duration_ms: beatDuration,
        confidence: 0.50,
        fallback_used: true,
        fallback_type: 'generic_property_media',
        selection_reason: `Fallback ativado: sem match semântico >= ${minRelevance}. Selecionado segmento de alta estética geral (#${singleViableGeneral.segment_index} ${singleViableGeneral.room_type})`
      }];
    }
  }

  // 5.4 Fallback Final (Nível 3): Modo apresentador fullscreen
  return [{
    timeline_start_ms: beat.start_ms,
    timeline_end_ms: beat.end_ms,
    timeline_duration_ms: beatDuration,
    media_kind: 'presenter_fullscreen',
    asset_type: 'video',
    selected_asset_id: null,
    physical_file_hash: null,
    selected_segment_index: null,
    source_in_ms: beat.start_ms,
    source_out_ms: beat.end_ms,
    source_duration_ms: beatDuration,
    confidence: 1.0,
    fallback_used: true,
    fallback_type: 'presenter_fullscreen',
    selection_reason: 'Fallback ativado: nenhuma mídia física de imóvel viável com duração suficiente. Apresentador mantido em tela cheia.'
  }];
}

module.exports = {
  CONTINUITY_ENGINE_VERSION,
  FALLBACK_POLICY_VERSION,
  resolveVisualDecisionsForBeat
};
