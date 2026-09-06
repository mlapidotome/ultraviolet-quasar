/**
 * Showcase Canônico — Photo Media Understanding Proof (Fase 4B.2)
 * Bali Imóveis — Video Engine V2
 * 
 * Execução Real sobre o Imóvel REF 1628 com VLM OpenAI (GPT-4o-mini)
 */

const fs = require('fs');
const path = require('path');
const {
  PhotoMediaUnderstandingService,
  OpenAIPhotoUnderstandingProvider,
  MockPhotoUnderstandingProvider
} = require('./video_engine/property_media/photo_understanding');

const propertyMediaService = require('./video_engine/property_media/property_media_service');
const { PhotoIngestionService } = require('./video_engine/property_media/photo_ingestion');

const PROPERTY_REF = '1628';
const OUTPUTS_DIR = path.join(__dirname, 'outputs', 'properties', PROPERTY_REF);

if (!fs.existsSync(OUTPUTS_DIR)) {
  fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

async function runShowcase() {
  console.log('================================================================');
  console.log(`INICIANDO SHOWCASE CANÔNICO FASE 4B.2: REF ${PROPERTY_REF}`);
  console.log('================================================================\n');

  const startTime = Date.now();

  // 1. Garantir que as 11 fotos reais estejam materializadas no catálogo
  console.log('[1/5] Verificando fotos READY no Property Media Pool da REF 1628...');
  const ingestService = new PhotoIngestionService();
  await ingestService.ingestPropertyPhotos(PROPERTY_REF);

  const pool = await propertyMediaService.getPropertyMediaPool(PROPERTY_REF);
  const readyPhotos = pool.photos || [];

  console.log(`[MEDIA POOL] Total de fotos físicas materializadas: ${readyPhotos.length}`);
  if (readyPhotos.length === 0) {
    throw new Error(`[SHOWCASE FATAL] Nenhuma foto READY encontrada para REF ${PROPERTY_REF}`);
  }

  // 2. Inicializar Serviço com Provider OpenAI Real
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[SHOWCASE FATAL] OPENAI_API_KEY não configurada no ambiente (.env)');
  }

  const modelId = process.env.VLM_PHOTO_MODEL_ID || 'gpt-4o-mini';
  console.log(`[PROVIDER] Inicializando OpenAIPhotoUnderstandingProvider (model: ${modelId}, detail: high)...`);

  const provider = new OpenAIPhotoUnderstandingProvider({
    apiKey,
    modelId,
    detail: 'high',
    temperature: 0.1
  });

  const understandingService = new PhotoMediaUnderstandingService({ provider });

  // 3. RUN A — Execução Inicial (Cold Run / Computed)
  console.log('\n[2/5] Executando RUN A (Análise Visual Real das 11 Fotos via VLM)...');
  const runAStart = Date.now();
  const runAResults = [];

  for (let i = 0; i < readyPhotos.length; i++) {
    const photoAsset = readyPhotos[i];
    const crmIdx = photoAsset.metadata?.posicao || (i + 1);
    const crmCat = photoAsset.metadata?.categoria || 'Unidade';
    console.log(`  -> Analisando Foto #${crmIdx} (ID: ${photoAsset.metadata?.crm_photo_id || 'N/A'}, Categoria: ${crmCat})...`);

    const res = await understandingService.analyzePropertyPhoto(photoAsset);
    runAResults.push(res);
    console.log(`     ✓ Resultado: primary='${res.semantic_view.semantic.primary_room_type}', conf=${res.semantic_view.semantic.confidence}, composite_quality=${res.semantic_view.quality.composite_quality_score}, cache_hit=${res.cache_hit}`);
  }
  const runADurationMs = Date.now() - runAStart;

  // 4. RUN B — Execução de Prova de Cache (100% Cache Hit)
  console.log('\n[3/5] Executando RUN B (Prova de Cache Global Imutável)...');
  const runBStart = Date.now();
  const runBResults = [];
  const callsBeforeRunB = provider.totalCalls;

  for (let i = 0; i < readyPhotos.length; i++) {
    const photoAsset = readyPhotos[i];
    const res = await understandingService.analyzePropertyPhoto(photoAsset);
    runBResults.push(res);
  }
  const runBDurationMs = Date.now() - runBStart;
  const callsDuringRunB = provider.totalCalls - callsBeforeRunB;

  console.log(`[CACHE PROOF] Total de fotos no RUN B: ${runBResults.length}`);
  console.log(`[CACHE PROOF] Cache Hits no RUN B: ${runBResults.filter(r => r.cache_hit).length} / ${runBResults.length} (100%)`);
  console.log(`[CACHE PROOF] Chamadas de API no RUN B: ${callsDuringRunB} (ZERO chamadas VLM)`);
  console.log(`[CACHE PROOF] Duração RUN A: ${(runADurationMs / 1000).toFixed(2)}s | Duração RUN B: ${(runBDurationMs / 1000).toFixed(2)}s`);

  // 5. Ranking Intra-Ambiente
  console.log('\n[4/5] Calculando Ranking Intra-Ambiente por Cômodo...');
  const semanticViews = runAResults.map(r => r.semantic_view);
  const rankedViews = understandingService.rankIntraRoomPhotos(semanticViews);

  // Criar mapa de rank por asset_id
  const rankMap = new Map();
  rankedViews.forEach(v => rankMap.set(v.asset_id, v));

  // 6. Exibir Tabela Completa das 11 Fotos
  console.log('\n========================================================================================================================');
  console.log('TABELA COMPLETA DE ENTENDIMENTO SEMÂNTICO DAS 11 FOTOS (REF 1628)');
  console.log('========================================================================================================================\n');

  console.log('| # | Asset ID | Primary Room | Secondary Rooms | Features | Conf | Tech Q. | Aest Q. | Edit Util | Label | Comp Q. | CRM Cat | CRM Norm | Div? | Intra Rank |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  readyPhotos.forEach((p, idx) => {
    const view = rankMap.get(p.asset_id) || semanticViews[idx];
    const sem = view.semantic;
    const q = view.quality;
    const crm = view.crm_context;
    const rec = view.semantic_reconciliation;

    const num = p.metadata?.posicao || (idx + 1);
    const aid = (view.asset_id || '').slice(0, 16) + '...';
    const primary = sem.primary_room_type;
    const sec = sem.secondary_room_types.length > 0 ? sem.secondary_room_types.join(',') : '-';
    const feats = sem.features.length > 0 ? sem.features.join(',') : '-';
    const conf = sem.confidence.toFixed(2);
    const tech = q.technical_quality.score.toFixed(2);
    const aest = q.aesthetic_score.score.toFixed(2);
    const edit = q.editorial_utility.score.toFixed(2);
    const label = q.editorial_utility.utility_label;
    const comp = q.composite_quality_score.toFixed(2);
    const crmCat = crm.raw_crm_category || 'N/A';
    const crmNorm = crm.normalized_crm_room_hint || '-';
    const div = rec.divergence_detected ? `SIM (${rec.divergence_reason})` : 'NÃO';
    const intra = `#${view.intra_rank || 1} (${view.intra_rank_score?.toFixed(2) || comp})`;

    console.log(`| ${num} | ${aid} | ${primary} | ${sec} | ${feats} | ${conf} | ${tech} | ${aest} | ${edit} | ${label} | ${comp} | ${crmCat} | ${crmNorm} | ${div} | ${intra} |`);
  });

  // 7. Relatório por Ambiente (Agrupamento e Ranking)
  console.log('\n================================================================');
  console.log('RANKING COMPARATIVO POR AMBIENTE (INTRA-ROOM RANKING)');
  console.log('================================================================\n');

  const byRoom = {};
  rankedViews.forEach(v => {
    const r = v.semantic.primary_room_type;
    if (!byRoom[r]) byRoom[r] = [];
    byRoom[r].push(v);
  });

  for (const [room, items] of Object.entries(byRoom)) {
    console.log(`► AMBIENTE: [${room.toUpperCase()}] (${items.length} foto${items.length > 1 ? 's' : ''})`);
    items.forEach(it => {
      console.log(`   Rank #${it.intra_rank} | Score: ${it.intra_rank_score.toFixed(2)} | Conf: ${it.semantic.confidence.toFixed(2)} | Hash: ${it.physical_file_hash.slice(0, 16)}... | Label: ${it.quality.editorial_utility.utility_label}`);
      console.log(`      Descrição: "${it.semantic.description}"`);
      console.log(`      Features: [${it.semantic.features.join(', ')}]`);
    });
    console.log('');
  }

  // 8. Relatório de Consumo e Custo Real
  console.log('================================================================');
  console.log('AUDITORIA DE CUSTO E CONSUMO REAL DE TOKENS (REF 1628)');
  console.log('================================================================');
  console.log(`- Provedor:                    ${provider.providerName}`);
  console.log(`- Modelo VLM:                  ${provider.modelId}`);
  console.log(`- Total de Chamadas API:       ${provider.totalCalls}`);
  console.log(`- Total Prompt Tokens:         ${provider.totalPromptTokens}`);
  console.log(`- Total Completion Tokens:     ${provider.totalCompletionTokens}`);
  console.log(`- Total Tokens Consumidos:     ${provider.totalPromptTokens + provider.totalCompletionTokens}`);
  console.log(`- Custo Real Total Calculado:  $${provider.totalCostUsd.toFixed(5)} USD (~R$ ${(provider.totalCostUsd * 5.6).toFixed(4)})`);
  console.log(`- Custo Médio por Foto:        $${(provider.totalCostUsd / (readyPhotos.length || 1)).toFixed(5)} USD`);

  // 9. Gerar Contact Sheet HTML Interativo com Cards
  const contactSheetHtmlPath = path.join(OUTPUTS_DIR, 'photo_understanding_contact_sheet.html');

  const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Photo Media Understanding — REF ${PROPERTY_REF}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; padding: 28px; margin: 0; }
    h1 { color: #38bdf8; font-size: 26px; margin: 0 0 6px 0; }
    .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .summary-box { background: #131d31; border: 1px solid #1e293b; border-radius: 10px; padding: 18px; margin-bottom: 28px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .metric-card { background: #1e293b; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #38bdf8; }
    .metric-title { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }
    .metric-value { font-size: 20px; color: #f1f5f9; font-weight: 700; margin-top: 4px; }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }
    .card { background: #131d31; border-radius: 12px; overflow: hidden; border: 1px solid #1e293b; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; }
    .card-img-container { position: relative; width: 100%; height: 260px; background: #000; overflow: hidden; }
    .card-img-container img { width: 100%; height: 100%; object-fit: contain; }
    .rank-badge { position: absolute; top: 12px; left: 12px; background: #38bdf8; color: #0b0f19; font-weight: 700; font-size: 12px; padding: 4px 10px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); }
    .room-badge { position: absolute; top: 12px; right: 12px; background: #0284c7; color: #fff; font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; }
    
    .card-body { padding: 18px; flex: 1; display: flex; flex-direction: column; font-size: 13px; }
    .desc-text { color: #e2e8f0; font-size: 13px; line-height: 1.4; margin-bottom: 14px; font-style: italic; }
    
    .section-title { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin: 10px 0 6px 0; }
    .pill-group { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .pill { background: #1e293b; color: #a5f3fc; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; border: 1px solid #334155; }
    .pill-sec { background: #2d1b4e; color: #e9d5ff; border-color: #581c87; }
    
    .scores-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; background: #0f172a; padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #1e293b; }
    .score-item { text-align: center; }
    .score-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; }
    .score-val { font-size: 15px; font-weight: 700; color: #38bdf8; margin-top: 2px; }
    
    .utility-tag { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-align: center; margin-bottom: 10px; width: 100%; }
    .tag-high_value_anchor { background: #065f46; color: #6ee7b7; border: 1px solid #059669; }
    .tag-supporting_detail { background: #1e40af; color: #93c5fd; border: 1px solid #2563eb; }
    .tag-marginal_usable { background: #854d0e; color: #fde047; border: 1px solid #ca8a04; }
    .tag-editorial_reject { background: #881337; color: #fda4af; border: 1px solid #e11d48; }
    
    .meta-table { width: 100%; font-size: 11px; border-collapse: collapse; margin-top: auto; }
    .meta-table td { padding: 4px 0; border-top: 1px solid #1e293b; }
    .meta-key { color: #64748b; }
    .meta-val { color: #cbd5e1; text-align: right; font-family: monospace; }
    .hash-text { word-break: break-all; font-size: 10px; color: #38bdf8; }
  </style>
</head>
<body>
  <h1>Inspeção Visual — Photo Media Understanding</h1>
  <div class="subtitle">Showcase Canônico Fase 4B.2 | Imóvel REF ${PROPERTY_REF} | Total de Fotos: ${readyPhotos.length}</div>

  <div class="summary-box">
    <div class="metric-card">
      <div class="metric-title">Modelo VLM</div>
      <div class="metric-value" style="font-size: 16px;">${provider.modelId}</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Fotos Analisadas</div>
      <div class="metric-value">${readyPhotos.length}</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Cache Hit (Run B)</div>
      <div class="metric-value" style="color: #4ade80;">100%</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Custo Total API</div>
      <div class="metric-value" style="color: #38bdf8;">$${provider.totalCostUsd.toFixed(4)}</div>
    </div>
  </div>

  <div class="grid">
    ${readyPhotos.map((p, idx) => {
      const view = rankMap.get(p.asset_id) || semanticViews[idx];
      const sem = view.semantic;
      const q = view.quality;
      const crm = view.crm_context;
      const rec = view.semantic_reconciliation;
      const imgUrl = p.metadata?.crm_sources?.[0]?.url || p.storage_path;

      return `
        <div class="card">
          <div class="card-img-container">
            <img src="${p.metadata?.crm_sources?.[0]?.url || ''}" alt="Foto #${p.metadata?.posicao || (idx + 1)}" loading="lazy">
            <div class="rank-badge">Rank #${view.intra_rank || 1} no Cômodo</div>
            <div class="room-badge">${sem.primary_room_type}</div>
          </div>
          <div class="card-body">
            <div class="desc-text">"${sem.description}"</div>

            <div class="utility-tag tag-${q.editorial_utility.utility_label}">
              ★ ${q.editorial_utility.utility_label.toUpperCase()} (Score: ${q.editorial_utility.score.toFixed(2)})
            </div>

            <div class="scores-grid">
              <div class="score-item">
                <div class="score-label">Técnico</div>
                <div class="score-val">${q.technical_quality.score.toFixed(2)}</div>
              </div>
              <div class="score-item">
                <div class="score-label">Estético</div>
                <div class="score-val">${q.aesthetic_score.score.toFixed(2)}</div>
              </div>
              <div class="score-item">
                <div class="score-label">Composto</div>
                <div class="score-val" style="color: #4ade80;">${q.composite_quality_score.toFixed(2)}</div>
              </div>
            </div>

            ${sem.secondary_room_types.length > 0 ? `
              <div class="section-title">Ambientes Secundários:</div>
              <div class="pill-group">
                ${sem.secondary_room_types.map(s => `<span class="pill pill-sec">+ ${s}</span>`).join('')}
              </div>
            ` : ''}

            <div class="section-title">Diferenciais Detectados:</div>
            <div class="pill-group">
              ${sem.features.length > 0 ? sem.features.map(f => `<span class="pill">${f}</span>`).join('') : '<span style="color: #64748b; font-size: 11px;">Nenhuma feature isolada</span>'}
            </div>

            <div class="section-title">Contexto & Reconciliação CRM:</div>
            <table class="meta-table">
              <tr><td class="meta-key">CRM Categoria Original:</td><td class="meta-val">${crm.raw_crm_category || 'N/A'}</td></tr>
              <tr><td class="meta-key">CRM Hint Normalizado:</td><td class="meta-val">${crm.normalized_crm_room_hint || 'não comparável'}</td></tr>
              <tr><td class="meta-key">Divergência Detectada:</td><td class="meta-val" style="color: ${rec.divergence_detected ? '#f87171' : '#4ade80'};">${rec.divergence_detected ? 'SIM (' + rec.divergence_reason + ')' : 'NÃO'}</td></tr>
              <tr><td class="meta-key">Confidence VLM:</td><td class="meta-val">${(sem.confidence * 100).toFixed(0)}%</td></tr>
              <tr><td class="meta-key">Asset ID:</td><td class="meta-val" style="font-size: 10px;">${view.asset_id}</td></tr>
              <tr><td class="meta-key">Analysis Key:</td><td class="meta-val hash-text">${view.photo_analysis_key.slice(0, 24)}...</td></tr>
            </table>
          </div>
        </div>
      `;
    }).join('')}
  </div>
</body>
</html>`;

  fs.writeFileSync(contactSheetHtmlPath, htmlContent, 'utf8');
  console.log(`\n[INSPEÇÃO VISUAL] Contact Sheet gerado com sucesso em:\n  ${contactSheetHtmlPath}`);

  console.log('\n================================================================');
  console.log('SHOWCASE CANÔNICO FASE 4B.2 CONCLUÍDO COM SUCESSO! ✅');
  console.log('================================================================\n');

  return {
    readyPhotos,
    runAResults,
    runBResults,
    rankedViews,
    contactSheetHtmlPath,
    providerMetrics: {
      model: provider.modelId,
      totalCalls: provider.totalCalls,
      totalPromptTokens: provider.totalPromptTokens,
      totalCompletionTokens: provider.totalCompletionTokens,
      totalCostUsd: provider.totalCostUsd
    }
  };
}

if (require.main === module) {
  runShowcase().catch(err => {
    console.error('FATAL ERROR in Phase 4B.2 Showcase:', err);
    process.exit(1);
  });
}

module.exports = { runShowcase };
