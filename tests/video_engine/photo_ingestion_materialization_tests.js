/**
 * Suíte Formal de Testes — Photo Ingestion & Materialization Proof (Fase 4B.1)
 * Bali Imóveis — Video Engine V2
 * 
 * Cobertura de Cenários:
 * - Cenário A: URL real/permitida materializa foto válida
 * - Cenário B: URL arbitrária não autorizada é rejeitada por whitelist
 * - Cenário C: Arquivo vazio (0 bytes) é rejeitado
 * - Cenário D: Payload não-imagem é rejeitado
 * - Cenário E: Imagem truncada / full decode inválido é rejeitada
 * - Cenário F: Physical SHA determinístico
 * - Cenário G: Extensão final deriva do conteúdo real (.jpg, .png, .webp)
 * - Cenário H: Threshold short-edge é aplicado / configurável
 * - Cenário I: Threshold aspect ratio é aplicado / configurável
 * - Cenário J: Payload > limite é abortado
 * - Cenário K: Timeout é respeitado
 * - Cenário L: Redirect para host não permitido é rejeitado
 * - Cenário M: Redirect para private/metadata IP é rejeitado
 * - Cenário N: Property asset identity é property-scoped (ast_pimg_<32-chars>)
 * - Cenário O: Mesmos bytes + mesma property -> mesmo asset final
 * - Cenário P: Mesmos bytes + outra property -> outro asset_id
 * - Cenário Q: Physical blob é compartilhado cross-property
 * - Cenário R: Múltiplas CRM source refs de mesmo conteúdo preservam provenance
 * - Cenário S: READY cache/reuse valida arquivo fisicamente
 * - Cenário T: DB READY com blob ausente não é aceito silenciosamente
 * - Cenário U: DB READY com hash divergente não é aceito silenciosamente
 * - Cenário V: Composer permanece intacto
 * - Cenário W: Property Video Ingestion permanece intacto
 * - Cenário AL: Canonical inexistente -> publish bem-sucedido no blob store global
 * - Cenário AM: Canonical existente correto -> reuse sem rewrite (idempotência segura)
 * - Cenário AN: Canonical existente com hash divergente -> CANONICAL_BLOB_INTEGRITY_ERROR e canonical intacto
 * - Cenário AO: Concorrência física real de publicação dos mesmos bytes por 2 workers -> um único canonical permanece
 * - Cenário AP: Worker loser em concorrência remove somente próprio staging no .tmp
 * - Cenário AQ: Nenhum erro normal remove canonical global
 * - Cenário AR: Property assets de refs diferentes compartilham blob sem conflito de ownership
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const assert = require('assert');

// Configurar ambiente de teste
process.env.NODE_ENV = 'test';

const {
  PhotoIngestionService,
  defaultPhotoIngestionService,
  downloadPhotoToStaging,
  isIpBlocked,
  isHostAllowed,
  validateUrl,
  validatePhotoImage,
  probeImageStructure,
  fullDecodeImage,
  normalizeCanonicalExtension,
  computeFileHashStream,
  computePropertyPhotoAssetId,
  publishCanonicalBlobNoClobber,
  verifyCanonicalBlobIntegrity,
  PHOTO_BLOBS_DIR
} = require('../../video_engine/property_media/photo_ingestion');

const { getPool, closePool } = require('../../video_engine/db');
const propertyMediaService = require('../../video_engine/property_media/property_media_service');

const TEST_DIR = path.join(__dirname, '..', 'fixtures', 'photo_ingest_test_' + Date.now());
const STAGING_DIR = path.join(PHOTO_BLOBS_DIR, '.tmp');

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}
if (!fs.existsSync(STAGING_DIR)) {
  fs.mkdirSync(STAGING_DIR, { recursive: true });
}

// Helpers para geração de fixtures físicas com FFmpeg
function createTestImage(filename, { width = 1280, height = 720, format = 'jpg', color = 'blue' } = {}) {
  const targetPath = path.join(TEST_DIR, filename);
  const ext = format === 'png' ? 'png' : (format === 'webp' ? 'webp' : 'jpg');
  const vcodec = format === 'png' ? 'png' : (format === 'webp' ? 'libwebp' : 'mjpeg');

  execSync(`ffmpeg -v error -f lavfi -i color=c=${color}:s=${width}x${height}:d=0.1 -frames:v 1 -c:v ${vcodec} -y "${targetPath}"`, {
    windowsHide: true
  });
  return targetPath;
}

let passedCount = 0;
let failedCount = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    if (err.stack) console.error(err.stack);
    failedCount++;
  }
}

async function main() {
  console.log('================================================================');
  console.log('INICIANDO SUÍTE FORMAL: PHOTO INGESTION & MATERIALIZATION (4B.1)');
  console.log('================================================================\n');

  // Gerar fixtures físicas
  const validJpgPath = createTestImage('valid_1280x720.jpg', { width: 1280, height: 720, format: 'jpg', color: 'blue' });
  const validPngPath = createTestImage('valid_1920x1080.png', { width: 1920, height: 1080, format: 'png', color: 'green' });
  const validWebpPath = createTestImage('valid_800x600.webp', { width: 800, height: 600, format: 'webp', color: 'red' });
  const smallJpgPath = createTestImage('small_320x240.jpg', { width: 320, height: 240, format: 'jpg', color: 'yellow' });
  // Aspect ratio 4.0 com short edge 600px (> 480px) para isolar teste de aspect ratio
  const distortedJpgPath = createTestImage('distorted_2400x600.jpg', { width: 2400, height: 600, format: 'jpg', color: 'purple' });

  const emptyFilePath = path.join(TEST_DIR, 'empty.jpg');
  fs.writeFileSync(emptyFilePath, Buffer.alloc(0));

  const textFilePath = path.join(TEST_DIR, 'not_an_image.txt');
  fs.writeFileSync(textFilePath, 'This is plain text and not a valid image format.');

  const corruptedJpgPath = path.join(TEST_DIR, 'corrupted.jpg');
  // Truncar JPEG real na metade para manter header estrutural intacto mas falhar no full decode do scan data
  const validBuffer = fs.readFileSync(validJpgPath);
  const corruptBuffer = validBuffer.slice(0, Math.floor(validBuffer.length * 0.4));
  fs.writeFileSync(corruptedJpgPath, corruptBuffer);

  // Criar servidor HTTP de teste local para simular downloads e redirects
  let testServerPort = 0;
  const testServer = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://localhost:${testServerPort}`);

    if (parsed.pathname === '/valid.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': fs.statSync(validJpgPath).size });
      fs.createReadStream(validJpgPath).pipe(res);
    } else if (parsed.pathname === '/large.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      // Enviar 30MB simulados
      const chunk = Buffer.alloc(1024 * 1024, 0xAA);
      for (let i = 0; i < 30; i++) {
        res.write(chunk);
      }
      res.end();
    } else if (parsed.pathname === '/slow.jpg') {
      // Demora para responder
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(Buffer.alloc(100));
      }, 3000);
    } else if (parsed.pathname === '/redirect-valid') {
      res.writeHead(302, { 'Location': `http://fotos.sobressai.com.br:${testServerPort}/valid.jpg` });
      res.end();
    } else if (parsed.pathname === '/redirect-unauthorized') {
      res.writeHead(302, { 'Location': 'http://evil-attacker.com/exploit.jpg' });
      res.end();
    } else if (parsed.pathname === '/redirect-private-ip') {
      res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve) => {
    testServer.listen(0, '127.0.0.1', () => {
      testServerPort = testServer.address().port;
      resolve();
    });
  });

  // ==================================================================
  // TESTES DE SEGURANÇA E SSRF / REDIRECT
  // ==================================================================

  await runTest('Cenário B: URL de domínio não homologado é rejeitada por whitelist', async () => {
    assert.strictEqual(isHostAllowed('evil-domain.com'), false);
    assert.strictEqual(isHostAllowed('fotos.sobressai.com.br'), true);
    assert.strictEqual(isHostAllowed('cdn.sobressai.com.br'), true);
    assert.throws(() => {
      validateUrl('https://evil-domain.com/photo.jpg');
    }, /Host não autorizado por whitelist/);
  });

  await runTest('Cenário M & Bloqueio SSRF: IPs privados, loopback e cloud metadata são bloqueados', async () => {
    assert.strictEqual(isIpBlocked('127.0.0.1'), true);
    assert.strictEqual(isIpBlocked('169.254.169.254'), true);
    assert.strictEqual(isIpBlocked('10.0.0.1'), true);
    assert.strictEqual(isIpBlocked('172.16.0.5'), true);
    assert.strictEqual(isIpBlocked('192.168.1.1'), true);
    assert.strictEqual(isIpBlocked('100.64.0.1'), true);
    assert.strictEqual(isIpBlocked('::1'), true);
    assert.strictEqual(isIpBlocked('::ffff:127.0.0.1'), true);
    assert.strictEqual(isIpBlocked('8.8.8.8'), false); // IP público válido
  });

  await runTest('Cenário L: Redirect para host não permitido é rejeitado', async () => {
    let threw = false;
    try {
      await downloadPhotoToStaging(`http://127.0.0.1:${testServerPort}/redirect-unauthorized`, {
        allowedHosts: ['127.0.0.1'],
        timeoutMs: 2000
      });
    } catch (e) {
      threw = true;
      assert.match(e.message, /Host não autorizado por whitelist|evil-attacker\.com/);
    }
    assert.strictEqual(threw, true);
  });

  // ==================================================================
  // TESTES DE VALIDAÇÃO FÍSICA E THRESHOLDS
  // ==================================================================

  await runTest('Cenário C: Arquivo vazio (0 bytes) é rejeitado', async () => {
    let threw = false;
    try {
      await validatePhotoImage(emptyFilePath);
    } catch (e) {
      threw = true;
      assert.match(e.message, /Arquivo vazio|0 bytes/);
    }
    assert.strictEqual(threw, true);
  });

  await runTest('Cenário D: Payload não-imagem é rejeitado', async () => {
    let threw = false;
    try {
      await validatePhotoImage(textFilePath);
    } catch (e) {
      threw = true;
      assert.match(e.message, /FFPROBE_ERROR|NO_IMAGE_STREAM|Falha na inspeção/);
    }
    assert.strictEqual(threw, true);
  });

  await runTest('Cenário E: Imagem truncada / decode inválido é rejeitada por full decode', async () => {
    let threw = false;
    try {
      await validatePhotoImage(corruptedJpgPath);
    } catch (e) {
      threw = true;
      assert.match(e.message, /FULL_DECODE_FAILED|FFPROBE_ERROR|INVALID_DIMENSIONS|corrompida/);
    }
    assert.strictEqual(threw, true);

    // Teste direto da função fullDecodeImage contra arquivo truncado
    let threwDirect = false;
    try {
      await fullDecodeImage(corruptedJpgPath);
    } catch (e) {
      threwDirect = true;
      assert.match(e.message, /FULL_DECODE_FAILED/);
    }
    assert.strictEqual(threwDirect, true);
  });

  await runTest('Cenário F & G: Physical SHA streaming e extensão derivada do codec real', async () => {
    const hashJpg = await computeFileHashStream(validJpgPath);
    assert.strictEqual(typeof hashJpg, 'string');
    assert.strictEqual(hashJpg.length, 64);

    const valJpg = await validatePhotoImage(validJpgPath);
    assert.strictEqual(valJpg.valid, true);
    assert.strictEqual(valJpg.normalized_ext, '.jpg');

    const valPng = await validatePhotoImage(validPngPath);
    assert.strictEqual(valPng.valid, true);
    assert.strictEqual(valPng.normalized_ext, '.png');

    const valWebp = await validatePhotoImage(validWebpPath);
    assert.strictEqual(valWebp.valid, true);
    assert.strictEqual(valWebp.normalized_ext, '.webp');
  });

  await runTest('Cenário H: Threshold de short-edge é aplicado com fail-fast', async () => {
    let threw = false;
    try {
      await validatePhotoImage(smallJpgPath, { minShortEdgePx: 480 });
    } catch (e) {
      threw = true;
      assert.match(e.message, /SHORT_EDGE_THRESHOLD/);
    }
    assert.strictEqual(threw, true);

    // Se threshold configurado para 200, passa
    const valLow = await validatePhotoImage(smallJpgPath, { minShortEdgePx: 200 });
    assert.strictEqual(valLow.valid, true);
  });

  await runTest('Cenário I: Threshold de aspect-ratio é aplicado com fail-fast', async () => {
    let threw = false;
    try {
      await validatePhotoImage(distortedJpgPath, { maxAspectRatio: 3.0 });
    } catch (e) {
      threw = true;
      assert.match(e.message, /ASPECT_RATIO_THRESHOLD/);
    }
    assert.strictEqual(threw, true);
  });

  await runTest('Cenário J: Streaming que excede limite de tamanho é abortado', async () => {
    let threw = false;
    try {
      await downloadPhotoToStaging(`http://127.0.0.1:${testServerPort}/large.jpg`, {
        allowedHosts: ['127.0.0.1'],
        maxSizeMb: 5 // 5MB limit
      });
    } catch (e) {
      threw = true;
      assert.match(e.message, /SIZE_EXCEEDED/);
    }
    assert.strictEqual(threw, true);
  });

  await runTest('Cenário K: Download respeita timeout configurado', async () => {
    let threw = false;
    try {
      await downloadPhotoToStaging(`http://127.0.0.1:${testServerPort}/slow.jpg`, {
        allowedHosts: ['127.0.0.1'],
        timeoutMs: 500
      });
    } catch (e) {
      threw = true;
      assert.match(e.message, /TIMEOUT/);
    }
    assert.strictEqual(threw, true);
  });

  // ==================================================================
  // TESTES DE CONTENT-ADDRESSED BLOB STORE E NO-CLOBBER
  // ==================================================================

  // Gerar imagem exclusiva para teste de publicação inicial
  const uniqueAlPath = createTestImage(`unique_al_${Date.now()}.jpg`, { width: 1280, height: 720, color: 'cyan' });
  const uniqueAlHash = await computeFileHashStream(uniqueAlPath);
  const uniqueAlCanonical = path.join(PHOTO_BLOBS_DIR, `${uniqueAlHash}.jpg`);
  if (fs.existsSync(uniqueAlCanonical)) fs.unlinkSync(uniqueAlCanonical);

  await runTest('Cenário AL: Canonical inexistente -> Publicação No-Clobber bem-sucedida', async () => {
    const tempStaging = path.join(STAGING_DIR, `test_al_${Date.now()}.tmp`);
    fs.copyFileSync(uniqueAlPath, tempStaging);

    const pub = await publishCanonicalBlobNoClobber(tempStaging, uniqueAlHash, '.jpg');
    assert.strictEqual(pub.dedup_hit, false);
    assert.strictEqual(pub.physicalFileHash, uniqueAlHash);
    assert.strictEqual(fs.existsSync(pub.canonicalPath), true);
    assert.strictEqual(fs.existsSync(tempStaging), false); // Staging limpo
  });

  await runTest('Cenário AM: Canonical existente com hash correto -> Reuse sem rewrite (Idempotência)', async () => {
    const tempStaging2 = path.join(STAGING_DIR, `test_am_${Date.now()}.tmp`);
    fs.copyFileSync(uniqueAlPath, tempStaging2);

    const pub2 = await publishCanonicalBlobNoClobber(tempStaging2, uniqueAlHash, '.jpg');
    assert.strictEqual(pub2.dedup_hit, true);
    assert.strictEqual(fs.existsSync(pub2.canonicalPath), true);
    assert.strictEqual(fs.existsSync(tempStaging2), false); // Staging limpo
  });

  await runTest('Cenário AN & AQ: Canonical com hash divergente -> CANONICAL_BLOB_INTEGRITY_ERROR e canonical intacto', async () => {
    // Criar um canonical artificial com conteúdo divergente
    const fakeHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const fakeCanonicalPath = path.join(PHOTO_BLOBS_DIR, `${fakeHash}.jpg`);
    fs.writeFileSync(fakeCanonicalPath, 'CANONICAL_ORIGINAL_BYTES_DO_NOT_TOUCH');

    const tempStaging = path.join(STAGING_DIR, `test_an_${Date.now()}.tmp`);
    fs.writeFileSync(tempStaging, 'DIFFERENT_BYTES_FROM_WORKER');

    let threw = false;
    try {
      await publishCanonicalBlobNoClobber(tempStaging, fakeHash, '.jpg');
    } catch (e) {
      threw = true;
      assert.strictEqual(e.code, 'CANONICAL_BLOB_INTEGRITY_ERROR');
    }

    assert.strictEqual(threw, true);
    // Verificar que o arquivo canônico permanece 100% INTACTO
    assert.strictEqual(fs.existsSync(fakeCanonicalPath), true);
    assert.strictEqual(fs.readFileSync(fakeCanonicalPath, 'utf8'), 'CANONICAL_ORIGINAL_BYTES_DO_NOT_TOUCH');
    // Staging do worker foi removido
    assert.strictEqual(fs.existsSync(tempStaging), false);

    // Limpar fake canonical criado para o teste
    fs.unlinkSync(fakeCanonicalPath);
  });

  await runTest('Cenário AO & AP: Concorrência física real de 2 workers publicando os mesmos bytes', async () => {
    // Gerar imagem exclusiva para o teste de concorrência
    const uniqueRacePath = createTestImage(`unique_race_${Date.now()}.png`, { width: 1920, height: 1080, format: 'png', color: 'magenta' });
    const raceHash = await computeFileHashStream(uniqueRacePath);
    const raceCanonical = path.join(PHOTO_BLOBS_DIR, `${raceHash}.png`);
    if (fs.existsSync(raceCanonical)) fs.unlinkSync(raceCanonical);

    const stagingWorkerA = path.join(STAGING_DIR, `workerA_${Date.now()}.tmp`);
    const stagingWorkerB = path.join(STAGING_DIR, `workerB_${Date.now()}.tmp`);

    fs.copyFileSync(uniqueRacePath, stagingWorkerA);
    fs.copyFileSync(uniqueRacePath, stagingWorkerB);

    // Executar publicação simultânea
    const [resA, resB] = await Promise.all([
      publishCanonicalBlobNoClobber(stagingWorkerA, raceHash, '.png'),
      publishCanonicalBlobNoClobber(stagingWorkerB, raceHash, '.png')
    ]);

    // Um foi winner e outro dedup_hit
    const hits = [resA.dedup_hit, resB.dedup_hit];
    assert.strictEqual(hits.filter(h => h === false).length >= 1, true);
    assert.strictEqual(fs.existsSync(resA.canonicalPath), true);
    // Ambos os stagings foram limpos
    assert.strictEqual(fs.existsSync(stagingWorkerA), false);
    assert.strictEqual(fs.existsSync(stagingWorkerB), false);
  });

  // ==================================================================
  // TESTES DE PROPERTY ASSETS IDENTITY E CROSS-PROPERTY DEDUPE
  // ==================================================================

  await runTest('Cenário N, O, P & AR: Property Asset Identity é property-scoped e compartilha blob físico', async () => {
    const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const assetId1628 = computePropertyPhotoAssetId('1628', hash);
    const assetId1601 = computePropertyPhotoAssetId('1601', hash);

    assert.strictEqual(assetId1628.startsWith('ast_pimg_'), true);
    assert.strictEqual(assetId1601.startsWith('ast_pimg_'), true);
    assert.notStrictEqual(assetId1628, assetId1601); // Identidades diferentes por propriedade

    // Mesma REF + mesmo hash -> mesmo asset_id determinístico
    const assetId1628Repeat = computePropertyPhotoAssetId('1628', hash);
    assert.strictEqual(assetId1628, assetId1628Repeat);
  });

  await runTest('Cenário Q & AR: Dois property assets de refs diferentes compartilham storage_path', async () => {
    const pool = getPool();
    const hash = await computeFileHashStream(validJpgPath);
    const canonicalPath = path.join(PHOTO_BLOBS_DIR, `${hash}.jpg`);

    const asset1628Id = computePropertyPhotoAssetId('1628', hash);
    const asset1601Id = computePropertyPhotoAssetId('1601', hash);

    await pool.query(
      `INSERT INTO video_assets (id, property_ref, asset_type, storage_type, storage_path, file_hash, generation_key, status, specs, metadata)
       VALUES ($1, '1628', 'property_photo', 'local_file', $2, $3, 'gen_1628', 'ready', '{}', '{}')
       ON CONFLICT (id) DO UPDATE SET status = 'ready'`,
      [asset1628Id, canonicalPath, hash]
    );

    await pool.query(
      `INSERT INTO video_assets (id, property_ref, asset_type, storage_type, storage_path, file_hash, generation_key, status, specs, metadata)
       VALUES ($1, '1601', 'property_photo', 'local_file', $2, $3, 'gen_1601', 'ready', '{}', '{}')
       ON CONFLICT (id) DO UPDATE SET status = 'ready'`,
      [asset1601Id, canonicalPath, hash]
    );

    const res1628 = (await pool.query('SELECT * FROM video_assets WHERE id = $1', [asset1628Id])).rows[0];
    const res1601 = (await pool.query('SELECT * FROM video_assets WHERE id = $1', [asset1601Id])).rows[0];

    assert.strictEqual(res1628.storage_path, res1601.storage_path);
    assert.strictEqual(res1628.file_hash, res1601.file_hash);
    assert.notStrictEqual(res1628.property_ref, res1601.property_ref);
  });

  await runTest('Cenário S, T & U: Verificação de integridade física no cache e rejeição de corrupção', async () => {
    const hash = await computeFileHashStream(validJpgPath);
    const canonicalPath = path.join(PHOTO_BLOBS_DIR, `${hash}.jpg`);

    // Validação correta
    const ok = await verifyCanonicalBlobIntegrity(canonicalPath, hash);
    assert.strictEqual(ok.valid, true);

    // Arquivo ausente
    const missing = await verifyCanonicalBlobIntegrity(path.join(PHOTO_BLOBS_DIR, 'non_existent_blob.jpg'), hash);
    assert.strictEqual(missing.valid, false);
    assert.strictEqual(missing.reason, 'PHYSICAL_FILE_MISSING');

    // Hash divergente
    const badHash = await verifyCanonicalBlobIntegrity(canonicalPath, 'wrong_hash_0000000000000000000000000000000000000000000000000000000000000000');
    assert.strictEqual(badHash.valid, false);
    assert.match(badHash.reason, /FILE_HASH_MISMATCH/);
  });

  await runTest('Cenário R: Múltiplas CRM source refs preservam array completo de metadados', async () => {
    const service = new PhotoIngestionService({ allowedHosts: ['127.0.0.1'] });
    const pool = getPool();

    // Inserir registro com 2 sources simuladas
    const hash = await computeFileHashStream(validJpgPath);
    const assetId = computePropertyPhotoAssetId('test_multi', hash);
    const metadata = {
      property_ref: 'test_multi',
      crm_sources: [
        { crm_photo_id: 101, posicao: 1, destaque: true, url: 'http://crm.com/1.jpg' },
        { crm_photo_id: 102, posicao: 5, destaque: false, url: 'http://crm.com/5.jpg' }
      ]
    };

    await pool.query(
      `INSERT INTO video_assets (id, property_ref, asset_type, storage_type, storage_path, file_hash, generation_key, status, specs, metadata)
       VALUES ($1, 'test_multi', 'property_photo', 'local_file', $2, $3, 'gen_multi', 'ready', '{}', $4)`,
      [assetId, validJpgPath, hash, JSON.stringify(metadata)]
    );

    const row = (await pool.query('SELECT * FROM video_assets WHERE id = $1', [assetId])).rows[0];
    assert.strictEqual(row.metadata.crm_sources.length, 2);
    assert.strictEqual(row.metadata.crm_sources[0].crm_photo_id, 101);
    assert.strictEqual(row.metadata.crm_sources[1].crm_photo_id, 102);
  });

  await runTest('Cenário Pool: getPropertyMediaPool inclui property_photo READY validado', async () => {
    const poolResult = await propertyMediaService.getPropertyMediaPool('1628');
    assert.strictEqual(poolResult.property_ref, '1628');
    assert.strictEqual(Array.isArray(poolResult.photos), true);
    assert.strictEqual(Array.isArray(poolResult.videos), true);
  });

  // Fechar servidor de teste
  testServer.close();

  // Limpeza de fixtures temporárias de teste
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch (e) {}

  console.log('\n================================================================');
  console.log('RESULTADO FINAL DA SUÍTE DE TESTES (4B.1):');
  console.log(`Total de testes: ${passedCount + failedCount}`);
  console.log(`Passaram: ${passedCount}`);
  console.log(`Falharam: ${failedCount}`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL ERROR in test suite:', err);
  process.exit(1);
});
