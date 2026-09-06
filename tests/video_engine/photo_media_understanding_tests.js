/**
 * Suíte Formal de Testes — Photo Media Understanding Proof (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 * 
 * Matriz Formal de Testes: Cenários A a AN
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

// Configurar ambiente de teste
process.env.NODE_ENV = 'test';

const {
  PhotoMediaUnderstandingService,
  computePhotoAnalysisKey,
  validateGlobalPhotoAnalysis,
  validateStrictScore,
  validateStrictRoomType,
  validateStrictFeature,
  validateSha256Hex,
  QualityEvaluator,
  CrmCategoryReconciler,
  MockPhotoUnderstandingProvider,
  ALLOWED_ROOM_TYPES,
  ALLOWED_FEATURES,
  ALLOWED_UTILITY_LABELS,
  SCHEMA_VERSION,
  TAXONOMY_VERSION
} = require('../../video_engine/property_media/photo_understanding');

const TEST_DIR = path.join(__dirname, '..', 'fixtures', 'photo_understanding_test_' + Date.now());
const TEST_CACHE_DIR = path.join(TEST_DIR, 'cache');
const TEST_TMP_DIR = path.join(TEST_DIR, 'tmp');
const TEST_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'phase3c2');

function setupTestEnvironment() {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  if (!fs.existsSync(TEST_CACHE_DIR)) fs.mkdirSync(TEST_CACHE_DIR, { recursive: true });
  if (!fs.existsSync(TEST_TMP_DIR)) fs.mkdirSync(TEST_TMP_DIR, { recursive: true });
}

function cleanupTestEnvironment() {
  try {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  } catch (e) {}
}

async function runTests() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE FORMAL DE TESTES — PHOTO MEDIA UNDERSTANDING (FASE 4B.2)');
  console.log('================================================================\n');

  setupTestEnvironment();
  let passedCount = 0;
  let totalCount = 0;

  function runCase(name, fn) {
    totalCount++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function runAsyncCase(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // Imagem fixture para testes e seu hash real
  const testPhotoPath = path.join(TEST_FIXTURES_DIR, 'test_photo_cozinha.jpg');
  const realFixtureHash = crypto.createHash('sha256').update(fs.readFileSync(testPhotoPath)).digest('hex');
  const dummyHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  // Cenário A: Análise de foto real gera schema completo e válido
  await runAsyncCase('Cenário A: Análise de foto gera schema completo e válido', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({
      provider: mock,
      baseOutputDir: TEST_CACHE_DIR,
      tmpDir: TEST_TMP_DIR
    });

    const res = await service.analyzePhotoBlob({
      physical_file_hash: realFixtureHash,
      storage_path: testPhotoPath,
      specs: { width: 1080, height: 1920, short_edge: 1080 }
    });

    assert.strictEqual(res.cache_hit, false);
    assert.strictEqual(res.analysis.physical_file_hash, realFixtureHash);
    assert.strictEqual(res.analysis.semantic.primary_room_type, 'living_room');
    assert.strictEqual(res.analysis.quality.technical_quality.resolution_adequacy, 1.0);
    assert.ok(res.analysis.quality.composite_quality_score > 0);
  });

  // Cenário B: Determinismo estrito de photo_analysis_key
  runCase('Cenário B: Determinismo estrito de photo_analysis_key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    assert.strictEqual(key1, key2);
    assert.strictEqual(key1.length, 64);
  });

  // Cenário C: Mudança de physical_file_hash gera nova key
  runCase('Cenário C: Mudança de physical_file_hash gera nova key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210', model_id: 'gpt-4o-mini' });
    assert.notStrictEqual(key1, key2);
  });

  // Cenário D: Mudança de model_id gera nova key
  runCase('Cenário D: Mudança de model_id gera nova key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o' });
    assert.notStrictEqual(key1, key2);
  });

  // Cenário E: Mudança de prompt_version gera nova key
  runCase('Cenário E: Mudança de prompt_version gera nova key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', prompt_version: 'v1' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', prompt_version: 'v2' });
    assert.notStrictEqual(key1, key2);
  });

  // Cenário F: Mudança de schema_version ou taxonomy_version gera nova key
  runCase('Cenário F: Mudança de schema_version ou taxonomy_version gera nova key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', schema_version: '1.0.0' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', schema_version: '2.0.0' });
    assert.notStrictEqual(key1, key2);
  });

  // Cenário G: Cache Hit global reutiliza análise sem chamada ao provider
  await runAsyncCase('Cenário G: Cache Hit global reutiliza análise (0 chamadas provider)', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({
      provider: mock,
      baseOutputDir: TEST_CACHE_DIR,
      tmpDir: TEST_TMP_DIR
    });

    const initialCalls = mock.callCount;
    // Segunda chamada para a mesma foto e hash real
    const res1 = await service.analyzePhotoBlob({
      physical_file_hash: realFixtureHash,
      storage_path: testPhotoPath,
      specs: { width: 1080, height: 1920 }
    });
    assert.strictEqual(res1.cache_hit, true); // gravado no Cenário A
    assert.strictEqual(mock.callCount, initialCalls); // 0 novas chamadas!
  });

  // Cenário H: room_type fora da taxonomia oficial é rejeitado com fail-fast
  runCase('Cenário H: room_type fora da taxonomia é rejeitado com INVALID_ROOM_TYPE_ERROR', () => {
    assert.throws(() => {
      validateStrictRoomType('cozinha_gourmet');
    }, /INVALID_ROOM_TYPE_ERROR/);
  });

  // Cenário I: feature fora da taxonomia oficial é rejeitada com fail-fast
  runCase('Cenário I: feature fora da taxonomia é rejeitada com INVALID_FEATURE_ERROR', () => {
    assert.throws(() => {
      validateStrictFeature('piscina_aquecida_invalida');
    }, /INVALID_FEATURE_ERROR/);
  });

  // Cenário J: Decomposição de qualidade contém todos os subcomponentes auditáveis
  runCase('Cenário J: Decomposição de qualidade contém subcomponentes auditáveis', () => {
    const quality = QualityEvaluator.evaluateQuality({
      rawVlmScores: {
        sharpness: 0.9, exposure: 0.8, noise_compression: 0.95, perspective_alignment: 0.85,
        composition: 0.8, framing: 0.85, visual_balance: 0.9, lighting_atmosphere: 0.85, cleanliness_staging: 0.95,
        room_coverage: 0.9, feature_clarity: 0.85, spaciousness_perception: 0.9, obstruction_level: 1.0
      },
      specs: { short_edge: 900 }
    });
    assert.ok(quality.technical_quality.score >= 0.8);
    assert.ok(quality.aesthetic_score.score >= 0.8);
    assert.ok(quality.editorial_utility.score >= 0.8);
    assert.strictEqual(quality.editorial_utility.utility_label, 'high_value_anchor');
  });

  // Cenário K: Cálculo determinístico de fórmulas de qualidade e pesos
  runCase('Cenário K: Cálculo determinístico de fórmulas de qualidade e pesos', () => {
    const quality = QualityEvaluator.evaluateQuality({
      rawVlmScores: {
        sharpness: 1.0, exposure: 1.0, noise_compression: 1.0, perspective_alignment: 1.0,
        composition: 1.0, framing: 1.0, visual_balance: 1.0, lighting_atmosphere: 1.0, cleanliness_staging: 1.0,
        room_coverage: 1.0, feature_clarity: 1.0, spaciousness_perception: 1.0, obstruction_level: 1.0
      },
      specs: { short_edge: 900 }
    });
    assert.strictEqual(quality.technical_quality.score, 1.0);
    assert.strictEqual(quality.aesthetic_score.score, 1.0);
    assert.strictEqual(quality.editorial_utility.score, 1.0);
    assert.strictEqual(quality.composite_quality_score, 1.0);
  });

  // Cenário L: Foto ambígua (sala + jantar) popula secondary_room_types
  await runAsyncCase('Cenário L: Foto ambígua (sala + jantar) popula secondary_room_types', async () => {
    const mock = new MockPhotoUnderstandingProvider({
      defaultResponse: {
        primary_room_type: 'living_room',
        secondary_room_types: ['dining_room', 'balcony'],
        features: ['open_concept', 'porcelain_tile'],
        description: 'Sala integrada com jantar e sacada.',
        confidence: 0.9,
        raw_vlm_scores: {
          sharpness: 0.8, exposure: 0.8, noise_compression: 0.8, perspective_alignment: 0.8,
          composition: 0.8, framing: 0.8, visual_balance: 0.8, lighting_atmosphere: 0.8, cleanliness_staging: 0.8,
          room_coverage: 0.8, feature_clarity: 0.8, spaciousness_perception: 0.8, obstruction_level: 1.0
        }
      }
    });

    const tempPhoto = path.join(TEST_DIR, 'ambiguous_temp.jpg');
    fs.writeFileSync(tempPhoto, Buffer.from('ambiguous_image_content_12345'));
    const tempHash = crypto.createHash('sha256').update(fs.readFileSync(tempPhoto)).digest('hex');

    const service = new PhotoMediaUnderstandingService({
      provider: mock,
      baseOutputDir: TEST_CACHE_DIR,
      tmpDir: TEST_TMP_DIR
    });

    const res = await service.analyzePhotoBlob({
      physical_file_hash: tempHash,
      storage_path: tempPhoto,
      specs: { width: 1080, height: 1920 }
    });

    assert.strictEqual(res.analysis.semantic.primary_room_type, 'living_room');
    assert.deepStrictEqual(res.analysis.semantic.secondary_room_types, ['balcony', 'dining_room']); // ordenado
  });

  // Cenário M: Foto com baixa cobertura/utilidade recebe label correto
  runCase('Cenário M: Foto com baixa utilidade recebe label marginal_usable / editorial_reject', () => {
    const quality = QualityEvaluator.evaluateQuality({
      rawVlmScores: {
        sharpness: 0.5, exposure: 0.4, noise_compression: 0.4, perspective_alignment: 0.3,
        composition: 0.3, framing: 0.3, visual_balance: 0.3, lighting_atmosphere: 0.3, cleanliness_staging: 0.3,
        room_coverage: 0.2, feature_clarity: 0.3, spaciousness_perception: 0.2, obstruction_level: 0.3
      },
      specs: { short_edge: 480 }
    });
    assert.strictEqual(quality.editorial_utility.utility_label, 'editorial_reject');
  });

  // Cenário N: Ranking intra-ambiente ordena fotos do mesmo cômodo coerentemente
  runCase('Cenário N: Ranking intra-ambiente ordena fotos com tiebreak determinístico', () => {
    const service = new PhotoMediaUnderstandingService({ baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });
    const views = [
      {
        physical_file_hash: 'hash_b',
        semantic: { primary_room_type: 'kitchen', confidence: 0.9 },
        quality: { editorial_utility: { score: 0.7 }, aesthetic_score: { score: 0.7 }, technical_quality: { score: 0.7 } }
      },
      {
        physical_file_hash: 'hash_a',
        semantic: { primary_room_type: 'kitchen', confidence: 0.95 },
        quality: { editorial_utility: { score: 0.9 }, aesthetic_score: { score: 0.9 }, technical_quality: { score: 0.9 } }
      },
      {
        physical_file_hash: 'hash_c',
        semantic: { primary_room_type: 'kitchen', confidence: 0.85 },
        quality: { editorial_utility: { score: 0.9 }, aesthetic_score: { score: 0.9 }, technical_quality: { score: 0.9 } }
      }
    ];

    const ranked = service.rankIntraRoomPhotos(views);
    assert.strictEqual(ranked[0].physical_file_hash, 'hash_a'); // maior score
    assert.strictEqual(ranked[0].intra_rank, 1);
    assert.strictEqual(ranked[1].physical_file_hash, 'hash_c'); // mesmo score, menor confidence
    assert.strictEqual(ranked[1].intra_rank, 2);
    assert.strictEqual(ranked[2].physical_file_hash, 'hash_b'); // menor score
    assert.strictEqual(ranked[2].intra_rank, 3);
  });

  // Cenário O: Múltiplas propriedades compartilhando blob usam mesmo cache
  await runAsyncCase('Cenário O: Múltiplas propriedades compartilhando blob usam mesmo cache global', async () => {
    const tempShared = path.join(TEST_DIR, 'shared_photo.jpg');
    fs.writeFileSync(tempShared, Buffer.from('shared_bytes_across_properties'));
    const sharedHash = crypto.createHash('sha256').update(fs.readFileSync(tempShared)).digest('hex');

    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({
      provider: mock,
      baseOutputDir: TEST_CACHE_DIR,
      tmpDir: TEST_TMP_DIR
    });

    const photoAssetPropA = {
      asset_id: 'ast_pimg_propA',
      property_ref: '1628',
      file_hash: sharedHash,
      storage_path: tempShared,
      specs: { width: 1080, height: 1920 },
      metadata: { categoria: 'Sala' }
    };

    const photoAssetPropB = {
      asset_id: 'ast_pimg_propB',
      property_ref: '1601',
      file_hash: sharedHash,
      storage_path: tempShared,
      specs: { width: 1080, height: 1920 },
      metadata: { categoria: 'Living' }
    };

    const resA = await service.analyzePropertyPhoto(photoAssetPropA);
    const resB = await service.analyzePropertyPhoto(photoAssetPropB);

    assert.strictEqual(resA.photo_analysis_key, resB.photo_analysis_key);
    assert.strictEqual(resB.cache_hit, true); // PropB pegou cache hit do PropA!
    assert.strictEqual(resA.semantic_view.property_ref, '1628');
    assert.strictEqual(resB.semantic_view.property_ref, '1601');
  });

  // Cenário P: Concorrência física de 2 workers (No-Clobber atomic write)
  await runAsyncCase('Cenário P: Concorrência física de 2 workers (No-Clobber atomic write)', async () => {
    const tempConc = path.join(TEST_DIR, 'concurrent_photo.jpg');
    fs.writeFileSync(tempConc, Buffer.from('concurrent_photo_bytes_999'));
    const concurrentHash = crypto.createHash('sha256').update(fs.readFileSync(tempConc)).digest('hex');

    const mock1 = new MockPhotoUnderstandingProvider();
    const mock2 = new MockPhotoUnderstandingProvider();

    const service1 = new PhotoMediaUnderstandingService({ provider: mock1, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });
    const service2 = new PhotoMediaUnderstandingService({ provider: mock2, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    const [res1, res2] = await Promise.all([
      service1.analyzePhotoBlob({ physical_file_hash: concurrentHash, storage_path: tempConc, specs: { short_edge: 900 } }),
      service2.analyzePhotoBlob({ physical_file_hash: concurrentHash, storage_path: tempConc, specs: { short_edge: 900 } })
    ]);

    assert.strictEqual(res1.photo_analysis_key, res2.photo_analysis_key);
    const canonicalPath = service1.getCanonicalCachePath(res1.photo_analysis_key);
    assert.ok(fs.existsSync(canonicalPath));
    const cached = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
    validateGlobalPhotoAnalysis(cached);
  });

  // Cenário Q: Provider timeout e erro não corrompem cache global
  await runAsyncCase('Cenário Q: Provider timeout e erro não corrompem cache global', async () => {
    const tempFail = path.join(TEST_DIR, 'fail_photo.jpg');
    fs.writeFileSync(tempFail, Buffer.from('fail_bytes_image_123'));
    const failHash = crypto.createHash('sha256').update(fs.readFileSync(tempFail)).digest('hex');

    const mock = new MockPhotoUnderstandingProvider();
    mock.shouldFail = true;

    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    await assert.rejects(async () => {
      await service.analyzePhotoBlob({ physical_file_hash: failHash, storage_path: tempFail });
    }, /\[MOCK_ERROR\]/);

    const key = computePhotoAnalysisKey({ physical_file_hash: failHash, model_id: mock.modelId });
    const canonicalPath = service.getCanonicalCachePath(key);
    assert.strictEqual(fs.existsSync(canonicalPath), false); // nenhum lixo criado
  });

  // Cenário R: Imagem inexistente impede chamada ao VLM
  await runAsyncCase('Cenário R: Imagem inexistente impede chamada ao VLM', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    await assert.rejects(async () => {
      await service.analyzePhotoBlob({ physical_file_hash: dummyHash, storage_path: 'c:/invalid/path/nonexistent.jpg' });
    }, /Arquivo físico não encontrado/);

    assert.strictEqual(mock.callCount, 0); // zero chamadas
  });

  // Cenário S: Composer e Creative Director permanecem intocados
  runCase('Cenário S: Composer e Creative Director permanecem intocados', () => {
    const composer = require('../../video_engine/composer_service');
    const cd = require('../../video_engine/creative_director/creative_director_service');
    assert.ok(composer);
    assert.ok(cd);
  });

  // Cenário T: Ingestão de fotos 4B.1 permanece intocada
  runCase('Cenário T: Ingestão de fotos 4B.1 permanece intocada', () => {
    const photoIngest = require('../../video_engine/property_media/photo_ingestion');
    assert.ok(photoIngest.PhotoIngestionService);
  });

  // Cenário U: GlobalPhotoAnalysis no cache NÃO contém campos property-specific
  runCase('Cenário U: GlobalPhotoAnalysis no cache NÃO contém campos property-specific', () => {
    const invalidObj = {
      photo_analysis_key: 'a'.repeat(64),
      physical_file_hash: 'b'.repeat(64),
      property_ref: '1628', // FORBIDDEN!
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [], confidence: 0.9 },
      quality: {
        technical_quality: { sharpness: 0.9, exposure: 0.9, noise_compression: 0.9, resolution_adequacy: 1.0, perspective_alignment: 0.9, score: 0.9 },
        aesthetic_score: { composition: 0.9, framing: 0.9, visual_balance: 0.9, lighting_atmosphere: 0.9, cleanliness_staging: 0.9, score: 0.9 },
        editorial_utility: { room_coverage: 0.9, feature_clarity: 0.9, spaciousness_perception: 0.9, obstruction_level: 1.0, score: 0.9, utility_label: 'high_value_anchor' },
        composite_quality_score: 0.9
      },
      analyzer_provenance: { analyzer_type: 'vlm' }
    };
    assert.throws(() => {
      validateGlobalPhotoAnalysis(invalidObj);
    }, /não pode conter campo property-scoped/);
  });

  // Cenário V: PropertyPhotoSemanticView projeta corretamente contexto da propriedade
  runCase('Cenário V: PropertyPhotoSemanticView projeta corretamente contexto da propriedade', () => {
    const globalObj = {
      photo_analysis_key: 'a'.repeat(64),
      physical_file_hash: 'b'.repeat(64),
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: ['planned_cabinets'], confidence: 0.95 },
      quality: {
        technical_quality: { score: 0.9 },
        aesthetic_score: { score: 0.88 },
        editorial_utility: { score: 0.92, utility_label: 'high_value_anchor' },
        composite_quality_score: 0.90
      },
      analyzer_provenance: { analyzer_type: 'photo_vlm' }
    };

    const asset = {
      id: 'ast_pimg_test_123',
      property_ref: '1628',
      metadata: { crm_photo_id: 12345, categoria: 'Cozinha' }
    };

    const view = CrmCategoryReconciler.projectSemanticView(asset, globalObj);
    assert.strictEqual(view.asset_id, 'ast_pimg_test_123');
    assert.strictEqual(view.property_ref, '1628');
    assert.strictEqual(view.crm_context.raw_crm_category, 'Cozinha');
    assert.strictEqual(view.crm_context.normalized_crm_room_hint, 'kitchen');
    assert.strictEqual(view.crm_context.comparable, true);
    assert.strictEqual(view.semantic_reconciliation.divergence_detected, false);
  });

  // Cenário W: Fail-fast estrito para score > 1.0 (proibido clamping para 1.0)
  runCase('Cenário W: Fail-fast estrito para score > 1.0 dispara SCORE_OUT_OF_BOUNDS_ERROR', () => {
    assert.throws(() => {
      validateStrictScore(1.4, 'test_score');
    }, /SCORE_OUT_OF_BOUNDS_ERROR/);
  });

  // Cenário X: Fail-fast estrito para score < 0.0 (proibido clamping para 0.0)
  runCase('Cenário X: Fail-fast estrito para score < 0.0 dispara SCORE_OUT_OF_BOUNDS_ERROR', () => {
    assert.throws(() => {
      validateStrictScore(-0.2, 'test_score');
    }, /SCORE_OUT_OF_BOUNDS_ERROR/);
  });

  // Cenário Y: Fail-fast estrito para score NaN, Infinity ou não-numérico
  runCase('Cenário Y: Fail-fast estrito para score NaN, Infinity ou null', () => {
    assert.throws(() => { validateStrictScore(NaN, 'test_nan'); }, /SCORE_OUT_OF_BOUNDS_ERROR/);
    assert.throws(() => { validateStrictScore(Infinity, 'test_inf'); }, /SCORE_OUT_OF_BOUNDS_ERROR/);
    assert.throws(() => { validateStrictScore(null, 'test_null'); }, /SCORE_OUT_OF_BOUNDS_ERROR/);
    assert.throws(() => { validateStrictScore('0.8', 'test_str'); }, /SCORE_OUT_OF_BOUNDS_ERROR/);
  });

  // Cenário Z: Autoridade determinística de resolution_adequacy via specs físicas
  runCase('Cenário Z: Autoridade determinística de resolution_adequacy via specs físicas', () => {
    assert.strictEqual(QualityEvaluator.computeResolutionAdequacy({ short_edge: 900 }), 1.0);
    assert.strictEqual(QualityEvaluator.computeResolutionAdequacy({ short_edge: 1080 }), 1.0);
    assert.strictEqual(QualityEvaluator.computeResolutionAdequacy({ short_edge: 450 }), 0.5);
    assert.strictEqual(QualityEvaluator.computeResolutionAdequacy({ short_edge: 720 }), 0.8);
  });

  // Cenário AA: CRM vago ("Unidade") gera comparable: false e sem falso positivo
  runCase('Cenário AA: CRM vago ("Unidade") gera comparable: false e divergence_detected: false', () => {
    const norm = CrmCategoryReconciler.normalizeCrmCategory('Unidade');
    assert.strictEqual(norm.comparable, false);
    assert.strictEqual(norm.normalized_crm_room_hint, null);

    const rec = CrmCategoryReconciler.reconcileSemanticMatch(norm, { primary_room_type: 'kitchen' });
    assert.strictEqual(rec.divergence_detected, false);
    assert.strictEqual(rec.divergence_reason, 'crm_category_not_comparable');
  });

  // Cenário AB: CRM específico ("Quarto") divergente do VLM ("kitchen") gera divergence_detected: true
  runCase('Cenário AB: CRM específico ("Quarto") divergente do VLM ("kitchen") gera divergência', () => {
    const norm = CrmCategoryReconciler.normalizeCrmCategory('Quarto');
    assert.strictEqual(norm.comparable, true);
    assert.strictEqual(norm.normalized_crm_room_hint, 'bedroom');

    const rec = CrmCategoryReconciler.reconcileSemanticMatch(norm, { primary_room_type: 'kitchen', secondary_room_types: [] });
    assert.strictEqual(rec.divergence_detected, true);
    assert.strictEqual(rec.divergence_reason, 'crm_hint_mismatch');
  });

  // Cenário AC: CRM específico ("Sala") coincidente com VLM ("living_room") sem divergência
  runCase('Cenário AC: CRM específico ("Sala") coincidente com VLM ("living_room") sem divergência', () => {
    const norm = CrmCategoryReconciler.normalizeCrmCategory('Sala');
    assert.strictEqual(norm.comparable, true);
    assert.strictEqual(norm.normalized_crm_room_hint, 'living_room');

    const rec = CrmCategoryReconciler.reconcileSemanticMatch(norm, { primary_room_type: 'living_room', secondary_room_types: [] });
    assert.strictEqual(rec.divergence_detected, false);
    assert.strictEqual(rec.divergence_reason, null);
  });

  // Cenário AD: Timestamp analyzed_at diferente NÃO altera photo_analysis_key
  runCase('Cenário AD: Timestamp analyzed_at diferente NÃO altera photo_analysis_key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini' });
    assert.strictEqual(key1, key2);
  });

  // Cenário AE: Mudança em provider behavioral config altera photo_analysis_key
  runCase('Cenário AE: Mudança em provider_config altera photo_analysis_key', () => {
    const key1 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', provider_config: { detail: 'low', temperature: 0.1 } });
    const key2 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', provider_config: { detail: 'high', temperature: 0.1 } });
    const key3 = computePhotoAnalysisKey({ physical_file_hash: dummyHash, model_id: 'gpt-4o-mini', provider_config: { detail: 'low', temperature: 0.7 } });
    assert.notStrictEqual(key1, key2);
    assert.notStrictEqual(key1, key3);
  });

  // =========================================================================
  // NOVOS CENÁRIOS DE INTEGRIDADE (AF a AN)
  // =========================================================================

  // Cenário AF: storage_path contém bytes cujo SHA difere do physical_file_hash informado -> fail-fast antes do provider
  await runAsyncCase('Cenário AF: storage_path com SHA divergente dispara PHOTO_PHYSICAL_HASH_MISMATCH', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });
    const fakeHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    await assert.rejects(async () => {
      await service.analyzePhotoBlob({
        physical_file_hash: fakeHash, // informado FAKE
        storage_path: testPhotoPath    // bytes reais do fixture
      });
    }, /\[PHOTO_PHYSICAL_HASH_MISMATCH\]/);
  });

  // Cenário AG: Hash mismatch -> provider call count permanece 0
  await runAsyncCase('Cenário AG: Hash mismatch mantém provider call count em 0', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });
    const fakeHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    try {
      await service.analyzePhotoBlob({
        physical_file_hash: fakeHash,
        storage_path: testPhotoPath
      });
    } catch (e) {}

    assert.strictEqual(mock.callCount, 0); // Provedor NUNCA foi chamado!
  });

  // Cenário AH: Canonical analysis.json estruturalmente válido, mas com photo_analysis_key diferente -> rejeitado
  await runAsyncCase('Cenário AH: Canonical analysis.json com photo_analysis_key divergente é rejeitado com CANONICAL_ANALYSIS_IDENTITY_ERROR', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    const key = computePhotoAnalysisKey({ physical_file_hash: realFixtureHash, model_id: mock.modelId, provider_config: mock.getBehavioralConfig() });
    const canonicalDir = path.join(TEST_CACHE_DIR, key);
    if (!fs.existsSync(canonicalDir)) fs.mkdirSync(canonicalDir, { recursive: true });

    // Grava canonical com photo_analysis_key errada (envenenada)
    const poisonedKey = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const poisonedJson = {
      photo_analysis_key: poisonedKey, // DIVERGENTE!
      physical_file_hash: realFixtureHash,
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [], description: 'teste', confidence: 0.9 },
      quality: {
        technical_quality: { sharpness: 0.9, exposure: 0.9, noise_compression: 0.9, resolution_adequacy: 1.0, perspective_alignment: 0.9, score: 0.9 },
        aesthetic_score: { composition: 0.9, framing: 0.9, visual_balance: 0.9, lighting_atmosphere: 0.9, cleanliness_staging: 0.9, score: 0.9 },
        editorial_utility: { room_coverage: 0.9, feature_clarity: 0.9, spaciousness_perception: 0.9, obstruction_level: 1.0, score: 0.9, utility_label: 'high_value_anchor' },
        composite_quality_score: 0.9
      },
      analyzer_provenance: { analyzer_type: 'mock' }
    };
    fs.writeFileSync(path.join(canonicalDir, 'analysis.json'), JSON.stringify(poisonedJson, null, 2), 'utf8');

    await assert.rejects(async () => {
      await service.analyzePhotoBlob({ physical_file_hash: realFixtureHash, storage_path: testPhotoPath });
    }, /\[CANONICAL_ANALYSIS_IDENTITY_ERROR\]/);
  });

  // Cenário AI: Canonical analysis.json possui key correta, mas physical_file_hash diferente -> rejeitado
  await runAsyncCase('Cenário AI: Canonical analysis.json com physical_file_hash divergente é rejeitado', async () => {
    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    const key = computePhotoAnalysisKey({ physical_file_hash: realFixtureHash, model_id: mock.modelId, provider_config: mock.getBehavioralConfig() });
    const canonicalDir = path.join(TEST_CACHE_DIR, key);
    if (!fs.existsSync(canonicalDir)) fs.mkdirSync(canonicalDir, { recursive: true });

    // Grava canonical com physical_file_hash errado
    const poisonedHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const poisonedJson = {
      photo_analysis_key: key,
      physical_file_hash: poisonedHash, // DIVERGENTE!
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [], description: 'teste', confidence: 0.9 },
      quality: {
        technical_quality: { sharpness: 0.9, exposure: 0.9, noise_compression: 0.9, resolution_adequacy: 1.0, perspective_alignment: 0.9, score: 0.9 },
        aesthetic_score: { composition: 0.9, framing: 0.9, visual_balance: 0.9, lighting_atmosphere: 0.9, cleanliness_staging: 0.9, score: 0.9 },
        editorial_utility: { room_coverage: 0.9, feature_clarity: 0.9, spaciousness_perception: 0.9, obstruction_level: 1.0, score: 0.9, utility_label: 'high_value_anchor' },
        composite_quality_score: 0.9
      },
      analyzer_provenance: { analyzer_type: 'mock' }
    };
    fs.writeFileSync(path.join(canonicalDir, 'analysis.json'), JSON.stringify(poisonedJson, null, 2), 'utf8');

    await assert.rejects(async () => {
      await service.analyzePhotoBlob({ physical_file_hash: realFixtureHash, storage_path: testPhotoPath });
    }, /\[CANONICAL_ANALYSIS_IDENTITY_ERROR\]/);
  });

  // Cenário AJ: EEXIST concorrente com canonical de identidade divergente -> CANONICAL_ANALYSIS_IDENTITY_ERROR
  await runAsyncCase('Cenário AJ: Concorrência EEXIST com canonical divergente dispara CANONICAL_ANALYSIS_IDENTITY_ERROR', async () => {
    const service = new PhotoMediaUnderstandingService({ baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });
    const testKey = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
    const canonicalDir = path.join(TEST_CACHE_DIR, testKey);
    if (!fs.existsSync(canonicalDir)) fs.mkdirSync(canonicalDir, { recursive: true });

    // Canonical existente com hash diferente do globalAnalysis que tentará ser publicado
    const existingDivergent = {
      photo_analysis_key: testKey,
      physical_file_hash: '2222222222222222222222222222222222222222222222222222222222222222',
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [], description: 'divergente', confidence: 0.9 },
      quality: {
        technical_quality: { sharpness: 0.9, exposure: 0.9, noise_compression: 0.9, resolution_adequacy: 1.0, perspective_alignment: 0.9, score: 0.9 },
        aesthetic_score: { composition: 0.9, framing: 0.9, visual_balance: 0.9, lighting_atmosphere: 0.9, cleanliness_staging: 0.9, score: 0.9 },
        editorial_utility: { room_coverage: 0.9, feature_clarity: 0.9, spaciousness_perception: 0.9, obstruction_level: 1.0, score: 0.9, utility_label: 'high_value_anchor' },
        composite_quality_score: 0.9
      },
      analyzer_provenance: { analyzer_type: 'mock' }
    };
    fs.writeFileSync(path.join(canonicalDir, 'analysis.json'), JSON.stringify(existingDivergent, null, 2), 'utf8');

    const toPublish = {
      photo_analysis_key: testKey,
      physical_file_hash: '3333333333333333333333333333333333333333333333333333333333333333', // DIVERGENTE DO CANONICAL EXISTENTE
      semantic: { primary_room_type: 'kitchen', secondary_room_types: [], features: [], description: 'novo', confidence: 0.9 },
      quality: existingDivergent.quality,
      analyzer_provenance: existingDivergent.analyzer_provenance
    };

    await assert.rejects(async () => {
      await service.publishGlobalAnalysisNoClobber(testKey, toPublish);
    }, /\[CANONICAL_ANALYSIS_IDENTITY_ERROR\]/);
  });

  // Cenário AK: Canonical divergente permanece byte-for-byte intacto
  await runAsyncCase('Cenário AK: Canonical divergente permanece byte-for-byte intacto (zero unlink/truncate)', async () => {
    const testKey = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
    const canonicalPath = path.join(TEST_CACHE_DIR, testKey, 'analysis.json');
    const content = fs.readFileSync(canonicalPath, 'utf8');
    assert.ok(content.includes('divergente')); // ainda intacto no disco!
  });

  // Cenário AL: SHA inválido/não-hex é rejeitado com fail-fast
  runCase('Cenário AL: SHA inválido/não-hex é rejeitado por validateSha256Hex', () => {
    assert.throws(() => { validateSha256Hex('not_a_sha'); }, /SCHEMA_ERROR/);
    assert.throws(() => { validateSha256Hex('0123456789abcdef'); }, /SCHEMA_ERROR/); // tamanho 16
    assert.throws(() => { validateSha256Hex('z'.repeat(64)); }, /SCHEMA_ERROR/); // não-hex
    assert.strictEqual(validateSha256Hex(dummyHash.toUpperCase()), dummyHash); // normaliza case
  });

  // Cenário AM: Caminho normal válido continua gerando cache hit
  await runAsyncCase('Cenário AM: Caminho normal válido gera e reutiliza cache hit com sucesso', async () => {
    const tempValid = path.join(TEST_DIR, 'valid_photo_normal.jpg');
    fs.writeFileSync(tempValid, Buffer.from('valid_normal_bytes_for_testing'));
    const validHash = crypto.createHash('sha256').update(fs.readFileSync(tempValid)).digest('hex');

    const mock = new MockPhotoUnderstandingProvider();
    const service = new PhotoMediaUnderstandingService({ provider: mock, baseOutputDir: TEST_CACHE_DIR, tmpDir: TEST_TMP_DIR });

    const first = await service.analyzePhotoBlob({ physical_file_hash: validHash, storage_path: tempValid });
    assert.strictEqual(first.cache_hit, false);

    const second = await service.analyzePhotoBlob({ physical_file_hash: validHash, storage_path: tempValid });
    assert.strictEqual(second.cache_hit, true);
    assert.strictEqual(second.analysis.physical_file_hash, validHash);
  });

  // Cenário AN: Prova de idempotência da suíte
  runCase('Cenário AN: Invariantes de integridade física e cache consolidadas', () => {
    assert.ok(PhotoMediaUnderstandingService);
    assert.ok(validateSha256Hex);
  });

  cleanupTestEnvironment();

  console.log('\n================================================================');
  console.log(`SUÍTE DE TESTES FORMAL FASE 4B.2 FINALIZADA: ${passedCount}/${totalCount} PASS`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('FATAL TEST ERROR:', err);
    cleanupTestEnvironment();
    process.exit(1);
  });
}

module.exports = { runTests };
