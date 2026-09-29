/**
 * Motor de Análise e Interpretação Gerencial de Históricos — Bali Imóveis
 * Arquivo: src/dashboard/analysis_engine.js
 * 
 * DIRETRIZES DA FASE 3.5C:
 * 1. Separação explícita de Modo Demonstração: identificação inequívoca de dados simulados.
 * 2. Deduplicação estrita no backend: 1 única consulta por lead_id global, mesmo se presente em múltiplos funis.
 * 3. Estruturação em 3 blocos separados:
 *    - registro_original (texto bruto sanitizado)
 *    - interpretacao_a_confirmar (síntese factual a confirmar com o corretor)
 *    - pergunta_sugerida (pergunta gerencial objetiva)
 * 4. Sem predição de probabilidade ou viés especulativo entre funis.
 */

const fs = require('fs');
const path = require('path');
const { getEtapaInfo, avaliarElegibilidadeColetaLead } = require('./stage_definitions');

const DB_FILE = path.join(__dirname, '..', '..', 'data', 'bali_test_33a.json');

/**
 * Sanitização de dados pessoais para privacidade
 */
function sanitizeText(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[CPF OCULTADO]');
  s = s.replace(/(?:\+55)?\s?\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g, '[TELEFONE OCULTADO]');
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL OCULTADO]');
  return s;
}

/**
 * Mock isolado exclusivo para o MODO DEMONSTRAÇÃO (claramente sinalizado)
 */
const DEMO_HISTORICOS = {
  proposta: {
    modo: 'DEMONSTRACAO',
    registro_original: '25/08 - Cliente enviou documentação inicial. Falta comprovação de renda complementar (holerite) para conclusão da análise da pasta. Contato feito no [TELEFONE OCULTADO].',
    interpretacao_a_confirmar: 'Cliente em fase de montagem de proposta, com documentação pendente de complementação de renda.',
    pergunta_sugerida: 'A complementação de renda já foi entregue para encaminhamento da proposta à análise?'
  },
  multi_funil: {
    modo: 'DEMONSTRACAO',
    registro_original: '15/09 - Cliente avaliou opções do MCMV e do MAP. Demonstrou interesse nas tipologias de 2 dormitórios em ambos, mas ainda não definiu a região de preferência.',
    interpretacao_a_confirmar: 'Cliente em atendimento paralelo em mais de um produto/funil, com interesse manifestado em tipologias semelhantes.',
    pergunta_sugerida: 'Qual região e faixa de valor atendem melhor à necessidade prioritária do cliente no momento?'
  },
  sem_comentarios: {
    modo: 'DEMONSTRACAO',
    registro_original: '(Nenhum comentário interno registrado no CRM para este lead)',
    interpretacao_a_confirmar: 'Sem histórico registrado no CRM. Informações dependem de relato direto do corretor responsável.',
    pergunta_sugerida: 'Qual o resumo da última conversa mantida com o cliente?'
  },
  atendimento: {
    modo: 'DEMONSTRACAO',
    registro_original: '10/09 - Primeiro contato realizado pelo WhatsApp. Cliente informou interesse em imóveis prontos com vaga coberta.',
    interpretacao_a_confirmar: 'Cliente em fase de qualificação de preferências de produto.',
    pergunta_sugerida: 'Quais opções com as características solicitadas foram enviadas para avaliação?'
  }
};

/**
 * Processa um lote de leads com DEDUPLICAÇÃO ESTRITA no backend
 * @param {Array<number|string>} leadIds 
 * @param {number} startIndex 
 * @param {number} batchSize 
 * @param {object} options
 * @param {boolean} [options.isDemoMode=false] Se true, executa em modo de demonstração explicitamente sinalizado
 * @returns {Promise<object>}
 */
async function analyzePortfolioBatch(leadIds = [], startIndex = 0, batchSize = 50, options = {}) {
  // 1. DEDUPLICAÇÃO ESTRITA NO BACKEND: Garante exatamente 1 consulta por lead_id
  const uniqueLeadIds = Array.from(
    new Set(leadIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0))
  );

  const total = uniqueLeadIds.length;
  const start = Math.max(0, parseInt(startIndex, 10) || 0);
  const size = Math.max(1, parseInt(batchSize, 10) || 50);
  const end = Math.min(start + size, total);
  const currentBatch = uniqueLeadIds.slice(start, end);

  const isDemoMode = options.isDemoMode === true;

  // Carrega a base local para cruzar os cards do lead
  let leadsDB = {};
  if (fs.existsSync(DB_FILE)) {
    try {
      leadsDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      leadsDB = {};
    }
  }
  const snapshots = leadsDB.snapshots_leads || {};

  const results = [];

  for (const leadId of currentBatch) {
    const leadData = snapshots[leadId] || null;
    const cards = [];

    if (leadData && leadData.funis) {
      Object.entries(leadData.funis).forEach(([fId, p]) => {
        cards.push({
          lead_id: leadId,
          funil_id: parseInt(fId, 10),
          funil_nome: p.funil_nome || `Funil ${fId}`,
          etapa_id: p.etapa_id || null,
          etapa_nome: p.etapa_nome || 'SEM_ETAPA',
          corretor_nome: p.corretor_nome || 'SEM CORRETOR'
        });
      });
    }

    // Avaliação determinística por ID de etapa
    const elegibilidade = avaliarElegibilidadeColetaLead(cards);

    if (isDemoMode) {
      // MODO DEMONSTRAÇÃO: Produz dados simulados com sinalização explícita e inequívoca
      let mockKey = 'atendimento';
      if (cards.length > 1) {
        mockKey = 'multi_funil';
      } else if (cards.some(c => c.etapa_id === 15210 || c.etapa_id === 5672)) { // Proposta
        mockKey = 'proposta';
      } else if (!elegibilidade.elegivel) {
        mockKey = 'sem_comentarios';
      }

      const mock = DEMO_HISTORICOS[mockKey];

      results.push({
        lead_id: leadId,
        is_demo: true,
        rotulo_modo: '[MODO DEMONSTRAÇÃO — DADOS SIMULADOS]',
        elegivel_coleta: elegibilidade.elegivel,
        motivo_elegibilidade: elegibilidade.motivo,
        cards_associados: cards.map(c => ({
          funil_id: c.funil_id,
          funil_nome: c.funil_nome,
          etapa_id: c.etapa_id,
          etapa_nome: c.etapa_nome
        })),
        // ESTRUTURA EM 3 BLOCOS
        registro_original: sanitizeText(mock.registro_original),
        interpretacao_a_confirmar: mock.interpretacao_a_confirmar,
        pergunta_sugerida: mock.pergunta_sugerida,
        analisado_em: new Date().toISOString()
      });
    } else {
      // MODO REAL / PADRÃO: Não inventa comentários fictícios.
      // Apresenta perguntas-padrão das etapas dos cards ou indica prontidão para coleta real.
      const perguntasEtapas = cards.map(c => {
        const info = getEtapaInfo(c.etapa_id);
        return {
          funil: c.funil_nome,
          etapa: c.etapa_nome,
          pergunta_etapa: info.perguntaGerencialPadrao
        };
      });

      results.push({
        lead_id: leadId,
        is_demo: false,
        rotulo_modo: '[MODO PRODUÇÃO — DADOS REAIS DO CRM]',
        elegivel_coleta: elegibilidade.elegivel,
        motivo_elegibilidade: elegibilidade.motivo,
        cards_associados: cards.map(c => ({
          funil_id: c.funil_id,
          funil_nome: c.funil_nome,
          etapa_id: c.etapa_id,
          etapa_nome: c.etapa_nome
        })),
        perguntas_etapas: perguntasEtapas,
        // ESTRUTURA EM 3 BLOCOS (Sem dados fictícios)
        registro_original: null,
        interpretacao_a_confirmar: elegibilidade.elegivel
          ? 'Lead elegível para coleta de histórico no CRM. Nenhum comentário coletado ainda.'
          : 'Lead em etapa inicial de contato (coleta de histórico dispensada).',
        pergunta_sugerida: perguntasEtapas.length > 0 ? perguntasEtapas[0].pergunta_etapa : 'Qual a situação atual do cliente?',
        analisado_em: new Date().toISOString()
      });
    }
  }

  return {
    processedCount: currentBatch.length,
    nextIndex: end < total ? end : -1,
    totalUniqueLeads: total,
    isDemoMode,
    results
  };
}

module.exports = {
  analyzePortfolioBatch,
  sanitizeText,
  DEMO_HISTORICOS
};
