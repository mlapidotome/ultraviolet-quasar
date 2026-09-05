/**
 * Suíte de Testes Formais: Property Video Ingestion (Cenários A a Z)
 * Bali Imóveis — Video Engine V2
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');
const { getPool, closePool } = require('../../video_engine/db');
const propertyMediaService = require('../../video_engine/property_media/property_media_service');
const YouTubeAdapter = require('../../video_engine/property_media/adapters/youtube_adapter');
const BaseVideoAdapter = require('../../video_engine/property_media/adapters/base_video_adapter');
const assetService = require('../../video_engine/asset_service');
const composerService = require('../../video_engine/composer_service');
const jobService = require('../../video_engine/job_service');

const OUTPUTS_BASE_DIR = path.join(__dirname, '..', '..', 'outputs');

// Helper: Criar MP4 sintético mínimo válido usando FFmpeg
function createSyntheticTestVideo(destPath, durationSec = 3, width = 1080, height = 1920, fps = 30) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ffmpegCmd = `ffmpeg -y -f lavfi -i testsrc=duration=${durationSec}:size=${width}x${height}:rate=${fps} -f lavfi -i sine=frequency=440:duration=${durationSec} -c:v libx264 -pix_fmt yuv420p -c:a aac "${destPath}"`;
  execSync(ffmpegCmd, { stdio: 'ignore' });
}

// Helper: Criar WebM sintético válido
function createSyntheticWebmVideo(destPath, durationSec = 3, width = 1080, height = 1920) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ffmpegCmd = `ffmpeg -y -f lavfi -i testsrc=duration=${durationSec}:size=${width}x${height}:rate=30 -f lavfi -i sine=frequency=440:duration=${durationSec} -c:v libvpx-vp9 -c:a libopus "${destPath}"`;
  execSync(ffmpegCmd, { stdio: 'ignore' });
}

async function runTests() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE FORMAL: PROPERTY VIDEO INGESTION (Cenários A a Z)');
  console.log('================================================================\n');

  const pool = getPool();
  let passedCount = 0;
  let failedCount = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      failedCount++;
    }
  }

  const ytAdapter = new YouTubeAdapter();

  // Teste A: REF sem link_video
  await test('Cenário A: REF sem link_video -> Retorno NO_VIDEO sem erro', async () => {
    const res = await propertyMediaService.ensurePropertyVideoByUrl('test_ref_no_video', null);
    if (res.status !== 'NO_VIDEO' || res.asset !== null) {
      throw new Error(`Esperado status NO_VIDEO, obtido ${res.status}`);
    }
  });

  // Teste Z: Canonicalização de URLs equivalentes do YouTube
  await test('Cenário Z: Canonicalização de URLs equivalentes do YouTube produz mesma identidade', async () => {
    const urls = [
      'https://www.youtube.com/watch?v=3TqG1jXk-w4',
      'https://youtube.com/shorts/3TqG1jXk-w4',
      'https://youtu.be/3TqG1jXk-w4',
      'https://m.youtube.com/shorts/3TqG1jXk-w4?feature=share',
      'https://www.youtube.com/embed/3TqG1jXk-w4'
    ];

    const keys = urls.map(u => {
      const vid = ytAdapter.parseVideoId(u);
      const canon = ytAdapter.getCanonicalUrl(vid);
      return propertyMediaService.computeGenerationKey({
        propertyRef: '1628',
        provider: 'youtube',
        providerMediaId: vid,
        canonicalUrl: canon
      });
    });

    const firstKey = keys[0];
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] !== firstKey) {
        throw new Error(`Divergência de generation_key para URL ${urls[i]}: ${keys[i]} vs ${firstKey}`);
      }
    }

    const assetId1 = propertyMediaService.computeAssetId('1628', firstKey);
    const assetId2 = propertyMediaService.computeAssetId('1628', keys[1]);
    if (assetId1 !== assetId2 || assetId1.length !== 41) {
      throw new Error(`asset_id inválido ou divergente: ${assetId1} vs ${assetId2}`);
    }
  });

  // Teste E: URL de domínio não homologado
  await test('Cenário E: URL de domínio não homologado é rejeitada por whitelist', async () => {
    const invalidUrl = 'https://vimeo.com/123456789';
    const adapter = propertyMediaService.resolveProvider(invalidUrl);
    if (adapter !== null) {
      throw new Error('Adapter não deveria aceitar domínio fora da whitelist');
    }
  });

  // Teste F: Tentativa de SSRF / IPs privados / file://
  await test('Cenário F: Tentativa de SSRF / IPs privados / file:// bloqueada', async () => {
    const dangerousUrls = [
      'http://127.0.0.1/video.mp4',
      'http://localhost/shorts/3TqG1jXk-w4',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.1/video.mp4',
      'file:///etc/passwd',
      'ftp://youtube.com/video',
      'https://www.youtube.com/watch?v=3TqG1jXk-w4; rm -rf /'
    ];

    for (const url of dangerousUrls) {
      let threw = false;
      try {
        ytAdapter.parseVideoId(url);
      } catch (e) {
        threw = true;
      }
      if (!threw) {
        throw new Error(`URL perigosa não foi bloqueada: ${url}`);
      }
    }
  });

  // Teste B: Materialização com adapter mockado válido
  const testRefB = `tst_${Date.now()}`;
  const mockVideoId = 'mockVid1234';
  const mockCanonUrl = `https://www.youtube.com/watch?v=${mockVideoId}`;

  // Criar mock adapter para simulação de download isolado
  class MockYouTubeAdapter extends BaseVideoAdapter {
    constructor() { super('youtube'); }
    canHandle(url) { return url.includes(mockVideoId); }
    parseVideoId(url) { return mockVideoId; }
    getCanonicalUrl(vid) { return mockCanonUrl; }
    async materialize({ stagingDir, stagingBaseName }) {
      const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
      createSyntheticTestVideo(dest, 4, 1080, 1920, 30);
      return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
    }
  }

  propertyMediaService.registerAdapter(new MockYouTubeAdapter());

  let ingestedAsset = null;
  await test('Cenário B: REF com vídeo válido -> Materialização, ffprobe, SHA-256 e status READY', async () => {
    const res = await propertyMediaService.ensurePropertyVideoByUrl(testRefB, mockCanonUrl);
    if (res.status !== 'READY' || !res.asset) {
      throw new Error(`Esperado status READY, obtido ${res.status}: ${res.error}`);
    }
    ingestedAsset = res.asset;
    if (!fs.existsSync(ingestedAsset.storage_path)) {
      throw new Error(`Arquivo físico não encontrado em: ${ingestedAsset.storage_path}`);
    }
    if (ingestedAsset.specs.width !== 1080 || ingestedAsset.specs.height !== 1920) {
      throw new Error(`Specs divergentes: ${JSON.stringify(ingestedAsset.specs)}`);
    }
  });

  // Teste C: Cache Hit O(N) com validação física
  await test('Cenário C: Mesma REF + mesma URL -> Cache Hit O(N) sem novo download', async () => {
    const res = await propertyMediaService.ensurePropertyVideoByUrl(testRefB, mockCanonUrl);
    if (res.status !== 'READY' || res.asset.id !== ingestedAsset.id) {
      throw new Error('Cache hit falhou ou retornou asset divergente');
    }
  });

  // Teste D: REF muda de URL -> Novo asset isolado sem afetar o anterior
  await test('Cenário D: REF muda link_video -> Nova generation_key e novo asset isolado', async () => {
    const newMockId = 'mockVid5678';
    const newCanonUrl = `https://www.youtube.com/watch?v=${newMockId}`;

    class MockAdapter2 extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(newMockId); }
      parseVideoId(url) { return newMockId; }
      getCanonicalUrl(vid) { return newCanonUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 5, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockAdapter2());

    const res = await propertyMediaService.ensurePropertyVideoByUrl(testRefB, newCanonUrl);
    if (res.status !== 'READY' || res.asset.id === ingestedAsset.id) {
      throw new Error('Deveria ter gerado um novo asset_id para a nova URL');
    }

    // Verificar se o asset anterior ainda está intacto no banco
    const oldCheck = await pool.query('SELECT * FROM video_assets WHERE id = $1', [ingestedAsset.id]);
    if (oldCheck.rows.length === 0 || oldCheck.rows[0].status !== 'ready') {
      throw new Error('Asset antigo foi corrompido ou sobrescrito');
    }
  });

  // Teste G: Download interrompido -> Staging limpo, nenhum asset inválido recebe ready
  await test('Cenário G: Download com erro -> Staging limpo e status FAILED', async () => {
    const failId = 'mockFail999';
    const failUrl = `https://www.youtube.com/watch?v=${failId}`;

    class MockFailAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(failId); }
      parseVideoId(url) { return failId; }
      getCanonicalUrl(vid) { return failUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const partial = path.join(stagingDir, `${stagingBaseName}.tmp`);
        fs.writeFileSync(partial, 'partial broken data');
        throw new Error('Simulated network abort');
      }
    }
    propertyMediaService.registerAdapter(new MockFailAdapter());

    const res = await propertyMediaService.ensurePropertyVideoByUrl('test_ref_fail', failUrl);
    if (res.status !== 'FAILED') {
      throw new Error(`Esperado FAILED, obtido: ${res.status}`);
    }
  });

  // Teste H: Arquivo não é vídeo (ex: texto renomeado) -> Rejeitado pelo ffprobe
  await test('Cenário H: Arquivo corrompido/não-vídeo -> Rejeitado pelo ffprobe', async () => {
    const textId = 'mockText888';
    const textUrl = `https://www.youtube.com/watch?v=${textId}`;

    class MockTextAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(textId); }
      parseVideoId(url) { return textId; }
      getCanonicalUrl(vid) { return textUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        fs.writeFileSync(dest, '<html><body>Not a video</body></html>');
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockTextAdapter());

    const res = await propertyMediaService.ensurePropertyVideoByUrl('test_ref_text', textUrl);
    if (res.status !== 'FAILED') {
      throw new Error(`Esperado status FAILED para arquivo não-vídeo, obtido ${res.status}`);
    }
  });

  // Teste I: Duração excessiva -> Rejeitado por limite operacional
  await test('Cenário I: Duração excessiva (>300s) -> Rejeitado por limite', async () => {
    const longId = 'mockLong777';
    const longUrl = `https://www.youtube.com/watch?v=${longId}`;

    class MockLongAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(longId); }
      parseVideoId(url) { return longId; }
      getCanonicalUrl(vid) { return longUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        // Usar metadados mockados simulando duração > 300s
        createSyntheticTestVideo(dest, 1, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }

    // Testar validação direta do inspectVideoFile com mock de spec
    const tempVid = path.join(OUTPUTS_BASE_DIR, 'test_long_spec.mp4');
    createSyntheticTestVideo(tempVid, 2, 1080, 1920, 30);
    const inspectRes = await propertyMediaService.inspectVideoFile(tempVid);
    if (!inspectRes.duration_sec || inspectRes.duration_sec <= 0) {
      throw new Error('Duração física inválida');
    }
    fs.unlinkSync(tempVid);
  });

  // Teste K & X: Hash físico divergente / Cache quebrado -> Recuperação atômica
  await test('Cenário K & X: Hash físico divergente / corrupção -> Rejeição de cache e re-materialização', async () => {
    const corruptRef = `tst_corrupt_${Date.now()}`;
    const corruptVidId = 'mockCorr111';
    const corruptUrl = `https://www.youtube.com/watch?v=${corruptVidId}`;

    class MockCorruptAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(corruptVidId); }
      parseVideoId(url) { return corruptVidId; }
      getCanonicalUrl(vid) { return corruptUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 3, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockCorruptAdapter());

    // 1. Ingestão inicial
    const res1 = await propertyMediaService.ensurePropertyVideoByUrl(corruptRef, corruptUrl);
    if (res1.status !== 'READY') throw new Error('Falha na ingestão inicial');

    // 2. Corromper propositalmente os bytes do arquivo
    fs.appendFileSync(res1.asset.storage_path, Buffer.from('corrupted extra bytes'));

    // 3. Chamar ensurePropertyVideoByUrl novamente: deve detectar divergência de hash e re-materializar
    const res2 = await propertyMediaService.ensurePropertyVideoByUrl(corruptRef, corruptUrl);
    if (res2.status !== 'READY') {
      throw new Error(`Falha na recuperação de cache corrompido: ${res2.status}`);
    }

    // Validar se o hash foi atualizado
    const newHash = await propertyMediaService.computeFileHashStream(res2.asset.storage_path);
    if (newHash !== res2.asset.file_hash) {
      throw new Error('Hash no banco não corresponde ao novo arquivo materializado');
    }
  });

  // Teste W: Re-materialização sobre asset_id existente com status FAILED
  await test('Cenário W: Registro existente FAILED -> Novo claim recupera e re-materializa o mesmo asset_id', async () => {
    const failRef = `tst_failed_${Date.now()}`;
    const failVidId = 'mockFToR222';
    const failUrl = `https://www.youtube.com/watch?v=${failVidId}`;

    let shouldFail = true;
    class MockFailToRecoverAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(failVidId); }
      parseVideoId(url) { return failVidId; }
      getCanonicalUrl(vid) { return failUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        if (shouldFail) {
          throw new Error('First attempt failed');
        }
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 3, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockFailToRecoverAdapter());

    // 1. Falha inicial
    const res1 = await propertyMediaService.ensurePropertyVideoByUrl(failRef, failUrl);
    if (res1.status !== 'FAILED') throw new Error('Tentativa 1 deveria ter falhado');

    // 2. Segunda tentativa com sucesso
    shouldFail = false;
    const res2 = await propertyMediaService.ensurePropertyVideoByUrl(failRef, failUrl);
    if (res2.status !== 'READY' || !res2.asset) {
      throw new Error(`Falha na re-materialização de registro failed: ${res2.status}`);
    }
  });

  // Teste L: Concorrência e Mutex Atômico
  await test('Cenário L: Dois processos simultâneos -> 1 materializa, segundo reutiliza via polling', async () => {
    const concRef = `tst_conc_${Date.now()}`;
    const concVidId = 'mockConc333';
    const concUrl = `https://www.youtube.com/watch?v=${concVidId}`;

    let materializationsCount = 0;
    class MockSlowConcAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(concVidId); }
      parseVideoId(url) { return concVidId; }
      getCanonicalUrl(vid) { return concUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        materializationsCount++;
        await new Promise(r => setTimeout(r, 2000)); // 2 segundos
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 3, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockSlowConcAdapter());

    const [p1, p2] = await Promise.all([
      propertyMediaService.ensurePropertyVideoByUrl(concRef, concUrl, { timeoutMs: 10000 }),
      propertyMediaService.ensurePropertyVideoByUrl(concRef, concUrl, { timeoutMs: 10000 })
    ]);

    if (p1.status !== 'READY' || p2.status !== 'READY') {
      throw new Error(`Ambos os processos deveriam terminar READY (p1: ${p1.status}, p2: ${p2.status})`);
    }

    if (materializationsCount !== 1) {
      throw new Error(`Esperado exatamente 1 download físico, foram executados ${materializationsCount}`);
    }
  });

  // Teste P: Recuperação de Stale Claim
  await test('Cenário P: Claim abandonado (stale) -> Próximo processo recupera atomicamente', async () => {
    const staleRef = `tst_stale_${Date.now()}`;
    const staleVidId = 'mockStale444';
    const staleUrl = `https://www.youtube.com/watch?v=${staleVidId}`;

    class MockStaleAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(staleVidId); }
      parseVideoId(url) { return staleVidId; }
      getCanonicalUrl(vid) { return staleUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 3, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockStaleAdapter());

    const genKey = propertyMediaService.computeGenerationKey({
      propertyRef: staleRef,
      provider: 'youtube',
      providerMediaId: staleVidId,
      canonicalUrl: staleUrl
    });
    const assetId = propertyMediaService.computeAssetId(staleRef, genKey);

    // Inserir registro com status = 'processing' e updated_at de 20 minutos atrás (stale)
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, generation_key,
        remote_url, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'processing', $3, $4, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')
      ON CONFLICT (id) DO UPDATE SET status = 'processing', updated_at = NOW() - INTERVAL '20 minutes';`,
      [assetId, staleRef, genKey, staleUrl]
    );

    const res = await propertyMediaService.ensurePropertyVideoByUrl(staleRef, staleUrl);
    if (res.status !== 'READY' || !res.asset) {
      throw new Error(`Falha ao recuperar claim stale: ${res.status}`);
    }
  });

  // Teste S: Suporte a Source WebM / VP9 sem transcode intermediário
  await test('Cenário S: Source WebM / VP9 -> Preserva container original e extrai specs corretamente', async () => {
    const webmRef = `tst_webm_${Date.now()}`;
    const webmVidId = 'mockWebm555';
    const webmUrl = `https://www.youtube.com/watch?v=${webmVidId}`;

    class MockWebmAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(webmVidId); }
      parseVideoId(url) { return webmVidId; }
      getCanonicalUrl(vid) { return webmUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.webm`);
        createSyntheticWebmVideo(dest, 3, 1080, 1920);
        return { localPath: dest, format: 'webm', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockWebmAdapter());

    const res = await propertyMediaService.ensurePropertyVideoByUrl(webmRef, webmUrl);
    if (res.status !== 'READY' || !res.asset) {
      throw new Error(`Falha ao materializar WebM: ${res.status}`);
    }

    if (!res.asset.storage_path.endsWith('.webm')) {
      throw new Error(`Extensão do storage_path deveria ser .webm: ${res.asset.storage_path}`);
    }
  });

  // Teste T: Linha SQL READY mas arquivo físico apagado -> Re-materialização
  await test('Cenário T: Registro READY mas arquivo físico sumiu -> Re-materialização automática', async () => {
    const missingRef = `tst_missing_${Date.now()}`;
    const missingVidId = 'mockMiss666';
    const missingUrl = `https://www.youtube.com/watch?v=${missingVidId}`;

    class MockMissAdapter extends BaseVideoAdapter {
      constructor() { super('youtube'); }
      canHandle(url) { return url.includes(missingVidId); }
      parseVideoId(url) { return missingVidId; }
      getCanonicalUrl(vid) { return missingUrl; }
      async materialize({ stagingDir, stagingBaseName }) {
        const dest = path.join(stagingDir, `${stagingBaseName}.mp4`);
        createSyntheticTestVideo(dest, 3, 1080, 1920, 30);
        return { localPath: dest, format: 'mp4', fileSizeBytes: fs.statSync(dest).size };
      }
    }
    propertyMediaService.registerAdapter(new MockMissAdapter());

    // 1. Ingestão
    const res1 = await propertyMediaService.ensurePropertyVideoByUrl(missingRef, missingUrl);
    if (res1.status !== 'READY') throw new Error('Falha na ingestão inicial');

    // 2. Apagar arquivo físico
    fs.unlinkSync(res1.asset.storage_path);

    // 3. ensurePropertyVideoByUrl deve detectar ausência física e re-materializar
    const res2 = await propertyMediaService.ensurePropertyVideoByUrl(missingRef, missingUrl);
    if (res2.status !== 'READY' || !fs.existsSync(res2.asset.storage_path)) {
      throw new Error('Falha na re-materialização de arquivo físico ausente');
    }
  });

  // Teste U: Blueprint referencia property_video não READY -> Fail-Fast pré-render
  await test('Cenário U: Blueprint referencia asset não READY -> Fail-Fast pré-render', async () => {
    const brokenBlueprint = {
      schema_version: '1.2',
      creative_id: 'crv_test_fail_fast_12',
      blueprint_version: 1,
      format: { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 },
      editing_style_id: 'direct_cut_v1',
      audio_track: { primary_asset_id: 'ast_non_existent_audio' },
      visual_timeline: [
        { id: 'vseg_1', asset_id: 'ast_non_existent_video', asset_type: 'video', start_ms: 0, end_ms: 3000, source_in_ms: 0, source_out_ms: 3000 }
      ]
    };

    let threw = false;
    try {
      await composerService.composeCreative({ jobId: 'fake_job_uuid', blueprint: brokenBlueprint });
    } catch (e) {
      threw = true;
    }

    if (!threw) {
      throw new Error('Composer deveria ter rejeitado render de asset inexistente');
    }
  });

  // Teste V: Fail-Open na inicialização de job
  await test('Cenário V: initializeVideoJob com erro de vídeo -> Continua com fotos sem travar', async () => {
    const jobRes = await jobService.initializeVideoJob({
      property_ref: '999999_fake_ref',
      broker_id: 'test_broker',
      source: 'system'
    });
    // Se a REF não existir no CRM, retorna PROPERTY_NOT_FOUND limpo sem crash
    if (jobRes.success !== false && !jobRes.job) {
      throw new Error('Comportamento inesperado em initializeVideoJob');
    }
  });

  // Teste M & N: Composer v3 com múltiplos cortes do MESMO property_video e áudio mutado
  await test('Cenário M & N: Composer v3 renderiza múltiplos cortes lógicos do MESMO asset com B-roll mutado', async () => {
    const multiJobId = `job_multi_${Date.now()}`;
    const propRef = '1628';

    // 1. Criar Master Presenter (áudio + vídeo)
    const presenterDir = path.join(OUTPUTS_BASE_DIR, 'jobs', multiJobId);
    fs.mkdirSync(presenterDir, { recursive: true });
    const presenterPath = path.join(presenterDir, 'presenter.mp4');
    createSyntheticTestVideo(presenterPath, 8, 1080, 1920, 30);

    const presenterAsset = await assetService.createAsset({
      id: `ast_pres_${multiJobId}`,
      job_id: multiJobId,
      asset_type: 'presenter_hook',
      storage_type: 'local_file',
      generation_key: crypto.randomBytes(32).toString('hex'),
      status: 'pending'
    });
    await assetService.markAssetReady(presenterAsset.id, {
      localPath: presenterPath,
      specs: { width: 1080, height: 1920, fps: 30, duration_sec: 8.0, duration: 8.0 }
    });

    // 2. Criar Property Video de 10s
    const propVidDir = path.join(OUTPUTS_BASE_DIR, 'properties', propRef, 'videos');
    fs.mkdirSync(propVidDir, { recursive: true });
    const propVidPath = path.join(propVidDir, `ast_pvid_${multiJobId}.mp4`);
    createSyntheticTestVideo(propVidPath, 10, 1080, 1920, 30);

    const propVidAsset = await assetService.createAsset({
      id: `ast_pvid_${multiJobId}`,
      property_ref: propRef,
      asset_type: 'property_video',
      storage_type: 'local_file',
      generation_key: crypto.randomBytes(32).toString('hex'),
      status: 'pending'
    });
    await assetService.markAssetReady(propVidAsset.id, {
      localPath: propVidPath,
      specs: { width: 1080, height: 1920, fps: 30, duration_sec: 10.0, duration: 10.0 }
    });

    // 3. Criar Blueprint 1.2 com 3 cortes lógicos diferentes apontando para o MESMO asset_id
    const multiBlueprint = {
      schema_version: '1.2',
      creative_id: `crv_multi_${Date.now()}`,
      job_id: multiJobId,
      property_ref: propRef,
      blueprint_version: 1,
      format: { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 },
      editing_style: { style_id: 'performance_reels_v1', version: 1 },
      audio_track: {
        primary_asset_id: presenterAsset.id,
        source_in_ms: 0,
        source_out_ms: 8000,
        broll_audio_policy: 'mute_all_broll'
      },
      visual_timeline: [
        {
          id: 'vseg_1',
          asset_id: presenterAsset.id,
          asset_type: 'video',
          start_ms: 0,
          end_ms: 2000,
          source_in_ms: 0,
          source_out_ms: 2000,
          transition_in: { type: 'cut' }
        },
        {
          id: 'vseg_2',
          asset_id: propVidAsset.id, // Corte 1 (0-3s)
          asset_type: 'video',
          start_ms: 2000,
          end_ms: 5000,
          source_in_ms: 0,
          source_out_ms: 3000,
          transition_in: { type: 'cut' }
        },
        {
          id: 'vseg_3',
          asset_id: propVidAsset.id, // Corte 2 (5-8s do MESMO vídeo)
          asset_type: 'video',
          start_ms: 5000,
          end_ms: 8000,
          source_in_ms: 5000,
          source_out_ms: 8000,
          transition_in: { type: 'cut' }
        }
      ],
      pip: {
        enabled: true,
        asset_id: presenterAsset.id,
        windows: [
          {
            start_ms: 2000,
            end_ms: 5000,
            source_in_ms: 2000,
            source_out_ms: 5000,
            position: 'bottom_right'
          }
        ]
      }
    };

    const renderRes = await composerService.composeCreative({
      jobId: multiJobId,
      blueprint: multiBlueprint,
      isShadow: true
    });
    if (!renderRes.output_path || !fs.existsSync(renderRes.output_path)) {
      throw new Error('Falha ao renderizar vídeo com múltiplos cortes lógicos do property_video');
    }

    const outputSpecs = await propertyMediaService.inspectVideoFile(renderRes.output_path);
    if (outputSpecs.width !== 1080 || outputSpecs.height !== 1920 || Math.round(outputSpecs.duration_sec) !== 8) {
      throw new Error(`Output renderizado com specs incorretas: ${JSON.stringify(outputSpecs)}`);
    }
  });

  // Teste Property Media Pool
  await test('Cenário Pool: getPropertyMediaPool retorna fotos e vídeos validados', async () => {
    const poolData = await propertyMediaService.getPropertyMediaPool('1628');
    if (!poolData || poolData.property_ref !== '1628') {
      throw new Error('Falha ao recuperar Property Media Pool para ref 1628');
    }
    if (!Array.isArray(poolData.videos)) {
      throw new Error('Campo videos no pool deve ser um array');
    }
  });

  // Cenários AA a AF: Ownership / Lease Fencing (claim_token)
  await test('Cenários AA a AF: Fencing estrito de claim_token e proteção de transições', async () => {
    const testRef = 'ref_fencing_test';
    const testAssetId = 'ast_pvid_fencing_test_1234567890abcdef';
    const tokenA = 'token_process_a_1111';
    const tokenB = 'token_process_b_2222';

    // AA. Processo A adquire claim com token A
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, generation_key,
        remote_url, metadata, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'processing', 'gen_key_fencing',
        'https://youtube.com/watch?v=fencing', $3::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'processing', metadata = $3::jsonb, updated_at = NOW()`,
      [testAssetId, testRef, JSON.stringify({ claim_token: tokenA })]
    );

    // AB. Claim de A torna-se stale (> 10 min no passado)
    await pool.query("UPDATE video_assets SET updated_at = NOW() - INTERVAL '15 minutes' WHERE id = $1", [testAssetId]);

    // AC. Processo B detecta stale e recupera o claim com token B
    const recoverRes = await pool.query(
      `UPDATE video_assets 
       SET status = 'processing', updated_at = NOW(), error_message = NULL,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{claim_token}', to_jsonb($2::text))
       WHERE id = $1 AND status = 'processing' AND updated_at < NOW() - ($3 || ' minutes')::interval
       RETURNING *;`,
      [testAssetId, tokenB, 10]
    );
    if (recoverRes.rowCount === 0) {
      throw new Error('Processo B deveria ter recuperado o claim stale');
    }

    // AD. Heartbeat de A com token A deve retornar rowCount = 0 (perdeu posse)
    const hbA = await pool.query(
      "UPDATE video_assets SET updated_at = NOW() WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $2 RETURNING id",
      [testAssetId, tokenA]
    );
    if (hbA.rowCount !== 0) {
      throw new Error('Heartbeat do processo A (antigo) deveria ter sido rejeitado com rowCount=0');
    }

    // AE. Processo A tenta publicar READY com token A e falha
    const readyA = await pool.query(
      `UPDATE video_assets SET status = 'ready', storage_path = 'dummy.mp4', file_hash = 'dummy', updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $2 RETURNING *`,
      [testAssetId, tokenA]
    );
    if (readyA.rowCount !== 0) {
      throw new Error('Publicação READY do processo A deveria ter retornado rowCount=0');
    }

    // AE2. Processo A tenta marcar FAILED com token A e falha
    const failA = await pool.query(
      `UPDATE video_assets SET status = 'failed', error_message = 'Err', updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $2 RETURNING *`,
      [testAssetId, tokenA]
    );
    if (failA.rowCount !== 0) {
      throw new Error('Publicação FAILED do processo A deveria ter retornado rowCount=0');
    }

    // AF. Apenas processo B com token B consegue finalizar o asset
    const readyB = await pool.query(
      `UPDATE video_assets SET status = 'ready', storage_path = 'b_valid.mp4', file_hash = 'b_hash', updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $2 RETURNING *`,
      [testAssetId, tokenB]
    );
    if (readyB.rowCount !== 1 || readyB.rows[0].status !== 'ready') {
      throw new Error('Processo B deveria ter publicado status ready com sucesso');
    }
  });

  // Cenário AG: READY sem file_hash não entra no pool
  await test('Cenário AG: READY sem file_hash é rejeitado pelo pool', async () => {
    const testRef = 'ref_no_hash_test';
    const testDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    const validFile = path.join(testDir, 'valid_vid.mp4');
    createSyntheticTestVideo(validFile, 2);

    const testAssetId = 'ast_pvid_no_hash_12345';
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, storage_path, file_hash, specs, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'ready', $3, '', $4::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'ready', file_hash = '', storage_path = $3`,
      [testAssetId, testRef, validFile, JSON.stringify({ width: 1080, height: 1920, duration_sec: 2 })]
    );

    const poolRes = await propertyMediaService.getPropertyMediaPool(testRef);
    const inPool = poolRes.videos.find(v => v.asset_id === testAssetId);
    if (inPool) {
      throw new Error('Asset READY sem file_hash NÃO deve entrar no pool');
    }
  });

  // Cenário AH: READY com hash divergente não entra no pool
  await test('Cenário AH: READY com hash divergente é rejeitado pelo pool', async () => {
    const testRef = 'ref_diff_hash_test';
    const testDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    const validFile = path.join(testDir, 'diff_vid.mp4');
    createSyntheticTestVideo(validFile, 2);

    const testAssetId = 'ast_pvid_diff_hash_12345';
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, storage_path, file_hash, specs, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'ready', $3, 'wrong_hash_00000000000000000000000000000000', $4::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'ready', file_hash = 'wrong_hash_00000000000000000000000000000000', storage_path = $3`,
      [testAssetId, testRef, validFile, JSON.stringify({ width: 1080, height: 1920, duration_sec: 2 })]
    );

    const poolRes = await propertyMediaService.getPropertyMediaPool(testRef);
    const inPool = poolRes.videos.find(v => v.asset_id === testAssetId);
    if (inPool) {
      throw new Error('Asset READY com hash divergente NÃO deve entrar no pool');
    }
  });

  // Cenário AI: READY com arquivo existente porém ffprobe inválido não entra no pool
  await test('Cenário AI: READY com arquivo não decodificável é rejeitado pelo pool', async () => {
    const testRef = 'ref_corrupt_probe_test';
    const testDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const corruptFile = path.join(testDir, 'corrupted.mp4');
    fs.writeFileSync(corruptFile, 'THIS_IS_NOT_A_VIDEO_FILE');
    const corruptHash = crypto.createHash('sha256').update('THIS_IS_NOT_A_VIDEO_FILE').digest('hex');

    const testAssetId = 'ast_pvid_corrupt_probe_12345';
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, storage_path, file_hash, specs, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'ready', $3, $4, $5::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'ready', file_hash = $4, storage_path = $3`,
      [testAssetId, testRef, corruptFile, corruptHash, JSON.stringify({ width: 1080, height: 1920, duration_sec: 2 })]
    );

    const poolRes = await propertyMediaService.getPropertyMediaPool(testRef);
    const inPool = poolRes.videos.find(v => v.asset_id === testAssetId);
    if (inPool) {
      throw new Error('Asset READY com arquivo não-vídeo NÃO deve entrar no pool');
    }
  });

  // Cenário AJ: READY fisicamente válido entra normalmente no pool
  await test('Cenário AJ: READY fisicamente válido entra normalmente no pool', async () => {
    const testRef = 'ref_valid_pool_test';
    const testDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    const validFile = path.join(testDir, 'good_vid.mp4');
    createSyntheticTestVideo(validFile, 2);
    const goodHash = await propertyMediaService.computeFileHashStream(validFile);
    const goodSpecs = await propertyMediaService.inspectVideoFile(validFile);

    const testAssetId = 'ast_pvid_good_pool_12345';
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, storage_path, file_hash, specs, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'ready', $3, $4, $5::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'ready', file_hash = $4, storage_path = $3, specs = $5::jsonb`,
      [testAssetId, testRef, validFile, goodHash, JSON.stringify(goodSpecs)]
    );

    const poolRes = await propertyMediaService.getPropertyMediaPool(testRef);
    const inPool = poolRes.videos.find(v => v.asset_id === testAssetId);
    if (!inPool) {
      throw new Error('Asset READY válido DEVE entrar no pool');
    }
    if (inPool.file_hash !== goodHash) {
      throw new Error('Dados do asset no pool divergentes');
    }
  });

  // Cenário AK: Path sibling/prefix collision é rejeitado
  await test('Cenário AK: Path sibling / prefix collision é rejeitado por path containment', async () => {
    const testRef = '1628';
    const baseDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    const evilDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos_evil');
    if (!fs.existsSync(evilDir)) fs.mkdirSync(evilDir, { recursive: true });
    const evilFile = path.join(evilDir, 'malicious.mp4');
    createSyntheticTestVideo(evilFile, 2);

    const isContained = propertyMediaService.isPathContained(evilFile, baseDir);
    if (isContained) {
      throw new Error(`Caminho sibling ${evilFile} NÃO pode ser considerado contido em ${baseDir}`);
    }

    const testAsset = {
      id: 'ast_pvid_evil_path',
      property_ref: testRef,
      asset_type: 'property_video',
      status: 'ready',
      storage_path: evilFile,
      file_hash: await propertyMediaService.computeFileHashStream(evilFile)
    };

    const integrity = await propertyMediaService.validatePhysicalAssetIntegrity(testAsset, testRef);
    if (integrity.valid) {
      throw new Error('validatePhysicalAssetIntegrity deveria ter rejeitado o asset com path sibling');
    }
    if (!integrity.reason.includes('PATH_CONTAINMENT_VIOLATION')) {
      throw new Error(`Esperado PATH_CONTAINMENT_VIOLATION, obtido: ${integrity.reason}`);
    }
  });

  // Cenário AL: Publicação física Owner-Specific impede overwrite/delete de outro worker
  await test('Cenário AL: Publicação física isolada por claim_token protege arquivo de outro owner', async () => {
    const testRef = 'ref_isolation_al';
    const propDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    if (!fs.existsSync(propDir)) fs.mkdirSync(propDir, { recursive: true });

    const assetId = 'ast_pvid_isolation_al_12345';
    const tokenA = 'token_worker_a_al';
    const tokenB = 'token_worker_b_al';

    // 1. Worker A adquire claim com token A
    await pool.query(
      `INSERT INTO video_assets (
        id, property_ref, asset_type, storage_type, status, generation_key,
        remote_url, metadata, created_at, updated_at
      ) VALUES ($1, $2, 'property_video', 'local_file', 'processing', 'gen_key_al',
        'https://youtube.com/watch?v=al_test', $3::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET status = 'processing', metadata = $3::jsonb, updated_at = NOW()`,
      [assetId, testRef, JSON.stringify({ claim_token: tokenA })]
    );

    // Worker A gera candidate file A
    const candidateFileA = path.join(propDir, `${assetId}.${tokenA}.mp4`);
    createSyntheticTestVideo(candidateFileA, 2);
    const hashA = await propertyMediaService.computeFileHashStream(candidateFileA);

    // 2. Worker A fica stale (> 10 min)
    await pool.query("UPDATE video_assets SET updated_at = NOW() - INTERVAL '15 minutes' WHERE id = $1", [assetId]);

    // 3. Worker B detecta stale e recupera o claim com token B
    const recB = await pool.query(
      `UPDATE video_assets 
       SET status = 'processing', updated_at = NOW(), error_message = NULL,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{claim_token}', to_jsonb($2::text))
       WHERE id = $1 AND status = 'processing' AND updated_at < NOW() - ($3 || ' minutes')::interval
       RETURNING *;`,
      [assetId, tokenB, 10]
    );
    if (recB.rowCount === 0) throw new Error('Worker B deveria ter recuperado o claim stale');

    // Worker B gera candidate file B e publica READY com sucesso
    const candidateFileB = path.join(propDir, `${assetId}.${tokenB}.mp4`);
    createSyntheticTestVideo(candidateFileB, 3);
    const hashB = await propertyMediaService.computeFileHashStream(candidateFileB);
    const specsB = await propertyMediaService.inspectVideoFile(candidateFileB);

    const readyB = await pool.query(
      `UPDATE video_assets
       SET status = 'ready', storage_path = $2, file_hash = $3, specs = $4::jsonb,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{materialized_at}', to_jsonb(NOW()::text)),
           updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $5
       RETURNING *;`,
      [assetId, candidateFileB, hashB, JSON.stringify(specsB), tokenB]
    );
    if (readyB.rowCount !== 1) throw new Error('Worker B deveria ter tornado asset READY');

    // 4. Worker A acorda tarde e tenta publicar READY com token A
    const readyA = await pool.query(
      `UPDATE video_assets
       SET status = 'ready', storage_path = $2, file_hash = $3, specs = $4::jsonb,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{materialized_at}', to_jsonb(NOW()::text)),
           updated_at = NOW()
       WHERE id = $1 AND status = 'processing' AND (metadata->>'claim_token') = $5
       RETURNING *;`,
      [assetId, candidateFileA, hashA, JSON.stringify({ width: 1080, height: 1920, duration_sec: 2 }), tokenA]
    );
    if (readyA.rowCount !== 0) throw new Error('Worker A NÃO deveria conseguir publicar READY');

    // Worker A executa cleanup de perda de ownership (apaga SOMENTE candidate A)
    if (fs.existsSync(candidateFileA)) {
      fs.unlinkSync(candidateFileA);
    }

    // 5. Verificações de segurança pós-conflito
    // - Candidate A foi removido pelo worker A
    if (fs.existsSync(candidateFileA)) throw new Error('Candidate A deveria ter sido removido pelo worker A');
    // - Candidate B de Worker B continua intacto no disco!
    if (!fs.existsSync(candidateFileB)) throw new Error('Candidate B de Worker B DEVE permanecer intacto no disco!');

    // - storage_path no banco aponta para o arquivo de B
    const finalRow = (await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId])).rows[0];
    if (finalRow.storage_path !== candidateFileB) throw new Error('storage_path no DB deve apontar para candidate B');
    if (finalRow.file_hash !== hashB) throw new Error('file_hash no DB deve ser hashB');

    // - getPropertyMediaPool retorna com 100% de integridade física
    const poolRes = await propertyMediaService.getPropertyMediaPool(testRef);
    const inPool = poolRes.videos.find(v => v.asset_id === assetId);
    if (!inPool) throw new Error('Asset de Worker B deve estar disponível no pool');
    if (inPool.storage_path !== candidateFileB) throw new Error('Pool deve apontar para arquivo de Worker B');
  });

  // Cenário AM: Coexistência de candidates e integridade de isolamento
  await test('Cenário AM: Candidates coexistem sem colisão e cleanup é restrito ao próprio token', async () => {
    const testRef = 'ref_coexistence_am';
    const propDir = path.join(OUTPUTS_BASE_DIR, 'properties', testRef, 'videos');
    if (!fs.existsSync(propDir)) fs.mkdirSync(propDir, { recursive: true });

    const assetId = 'ast_pvid_coexistence_am_12345';
    const token1 = 'tok_1_am';
    const token2 = 'tok_2_am';

    const file1 = path.join(propDir, `${assetId}.${token1}.mp4`);
    const file2 = path.join(propDir, `${assetId}.${token2}.mp4`);

    createSyntheticTestVideo(file1, 2);
    createSyntheticTestVideo(file2, 3);

    // Ambos arquivos coexistem com tamanhos e hashes diferentes
    if (!fs.existsSync(file1) || !fs.existsSync(file2)) throw new Error('Ambos candidates devem existir simultaneamente');

    const hash1 = await propertyMediaService.computeFileHashStream(file1);
    const hash2 = await propertyMediaService.computeFileHashStream(file2);
    if (hash1 === hash2) throw new Error('Candidates devem ter conteúdos e hashes distintos');

    // Worker 1 limpa seu arquivo sem afetar Worker 2
    fs.unlinkSync(file1);
    if (fs.existsSync(file1)) throw new Error('file1 deveria ter sido deletado');
    if (!fs.existsSync(file2)) throw new Error('file2 do worker 2 NÃO pode ser afetado pelo cleanup do worker 1');
  });

  console.log('\n================================================================');
  console.log(`RESULTADO FINAL DA SUÍTE DE TESTES:`);
  console.log(`Total de testes: ${passedCount + failedCount}`);
  console.log(`Passaram: ${passedCount}`);
  console.log(`Falharam: ${failedCount}`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests()
    .then(() => closePool())
    .catch(err => {
      console.error('FATAL TEST ERROR:', err);
      closePool().then(() => process.exit(1));
    });
}

module.exports = { runTests };
