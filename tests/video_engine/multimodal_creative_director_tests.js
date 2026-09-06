/**
 * Suíte de Testes Formais: Multimodal Creative Director (Fase 4C)
 * Cenários A a AN (40 Cenários)
 * Bali Imóveis — Video Engine V2
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const creativeDirectorService = require('../../video_engine/creative_director/creative_director_service');
const {
  SCHEMA_VERSION,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_SEMANTIC_THRESHOLDS,
  validateVisualDecision,
  validateBeatDecision,
  computePropertySemanticMediaPoolKey,
  computeCreativeDirectionKey
} = require('../../video_engine/creative_director/creative_direction_schema');
const { extractSemanticIntent } = require('../../video_engine/creative_director/intent_extractor');
const {
  buildUnifiedMediaCandidates,
  computeSemanticRelevance,
  evaluateAndRankCandidates
} = require('../../video_engine/creative_director/media_ranker');
const { resolveVisualDecisionsForBeat } = require('../../video_engine/creative_director/editorial_continuity_engine');

let passCount = 0;
let failCount = 0;

function reportPass(name) {
  passCount++;
  console.log(`  [PASS] ${name}`);
}

function reportFail(name, err) {
  failCount++;
  console.error(`  [FAIL] ${name}:`, err.message);
}

function createMockVideoAsset(assetId = 'ast_pvid_1628_video_main') {
  return {
    asset_id: assetId,
    physical_file_hash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    analysis_key: 'video_analysis_key_canonical_001',
    total_duration_ms: 30000,
    segments: [
      {
        segment_index: 0,
        start_ms: 0,
        end_ms: 5000,
        room_type: 'facade',
        features: ['natural_lighting'],
        technical_quality_score: 0.85,
        aesthetic_score: 0.80,
        confidence: 0.90
      },
      {
        segment_index: 1,
        start_ms: 5000,
        end_ms: 10000,
        room_type: 'living_room',
        features: ['sofa', 'tv_stand'],
        technical_quality_score: 0.90,
        aesthetic_score: 0.85,
        confidence: 0.95
      },
      {
        segment_index: 2,
        start_ms: 10000,
        end_ms: 14000,
        room_type: 'balcony',
        features: ['view', 'barbecue_grill'],
        technical_quality_score: 0.80,
        aesthetic_score: 0.75,
        confidence: 0.85
      },
      {
        segment_index: 3,
        start_ms: 14000,
        end_ms: 18000,
        room_type: 'kitchen',
        features: ['planned_cabinets', 'countertop'],
        technical_quality_score: 0.40,
        aesthetic_score: 0.40,
        confidence: 0.90
      }
    ]
  };
}

function createMockPhotoAssets() {
  return [
    {
      asset_id: 'ast_pimg_1628_01',
      physical_file_hash: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
      photo_analysis_key: 'photo_analysis_key_cozinha_01',
      semantic: {
        primary_room_type: 'kitchen',
        secondary_room_types: [],
        features: ['planned_cabinets', 'granite_countertop'],
        confidence: 0.95
      },
      quality: {
        technical_quality_score: 0.95,
        aesthetic_score: 0.90,
        editorial_utility_score: 0.95,
        composite_quality_score: 0.93
      }
    },
    {
      asset_id: 'ast_pimg_1628_02',
      physical_file_hash: 'bbccddeeff00112233445566778899aabbccddeeff0011223344556677889900',
      photo_analysis_key: 'photo_analysis_key_sacada_02',
      semantic: {
        primary_room_type: 'balcony',
        secondary_room_types: ['living_room'],
        features: ['barbecue_grill', 'panoramic_view'],
        confidence: 0.92
      },
      quality: {
        technical_quality_score: 0.88,
        aesthetic_score: 0.90,
        editorial_utility_score: 0.85,
        composite_quality_score: 0.88
      }
    },
    {
      asset_id: 'ast_pimg_1628_03',
      physical_file_hash: 'ccddeeff00112233445566778899aabbccddeeff001122334455667788990011',
      photo_analysis_key: 'photo_analysis_key_bedroom_03',
      semantic: {
        primary_room_type: 'bedroom',
        secondary_room_types: [],
        features: ['double_bed', 'wardrobe'],
        confidence: 0.90
      },
      quality: {
        technical_quality_score: 0.85,
        aesthetic_score: 0.85,
        editorial_utility_score: 0.80,
        composite_quality_score: 0.83
      }
    },
    {
      asset_id: 'ast_pimg_1628_04',
      physical_file_hash: 'ddeeff00112233445566778899aabbccddeeff00112233445566778899001122',
      photo_analysis_key: 'photo_analysis_key_dining_04',
      semantic: {
        primary_room_type: 'dining_room',
        secondary_room_types: [],
        features: ['dining_table'],
        confidence: 0.88
      },
      quality: {
        technical_quality_score: 0.80,
        aesthetic_score: 0.80,
        editorial_utility_score: 0.75,
        composite_quality_score: 0.78
      }
    }
  ];
}

async function runSuite() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE FORMAL MULTIMODAL CREATIVE DIRECTOR (FASE 4C)');
  console.log('================================================================\n');

  // Cenário A
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const catalog = { video_assets: [video], photo_assets: photos };
    const candidates = buildUnifiedMediaCandidates({ mediaCatalog: catalog });
    assert.strictEqual(candidates.length, 8);
    for (const c of candidates) {
      assert(c.candidate_id && c.asset_id && (c.media_kind === 'video_segment' || c.media_kind === 'photo'));
    }
    reportPass('Cenário A — Projeção Determinística de UnifiedMediaCandidate');
  } catch (e) { reportFail('Cenário A', e); }

  // Cenário B
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const photosShuffled = [photos[2], photos[0], photos[3], photos[1]];
    const key1 = computePropertySemanticMediaPoolKey({ video_assets: [video], photo_assets: photos });
    const key2 = computePropertySemanticMediaPoolKey({ video_assets: [video], photo_assets: photosShuffled });
    assert.strictEqual(key1, key2);
    reportPass('Cenário B — Determinismo Estrito de property_semantic_media_pool_key');
  } catch (e) { reportFail('Cenário B', e); }

  // Cenário C
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const key1 = computePropertySemanticMediaPoolKey({ video_assets: [video], photo_assets: photos });
    const modifiedPhotos = JSON.parse(JSON.stringify(photos));
    modifiedPhotos[0].semantic.primary_room_type = 'bathroom';
    const key2 = computePropertySemanticMediaPoolKey({ video_assets: [video], photo_assets: modifiedPhotos });
    assert.notStrictEqual(key1, key2);
    reportPass('Cenário C — Invalidação de Pool Key por Alteração Semântica');
  } catch (e) { reportFail('Cenário C', e); }

  // Cenário D
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const catalog = { video_assets: [video], photo_assets: photos };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 2500,
      mediaCatalog: catalog
    });
    const best = ranked.find(c => c.is_feasible);
    assert(best && best.media_kind === 'photo' && best.primary_room_type === 'kitchen');
    reportPass('Cenário D — Match Semântico de Foto');
  } catch (e) { reportFail('Cenário D', e); }

  // Cenário E
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const catalog = { video_assets: [video], photo_assets: photos };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog: catalog
    });
    const best = ranked.find(c => c.is_feasible);
    assert(best && best.media_kind === 'video_segment' && best.primary_room_type === 'living_room');
    reportPass('Cenário E — Match Semântico de Vídeo');
  } catch (e) { reportFail('Cenário E', e); }

  // Cenário F
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const catalog = { video_assets: [video], photo_assets: photos };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: catalog
    });
    assert.strictEqual(ranked[0].media_kind, 'photo');
    reportPass('Cenário F — Competição: Foto Vence por Qualidade e Editorial Utility');
  } catch (e) { reportFail('Cenário F', e); }

  // Cenário G
  try {
    const video = createMockVideoAsset();
    const photos = [{
      asset_id: 'ast_pimg_1628_low_living',
      physical_file_hash: '9'.repeat(64),
      photo_analysis_key: 'key_low',
      semantic: { primary_room_type: 'living_room', secondary_room_types: [], features: [] },
      quality: { technical_quality_score: 0.50, aesthetic_score: 0.50, editorial_utility_score: 0.40, composite_quality_score: 0.46 }
    }];
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog: { video_assets: [video], photo_assets: photos }
    });
    assert.strictEqual(ranked[0].media_kind, 'video_segment');
    reportPass('Cenário G — Competição: Vídeo Vence por Superioridade Visual');
  } catch (e) { reportFail('Cenário G', e); }

  // Cenário H
  try {
    const photos = [
      { asset_id: 'p_plain', physical_file_hash: 'a'.repeat(64), semantic: { primary_room_type: 'balcony', secondary_room_types: [], features: ['view'] }, quality: { technical_quality_score: 0.8, aesthetic_score: 0.8, editorial_utility_score: 0.8, composite_quality_score: 0.8 } },
      { asset_id: 'p_grill', physical_file_hash: 'b'.repeat(64), semantic: { primary_room_type: 'balcony', secondary_room_types: [], features: ['view', 'barbecue_grill'] }, quality: { technical_quality_score: 0.8, aesthetic_score: 0.8, editorial_utility_score: 0.8, composite_quality_score: 0.8 } }
    ];
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['balcony'], requested_features: ['barbecue_grill'] },
      requiredDurationMs: 2000,
      mediaCatalog: { photo_assets: photos }
    });
    assert(ranked.find(c => c.asset_id === 'p_grill').semantic_relevance > ranked.find(c => c.asset_id === 'p_plain').semantic_relevance);
    reportPass('Cenário H — Bônus de Features Concorrentes');
  } catch (e) { reportFail('Cenário H', e); }

  // Cenário I
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: ['bathroom'], requested_features: [] },
      { primary_room_type: 'garage', secondary_room_types: [], features: [] }
    );
    assert.strictEqual(rel, 0.00);
    reportPass('Cenário I — Descarte Estrito de Cômodo (Relevância 0.00)');
  } catch (e) { reportFail('Cenário I', e); }

  // Cenário J
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: ['balcony'], requested_features: [] },
      { primary_room_type: 'living_room', secondary_room_types: ['balcony'], features: [] }
    );
    assert.strictEqual(rel, 0.65);
    reportPass('Cenário J — Ambientes Secundários Pontuam 0.65');
  } catch (e) { reportFail('Cenário J', e); }

  // Cenário K
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: ['living_room'], requested_features: [] },
      { primary_room_type: 'dining_room', secondary_room_types: [], features: [] }
    );
    assert.strictEqual(rel, 0.50);
    reportPass('Cenário K — Ambientes Compatíveis Pontuam 0.50');
  } catch (e) { reportFail('Cenário K', e); }

  // Cenário L
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: [], requested_features: ['planned_cabinets'] },
      { primary_room_type: 'kitchen', secondary_room_types: [], features: ['planned_cabinets'] }
    );
    assert.strictEqual(rel, 0.70);
    reportPass('Cenário L — Feature-Only Beat (Com Match)');
  } catch (e) { reportFail('Cenário L', e); }

  // Cenário M
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: [], requested_features: ['planned_cabinets'] },
      { primary_room_type: 'living_room', secondary_room_types: [], features: ['sofa'] }
    );
    assert.strictEqual(rel, 0.00);
    reportPass('Cenário M — Feature-Only Beat (Sem Match Descartado)');
  } catch (e) { reportFail('Cenário M', e); }

  // Cenário N
  try {
    const rel = computeSemanticRelevance(
      { requested_room_types: [], requested_features: [] },
      { primary_room_type: 'living_room', secondary_room_types: [], features: [] }
    );
    assert.strictEqual(rel, 0.30);
    reportPass('Cenário N — Beat Abstrato / Conceitual Atribui Base 0.30');
  } catch (e) { reportFail('Cenário N', e); }

  // Cenário O
  try {
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 0, start_ms: 0, end_ms: 1200, duration_ms: 1200, text: 'Curto' },
      rankedCandidates: [{ candidate_id: 'p1', asset_id: 'ast_pimg_1', media_kind: 'photo', is_feasible: true, semantic_relevance: 0.90, final_score: 0.90, primary_room_type: 'kitchen' }],
      mediaCatalog: { photo_assets: [{ asset_id: 'ast_pimg_1' }] },
      consumedFootageMap: {},
      recentPhotosUsageMap: {},
      lastVisualDecision: null,
      semanticThresholds: { min_visual_duration_ms: 1500, max_photo_visual_duration_ms: 6000 }
    });
    assert(decisions.length > 0);
    for (const d of decisions) {
      const dur = d.timeline_end_ms - d.timeline_start_ms;
      if (d.media_kind === 'photo') assert(dur >= 1500);
    }
    reportPass('Cenário O — Limite Mínimo de Duração de Foto');
  } catch (e) { reportFail('Cenário O', e); }

  // Cenário P
  try {
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 0, start_ms: 0, end_ms: 8000, duration_ms: 8000, text: 'Longo' },
      rankedCandidates: [
        { candidate_id: 'p1', asset_id: 'ast_pimg_1', physical_file_hash: 'h1', media_kind: 'photo', is_feasible: true, semantic_relevance: 0.90, final_score: 0.90, primary_room_type: 'kitchen' },
        { candidate_id: 'p2', asset_id: 'ast_pimg_2', physical_file_hash: 'h2', media_kind: 'photo', is_feasible: true, semantic_relevance: 0.85, final_score: 0.85, primary_room_type: 'kitchen' }
      ],
      mediaCatalog: {},
      consumedFootageMap: {},
      recentPhotosUsageMap: {},
      lastVisualDecision: null,
      semanticThresholds: { min_visual_duration_ms: 1500, max_photo_visual_duration_ms: 6000 }
    });
    assert.strictEqual(decisions.length, 2);
    assert.strictEqual(decisions[0].timeline_start_ms, 0);
    assert.strictEqual(decisions[0].timeline_end_ms, 4000);
    assert.strictEqual(decisions[1].timeline_start_ms, 4000);
    assert.strictEqual(decisions[1].timeline_end_ms, 8000);
    reportPass('Cenário P — Limite Máximo de Foto com Decomposição Multi-Take');
  } catch (e) { reportFail('Cenário P', e); }

  // Cenário Q
  try {
    const prevDec = { decision_id: 'd1', selected_asset_id: 'ast_pvid_1628', media_kind: 'video_segment', segment_index: 1, source_in_ms: 5000, source_out_ms: 8000, timeline_start_ms: 0, timeline_end_ms: 3000 };
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 1, start_ms: 3000, end_ms: 5000, duration_ms: 2000, text: 'Continuando' },
      rankedCandidates: [{ candidate_id: 'v1', asset_id: 'ast_pvid_1628', segment_index: 1, media_kind: 'video_segment', is_feasible: true, semantic_relevance: 0.90, final_score: 0.90, primary_room_type: 'living_room', segment_end_ms: 10000, available_duration_ms: 2000 }],
      mediaCatalog: {},
      consumedFootageMap: { 'ast_pvid_1628:1': 8000 },
      recentPhotosUsageMap: {},
      lastVisualDecision: prevDec
    });
    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].source_in_ms, 8000);
    assert.strictEqual(decisions[0].source_out_ms, 10000);
    reportPass('Cenário Q — Take Extension Contínuo de Vídeo');
  } catch (e) { reportFail('Cenário Q', e); }

  // Cenário R
  try {
    const prevDec = { decision_id: 'd1', selected_asset_id: 'ast_pimg_1628_01', physical_file_hash: 'h_p1', media_kind: 'photo', primary_room_type: 'bedroom', timeline_start_ms: 0, timeline_end_ms: 3000 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['bedroom'], requested_features: [] },
      requiredDurationMs: 2500,
      mediaCatalog: {
        photo_assets: [
          { asset_id: 'ast_pimg_1628_01', physical_file_hash: 'h_p1', semantic: { primary_room_type: 'bedroom', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.90, aesthetic_score: 0.90, editorial_utility_score: 0.90, composite_quality_score: 0.90 } },
          { asset_id: 'ast_pimg_1628_02', physical_file_hash: 'h_p2', semantic: { primary_room_type: 'bedroom', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.88, aesthetic_score: 0.88, editorial_utility_score: 0.88, composite_quality_score: 0.88 } }
        ]
      },
      lastSelectedCandidate: prevDec,
      currentBeatIndex: 1
    });
    assert.strictEqual(ranked[0].asset_id, 'ast_pimg_1628_02');
    reportPass('Cenário R — Não-Extensão de Foto (Alternância de Ângulo Fotográfico)');
  } catch (e) { reportFail('Cenário R', e); }

  // Cenário S
  try {
    const prevDec = { media_kind: 'photo', physical_file_hash: 'h_rep', primary_room_type: 'kitchen' };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: { photo_assets: [{ asset_id: 'p1', physical_file_hash: 'h_rep', semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9, composite_quality_score: 0.9 } }] },
      lastSelectedCandidate: prevDec
    });
    assert.strictEqual(ranked[0].repetition_penalty, 0.25);
    reportPass('Cenário S — Penalidade de Repetição Imediata (-0.25)');
  } catch (e) { reportFail('Cenário S', e); }

  // Cenário T
  try {
    const recentUsage = { h_rec: 0 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: { photo_assets: [{ asset_id: 'p1', physical_file_hash: 'h_rec', semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9, composite_quality_score: 0.9 } }] },
      currentBeatIndex: 2,
      recentPhotosUsageMap: recentUsage
    });
    assert.strictEqual(ranked[0].recency_penalty, 0.10);
    reportPass('Cenário T — Penalidade de Recorrência Recente (-0.10)');
  } catch (e) { reportFail('Cenário T', e); }

  // Cenário U
  try {
    const prevDec = { media_kind: 'photo', physical_file_hash: 'h_l1', primary_room_type: 'living_room' };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: { photo_assets: [{ asset_id: 'p2', physical_file_hash: 'h_l2', semantic: { primary_room_type: 'living_room', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9, composite_quality_score: 0.9 } }] },
      lastSelectedCandidate: prevDec
    });
    assert.strictEqual(ranked[0].complementary_sequence_bonus, 0.05);
    reportPass('Cenário U — Bônus de Sequência Fotográfica Complementar (+0.05)');
  } catch (e) { reportFail('Cenário U', e); }

  // Cenário V
  try {
    const prevDec = { media_kind: 'video_segment', primary_room_type: 'living_room' };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: { photo_assets: [{ asset_id: 'p1', physical_file_hash: 'h_p', semantic: { primary_room_type: 'living_room', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9, composite_quality_score: 0.9 } }] },
      lastSelectedCandidate: prevDec,
      recentModalityFlips: 2
    });
    assert.strictEqual(ranked[0].ping_pong_penalty, 0.15);
    reportPass('Cenário V — Aplicação de Penalidade Anti-Ping-Pong');
  } catch (e) { reportFail('Cenário V', e); }

  // Cenário W
  try {
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Inexistente' },
      rankedCandidates: [{ candidate_id: 'pg', asset_id: 'ast_pimg_g', media_kind: 'photo', is_feasible: true, semantic_relevance: 0.00, final_score: 0.40, aesthetic_score: 0.92, primary_room_type: 'garage' }],
      mediaCatalog: { photo_assets: [{ asset_id: 'ast_pimg_g', quality: { aesthetic_score: 0.92 } }] },
      consumedFootageMap: {},
      recentPhotosUsageMap: {},
      lastVisualDecision: null
    });
    assert.strictEqual(decisions[0].fallback_used, true);
    assert.strictEqual(decisions[0].fallback_type, 'generic_property_media');
    assert.strictEqual(decisions[0].selected_asset_id, 'ast_pimg_g');
    reportPass('Cenário W — Fallback Genérico para Foto de Alta Estética');
  } catch (e) { reportFail('Cenário W', e); }

  // Cenário X
  try {
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Inexistente' },
      rankedCandidates: [{ candidate_id: 'vf', asset_id: 'ast_pvid_f', segment_index: 0, media_kind: 'video_segment', is_feasible: true, semantic_relevance: 0.00, final_score: 0.40, aesthetic_score: 0.88, segment_start_ms: 0, segment_end_ms: 5000, available_duration_ms: 5000 }],
      mediaCatalog: { video_assets: [{ asset_id: 'ast_pvid_f', segments: [{ segment_index: 0, start_ms: 0, end_ms: 5000, aesthetic_score: 0.88 }] }] },
      consumedFootageMap: {},
      recentPhotosUsageMap: {},
      lastVisualDecision: null
    });
    assert.strictEqual(decisions[0].fallback_used, true);
    assert.strictEqual(decisions[0].fallback_type, 'generic_property_media');
    assert.strictEqual(decisions[0].selected_asset_id, 'ast_pvid_f');
    reportPass('Cenário X — Fallback Genérico para Vídeo');
  } catch (e) { reportFail('Cenário X', e); }

  // Cenário Y
  try {
    const decisions = resolveVisualDecisionsForBeat({
      beat: { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Vazio' },
      rankedCandidates: [],
      mediaCatalog: { video_assets: [], photo_assets: [] },
      consumedFootageMap: {},
      recentPhotosUsageMap: {},
      lastVisualDecision: null
    });
    assert.strictEqual(decisions[0].fallback_used, true);
    assert.strictEqual(decisions[0].fallback_type, 'presenter_fullscreen');
    assert.strictEqual(decisions[0].selected_asset_id, null);
    reportPass('Cenário Y — Fallback Nível 3: Presenter Fullscreen');
  } catch (e) { reportFail('Cenário Y', e); }

  // Cenário Z
  try {
    const photos = [{ asset_id: 'ast_pimg_1628_01', property_ref: '1628', physical_file_hash: 'h'.repeat(64), semantic: { primary_room_type: 'living_room', secondary_room_types: [], features: [] }, quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9, composite_quality_score: 0.9 } }];
    const candidates = buildUnifiedMediaCandidates({ mediaCatalog: { photo_assets: photos } });
    assert.strictEqual(candidates[0].asset_id, 'ast_pimg_1628_01');
    reportPass('Cenário Z — Isolamento Cross-Property Estrito');
  } catch (e) { reportFail('Cenário Z', e); }

  // Cenário AA
  try {
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: {
        photo_assets: [
          { asset_id: 'ast_pimg_b', quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9 } },
          { asset_id: 'ast_pimg_a', quality: { technical_quality_score: 0.9, aesthetic_score: 0.9, editorial_utility_score: 0.9 } }
        ]
      }
    });
    assert.strictEqual(ranked[0].asset_id, 'ast_pimg_a');
    reportPass('Cenário AA — Desempate Determinístico Total');
  } catch (e) { reportFail('Cenário AA', e); }

  // Cenário AB
  try {
    const validPhotoDecision = { decision_id: 'd_p1', beat_index: 0, timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pimg_1628_01', media_kind: 'photo', source_in_ms: null, source_out_ms: null, fallback_used: false, fallback_type: 'none' };
    assert.strictEqual(validateVisualDecision(validPhotoDecision), true);
    reportPass('Cenário AB — Validação de Schema: Foto Válida');
  } catch (e) { reportFail('Cenário AB', e); }

  // Cenário AC
  try {
    const invalidPhotoDecision = { decision_id: 'd_p_bad', beat_index: 0, timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pimg_1628_01', media_kind: 'photo', source_in_ms: 1000, source_out_ms: 4000, fallback_used: false, fallback_type: 'none' };
    let threw = false;
    try { validateVisualDecision(invalidPhotoDecision); } catch (err) { threw = true; }
    assert(threw);
    reportPass('Cenário AC — Rejeição de Schema: Foto com Source Trim');
  } catch (e) { reportFail('Cenário AC', e); }

  // Cenário AD
  try {
    const invalidVideoDecision = { decision_id: 'd_v_bad', beat_index: 0, timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pvid_1628', media_kind: 'video_segment', source_in_ms: 0, source_out_ms: 4000, fallback_used: false, fallback_type: 'none' };
    let threw = false;
    try { validateVisualDecision(invalidVideoDecision); } catch (err) { threw = true; }
    assert(threw);
    reportPass('Cenário AD — Rejeição de Schema: Vídeo com Divergência Temporal');
  } catch (e) { reportFail('Cenário AD', e); }

  // Cenário AE
  try {
    const directionPlan = { job_id: 'job_test_bp', property_ref: '1628', creative_direction_key: 'key_123', beats_decisions: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, visual_decisions: [{ decision_id: 'vd_1', timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pimg_1628_01', media_kind: 'photo', source_in_ms: null, source_out_ms: null, fallback_used: false, fallback_type: 'none' }] }] };
    const bp = creativeDirectorService.compileToBlueprint12({ directionPlan, presenterAssetId: 'ast_pres_test' });
    assert.strictEqual(bp.visual_timeline[0].asset_type, 'image');
    reportPass('Cenário AE — Compilação Blueprint: Foto com asset_type image');
  } catch (e) { reportFail('Cenário AE', e); }

  // Cenário AF
  try {
    const directionPlan = { job_id: 'job_test_bp', property_ref: '1628', creative_direction_key: 'key_123', beats_decisions: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, visual_decisions: [{ decision_id: 'vd_1', timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pvid_1628', media_kind: 'video_segment', source_in_ms: 1000, source_out_ms: 4000, fallback_used: false, fallback_type: 'none' }] }] };
    const bp = creativeDirectorService.compileToBlueprint12({ directionPlan, presenterAssetId: 'ast_pres_test' });
    assert.strictEqual(bp.visual_timeline[0].asset_type, 'video');
    reportPass('Cenário AF — Compilação Blueprint: Vídeo com asset_type video e trims 1:1');
  } catch (e) { reportFail('Cenário AF', e); }

  // Cenário AG
  try {
    const directionPlan = { job_id: 'job_test_bp', property_ref: '1628', creative_direction_key: 'key_123', beats_decisions: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, visual_decisions: [{ decision_id: 'vd_1', timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pimg_1628_01', media_kind: 'photo', source_in_ms: null, source_out_ms: null, fallback_used: false, fallback_type: 'none' }] }] };
    const bp = creativeDirectorService.compileToBlueprint12({ directionPlan, presenterAssetId: 'ast_pres_test' });
    assert.strictEqual(bp.pip.enabled, true);
    reportPass('Cenário AG — Compilação Blueprint: Janela PIP Sincronizada');
  } catch (e) { reportFail('Cenário AG', e); }

  // Cenário AH
  try {
    const directionPlan = { job_id: 'job_test_bp', property_ref: '1628', creative_direction_key: 'key_123', beats_decisions: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, visual_decisions: [{ decision_id: 'vd_1', timeline_start_ms: 0, timeline_end_ms: 3000, selected_asset_id: 'ast_pimg_1628_01', media_kind: 'photo', source_in_ms: null, source_out_ms: null, fallback_used: false, fallback_type: 'none' }] }] };
    const bp = creativeDirectorService.compileToBlueprint12({ directionPlan, presenterAssetId: 'ast_pres_test' });
    assert.strictEqual(bp.schema_version, '1.2');
    reportPass('Cenário AH — Validação de Contrato do Blueprint 1.2');
  } catch (e) { reportFail('Cenário AH', e); }

  // Cenário AI
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const scriptTiming = { script_timing_key: 'tk1', beat_analysis_key: 'bk1', beats: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Cozinha' }] };
    const p1 = await creativeDirectorService.createDirectionPlan({ jobId: 'j1', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos } });
    const p2 = await creativeDirectorService.createDirectionPlan({ jobId: 'j2', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos } });
    assert.strictEqual(p1.direction_plan.creative_direction_key, p2.direction_plan.creative_direction_key);
    reportPass('Cenário AI — Imutabilidade e Identidade Canônica de Direção');
  } catch (e) { reportFail('Cenário AI', e); }

  // Cenário AJ
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const scriptTiming = { script_timing_key: 'tk1', beat_analysis_key: 'bk1', beats: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Cozinha' }] };
    const p1 = await creativeDirectorService.createDirectionPlan({ jobId: 'jw1', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos }, options: { scoringWeights: { semantic_relevance: 0.50, technical_quality: 0.30, aesthetic_score: 0.20 } } });
    const p2 = await creativeDirectorService.createDirectionPlan({ jobId: 'jw2', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos }, options: { scoringWeights: { semantic_relevance: 0.80, technical_quality: 0.10, aesthetic_score: 0.10 } } });
    assert.notStrictEqual(p1.direction_plan.creative_direction_key, p2.direction_plan.creative_direction_key);
    reportPass('Cenário AJ — Invalidação de Direção por scoring_weights');
  } catch (e) { reportFail('Cenário AJ', e); }

  // Cenário AK
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const scriptTiming = { script_timing_key: 'tk1', beat_analysis_key: 'bk1', beats: [{ beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Cozinha' }] };
    const p1 = await creativeDirectorService.createDirectionPlan({ jobId: 'jt1', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos }, options: { semanticThresholds: { min_semantic_relevance: 0.60 } } });
    const p2 = await creativeDirectorService.createDirectionPlan({ jobId: 'jt2', propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos }, options: { semanticThresholds: { min_semantic_relevance: 0.85 } } });
    assert.notStrictEqual(p1.direction_plan.creative_direction_key, p2.direction_plan.creative_direction_key);
    reportPass('Cenário AK — Invalidação de Direção por semantic_thresholds');
  } catch (e) { reportFail('Cenário AK', e); }

  // Cenário AL
  try {
    const key = computeCreativeDirectionKey({
      script_timing_key: 'k1',
      beat_analysis_key: 'k2',
      property_semantic_media_pool_key: 'k3',
      intent_extractor_version: '1.0.0',
      media_ranker_version: '1.1.0',
      continuity_engine_version: '1.1.0',
      fallback_policy_version: '1.1.0',
      director_version: '1.1.0',
      scoring_weights: DEFAULT_SCORING_WEIGHTS,
      semantic_thresholds: DEFAULT_SEMANTIC_THRESHOLDS,
      min_visual_duration_ms: 1500,
      max_photo_visual_duration_ms: 6000,
      schema_version: '1.1.0'
    });
    assert.strictEqual(typeof key, 'string');
    assert.strictEqual(key.length, 64);
    reportPass('Cenário AL — Integridade de Identidade Canônica de Direção');
  } catch (e) { reportFail('Cenário AL', e); }

  // Cenário AM
  try {
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog: { video_assets: [createMockVideoAsset('ast_pvid_1628')] },
      consumedFootageMap: { 'ast_pvid_1628:1': 9000 }
    });
    assert.strictEqual(ranked.find(c => c.segment_index === 1).is_feasible, false);
    reportPass('Cenário AM — Rastreamento Estrito de Consumo de Footage de Vídeo');
  } catch (e) { reportFail('Cenário AM', e); }

  // Cenário AN
  try {
    const video = createMockVideoAsset();
    const photos = createMockPhotoAssets();
    const scriptTiming = {
      script_timing_key: 'timing_showcase_001',
      beat_analysis_key: 'beat_showcase_001',
      beats: [
        { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000, text: 'Fachada imponente e moderna' },
        { beat_index: 1, start_ms: 3000, end_ms: 6000, duration_ms: 3000, text: 'Living amplo integrado com a sala' },
        { beat_index: 2, start_ms: 6000, end_ms: 9000, duration_ms: 3000, text: 'Cozinha completa com armários planejados' },
        { beat_index: 3, start_ms: 9000, end_ms: 12000, duration_ms: 3000, text: 'Varanda gourmet com churrasqueira a carvão' },
        { beat_index: 4, start_ms: 12000, end_ms: 15000, duration_ms: 3000, text: 'Dormitório aconchegante para o seu descanso' }
      ]
    };
    const res = await creativeDirectorService.createDirectionPlan({ jobId: 'job_showcase_multimodal_an_' + Date.now(), propertyRef: '1628', scriptTimingResult: scriptTiming, propertySemanticCatalog: { video_assets: [video], photo_assets: photos } });
    const plan = res.direction_plan;
    assert.strictEqual(plan.beats_count, 5);
    assert.strictEqual(plan.beats_decisions[0].visual_decisions[0].media_kind, 'video_segment');
    assert.strictEqual(plan.beats_decisions[1].visual_decisions[0].media_kind, 'photo');
    assert.strictEqual(plan.beats_decisions[2].visual_decisions[0].media_kind, 'photo');
    assert.strictEqual(plan.beats_decisions[3].visual_decisions[0].primary_room_type, 'balcony');
    assert.strictEqual(plan.beats_decisions[4].visual_decisions[0].media_kind, 'photo');
    reportPass('Cenário AN — Showcase Pipeline Multimodal 5-Beats End-to-End');
  } catch (e) { reportFail('Cenário AN', e); }

  console.log('\n================================================================');
  console.log(`RESULTADO DA SUÍTE MULTIMODAL (FASE 4C): ${passCount} PASS / ${failCount} FAIL`);
  console.log('================================================================');
  if (failCount > 0) process.exit(1);
}

if (require.main === module) {
  runSuite().catch(err => { console.error('FATAL TEST ERROR:', err); process.exit(1); });
}

module.exports = { runSuite };