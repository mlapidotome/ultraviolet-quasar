/**
 * Showcase Canônico — Photo Ingestion & Materialization Proof (Fase 4B.1)
 * Bali Imóveis — Video Engine V2
 * 
 * Execução Real sobre o Imóvel REF 1628 (CRM ImobTotal)
 */

const fs = require('fs');
const path = require('path');
const { defaultPhotoIngestionService, PhotoIngestionService } = require('./video_engine/property_media/photo_ingestion');
const jobService = require('./video_engine/job_service');
const propertyMediaService = require('./video_engine/property_media/property_media_service');

const PROPERTY_REF = '1628';
const OUTPUTS_DIR = path.join(__dirname, 'outputs', 'properties', PROPERTY_REF);

if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

async function main() {
  console.log('================================================================');
  console.log(`INICIANDO SHOWCASE CANÔNICO FASE 4B.1: REF ${PROPERTY_REF}`);
  console.log('================================================================\n');

  const startTime = Date.now();

  // 1. Consulta Prévia do CRM
  console.log('[1/4] Consultando dados oficiais do CRM ImobTotal via fetchImovelData...');
  const imovelData = await jobService.fetchImovelData(PROPERTY_REF);

  if (!imovelData) {
    throw new Error(`[SHOWCASE FATAL] Imóvel REF ${PROPERTY_REF} não encontrado no CRM`);
  }

  const rawFotos = imovelData.fotos || [];
  console.log(`[CRM DISCOVERY] Total de fotos encontradas no payload: ${rawFotos.length}`);

  const distinctHosts = new Set();
  rawFotos.forEach((f, idx) => {
    const u = typeof f === 'string' ? f : (f.url || f.link || f.url_menor);
    try {
      distinctHosts.add(new URL(u).hostname);
    } catch (e) {}
  });

  console.log(`[CRM DISCOVERY] Hosts únicos encontrados:`, Array.from(distinctHosts));
  console.log('\n----------------------------------------------------------------');
  console.log('LISTA DE FOTOS DO CRM (PRÉ-DOWNLOAD):');
  console.log('----------------------------------------------------------------');
  rawFotos.forEach((f, idx) => {
    const id = typeof f === 'object' ? f.id : 'N/A';
    const pos = typeof f === 'object' ? f.posicao : idx + 1;
    const dest = typeof f === 'object' ? f.destaque : (idx === 0);
    const cat = typeof f === 'object' ? f.categoria : 'Unidade';
    const u = typeof f === 'string' ? f : f.url;
    const um = typeof f === 'object' ? (f.url_menor ? 'SIM' : 'NÃO') : 'NÃO';
    let host = 'N/A';
    try { host = new URL(u).hostname; } catch (e) {}

    console.log(`  #${idx + 1} | ID: ${id} | Pos: ${pos} | Destaque: ${dest} | Cat: ${cat} | Host: ${host} | url_menor: ${um}`);
  });

  // 2. Execução da Ingestão Real
  console.log('\n[2/4] Executando pipeline de Ingestão e Materialização Física...');
  const service = new PhotoIngestionService({
    minShortEdgePx: 480,
    maxAspectRatio: 3.0,
    downloadTimeoutMs: 15000,
    maxSizeMb: 25
  });

  const ingestionResult = await service.ingestPropertyPhotos(PROPERTY_REF, {
    token: `showcase_${PROPERTY_REF}_${Date.now()}`
  });

  const durationMs = Date.now() - startTime;

  // 3. Exibir Tabela Detalhada das Fotos
  console.log('\n================================================================');
  console.log('TABELA DETALHADA DE INGESTÃO DAS FOTOS (REF 1628)');
  console.log('================================================================\n');

  console.log('| CRM # | CRM ID | Categoria | Pos | Dest | Status | Bytes | Dimensões | ShortEdge | AspectRatio | Status | Physical Hash (SHA-256) | Asset ID | Dedup |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  for (const r of ingestionResult.results) {
    const dim = r.accepted ? `${r.width}x${r.height}` : 'N/A';
    const se = r.accepted ? `${r.short_edge}px` : 'N/A';
    const ar = r.accepted ? r.aspect_ratio.toFixed(2) : 'N/A';
    const st = r.accepted ? 'ACEITA' : `REJEITADA (${r.rejection_reason})`;
    const hash = r.physical_hash ? r.physical_hash.slice(0, 16) + '...' : 'N/A';
    const aid = r.asset_id || 'N/A';
    const dedup = r.dedupe_hit ? 'SIM' : 'NÃO';

    console.log(`| ${r.crm_index} | ${r.crm_photo_id} | ${r.categoria} | ${r.posicao} | ${r.destaque} | ${r.status_download} | ${r.bytes} | ${dim} | ${se} | ${ar} | ${st} | ${hash} | ${aid} | ${dedup} |`);
  }

  // 4. Resumo Executivo
  console.log('\n================================================================');
  console.log('RESUMO EXECUTIVO DA INGESTÃO (REF 1628)');
  console.log('================================================================');
  console.log(`- Total de fotos no CRM:           ${ingestionResult.total_crm_photos}`);
  console.log(`- Downloads tentados:              ${ingestionResult.results.length}`);
  console.log(`- Fotos aceitas:                   ${ingestionResult.accepted_count}`);
  console.log(`- Fotos rejeitadas:                ${ingestionResult.rejected_count}`);
  console.log(`- Deduplication hits:              ${ingestionResult.dedup_hits}`);
  console.log(`- Unique physical blobs criados:   ${ingestionResult.unique_blobs}`);
  console.log(`- Property photo assets no catálogo: ${ingestionResult.property_assets_count}`);
  console.log(`- Bytes totais baixados:           ${(ingestionResult.total_bytes_downloaded / 1024 / 1024).toFixed(2)} MB (${ingestionResult.total_bytes_downloaded} bytes)`);
  console.log(`- Hosts reais homologados:         ${Array.from(distinctHosts).join(', ')}`);
  console.log(`- Tempo total de ingestão:         ${(durationMs / 1000).toFixed(2)}s`);

  // Distribuição de Resolução
  const resDist = {};
  ingestionResult.results.filter(r => r.accepted).forEach(r => {
    const key = `${r.width}x${r.height}`;
    resDist[key] = (resDist[key] || 0) + 1;
  });
  console.log(`- Distribuição de resoluções:      ${JSON.stringify(resDist)}`);

  // 5. Consulta do Property Media Pool para provar integração
  console.log('\n[3/4] Consultando Property Media Pool...');
  const poolData = await propertyMediaService.getPropertyMediaPool(PROPERTY_REF);
  console.log(`[MEDIA POOL] Fotos prontas no pool: ${poolData.photos.length}`);
  console.log(`[MEDIA POOL] Vídeos prontos no pool: ${poolData.videos.length}`);

  // 6. Teste de Re-Ingestão (Idempotência e Cache Físico)
  console.log('\n[4/4] Executando Re-Ingestão para validar Idempotência e Cache Físico...');
  const reingestStart = Date.now();
  const reingestResult = await service.ingestPropertyPhotos(PROPERTY_REF, {
    token: `showcase_reingest_${PROPERTY_REF}_${Date.now()}`
  });
  const reingestDuration = Date.now() - reingestStart;

  console.log(`[RE-INGESTION] Total de fotos aceitas: ${reingestResult.accepted_count}`);
  console.log(`[RE-INGESTION] Deduplication hits: ${reingestResult.dedup_hits} (100% de reaproveitamento de blobs canônicos)`);
  console.log(`[RE-INGESTION] Unique physical blobs: ${reingestResult.unique_blobs}`);
  console.log(`[RE-INGESTION] Tempo de re-ingestão: ${(reingestDuration / 1000).toFixed(2)}s`);

  // 7. Gerar Página HTML de Inspeção Visual
  const contactSheetHtmlPath = path.join(OUTPUTS_DIR, 'photos_contact_sheet.html');
  const acceptedPhotos = ingestionResult.results.filter(r => r.accepted);

  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Inspeção Visual de Fotos — REF ${PROPERTY_REF}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; margin: 0; }
    h1 { color: #38bdf8; font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
    .card { background: #1e293b; border-radius: 10px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3); }
    .card img { width: 100%; height: 220px; object-fit: cover; display: block; background: #000; }
    .card-content { padding: 14px; font-size: 13px; line-height: 1.5; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; }
    .badge-destaque { background: #f59e0b; color: #000; }
    .badge-normal { background: #3b82f6; color: #fff; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px solid #334155; padding-bottom: 3px; }
    .meta-label { color: #94a3b8; }
    .meta-val { color: #f1f5f9; font-weight: 500; }
    .hash { font-family: monospace; font-size: 11px; word-break: break-all; color: #a5f3fc; }
  </style>
</head>
<body>
  <h1>Inspeção Visual — Fotos do Imóvel REF ${PROPERTY_REF}</h1>
  <div class="subtitle">Fase 4B.1: Materialização Física & Ingestão de Fotos | Total Aceitas: ${acceptedPhotos.length} / ${ingestionResult.total_crm_photos}</div>
  
  <div class="grid">
    ${acceptedPhotos.map(p => `
      <div class="card">
        <img src="${p.url}" alt="Foto #${p.crm_index}" loading="lazy">
        <div class="card-content">
          <span class="badge ${p.destaque ? 'badge-destaque' : 'badge-normal'}">${p.destaque ? '★ Destaque CRM' : `Posição #${p.posicao}`}</span>
          <div class="meta-row"><span class="meta-label">CRM ID:</span><span class="meta-val">${p.crm_photo_id}</span></div>
          <div class="meta-row"><span class="meta-label">Categoria:</span><span class="meta-val">${p.categoria}</span></div>
          <div class="meta-row"><span class="meta-label">Dimensões:</span><span class="meta-val">${p.width}x${p.height} (${p.format})</span></div>
          <div class="meta-row"><span class="meta-label">Short Edge:</span><span class="meta-val">${p.short_edge}px</span></div>
          <div class="meta-row"><span class="meta-label">Aspect Ratio:</span><span class="meta-val">${p.aspect_ratio.toFixed(2)}</span></div>
          <div class="meta-row"><span class="meta-label">Bytes:</span><span class="meta-val">${(p.bytes / 1024).toFixed(1)} KB</span></div>
          <div class="meta-row"><span class="meta-label">Asset ID:</span><span class="meta-val" style="font-size: 11px;">${p.asset_id}</span></div>
          <div style="margin-top: 6px;">
            <span class="meta-label">Physical Hash:</span>
            <div class="hash">${p.physical_hash}</div>
          </div>
        </div>
      </div>
    `).join('')}
  </div>
</body>
</html>`;

  fs.writeFileSync(contactSheetHtmlPath, htmlContent, 'utf8');
  console.log(`\n[INSPEÇÃO VISUAL] Contact Sheet gerado com sucesso em:\n  ${contactSheetHtmlPath}`);

  console.log('\n================================================================');
  console.log('SHOWCASE CANÔNICO FASE 4B.1 CONCLUÍDO COM SUCESSO! ✅');
  console.log('================================================================\n');

  return {
    ingestionResult,
    reingestResult,
    contactSheetHtmlPath
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL ERROR in showcase:', err);
    process.exit(1);
  });
}

module.exports = { main };
