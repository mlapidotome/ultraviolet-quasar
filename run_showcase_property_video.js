/**
 * Script de Execução do Showcase Oficial: Property Video Ingestion
 * Bali Imóveis (REF 1628 — Edifício Wide)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const assetService = require('./video_engine/asset_service');
const composerService = require('./video_engine/composer_service');
const propertyMediaService = require('./video_engine/property_media/property_media_service');

const OUTPUTS_BASE_DIR = path.join(__dirname, 'outputs');

async function runShowcase() {
  console.log('================================================================');
  console.log('🎬 INICIANDO GERAÇÃO DO SHOWCASE OFICIAL: REF 1628 (VÍDEO REAL CRM)');
  console.log('================================================================\n');

  const propertyRef = '1628';
  const showcaseJobId = `job_showcase_pvid_${propertyRef}_${Date.now()}`;
  const jobDir = path.join(OUTPUTS_BASE_DIR, 'jobs', showcaseJobId);
  fs.mkdirSync(jobDir, { recursive: true });

  // 1. Ingestão e Materialização do Property Video Real obtido dinamicamente do CRM
  console.log(`1. Consultando CRM / ImobTotal snapshot para REF ${propertyRef}...`);
  const jobService = require('./video_engine/job_service');
  const imovelData = await jobService.fetchImovelData(propertyRef);
  if (!imovelData || !imovelData.link_video) {
    throw new Error(`[SHOWCASE ERROR] Imóvel REF ${propertyRef} não possui link_video no CRM/ImobTotal`);
  }

  console.log(`   🔗 link_video identificado no snapshot: ${imovelData.link_video}`);
  console.log(`   🏢 Título do Imóvel: ${imovelData.titulo || 'N/A'}`);

  console.log(`   Ingerindo Property Video via PropertyMediaService...`);
  const pvidRes = await propertyMediaService.ensurePropertyVideo(propertyRef);

  if (pvidRes.status !== 'READY' || !pvidRes.asset) {
    throw new Error(`Falha na ingestão do property video: ${pvidRes.status} (${pvidRes.error})`);
  }

  const propertyVideoAsset = pvidRes.asset;
  console.log(`   ✅ Property Video Pronto: ${propertyVideoAsset.id}`);
  console.log(`      Path: ${propertyVideoAsset.storage_path}`);
  console.log(`      Hash: ${propertyVideoAsset.file_hash}`);
  console.log(`      Specs: ${propertyVideoAsset.specs.width}x${propertyVideoAsset.specs.height}, ${propertyVideoAsset.specs.duration_sec}s, ${propertyVideoAsset.specs.codec_video}\n`);

  // 2. Registrar Presenter Avatar Real (gancho_marcel_01.mp4)
  console.log('2. Registrando Master Presenter...');
  const presenterSrc = path.join(OUTPUTS_BASE_DIR, 'gancho_marcel_01.mp4');
  const presenterDest = path.join(jobDir, 'presenter_marcel.mp4');
  fs.copyFileSync(presenterSrc, presenterDest);

  const presenterHash = await propertyMediaService.computeFileHashStream(presenterDest);
  const presenterSpecs = await propertyMediaService.inspectVideoFile(presenterDest);

  const presenterAsset = await assetService.createAsset({
    id: `ast_pres_${showcaseJobId}`,
    job_id: showcaseJobId,
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

  console.log(`   ✅ Presenter Pronto: ${presenterAsset.id} (${presenterSpecs.duration_sec}s)\n`);

  // 3. Registrar Foto Real do Imóvel
  console.log('3. Registrando Foto Real do Imóvel...');
  const realPhotoSrc = path.join(OUTPUTS_BASE_DIR, 'properties', propertyRef, 'frame_12s.jpg');
  const photoDest = path.join(jobDir, 'photo_real_1628_01.jpg');
  fs.copyFileSync(realPhotoSrc, photoDest);

  const photoHash = await propertyMediaService.computeFileHashStream(photoDest);
  const photoAsset = await assetService.createAsset({
    id: `ast_photo_${showcaseJobId}_01`,
    job_id: showcaseJobId,
    asset_type: 'image',
    storage_type: 'local_file',
    generation_key: crypto.randomBytes(32).toString('hex'),
    status: 'pending'
  });

  await assetService.markAssetReady(photoAsset.id, {
    localPath: photoDest,
    fileHash: photoHash,
    specs: { width: 1080, height: 1920, media_type: 'image' }
  });

  console.log(`   ✅ Foto Real Pronta: ${photoAsset.id}\n`);

  // 4. Montar Creative Blueprint 1.2 com 3 Cortes Lógicos sobre o MESMO Property Video
  console.log('4. Construindo Creative Blueprint 1.2...');
  const totalDurationMs = Math.round(presenterSpecs.duration_sec * 1000); // 10560ms

  const blueprint = {
    schema_version: '1.2',
    creative_id: `crv_showcase_pvid_${propertyRef}`,
    job_id: showcaseJobId,
    property_ref: propertyRef,
    blueprint_version: 1,
    format: { aspect_ratio: '9:16', width: 1080, height: 1920, fps: 30 },
    editing_style: { style_id: 'performance_reels_v1', version: 1 },
    audio_track: {
      primary_asset_id: presenterAsset.id,
      source_in_ms: 0,
      source_out_ms: totalDurationMs,
      broll_audio_policy: 'mute_all_broll'
    },
    visual_timeline: [
      // 1. Apresentador Fullscreen (0 - 2000ms)
      {
        id: 'vseg_1',
        role: 'presenter_fullscreen',
        asset_id: presenterAsset.id,
        asset_type: 'video',
        start_ms: 0,
        end_ms: 2000,
        source_in_ms: 0,
        source_out_ms: 2000,
        transition_in: { type: 'cut' }
      },
      // 2. Trecho Real 1 do Property Video: Sala / Varanda (2000 - 4500ms = 2500ms)
      {
        id: 'vseg_2',
        role: 'property_footage_living',
        asset_id: propertyVideoAsset.id,
        asset_type: 'video',
        start_ms: 2000,
        end_ms: 4500,
        source_in_ms: 1000,
        source_out_ms: 3500,
        transition_in: { type: 'cut' }
      },
      // 3. Foto Real do Imóvel com Ken Burns (4500 - 6500ms = 2000ms)
      {
        id: 'vseg_3',
        role: 'property_photo',
        asset_id: photoAsset.id,
        asset_type: 'image',
        start_ms: 4500,
        end_ms: 6500,
        motion: { type: 'ken_burns_zoom_in', start_scale: 1.0, target_scale: 1.10 },
        transition_in: { type: 'cut' }
      },
      // 4. Trecho Real 2 do MESMO Property Video: Cozinha / Área Íntima (6500 - 8500ms = 2000ms)
      {
        id: 'vseg_4',
        role: 'property_footage_kitchen',
        asset_id: propertyVideoAsset.id,
        asset_type: 'video',
        start_ms: 6500,
        end_ms: 8500,
        source_in_ms: 10000,
        source_out_ms: 12000,
        transition_in: { type: 'cut' }
      },
      // 5. Trecho Real 3 do MESMO Property Video: Vista Panorâmica (8500 - 10560ms = 2060ms)
      {
        id: 'vseg_5',
        role: 'property_footage_view',
        asset_id: propertyVideoAsset.id,
        asset_type: 'video',
        start_ms: 8500,
        end_ms: totalDurationMs,
        source_in_ms: 25000,
        source_out_ms: 27060,
        transition_in: { type: 'cut' }
      }
    ],
    pip: {
      enabled: true,
      asset_id: presenterAsset.id,
      windows: [
        // Presenter PIP perfeitamente sincronizado com lip-sync durante o corte 2 (6500-8500ms)
        {
          start_ms: 6500,
          end_ms: 8500,
          source_in_ms: 6500,
          source_out_ms: 8500,
          position: 'center_right',
          shape: 'rounded_rect'
        }
      ]
    },
    overlays: [
      { id: 'ov_hl', layer_order: 10, type: 'headline', text: 'EDIFÍCIO WIDE — 80m²', start_ms: 200, end_ms: 4000, position: 'top_safe', preset: 'bold_headline' },
      { id: 'ov_price', layer_order: 20, type: 'price_badge', text: 'R$ 500.000', start_ms: 4500, end_ms: 6400, position: 'lower_third', preset: 'price_punch' },
      { id: 'ov_loc', layer_order: 30, type: 'location_tag', text: 'JARDIM BELA VISTA', start_ms: 8500, end_ms: totalDurationMs, position: 'bottom_safe', preset: 'location_badge' }
    ],
    captions: [
      { start_ms: 0, end_ms: 2000, text: 'Apresentador Fullscreen na abertura.' },
      { start_ms: 2000, end_ms: 4500, text: 'B-Roll 1: Sala e varanda do imóvel real.' },
      { start_ms: 4500, end_ms: 6500, text: 'Foto oficial de alta resolução com Ken Burns.' },
      { start_ms: 6500, end_ms: 8500, text: 'B-Roll 2 com Presenter PIP sincronizado!' },
      { start_ms: 8500, end_ms: totalDurationMs, text: 'B-Roll 3: Vista e detalhes finais.' }
    ]
  };

  // 5. Execução do Composer v3
  console.log('5. Executando Composer v3...');
  const renderRes = await composerService.composeCreative({
    jobId: showcaseJobId,
    blueprint,
    isShadow: false
  });

  console.log('\n================================================================');
  console.log('🎉 SHOWCASE RENDERIZADO COM SUCESSO!');
  console.log('================================================================');
  console.log(`Job UUID:           ${showcaseJobId}`);
  console.log(`Creative ID:        ${blueprint.creative_id}`);
  console.log(`Render Asset ID:    ${renderRes.asset_id}`);
  console.log(`Render Key:         ${renderRes.render_key}`);
  console.log(`Arquivo MP4 Final:  ${renderRes.output_path}`);

  const finalHash = await propertyMediaService.computeFileHashStream(renderRes.output_path);
  const finalSpecs = await propertyMediaService.inspectVideoFile(renderRes.output_path);

  console.log(`SHA-256 Final:      ${finalHash}`);
  console.log(`Duração Final:      ${finalSpecs.duration_sec}s (${finalSpecs.duration_ms}ms)`);
  console.log(`Resolução / FPS:    ${finalSpecs.width}x${finalSpecs.height} @ ${finalSpecs.fps}fps`);
  console.log(`Codecs:             Vídeo: ${finalSpecs.codec_video}, Áudio: ${finalSpecs.codec_audio}`);
  console.log(`Tamanho em Disco:   ${finalSpecs.file_size_bytes} bytes`);
  console.log('================================================================\n');

  // 6. Extração de Frames para Inspeção Forense Visual
  console.log('6. Extraindo frames representativos para inspeção visual...');
  const framesDir = path.join(jobDir, 'qc_frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const samplePoints = [
    { name: '01_presenter_fullscreen', sec: 1.0 },
    { name: '02_broll_cut1_living', sec: 3.2 },
    { name: '03_photo_ken_burns', sec: 5.5 },
    { name: '04_broll_cut2_with_pip', sec: 7.5 },
    { name: '05_broll_cut3_view_cta', sec: 9.5 }
  ];

  for (const pt of samplePoints) {
    const framePath = path.join(framesDir, `${pt.name}.jpg`);
    composerService.execSyncSafe
      ? composerService.execSyncSafe(`ffmpeg -y -ss ${pt.sec} -i "${renderRes.output_path}" -vframes 1 "${framePath}"`)
      : require('child_process').execSync(`ffmpeg -y -ss ${pt.sec} -i "${renderRes.output_path}" -vframes 1 "${framePath}"`);
    console.log(`   📸 Frame [${pt.sec}s] ${pt.name} -> ${framePath}`);
  }

  return {
    jobId: showcaseJobId,
    creativeId: blueprint.creative_id,
    renderAssetId: renderRes.asset_id,
    renderKey: renderRes.render_key,
    outputPath: renderRes.output_path,
    finalHash,
    finalSpecs,
    propertyVideoAsset,
    framesDir
  };
}

if (require.main === module) {
  runShowcase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('FATAL SHOWCASE ERROR:', err);
      process.exit(1);
    });
}

module.exports = { runShowcase };
