/**
 * Suíte de Testes Formais: Media Understanding (Fase 4A.1)
 * Cenários A a AC
 * Bali Imóveis
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { getPool } = require('../../video_engine/db');
const mediaUnderstandingService = require('../../video_engine/media_understanding/media_understanding_service');
const {
  ALLOWED_ROOM_TYPES,
  ALLOWED_FEATURES,
  validateFrameSampleResult,
  computeAnalysisKey
} = require('../../video_engine/media_understanding/analysis_schema');
const MockMediaUnderstandingProvider = require('../../video_engine/media_understanding/providers/mock_media_understanding_provider');
const { segmentContinuousTour } = require('../../video_engine/media_understanding/semantic_segmenter');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');
const PROPERTIES_OUTPUTS_DIR = path.join(OUTPUTS_BASE_DIR, 'properties');

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

// Criação de vídeo MP4 sintético para testes
async function createDummyVideo(targetPath, durationSec = 6) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { execFile } = require('child_process');
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc=duration=${durationSec}:size=320x240:rate=30`,
      '-f', 'lavfi',
      '-i', `sine=frequency=1000:duration=${durationSec}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      targetPath
    ], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
  return { fileHash, durationSec, durationMs: durationSec * 1000 };
}

async function runSuite() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE FORMAL: MEDIA UNDERSTANDING 4A.1 (Cenários A a AC)');
  console.log('================================================================\n');

  const pool = getPool();
  const testRef = `ref_mu_test_${Date.now()}`;
  const testPropDir = path.join(PROPERTIES_OUTPUTS_DIR, testRef, 'videos');
  const dummyVideoPath = path.join(testPropDir, `test_video_${testRef}.mp4`);

  const { fileHash, durationMs } = await createDummyVideo(dummyVideoPath, 6);

  // Inserir registro READY na tabela video_assets para a testRef
  const assetId = `ast_pvid_${testRef}`;
  await pool.query(
    `INSERT INTO video_assets (
       id, property_ref, asset_type, storage_type, storage_path, file_hash,
       generation_key, status, specs, metadata, created_at, updated_at
     ) VALUES ($1, $2, 'property_video', 'local_file', $3, $4, $5, 'ready', $6, '{}'::jsonb, NOW(), NOW())`,
    [
      assetId,
      testRef,
      dummyVideoPath,
      fileHash,
      `gen_key_${testRef}`,
      JSON.stringify({ duration_sec: 6, duration_ms: durationMs, width: 320, height: 240, fps: 30 })
    ]
  );

  // Cenário A: property_video READY válido é aceito
  try {
    const mockProvider = new MockMediaUnderstandingProvider({ defaultRoom: 'living_room' });
    const res = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_v1',
      sampleIntervalMs: 1500
    });
    assert.strictEqual(res.status, 'READY');
    assert.strictEqual(res.analysis.property_ref, testRef);
    assert.strictEqual(res.analysis.physical_file_hash, fileHash);
    assert.ok(res.analysis.segments.length > 0);
    reportPass('Cenário A: property_video READY válido é aceito e analisado');
  } catch (err) {
    reportFail('Cenário A', err);
  }

  // Cenário B: asset inexistente ou não-READY é rejeitado
  try {
    await assert.rejects(
      async () => {
        await mediaUnderstandingService.analyzePropertyVideo('ref_non_existent_999999');
      },
      /encontrado no pool/i
    );
    reportPass('Cenário B: REF sem vídeo READY é rejeitada com erro explícito');
  } catch (err) {
    reportFail('Cenário B', err);
  }

  // Cenário C: file_hash divergente é rejeitado
  try {
    const badRef = `ref_bad_hash_${Date.now()}`;
    const badPropDir = path.join(PROPERTIES_OUTPUTS_DIR, badRef, 'videos');
    const badVideoPath = path.join(badPropDir, `bad_video_${badRef}.mp4`);
    await createDummyVideo(badVideoPath, 2);

    await pool.query(
      `INSERT INTO video_assets (
         id, property_ref, asset_type, storage_type, storage_path, file_hash,
         generation_key, status, specs, metadata, created_at, updated_at
       ) VALUES ($1, $2, 'property_video', 'local_file', $3, 'wrong_hash_00000000000000000000000000000000', $4, 'ready', $5, '{}'::jsonb, NOW(), NOW())`,
      [`ast_${badRef}`, badRef, badVideoPath, `gen_${badRef}`, JSON.stringify({ duration_sec: 2, duration_ms: 2000 })]
    );

    await assert.rejects(
      async () => {
        await mediaUnderstandingService.analyzePropertyVideo(badRef);
      },
      /Divergência de file_hash|encontrado no pool/i
    );
    reportPass('Cenário C: Vídeo com file_hash corrompido é rejeitado');
  } catch (err) {
    reportFail('Cenário C', err);
  }

  // Cenário D: analysis_key é determinística
  try {
    const k1 = computeAnalysisKey({
      physical_file_hash: 'abc123hash',
      analyzer_type: 'vlm_test',
      analyzer_version: '1.0.0',
      model_id: 'gpt-4o-mini',
      prompt_version: 'p1',
      schema_version: '1.0.0',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    const k2 = computeAnalysisKey({
      physical_file_hash: 'abc123hash',
      analyzer_type: 'vlm_test',
      analyzer_version: '1.0.0',
      model_id: 'gpt-4o-mini',
      prompt_version: 'p1',
      schema_version: '1.0.0',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    assert.strictEqual(k1, k2);
    assert.strictEqual(k1.length, 64);
    reportPass('Cenário D: analysis_key é 100% determinística via canonical hash');
  } catch (err) {
    reportFail('Cenário D', err);
  }

  // Cenário E: mudança de analyzer_version altera analysis_key
  try {
    const k1 = computeAnalysisKey({ physical_file_hash: 'h1', analyzer_version: '1.0.0', model_id: 'm1' });
    const k2 = computeAnalysisKey({ physical_file_hash: 'h1', analyzer_version: '1.1.0', model_id: 'm1' });
    assert.notStrictEqual(k1, k2);
    reportPass('Cenário E: Alteração de analyzer_version gera nova analysis_key');
  } catch (err) {
    reportFail('Cenário E', err);
  }

  // Cenário F: mudança de prompt_version altera analysis_key
  try {
    const k1 = computeAnalysisKey({ physical_file_hash: 'h1', prompt_version: 'v1', model_id: 'm1' });
    const k2 = computeAnalysisKey({ physical_file_hash: 'h1', prompt_version: 'v2', model_id: 'm1' });
    assert.notStrictEqual(k1, k2);
    reportPass('Cenário F: Alteração de prompt_version gera nova analysis_key');
  } catch (err) {
    reportFail('Cenário F', err);
  }

  // Cenário G: Segunda execução gera cache hit sem chamar provider
  try {
    const mockProvider = new MockMediaUnderstandingProvider({ defaultRoom: 'kitchen' });
    const res1 = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_cache_test',
      sampleIntervalMs: 1500
    });
    const callsAfterFirst = mockProvider.callsCount;

    const res2 = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_cache_test',
      sampleIntervalMs: 1500
    });

    assert.strictEqual(res2.source, 'cache_hit');
    assert.strictEqual(mockProvider.callsCount, callsAfterFirst, 'Provider não deve ser chamado no cache hit');
    assert.deepStrictEqual(res1.analysis.segments, res2.analysis.segments);
    reportPass('Cenário G: Cache Hit reutiliza análise sem nenhuma chamada ao provider');
  } catch (err) {
    reportFail('Cenário G', err);
  }

  // Cenário H: Provider retorna room_type inválido -> Rejeitado
  try {
    assert.throws(
      () => {
        validateFrameSampleResult({
          room_type: 'invalid_spaceship_room',
          technical_quality_score: 0.8,
          confidence: 0.9
        });
      },
      /room_type inválido/
    );
    reportPass('Cenário H: room_type fora da taxonomia oficial é rejeitado com fail-fast');
  } catch (err) {
    reportFail('Cenário H', err);
  }

  // Cenário I: Provider retorna score fora dos limites [0, 1] -> Rejeitado
  try {
    assert.throws(
      () => {
        validateFrameSampleResult({
          room_type: 'living_room',
          technical_quality_score: 1.5,
          confidence: 0.9
        });
      },
      /technical_quality_score fora dos limites/
    );
    assert.throws(
      () => {
        validateFrameSampleResult({
          room_type: 'living_room',
          confidence: -0.2
        });
      },
      /confidence fora dos limites/
    );
    reportPass('Cenário I: Scores fora do intervalo [0.0, 1.0] são rejeitados');
  } catch (err) {
    reportFail('Cenário I', err);
  }

  // Cenário J: Continuous tour sem cuts produz múltiplos segmentos semânticos
  try {
    const continuousSamples = [
      { timestamp_ms: 0, room_type: 'living_room', features: ['natural_lighting'], technical_quality_score: 0.8, aesthetic_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 1200, room_type: 'living_room', features: ['natural_lighting'], technical_quality_score: 0.85, aesthetic_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 2400, room_type: 'kitchen', features: ['planned_cabinets'], technical_quality_score: 0.9, aesthetic_score: 0.85, confidence: 0.95 },
      { timestamp_ms: 3600, room_type: 'kitchen', features: ['planned_cabinets'], technical_quality_score: 0.88, aesthetic_score: 0.85, confidence: 0.95 },
      { timestamp_ms: 4800, room_type: 'balcony', features: ['city_view'], technical_quality_score: 0.92, aesthetic_score: 0.9, confidence: 0.95 },
      { timestamp_ms: 6000, room_type: 'balcony', features: ['city_view'], technical_quality_score: 0.95, aesthetic_score: 0.95, confidence: 0.95 }
    ];

    const segs = segmentContinuousTour(continuousSamples, {
      totalDurationMs: 6500,
      sampleIntervalMs: 1200,
      minSegmentDurationMs: 1200
    });

    assert.strictEqual(segs.length, 3);
    assert.strictEqual(segs[0].room_type, 'living_room');
    assert.strictEqual(segs[1].room_type, 'kitchen');
    assert.strictEqual(segs[2].room_type, 'balcony');
    reportPass('Cenário J: Tour contínuo sem cortes divide-se em 3 segmentos semânticos contíguos');
  } catch (err) {
    reportFail('Cenário J', err);
  }

  // Cenário K: Mudança semântica isolada de 1 sample é absorvida (anti-flicker)
  try {
    const noisySamples = [
      { timestamp_ms: 0, room_type: 'living_room', technical_quality_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 1200, room_type: 'living_room', technical_quality_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 2400, room_type: 'hallway', technical_quality_score: 0.5, confidence: 0.4 }, // Ruído transitório
      { timestamp_ms: 3600, room_type: 'living_room', technical_quality_score: 0.85, confidence: 0.9 },
      { timestamp_ms: 4800, room_type: 'living_room', technical_quality_score: 0.85, confidence: 0.9 }
    ];

    const segs = segmentContinuousTour(noisySamples, {
      totalDurationMs: 5500,
      sampleIntervalMs: 1200,
      minSegmentDurationMs: 1200
    });

    assert.strictEqual(segs.length, 1);
    assert.strictEqual(segs[0].room_type, 'living_room');
    reportPass('Cenário K: Transição transitória isolada é absorvida pelo suavizador anti-flicker');
  } catch (err) {
    reportFail('Cenário K', err);
  }

  // Cenário L: UNKNOWN é aceito como room_type legítimo
  try {
    const res = validateFrameSampleResult({
      room_type: 'unknown',
      technical_quality_score: 0.5,
      confidence: 0.3
    });
    assert.strictEqual(res.room_type, 'unknown');
    reportPass('Cenário L: room_type "unknown" é aceito e tratado normalmente');
  } catch (err) {
    reportFail('Cenário L', err);
  }

  // Cenários M, N, O, P: Validações temporais estritas
  try {
    const samples = [
      { timestamp_ms: 0, room_type: 'facade', technical_quality_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 2000, room_type: 'facade', technical_quality_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 4000, room_type: 'suite', technical_quality_score: 0.8, confidence: 0.9 },
      { timestamp_ms: 6000, room_type: 'suite', technical_quality_score: 0.8, confidence: 0.9 }
    ];

    const totalDur = 7000;
    const segs = segmentContinuousTour(samples, { totalDurationMs: totalDur, sampleIntervalMs: 2000 });

    // M: Dentro da duração física
    for (const s of segs) {
      assert.ok(s.start_ms >= 0 && s.end_ms <= totalDur);
    }
    reportPass('Cenário M: Todos os segmentos respeitam estritamente a duração física');

    // N: start_ms < end_ms
    for (const s of segs) {
      assert.ok(s.start_ms < s.end_ms);
    }
    reportPass('Cenário N: start_ms < end_ms verificado em todos os segmentos');

    // O: Sem sobreposição
    for (let i = 0; i < segs.length - 1; i++) {
      assert.strictEqual(segs[i].end_ms, segs[i + 1].start_ms);
    }
    reportPass('Cenário O: Segmentos contíguos sem gaps e sem overlaps');

    // P: Cobertura total de 0 a totalDurationMs
    assert.strictEqual(segs[0].start_ms, 0);
    assert.strictEqual(segs[segs.length - 1].end_ms, totalDur);
    reportPass('Cenário P: Cobertura temporal contínua e determinística de 0ms ao final');
  } catch (err) {
    reportFail('Cenários M-P', err);
  }

  // Cenário Q: Keyframes pertencem ao diretório da analysis_key correta
  try {
    const mockProvider = new MockMediaUnderstandingProvider();
    const res = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_keyframe_test',
      sampleIntervalMs: 2000
    });

    const expectedAnalysisKey = res.analysis_key;
    for (const s of res.analysis.segments) {
      assert.ok(s.representative_keyframe.frame_path.includes(expectedAnalysisKey));
      assert.ok(fs.existsSync(s.representative_keyframe.frame_path));
    }
    reportPass('Cenário Q: Keyframes residem estritamente dentro do diretório da analysis_key');
  } catch (err) {
    reportFail('Cenário Q', err);
  }

  // Cenário R: Cache corrompido não é aceito silenciosamente
  try {
    const key = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'mock_corrupt_test',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    const corruptDir = path.join(PROPERTIES_OUTPUTS_DIR, testRef, 'analysis', key);
    if (!fs.existsSync(corruptDir)) fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, 'analysis.json'), '{ invalid_json... ', 'utf8');

    const mockProvider = new MockMediaUnderstandingProvider();
    const res = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_corrupt_test'
    });

    assert.strictEqual(res.status, 'READY');
    assert.strictEqual(res.source, 'computed', 'Deve re-executar ao encontrar cache corrompido');
    reportPass('Cenário R: Cache corrompido é ignorado com re-execução segura');
  } catch (err) {
    reportFail('Cenário R', err);
  }

  // Cenário S: Composer permanece intocado
  try {
    const composerPath = path.join(__dirname, '..', '..', 'video_engine', 'composer_service.js');
    assert.ok(fs.existsSync(composerPath));
    const composerContent = fs.readFileSync(composerPath, 'utf8');
    assert.ok(composerContent.includes('Módulo Video Composer Engine'));
    assert.ok(!composerContent.includes('media_understanding'));
    reportPass('Cenário S: Composer V3 permanece estritamente desacoplado e intocado');
  } catch (err) {
    reportFail('Cenário S', err);
  }

  // =========================================================================
  // NOVOS TESTES BLOCKER 1 (FINGERPRINT COMPLETO)
  // =========================================================================

  // Cenário T: Mesma configuração completa -> mesma analysis_key
  try {
    const k1 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    const k2 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    assert.strictEqual(k1, k2);
    reportPass('Cenário T: Mesma configuração completa gera exatamente a mesma analysis_key');
  } catch (err) {
    reportFail('Cenário T', err);
  }

  // Cenário U: Mudança apenas de sample_interval_ms -> analysis_key diferente
  try {
    const k1 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    const k2 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 2500,
      min_segment_duration_ms: 1200
    });
    assert.notStrictEqual(k1, k2);
    reportPass('Cenário U: Mudança de sample_interval_ms gera nova analysis_key');
  } catch (err) {
    reportFail('Cenário U', err);
  }

  // Cenário V: Mudança apenas de min_segment_duration_ms -> analysis_key diferente
  try {
    const k1 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 1200
    });
    const k2 = computeAnalysisKey({
      physical_file_hash: fileHash,
      model_id: 'gpt-4o-mini',
      sample_interval_ms: 1200,
      min_segment_duration_ms: 3000
    });
    assert.notStrictEqual(k1, k2);
    reportPass('Cenário V: Mudança de min_segment_duration_ms gera nova analysis_key');
  } catch (err) {
    reportFail('Cenário V', err);
  }

  // Cenário W: Análise com Config A e depois Config B: B NÃO retorna cache de A
  try {
    const mockProvider = new MockMediaUnderstandingProvider({ defaultRoom: 'balcony' });
    const resA = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_param_test',
      sampleIntervalMs: 1000,
      minSegmentDurationMs: 1000
    });

    const resB = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_param_test',
      sampleIntervalMs: 2500,
      minSegmentDurationMs: 2500
    });

    assert.notStrictEqual(resA.analysis_key, resB.analysis_key);
    assert.strictEqual(resA.source, 'computed');
    assert.strictEqual(resB.source, 'computed');
    reportPass('Cenário W: Configurações A e B geram chaves distintas e não compartilham cache indevidamente');
  } catch (err) {
    reportFail('Cenário W', err);
  }

  // Cenário X: Re-execução da mesma configuração A retorna cache_hit
  try {
    const mockProvider = new MockMediaUnderstandingProvider({ defaultRoom: 'balcony' });
    const callsBefore = mockProvider.callsCount;

    const resA2 = await mediaUnderstandingService.analyzePropertyVideo(testRef, {
      provider: mockProvider,
      modelId: 'mock_param_test',
      sampleIntervalMs: 1000,
      minSegmentDurationMs: 1000
    });

    assert.strictEqual(resA2.source, 'cache_hit');
    assert.strictEqual(mockProvider.callsCount, callsBefore, 'Zero chamadas ao provider no cache hit');
    reportPass('Cenário X: Re-execução da mesma Config A resulta em cache_hit exato');
  } catch (err) {
    reportFail('Cenário X', err);
  }

  // =========================================================================
  // NOVOS TESTES BLOCKER 2 (ALLOWED_FEATURES ENFORCEMENT)
  // =========================================================================

  // Cenário Y: Feature válida é aceita
  try {
    const res = validateFrameSampleResult({
      room_type: 'balcony',
      features: ['city_view', 'gourmet'],
      technical_quality_score: 0.8,
      confidence: 0.9
    });
    assert.deepStrictEqual(res.features, ['city_view', 'gourmet']);
    reportPass('Cenário Y: Features válidas pertencentes à taxonomia são aceitas');
  } catch (err) {
    reportFail('Cenário Y', err);
  }

  // Cenário Z: Feature inválida fora de ALLOWED_FEATURES é rejeitada com fail-fast
  try {
    assert.throws(
      () => {
        validateFrameSampleResult({
          room_type: 'balcony',
          features: ['city_view', 'flying_unicorn'],
          technical_quality_score: 0.8,
          confidence: 0.9
        });
      },
      /feature inválida: 'flying_unicorn'/
    );
    reportPass('Cenário Z: Feature desconhecida fora da taxonomia é rejeitada com fail-fast');
  } catch (err) {
    reportFail('Cenário Z', err);
  }

  // Cenário AA: Múltiplas features válidas continuam válidas e são ordenadas deterministicamente
  try {
    const res = validateFrameSampleResult({
      room_type: 'kitchen',
      features: ['porcelain_tile', 'planned_cabinets', 'modern_fixtures'],
      technical_quality_score: 0.8,
      confidence: 0.9
    });
    assert.deepStrictEqual(res.features, ['modern_fixtures', 'planned_cabinets', 'porcelain_tile']);
    reportPass('Cenário AA: Múltiplas features válidas são preservadas e ordenadas deterministicamente');
  } catch (err) {
    reportFail('Cenário AA', err);
  }

  // Cenário AB: Feature duplicada é deduplicada deterministicamente
  try {
    const res = validateFrameSampleResult({
      room_type: 'balcony',
      features: ['city_view', 'city_view', 'CITY_VIEW'],
      technical_quality_score: 0.8,
      confidence: 0.9
    });
    assert.deepStrictEqual(res.features, ['city_view']);
    reportPass('Cenário AB: Features duplicadas são deduplicadas deterministicamente');
  } catch (err) {
    reportFail('Cenário AB', err);
  }

  // Cenário AC: Provider real/mock passa pela mesma validação estrita de schema
  try {
    const mockProvider = new MockMediaUnderstandingProvider();
    mockProvider.setMockForTimestamp(0, {
      room_type: 'living_room',
      features: ['natural_lighting', 'spacious'],
      technical_quality_score: 0.85,
      confidence: 0.95
    });

    const sampleRes = await mockProvider.analyzeFrame(dummyVideoPath, { timestamp_ms: 0 });
    assert.strictEqual(sampleRes.room_type, 'living_room');
    assert.deepStrictEqual(sampleRes.features, ['natural_lighting', 'spacious']);

    // Tentar setar mock inválido
    mockProvider.setMockForTimestamp(1000, {
      room_type: 'living_room',
      features: ['invalid_secret_feature']
    });

    await assert.rejects(
      async () => {
        await mockProvider.analyzeFrame(dummyVideoPath, { timestamp_ms: 1000 });
      },
      /feature inválida/
    );
    reportPass('Cenário AC: Providers passam pela mesma validação rigorosa de schema');
  } catch (err) {
    reportFail('Cenário AC', err);
  }

  console.log('\n================================================================');
  console.log('RESULTADO FINAL DA SUÍTE DE TESTES:');
  console.log(`Total de testes: ${passCount + failCount}`);
  console.log(`Passaram: ${passCount}`);
  console.log(`Falharam: ${failCount}`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSuite().catch(e => {
  console.error('[SUITE FATAL ERROR]:', e);
  process.exit(1);
});
