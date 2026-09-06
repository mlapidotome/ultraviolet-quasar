/**
 * Serviço Principal do Creative Director — Video Engine V2
 * Bali Imóveis (Fase 4C — Multimodal Semantic Matching)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const composerService = require('../composer_service');
const propertyMediaService = require('../property_media/property_media_service');
const {
  SCHEMA_VERSION,
  DEFAULT_DIRECTOR_VERSION,
  DEFAULT_INTENT_EXTRACTOR_VERSION,
  DEFAULT_MEDIA_RANKER_VERSION,
  DEFAULT_CONTINUITY_ENGINE_VERSION,
  DEFAULT_FALLBACK_POLICY_VERSION,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SEMANTIC_THRESHOLDS,
  validateBeatDecision,
  computePropertySemanticMediaPoolKey,
  computeCreativeDirectionKey
} = require('./creative_direction_schema');
const { extractSemanticIntent } = require('./intent_extractor');
const { evaluateAndRankCandidates } = require('./media_ranker');
const { resolveVisualDecisionsForBeat } = require('./editorial_continuity_engine');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

class CreativeDirectorService {
  constructor() {
    this.directorVersion = DEFAULT_DIRECTOR_VERSION;
    this.intentExtractorVersion = DEFAULT_INTENT_EXTRACTOR_VERSION;
    this.mediaRankerVersion = DEFAULT_MEDIA_RANKER_VERSION;
    this.continuityEngineVersion = DEFAULT_CONTINUITY_ENGINE_VERSION;
    this.fallbackPolicyVersion = DEFAULT_FALLBACK_POLICY_VERSION;
  }

  /**
   * Constrói o plano editorial auditável de Creative Direction a partir dos Beats e Catálogo Multimodal
   */
  async createDirectionPlan({
    jobId,
    propertyRef,
    scriptTimingResult,
    mediaUnderstandingResult = null,
    propertySemanticCatalog = null,
    photoAssets = null,
    options = {}
  } = {}) {
    if (!jobId) throw new Error('[CREATIVE_DIRECTOR_ERROR] jobId é obrigatório');
    if (!propertyRef) throw new Error('[CREATIVE_DIRECTOR_ERROR] propertyRef é obrigatório');
    if (!scriptTimingResult || !Array.isArray(scriptTimingResult.beats)) {
      throw new Error('[CREATIVE_DIRECTOR_ERROR] scriptTimingResult com array de beats é obrigatório');
    }

    const cleanJobId = String(jobId).trim();
    const cleanRef = String(propertyRef).trim();
    const scoringWeights = options.scoringWeights || DEFAULT_SCORING_WEIGHTS;
    const semanticThresholds = options.semanticThresholds || DEFAULT_SEMANTIC_THRESHOLDS;
    const minVisualDurationMs = options.minVisualDurationMs || semanticThresholds.min_visual_duration_ms || 1500;
    const maxPhotoVisualDurationMs = options.maxPhotoVisualDurationMs || semanticThresholds.max_photo_visual_duration_ms || 6000;

    const scriptTimingKey = scriptTimingResult.script_timing_key || scriptTimingResult.alignment_key;
    const beatAnalysisKey = scriptTimingResult.beat_analysis_key;

    // 1. Montagem do Catálogo Canônico Multimodal (Vídeo + Fotos)
    let mediaCatalog = propertySemanticCatalog || options.mediaCatalog || null;

    if (!mediaCatalog) {
      const videoAssets = [];
      if (mediaUnderstandingResult && Array.isArray(mediaUnderstandingResult.segments)) {
        const videoAssetId = mediaUnderstandingResult.asset_id || `ast_pvid_${cleanRef}_video`;
        videoAssets.push({
          asset_id: videoAssetId,
          physical_file_hash: mediaUnderstandingResult.physical_file_hash || '',
          analysis_key: mediaUnderstandingResult.analysis_key || '',
          segments: mediaUnderstandingResult.segments
        });
      }

      let photos = photoAssets || options.photoAssets || options.photos || [];
      if (photos.length === 0 && options.autoFetchPhotos !== false && !mediaUnderstandingResult) {
        try {
          const { PhotoMediaUnderstandingService } = require('../property_media/photo_understanding');
          const photoService = new PhotoMediaUnderstandingService();
          const photoRes = await photoService.analyzePropertyPhotos(cleanRef);
          photos = photoRes.photos || [];
        } catch (e) {}
      }

      mediaCatalog = {
        property_ref: cleanRef,
        video_assets: videoAssets,
        photo_assets: photos,
        segments: videoAssets.length > 0 ? videoAssets[0].segments : []
      };
    }

    // 2. Cálculo do Fingerprint Canônico (creative_direction_key)
    const propertySemanticMediaPoolKey = computePropertySemanticMediaPoolKey({
      video_assets: mediaCatalog.video_assets || (mediaCatalog.segments ? [mediaCatalog] : []),
      photo_assets: mediaCatalog.photo_assets || mediaCatalog.photos || []
    });

    const creativeDirectionKey = computeCreativeDirectionKey({
      script_timing_key: scriptTimingKey,
      beat_analysis_key: beatAnalysisKey,
      property_semantic_media_pool_key: propertySemanticMediaPoolKey,
      intent_extractor_version: this.intentExtractorVersion,
      media_ranker_version: this.mediaRankerVersion,
      continuity_engine_version: this.continuityEngineVersion,
      fallback_policy_version: this.fallbackPolicyVersion,
      director_version: this.directorVersion,
      scoring_weights: scoringWeights,
      semantic_thresholds: semanticThresholds,
      min_visual_duration_ms: minVisualDurationMs,
      max_photo_visual_duration_ms: maxPhotoVisualDurationMs,
      schema_version: SCHEMA_VERSION
    });

    const jobDir = path.join(JOBS_OUTPUTS_DIR, cleanJobId);
    const directionDir = path.join(jobDir, 'creative_direction', creativeDirectionKey);
    const directionFilePath = path.join(directionDir, 'direction_plan.json');

    // 3. Verificação de Cache Hit Imutável
    if (fs.existsSync(directionFilePath)) {
      try {
        const cachedRaw = fs.readFileSync(directionFilePath, 'utf8');
        const cachedPlan = JSON.parse(cachedRaw);
        if (
          cachedPlan.creative_direction_key === creativeDirectionKey &&
          Array.isArray(cachedPlan.beats_decisions) &&
          cachedPlan.beats_decisions.length === scriptTimingResult.beats.length
        ) {
          return {
            status: 'READY',
            from_cache: true,
            job_id: cleanJobId,
            property_ref: cleanRef,
            creative_direction_key: creativeDirectionKey,
            property_semantic_media_pool_key: propertySemanticMediaPoolKey,
            direction_plan: cachedPlan,
            direction_plan_path: directionFilePath
          };
        }
      } catch (e) {}
    }

    // 4. Decisão Editorial Beat por Beat Multimodal
    const beatsDecisions = [];
    const consumedFootageMap = {};
    const recentPhotosUsageMap = {};
    let lastVisualDecision = null;
    let recentModalityFlips = 0;
    let lastMediaKind = null;

    for (let beatIdx = 0; beatIdx < scriptTimingResult.beats.length; beatIdx++) {
      const beat = scriptTimingResult.beats[beatIdx];

      // 4.1 Extração de Intenção Semântica
      const semanticIntent = extractSemanticIntent(beat.text);

      // 4.2 Ranking e Feasibility de Candidatos (Vídeo + Foto)
      const lastSegIdx = lastVisualDecision ? lastVisualDecision.selected_segment_index : null;
      const evaluatedCandidates = evaluateAndRankCandidates({
        semanticIntent,
        requiredDurationMs: beat.duration_ms,
        mediaCatalog,
        lastSelectedCandidate: lastVisualDecision,
        lastSelectedSegmentIndex: lastSegIdx,
        recentPhotosUsageMap,
        currentBeatIndex: beatIdx,
        recentModalityFlips,
        consumedFootageMap,
        scoringWeights,
        semanticThresholds: {
          ...semanticThresholds,
          min_visual_duration_ms: minVisualDurationMs,
          max_photo_visual_duration_ms: maxPhotoVisualDurationMs
        }
      });

      // 4.3 Continuidade e Resolução da Sequência Visual
      const visualDecisions = resolveVisualDecisionsForBeat({
        beat,
        rankedCandidates: evaluatedCandidates,
        mediaCatalog,
        consumedFootageMap,
        recentPhotosUsageMap,
        lastVisualDecision,
        semanticThresholds: {
          ...semanticThresholds,
          min_visual_duration_ms: minVisualDurationMs,
          max_photo_visual_duration_ms: maxPhotoVisualDurationMs
        }
      });

      const beatDecision = {
        beat_index: beat.beat_index,
        start_ms: beat.start_ms,
        end_ms: beat.end_ms,
        duration_ms: beat.duration_ms,
        spoken_text: beat.text,
        semantic_intent: semanticIntent,
        evaluated_candidates: evaluatedCandidates,
        visual_decisions: visualDecisions
      };

      validateBeatDecision(beatDecision);
      beatsDecisions.push(beatDecision);

      if (visualDecisions.length > 0) {
        const lastDec = visualDecisions[visualDecisions.length - 1];
        if (lastMediaKind && lastDec.media_kind && lastDec.media_kind !== lastMediaKind) {
          recentModalityFlips++;
        }
        lastMediaKind = lastDec.media_kind;
        lastVisualDecision = lastDec;
      }
    }

    // 5. Estruturação do Direction Plan Completo
    const directionPlan = {
      schema_version: SCHEMA_VERSION,
      creative_direction_key: creativeDirectionKey,
      property_semantic_media_pool_key: propertySemanticMediaPoolKey,
      job_id: cleanJobId,
      property_ref: cleanRef,
      script_timing_key: scriptTimingKey,
      beat_analysis_key: beatAnalysisKey,
      intent_extractor_version: this.intentExtractorVersion,
      media_ranker_version: this.mediaRankerVersion,
      continuity_engine_version: this.continuityEngineVersion,
      fallback_policy_version: this.fallbackPolicyVersion,
      director_version: this.directorVersion,
      scoring_weights: scoringWeights,
      semantic_thresholds: semanticThresholds,
      beats_count: beatsDecisions.length,
      beats_decisions: beatsDecisions,
      created_at: new Date().toISOString()
    };

    // 6. Persistência Atômica do Artefato Shadow
    if (!fs.existsSync(directionDir)) fs.mkdirSync(directionDir, { recursive: true });

    const randSuffix = crypto.randomBytes(4).toString('hex');
    const tempPlanPath = path.join(directionDir, `direction_tmp_${randSuffix}.json`);
    fs.writeFileSync(tempPlanPath, JSON.stringify(directionPlan, null, 2), 'utf8');
    fs.renameSync(tempPlanPath, directionFilePath);

    return {
      status: 'READY',
      from_cache: false,
      job_id: cleanJobId,
      property_ref: cleanRef,
      creative_direction_key: creativeDirectionKey,
      property_semantic_media_pool_key: propertySemanticMediaPoolKey,
      direction_plan: directionPlan,
      direction_plan_path: directionFilePath
    };
  }

  /**
   * Compila o Creative Direction Plan em um Creative Blueprint 1.2 válido para o Composer V3
   */
  compileToBlueprint12({
    directionPlan,
    presenterAssetId,
    creativeId = `crv_showcase_${Date.now()}`,
    stylePreset = 'performance_reels_v1',
    options = {}
  } = {}) {
    if (!directionPlan || !Array.isArray(directionPlan.beats_decisions)) {
      throw new Error('[CREATIVE_DIRECTOR_ERROR] directionPlan inválido para compilação em Blueprint 1.2');
    }
    if (!presenterAssetId) {
      throw new Error('[CREATIVE_DIRECTOR_ERROR] presenterAssetId é obrigatório para montar o Blueprint');
    }

    const visualTimeline = [];
    const pipWindows = [];
    const scenes = [];
    let sceneIdx = 0;

    for (const beatDec of directionPlan.beats_decisions) {
      for (const vDec of beatDec.visual_decisions) {
        const isPresenterFullscreen = (vDec.fallback_used && vDec.fallback_type === 'presenter_fullscreen') || !vDec.selected_asset_id;
        const isPhoto = (vDec.media_kind === 'photo' || vDec.asset_type === 'image' || vDec.media_kind === 'property_photo');

        let startMs = vDec.timeline_start_ms;
        let endMs = vDec.timeline_end_ms;
        let sourceIn = vDec.source_in_ms !== null && vDec.source_in_ms !== undefined ? vDec.source_in_ms : null;
        let sourceOut = vDec.source_out_ms !== null && vDec.source_out_ms !== undefined ? vDec.source_out_ms : null;

        // Garantir cobertura contínua sem gaps entre beats
        if (visualTimeline.length === 0) {
          if (startMs > 0) {
            if (!isPhoto && sourceIn !== null) {
              sourceIn = Math.max(0, sourceIn - startMs);
            }
            startMs = 0;
          }
        } else {
          const prevSeg = visualTimeline[visualTimeline.length - 1];
          if (startMs > prevSeg.end_ms) {
            const gap = startMs - prevSeg.end_ms;
            prevSeg.end_ms = startMs;
            if (prevSeg.asset_type === 'video' && prevSeg.source_out_ms !== null) {
              prevSeg.source_out_ms += gap;
            }
            if (pipWindows.length > 0) {
              const lastPip = pipWindows[pipWindows.length - 1];
              lastPip.end_ms = startMs;
              lastPip.source_out_ms = startMs;
            }
          } else if (startMs < prevSeg.end_ms) {
            startMs = prevSeg.end_ms;
          }
        }

        const dur = Math.max(1, endMs - startMs);

        if (isPresenterFullscreen) {
          visualTimeline.push({
            asset_id: presenterAssetId,
            asset_type: 'video',
            start_ms: startMs,
            end_ms: endMs,
            source_in_ms: sourceIn !== null ? sourceIn : startMs,
            source_out_ms: sourceOut !== null ? sourceOut : endMs,
            fit: 'cover',
            transition_in: { type: 'cut' }
          });

          scenes.push({
            scene_index: sceneIdx++,
            scene_type: 'presenter_fullscreen',
            duration_ms: dur,
            asset_id: presenterAssetId,
            source_in_ms: sourceIn !== null ? sourceIn : startMs,
            source_out_ms: sourceOut !== null ? sourceOut : endMs,
            visual_layers: [
              {
                layer_type: 'presenter_fullscreen',
                asset_id: presenterAssetId,
                source_in_ms: sourceIn !== null ? sourceIn : startMs,
                source_out_ms: sourceOut !== null ? sourceOut : endMs
              }
            ],
            audio_mix: {
              presenter_volume: 1.0,
              broll_audio_volume: 0.0
            }
          });
        } else if (isPhoto) {
          // B-roll de Foto com Ken Burns automático pelo Composer V3
          visualTimeline.push({
            asset_id: vDec.selected_asset_id,
            asset_type: 'image',
            start_ms: startMs,
            end_ms: endMs,
            fit: 'cover',
            transition_in: { type: 'cut' }
          });

          // Janela PIP do Apresentador sincronizada com lip-sync
          pipWindows.push({
            start_ms: startMs,
            end_ms: endMs,
            source_in_ms: startMs,
            source_out_ms: endMs,
            position: 'bottom_right',
            shape: 'rounded_rect'
          });

          scenes.push({
            scene_index: sceneIdx++,
            scene_type: 'broll_fullscreen_avatar_pip',
            duration_ms: dur,
            asset_id: vDec.selected_asset_id,
            visual_layers: [
              {
                layer_type: 'broll_fullscreen',
                asset_id: vDec.selected_asset_id,
                asset_type: 'image'
              },
              {
                layer_type: 'avatar_pip_overlay',
                asset_id: presenterAssetId,
                pip_position: 'bottom_right',
                width_percent: 32,
                height_percent: 32,
                border_radius: 16
              }
            ],
            audio_mix: {
              presenter_volume: 1.0,
              broll_audio_volume: 0.0
            }
          });
        } else {
          // B-roll de vídeo com corte exato source_in_ms a source_out_ms
          visualTimeline.push({
            asset_id: vDec.selected_asset_id,
            asset_type: 'video',
            start_ms: startMs,
            end_ms: endMs,
            source_in_ms: sourceIn !== null ? sourceIn : startMs,
            source_out_ms: sourceOut !== null ? sourceOut : endMs,
            fit: 'cover',
            transition_in: { type: 'cut' }
          });

          // Janela PIP do Apresentador sincronizada com lip-sync
          pipWindows.push({
            start_ms: startMs,
            end_ms: endMs,
            source_in_ms: startMs,
            source_out_ms: endMs,
            position: 'bottom_right',
            shape: 'rounded_rect'
          });

          scenes.push({
            scene_index: sceneIdx++,
            scene_type: 'broll_fullscreen_avatar_pip',
            duration_ms: dur,
            asset_id: vDec.selected_asset_id,
            source_in_ms: sourceIn !== null ? sourceIn : startMs,
            source_out_ms: sourceOut !== null ? sourceOut : endMs,
            visual_layers: [
              {
                layer_type: 'broll_fullscreen',
                asset_id: vDec.selected_asset_id,
                source_in_ms: sourceIn !== null ? sourceIn : startMs,
                source_out_ms: sourceOut !== null ? sourceOut : endMs
              },
              {
                layer_type: 'avatar_pip_overlay',
                asset_id: presenterAssetId,
                pip_position: 'bottom_right',
                width_percent: 32,
                height_percent: 32,
                border_radius: 16
              }
            ],
            audio_mix: {
              presenter_volume: 1.0,
              broll_audio_volume: 0.0
            }
          });
        }
      }
    }

    const totalDurationMs = visualTimeline.length > 0 ? visualTimeline[visualTimeline.length - 1].end_ms : 0;

    return {
      schema_version: '1.2',
      blueprint_version: '1.2.0',
      job_id: directionPlan.job_id,
      property_ref: directionPlan.property_ref,
      creative_id: creativeId,
      creative_direction_key: directionPlan.creative_direction_key,
      style_preset: stylePreset,
      format: {
        aspect_ratio: '9:16',
        width: 1080,
        height: 1920,
        fps: 30
      },
      editing_style: { style_id: stylePreset, version: 1 },
      total_duration_ms: totalDurationMs,
      scenes_count: scenes.length,
      scenes: scenes,
      audio_track: {
        primary_asset_id: presenterAssetId,
        source_in_ms: 0,
        source_out_ms: totalDurationMs,
        broll_audio_policy: 'mute_all_broll'
      },
      visual_timeline: visualTimeline,
      pip: {
        enabled: pipWindows.length > 0,
        asset_id: presenterAssetId,
        windows: pipWindows
      },
      overlays: [],
      captions: []
    };
  }
}

const creativeDirectorService = new CreativeDirectorService();
module.exports = creativeDirectorService;
module.exports.CreativeDirectorService = CreativeDirectorService;
