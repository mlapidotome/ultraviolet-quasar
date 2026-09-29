/**
 * MIGRAÇÃO MCMV — EXECUÇÃO CONTROLADA EM BLOCOS
 *
 * Regras:
 * - Verifica estado atual do lead ANTES de cada POST
 * - Verifica se já está no MCMV antes de cada POST (idempotência)
 * - Executa em blocos de 10 com pausa de 3s entre blocos
 * - 850ms de intervalo entre requisições
 * - Para em caso de 3+ erros consecutivos
 * - Não altera corretor, não dispara roleta, não remove cards do funil 3500
 * - Permite retomada segura via arquivo de progresso
 * - Não expõe a chave de API nos logs
 */

const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ENV_PATH = 'c:\\Users\\Marcel\\.gemini\\antigravity\\playground\\ultraviolet-quasar\\.env';
const LOTE_PATH = 'C:\\Users\\Marcel\\.gemini\\antigravity\\brain\\728282d3-72dc-4e95-bde7-45deb2dcecdd\\scratch\\lote_final_limpo.json';
const PROGRESS_PATH = 'C:\\Users\\Marcel\\.gemini\\antigravity\\playground\\ultraviolet-quasar\\data\\migracao_mcmv_progresso.json';
const LOG_PATH = 'C:\\Users\\Marcel\\.gemini\\antigravity\\playground\\ultraviolet-quasar\\data\\migracao_mcmv_log.json';

const FUNIL_MCMV = 5308;
const FUNIL_LANCAMENTOS = 3500;
const TARGET_REFS = new Set(['1581', '10', '1584']);
const EXCLUDED_IDS = new Set([4700949, 4667267]); // piloto já migrado + proposta retida

const BLOCK_SIZE = 10;
const DELAY_BETWEEN_REQS_MS = 850;
const DELAY_BETWEEN_BLOCKS_MS = 3000;

// ─── LOAD ENV ─────────────────────────────────────────────────────────────────
const envContent = fs.readFileSync(ENV_PATH, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (m) {
    let v = (m[2] || '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
});
const API_KEY = env.IMOBTOTAL_API_KEY;
const BASE_URL = env.IMOBTOTAL_BASE_URL || 'https://app.imobtotal.com.br/api/v1';

if (!API_KEY) { console.error('IMOBTOTAL_API_KEY nao encontrada no .env'); process.exit(1); }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`GET ${endpoint} -> HTTP ${res.status}`);
  return res.json();
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json };
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  return { processed: {}, started_at: new Date().toISOString() };
}

function saveProgress(progress) {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
}

function loadLog() {
  if (fs.existsSync(LOG_PATH)) return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  return { entries: [] };
}

function appendLog(log, entry) {
  log.entries.push(entry);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

// ─── STAGE MAP ────────────────────────────────────────────────────────────────
const STAGE_MAP = {
  'NOVO LEAD':                       { id_etapa: 15981, nome: 'CAIXA DE ENTRADA' },
  'LEADFY':                          { id_etapa: 15981, nome: 'CAIXA DE ENTRADA' },
  'AGUARDANDO RETORNO DO CLIENTE':   { id_etapa: 15257, nome: 'TENTANDO CONTATO COM O LEAD' },
  'TERCEIRA DIA AGUARDANDO CLIENTE': { id_etapa: 15257, nome: 'TENTANDO CONTATO COM O LEAD' },
  'SEGUNDO DIA AGUARDANDO CLIENTE':  { id_etapa: 15257, nome: 'TENTANDO CONTATO COM O LEAD' },
  'MORNO':                           { id_etapa: 15261, nome: 'EM ATENDIMENTO (SEM QUALIFAR)' },
  'QUENTE':                          { id_etapa: 15262, nome: 'EM ATENDIMENTO (QUALIFICADO)' },
  'FRIO':                            { id_etapa: 15260, nome: 'PAROU DE RESPONDER/NAO TEM INTERESSE' },
};

// ─── GET ALL IDS IN MCMV ──────────────────────────────────────────────────────
async function getIdsInMcmv() {
  const ids = new Set();
  let pagina = 1, temProxima = true;
  while (temProxima && pagina <= 10) {
    const data = await apiGet(`/leads?funil_id=${FUNIL_MCMV}&por_pagina=100&pagina=${pagina}`);
    (data.leads || []).forEach(l => ids.add(l.id));
    temProxima = data.tem_proxima === true;
    pagina++;
    if (temProxima) await sleep(400);
  }
  return ids;
}

// ─── VERIFY LEAD PRE-ADD ──────────────────────────────────────────────────────
async function verifyLead(leadPlan, idsInMcmv) {
  const lead = await apiGet(`/leads/${leadPlan.id}`);

  const currentRef = lead.interesse?.imovel_principal?.referencia || lead.imoveis_interesse?.[0]?.referencia;
  const currentEtapaNome = lead.etapa?.nome;
  const currentEtapaId = lead.etapa?.id;
  const currentCorretorId = lead.corretor_delegado?.id || null;
  const currentCorretorNome = lead.corretor_delegado?.nome || 'SEM CORRETOR';
  const currentFunilId = lead.funil?.id;

  const issues = [];

  if (currentFunilId !== FUNIL_LANCAMENTOS) {
    issues.push(`Funil primario mudou: era 3500, agora e ${currentFunilId} (${lead.funil?.nome})`);
  }
  if (!TARGET_REFS.has(currentRef)) {
    issues.push(`Referencia mudou: era ${leadPlan.referencia}, agora e ${currentRef}`);
  }
  if (idsInMcmv.has(lead.id) || EXCLUDED_IDS.has(lead.id)) {
    issues.push(`Lead ja esta no MCMV 5308 ou e excluido por politica`);
  }

  // Re-map stage if it changed
  let destinoEtapaId = leadPlan.etapa_destino_id;
  let destinoEtapaNome = leadPlan.etapa_destino_nome;
  let etapaChanged = false;

  if (currentEtapaId !== leadPlan.etapa_id) {
    const newMap = STAGE_MAP[currentEtapaNome];
    if (!newMap) {
      issues.push(`Etapa mudou para "${currentEtapaNome}" sem mapeamento aprovado`);
    } else {
      destinoEtapaId = newMap.id_etapa;
      destinoEtapaNome = newMap.nome;
      etapaChanged = true;
    }
  }

  const corretorChanged = currentCorretorId !== leadPlan.corretor_id;

  return {
    ok: issues.length === 0,
    issues,
    etapaChanged,
    corretorChanged,
    currentEtapaNome,
    currentCorretorNome,
    destinoEtapaId,
    destinoEtapaNome,
    currentRef,
    currentFunilId
  };
}

// ─── VERIFY BLOCK POST-EXECUTION ──────────────────────────────────────────────
async function verifyBlock(blockResults) {
  const newIds = await getIdsInMcmv();
  const verifications = [];
  for (const r of blockResults) {
    if (r.result !== 'MIGRADO') continue;
    const found = newIds.has(r.id);
    verifications.push({ id: r.id, nome: r.nome, card_no_mcmv: found });
  }
  return verifications;
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
function reportSummary(migrated, skipped, alreadyMcmv, errors, skippedLeads, errorLeads, progress) {
  console.log('\n======================================================');
  console.log(' RELATORIO FINAL DA MIGRACAO MCMV');
  console.log('======================================================');
  console.log(`Migrados com sucesso:   ${migrated}`);
  console.log(`Pulados (sem migrar):   ${skipped}`);
  console.log(`Ja estavam no MCMV:     ${alreadyMcmv}`);
  console.log(`Erros:                  ${errors}`);
  console.log(`Total processados:      ${Object.keys(progress.processed).length}`);
  console.log(`Log completo:           ${LOG_PATH}`);
  console.log(`Progresso (retomada):   ${PROGRESS_PATH}`);

  if (skippedLeads.length > 0) {
    console.log('\nLEADS PULADOS:');
    skippedLeads.forEach(l => console.log(`  ID ${l.id} (${l.nome}): ${l.motivo}`));
  }
  if (errorLeads.length > 0) {
    console.log('\nLEADS COM ERRO:');
    errorLeads.forEach(l => console.log(`  ID ${l.id} (${l.nome}): ${l.erro}`));
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('======================================================');
  console.log(' MIGRACAO MCMV — EXECUCAO CONTROLADA EM BLOCOS DE 10');
  console.log(` Inicio: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  console.log('======================================================\n');

  const lote = JSON.parse(fs.readFileSync(LOTE_PATH, 'utf8'));
  console.log(`Lote carregado: ${lote.length} leads`);

  const progress = loadProgress();
  const log = loadLog();
  const alreadyProcessed = new Set(Object.keys(progress.processed).map(Number));
  console.log(`Ja processados em execucoes anteriores: ${alreadyProcessed.size} leads`);

  const pending = lote.filter(l => !alreadyProcessed.has(l.id) && !EXCLUDED_IDS.has(l.id));
  console.log(`Pendentes nesta execucao: ${pending.length} leads\n`);

  if (pending.length === 0) {
    console.log('Todos os leads ja foram processados.');
    return;
  }

  console.log('Carregando lista atual do MCMV 5308...');
  let idsInMcmv = await getIdsInMcmv();
  console.log(`  ${idsInMcmv.size} leads ja no MCMV\n`);
  await sleep(500);

  let totalMigrated = 0, totalSkipped = 0, totalErrors = 0, totalAlreadyInMcmv = 0;
  const skippedLeads = [], errorLeads = [];
  let consecutiveErrors = 0;

  const blocks = [];
  for (let i = 0; i < pending.length; i += BLOCK_SIZE) blocks.push(pending.slice(i, i + BLOCK_SIZE));
  console.log(`Total de blocos: ${blocks.length}\n`);

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx++) {
    const block = blocks[blockIdx];
    const blockResults = [];

    console.log(`\n--- BLOCO ${blockIdx + 1}/${blocks.length} ---`);

    for (const leadPlan of block) {
      const logEntry = {
        ts: new Date().toISOString(),
        id: leadPlan.id,
        nome: leadPlan.nome,
        referencia: leadPlan.referencia,
        etapa_origem: leadPlan.etapa_nome,
        etapa_destino_nome: leadPlan.etapa_destino_nome,
        etapa_destino_id: leadPlan.etapa_destino_id,
        result: null,
        http_status: null,
        api_action: null,
        motivo: null,
        corretor: leadPlan.corretor_nome
      };

      process.stdout.write(`  [${leadPlan.id}] ${(leadPlan.nome || '').substring(0,28).padEnd(28)} | `);

      try {
        const check = await verifyLead(leadPlan, idsInMcmv);

        if (!check.ok) {
          const motivo = check.issues.join('; ');
          process.stdout.write(`PULADO: ${motivo}\n`);
          logEntry.result = 'PULADO';
          logEntry.motivo = motivo;
          logEntry.etapa_destino_id = null;
          skippedLeads.push({ id: leadPlan.id, nome: leadPlan.nome, motivo });
          totalSkipped++;
          consecutiveErrors = 0;
          progress.processed[leadPlan.id] = { result: 'PULADO', motivo, ts: logEntry.ts };
          saveProgress(progress);
          appendLog(log, logEntry);
          blockResults.push({ ...logEntry });
          await sleep(DELAY_BETWEEN_REQS_MS);
          continue;
        }

        let notas = [];
        if (check.etapaChanged) notas.push(`etapa: ${check.currentEtapaNome}->${check.destinoEtapaNome}`);
        if (check.corretorChanged) notas.push(`corretor: ${check.currentCorretorNome}`);

        logEntry.etapa_destino_id = check.destinoEtapaId;
        logEntry.etapa_destino_nome = check.destinoEtapaNome;

        await sleep(200);
        const postResult = await apiPost('/pipeline/leads', {
          id_lead: leadPlan.id,
          id_etapa: check.destinoEtapaId
        });

        logEntry.http_status = postResult.status;
        logEntry.api_action = postResult.body?.action;

        if (postResult.status === 201 && postResult.body?.action === 'created') {
          const notasStr = notas.length ? ` (${notas.join(', ')})` : '';
          process.stdout.write(`OK -> ${check.destinoEtapaNome}${notasStr}\n`);
          logEntry.result = 'MIGRADO';
          totalMigrated++;
          consecutiveErrors = 0;
          idsInMcmv.add(leadPlan.id);
          progress.processed[leadPlan.id] = { result: 'MIGRADO', etapa_id: check.destinoEtapaId, etapa_nome: check.destinoEtapaNome, ts: logEntry.ts };
        } else if (postResult.body?.action === 'updated') {
          process.stdout.write(`JA NO MCMV (action=updated)\n`);
          logEntry.result = 'JA_NO_MCMV';
          logEntry.motivo = 'action=updated — lead ja tinha card no MCMV';
          totalAlreadyInMcmv++;
          consecutiveErrors = 0;
          progress.processed[leadPlan.id] = { result: 'JA_NO_MCMV', ts: logEntry.ts };
        } else {
          const msg = `HTTP ${postResult.status} body=${JSON.stringify(postResult.body).substring(0,120)}`;
          process.stdout.write(`ERRO: ${msg}\n`);
          logEntry.result = 'ERRO';
          logEntry.motivo = msg;
          errorLeads.push({ id: leadPlan.id, nome: leadPlan.nome, erro: msg });
          totalErrors++;
          consecutiveErrors++;
          progress.processed[leadPlan.id] = { result: 'ERRO', motivo: msg, ts: logEntry.ts };

          if (consecutiveErrors >= 3) {
            saveProgress(progress);
            appendLog(log, logEntry);
            console.error('\n[HALT] 3 erros consecutivos — execucao interrompida para diagnostico.');
            reportSummary(totalMigrated, totalSkipped, totalAlreadyInMcmv, totalErrors, skippedLeads, errorLeads, progress);
            process.exit(1);
          }
        }

        saveProgress(progress);
        appendLog(log, logEntry);
        blockResults.push({ ...logEntry });

      } catch (err) {
        process.stdout.write(`EXCECAO: ${err.message}\n`);
        const entry2 = { ...logEntry, result: 'EXCECAO', motivo: err.message, ts: new Date().toISOString() };
        errorLeads.push({ id: leadPlan.id, nome: leadPlan.nome, erro: err.message });
        totalErrors++;
        consecutiveErrors++;
        progress.processed[leadPlan.id] = { result: 'EXCECAO', motivo: err.message, ts: entry2.ts };
        saveProgress(progress);
        appendLog(log, entry2);
        blockResults.push(entry2);

        if (consecutiveErrors >= 3) {
          console.error('\n[HALT] 3 excecoes consecutivas — interrompendo execucao.');
          reportSummary(totalMigrated, totalSkipped, totalAlreadyInMcmv, totalErrors, skippedLeads, errorLeads, progress);
          process.exit(1);
        }
      }

      await sleep(DELAY_BETWEEN_REQS_MS);
    }

    // Post-block verification
    console.log(`\n  Verificando bloco ${blockIdx + 1} no MCMV...`);
    try {
      const verifs = await verifyBlock(blockResults);
      let vOk = 0, vFail = 0;
      verifs.forEach(v => {
        if (v.card_no_mcmv) { vOk++; }
        else { vFail++; console.log(`  AVISO: ${v.id} nao encontrado no MCMV apos migracao`); }
      });
      console.log(`  Confirmados no MCMV: ${vOk}/${verifs.length}`);
    } catch (e) {
      console.log(`  Verificacao pos-bloco falhou: ${e.message}`);
    }

    const bMig = blockResults.filter(r => r.result === 'MIGRADO').length;
    const bSkip = blockResults.filter(r => r.result === 'PULADO' || r.result === 'JA_NO_MCMV').length;
    console.log(`  Bloco ${blockIdx + 1}: ${bMig} migrados, ${bSkip} pulados/ja-migrados`);
    console.log(`  Acumulado: ${totalMigrated} migrados | ${totalSkipped} pulados | ${totalAlreadyInMcmv} ja-no-mcmv | ${totalErrors} erros`);

    if (blockIdx < blocks.length - 1) {
      console.log(`  Aguardando ${DELAY_BETWEEN_BLOCKS_MS / 1000}s antes do proximo bloco...`);
      await sleep(DELAY_BETWEEN_BLOCKS_MS);
    }
  }

  reportSummary(totalMigrated, totalSkipped, totalAlreadyInMcmv, totalErrors, skippedLeads, errorLeads, progress);
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
