/**
 * Suíte de Testes Unitários — EditorialPlanCompiler (Fase 6 — Passo 6A)
 * Bali Imóveis
 * 
 * Cenários Testados:
 * A. HOLD preserva visual anterior across boundaries.
 * B. SWITCH resolve nova mídia via Phase 4C.
 * C. EVOLVE encerra/adiciona overlay sem trocar fonte visual base.
 * D. Missing external media gera unresolved_requirements sem quebrar compilação.
 * E. Missing advanced financial card degrada para capability existente.
 * F. CASE_01 compila para Blueprint 1.2 válido (0 a 52680ms) e passa 100% na validação do Composer V3.
 */

const fs = require('fs');
const path = require('path');
const { EditorialPlanCompiler } = require('../../video_engine/editorial_plan_compiler');
const composerService = require('../../video_engine/composer_service');

let passedTests = 0;
let failedTests = 0;
const testResults = [];

function assert(condition, message) {
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
    testResults.push({ status: 'PASS', message });
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    testResults.push({ status: 'FAIL', message });
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🏁 INICIANDO TESTES DO EDITORIAL PLAN COMPILER (FASE 6A)');
  console.log('===============================================================');

  const compiler = new EditorialPlanCompiler();
  const presenterId = 'ast_presenter_marcel_01';

  const mockCatalog = {
    property_ref: 'REF_JULIA_TEST',
    video_assets: [
      {
        asset_id: 'ast_vid_living_01',
        physical_file_hash: 'hash_living_123',
        segments: [
          {
            segment_index: 0,
            start_ms: 0,
            end_ms: 10000,
            room_type: 'living_room',
            features: ['integrated_living', 'spacious'],
            technical_quality_score: 0.90,
            aesthetic_score: 0.85,
            confidence: 0.95
          }
        ]
      },
      {
        asset_id: 'ast_vid_balcony_01',
        physical_file_hash: 'hash_balcony_123',
        segments: [
          {
            segment_index: 0,
            start_ms: 0,
            end_ms: 8000,
            room_type: 'balcony',
            features: ['barbecue', 'gourmet'],
            technical_quality_score: 0.92,
            aesthetic_score: 0.88,
            confidence: 0.95
          }
        ]
      }
    ],
    photo_assets: [
      {
        asset_id: 'ast_photo_kitchen_01',
        media_kind: 'photo',
        semantic: {
          primary_room_type: 'kitchen',
          secondary_room_types: ['living_room'],
          features: ['cabinetry', 'modern'],
          technical_quality_score: 0.90,
          aesthetic_score: 0.85
        }
      },
      {
        asset_id: 'ast_photo_suite_01',
        media_kind: 'photo',
        semantic: {
          primary_room_type: 'suite',
          secondary_room_types: ['bedroom'],
          features: ['bathroom', 'spacious'],
          technical_quality_score: 0.91,
          aesthetic_score: 0.87
        }
      }
    ]
  };

  // -------------------------------------------------------------
  // TEST A: HOLD preserva visual anterior across boundaries
  // -------------------------------------------------------------
  console.log('\n--- Test A: HOLD Preserves Previous Visual ---');
  const planHold = {
    case_id: 'TEST_HOLD',
    plan_units: [
      {
        beat_id: 'BEAT_01',
        time_range_source: '00:00.000 - 00:05.000',
        state_decision: 'HOLD',
        source_strategy: 'PRESENTER',
        graphic_intent: 'NONE'
      },
      {
        beat_id: 'BEAT_02',
        time_range_source: '00:05.000 - 00:09.000',
        state_decision: 'SWITCH',
        source_strategy: 'PROPERTY',
        subjects: ['living_room'],
        graphic_intent: 'NONE'
      },
      {
        beat_id: 'BEAT_03',
        time_range_source: '00:09.000 - 00:12.000',
        state_decision: 'HOLD',
        source_strategy: 'CURRENT_STATE',
        subjects: ['living_room'],
        graphic_intent: 'NONE'
      }
    ]
  };

  const bpA = compiler.compile({
    editorialPlan: planHold,
    mediaCatalog: mockCatalog,
    presenterAssetId: presenterId
  });

  assert(bpA.visual_timeline.length === 2, 'Visual timeline deve ter exatamente 2 segmentos (BEAT_01 presenter e BEAT_02+03 living sustentado)');
  assert(bpA.visual_timeline[0].asset_id === presenterId, 'Segmento 1 deve ser o apresentador');
  assert(bpA.visual_timeline[0].end_ms === 5000, 'Segmento 1 deve terminar em 5000ms');
  assert(bpA.visual_timeline[1].asset_id === 'ast_vid_living_01', 'Segmento 2 deve ser o living room');
  assert(bpA.visual_timeline[1].start_ms === 5000 && bpA.visual_timeline[1].end_ms === 12000, 'Segmento 2 deve atravessar BEAT_02 e BEAT_03 cobrindo 5000ms a 12000ms continuamente');

  // -------------------------------------------------------------
  // TEST B: SWITCH resolve nova mídia via Phase 4C
  // -------------------------------------------------------------
  console.log('\n--- Test B: SWITCH Resolves Media via Phase 4C ---');
  const planSwitch = {
    case_id: 'TEST_SWITCH',
    plan_units: [
      {
        beat_id: 'BEAT_01',
        time_range_source: '00:00.000 - 00:04.000',
        state_decision: 'SWITCH',
        source_strategy: 'PROPERTY',
        subjects: ['balcony', 'barbecue'],
        graphic_intent: 'NONE'
      },
      {
        beat_id: 'BEAT_02',
        time_range_source: '00:04.000 - 00:08.000',
        state_decision: 'SWITCH',
        source_strategy: 'PROPERTY',
        subjects: ['kitchen'],
        graphic_intent: 'NONE'
      }
    ]
  };

  const bpB = compiler.compile({
    editorialPlan: planSwitch,
    mediaCatalog: mockCatalog,
    presenterAssetId: presenterId
  });

  assert(bpB.visual_timeline.length === 2, 'Visual timeline deve ter 2 segmentos para 2 SWITCHes');
  assert(bpB.visual_timeline[0].asset_id === 'ast_vid_balcony_01', 'BEAT_01 deve resolver o vídeo da varanda/churrasqueira');
  assert(bpB.visual_timeline[1].asset_id === 'ast_photo_kitchen_01', 'BEAT_02 deve resolver a foto da cozinha');
  assert(bpB.visual_timeline[1].motion === 'ken_burns', 'Foto resolvida deve conter motion: ken_burns');

  // -------------------------------------------------------------
  // TEST C: EVOLVE encerra/adiciona overlay sem trocar visual base
  // -------------------------------------------------------------
  console.log('\n--- Test C: EVOLVE Overlay Life-Cycle without Source Cut ---');
  const planEvolve = {
    case_id: 'TEST_EVOLVE',
    plan_units: [
      {
        beat_id: 'BEAT_01',
        time_range_source: '00:00.000 - 00:05.000',
        state_decision: 'HOLD',
        source_strategy: 'PRESENTER',
        graphic_intent: 'NONE'
      },
      {
        beat_id: 'BEAT_02',
        time_range_source: '00:05.000 - 00:10.000',
        state_decision: 'EVOLVE',
        source_strategy: 'PRESENTER',
        graphic_intent: 'HERO_INFORMATION'
      },
      {
        beat_id: 'BEAT_03',
        time_range_source: '00:10.000 - 00:14.000',
        state_decision: 'EVOLVE',
        source_strategy: 'PRESENTER',
        graphic_intent: 'NONE'
      },
      {
        beat_id: 'BEAT_04',
        time_range_source: '00:14.000 - 00:18.000',
        state_decision: 'EVOLVE',
        source_strategy: 'PRESENTER',
        graphic_intent: 'CTA_SUPPORT'
      }
    ]
  };

  const bpC = compiler.compile({
    editorialPlan: planEvolve,
    mediaCatalog: mockCatalog,
    presenterAssetId: presenterId
  });

  assert(bpC.overlays.length === 2, 'Deve ter exatamente 2 overlays gerados (HERO_INFORMATION e CTA_SUPPORT)');
  assert(bpC.overlays[0].type === 'price_badge' && bpC.overlays[0].start_ms === 5000 && bpC.overlays[0].end_ms === 10000, 'Overlay financeiro ativo apenas em BEAT_02');
  assert(bpC.overlays[1].type === 'cta_banner' && bpC.overlays[1].start_ms === 14000 && bpC.overlays[1].end_ms === 18000, 'Overlay CTA ativo apenas em BEAT_04');

  // -------------------------------------------------------------
  // TEST D: Missing external media gera unresolved sem quebrar
  // -------------------------------------------------------------
  console.log('\n--- Test D: Missing External Media Graceful Degradation ---');
  const planLocation = {
    case_id: 'TEST_LOC',
    plan_units: [
      {
        beat_id: 'BEAT_04',
        time_range_source: '00:00.000 - 00:07.000',
        state_decision: 'SWITCH',
        source_strategy: 'LOCATION',
        location_evidence_intent: 'VERIFIED_EVIDENCE_REQUIRED',
        subjects: ['location_proof', 'shopping', 'highway'],
        graphic_intent: 'LOCATION_SUPPORT'
      }
    ]
  };

  const bpD = compiler.compile({
    editorialPlan: planLocation,
    mediaCatalog: { property_ref: 'EMPTY_POOL', video_assets: [], photo_assets: [] },
    presenterAssetId: presenterId
  });

  assert(bpD.resolution_metadata.unresolved_requirements.length > 0, 'Deve registrar unresolved_requirement para evidência geográfica externa');
  assert(bpD.resolution_metadata.graceful_degradations.length > 0, 'Deve registrar graceful degradation para presenter');
  assert(bpD.visual_timeline.length === 1 && bpD.visual_timeline[0].asset_id === presenterId, 'Deve fazer fallback seguro para apresentador sem quebrar');
  assert(bpD.overlays.length === 1 && bpD.overlays[0].type === 'location_tag', 'Location tag textual deve ser gerada');

  // -------------------------------------------------------------
  // TEST E: Missing advanced financial card degrada para capability existente
  // -------------------------------------------------------------
  console.log('\n--- Test E: Financial Card Graceful Degradation ---');
  const planFin = {
    case_id: 'TEST_FIN',
    plan_units: [
      {
        beat_id: 'BEAT_08',
        time_range_source: '00:00.000 - 00:08.000',
        state_decision: 'SWITCH',
        source_strategy: 'PRESENTER',
        graphic_intent: 'HERO_INFORMATION'
      }
    ]
  };

  const bpE = compiler.compile({
    editorialPlan: planFin,
    mediaCatalog: mockCatalog,
    presenterAssetId: presenterId
  });

  assert(bpE.overlays.length === 1, 'Deve gerar 1 overlay degradado');
  assert(bpE.overlays[0].type === 'price_badge', 'Deve degradar para tipo price_badge existente');
  assert(bpE.resolution_metadata.graceful_degradations.some(d => d.type === 'DESIGN_SYSTEM_DEGRADATION'), 'Deve registrar degradação de design system');

  // -------------------------------------------------------------
  // TEST F: CASE_01 compila para Blueprint 1.2 válido (0-52680ms)
  // -------------------------------------------------------------
  console.log('\n--- Test F: CASE_01 Full Plan Compilation ---');
  const case01PlanPath = path.join(__dirname, '..', '..', 'outputs', 'editorial_plan', 'case_01_editorial_plan_v01.json');
  const case01Plan = JSON.parse(fs.readFileSync(case01PlanPath, 'utf8'));

  const bpF = compiler.compile({
    editorialPlan: case01Plan,
    mediaCatalog: mockCatalog,
    presenterAssetId: presenterId,
    creativeId: 'crv_case01_pilot_test_01'
  });

  assert(bpF.schema_version === '1.2', 'Blueprint deve ter schema_version 1.2');
  assert(bpF.total_duration_ms === 52680, `Total duration deve ser exatamente 52680ms (recebido: ${bpF.total_duration_ms}ms)`);
  assert(bpF.visual_timeline.length > 0, 'Visual timeline deve conter itens');
  assert(bpF.visual_timeline[0].start_ms === 0, 'Timeline deve iniciar em 0ms');
  assert(bpF.visual_timeline[bpF.visual_timeline.length - 1].end_ms === 52680, 'Timeline deve terminar em 52680ms');

  // Validação de ausência de gaps
  for (let i = 1; i < bpF.visual_timeline.length; i++) {
    const prev = bpF.visual_timeline[i - 1];
    const curr = bpF.visual_timeline[i];
    assert(curr.start_ms === prev.end_ms, `Timeline contínua sem gap entre segmento #${i-1} (${prev.end_ms}ms) e #${i} (${curr.start_ms}ms)`);
  }

  // Validação estrita do Contrato pelo Composer V3
  const isComposerValid = composerService.validateBlueprintContract(bpF);
  assert(isComposerValid === true, 'Blueprint 1.2 gerado deve passar 100% na validação estrita do Composer V3 (validateBlueprintContract)');

  // Verificar sustentação do Beat 03 (Hold)
  const traceB2 = bpF.resolution_metadata.resolution_trace.find(t => t.beat_id === 'BEAT_02');
  const traceB3 = bpF.resolution_metadata.resolution_trace.find(t => t.beat_id === 'BEAT_03');
  assert(traceB3.action === 'HOLD_SUSTAIN_PREVIOUS_VISUAL', 'Beat 03 deve executar HOLD_SUSTAIN_PREVIOUS_VISUAL');
  assert(traceB3.selected_asset_id === traceB2.selected_asset_id, 'Beat 03 deve sustentar o mesmo asset do Beat 02');

  console.log('\n===============================================================');
  console.log(`🎉 SUÍTE CONCLUÍDA: ${passedTests} PASSOS COM SUCESSO (${failedTests} FALHAS)`);
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error('Erro na suíte de testes:', err);
  process.exit(1);
});
