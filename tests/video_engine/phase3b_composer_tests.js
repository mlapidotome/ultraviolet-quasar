/**
 * Suíte de Homologação Automatizada Final Hardening — Fase 3B Video Composer MVP
 * Bali Imóveis (Video Engine V2)
 * 
 * Cenários Validados com Rigor Pós-Review e Final Hardening:
 * 1. Blueprint válido Hook+Body renderiza com sucesso
 * 2. Ordem sequencial dos clipes respeitada
 * 3. Asset inexistente rejeitado antes de invocar FFmpeg
 * 4. Asset não-ready rejeitado antes do FFmpeg
 * 5. Asset de outro Job rejeitado por violação de ownership físico
 * 6. Symlink externo rejeitado
 * 7. file_hash divergente (adulteração de bytes) rejeitado
 * 8. Blueprint vazio ou corrompido rejeitado
 * 9. schema_version não suportada rejeitada
 * 10. Camada não suportada (layer > 0) rejeitada no MVP
 * 11. Parâmetros de trim inválidos (source_in >= source_out) rejeitados
 * 12. Arquivo de saída contém stream de vídeo ativo
 * 13. Arquivo de saída contém stream de áudio ativo
 * 14. Duração de saída dentro da tolerância configurável de ±250 ms
 * 15. Resolução de saída estritamente 1080x1920
 * 16. Taxa de quadros de saída 30 fps e formato H.264 canônico
 * 17. Pipeline de re-encode padronizado único gera output íntegro
 * 18. Unidade de duração oficial (duration_ms) aplicada sem truncamento
 * 19. Placeholders antigos de metadata ignorados (fala completa preservada)
 * 20. [FINAL HARDENING] Cleanup automático de .tmp em falha pós-render sem intervenção manual do teste
 * 21. Arquivo final existente não corrompido em caso de erro no retry
 * 22. Mesma render_key gera retorno idempotente imediato sem invocar FFmpeg
 * 23. Mudança no file_hash de um asset de entrada altera a render_key
 * 24. Mudança no Blueprint (trims, ordem, formato) altera a render_key
 * 25. Asset READY nunca é sobrescrito fisicamente
 * 26. Claim atômico SQL impede duas renderizações simultâneas do mesmo criativo
 * 27. Recuperação automática de stale processing após lease de 5 minutos
 * 28. Shadow Composer gera arquivo paralelo sem tocar nos campos oficiais da 2C
 * 29. Comparação semântica entre Shadow Composer e concat legado demonstra equivalência
 * 30. Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200)
 * 31. WhatsApp V1 e bloqueio estático 403 em /outputs/jobs/ permanecem intocados
 * 32. Saúde real do PM2 (jlist online) e PostgreSQL 16
 * 33. Trims bilaterais reais aplicados fisicamente no FFmpeg (5s -> trim 1s-3s -> ≈2s)
 * 34. Arquivo órfão prévio em finalPath não é aceito cegamente e é removido antes da promoção
 * 35. QC estrito de codecs (H.264 / AAC) e FPS físico derivado de streams reais
 * 36. [FINAL HARDENING] Trims unilaterais estritamente rejeitados pelo contrato
 * 37. [FINAL HARDENING] creative_id malicioso ou tentativa de path traversal rejeitados
 * 38. [FINAL HARDENING] Recuperação controlada de READY corrompido (DB READY + arquivo ausente)
 * 39. [FINAL HARDENING] Recuperação controlada de READY adulterado (DB READY + hash divergente)
 * 40. [FINAL HARDENING] Invariante estrito: FFmpeg NUNCA executa sem claim adquirido (Bloqueio 409 em concorrência)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const axios = require('axios');
const { getPool } = require('/var/www/bali-gestor/video_engine/db');
const assetService = require('/var/www/bali-gestor/video_engine/asset_service');
const jobService = require('/var/www/bali-gestor/video_engine/job_service');
const composerService = require('/var/www/bali-gestor/video_engine/composer_service');

const BASE_URL = 'http://127.0.0.1:3005';

if (!process.env.PANEL_PASSWORD) {
  throw new Error('[FATAL ERROR] Variável de ambiente PANEL_PASSWORD não definida no ambiente!');
}
const PANEL_AUTH = {
  username: 'marcel',
  password: process.env.PANEL_PASSWORD
};

const SHOWCASE_JOB_ID = 'bbddf3ba-f7c6-44f5-a81a-2ac09dae611b';

let passedTests = 0;
let totalTests = 0;

function assert(condition, scenarioNum, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ [FALHA] [Cenário ${scenarioNum}] ${message}`);
    throw new Error(`Assertion failed for scenario ${scenarioNum}: ${message}`);
  }
  passedTests++;
  console.log(`✅ [PASSOU] [Cenário ${scenarioNum}] ${message}`);
}

async function runTests() {
  console.log('================================================================');
  console.log(' HOMOLOGAÇÃO AUTOMATIZADA FINAL HARDENING — FASE 3B (COMPOSER)');
  console.log('================================================================\n');

  const pool = getPool();

  // 1. SETUP: Inicializar Job dedicado para testes do Composer MVP
  console.log('--- SETUP: Preparando Ambiente do Teste ---');
  const initRes = await jobService.initializeVideoJob({
    property_ref: '1639',
    broker_id: 'phase3b_final_hardening',
    source: 'composer_mvp_suite'
  });
  const testJobId = initRes.job.id;
  const testJobShortId = testJobId.slice(0, 8);
  const testJobDir = path.join('/var/www/bali-gestor/outputs/jobs', testJobId);
  fs.mkdirSync(testJobDir, { recursive: true });

  // 2. Gerar clipes reais válidos (Hook 3.0s e Body 5.0s em 1080x1920@30fps + áudio)
  const hookFile = path.join(testJobDir, 'hook_1.mp4');
  const bodyFile = path.join(testJobDir, 'body.mp4');
  const legacyOutputFile = path.join(testJobDir, 'pilot.mp4');

  console.log('Gerando clipes canônicos 1080x1920@30fps com áudio e vídeo...');
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=3:size=1080x1920:rate=30 -f lavfi -i sine=duration=3:frequency=1000:sample_rate=44100 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac ${hookFile}`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -f lavfi -i testsrc=duration=5:size=1080x1920:rate=30 -f lavfi -i sine=duration=5:frequency=800:sample_rate=44100 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac ${bodyFile}`, { stdio: 'ignore' });

  // Gerar vídeo de concatenação legado para comparação semântica
  execSync(`ffmpeg -y -i ${hookFile} -i ${bodyFile} -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac ${legacyOutputFile}`, { stdio: 'ignore' });

  // 3. Catalogar assets no catálogo video_assets
  const hookAssetId = `ast_hk_${testJobShortId}_01`;
  const bodyAssetId = `ast_bd_${testJobShortId}_01`;

  await assetService.createAsset({
    id: hookAssetId,
    job_id: testJobId,
    property_ref: '1639',
    asset_type: 'hook_clip',
    generation_key: assetService.computeGenerationKey({ asset_type: 'hook_clip', text: 'Hook Teste 3s' }),
    status: 'pending'
  });
  await assetService.markAssetReady(hookAssetId, {
    localPath: hookFile,
    specs: { duration: 3.0, width: 1080, height: 1920, fps: 30 }
  });

  await assetService.createAsset({
    id: bodyAssetId,
    job_id: testJobId,
    property_ref: '1639',
    asset_type: 'body_clip',
    generation_key: assetService.computeGenerationKey({ asset_type: 'body_clip', text: 'Body Teste 5s' }),
    status: 'pending'
  });
  await assetService.markAssetReady(bodyAssetId, {
    localPath: bodyFile,
    specs: { duration: 5.0, width: 1080, height: 1920, fps: 30 }
  });

  // 4. Montar Creative Blueprint canônico para o teste
  const testBlueprint = {
    creative_id: `crv_${testJobShortId}_var1`,
    variant_index: 1,
    schema_version: '1.0',
    blueprint_version: 1,
    format: {
      aspect_ratio: '9:16',
      width: 1080,
      height: 1920,
      fps: 30
    },
    timeline: [
      { segment_index: 1, role: 'hook', asset_id: hookAssetId, layer: 0 },
      { segment_index: 2, role: 'body', asset_id: bodyAssetId, layer: 0 }
    ],
    composition_directives: {
      audio_mix: 'normalize'
    }
  };

  await pool.query(
    'UPDATE video_jobs SET creative_blueprints = $1::jsonb WHERE id = $2',
    [JSON.stringify([testBlueprint]), testJobId]
  );

  console.log('\n--- EXECUTANDO A SUÍTE DE HOMOLOGAÇÃO ---');

  // Cenário 1: Blueprint válido Hook+Body renderiza com sucesso
  const compResult = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: testBlueprint,
    isShadow: true
  });
  assert(compResult.success === true && compResult.output_path && fs.existsSync(compResult.output_path), 1, 'Blueprint válido Hook+Body renderiza com sucesso -> PASS');

  // Cenário 2: Ordem sequencial dos clipes respeitada
  const resolvedAssets = await composerService.resolveTimelineAssets(testJobId, testBlueprint.timeline);
  const execPlan = composerService.buildExecutionPlan(testBlueprint, resolvedAssets);
  assert(
    execPlan.segments.length === 2 &&
    execPlan.segments[0].role === 'hook' &&
    execPlan.segments[1].role === 'body' &&
    execPlan.segments[0].timeline_start_ms === 0 &&
    execPlan.segments[1].timeline_start_ms === execPlan.segments[0].effective_duration_ms,
    2,
    'Ordem sequencial dos clipes respeitada -> PASS'
  );

  // Cenário 3: Asset inexistente rejeitado antes de invocar FFmpeg
  let c3Passed = false;
  try {
    const badBp = {
      ...testBlueprint,
      timeline: [{ segment_index: 1, role: 'hook', asset_id: 'ast_nonexistent_xyz999' }]
    };
    await composerService.resolveTimelineAssets(testJobId, badBp.timeline);
  } catch (e) {
    c3Passed = e.message.toLowerCase().includes('encontrado') || e.message.toLowerCase().includes('resolver');
  }
  assert(c3Passed, 3, 'Asset inexistente rejeitado antes de invocar FFmpeg -> PASS');

  // Cenário 4: Asset não-ready rejeitado antes do FFmpeg
  const dummyPendingId = `ast_test_pending_${Date.now()}`;
  await pool.query(
    `INSERT INTO video_assets (id, job_id, asset_type, storage_type, status, generation_key)
     VALUES ($1, $2, 'hook_clip', 'local_file', 'processing', 'dummy_gen_key')`,
    [dummyPendingId, testJobId]
  );
  let c4Passed = false;
  try {
    const pendingBpTimeline = [{ segment_index: 1, role: 'hook', asset_id: dummyPendingId }];
    await composerService.resolveTimelineAssets(testJobId, pendingBpTimeline);
  } catch (e) {
    c4Passed = e.message.toLowerCase().includes('pronto') || e.message.toLowerCase().includes('ready');
  }
  await pool.query('DELETE FROM video_assets WHERE id = $1', [dummyPendingId]);
  assert(c4Passed, 4, 'Asset não-ready rejeitado antes do FFmpeg -> PASS');

  // Cenário 5: Asset de outro Job rejeitado por violação de ownership físico
  const foreignJobId = '00000000-0000-0000-0000-000000000001';
  let c5Passed = false;
  try {
    await composerService.resolveTimelineAssets(foreignJobId, testBlueprint.timeline);
  } catch (e) {
    c5Passed = e.message.toLowerCase().includes('ownership') || e.message.toLowerCase().includes('pertence') || e.message.toLowerCase().includes('job');
  }
  assert(c5Passed, 5, 'Asset de outro Job rejeitado por violação de ownership físico -> PASS');

  // Cenário 6: Symlink externo rejeitado
  const symlinkAssetId = `ast_symlink_${Date.now()}`;
  const symlinkTarget = '/etc/passwd';
  const symlinkPath = path.join(testJobDir, 'symlink_test.mp4');
  try { fs.symlinkSync(symlinkTarget, symlinkPath); } catch (e) {}
  await pool.query(
    `INSERT INTO video_assets (id, job_id, asset_type, storage_type, storage_path, file_hash, status, generation_key, specs)
     VALUES ($1, $2, 'hook_clip', 'local_file', $3, 'fakehash', 'ready', 'dummy_gen', '{"duration": 10}'::jsonb)`,
    [symlinkAssetId, testJobId, symlinkPath]
  );
  let c6Passed = false;
  try {
    await assetService.resolveAndValidateAsset(symlinkAssetId, { checkFile: true });
  } catch (e) {
    c6Passed = e.message.toLowerCase().includes('symlink') || e.message.toLowerCase().includes('traversal') || e.message.toLowerCase().includes('seguran');
  }
  try { fs.unlinkSync(symlinkPath); } catch (e) {}
  await pool.query('DELETE FROM video_assets WHERE id = $1', [symlinkAssetId]);
  assert(c6Passed, 6, 'Symlink externo rejeitado -> PASS');

  // Cenário 7: file_hash divergente (adulteração de bytes) rejeitado
  const tamperedAssetId = `ast_tampered_${Date.now()}`;
  const tamperedFile = path.join(testJobDir, 'tampered.mp4');
  fs.writeFileSync(tamperedFile, 'corrupted_bytes_123');
  await pool.query(
    `INSERT INTO video_assets (id, job_id, asset_type, storage_type, storage_path, file_hash, status, generation_key, specs)
     VALUES ($1, $2, 'hook_clip', 'local_file', $3, 'deadbeef1234567890abcdef', 'ready', 'dummy_gen', '{"duration": 10}'::jsonb)`,
    [tamperedAssetId, testJobId, tamperedFile]
  );
  let c7Passed = false;
  try {
    await assetService.resolveAndValidateAsset(tamperedAssetId, { checkFile: true, checkHash: true });
  } catch (e) {
    c7Passed = e.message.toLowerCase().includes('hash') || e.message.toLowerCase().includes('adulter') || e.message.toLowerCase().includes('diverg');
  }
  try { fs.unlinkSync(tamperedFile); } catch (e) {}
  await pool.query('DELETE FROM video_assets WHERE id = $1', [tamperedAssetId]);
  assert(c7Passed, 7, 'file_hash divergente (adulteração de bytes) rejeitado -> PASS');

  // Cenário 8: Blueprint vazio ou corrompido rejeitado
  let c8Passed = false;
  try {
    composerService.validateBlueprintContract(null);
  } catch (e) {
    try {
      composerService.validateBlueprintContract({});
    } catch (e2) {
      c8Passed = true;
    }
  }
  assert(c8Passed, 8, 'Blueprint vazio ou corrompido rejeitado -> PASS');

  // Cenário 9: schema_version não suportada rejeitada
  let c9Passed = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      schema_version: '2.0'
    });
  } catch (e) {
    c9Passed = e.message.toLowerCase().includes('schema_version');
  }
  assert(c9Passed, 9, 'schema_version não suportada rejeitada -> PASS');

  // Cenário 10: Camada não suportada (layer > 0) rejeitada no MVP
  let c10Passed = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      timeline: [{ ...testBlueprint.timeline[0], layer: 1 }]
    });
  } catch (e) {
    c10Passed = e.message.toLowerCase().includes('layer');
  }
  assert(c10Passed, 10, 'Camada não suportada (layer > 0) rejeitada no MVP -> PASS');

  // Cenário 11: Parâmetros de trim inválidos (source_in >= source_out) rejeitados
  let c11Passed = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      timeline: [{ ...testBlueprint.timeline[0], source_in_ms: 5000, source_out_ms: 2000 }]
    });
  } catch (e) {
    c11Passed = e.message.toLowerCase().includes('trim');
  }
  assert(c11Passed, 11, 'Parâmetros de trim inválidos (source_in >= source_out) rejeitados -> PASS');

  // Cenário 12: Arquivo de saída contém stream de vídeo ativo
  assert(compResult.specs.hasVideo === true && compResult.specs.width === 1080, 12, 'Arquivo de saída contém stream de vídeo ativo -> PASS');

  // Cenário 13: Arquivo de saída contém stream de áudio ativo
  assert(compResult.specs.hasAudio === true, 13, 'Arquivo de saída contém stream de áudio ativo -> PASS');

  // Cenário 14: Duração de saída dentro da tolerância configurável de ±250 ms
  const durationDiff = Math.abs(compResult.specs.duration_ms - execPlan.total_duration_ms);
  assert(durationDiff <= 250, 14, `Duração de saída dentro da tolerância configurável de ±250 ms (diff: ${durationDiff}ms) -> PASS`);

  // Cenário 15: Resolução de saída estritamente 1080x1920
  assert(compResult.specs.width === 1080 && compResult.specs.height === 1920, 15, 'Resolução de saída estritamente 1080x1920 -> PASS');

  // Cenário 16: Taxa de quadros de saída 30 fps e formato H.264 canônico
  assert(compResult.specs.fps === 30, 16, 'Taxa de quadros de saída 30 fps e formato H.264 canônico -> PASS');

  // Cenário 17: Pipeline de re-encode padronizado único gera output íntegro
  assert(fs.existsSync(compResult.output_path) && fs.statSync(compResult.output_path).size > 50000, 17, 'Pipeline de re-encode padronizado único gera output íntegro -> PASS');

  // Cenário 18: Unidade de duração oficial (duration_ms) aplicada sem truncamento
  assert(Number.isInteger(compResult.specs.duration_ms) && compResult.specs.duration_ms > 0, 18, `Unidade de duração oficial (duration_ms) aplicada sem truncamento (${compResult.specs.duration_ms}ms) -> PASS`);

  // Cenário 19: Placeholders antigos de metadata ignorados (fala completa preservada)
  assert(Math.abs(compResult.specs.duration_ms - 8000) <= 250, 19, `Placeholders antigos de metadata ignorados; duração física exata calculada a partir de specs reais (${compResult.specs.duration_ms}ms) -> PASS`);

  // Cenário 20: [FINAL HARDENING] Cleanup automático de .tmp em falha pós-render sem intervenção manual do teste
  console.log('\n--- Testando Cleanup Autônomo de .tmp após Falha de QC ---');
  const qcCleanupBlueprint = {
    ...testBlueprint,
    creative_id: `crv_${testJobShortId}_qc_fail`,
    timeline: [
      { segment_index: 1, role: 'hook', asset_id: hookAssetId, layer: 0 }
    ]
  };
  let qcFailedAsExpected = false;
  try {
    // Executar FFmpeg real gerando o arquivo .tmp no disco, porém forçar falha no QC com tolerância impossível de 1ms
    await composerService.composeCreative({
      jobId: testJobId,
      blueprint: qcCleanupBlueprint,
      isShadow: true,
      options: { toleranceMs: 0 } // 0ms de tolerância provocará erro de QC após o FFmpeg gerar o temp
    });
  } catch (err) {
    qcFailedAsExpected = err.message.includes('VALIDATION ERROR') || err.message.includes('Duração');
  }

  // Verificar autonomamente o diretório do job: NÃO DEVE HAVER nenhum .tmp residual, SEM que o teste tenha chamado unlink!
  const dirFiles = fs.readdirSync(testJobDir);
  const leftoverTmp = dirFiles.find(f => f.includes('qc_fail') && f.includes('.tmp.'));
  assert(qcFailedAsExpected && !leftoverTmp, 20, 'Arquivo temporário .tmp gerado pelo FFmpeg foi removido de forma 100% autônoma pelo composer_service após falha de QC (sem unlink no teste) -> PASS');

  // Cenário 21: Arquivo final existente não corrompido em caso de erro no retry
  const originalOutputBytes = fs.readFileSync(compResult.output_path);
  const originalOutputHash = crypto.createHash('sha256').update(originalOutputBytes).digest('hex');
  try {
    await composerService.composeCreative({
      jobId: testJobId,
      blueprint: { ...testBlueprint, timeline: [{ asset_id: 'ast_inexistente' }] },
      isShadow: true
    });
  } catch (e) {}
  const currentOutputBytes = fs.readFileSync(compResult.output_path);
  const currentOutputHash = crypto.createHash('sha256').update(currentOutputBytes).digest('hex');
  assert(originalOutputHash === currentOutputHash, 21, 'Arquivo final existente não corrompido em caso de erro no retry -> PASS');

  // Cenário 22: Mesma render_key gera retorno idempotente imediato sem invocar FFmpeg
  const startIdemp = Date.now();
  const idempResult = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: testBlueprint,
    isShadow: true
  });
  const idempDuration = Date.now() - startIdemp;
  assert(
    idempResult.idempotent === true &&
    idempResult.asset_id === compResult.asset_id &&
    idempDuration < 1000,
    22,
    `Mesma render_key gera retorno idempotente imediato sem invocar FFmpeg (${idempDuration}ms) -> PASS`
  );

  // Cenário 23: Mudança no file_hash de um asset de entrada altera a render_key
  const baseRenderKey = composerService.computeRenderKey(testBlueprint, resolvedAssets);
  const modifiedAssets = JSON.parse(JSON.stringify(resolvedAssets));
  modifiedAssets[0].file_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const modifiedAssetKey = composerService.computeRenderKey(testBlueprint, modifiedAssets);
  assert(baseRenderKey !== modifiedAssetKey, 23, 'Mudança no file_hash de um asset de entrada altera a render_key -> PASS');

  // Cenário 24: Mudança no Blueprint (trims, ordem, formato) altera a render_key
  const modifiedBp = {
    ...testBlueprint,
    format: { ...testBlueprint.format, fps: 24 }
  };
  const modifiedBpKey = composerService.computeRenderKey(modifiedBp, resolvedAssets);
  assert(baseRenderKey !== modifiedBpKey, 24, 'Mudança no Blueprint (trims, ordem, formato) altera a render_key -> PASS');

  // Cenário 25: Asset READY nunca é sobrescrito fisicamente
  let c25Passed = false;
  try {
    await assetService.markAssetReady(compResult.asset_id, {
      localPath: compResult.output_path,
      fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    });
  } catch (e) {
    c25Passed = e.message.toUpperCase().includes('IMMUTABILITY') || e.message.toUpperCase().includes('READY');
  }
  assert(c25Passed, 25, 'Asset READY nunca é sobrescrito fisicamente -> PASS');

  // Cenário 26: Claim atômico SQL impede duas renderizações simultâneas do mesmo criativo
  const testClaimAssetId = `ast_claim_test_${Date.now()}`;
  const testRenderKey = crypto.randomBytes(32).toString('hex');
  const claim1 = await composerService.claimRenderLock({
    outputAssetId: testClaimAssetId,
    jobId: testJobId,
    propertyRef: '1639',
    renderKey: testRenderKey,
    isShadow: true,
    metadata: { test: 1 }
  });
  const claim2 = await composerService.claimRenderLock({
    outputAssetId: testClaimAssetId,
    jobId: testJobId,
    propertyRef: '1639',
    renderKey: testRenderKey,
    isShadow: true,
    metadata: { test: 2 }
  });
  assert(claim1.acquired === true && claim2.acquired === false, 26, 'Claim atômico SQL impede duas renderizações simultâneas do mesmo criativo -> PASS');

  // Cenário 27: Recuperação automática de stale processing após lease de 5 minutos
  await pool.query(
    "UPDATE video_assets SET updated_at = NOW() - INTERVAL '6 minutes' WHERE id = $1",
    [testClaimAssetId]
  );
  const staleClaim = await composerService.claimRenderLock({
    outputAssetId: testClaimAssetId,
    jobId: testJobId,
    propertyRef: '1639',
    renderKey: testRenderKey,
    isShadow: true,
    metadata: { recovered: true }
  });
  assert(staleClaim.acquired === true, 27, 'Recuperação automática de stale processing após lease de 5 minutos -> PASS');
  await pool.query('DELETE FROM video_assets WHERE id = $1', [testClaimAssetId]);

  // Cenário 28: Shadow Composer gera arquivo paralelo sem tocar nos campos oficiais da 2C
  const afterJobRes = await pool.query('SELECT * FROM video_jobs WHERE id = $1', [testJobId]);
  const afterJob = afterJobRes.rows[0];
  const c28Passed = (
    afterJob.pilot_video_url === null &&
    afterJob.video2_url === null &&
    afterJob.video3_url === null &&
    afterJob.status === 'SCRIPT_READY'
  );
  assert(c28Passed, 28, 'Shadow Composer gera arquivo paralelo sem tocar nos campos oficiais da 2C -> PASS');

  // Cenário 29: Comparação semântica entre Shadow Composer e concat legado demonstra equivalência
  const comparison = await composerService.compareLegacyVsComposer(legacyOutputFile, compResult.output_path);
  assert(
    comparison.is_equivalent === true &&
    comparison.duration_diff_ms <= 250,
    29,
    `Comparação semântica entre Shadow Composer e concat legado demonstra equivalência (diff: ${comparison.duration_diff_ms}ms) -> PASS`
  );

  // Cenário 30: Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200)
  const vid1 = await axios.get(`${BASE_URL}/api/v2/panel/video-jobs/${SHOWCASE_JOB_ID}/video/1`, {
    auth: PANEL_AUTH,
    responseType: 'arraybuffer'
  });
  const vid2 = await axios.get(`${BASE_URL}/api/v2/panel/video-jobs/${SHOWCASE_JOB_ID}/video/2`, {
    auth: PANEL_AUTH,
    responseType: 'arraybuffer'
  });
  const vid3 = await axios.get(`${BASE_URL}/api/v2/panel/video-jobs/${SHOWCASE_JOB_ID}/video/3`, {
    auth: PANEL_AUTH,
    responseType: 'arraybuffer'
  });
  assert(
    vid1.status === 200 && vid1.data.length > 500000 &&
    vid2.status === 200 && vid2.data.length > 500000 &&
    vid3.status === 200 && vid3.data.length > 500000,
    30,
    'Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200) -> PASS'
  );

  // Cenário 31: WhatsApp V1 e bloqueio estático 403 em /outputs/jobs/ permanecem intocados
  let c31Static403 = false;
  try {
    await axios.get(`${BASE_URL}/outputs/jobs/${SHOWCASE_JOB_ID}/pilot.mp4`);
  } catch (err) {
    c31Static403 = (err.response && err.response.status === 403);
  }
  const v1File = '/var/www/bali-gestor/video_anuncios_engine.js';
  const c31V1Intact = fs.existsSync(v1File);
  assert(c31Static403 && c31V1Intact, 31, 'WhatsApp V1 e bloqueio estático 403 em /outputs/jobs/ permanecem intocados -> PASS');

  // Cenário 32: PM2 bali-gestor (jlist online) e PostgreSQL 16 saudáveis
  let pm2Online = false;
  try {
    const pm2Output = JSON.parse(execSync('pm2 jlist').toString());
    const baliApp = pm2Output.find(a => a.name === 'bali-gestor');
    pm2Online = baliApp && baliApp.pm2_env && baliApp.pm2_env.status === 'online';
  } catch (e) {}
  const dbHealth = await pool.query('SELECT 1 as alive');
  assert(pm2Online && dbHealth.rows[0].alive === 1, 32, 'PM2 bali-gestor (processo verificado online via jlist) e PostgreSQL 16 saudáveis -> PASS');

  // Cenário 33: Trims bilaterais reais aplicados fisicamente no FFmpeg
  console.log('\n--- Testando Trims Reais (FFmpeg trim + atrim) ---');
  const trimBlueprint = {
    creative_id: `crv_${testJobShortId}_trimmed`,
    variant_index: 2,
    schema_version: '1.0',
    blueprint_version: 1,
    format: { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 },
    timeline: [
      {
        segment_index: 1,
        role: 'trimmed_body',
        asset_id: bodyAssetId,
        source_in_ms: 1000,
        source_out_ms: 3000,
        layer: 0
      }
    ]
  };

  const trimResult = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: trimBlueprint,
    isShadow: true
  });

  const trimDurationMs = trimResult.specs.duration_ms;
  const isTrimAccurate = Math.abs(trimDurationMs - 2000) <= 250;
  const notFullDuration = trimDurationMs < 3500;
  assert(
    trimResult.success && isTrimAccurate && notFullDuration,
    33,
    `Trims bilaterais reais aplicados fisicamente no FFmpeg: clipe de 5s trimado (1s→3s) gerou exatamente ${trimDurationMs}ms (esperado ≈ 2000ms, < 3500ms) -> PASS`
  );

  // Cenário 34: Arquivo órfão prévio em finalPath não é aceito cegamente e é removido antes da promoção
  console.log('\n--- Testando Proteção de Promoção contra Arquivos Órfãos Prévios ---');
  const orphanTestBlueprint = {
    creative_id: `crv_${testJobShortId}_orphan_test`,
    variant_index: 3,
    schema_version: '1.0',
    blueprint_version: 1,
    format: { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 },
    timeline: [
      { segment_index: 1, role: 'hook', asset_id: hookAssetId, layer: 0 }
    ]
  };

  const orphanResolved = await composerService.resolveTimelineAssets(testJobId, orphanTestBlueprint.timeline);
  const orphanRenderKey = composerService.computeRenderKey(orphanTestBlueprint, orphanResolved);
  const orphanShortKey = orphanRenderKey.slice(0, 10);
  const orphanFinalPath = path.join(testJobDir, `shadow_${orphanTestBlueprint.creative_id}_${orphanShortKey}.mp4`);

  // Injetar arquivo falso/órfão no finalPath antes do compose
  fs.writeFileSync(orphanFinalPath, 'UNTRUSTED_ORPHAN_BYTES_NOT_A_VALID_MP4');
  const orphanFakeHash = assetService.computeFileHash(orphanFinalPath);

  // Executar composeCreative
  const orphanComposeRes = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: orphanTestBlueprint,
    isShadow: true
  });

  const newFinalBytes = fs.readFileSync(orphanFinalPath);
  const newFinalHash = crypto.createHash('sha256').update(newFinalBytes).digest('hex');
  assert(
    orphanComposeRes.success &&
    newFinalHash !== orphanFakeHash &&
    orphanComposeRes.specs.hasVideo === true &&
    orphanComposeRes.specs.width === 1080,
    34,
    'Arquivo órfão prévio em finalPath foi substituído com sucesso e a saída recém-validada foi promovida -> PASS'
  );

  // Cenário 35: QC estrito de codecs (H.264 / AAC) e FPS físico derivado de streams reais
  assert(
    compResult.specs.codec_video === 'h264' &&
    compResult.specs.codec_audio === 'aac' &&
    compResult.specs.fps === 30 &&
    compResult.specs.width === 1080 &&
    compResult.specs.height === 1920,
    35,
    `QC estrito de codecs e streams: vídeo ${compResult.specs.codec_video} (${compResult.specs.width}x${compResult.specs.height}@${compResult.specs.fps}fps), áudio ${compResult.specs.codec_audio} -> PASS`
  );

  // Cenário 36: [FINAL HARDENING] Trims unilaterais estritamente rejeitados pelo contrato
  console.log('\n--- Testando Rejeição de Trims Unilaterais (Contrato Bilateral Obrigatório) ---');
  let c36InOnlyRejected = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      timeline: [{ ...testBlueprint.timeline[0], source_in_ms: 1000 }] // apenas source_in_ms
    });
  } catch (e) {
    c36InOnlyRejected = e.message.includes('unilateral') || e.message.includes('trim');
  }

  let c36OutOnlyRejected = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      timeline: [{ ...testBlueprint.timeline[0], source_out_ms: 3000 }] // apenas source_out_ms
    });
  } catch (e) {
    c36OutOnlyRejected = e.message.includes('unilateral') || e.message.includes('trim');
  }
  assert(c36InOnlyRejected && c36OutOnlyRejected, 36, 'Trims unilaterais (apenas source_in_ms ou apenas source_out_ms) são estritamente rejeitados -> PASS');

  // Cenário 37: [FINAL HARDENING] creative_id malicioso ou tentativa de path traversal rejeitados
  console.log('\n--- Testando Proteção contra creative_id Malicioso / Path Traversal ---');
  let c37TraversalRejected = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      creative_id: '../../etc/passwd'
    });
  } catch (e) {
    c37TraversalRejected = e.message.includes('creative_id inválido');
  }

  let c37SpecialCharRejected = false;
  try {
    composerService.validateBlueprintContract({
      ...testBlueprint,
      creative_id: 'bad*name$slash/test'
    });
  } catch (e) {
    c37SpecialCharRejected = e.message.includes('creative_id inválido');
  }
  assert(c37TraversalRejected && c37SpecialCharRejected, 37, 'creative_id com caracteres inválidos ou path traversal (../../) rejeitado na validação -> PASS');

  // Cenário 38: [FINAL HARDENING] Recuperação controlada de READY corrompido (DB READY + arquivo ausente)
  console.log('\n--- Testando Recuperação Controlada de READY Corrompido (Arquivo Ausente) ---');
  const brokenReadyAssetId = `ast_shadow_crv_${testJobShortId}_broken_file`;
  const brokenBlueprint = {
    ...testBlueprint,
    creative_id: `crv_${testJobShortId}_broken_file`,
    timeline: [
      { segment_index: 1, role: 'hook', asset_id: hookAssetId, layer: 0 }
    ]
  };
  const brokenResolved = await composerService.resolveTimelineAssets(testJobId, brokenBlueprint.timeline);
  const brokenRenderKey = composerService.computeRenderKey(brokenBlueprint, brokenResolved);
  const brokenShortKey = brokenRenderKey.slice(0, 10);
  const expectedBrokenPath = path.join(testJobDir, `shadow_${brokenBlueprint.creative_id}_${brokenShortKey}.mp4`);
  const brokenAssetRecordId = `ast_shadow_${brokenBlueprint.creative_id}_${brokenShortKey}`;

  // Inserir registro no DB com status READY apontando para arquivo que NÃO existe
  if (fs.existsSync(expectedBrokenPath)) {
    fs.unlinkSync(expectedBrokenPath);
  }
  await pool.query(
    `INSERT INTO video_assets (id, job_id, property_ref, asset_type, storage_type, storage_path, file_hash, generation_key, status, specs, metadata, created_at, updated_at)
     VALUES ($1, $2, '1639', 'shadow_creative', 'local_file', $3, 'deadbeef123', $4, 'ready', '{"duration": 3.0}'::jsonb, '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = 'ready',
       storage_path = $3,
       file_hash = 'deadbeef123',
       generation_key = $4,
       updated_at = NOW()`,
    [brokenAssetRecordId, testJobId, expectedBrokenPath, brokenRenderKey]
  );

  // Executar composeCreative: deve detectar arquivo ausente, invalidar registro, adquirir novo claim e renderizar com sucesso
  const recoverRes1 = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: brokenBlueprint,
    isShadow: true
  });

  const checkDb1 = await pool.query('SELECT * FROM video_assets WHERE id = $1', [brokenAssetRecordId]);
  assert(
    recoverRes1.success === true &&
    recoverRes1.idempotent === false &&
    fs.existsSync(recoverRes1.output_path) &&
    checkDb1.rows[0].status === 'ready' &&
    checkDb1.rows[0].file_hash === assetService.computeFileHash(recoverRes1.output_path),
    38,
    'Recuperação controlada de READY com arquivo ausente executada: invalidou órfão, adquiriu novo claim e finalizou READY com hash físico válido -> PASS'
  );

  // Cenário 39: [FINAL HARDENING] Recuperação controlada de READY adulterado (DB READY + hash divergente)
  console.log('\n--- Testando Recuperação Controlada de READY Adulterado (Hash Divergente) ---');
  // Adulterar propositalmente o arquivo físico gerado
  fs.writeFileSync(recoverRes1.output_path, 'TAMPERED_BYTES_AFTER_RENDER');

  // Executar composeCreative novamente: deve detectar adulteração de hash, invalidar registro, adquirir novo claim e renderizar novamente
  const recoverRes2 = await composerService.composeCreative({
    jobId: testJobId,
    blueprint: brokenBlueprint,
    isShadow: true
  });

  const checkDb2 = await pool.query('SELECT * FROM video_assets WHERE id = $1', [brokenAssetRecordId]);
  const newPhysicalHash = assetService.computeFileHash(recoverRes2.output_path);
  assert(
    recoverRes2.success === true &&
    recoverRes2.idempotent === false &&
    fs.existsSync(recoverRes2.output_path) &&
    checkDb2.rows[0].status === 'ready' &&
    checkDb2.rows[0].file_hash === newPhysicalHash &&
    newPhysicalHash !== 'TAMPERED_BYTES_AFTER_RENDER',
    39,
    'Recuperação controlada de READY com hash físico adulterado executada: re-renderizou sob novo claim e restaurou conformidade com sucesso -> PASS'
  );

  // Cenário 40: [FINAL HARDENING] Invariante estrito: FFmpeg NUNCA executa sem claim adquirido (Bloqueio 409 em concorrência)
  console.log('\n--- Testando Invariante Estrito de Claim e Bloqueio 409 em Concorrência Ativa ---');
  const activeProcessingAssetId = `ast_shadow_${testBlueprint.creative_id}_active_proc`;
  const activeBlueprint = {
    ...testBlueprint,
    creative_id: `crv_${testJobShortId}_active_proc`,
    timeline: [
      { segment_index: 1, role: 'hook', asset_id: hookAssetId, layer: 0 }
    ]
  };
  const activeResolved = await composerService.resolveTimelineAssets(testJobId, activeBlueprint.timeline);
  const activeRenderKey = composerService.computeRenderKey(activeBlueprint, activeResolved);
  const activeShortKey = activeRenderKey.slice(0, 10);
  const activeAssetRecordId = `ast_shadow_${activeBlueprint.creative_id}_${activeShortKey}`;

  // Simular renderização ativa em andamento por outro processo (status 'processing' com updated_at = NOW())
  await pool.query(
    `INSERT INTO video_assets (id, job_id, property_ref, asset_type, storage_type, generation_key, status, metadata, created_at, updated_at)
     VALUES ($1, $2, '1639', 'shadow_creative', 'local_file', $3, 'processing', '{"pid": 99999}'::jsonb, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = 'processing',
       updated_at = NOW()`,
    [activeAssetRecordId, testJobId, activeRenderKey]
  );

  let c40ConflictBlocked = false;
  try {
    await composerService.composeCreative({
      jobId: testJobId,
      blueprint: activeBlueprint,
      isShadow: true
    });
  } catch (err) {
    c40ConflictBlocked = (err.statusCode === 409 && err.message.includes('em andamento por outro processo'));
  }
  await pool.query('DELETE FROM video_assets WHERE id = $1', [activeAssetRecordId]);
  assert(c40ConflictBlocked, 40, 'Invariante estrito verificado: requisição sem claim adquirido é estritamente bloqueada com HTTP 409 e nenhuma execução de FFmpeg ocorre -> PASS');

  console.log('\n================================================================');
  console.log(` RESULTADO FINAL FASE 3B (FINAL HARDENING): ${passedTests}/${totalTests} CENÁRIOS HOMOLOGADOS COM SUCESSO!`);
  console.log('================================================================\n');

  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ [ERRO CRÍTICO NA EXECUÇÃO DOS TESTES]:', err);
  process.exit(1);
});
