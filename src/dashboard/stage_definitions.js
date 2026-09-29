/**
 * Mapeamento Estrito das Etapas dos 4 Funis — Bali Imóveis
 * Arquivo: src/dashboard/stage_definitions.js
 * 
 * Regras:
 * 1. Mapeamento 100% determinístico por ID numérico (sem regex ou includes aproximado de texto).
 * 2. Classificação explícita de elegibilidade para coleta de histórico:
 *    - 'DISPENSADA': Etapas iniciais de prospecção (Tentando Contato, Sem Conseguir Contato, Caixa de Entrada, Frio)
 *    - 'ELEGIVEL': Etapas ativas de negociação/atendimento (Qualificado, Visita, Proposta, etc.)
 * 3. Perguntas-padrão gerenciais neutras, derivadas exclusivamente da etapa, sem pressupor fatos ou pendências.
 */

const FUNIS = {
  LANCAMENTOS: { id: 3500, nome: 'Lançamentos' },
  TERCEIROS:   { id: 3515, nome: 'Terceiros' },
  MAP:         { id: 5297, nome: 'MAP' },
  MCMV:        { id: 5308, nome: 'MCMV' }
};

/**
 * Tabela Oficial de Etapas dos 4 Funis
 */
const ETAPAS_MAPEAMENTO = {
  // =========================================================================
  // FUNIL 1: LANÇAMENTOS (ID: 3500)
  // =========================================================================
  5668: {
    id: 5668,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'NOVO LEAD',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Etapa inicial de entrada sem histórico qualificado.',
    perguntaGerencialPadrao: 'O lead já recebeu a primeira abordagem de apresentação dos lançamentos?'
  },
  9391: {
    id: 9391,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'AGUARDANDO RETORNO DO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Tentativa inicial aguardando resposta.',
    perguntaGerencialPadrao: 'Qual canal foi utilizado no contato e qual o prazo estipulado para retorno?'
  },
  9398: {
    id: 9398,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'SEGUNDO DIA AGUARDANDO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Tentativa inicial aguardando resposta.',
    perguntaGerencialPadrao: 'Houve tentativa de recontato por um canal alternativo (ex: ligação ou WhatsApp)?'
  },
  9399: {
    id: 9399,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'TERCEIRA DIA AGUARDANDO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Fim do ciclo de contato inicial.',
    perguntaGerencialPadrao: 'O ciclo inicial de tentativas foi esgotado para encaminhamento à reativação?'
  },
  7878: {
    id: 7878,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'FRIO',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Lead sem engajamento ativo.',
    perguntaGerencialPadrao: 'Qual foi o motivo do desinteresse ou perda de contato registrado?'
  },
  15007: {
    id: 15007,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'LEADFY',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Entrada automática via campanha.',
    perguntaGerencialPadrao: 'O lead de campanha já foi triado e direcionado para atendimento?'
  },
  5669: {
    id: 5669,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'MORNO',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Quais empreendimentos foram apresentados e qual o grau de aderência demonstrado?'
  },
  10932: {
    id: 10932,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'QUENTE',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual unidade ou tipologia o cliente demonstrou interesse em avançar?'
  },
  5671: {
    id: 5671,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'VISITA REALIZADA',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Como foi a recepção do decorado/stand e qual o retorno do cliente após a visita?'
  },
  5672: {
    id: 5672,
    funilId: 3500,
    funilNome: 'Lançamentos',
    nome: 'PROPOSTA/DOCUMENTAÇÃO',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual a situação atual da análise de fluxo de pagamento ou documentação da proposta?'
  },

  // =========================================================================
  // FUNIL 2: TERCEIROS (ID: 3515)
  // =========================================================================
  7923: {
    id: 7923,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'AGUARDANDO RETORNO DO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Tentativa inicial aguardando resposta.',
    perguntaGerencialPadrao: 'Qual imóvel foi enviado e qual o prazo combinado para resposta?'
  },
  5758: {
    id: 5758,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'SEGUNDO DIA AGUARDANDO RETORNO DO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Tentativa inicial aguardando resposta.',
    perguntaGerencialPadrao: 'Foi realizada uma segunda abordagem com opções semelhantes da carteira?'
  },
  5759: {
    id: 5759,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'TERCEIRO DIA AGUARDANDO O RETORNO DO CLIENTE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Tentativa inicial aguardando resposta.',
    perguntaGerencialPadrao: 'As tentativas foram concluídas para definição de arquivamento ou reativação?'
  },
  5762: {
    id: 5762,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'CLIENTE FRIO',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Lead sem engajamento ativo.',
    perguntaGerencialPadrao: 'Qual objeção de produto, preço ou localização foi apontada pelo cliente?'
  },
  15009: {
    id: 15009,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'LEADFY',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Entrada automática via campanha de terceiros.',
    perguntaGerencialPadrao: 'O imóvel de interesse da campanha foi verificado e ofertado ao cliente?'
  },
  5760: {
    id: 5760,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'MORNO',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Quais opções de imóveis prontos estão sendo avaliadas com o cliente?'
  },
  14588: {
    id: 14588,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'QUENTE',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual imóvel em carteira mais se aproxima da decisão de compra do cliente?'
  },
  10029: {
    id: 10029,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'VISITA AGENDADA',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'A data e horário da visita com o proprietário/morador estão confirmadas?'
  },
  9107: {
    id: 9107,
    funilId: 3515,
    funilNome: 'Terceiros',
    nome: 'VENDA',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Ciclo comercial concluído com sucesso.',
    perguntaGerencialPadrao: 'O processo de emissão de escritura, registro ou financiamento foi finalizado?'
  },

  // =========================================================================
  // FUNIL 3: MAP (ID: 5297)
  // =========================================================================
  15426: {
    id: 15426,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'CAIXA DE ENTRADA',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Lead recém-chegado aguardando primeira distribuição/contato.',
    perguntaGerencialPadrao: 'O lead já foi distribuído e a primeira tentativa de contato realizada?'
  },
  15204: {
    id: 15204,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'TENTANDO CONTATO COM O LEAD',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Etapa inicial de prospecção sem retorno confirmado.',
    perguntaGerencialPadrao: 'Quantas tentativas de contato foram feitas e quais canais foram utilizados?'
  },
  15205: {
    id: 15205,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'SEM CONSEGUIR CONTATO',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Sem contato estabelecido; elegível para regra de descarte/reativação.',
    perguntaGerencialPadrao: 'O protocolo padrão de 4 tentativas foi finalizado para encerramento do ciclo?'
  },
  15206: {
    id: 15206,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'SEM CAPACIDADE DE PGTO (RENDA OU OUTROS)',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Lead desqualificado financeiramente.',
    perguntaGerencialPadrao: 'Qual foi o fator impeditivo identificado na renda ou restrição financeira?'
  },
  15212: {
    id: 15212,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'PAROU DE RESPONDER / NÃO TEM INTERESSE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Lead inativo ou sem interesse.',
    perguntaGerencialPadrao: 'O lead foi devidamente direcionado para a quarentena de reativação futura?'
  },
  15207: {
    id: 15207,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'EM ATENDIMENTO (SEM QUALIFICAÇÃO AINDA)',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Quais preferências de localização, tipologia e faixa de investimento já foram levantadas?'
  },
  15208: {
    id: 15208,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'EM ATENDIMENTO (QUALIFICADO)',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Quais opções específicas da carteira foram apresentadas e qual o próximo passo combinado?'
  },
  15209: {
    id: 15209,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'VISITA',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual a situação do agendamento ou o retorno da visita realizada?'
  },
  15210: {
    id: 15210,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'PROPOSTA',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual o status atual da proposta e quais são os próximos passos acordados com o cliente?'
  },
  15211: {
    id: 15211,
    funilId: 5297,
    funilNome: 'MAP',
    nome: 'VENDA',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Venda concretizada.',
    perguntaGerencialPadrao: 'Os trâmites contratuais e repasse foram finalizados com sucesso?'
  },

  // =========================================================================
  // FUNIL 4: MCMV (ID: 5308)
  // =========================================================================
  15981: {
    id: 15981,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'CAIXA DE ENTRADA',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Entrada inicial aguardando distribuição.',
    perguntaGerencialPadrao: 'O lead MCMV foi direcionado ao corretor para primeiro contato?'
  },
  15257: {
    id: 15257,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'TENTANDO CONTATO COM O LEAD',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Etapa inicial de prospecção sem retorno.',
    perguntaGerencialPadrao: 'Quantas tentativas foram realizadas para apresentação das condições MCMV?'
  },
  15258: {
    id: 15258,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'SEM CONSEGUIR CONTATO',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Sem retorno após ciclo de tentativas.',
    perguntaGerencialPadrao: 'O ciclo de tentativas foi concluído para direcionamento à esteira de reativação?'
  },
  15259: {
    id: 15259,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'SEM CAPACIDADE DE PGTO (RENDA OU OUTROS)',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Renda fora do enquadramento do programa.',
    perguntaGerencialPadrao: 'Qual foi o resultado da simulação habitacional Caixa / agente financeiro?'
  },
  15260: {
    id: 15260,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'PAROU DE RESPONDER/NÃO TEM INTERESSE',
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Desistência ou falta de retorno.',
    perguntaGerencialPadrao: 'O cliente informou motivo de descontinuidade do processo MCMV?'
  },
  15261: {
    id: 15261,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'EM ATENDIMENTO (SEM QUALIFAR)',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Os dados básicos de renda familiar e FGTS foram solicitados para simulação?'
  },
  15262: {
    id: 15262,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'EM ATENDIMENTO (QUALIFICADO)',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'Qual o valor de subsídio e financiamento aprovado na simulação prévia?'
  },
  15263: {
    id: 15263,
    funilId: 5308,
    funilNome: 'MCMV',
    nome: 'VISITA',
    coletaHistorico: 'ELEGIVEL',
    motivoDispensada: null,
    perguntaGerencialPadrao: 'O cliente visitou o empreendimento MCMV e conheceu o modelo decorado?'
  }
};

/**
 * Conjunto estrito de IDs para verificação rápida O(1)
 */
const ETAPAS_TENTANDO_CONTATO_IDS = new Set([15204, 15257, 9391, 9398, 7923, 5758]);
const ETAPAS_SEM_CONSEGUIR_CONTATO_IDS = new Set([15205, 15258, 9399, 5759]);

const ETAPAS_DISPENSADAS_COLETA_IDS = new Set(
  Object.values(ETAPAS_MAPEAMENTO)
    .filter(e => e.coletaHistorico === 'DISPENSADA')
    .map(e => e.id)
);

const ETAPAS_ELEGIVEIS_COLETA_IDS = new Set(
  Object.values(ETAPAS_MAPEAMENTO)
    .filter(e => e.coletaHistorico === 'ELEGIVEL')
    .map(e => e.id)
);

/**
 * Consulta metadados da etapa de forma determinística por ID
 * @param {number|string} etapaId 
 * @returns {object}
 */
function getEtapaInfo(etapaId) {
  const numId = parseInt(etapaId, 10);
  if (ETAPAS_MAPEAMENTO[numId]) {
    return ETAPAS_MAPEAMENTO[numId];
  }
  return {
    id: numId,
    funilId: null,
    funilNome: 'Desconhecido',
    nome: `Etapa ${etapaId}`,
    coletaHistorico: 'DISPENSADA',
    motivoDispensada: 'Etapa não reconhecida na tabela oficial.',
    perguntaGerencialPadrao: 'Qual a situação atual do cliente nesta etapa?'
  };
}

/**
 * Determina se um conjunto de cards de um mesmo lead torna o lead elegível para coleta seletiva de histórico
 * Regra: Se o lead possuir PELO MENOS UM card em etapa ELEGÍVEL, seu histórico global deve ser coletado.
 * @param {Array<{etapa_id: number}>} cards 
 * @returns {{ elegivel: boolean, etapasElegiveis: number[], motivo: string }}
 */
function avaliarElegibilidadeColetaLead(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { elegivel: false, etapasElegiveis: [], motivo: 'Nenhum card associado ao lead.' };
  }

  const etapasElegiveis = [];
  for (const card of cards) {
    const numId = parseInt(card.etapa_id, 10);
    if (ETAPAS_ELEGIVEIS_COLETA_IDS.has(numId)) {
      etapasElegiveis.push(numId);
    }
  }

  if (etapasElegiveis.length > 0) {
    return {
      elegivel: true,
      etapasElegiveis,
      motivo: `Lead possui ${etapasElegiveis.length} card(s) em etapa(s) de negociação ativa.`
    };
  }

  return {
    elegivel: false,
    etapasElegiveis: [],
    motivo: 'Todos os cards do lead estão em etapas iniciais dispensadas de coleta.'
  };
}

module.exports = {
  FUNIS,
  ETAPAS_MAPEAMENTO,
  ETAPAS_TENTANDO_CONTATO_IDS,
  ETAPAS_SEM_CONSEGUIR_CONTATO_IDS,
  ETAPAS_DISPENSADAS_COLETA_IDS,
  ETAPAS_ELEGIVEIS_COLETA_IDS,
  getEtapaInfo,
  avaliarElegibilidadeColetaLead
};
