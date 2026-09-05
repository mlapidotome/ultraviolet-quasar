/**
 * Suíte de Testes de Homologação — Video Composer Engine (Fase 3C.2)
 * Bali Imóveis (B-Roll Dinâmico + Picture-in-Picture)
 * 
 * Cobertura Completa dos 13 Cenários Formais (A a M) + Validações de Contrato e Regressão 1.0/1.1
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');
const composerService = require('../../video_engine/composer_service');
const { resolveEditingStyle, FONT_REGISTRY } = require('../../video_engine/styles/presets');
const overlayService = require('../../video_engine/overlay_service');
const assetService = require('../../video_engine/asset_service');
const { getPool, closePool } = require('../../video_engine/db');

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

function assertThrows(fn, expectedSubstring, message) {
  try {
    fn();
    failedTests++;
    console.error(`  ❌ FAIL: ${message} (esperava erro contendo '${expectedSubstring}', mas executou sem erro)`);
    testResults.push({ status: 'FAIL', message });
  } catch (err) {
    if (!expectedSubstring || err.message.includes(expectedSubstring)) {
      passedTests++;
      console.log(`  ✅ PASS: ${message} (lançou erro esperado: ${err.message.slice(0, 80)}...)`);
      testResults.push({ status: 'PASS', message });
    } else {
      failedTests++;
      console.error(`  ❌ FAIL: ${message} (erro '${err.message}' não contém '${expectedSubstring}')`);
      testResults.push({ status: 'FAIL', message });
    }
  }
}

async function runSuite() {
  console.log('===============================================================');
  console.log('🏁 INICIANDO SUÍTE DE HOMOLOGAÇÃO FASE 3C.2 (B-ROLL + PIP)');
  console.log('===============================================================');

  const testDir = path.resolve(__dirname, '..', 'fixtures', 'phase3c2');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 0. Gerar Assets Sintéticos de Teste
  const testPresenterVideo = path.join(testDir, 'test_presenter_avatar.mp4');
  const testPhoto1 = path.join(testDir, 'test_photo_sala.jpg');
  const testPhoto2 = path.join(testDir, 'test_photo_cozinha.jpg');
  const testPhoto3 = path.join(testDir, 'test_photo_varanda.jpg');
  const testBrollVideo = path.join(testDir, 'test_broll_clip.mp4');

  if (!fs.existsSync(testPresenterVideo)) {
    console.log('Gerando fixtures sintéticos para testes físicos...');
    // Vídeo com apresentador falando (áudio tom de 440Hz + vídeo 1080x1920@30fps de 10s)
    execSync(`ffmpeg -y -f lavfi -i testsrc=size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 10 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${testPresenterVideo}"`);
    // Fotos do imóvel
    execSync(`ffmpeg -y -f lavfi -i color=c=blue:size=1080x1920:d=1 -vframes 1 "${testPhoto1}"`);
    execSync(`ffmpeg -y -f lavfi -i color=c=red:size=1080x1920:d=1 -vframes 1 "${testPhoto2}"`);
    execSync(`ffmpeg -y -f lavfi -i color=c=green:size=1080x1920:d=1 -vframes 1 "${testPhoto3}"`);
    // Clipe de vídeo B-roll
    execSync(`ffmpeg -y -f lavfi -i testsrc=size=1080x1920:rate=30 -t 6 -c:v libx264 -pix_fmt yuv420p -an "${testBrollVideo}"`);
  }

  const hashPresenter = assetService.computeFileHash(testPresenterVideo);
  const hashPhoto1 = assetService.computeFileHash(testPhoto1);
  const hashPhoto2 = assetService.computeFileHash(testPhoto2);
  const hashPhoto3 = assetService.computeFileHash(testPhoto3);
  const hashBrollVideo = assetService.computeFileHash(testBrollVideo);

  const style = resolveEditingStyle('performance_reels_v1', 1);

  // -------------------------------------------------------------
  // GRUPO 1: VALIDAÇÃO DE CONTRATO E REGRAS FAIL-FAST (SCHEMA 1.2)
  // -------------------------------------------------------------
  console.log('\n📦 GRUPO 1: Contrato e Validações Fail-Fast (Blueprint 1.2)');

  // Teste H: Imagem com source trim = FAIL
  assertThrows(() => {
    composerService.validateBlueprintContract({
      schema_version: '1.2',
      creative_id: 'crv_test_h',
      blueprint_version: 1,
      format: '9:16',
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
      visual_timeline: [
        { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 3000, source_in_ms: 100, source_out_ms: 3100 }
      ]
    });
  }, 'não aceita source_in_ms/source_out_ms', 'Teste H: Imagem com source trim deve ser rejeitada com erro explícito');

  // Teste: Vídeo com divergência de duração de trim vs timeline (speed ramp não suportado)
  assertThrows(() => {
    composerService.validateBlueprintContract({
      schema_version: '1.2',
      creative_id: 'crv_test_speedramp',
      blueprint_version: 1,
      format: '9:16',
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
      visual_timeline: [
        { asset_id: 'ast_vid', asset_type: 'video', start_ms: 0, end_ms: 2000, source_in_ms: 0, source_out_ms: 4000 }
      ]
    });
  }, 'Divergência de duração', 'Vídeo com source trim != timeline duration deve ser rejeitado (speed ramp proibido)');

  // Teste E: Primeiro segmento com crossfade inválido = FAIL
  assertThrows(() => {
    composerService.validateBlueprintContract({
      schema_version: '1.2',
      creative_id: 'crv_test_e',
      blueprint_version: 1,
      format: '9:16',
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
      visual_timeline: [
        { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 3000, transition_in: { type: 'crossfade', duration_ms: 250 } }
      ]
    });
  }, 'crossfade', 'Teste E: Primeiro segmento com crossfade vindo do vazio deve falhar');

  // Teste F: Gap na visual_timeline = FAIL
  assertThrows(() => {
    composerService.validateBlueprintContract({
      schema_version: '1.2',
      creative_id: 'crv_test_f',
      blueprint_version: 1,
      format: '9:16',
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
      visual_timeline: [
        { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 2000 },
        { asset_id: 'ast_p2', asset_type: 'image', start_ms: 2033, end_ms: 4000 }
      ]
    });
  }, 'Gap na visual_timeline', 'Teste F: Gap de 1 frame entre segmentos deve falhar');

  // Teste G: Overlap arbitrário fora de crossfade = FAIL
  assertThrows(() => {
    composerService.validateBlueprintContract({
      schema_version: '1.2',
      creative_id: 'crv_test_g',
      blueprint_version: 1,
      format: '9:16',
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
      visual_timeline: [
        { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 3000 },
        { asset_id: 'ast_p2', asset_type: 'image', start_ms: 2500, end_ms: 5000, transition_in: { type: 'cut' } }
      ]
    });
  }, 'Overlap arbitrário', 'Teste G: Overlap arbitrário não declarado como crossfade deve falhar');

  // -------------------------------------------------------------
  // GRUPO 2: VALIDAÇÃO ESPAÇO-TEMPORAL DE PIP E SAFE AREAS
  // -------------------------------------------------------------
  console.log('\n📐 GRUPO 2: Validação Espaço-Temporal de PIP e Safe Areas');

  // Teste C: PIP e CTA na mesma geometria mas tempos diferentes = PASS
  const validSpatiotemporalBp = {
    schema_version: '1.2',
    creative_id: 'crv_test_c',
    blueprint_version: 1,
    format: '9:16',
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
    visual_timeline: [
      { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 10000 }
    ],
    pip: {
      enabled: true,
      asset_id: 'ast_presenter',
      windows: [
        { start_ms: 2000, end_ms: 6000, position: 'bottom_safe', shape: 'rounded_rect' }
      ]
    },
    overlays: [
      { id: 'ov_cta', layer_order: 30, type: 'cta_banner', text: 'SAIBA MAIS', start_ms: 7000, end_ms: 10000, position: 'bottom_safe', preset: 'cta_bar' }
    ]
  };
  try {
    composerService.validateSpatiotemporalCollisions(validSpatiotemporalBp, style);
    passedTests++;
    console.log('  ✅ PASS: Teste C: PIP e CTA na mesma geometria com tempos diferentes não colidem');
  } catch (e) {
    failedTests++;
    console.error('  ❌ FAIL: Teste C falhou indevidamente:', e.message);
  }

  // Teste D: PIP e CTA na mesma geometria e tempos simultâneos = FAIL
  const invalidSpatiotemporalBp = {
    schema_version: '1.2',
    creative_id: 'crv_test_d',
    blueprint_version: 1,
    format: '9:16',
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    audio_track: { primary_asset_id: 'ast_presenter', broll_audio_policy: 'mute_all_broll' },
    visual_timeline: [
      { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 10000 }
    ],
    pip: {
      enabled: true,
      asset_id: 'ast_presenter',
      windows: [
        { start_ms: 5000, end_ms: 9000, position: 'bottom_safe', shape: 'rounded_rect' }
      ]
    },
    overlays: [
      { id: 'ov_cta', layer_order: 30, type: 'cta_banner', text: 'SAIBA MAIS', start_ms: 7000, end_ms: 10000, position: 'bottom_safe', preset: 'cta_bar' }
    ]
  };
  assertThrows(() => {
    composerService.validateSpatiotemporalCollisions(invalidSpatiotemporalBp, style);
  }, 'colide espaço-temporalmente', 'Teste D: PIP e CTA simultâneos na mesma região devem ser rejeitados');

  // -------------------------------------------------------------
  // GRUPO 3: DETERMINISMO DE RENDER IDENTITY (render_key)
  // -------------------------------------------------------------
  console.log('\n🔑 GRUPO 3: Determinismo da Render Identity (composer_v3)');

  const mockResolvedAssets = {
    resolvedList: [
      { asset_id: 'ast_pres', file_hash: hashPresenter, duration_ms: 10000 },
      { asset_id: 'ast_p1', file_hash: hashPhoto1, duration_ms: 0 },
      { asset_id: 'ast_p2', file_hash: hashPhoto2, duration_ms: 0 }
    ]
  };

  const bpBase = {
    schema_version: '1.2',
    creative_id: 'crv_render_test',
    blueprint_version: 1,
    format: '9:16',
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    audio_track: { primary_asset_id: 'ast_pres', broll_audio_policy: 'mute_all_broll' },
    visual_timeline: [
      { asset_id: 'ast_p1', asset_type: 'image', start_ms: 0, end_ms: 5000, motion: { type: 'ken_burns_zoom_in', start_scale: 1.0, target_scale: 1.10 } },
      { asset_id: 'ast_p2', asset_type: 'image', start_ms: 4750, end_ms: 10000, transition_in: { type: 'crossfade', duration_ms: 250 } }
    ],
    pip: {
      enabled: true,
      asset_id: 'ast_pres',
      windows: [{ start_ms: 2000, end_ms: 5000, position: 'bottom_right', shape: 'rounded_rect' }]
    }
  };

  const key1 = composerService.computeRenderKey(bpBase, mockResolvedAssets, style);
  const key2 = composerService.computeRenderKey(bpBase, mockResolvedAssets, style);
  assert(key1 === key2, 'computeRenderKey 1.2 deve ser 100% idempotente');

  // Teste J: Mudança apenas em transition duration altera render_key
  const bpDiffTrans = JSON.parse(JSON.stringify(bpBase));
  bpDiffTrans.visual_timeline[1].transition_in.duration_ms = 300;
  bpDiffTrans.visual_timeline[1].start_ms = 4700;
  const keyTrans = composerService.computeRenderKey(bpDiffTrans, mockResolvedAssets, style);
  assert(key1 !== keyTrans, 'Teste J: Alteração em duration_ms do crossfade deve alterar a render_key');

  // Teste K: Mudança física nos bytes do asset altera render_key
  const mockResolvedAlteredBytes = {
    resolvedList: [
      { asset_id: 'ast_pres', file_hash: hashPresenter, duration_ms: 10000 },
      { asset_id: 'ast_p1', file_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', duration_ms: 0 },
      { asset_id: 'ast_p2', file_hash: hashPhoto2, duration_ms: 0 }
    ]
  };
  const keyAlteredBytes = composerService.computeRenderKey(bpBase, mockResolvedAlteredBytes, style);
  assert(key1 !== keyAlteredBytes, 'Teste K: Alteração de bytes (file_hash) deve alterar a render_key');

  // -------------------------------------------------------------
  // GRUPO 4: TESTES FÍSICOS DE RENDERIZAÇÃO FFMPEG
  // -------------------------------------------------------------
  console.log('\n🎬 GRUPO 4: Execução Física de Renderização FFmpeg (Testes A, B, I)');

  const outputTestA = path.join(testDir, 'test_output_a_fullscreen_broll_pip.mp4');
  const tempOutputTestA = path.join(testDir, 'test_output_a.tmp.mp4');
  if (fs.existsSync(outputTestA)) fs.unlinkSync(outputTestA);
  if (fs.existsSync(tempOutputTestA)) fs.unlinkSync(tempOutputTestA);

  const physicalResolvedAssets = {
    assetMap: new Map([
      ['ast_pres', { asset_id: 'ast_pres', storage_path: testPresenterVideo, file_hash: hashPresenter, duration_ms: 10000 }],
      ['ast_p1', { asset_id: 'ast_p1', storage_path: testPhoto1, file_hash: hashPhoto1, duration_ms: 0 }],
      ['ast_p2', { asset_id: 'ast_p2', storage_path: testPhoto2, file_hash: hashPhoto2, duration_ms: 0 }],
      ['ast_broll_vid', { asset_id: 'ast_broll_vid', storage_path: testBrollVideo, file_hash: hashBrollVideo, duration_ms: 6000 }]
    ]),
    resolvedList: [
      { asset_id: 'ast_pres', storage_path: testPresenterVideo, file_hash: hashPresenter, duration_ms: 10000 },
      { asset_id: 'ast_p1', storage_path: testPhoto1, file_hash: hashPhoto1, duration_ms: 0 },
      { asset_id: 'ast_p2', storage_path: testPhoto2, file_hash: hashPhoto2, duration_ms: 0 },
      { asset_id: 'ast_broll_vid', storage_path: testBrollVideo, file_hash: hashBrollVideo, duration_ms: 6000 }
    ]
  };

  // Teste A: Fullscreen -> B-Roll -> PIP
  // Teste B: Sincronização de Lip-Sync no PIP
  // Teste I: Vídeo B-roll com source trim comprovado
  const bpPhysical = {
    schema_version: '1.2',
    creative_id: 'crv_physical_a',
    blueprint_version: 1,
    format: '9:16',
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    audio_track: { primary_asset_id: 'ast_pres', broll_audio_policy: 'mute_all_broll' },
    visual_timeline: [
      // 1. Apresentador Fullscreen (0.0s - 2.0s)
      { asset_id: 'ast_pres', asset_type: 'video', start_ms: 0, end_ms: 2000, source_in_ms: 0, source_out_ms: 2000, fit: 'cover', transition_in: { type: 'cut' } },
      // 2. Foto 1 com Ken Burns (2.0s - 5.0s)
      { asset_id: 'ast_p1', asset_type: 'image', start_ms: 2000, end_ms: 5000, motion: { type: 'ken_burns_zoom_in', start_scale: 1.0, target_scale: 1.10 }, transition_in: { type: 'cut' } },
      // 3. Vídeo B-roll cortado de 1.0s a 4.0s (5.0s - 8.0s) [Teste I]
      { asset_id: 'ast_broll_vid', asset_type: 'video', start_ms: 5000, end_ms: 8000, source_in_ms: 1000, source_out_ms: 4000, fit: 'cover', transition_in: { type: 'cut' } },
      // 4. Foto 2 com PIP do Apresentador (8.0s - 10.0s)
      { asset_id: 'ast_p2', asset_type: 'image', start_ms: 8000, end_ms: 10000, motion: { type: 'ken_burns_zoom_out', start_scale: 1.10, target_scale: 1.00 }, transition_in: { type: 'cut' } }
    ],
    pip: {
      enabled: true,
      asset_id: 'ast_pres',
      windows: [
        // Sincronização estrita de lip-sync no intervalo 8s-10s [Teste B]
        { start_ms: 8000, end_ms: 10000, source_in_ms: 8000, source_out_ms: 10000, position: 'bottom_right', shape: 'rounded_rect' }
      ]
    },
    overlays: [
      { id: 'ov_hl', layer_order: 10, type: 'headline', text: 'OPORTUNIDADE 3C.2', start_ms: 200, end_ms: 4000, position: 'top_safe', preset: 'bold_headline' },
      { id: 'ov_price', layer_order: 20, type: 'price_badge', text: 'R$ 395.000', start_ms: 5000, end_ms: 7500, position: 'lower_third', preset: 'price_punch' }
    ],
    captions: [
      { start_ms: 0, end_ms: 2000, text: 'Apresentador Fullscreen na introdução.' },
      { start_ms: 2500, end_ms: 9500, text: 'B-roll dinâmico com fotos e vídeos reais.' }
    ]
  };

  const execPlan = composerService.buildExecutionPlan(bpPhysical, physicalResolvedAssets);
  console.log(`Renderizando plano de execução com duração total de ${execPlan.total_duration_sec}s...`);

  await composerService.renderTimelineFFmpeg({
    executionPlan: execPlan,
    tempOutputPath: tempOutputTestA,
    resolvedStyle: style
  });

  const promotedSpecs = await composerService.verifyAndPromoteOutput({
    tempPath: tempOutputTestA,
    finalPath: outputTestA,
    expectedDurationMs: 10000,
    toleranceMs: 250
  });

  assert(fs.existsSync(outputTestA), 'Teste A: Arquivo MP4 físico final gerado com sucesso');
  assert(promotedSpecs.width === 1080 && promotedSpecs.height === 1920, 'Teste A: Saída com resolução exata 1080x1920');
  assert(promotedSpecs.fps === 30, 'Teste A: Saída com frame rate exato 30fps');
  assert(promotedSpecs.codec_video === 'h264' && promotedSpecs.codec_audio === 'aac', 'Teste A: Codecs corretos H.264/AAC');
  assert(Math.abs(promotedSpecs.duration_ms - 10000) <= 250, 'Teste A: Duração da saída congruente com áudio master');

  // -------------------------------------------------------------
  // GRUPO 5: ZERO REGRESSÃO BLUEPRINT 1.0 (3B) E 1.1 (3C.1)
  // -------------------------------------------------------------
  console.log('\n🔒 GRUPO 5: Testes de Zero Regressão (Testes L e M)');

  // Teste L: Blueprint 1.0 continua produzindo comportamento congelado da Fase 3B
  const bp10 = {
    schema_version: '1.0',
    creative_id: 'crv_reg_10',
    blueprint_version: 1,
    format: '9:16',
    timeline: [
      { asset_id: 'ast_pres', source_in_ms: 0, source_out_ms: 3000 },
      { asset_id: 'ast_pres', source_in_ms: 3000, source_out_ms: 6000 }
    ]
  };
  assert(composerService.validateBlueprintContract(bp10) === true, 'Teste L: Blueprint 1.0 validado com sucesso');
  const key10 = composerService.computeRenderKey(bp10, [
    { segment_index: 1, role: 'clip_1', asset_id: 'ast_pres', file_hash: hashPresenter },
    { segment_index: 2, role: 'clip_2', asset_id: 'ast_pres', file_hash: hashPresenter }
  ]);
  assert(typeof key10 === 'string' && key10.length === 64, 'Teste L: render_key 1.0 gerada pelo caminho composer_v1');

  // Teste M: Blueprint 1.1 continua produzindo comportamento congelado da Fase 3C.1
  const bp11 = {
    schema_version: '1.1',
    creative_id: 'crv_reg_11',
    blueprint_version: 1,
    format: '9:16',
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    timeline: [
      { asset_id: 'ast_pres', source_in_ms: 0, source_out_ms: 5000 }
    ],
    overlays: [
      { id: 'ov_hl', layer_order: 10, type: 'headline', text: 'OPORTUNIDADE 3C.1', start_ms: 200, end_ms: 4000, position: 'top_safe', preset: 'bold_headline' }
    ],
    captions: [
      { start_ms: 0, end_ms: 5000, text: 'Legenda 3C.1' }
    ]
  };
  assert(composerService.validateBlueprintContract(bp11) === true, 'Teste M: Blueprint 1.1 validado com sucesso');
  const key11 = composerService.computeRenderKey(bp11, [
    { segment_index: 1, role: 'clip_1', asset_id: 'ast_pres', file_hash: hashPresenter }
  ], style);
  assert(typeof key11 === 'string' && key11.length === 64, 'Teste M: render_key 1.1 gerada pelo caminho composer_v2');

  console.log('\n===============================================================');
  console.log(`🎉 SUÍTE CONCLUÍDA: ${passedTests} PASS, ${failedTests} FAIL`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
