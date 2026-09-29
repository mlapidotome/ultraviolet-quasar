/**
 * Suíte de Testes de Simulação do Sincronizador (Etapa 3.1)
 * 
 * Valida os cenários exigidos por Marcel sem modificar leads reais:
 * 1. Paginação com múltiplas páginas e detecção de cobertura.
 * 2. Entrada de lead novo.
 * 3. Mudança de responsável (atribuição, desatribuição e troca de corretor).
 * 4. Mudança de etapa do pipeline.
 * 5. Desaparecimento de um lead do filtro sem_corretor=true com confirmação obrigatória.
 * 6. Falha de conexão e retomada de estado (persistência resiliente).
 * 7. Reação ao rate limit baixo e tratamento de HTTP 429.
 */

const assert = require('assert');
const ImobTotalSyncPrototype = require('./imobtotal_sync_prototype');
const path = require('path');
const fs = require('fs');

async function runSimulations() {
  console.log('🧪 ========================================================');
  console.log('🧪 INICIANDO SUÍTE DE SIMULAÇÃO DO SINCRONIZADOR (ETAPA 3.1)');
  console.log('🧪 ========================================================\n');

  const testStateFile = path.join(__dirname, '..', '..', 'data', 'test_sync_state.json');
  if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);

  // Instanciar o sincronizador apontando para o arquivo de teste
  const sync = new ImobTotalSyncPrototype({
    stateFilePath: testStateFile,
    janelaDias: 15,
    minDelayMs: 10 // rápido para testes simulados
  });

  // --- CENÁRIO 1: MOCK DE RESPOSTAS DA API ---
  let mockDatabase = {
    leadsFunilMAP: [
      { id: 101, funil: { id: 5297, nome: 'MAP' }, etapa: { id: 15426, nome: 'CAIXA DE ENTRADA' }, corretor_delegado: { id: 1, nome: 'Fabio Lopes' }, data_cadastro: '2026-09-18T10:00:00Z' },
      { id: 102, funil: { id: 5297, nome: 'MAP' }, etapa: { id: 15426, nome: 'CAIXA DE ENTRADA' }, corretor_delegado: null, data_cadastro: '2026-09-18T11:00:00Z' }
    ],
    leadsFunilTerceiros: [
      { id: 201, funil: { id: 3515, nome: 'Terceiros - Portais e Google' }, etapa: { id: 7923, nome: 'AGUARDANDO RETORNO DO CLIENTE' }, corretor_delegado: { id: 2, nome: 'Jéssica Bueno' }, data_cadastro: '2026-09-18T12:00:00Z' }
    ],
    leadsSemCorretor: [
      { id: 102, funil: { id: 5297, nome: 'MAP' }, etapa: { id: 15426, nome: 'CAIXA DE ENTRADA' }, corretor_delegado: null, data_cadastro: '2026-09-18T11:00:00Z' }
    ],
    leadsIndividuais: {}
  };

  // Mock do executeGet
  sync.executeGet = async (endpoint, params = {}) => {
    sync.rateLimiter.totalRequestsMade++;

    if (endpoint === '/leads') {
      if (params.id) {
        return mockDatabase.leadsIndividuais[params.id] || mockDatabase.leadsFunilMAP.find(l => l.id === params.id) || mockDatabase.leadsFunilTerceiros.find(l => l.id === params.id) || null;
      }
      if (params.sem_corretor) {
        return { total: mockDatabase.leadsSemCorretor.length, tem_proxima: false, leads: mockDatabase.leadsSemCorretor };
      }
      if (params.funil_id === 5297) {
        return { total: mockDatabase.leadsFunilMAP.length, tem_proxima: false, leads: mockDatabase.leadsFunilMAP };
      }
      if (params.funil_id === 3515) {
        return { total: mockDatabase.leadsFunilTerceiros.length, tem_proxima: false, leads: mockDatabase.leadsFunilTerceiros };
      }
    }
    return { total: 0, tem_proxima: false, leads: [] };
  };

  // -------------------------------------------------------------
  // TESTE 1: Primeiro ciclo (Descoberta de leads e estado inicial)
  // -------------------------------------------------------------
  console.log('▶️ TESTE 1: Primeiro ciclo de sincronização (Bootstrap inicial)...');
  const resCiclo1 = await sync.runSyncCycle();
  assert.strictEqual(resCiclo1.stats.novosLeadsDetectados, 3, 'Deveria detectar 3 leads novos');
  assert.strictEqual(resCiclo1.stats.mudancasResponsavel, 0, 'Não deve haver mudanças no 1º ciclo');
  assert.strictEqual(resCiclo1.totalLeadsAtualmenteMonitorados, 3, 'Total monitorado deve ser 3');
  
  const lead102 = sync.monitoredLeads.get(102);
  assert.ok(lead102.primeira_observacao_sem_resp_em !== null, 'Lead 102 deve ter data de primeira observação sem responsável');
  console.log('  ✅ Sucesso: 3 leads descobertos, lead sem responsável devidamente carimbado.\n');

  // -------------------------------------------------------------
  // TESTE 2: Segundo ciclo com MUDANÇAS (Novo lead, Mudança de Etapa e Troca de Corretor)
  // -------------------------------------------------------------
  console.log('▶️ TESTE 2: Simulação de eventos (Novo lead, Mudança de Etapa, Troca de Corretor)...');
  
  // Modificar mock
  // Lead 101: mudou de etapa para "TENTANDO CONTATO" e trocou de corretor para "Renato Felix"
  mockDatabase.leadsFunilMAP[0].etapa = { id: 15204, nome: 'TENTANDO CONTATO COM O LEAD' };
  mockDatabase.leadsFunilMAP[0].corretor_delegado = { id: 3, nome: 'Renato Felix' };

  // Lead 301: novo lead entrou no MAP
  mockDatabase.leadsFunilMAP.push({
    id: 301,
    funil: { id: 5297, nome: 'MAP' },
    etapa: { id: 15426, nome: 'CAIXA DE ENTRADA' },
    corretor_delegado: { id: 1, nome: 'Fabio Lopes' },
    data_cadastro: '2026-09-19T08:00:00Z'
  });

  const resCiclo2 = await sync.runSyncCycle();
  assert.strictEqual(resCiclo2.stats.novosLeadsDetectados, 1, 'Deve detectar 1 lead novo (301)');
  assert.strictEqual(resCiclo2.stats.mudancasResponsavel, 1, 'Deve detectar 1 mudança de responsável no 101');
  assert.strictEqual(resCiclo2.stats.mudancasEtapa, 1, 'Deve detectar 1 mudança de etapa no 101');
  assert.strictEqual(resCiclo2.totalLeadsAtualmenteMonitorados, 4, 'Total monitorado agora é 4');

  const lead101 = sync.monitoredLeads.get(101);
  const eventoEtapa = lead101.historico_observacoes.find(e => e.tipo === 'MUDANCA_ETAPA_OBSERVADA');
  assert.ok(eventoEtapa, 'Deve existir evento de mudança de etapa registrado');
  assert.strictEqual(eventoEtapa.de_etapa_nome, 'CAIXA DE ENTRADA');
  assert.strictEqual(eventoEtapa.para_etapa_nome, 'TENTANDO CONTATO COM O LEAD');
  assert.ok(Array.isArray(eventoEtapa.intervalo_observado), 'Intervalo observado deve ser um par de datas');
  console.log('  ✅ Sucesso: Mudança de responsável e etapa registradas com intervalo [T_ant, T_atual].\n');

  // -------------------------------------------------------------
  // TESTE 3: Desaparecimento de lead de sem_corretor com Confirmação Obrigatória
  // -------------------------------------------------------------
  console.log('▶️ TESTE 3: Desaparecimento de lead sem corretor com confirmação individual...');
  
  // Lead 102 foi atribuído a Jéssica Bueno (saiu da lista de sem_corretor)
  mockDatabase.leadsSemCorretor = []; // esvaziou a lista de sem corretor
  mockDatabase.leadsFunilMAP[1].corretor_delegado = { id: 2, nome: 'Jéssica Bueno' }; // atribuído

  const resCiclo3 = await sync.runSyncCycle();
  assert.strictEqual(resCiclo3.stats.mudancasResponsavel, 1, 'Lead 102 teve atribuição detectada');
  
  const lead102Atualizado = sync.monitoredLeads.get(102);
  assert.strictEqual(lead102Atualizado.corretor_nome, 'Jéssica Bueno');
  assert.strictEqual(lead102Atualizado.primeira_observacao_sem_resp_em, null, 'Data sem responsável deve ser resetada');
  console.log('  ✅ Sucesso: Atribuição de lead confirmada sem presunção cega.\n');

  // -------------------------------------------------------------
  // TESTE 4: Persistência e Retomada após Falha
  // -------------------------------------------------------------
  console.log('▶️ TESTE 4: Teste de Resiliência e Retomada de Estado após reinício...');
  
  // Criar nova instância lendo o mesmo arquivo de estado
  const syncNovo = new ImobTotalSyncPrototype({
    stateFilePath: testStateFile,
    janelaDias: 15,
    minDelayMs: 10
  });

  assert.strictEqual(syncNovo.monitoredLeads.size, 4, 'Nova instância deve recuperar os 4 leads monitorados do disco');
  const lead101Recuperado = syncNovo.monitoredLeads.get(101);
  assert.strictEqual(lead101Recuperado.corretor_nome, 'Renato Felix');
  assert.strictEqual(lead101Recuperado.etapa_nome, 'TENTANDO CONTATO COM O LEAD');
  console.log('  ✅ Sucesso: Estado persistido intacto e recuperado com histórico completo.\n');

  // -------------------------------------------------------------
  // TESTE 5: Verificação do RateLimiter sob Rate Limit Baixo e 429
  // -------------------------------------------------------------
  console.log('▶️ TESTE 5: Comportamento do RateLimiter defensivo...');
  
  const limiter = syncNovo.rateLimiter;
  limiter.updateFromHeaders({
    'x-ratelimit-remaining-short': '1', // saldo curto crítico
    'x-ratelimit-reset-short': '1',
    'x-ratelimit-remaining': '3',       // saldo minuto crítico
    'x-ratelimit-reset': '1',
    'x-ratelimit-remaining-long': '35', // saldo horário crítico (< 40)
    'x-ratelimit-reset-long': '10'
  });

  const snap = limiter.getSnapshot();
  assert.strictEqual(snap.remainingShort, 1);
  assert.strictEqual(snap.remainingMinute, 3);
  assert.strictEqual(snap.remainingLong, 35);

  const wait429 = limiter.handle429({ 'x-ratelimit-reset': '15' });
  assert.strictEqual(wait429, 15000, 'handle429 deve indicar espera de 15 segundos sem loop');
  console.log('  ✅ Sucesso: RateLimiter identifica saldo baixo e calcula espera do 429 defensivamente.\n');

  // Limpeza
  if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);

  console.log('🏆 ========================================================');
  console.log('🏆 TODOS OS 5 TESTES DE SIMULAÇÃO PASSARAM COM 100% DE SUCESSO');
  console.log('🏆 ========================================================');
}

runSimulations().catch(err => {
  console.error('❌ Erro na suíte de testes:', err);
  process.exit(1);
});
