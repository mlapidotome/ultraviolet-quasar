/**
 * Módulo Editorial Plan Compiler — Video Engine V2
 * Bali Imóveis (Fase 6 — Passo 6A)
 * 
 * Responsabilidade:
 * Compila unidades do Editorial Plan v0.1 em Creative Blueprint 1.2 executável pelo Composer V3,
 * reutilizando o motor de ranking semântico da Fase 4C (media_ranker.js) sem duplicar lógica de seleção.
 */

const crypto = require('crypto');
const { evaluateAndRankCandidates } = require('./creative_director/media_ranker');
const { extractSemanticIntent } = require('./creative_director/intent_extractor');
const { DEFAULT_SCORING_WEIGHTS, DEFAULT_SEMANTIC_THRESHOLDS } = require('./creative_director/creative_direction_schema');

class EditorialPlanCompiler {
  constructor(options = {}) {
    this.compilerVersion = '1.0.0';
    this.scoringWeights = options.scoringWeights || DEFAULT_SCORING_WEIGHTS;
    this.semanticThresholds = options.semanticThresholds || DEFAULT_SEMANTIC_THRESHOLDS;
  }

  /**
   * Converte string de time range "00:00.000 - 00:06.440" em start_ms, end_ms, duration_ms
   */
  static parseTimeRange(timeRangeStr) {
    if (!timeRangeStr || typeof timeRangeStr !== 'string') {
      throw new Error(`[COMPILER_ERROR] time_range_source inválido: '${timeRangeStr}'`);
    }

    const parts = timeRangeStr.split('-').map(s => s.trim());
    if (parts.length !== 2) {
      throw new Error(`[COMPILER_ERROR] Formato de time_range_source esperado 'MM:SS.mmm - MM:SS.mmm', recebido: '${timeRangeStr}'`);
    }

    const parseTs = (ts) => {
      const [mStr, sStr] = ts.split(':');
      const minutes = parseInt(mStr, 10) || 0;
      const seconds = parseFloat(sStr) || 0;
      return Math.round((minutes * 60 + seconds) * 1000);
    };

    const startMs = parseTs(parts[0]);
    const endMs = parseTs(parts[1]);
    const durationMs = Math.max(0, endMs - startMs);

    return { start_ms: startMs, end_ms: endMs, duration_ms: durationMs };
  }

  /**
   * Divide texto longo de fala em segmentos de legenda que respeitam os limites de linha e caracteres
   */
  static chunkCaption(text, startMs, endMs, maxCharsPerChunk = 45) {
    if (!text || typeof text !== 'string') return [];
    const words = text.trim().split(/\s+/);
    if (words.length === 0 || words[0] === '') return [];

    const chunks = [];
    let currentChunkWords = [];
    let currentLen = 0;

    for (const w of words) {
      const addedLen = currentChunkWords.length === 0 ? w.length : currentLen + 1 + w.length;
      if (addedLen <= maxCharsPerChunk) {
        currentChunkWords.push(w);
        currentLen = addedLen;
      } else {
        if (currentChunkWords.length > 0) {
          chunks.push(currentChunkWords.join(' '));
        }
        currentChunkWords = [w];
        currentLen = w.length;
      }
    }
    if (currentChunkWords.length > 0) {
      chunks.push(currentChunkWords.join(' '));
    }

    if (chunks.length === 0) return [];
    if (chunks.length === 1) {
      return [{ start_ms: startMs, end_ms: endMs, text: chunks[0] }];
    }

    const totalDuration = endMs - startMs;
    const chunkDuration = Math.floor(totalDuration / chunks.length);
    const result = [];

    for (let i = 0; i < chunks.length; i++) {
      const cStart = startMs + (i * chunkDuration);
      const cEnd = (i === chunks.length - 1) ? endMs : cStart + chunkDuration;
      result.push({
        start_ms: cStart,
        end_ms: cEnd,
        text: chunks[i]
      });
    }

    return result;
  }

  /**
   * Mapeia subjects e intenção do plano em room_types e features para a Fase 4C
   */
  static mapSubjectsToSemanticIntent(unit) {
    const subjects = unit.subjects || (unit.interpretation && unit.interpretation.subjects) || [];
    const scriptText = unit.script_excerpt || unit.spoken_text || '';

    const requestedRooms = [];
    const requestedFeatures = [];

    // Mapeamento semântico direto
    for (const s of subjects) {
      const sLower = String(s).toLowerCase();
      if (sLower.includes('living') || sLower.includes('sala') || sLower.includes('interior')) {
        if (!requestedRooms.includes('living_room')) requestedRooms.push('living_room');
      }
      if (sLower.includes('balcony') || sLower.includes('varanda') || sLower.includes('barbecue') || sLower.includes('churrasqueira')) {
        if (!requestedRooms.includes('balcony')) requestedRooms.push('balcony');
        if (!requestedFeatures.includes('barbecue')) requestedFeatures.push('barbecue');
      }
      if (sLower.includes('kitchen') || sLower.includes('cozinha')) {
        if (!requestedRooms.includes('kitchen')) requestedRooms.push('kitchen');
      }
      if (sLower.includes('suite') || sLower.includes('bedroom') || sLower.includes('dormitório') || sLower.includes('rooms')) {
        if (!requestedRooms.includes('suite')) requestedRooms.push('suite');
      }
      if (sLower.includes('amenit') || sLower.includes('condominium') || sLower.includes('condo') || sLower.includes('lazer')) {
        if (!requestedRooms.includes('condo_amenities')) requestedRooms.push('condo_amenities');
        if (!requestedRooms.includes('facade')) requestedRooms.push('facade');
      }
      if (sLower.includes('location') || sLower.includes('shopping') || sLower.includes('highway') || sLower.includes('dutra')) {
        if (!requestedRooms.includes('neighborhood')) requestedRooms.push('neighborhood');
        if (!requestedRooms.includes('aerial_view')) requestedRooms.push('aerial_view');
      }
    }

    // Fallback para intent_extractor se não houver rooms explícitos
    if (requestedRooms.length === 0 && scriptText) {
      const extracted = extractSemanticIntent(scriptText);
      if (extracted.requested_room_types) {
        requestedRooms.push(...extracted.requested_room_types);
      }
      if (extracted.requested_features) {
        requestedFeatures.push(...extracted.requested_features);
      }
    }

    return {
      requested_room_types: requestedRooms,
      requested_features: requestedFeatures,
      raw_text: scriptText
    };
  }

  /**
   * Compila um Editorial Plan em Creative Blueprint 1.2 rigorosamente compatível com o Composer V3
   */
  compile({
    editorialPlan,
    mediaCatalog = null,
    presenterAssetId,
    creativeId = `crv_case01_editorial_${Date.now()}`,
    editingStyleId = 'luxury_minimal',
    options = {}
  } = {}) {
    if (!editorialPlan || typeof editorialPlan !== 'object') {
      throw new Error('[COMPILER_ERROR] editorialPlan inválido ou nulo');
    }
    if (!presenterAssetId) {
      throw new Error('[COMPILER_ERROR] presenterAssetId é obrigatório para compilar o Blueprint');
    }

    const planUnits = editorialPlan.plan_units || editorialPlan.beats || [];
    if (!Array.isArray(planUnits) || planUnits.length === 0) {
      throw new Error('[COMPILER_ERROR] editorialPlan não contém plan_units válidas');
    }

    const visualTimeline = [];
    const overlays = [];
    const captions = [];
    const resolutionTrace = [];
    const gracefulDegradations = [];
    const unresolvedRequirements = [];

    const consumedFootageMap = {};
    const recentPhotosUsageMap = {};
    let currentTimelineMs = 0;

    // Catálogo canônico normalizado
    const cleanCatalog = mediaCatalog || {
      property_ref: editorialPlan.case_id || 'CASE_01',
      video_assets: [],
      photo_assets: []
    };

    for (let idx = 0; idx < planUnits.length; idx++) {
      const unit = planUnits[idx];
      const timing = unit.time_range_source ? 
        EditorialPlanCompiler.parseTimeRange(unit.time_range_source) : 
        { start_ms: unit.start_ms || 0, end_ms: unit.end_ms || 0, duration_ms: unit.duration_ms || (unit.end_ms - unit.start_ms) };

      const beatId = unit.beat_id || `BEAT_${idx + 1}`;
      const stateDecision = unit.state_decision || 'HOLD';
      const sourceStrategy = unit.source_strategy || (stateDecision === 'HOLD' ? 'CURRENT_STATE' : 'PRESENTER');
      const graphicIntent = unit.graphic_intent || 'NONE';

      let resolvedVisualItem = null;
      let traceAction = 'UNKNOWN';
      let selectedAssetId = null;

      // 1. Resolução Visual (HOLD / EVOLVE / SWITCH)
      if (stateDecision === 'HOLD') {
        if (sourceStrategy === 'CURRENT_STATE' && visualTimeline.length > 0) {
          // Sustenta o item visual anterior estendendo seu end_ms
          const prevItem = visualTimeline[visualTimeline.length - 1];
          const extensionMs = timing.end_ms - prevItem.end_ms;
          
          prevItem.end_ms = timing.end_ms;
          if (prevItem.asset_type === 'video' && prevItem.source_out_ms !== null) {
            prevItem.source_out_ms += extensionMs;
          }

          traceAction = 'HOLD_SUSTAIN_PREVIOUS_VISUAL';
          selectedAssetId = prevItem.asset_id;
        } else {
          // Hold inicial ou em apresentador
          resolvedVisualItem = {
            asset_id: presenterAssetId,
            asset_type: 'video',
            start_ms: timing.start_ms,
            end_ms: timing.end_ms,
            source_in_ms: timing.start_ms,
            source_out_ms: timing.end_ms,
            fit: 'cover',
            transition_in: { type: 'cut' }
          };
          visualTimeline.push(resolvedVisualItem);
          traceAction = 'HOLD_PRESENTER_FULLSCREEN';
          selectedAssetId = presenterAssetId;
        }
      } else if (stateDecision === 'EVOLVE') {
        // Evolve: Preserva fonte visual base (apresentador)
        resolvedVisualItem = {
          asset_id: presenterAssetId,
          asset_type: 'video',
          start_ms: timing.start_ms,
          end_ms: timing.end_ms,
          source_in_ms: timing.start_ms,
          source_out_ms: timing.end_ms,
          fit: 'cover',
          transition_in: { type: 'cut' }
        };
        visualTimeline.push(resolvedVisualItem);
        traceAction = 'EVOLVE_PRESENTER_BASE';
        selectedAssetId = presenterAssetId;
      } else if (stateDecision === 'SWITCH') {
        if (sourceStrategy === 'PRESENTER') {
          resolvedVisualItem = {
            asset_id: presenterAssetId,
            asset_type: 'video',
            start_ms: timing.start_ms,
            end_ms: timing.end_ms,
            source_in_ms: timing.start_ms,
            source_out_ms: timing.end_ms,
            fit: 'cover',
            transition_in: { type: 'cut' }
          };
          visualTimeline.push(resolvedVisualItem);
          traceAction = 'SWITCH_TO_PRESENTER';
          selectedAssetId = presenterAssetId;
        } else if (sourceStrategy === 'LOCATION') {
          // Beat de Localização: verificar evidência externa
          if (unit.location_evidence_intent === 'VERIFIED_EVIDENCE_REQUIRED') {
            unresolvedRequirements.push({
              beat_id: beatId,
              type: 'EXTERNAL_LOCATION_EVIDENCE',
              detail: 'Geographic proximity proof to Taubaté Shopping, Shibata, Dutra requires external verified asset.'
            });
          }

          // Resolver mídia disponível via 4C ou fallback
          const semanticIntent = EditorialPlanCompiler.mapSubjectsToSemanticIntent(unit);
          const candidates = evaluateAndRankCandidates({
            semanticIntent,
            requiredDurationMs: timing.duration_ms,
            mediaCatalog: cleanCatalog,
            consumedFootageMap,
            recentPhotosUsageMap,
            currentBeatIndex: idx,
            scoringWeights: this.scoringWeights,
            semanticThresholds: this.semanticThresholds
          });

          const validCandidate = candidates && candidates.length > 0 && candidates[0].is_feasible && (candidates[0].final_match_score > 0 || candidates[0].final_score > 0);

          if (validCandidate) {
            const best = candidates[0];
            const isPhoto = (best.media_kind === 'photo' || best.asset_type === 'image' || best.media_kind === 'property_photo');
            if (isPhoto) {
              resolvedVisualItem = {
                asset_id: best.asset_id,
                asset_type: 'image',
                start_ms: timing.start_ms,
                end_ms: timing.end_ms,
                motion: 'ken_burns',
                fit: 'cover',
                transition_in: { type: 'cut' }
              };
              recentPhotosUsageMap[best.asset_id] = (recentPhotosUsageMap[best.asset_id] || 0) + 1;
            } else {
              const segIn = best.available_start_ms !== undefined ? best.available_start_ms : (best.selected_segment ? best.selected_segment.start_ms : 0);
              resolvedVisualItem = {
                asset_id: best.asset_id,
                asset_type: 'video',
                start_ms: timing.start_ms,
                end_ms: timing.end_ms,
                source_in_ms: segIn,
                source_out_ms: segIn + timing.duration_ms,
                fit: 'cover',
                transition_in: { type: 'cut' }
              };
              const compKey = `${best.asset_id}:${best.segment_index}`;
              consumedFootageMap[compKey] = segIn + timing.duration_ms;
            }
            visualTimeline.push(resolvedVisualItem);
            traceAction = 'SWITCH_TO_LOCATION_BROLL_4C';
            selectedAssetId = best.asset_id;
          } else {
            // Graceful fallback para apresentador se não houver B-roll no pool
            resolvedVisualItem = {
              asset_id: presenterAssetId,
              asset_type: 'video',
              start_ms: timing.start_ms,
              end_ms: timing.end_ms,
              source_in_ms: timing.start_ms,
              source_out_ms: timing.end_ms,
              fit: 'cover',
              transition_in: { type: 'cut' }
            };
            visualTimeline.push(resolvedVisualItem);
            gracefulDegradations.push({
              beat_id: beatId,
              reason: 'No location B-roll candidate in media catalog; degraded to presenter on camera.'
            });
            traceAction = 'FALLBACK_PRESENTER_LOCATION_MISSING';
            selectedAssetId = presenterAssetId;
          }
        } else {
          // PROPERTY ou LIFESTYLE B-Roll
          const semanticIntent = EditorialPlanCompiler.mapSubjectsToSemanticIntent(unit);
          const candidates = evaluateAndRankCandidates({
            semanticIntent,
            requiredDurationMs: timing.duration_ms,
            mediaCatalog: cleanCatalog,
            consumedFootageMap,
            recentPhotosUsageMap,
            currentBeatIndex: idx,
            scoringWeights: this.scoringWeights,
            semanticThresholds: this.semanticThresholds
          });

          const validCandidate = candidates && candidates.length > 0 && candidates[0].is_feasible && (candidates[0].final_match_score > 0 || candidates[0].final_score > 0);

          if (validCandidate) {
            const best = candidates[0];
            const isPhoto = (best.media_kind === 'photo' || best.asset_type === 'image' || best.media_kind === 'property_photo');
            if (isPhoto) {
              resolvedVisualItem = {
                asset_id: best.asset_id,
                asset_type: 'image',
                start_ms: timing.start_ms,
                end_ms: timing.end_ms,
                motion: 'ken_burns',
                fit: 'cover',
                transition_in: { type: 'cut' }
              };
              recentPhotosUsageMap[best.asset_id] = (recentPhotosUsageMap[best.asset_id] || 0) + 1;
            } else {
              const segIn = best.available_start_ms !== undefined ? best.available_start_ms : (best.selected_segment ? best.selected_segment.start_ms : 0);
              resolvedVisualItem = {
                asset_id: best.asset_id,
                asset_type: 'video',
                start_ms: timing.start_ms,
                end_ms: timing.end_ms,
                source_in_ms: segIn,
                source_out_ms: segIn + timing.duration_ms,
                fit: 'cover',
                transition_in: { type: 'cut' }
              };
              const compKey = `${best.asset_id}:${best.segment_index}`;
              consumedFootageMap[compKey] = segIn + timing.duration_ms;
            }
            visualTimeline.push(resolvedVisualItem);
            traceAction = `SWITCH_TO_PROPERTY_4C (${isPhoto ? 'PHOTO_KEN_BURNS' : 'VIDEO_TRIM'})`;
            selectedAssetId = best.asset_id;
          } else {
            // Fallback para apresentador
            resolvedVisualItem = {
              asset_id: presenterAssetId,
              asset_type: 'video',
              start_ms: timing.start_ms,
              end_ms: timing.end_ms,
              source_in_ms: timing.start_ms,
              source_out_ms: timing.end_ms,
              fit: 'cover',
              transition_in: { type: 'cut' }
            };
            visualTimeline.push(resolvedVisualItem);
            gracefulDegradations.push({
              beat_id: beatId,
              reason: `No matching property media for ${semanticIntent.requested_room_types.join('/')}; degraded to presenter on camera.`
            });
            traceAction = 'FALLBACK_PRESENTER_PROPERTY_MISSING';
            selectedAssetId = presenterAssetId;
          }
        }
      }

      // 2. Resolução de Overlays & Degradação
      if (graphicIntent === 'LOCATION_SUPPORT') {
        const textTag = unit.typography_intent?.semantic_target || 'Taubaté / Próx. Shopping e Shibata';
        overlays.push({
          id: `ov_loc_${beatId.toLowerCase()}`,
          layer_order: (overlays.length + 1) * 10,
          type: 'location_tag',
          position: 'lower_third',
          preset: 'location_badge',
          text: textTag,
          start_ms: timing.start_ms,
          end_ms: timing.end_ms
        });
      } else if (graphicIntent === 'HERO_INFORMATION') {
        // Beat 08 Card Financeiro: Graceful Degradation para price_badge limpo de 1 linha
        const financialBadgeText = 'R$ 350 MIL | MCMV';
        overlays.push({
          id: `ov_fin_${beatId.toLowerCase()}`,
          layer_order: (overlays.length + 1) * 10,
          type: 'price_badge',
          position: 'lower_third',
          preset: 'price_punch',
          text: financialBadgeText,
          start_ms: timing.start_ms,
          end_ms: timing.end_ms
        });

        gracefulDegradations.push({
          beat_id: beatId,
          type: 'DESIGN_SYSTEM_DEGRADATION',
          detail: 'Complex multi-field financial card degraded to structured single-box price_badge.'
        });
      } else if (graphicIntent === 'CTA_SUPPORT') {
        overlays.push({
          id: `ov_cta_${beatId.toLowerCase()}`,
          layer_order: (overlays.length + 1) * 10,
          type: 'cta_banner',
          position: 'bottom_safe',
          preset: 'cta_bar',
          text: 'Saiba Mais | Agende sua Visita',
          start_ms: timing.start_ms,
          end_ms: timing.end_ms
        });
      }

      // 3. Captions de Fala
      const excerpt = unit.script_excerpt || unit.spoken_text || '';
      if (excerpt) {
        const chunked = EditorialPlanCompiler.chunkCaption(excerpt, timing.start_ms, timing.end_ms);
        captions.push(...chunked);
      }

      resolutionTrace.push({
        beat_id: beatId,
        time_range: unit.time_range_source || `${timing.start_ms}-${timing.end_ms}ms`,
        state_decision: stateDecision,
        source_strategy: sourceStrategy,
        graphic_intent: graphicIntent,
        action: traceAction,
        selected_asset_id: selectedAssetId
      });

      currentTimelineMs = timing.end_ms;
    }

    // 4. Validação de Continuidade e Ausência de Gaps
    this.validateContinuousCoverage(visualTimeline, currentTimelineMs);

    // 5. Construção do Creative Blueprint 1.2
    const blueprint12 = {
      schema_version: '1.2',
      creative_id: creativeId,
      blueprint_version: 1,
      format: {
        aspect_ratio: '9:16',
        width: 1080,
        height: 1920,
        fps: 30
      },
      editing_style: {
        style_id: editingStyleId,
        version: 1
      },
      total_duration_ms: currentTimelineMs,
      audio_track: {
        primary_asset_id: presenterAssetId,
        broll_audio_policy: 'mute_all_broll'
      },
      visual_timeline: visualTimeline,
      pip: {
        enabled: false,
        windows: []
      },
      overlays: overlays,
      captions: captions,
      resolution_metadata: {
        compiler_version: this.compilerVersion,
        compiled_at: new Date().toISOString(),
        case_id: editorialPlan.case_id || 'CASE_01',
        total_beats: planUnits.length,
        resolution_trace: resolutionTrace,
        graceful_degradations: gracefulDegradations,
        unresolved_requirements: unresolvedRequirements
      }
    };

    return blueprint12;
  }

  /**
   * Garante que a visual_timeline cobre 0 a total_duration_ms sem gaps
   */
  validateContinuousCoverage(visualTimeline, totalDurationMs) {
    if (visualTimeline.length === 0) {
      throw new Error('[COMPILER_VALIDATION_ERROR] visual_timeline vazia');
    }

    if (visualTimeline[0].start_ms !== 0) {
      visualTimeline[0].start_ms = 0;
    }

    for (let i = 0; i < visualTimeline.length; i++) {
      const seg = visualTimeline[i];
      if (seg.start_ms >= seg.end_ms) {
        throw new Error(`[COMPILER_VALIDATION_ERROR] Segmento visual #${i} com duração inválida (${seg.start_ms}-${seg.end_ms}ms)`);
      }

      if (i > 0) {
        const prev = visualTimeline[i - 1];
        if (seg.start_ms !== prev.end_ms) {
          throw new Error(`[COMPILER_VALIDATION_ERROR] Gap detectado entre segmento #${i - 1} (end: ${prev.end_ms}ms) e #${i} (start: ${seg.start_ms}ms)`);
        }
      }
    }

    const lastSeg = visualTimeline[visualTimeline.length - 1];
    if (lastSeg.end_ms !== totalDurationMs) {
      throw new Error(`[COMPILER_VALIDATION_ERROR] Timeline final (${lastSeg.end_ms}ms) difere do total esperado (${totalDurationMs}ms)`);
    }
  }
}

module.exports = {
  EditorialPlanCompiler
};
