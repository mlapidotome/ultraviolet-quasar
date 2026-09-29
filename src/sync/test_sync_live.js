/**
 * Teste de Validação Real em Produção (1 Ciclo Único e Seguro)
 * Executa exatamente um ciclo de sincronização de leitura contra a API oficial do ImobTotal.
 * NÃO executa em loop contínuo e NÃO altera nenhum dado.
 */

require('dotenv').config();
const ImobTotalSyncPrototype = require('./imobtotal_sync_prototype');
const path = require('path');

async function runLiveTest() {
  console.log('📡 =======================================================');
  console.log('📡 EXECUTANDO TESTE REAL DE 1 CICLO (API IMOBTOTAL PRODUÇÃO)');
  console.log('📡 =======================================================\n');

  const liveStateFile = path.join(__dirname, '..', '..', 'data', 'sync_prototype_live_snapshot.json');

  const sync = new ImobTotalSyncPrototype({
    stateFilePath: liveStateFile,
    janelaDias: 15,
    minDelayMs: 600 // 600ms entre chamadas para máxima segurança
  });

  console.log('Parâmetros de Operação:');
  console.log('• Funis monitorados:', sync.monitoredFunis.map(f => `${f.nome} (ID ${f.id})`).join(', '));
  console.log('• Janela de monitoramento: últimos', sync.janelaDias, 'dias (desde ' + sync.getDataInicioIsoDate() + ')');
  console.log('• Arquivo de snapshot:', liveStateFile);
  console.log('• Disparando ciclo único de leitura...\n');

  const t0 = Date.now();
  const resultado = await sync.runSyncCycle();
  const duracaoSegundos = ((Date.now() - t0) / 1000).toFixed(2);

  console.log('📊 ==================== RESULTADOS DO CICLO ====================');
  console.log(`• Duração total do ciclo: ${duracaoSegundos}s`);
  console.log(`• Requisições HTTP disparadas: ${resultado.stats.requisiçõesRealizadas}`);
  console.log(`• Novos leads catalogados no ciclo: ${resultado.stats.novosLeadsDetectados}`);
  console.log(`• Mudanças de responsável detectadas: ${resultado.stats.mudancasResponsavel}`);
  console.log(`• Mudanças de etapa detectadas: ${resultado.stats.mudancasEtapa}`);
  console.log(`• Leads sem responsável na janela: ${resultado.stats.leadsSemResponsavelAtual}`);
  console.log(`• Total de leads monitorados no snapshot: ${resultado.totalLeadsAtualmenteMonitorados}`);
  console.log(`• Cobertura geral completa: ${resultado.stats.coberturaGeralOk ? 'SIM ✅ (100%)' : 'NÃO ⚠️'}`);

  console.log('\n📄 Cobertura por Funil:');
  for (const [nome, info] of Object.entries(resultado.stats.consultasFunis)) {
    console.log(`  - ${nome}: ${info.totalColetado} de ${info.totalEsperado} leads coletados em ${info.paginas} página(s) [${info.coberturaCompleta ? 'COBERTURA 100%' : 'INCOMPLETA'}]`);
  }

  console.log('\n🛡️ Saldo de Rate Limit Atualizado pela API:');
  console.log(`  - Janela Curta (10s): ${resultado.stats.saldoRateLimit.remainingShort}/20 restantes`);
  console.log(`  - Janela de Minuto (60s): ${resultado.stats.saldoRateLimit.remainingMinute}/60 restantes`);
  console.log(`  - Janela Horária (1h): ${resultado.stats.saldoRateLimit.remainingLong}/600 restantes`);

  console.log('\n📁 Verificação de Persistência:');
  const fs = require('fs');
  if (fs.existsSync(liveStateFile)) {
    const statsDisk = fs.statSync(liveStateFile);
    console.log(`  - Snapshot gravado com sucesso: ${(statsDisk.size / 1024).toFixed(1)} KB`);
  }

  console.log('\n✅ TESTE DE 1 CICLO REAL FINALIZADO COM SUCESSO (WORKER NÃO PERMANECEU EM EXECUÇÃO)');
}

runLiveTest().catch(err => {
  console.error('❌ Erro no teste de leitura real:', err);
  process.exit(1);
});
