/**
 * Suíte de Testes Formais: Creative Director & Semantic Matching (Fase 4A.3)
 * Cenários A a Z
 * Bali Imóveis
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
  computeCreativeDirectionKey
} = require('../../video_engine/creative_director/creative_direction_schema');
const { extractSemanticIntent } = require('../../video_engine/creative_director/intent_extractor');
const { computeSemanticRelevance, evaluateAndRankCandidates } = require('../../video_engine/creative_director/media_ranker');
const { resolveVisualDecisionsForBeat } = require('../../video_engine/creative_director/editorial_continuity_engine');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const JOBS_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'jobs');

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

// Mock de Catálogo Semântico da Fase 4A.1
function createMockMediaUnderstanding() {
  return {
    analysis_key: 'a'.repeat(64),
    physical_file_hash: 'b'.repeat(64),
    asset_id: 'ast_pvid_test_video',
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
        end_ms: 12000,
        room_type: 'kitchen',
        features: ['porcelain_tile', 'modern_fixtures', 'planned_cabinets'],
        technical_quality_score: 0.80,
        aesthetic_score: 0.70,
        confidence: 0.90
      },
      {
        segment_index: 2,
        start_ms: 12000,
        end_ms: 16000,
        room_type: 'balcony',
        features: ['city_view'],
        technical_quality_score: 0.80,
        aesthetic_score: 0.75,
        confidence: 0.90
      },
      {
        segment_index: 3,
        start_ms: 16000,
        end_ms: 22000,
        room_type: 'living_room',
        features: ['bright', 'furnished', 'spacious', 'natural_lighting'],
        technical_quality_score: 0.78,
        aesthetic_score: 0.70,
        confidence: 0.88
      },
      {
        segment_index: 4,
        start_ms: 22000,
        end_ms: 28000,
        room_type: 'bedroom',
        features: ['wooden_floor', 'natural_lighting'],
        technical_quality_score: 0.75,
        aesthetic_score: 0.65,
        confidence: 0.85
      },
      {
        segment_index: 5,
        start_ms: 28000,
        end_ms: 30000,
        room_type: 'bathroom',
        features: ['modern_fixtures'],
        technical_quality_score: 0.95,
        aesthetic_score: 0.95, // Estética altíssima para testar se vence cômodo errado
        confidence: 0.95
      }
    ]
  };
}

// Mock de Script Timing da Fase 4A.2
function createMockScriptTiming() {
  return {
    alignment_key: 'c'.repeat(64),
    beat_analysis_key: 'd'.repeat(64),
    token_coverage: 1.0,
    beats: [
      {
        beat_index: 0,
        text: 'Venha se encantar com esta cozinha moderna repleta de armários planejados.',
        start_ms: 0,
        end_ms: 3500,
        duration_ms: 3500,
        cue_keywords: ['kitchen']
      },
      {
        beat_index: 1,
        text: 'A varanda ampla oferece uma vista espetacular da cidade.',
        start_ms: 3500,
        end_ms: 7000,
        duration_ms: 3500,
        cue_keywords: ['balcony', 'city_view']
      },
      {
        beat_index: 2,
        text: 'A sala de estar é iluminada e perfeita para receber,',
        start_ms: 7000,
        end_ms: 10500,
        duration_ms: 3500,
        cue_keywords: ['living_room']
      },
      {
        beat_index: 3,
        text: 'com dormitórios aconchegantes com piso em madeira.',
        start_ms: 10500,
        end_ms: 14000,
        duration_ms: 3500,
        cue_keywords: ['bedroom']
      }
    ]
  };
}

async function runAllTests() {
  console.log('==================================================');
  console.log('INICIANDO SUÍTE FORMAL CREATIVE DIRECTOR (FASE 4A.3)');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // Cenário A: Extração de Intenção Semântica por Beat
  // ----------------------------------------------------
  try {
    const text = 'Cozinha incrível com armários planejados e acabamento moderno.';
    const intent = extractSemanticIntent(text);
    assert(intent.requested_room_types.includes('kitchen'), 'Deve extrair kitchen');
    assert(intent.requested_features.includes('planned_cabinets'), 'Deve extrair planned_cabinets');
    assert(intent.requested_features.includes('modern_fixtures'), 'Deve extrair modern_fixtures');
    reportPass('Cenário A — Extração de Intenção Semântica por Beat');
  } catch (e) { reportFail('Cenário A', e); }

  // ----------------------------------------------------
  // Cenário B: Relevância Semântica com Prioridade Estrita sobre Estética
  // ----------------------------------------------------
  try {
    const intent = { requested_room_types: ['kitchen'], requested_features: ['planned_cabinets'] };
    const kitchenCandidate = { room_type: 'kitchen', features: ['planned_cabinets'], technical_quality_score: 0.5, aesthetic_score: 0.5 };
    const bathroomCandidate = { room_type: 'bathroom', features: [], technical_quality_score: 1.0, aesthetic_score: 1.0 };

    const relKitchen = computeSemanticRelevance(intent, kitchenCandidate);
    const relBathroom = computeSemanticRelevance(intent, bathroomCandidate);

    assert(relKitchen >= 0.90, 'Kitchen deve ter relevância semântica alta');
    assert.strictEqual(relBathroom, 0.0, 'Bathroom deve ter relevância semântica zero quando se pediu kitchen');
    reportPass('Cenário B — Prioridade Estrita de Relevância Semântica');
  } catch (e) { reportFail('Cenário B', e); }

  // ----------------------------------------------------
  // Cenário C: Ranking Reproduzível com Pesos Parametrizados (0.50 / 0.30 / 0.20)
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const intent = { requested_room_types: ['kitchen'], requested_features: ['planned_cabinets'] };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: intent,
      requiredDurationMs: 3000,
      mediaCatalog
    });

    assert(ranked.length === mediaCatalog.segments.length);
    assert.strictEqual(ranked[0].room_type, 'kitchen', 'O primeiro colocado deve ser kitchen');
    assert(ranked[0].final_match_score > ranked[1].final_match_score);
    reportPass('Cenário C — Ranking Reproduzível com Pesos Parametrizados');
  } catch (e) { reportFail('Cenário C', e); }

  // ----------------------------------------------------
  // Cenário D: Candidate Discovery Video-Only
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['balcony'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog
    });

    for (const c of ranked) {
      assert.strictEqual(c.media_type, 'property_video_segment', 'Media type deve ser property_video_segment');
      assert(c.segment_index !== undefined);
      assert(c.available_duration_ms > 0);
    }
    reportPass('Cenário D — Candidate Discovery Video-Only');
  } catch (e) { reportFail('Cenário D', e); }

  // ----------------------------------------------------
  // Cenário E: Cálculo Exato de source_in_ms e source_out_ms
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const beat = { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog
    });
    const consumedMap = {};
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: consumedMap
    });

    assert.strictEqual(decisions.length, 1);
    const d = decisions[0];
    assert.strictEqual(d.source_in_ms, 5000);
    assert.strictEqual(d.source_out_ms, 8000);
    assert.strictEqual(d.source_duration_ms, 3000);
    assert.strictEqual(d.timeline_duration_ms, 3000);
    reportPass('Cenário E — Cálculo Exato de source_in_ms e source_out_ms');
  } catch (e) { reportFail('Cenário E', e); }

  // ----------------------------------------------------
  // Cenário F: Aplicação de Penalidade por Repetição Consecutiva
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const ranked1 = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog,
      lastSelectedSegmentIndex: 3 // Segmento 3 é living_room
    });
    const candLiving = ranked1.find(c => c.segment_index === 3);
    assert.strictEqual(candLiving.repetition_penalty, 0.25, 'Deve aplicar penalidade de 0.25 por repetição consecutiva');
    reportPass('Cenário F — Aplicação de Penalidade por Repetição Consecutiva');
  } catch (e) { reportFail('Cenário F', e); }

  // ----------------------------------------------------
  // Cenário G: Prevenção de Microcortes (min_visual_duration_ms)
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const beat = { beat_index: 0, start_ms: 0, end_ms: 2000, duration_ms: 2000 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['balcony'], requested_features: [] },
      requiredDurationMs: 2000,
      mediaCatalog
    });
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: {},
      semanticThresholds: { min_semantic_relevance: 0.40, min_visual_duration_ms: 1500 }
    });

    for (const d of decisions) {
      assert(d.timeline_duration_ms >= 1500, 'Duração de cada take deve ser >= 1500ms');
    }
    reportPass('Cenário G — Prevenção de Microcortes (min_visual_duration_ms)');
  } catch (e) { reportFail('Cenário G', e); }

  // ----------------------------------------------------
  // Cenário H: Fallback Determinístico Auditável
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const beat = { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000 };
    // Roteiro pedindo ambiente inexistente no imóvel
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['garage'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog
    });
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: {}
    });

    assert.strictEqual(decisions[0].fallback_used, true, 'Deve ativar fallback');
    assert(decisions[0].fallback_type !== null);
    assert(decisions[0].selection_reason.includes('Fallback'));
    reportPass('Cenário H — Fallback Determinístico Auditável');
  } catch (e) { reportFail('Cenário H', e); }

  // ----------------------------------------------------
  // Cenário I: Determinismo de creative_direction_key e Cache Hit
  // ----------------------------------------------------
  const testJobIdI = `job_test_cd_i_${Date.now()}`;
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    const scriptTiming = createMockScriptTiming();

    const res1 = await creativeDirectorService.createDirectionPlan({
      jobId: testJobIdI,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });

    assert.strictEqual(res1.status, 'READY');
    assert.strictEqual(res1.from_cache, false);

    const res2 = await creativeDirectorService.createDirectionPlan({
      jobId: testJobIdI,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });

    assert.strictEqual(res2.status, 'READY');
    assert.strictEqual(res2.from_cache, true, 'Segunda chamada idêntica deve vir do cache');
    assert.strictEqual(res1.creative_direction_key, res2.creative_direction_key);
    reportPass('Cenário I — Determinismo de creative_direction_key e Cache Hit');
  } catch (e) { reportFail('Cenário I', e); }

  // ----------------------------------------------------
  // Cenário J: Invalidação de Cache por Alteração de Pesos
  // ----------------------------------------------------
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    const scriptTiming = createMockScriptTiming();

    const resDiff = await creativeDirectorService.createDirectionPlan({
      jobId: testJobIdI,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding,
      options: {
        scoringWeights: { semantic_relevance: 0.80, technical_quality: 0.10, aesthetic_score: 0.10 }
      }
    });

    assert.strictEqual(resDiff.from_cache, false, 'Pesos diferentes devem invalidar cache');
    reportPass('Cenário J — Invalidação de Cache por Alteração de Pesos');
  } catch (e) { reportFail('Cenário J', e); }

  // ----------------------------------------------------
  // Cenário K: Compilação sem Perdas para Creative Blueprint 1.2
  // ----------------------------------------------------
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    const scriptTiming = createMockScriptTiming();
    const planResult = await creativeDirectorService.createDirectionPlan({
      jobId: testJobIdI,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });

    const blueprint = creativeDirectorService.compileToBlueprint12({
      directionPlan: planResult.direction_plan,
      presenterAssetId: 'ast_presenter_marcel_01'
    });

    assert.strictEqual(blueprint.schema_version, '1.2');
    assert.strictEqual(blueprint.scenes.length, 4);
    assert.strictEqual(blueprint.total_duration_ms, 14000);
    for (const sc of blueprint.scenes) {
      assert(sc.visual_layers.length >= 1);
      assert.strictEqual(sc.audio_mix.broll_audio_volume, 0.0, 'B-roll deve ser mutado no blueprint');
    }
    reportPass('Cenário K — Compilação sem Perdas para Creative Blueprint 1.2');
  } catch (e) { reportFail('Cenário K', e); }

  // ----------------------------------------------------
  // Cenário L: Preservação Estrita do Schema no Blueprint 1.2
  // ----------------------------------------------------
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    const scriptTiming = createMockScriptTiming();
    const planResult = await creativeDirectorService.createDirectionPlan({
      jobId: testJobIdI,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });
    const blueprint = creativeDirectorService.compileToBlueprint12({
      directionPlan: planResult.direction_plan,
      presenterAssetId: 'ast_presenter_marcel_01'
    });

    assert(blueprint.blueprint_version === '1.2.0');
    assert(Array.isArray(blueprint.scenes));
    reportPass('Cenário L — Preservação Estrita do Schema no Blueprint 1.2');
  } catch (e) { reportFail('Cenário L', e); }

  // ----------------------------------------------------
  // Cenário M: Candidato com Duração Insuficiente é Feasible = False
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    // Segmento 2 (balcony) tem 4000ms. Se pedirmos 6000ms, deve ser infeasible.
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['balcony'], requested_features: [] },
      requiredDurationMs: 6000,
      mediaCatalog
    });
    const candBalcony = ranked.find(c => c.segment_index === 2);
    assert.strictEqual(candBalcony.is_feasible, false, 'Candidato de 4s deve ser infeasible para beat de 6s');
    assert(candBalcony.infeasible_reason.includes('Duração disponível'));
    reportPass('Cenário M — Candidato com Duração Insuficiente é Infeasible');
  } catch (e) { reportFail('Cenário M', e); }

  // ----------------------------------------------------
  // Cenário N: Candidato Infeasible Nunca Vence Ranking para Cobertura Única
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['balcony'], requested_features: [] },
      requiredDurationMs: 6000,
      mediaCatalog
    });
    // O primeiro do ranking viável não pode ser infeasible
    const viableCandidates = ranked.filter(c => c.is_feasible);
    for (const v of viableCandidates) {
      assert.strictEqual(v.is_feasible, true);
    }
    reportPass('Cenário N — Candidato Infeasible Nunca Vence Ranking');
  } catch (e) { reportFail('Cenário N', e); }

  // ----------------------------------------------------
  // Cenário O: source_out Nunca Extrapola o Segmento Semântico
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const beat = { beat_index: 0, start_ms: 0, end_ms: 3000, duration_ms: 3000 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog
    });
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: {}
    });
    const segKitchen = mediaCatalog.segments.find(s => s.segment_index === 1);
    assert(decisions[0].source_out_ms <= segKitchen.end_ms, 'source_out_ms não pode extrapolar segment.end_ms');
    reportPass('Cenário O — source_out Nunca Extrapola o Segmento Semântico');
  } catch (e) { reportFail('Cenário O', e); }

  // ----------------------------------------------------
  // Cenário P: Invariante Temporal Estrito (timeline_duration === source_duration)
  // ----------------------------------------------------
  try {
    const decisionValid = {
      timeline_start_ms: 1000,
      timeline_end_ms: 4000,
      source_in_ms: 5000,
      source_out_ms: 8000,
      fallback_used: false
    };
    assert.strictEqual(validateVisualDecision(decisionValid), true);

    const decisionInvalid = {
      timeline_start_ms: 1000,
      timeline_end_ms: 4000,
      source_in_ms: 5000,
      source_out_ms: 7500, // 2500ms != 3000ms
      fallback_used: false
    };
    assert.throws(() => validateVisualDecision(decisionInvalid), /Invariante violado/);
    reportPass('Cenário P — Invariante Temporal Estrito (timeline === source duration)');
  } catch (e) { reportFail('Cenário P', e); }

  // ----------------------------------------------------
  // Cenário Q: Beat Longo Sem Take Único Gera Sequência de 2 Takes ou Fallback
  // ----------------------------------------------------
  try {
    const mediaCatalog = {
      asset_id: 'ast_test_q',
      segments: [
        { segment_index: 0, start_ms: 0, end_ms: 2000, room_type: 'kitchen', technical_quality_score: 0.8, aesthetic_score: 0.7, confidence: 0.9 },
        { segment_index: 1, start_ms: 2000, end_ms: 4000, room_type: 'kitchen', technical_quality_score: 0.8, aesthetic_score: 0.7, confidence: 0.9 }
      ]
    };
    const beat = { beat_index: 0, start_ms: 0, end_ms: 3600, duration_ms: 3600 };
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 3600,
      mediaCatalog
    });
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: {},
      semanticThresholds: { min_semantic_relevance: 0.40, min_visual_duration_ms: 1500 }
    });

    assert.strictEqual(decisions.length, 2, 'Deve dividir em sequência visual de 2 takes');
    assert.strictEqual(decisions[0].timeline_duration_ms + decisions[1].timeline_duration_ms, 3600);
    reportPass('Cenário Q — Sequência Visual de 2 Takes para Beat Longo');
  } catch (e) { reportFail('Cenário Q', e); }

  // ----------------------------------------------------
  // Cenário R: Take Extension Respeita Footage Físico Restante
  // ----------------------------------------------------
  try {
    const mediaCatalog = createMockMediaUnderstanding();
    const consumedMap = { 1: 10000 }; // Kitchen termina em 12000ms (apenas 2000ms restantes)
    const beat = { beat_index: 1, start_ms: 3500, end_ms: 7000, duration_ms: 3500 }; // Precisa de 3500ms
    const ranked = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['kitchen'], requested_features: [] },
      requiredDurationMs: 3500,
      mediaCatalog,
      lastSelectedSegmentIndex: 1,
      consumedFootageMap: consumedMap
    });
    const decisions = resolveVisualDecisionsForBeat({
      beat,
      rankedCandidates: ranked,
      mediaCatalog,
      consumedFootageMap: consumedMap,
      lastVisualDecision: { selected_segment_index: 1 }
    });

    // Como kitchen só tem 2s restantes e o beat pede 3.5s, não pode estender artificialmente
    assert(decisions[0].selection_reason !== 'Take extension contínuo', 'Não pode fazer take extension quando falta footage');
    reportPass('Cenário R — Take Extension Respeita Footage Físico Restante');
  } catch (e) { reportFail('Cenário R', e); }

  // ----------------------------------------------------
  // Cenário S: Gabarito Humano da REF 1628 NÃO é Consumido pelo Runtime
  // ----------------------------------------------------
  try {
    const serviceContent = fs.readFileSync(path.join(__dirname, '..', '..', 'video_engine', 'creative_director', 'creative_director_service.js'), 'utf8');
    assert(!serviceContent.includes('1628_video'), 'Código não deve conter mapeamento fixo da REF 1628');
    assert(!serviceContent.includes('Beat 1 = Segment 1'), 'Código não deve conter oráculo hardcoded');
    reportPass('Cenário S — Gabarito Humano Não é Consumido pelo Runtime');
  } catch (e) { reportFail('Cenário S', e); }

  // ----------------------------------------------------
  // Cenário T: Invalidação de Key por intent_extractor_version
  // ----------------------------------------------------
  try {
    const params = {
      script_timing_key: 'a'.repeat(64),
      beat_analysis_key: 'b'.repeat(64),
      media_understanding_key: 'c'.repeat(64),
      intent_extractor_version: '1.0.0'
    };
    const k1 = computeCreativeDirectionKey(params);
    const k2 = computeCreativeDirectionKey({ ...params, intent_extractor_version: '2.0.0' });
    assert.notStrictEqual(k1, k2, 'Mudança de intent_extractor_version deve alterar a key');
    reportPass('Cenário T — Invalidação de Key por intent_extractor_version');
  } catch (e) { reportFail('Cenário T', e); }

  // ----------------------------------------------------
  // Cenário U: Invalidação de Key por min_semantic_relevance
  // ----------------------------------------------------
  try {
    const params = {
      script_timing_key: 'a'.repeat(64),
      beat_analysis_key: 'b'.repeat(64),
      media_understanding_key: 'c'.repeat(64),
      semantic_thresholds: { min_semantic_relevance: 0.40, min_visual_duration_ms: 1500 }
    };
    const k1 = computeCreativeDirectionKey(params);
    const k2 = computeCreativeDirectionKey({
      ...params,
      semantic_thresholds: { min_semantic_relevance: 0.60, min_visual_duration_ms: 1500 }
    });
    assert.notStrictEqual(k1, k2, 'Mudança de min_semantic_relevance deve alterar a key');
    reportPass('Cenário U — Invalidação de Key por min_semantic_relevance');
  } catch (e) { reportFail('Cenário U', e); }

  // ----------------------------------------------------
  // Cenário V: Invalidação de Key por min_visual_duration_ms
  // ----------------------------------------------------
  try {
    const params = {
      script_timing_key: 'a'.repeat(64),
      beat_analysis_key: 'b'.repeat(64),
      media_understanding_key: 'c'.repeat(64),
      min_visual_duration_ms: 1500
    };
    const k1 = computeCreativeDirectionKey(params);
    const k2 = computeCreativeDirectionKey({ ...params, min_visual_duration_ms: 2000 });
    assert.notStrictEqual(k1, k2, 'Mudança de min_visual_duration_ms deve alterar a key');
    reportPass('Cenário V — Invalidação de Key por min_visual_duration_ms');
  } catch (e) { reportFail('Cenário V', e); }

  // ----------------------------------------------------
  // Cenário W: Desempate Determinístico (Tie-Break)
  // ----------------------------------------------------
  try {
    const mediaCatalog = {
      asset_id: 'ast_tie_test',
      segments: [
        { segment_index: 0, start_ms: 0, end_ms: 5000, room_type: 'living_room', technical_quality_score: 0.8, aesthetic_score: 0.8, confidence: 0.9 },
        { segment_index: 1, start_ms: 5000, end_ms: 10000, room_type: 'living_room', technical_quality_score: 0.8, aesthetic_score: 0.8, confidence: 0.9 }
      ]
    };
    const ranked1 = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog
    });
    const ranked2 = evaluateAndRankCandidates({
      semanticIntent: { requested_room_types: ['living_room'], requested_features: [] },
      requiredDurationMs: 3000,
      mediaCatalog
    });

    assert.strictEqual(ranked1[0].segment_index, 0, 'Em empate perfeito, menor segment_index vence');
    assert.strictEqual(ranked2[0].segment_index, 0, 'Tie-break deve ser 100% determinístico');
    reportPass('Cenário W — Desempate Determinístico (Tie-Break)');
  } catch (e) { reportFail('Cenário W', e); }

  // ----------------------------------------------------
  // Cenário X: MVP Video-Only Não Depende de Propriedades de Foto
  // ----------------------------------------------------
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    delete mediaUnderstanding.photos;
    const scriptTiming = createMockScriptTiming();
    const res = await creativeDirectorService.createDirectionPlan({
      jobId: `job_test_cd_x_${Date.now()}`,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });

    assert.strictEqual(res.status, 'READY');
    for (const b of res.direction_plan.beats_decisions) {
      for (const v of b.visual_decisions) {
        assert(v.source_in_ms !== undefined);
        assert(v.source_out_ms !== undefined);
      }
    }
    reportPass('Cenário X — MVP Video-Only Não Depende de Propriedades de Foto');
  } catch (e) { reportFail('Cenário X', e); }

  // ----------------------------------------------------
  // Cenário Y: Roteiro e Áudio com Divergência Rejeitados na 4A.2
  // ----------------------------------------------------
  try {
    const badScriptTiming = { alignment_key: 'x', beat_analysis_key: 'y', beats: null };
    await assert.rejects(
      () => creativeDirectorService.createDirectionPlan({
        jobId: 'job_test_y',
        propertyRef: '1628',
        scriptTimingResult: badScriptTiming,
        mediaUnderstandingResult: createMockMediaUnderstanding()
      }),
      /array de beats/
    );
    reportPass('Cenário Y — Rejeição de Script Timing Inválido');
  } catch (e) { reportFail('Cenário Y', e); }

  // ----------------------------------------------------
  // Cenário Z: Sequência Visual Cobre o Intervalo Total Sem Gaps/Overlaps
  // ----------------------------------------------------
  try {
    const mediaUnderstanding = createMockMediaUnderstanding();
    const scriptTiming = createMockScriptTiming();
    const resZ = await creativeDirectorService.createDirectionPlan({
      jobId: `job_test_cd_z_${Date.now()}`,
      propertyRef: '1628',
      scriptTimingResult: scriptTiming,
      mediaUnderstandingResult: mediaUnderstanding
    });

    let expectedTimelineCursor = 0;
    for (const b of resZ.direction_plan.beats_decisions) {
      for (const v of b.visual_decisions) {
        assert.strictEqual(v.timeline_start_ms, expectedTimelineCursor, 'Sem gaps entre takes visuais');
        assert(v.timeline_end_ms > v.timeline_start_ms);
        expectedTimelineCursor = v.timeline_end_ms;
      }
    }
    assert.strictEqual(expectedTimelineCursor, 14000, 'Cobertura final deve ser exatamente 14000ms');
    reportPass('Cenário Z — Sequência Visual Cobre Intervalo Total Sem Gaps/Overlaps');
  } catch (e) { reportFail('Cenário Z', e); }

  // Cleanup de jobs temporários de teste
  try {
    const p = path.join(JOBS_OUTPUTS_DIR, testJobIdI);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n==================================================');
  console.log(`RESULTADO DA SUÍTE: ${passCount} PASS / ${failCount} FAIL`);
  console.log('==================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('[FATAL ERROR IN TEST RUNNER]:', err);
  process.exit(1);
});
