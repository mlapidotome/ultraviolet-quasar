/**
 * Showcase Canônico — Multimodal Semantic Matching (Fase 4C)
 * Bali Imóveis — Video Engine V2
 * 
 * Execução Comparativa sobre o Imóvel REF 1628:
 * - Baseline A: Creative Director 4A.3 (Video-Only)
 * - Candidate B: Creative Director 4C (Multimodal: Vídeo + 11 Fotos Reais)
 * - Renderização Final de Candidate B via Composer V3 para MP4
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const creativeDirectorService = require('./video_engine/creative_director/creative_director_service');
const composerService = require('./video_engine/composer_service');
const assetService = require('./video_engine/asset_service');
const propertyMediaService = require('./video_engine/property_media/property_media_service');
const { PhotoIngestionService } = require('./video_engine/property_media/photo_ingestion');
const {
  PhotoMediaUnderstandingService,
  OpenAIPhotoUnderstandingProvider,
  MockPhotoUnderstandingProvider
} = require('./video_engine/property_media/photo_understanding');

const PROPERTY_REF = '1628';
const JOB_ID_BASELINE = 'job_showcase_pvid_1628_semantic_v2';
const JOB_ID_CANDIDATE = `job_showcase_1628_multimodal_4c_${Date.now()}`;
const OUTPUTS_BASE_DIR = path.join(__dirname, 'outputs');
const OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs', JOB_ID_CANDIDATE);

async function runShowcase() {
  console.log('================================================================');
  console.log(`INICIANDO SHOWCASE CANÔNICO FASE 4C: REF ${PROPERTY_REF}`);
  console.log('================================================================\n');

  if (!fs.existsSync(OUTPUTS_DIR)) {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  }

  // 1. Carregar Script Timing Real do Showcase 4A.2/4A.3
  const baselinePlanPath = path.join(
    OUTPUTS_BASE_DIR,
    'jobs',
    JOB_ID_BASELINE,
    'creative_direction',
    '85a10392684d54ad8b73d1daa8f0b91251c2b256b3bc67b637df77e5e5b5a930',
    'direction_plan.json'
  );

  let baselinePlan = null;
  if (fs.existsSync(baselinePlanPath)) {
    baselinePlan = JSON.parse(fs.readFileSync(baselinePlanPath, 'utf8'));
  }

  const scriptTimingResult = {
    script_timing_key: '954776a0636899ff6523278f6ab19d0d44ecbc40893fcfb5744f3dcd6680b57f',
    beat_analysis_key: '63169403db2033024a8ed9640c10e0644777616752b66da74e69506e70999597',
    beats: [
      {
        beat_index: 0,
        start_ms: 0,
        end_ms: 3720,
        duration_ms: 3720,
        text: 'Venha se encantar com esta cozinha moderna repleta de armários planejados.'
      },
      {
        beat_index: 1,
        start_ms: 4340,
        end_ms: 8140,
        duration_ms: 3800,
        text: 'A varanda ampla oferece uma vista espetacular da cidade.'
      },
      {
        beat_index: 2,
        start_ms: 9140,
        end_ms: 11380,
        duration_ms: 2240,
        text: 'A sala de estar é iluminada e perfeita'
      },
      {
        beat_index: 3,
        start_ms: 11380,
        end_ms: 13960,
        duration_ms: 2580,
        text: 'para receber, com dormitórios aconchegantes'
      },
      {
        beat_index: 4,
        start_ms: 14420,
        end_ms: 15340,
        duration_ms: 920,
        text: 'com piso em madeira.'
      }
    ]
  };

  // 2. Registrar Presenter Asset Real
  const presenterSrc = path.join(OUTPUTS_BASE_DIR, 'jobs', JOB_ID_BASELINE, 'ast_presenter_marcel_1628_v2.mp4');
  const presenterDest = path.join(OUTPUTS_DIR, 'presenter_marcel.mp4');
  fs.copyFileSync(presenterSrc, presenterDest);

  const presenterHash = await propertyMediaService.computeFileHashStream(presenterDest);
  const presenterSpecs = await propertyMediaService.inspectVideoFile(presenterDest);

  const presenterAsset = await assetService.createAsset({
    id: `ast_pres_${JOB_ID_CANDIDATE}`,
    job_id: JOB_ID_CANDIDATE,
    asset_type: 'presenter_hook',
    storage_type: 'local_file',
    generation_key: crypto.randomBytes(32).toString('hex'),
    status: 'pending'
  });

  await assetService.markAssetReady(presenterAsset.id, {
    localPath: presenterDest,
    fileHash: presenterHash,
    specs: presenterSpecs
  });

  // 3. Registrar Property Video Asset Real (4A.1)
  const videoStoragePath = path.join(OUTPUTS_BASE_DIR, 'jobs', JOB_ID_BASELINE, 'ast_pvid_1628_video_main.mp4');
  const videoDest = path.join(OUTPUTS_DIR, 'property_video_1628.mp4');
  fs.copyFileSync(videoStoragePath, videoDest);

  const videoHash = await propertyMediaService.computeFileHashStream(videoDest);
  const videoSpecs = await propertyMediaService.inspectVideoFile(videoDest);

  let pvidAsset = null;
  try {
    pvidAsset = await assetService.getAssetById('ast_pvid_1628_video_main');
  } catch (e) {}

  if (!pvidAsset) {
    pvidAsset = await assetService.createAsset({
      id: `ast_pvid_1628_video_main`,
      job_id: JOB_ID_CANDIDATE,
      asset_type: 'property_video',
      storage_type: 'local_file',
      generation_key: crypto.randomBytes(32).toString('hex'),
      status: 'pending'
    });

    await assetService.markAssetReady(pvidAsset.id, {
      localPath: videoDest,
      fileHash: videoHash,
      specs: videoSpecs
    });
  }

  const videoAsset = {
    asset_id: pvidAsset.id,
    physical_file_hash: videoHash,
    storage_path: videoDest,
    total_duration_ms: 30000,
    segments: [
      {
        segment_index: 1,
        start_ms: 1800,
        end_ms: 7800,
        room_type: 'kitchen',
        features: ['porcelain_tile', 'modern_fixtures', 'planned_cabinets'],
        technical_quality_score: 0.78,
        aesthetic_score: 0.68,
        confidence: 0.88
      },
      {
        segment_index: 4,
        start_ms: 12000,
        end_ms: 15000,
        room_type: 'balcony',
        features: ['view', 'barbecue_grill'],
        technical_quality_score: 0.82,
        aesthetic_score: 0.75,
        confidence: 0.85
      },
      {
        segment_index: 5,
        start_ms: 15000,
        end_ms: 21000,
        room_type: 'living_room',
        features: ['furnished', 'bright', 'spacious', 'natural_lighting', 'modern_fixtures'],
        technical_quality_score: 0.78,
        aesthetic_score: 0.68,
        confidence: 0.88
      },
      {
        segment_index: 8,
        start_ms: 24000,
        end_ms: 30000,
        room_type: 'bedroom',
        features: ['air_conditioning', 'wooden_floor'],
        technical_quality_score: 0.76,
        aesthetic_score: 0.65,
        confidence: 0.82
      }
    ]
  };

  // 4. Carregar e Registrar as 11 Fotos Reais Analisadas de REF 1628 (4B.1 / 4B.2)
  console.log('[1/4] Carregando fotos reais e entendimentos semânticos da Fase 4B.2...');
  const ingestService = new PhotoIngestionService();
  await ingestService.ingestPropertyPhotos(PROPERTY_REF);
  const pool = await propertyMediaService.getPropertyMediaPool(PROPERTY_REF);
  const readyPhotos = pool.photos || [];

  const apiKey = process.env.OPENAI_API_KEY;
  const provider = apiKey
    ? new OpenAIPhotoUnderstandingProvider({ apiKey, modelId: 'gpt-4o-mini', detail: 'high' })
    : new MockPhotoUnderstandingProvider();
  const understandingService = new PhotoMediaUnderstandingService({ provider });

  const analyzedPhotoAssets = [];
  for (const p of readyPhotos) {
    const analysisRes = await understandingService.analyzePropertyPhoto(p);
    const semView = analysisRes.semantic_view;

    // Registrar no assetService se ainda não existir
    let dbAsset = null;
    try {
      dbAsset = await assetService.getAssetById(p.asset_id);
    } catch (e) {}

    if (!dbAsset) {
      dbAsset = await assetService.createAsset({
        id: p.asset_id,
        job_id: JOB_ID_CANDIDATE,
        asset_type: 'image',
        storage_type: 'local_file',
        generation_key: crypto.randomBytes(32).toString('hex'),
        status: 'pending'
      });

      await assetService.markAssetReady(dbAsset.id, {
        localPath: p.storage_path,
        fileHash: p.physical_file_hash,
        specs: { width: 1080, height: 1920, media_type: 'image' }
      });
    }

    analyzedPhotoAssets.push({
      asset_id: p.asset_id,
      physical_file_hash: p.physical_file_hash,
      storage_path: p.storage_path,
      photo_analysis_key: semView.photo_analysis_key,
      semantic: semView.semantic,
      quality: semView.quality,
      metadata: p.metadata
    });
  }

  console.log(`[CATALOG] Catálogo Multimodal Carregado: 1 Vídeo (${videoAsset.segments.length} segmentos) + ${analyzedPhotoAssets.length} Fotos Reais Analisadas.`);

  // 5. Executar Candidate B: Multimodal Creative Director (4C)
  console.log('\n[2/4] Executando Creative Director Multimodal 4C (Decisão Beat-by-Beat)...');
  const candidateResult = await creativeDirectorService.createDirectionPlan({
    jobId: JOB_ID_CANDIDATE,
    propertyRef: PROPERTY_REF,
    scriptTimingResult,
    propertySemanticCatalog: {
      property_ref: PROPERTY_REF,
      video_assets: [videoAsset],
      photo_assets: analyzedPhotoAssets
    }
  });

  const candidatePlan = candidateResult.direction_plan;
  console.log(`[CREATIVE DIRECTOR] Plano Multimodal Gerado! Key: ${candidatePlan.creative_direction_key}`);

  // 6. Montar e Exibir Tabela de Comparação Auditável
  console.log('\n================================================================');
  console.log('AUDITORIA DE DECISÃO: BASELINE A (4A.3 Vídeo-Only) vs CANDIDATE B (4C Multimodal)');
  console.log('================================================================');

  const comparisonTable = [];
  for (let bIdx = 0; bIdx < scriptTimingResult.beats.length; bIdx++) {
    const beat = scriptTimingResult.beats[bIdx];
    const baseDec = baselinePlan ? baselinePlan.beats_decisions[bIdx]?.visual_decisions[0] : null;
    const candDecs = candidatePlan.beats_decisions[bIdx].visual_decisions;

    const baseSummary = baseDec
      ? `Vídeo seg #${baseDec.selected_segment_index} (${baseDec.room_type || 'N/A'})`
      : 'N/A';

    const candSummary = candDecs.map(d => {
      if (d.media_kind === 'photo') {
        const photoMatch = analyzedPhotoAssets.find(p => p.asset_id === d.selected_asset_id);
        const crmPos = photoMatch?.metadata?.posicao || 'N/A';
        return `Foto #${crmPos} [${d.primary_room_type}] (Score: ${(d.confidence || 0.9).toFixed(2)})`;
      } else {
        return `Vídeo seg #${d.selected_segment_index} [${d.primary_room_type}] (${d.source_in_ms}-${d.source_out_ms}ms)`;
      }
    }).join(' + ');

    const winnerKind = candDecs.map(d => d.media_kind === 'photo' ? 'FOTO' : 'VÍDEO').join('+');

    comparisonTable.push({
      beat_index: bIdx,
      timing: `${beat.start_ms}-${beat.end_ms}ms (${beat.duration_ms}ms)`,
      spoken_text: beat.text,
      baseline_a: baseSummary,
      candidate_b: candSummary,
      modality_winner: winnerKind,
      selection_reason: candDecs[0].selection_reason
    });

    console.log(`\nBeat #${bIdx} [${beat.start_ms}-${beat.end_ms}ms]: "${beat.text}"`);
    console.log(`  - Baseline A (4A.3 Video): ${baseSummary}`);
    console.log(`  - Candidate B (4C Multi):  ${candSummary}`);
    console.log(`  - Decisão: [${winnerKind}] -> ${candDecs[0].selection_reason}`);
  }

  // 7. Compilar para Blueprint 1.2
  console.log('\n[3/4] Compilando Direction Plan Multimodal para Blueprint 1.2...');
  const blueprint = creativeDirectorService.compileToBlueprint12({
    directionPlan: candidatePlan,
    presenterAssetId: presenterAsset.id,
    creativeId: `crv_showcase_1628_4c_${Date.now()}`
  });

  // Ajustar duração total no audio_track e formato padrão
  const totalDurationMs = Math.round(presenterSpecs.duration_sec * 1000);
  blueprint.audio_track = {
    primary_asset_id: presenterAsset.id,
    source_in_ms: 0,
    source_out_ms: totalDurationMs,
    broll_audio_policy: 'mute_all_broll'
  };

  const blueprintPath = path.join(OUTPUTS_DIR, 'blueprint_1_2.json');
  fs.writeFileSync(blueprintPath, JSON.stringify(blueprint, null, 2), 'utf8');
  console.log(`[BLUEPRINT] Blueprint 1.2 salvo em: ${blueprintPath}`);

  // 8. Renderizar via Composer V3 (composeCreative) para MP4
  console.log('\n[4/4] Renderizando Candidate B via Composer V3 para MP4...');
  const renderRes = await composerService.composeCreative({
    jobId: JOB_ID_CANDIDATE,
    blueprint,
    isShadow: false
  });

  const finalVideoPath = renderRes.output_path || renderRes.video_path || (renderRes.asset ? renderRes.asset.local_path : '');
  console.log('\n================================================================');
  console.log('SHOWCASE CANÔNICO FASE 4C CONCLUÍDO COM SUCESSO! ✅');
  console.log('================================================================');
  console.log(`Vídeo Final Renderizado (Candidate B): ${finalVideoPath}`);
  console.log(`Creative ID: ${blueprint.creative_id}`);
  console.log(`Plano de Direção: ${candidateResult.direction_plan_path}`);

  return {
    job_id: JOB_ID_CANDIDATE,
    creative_direction_key: candidatePlan.creative_direction_key,
    comparison_table: comparisonTable,
    video_path: finalVideoPath,
    blueprint_path: blueprintPath
  };
}

if (require.main === module) {
  runShowcase().catch(err => {
    console.error('FATAL SHOWCASE ERROR:', err);
    process.exit(1);
  });
}

module.exports = { runShowcase };
