/**
 * Núcleo de Domínio Independente de Canal — Video Engine V2
 * Bali Imóveis
 * 
 * Proprietário das regras de negócio:
 * - Busca e padronização de dados de imóveis (CRM + fallback)
 * - Simulação financeira e geração de roteiros de retenção
 * - Inicialização e persistência de Jobs no PostgreSQL
 * 
 * NÃO contém regras ou formatações de WhatsApp.
 * NÃO importa video_anuncios_engine.js (Zero dependência circular).
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const { createVideoJob } = require('./db');

// Configurações do CRM ImobTotal
const IMOBTOTAL_API_KEY = process.env.IMOBTOTAL_API_KEY;
const IMOBTOTAL_BASE_URL = process.env.IMOBTOTAL_BASE_URL || 'https://app.imobtotal.com.br/api/v1';

// Looks oficiais para alternância nos ganchos de vídeo
const MARCEL_LOOKS = [
  { id: 'a2cfb3ad10054e6f87c5ce6ca8ab483b', nome: 'Terno Executivo Escuro', emoji: '👔' },
  { id: 'dc74498f5f5c45619fd7cb6a9ff905a8', nome: 'Estúdio / Podcaster no Microfone', emoji: '🎙️' },
  { id: '14f2350c0a6f4e2c8b6669b3a255782e', nome: 'Casual / Ao Ar Livre', emoji: '🌿' }
];

// Look padrão para o Desenvolvimento do Imóvel
const MARCEL_BODY_LOOK = { id: 'a2cfb3ad10054e6f87c5ce6ca8ab483b', nome: 'Terno Executivo' };

/**
 * 1. Buscar Dados do Imóvel no CRM (com fallback para base local)
 * @param {string|number} ref
 * @returns {Promise<Object|null>}
 */
async function fetchImovelData(ref) {
  if (!ref) return null;
  const cleanRef = String(ref).trim().replace(/\D/g, '');
  if (!cleanRef) return null;

  // Tentativa 1: API Externa ImobTotal
  if (IMOBTOTAL_API_KEY) {
    try {
      const res = await axios.get(`${IMOBTOTAL_BASE_URL}/imoveis/${cleanRef}`, {
        headers: { 'x-api-key': IMOBTOTAL_API_KEY },
        timeout: 10000
      });
      if (res.data && (res.data.id || res.data.codigo || res.data.referencia)) {
        return res.data;
      }
    } catch (err) {
      console.log(`[JOB_CORE] API externa ImobTotal indisponível para ref ${cleanRef}, consultando base local...`);
    }
  }

  // Tentativa 2: Base local banco_imoveis_carteira.json
  try {
    const dbPath = path.join(__dirname, '..', 'data', 'banco_imoveis_carteira.json');
    if (fs.existsSync(dbPath)) {
      const imoveis = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      const found = imoveis.find(i => String(i.referencia || i.codigo || i.id_crm) === cleanRef);
      if (found) {
        return {
          codigo: found.codigo || found.referencia,
          referencia: found.referencia || found.codigo,
          titulo: found.titulo || `${found.tipo || 'Imóvel'} no ${found.bairro || 'bairro'}`,
          valor_venda: found.valor_anunciado || found.valor_atualizado || found.valor_venda || 0,
          preco: found.valor_anunciado || found.valor_atualizado || found.valor_venda || 0,
          bairro: found.bairro || 'em ótima localização',
          dormitorios: found.dormitorios || found.quartos || null,
          suites: found.suites || null,
          area_construida: found.area_construida || found.area_util || null,
          fotos: found.foto_capa ? [{ url: found.foto_capa }] : []
        };
      }
    }
  } catch (e) {
    console.error(`[JOB_CORE] Erro no fallback do banco local:`, e.message);
  }

  return null;
}

/**
 * 2. Gerar Roteiros Inteligentes (3 Ganchos + 1 Desenvolvimento)
 * @param {Object} imovel
 * @returns {Object}
 */
function generateCompleteScripts(imovel) {
  if (!imovel) throw new Error('[JOB_CORE] Objeto imovel é obrigatório para gerar roteiros');

  const valorVenda = Number(imovel.preco_venda || imovel.valor_venda || imovel.preco || imovel.valor_anunciado || 300000);

  // Regras de Entrada e Financiamento por Faixa de Preço
  let percEntrada = 0.20;
  let coefParcela = 0.0090;
  let rendaComprometimento = 3.3;

  if (valorVenda <= 200000) {
    // MCMV Faixas 1 e 2
    percEntrada = 0.10;
    coefParcela = 0.0055;
  } else if (valorVenda <= 350000) {
    // MCMV Faixa 3
    percEntrada = 0.15;
    coefParcela = 0.0070;
  }

  const entrada = Math.round(valorVenda * percEntrada);
  const valorFinanciado = valorVenda - entrada;
  const parcelaEstimada = Math.round(valorFinanciado * coefParcela);
  const rendaMinima = Math.round(parcelaEstimada * rendaComprometimento);

  const formatExtenso = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace('.0', '')} milhão`;
    if (num >= 1000 && num % 1000 === 0) return `${num / 1000} mil`;
    if (num >= 1000) return `${num.toLocaleString('pt-BR')} reais`;
    return `${num} reais`;
  };

  const valorTexto = formatExtenso(valorVenda);
  const entradaTexto = formatExtenso(entrada);
  const parcelaTexto = formatExtenso(parcelaEstimada);
  const rendaTexto = formatExtenso(rendaMinima);

  const bairro = imovel.bairro || 'em excelente localização';
  const quartos = imovel.dormitorios || imovel.quartos ? `${imovel.dormitorios || imovel.quartos} quartos` : 'espaço amplo';
  const suites = imovel.suites ? `sendo ${imovel.suites} suíte(s)` : '';
  const area = imovel.area_construida || imovel.area_util || imovel.terreno ? `${imovel.area_construida || imovel.area_util || imovel.terreno} metros quadrados` : 'ótima metragem';
  const titulo = imovel.titulo || '';

  // Extrair condomínio / empreendimento
  let destaqueLoc = `no ${bairro}`;
  if (titulo.toLowerCase().includes('condomínio') || titulo.toLowerCase().includes('condominio') || titulo.toLowerCase().includes('residencial') || titulo.toLowerCase().includes('edifício') || titulo.toLowerCase().includes('edificio') || titulo.toLowerCase().includes('parque')) {
    const match = titulo.match(/(?:condom[íi]nio|residencial|edif[íi]cio|parque)\s+([A-Za-zÀ-ÿ\s]+?)(?:[-,\.]|$)/i);
    if (match && match[1]) {
      destaqueLoc = `no ${match[1].trim()}`;
    }
  }

  // 3 Ganchos de Retenção Agressiva (10s)
  const hooks = [
    {
      index: 1,
      tipo: 'Choque / Entrada',
      look: MARCEL_LOOKS[0],
      text: `${valorTexto} num imóvel completo ${destaqueLoc} com entrada de apenas ${entradaTexto}? Esse imóvel aqui é a maior oportunidade para sair do aluguel hoje. Olha isso:`
    },
    {
      index: 2,
      tipo: 'Aluguel vs Parcela',
      look: MARCEL_LOOKS[1],
      text: `Parcela de ${parcelaTexto} num imóvel de ${quartos} todinho seu? Se você tem ${entradaTexto} de FGTS ou reserva, continuar pagando aluguel por aí é loucura. Dá só uma olhada:`
    },
    {
      index: 3,
      tipo: 'Renda Familiar / Oportunidade',
      look: MARCEL_LOOKS[2],
      text: `Com uma renda familiar a partir de ${rendaTexto} e ${entradaTexto} de entrada, você já conquista esse imóvel ${destaqueLoc}. Olha como ele tá pronto por dentro:`
    }
  ];

  // 1 Desenvolvimento do Imóvel & Bairro (30s)
  const bodyText = `Estamos falando de uma oportunidade com ${area}, muito bem distribuídos em ${quartos} ${suites}, com acabamento moderno e excelente iluminação. A localização ${destaqueLoc} é perfeita, com fácil acesso aos melhores serviços, comércios e comodidades da região. Quer fazer uma simulação personalizada e agendar sua visita? Toque no botão Saiba Mais abaixo e fale com a nossa equipe agora mesmo!`;

  return {
    financeiro: {
      valorVenda,
      entrada,
      valorFinanciado,
      parcelaEstimada,
      rendaMinima
    },
    hooks,
    body: {
      look: MARCEL_BODY_LOOK,
      text: bodyText
    }
  };
}

/**
 * 3. Inicializar Job de Vídeo (Operação Unificada de Domínio)
 * @param {Object} params
 * @param {string|number} params.property_ref
 * @param {string} params.broker_id
 * @param {string} [params.source='system']
 * @param {Object} [params.metadata={}]
 * @returns {Promise<Object>}
 */
async function initializeVideoJob({ property_ref, broker_id, source = 'system', metadata = {} } = {}) {
  if (!property_ref || !broker_id) {
    return {
      success: false,
      error: 'MISSING_REQUIRED_PARAMS',
      job: null,
      imovel: null,
      scripts: null
    };
  }

  // 1. Busca do Imóvel
  const imovel = await fetchImovelData(property_ref);
  if (!imovel) {
    return {
      success: false,
      error: 'PROPERTY_NOT_FOUND',
      job: null,
      imovel: null,
      scripts: null
    };
  }

  // 2. Geração de Roteiros
  const scripts = generateCompleteScripts(imovel);

  // 3. Persistência Resiliente (Fail-Open) no PostgreSQL
  let job = null;
  try {
    job = await createVideoJob({
      property_ref: String(property_ref),
      broker_id: String(broker_id),
      status: 'SCRIPT_READY',
      source: source || 'system',
      script_version: 1,
      property_snapshot: imovel,
      scripts_snapshot: scripts,
      metadata: metadata || {}
    });
    console.log(`[JOB_CORE] VideoJob persistido com sucesso: ${job.id} (broker: ${broker_id}, status: ${job.status})`);
  } catch (dbErr) {
    console.error(`[JOB_CORE ERROR] Falha ao persistir VideoJob no PostgreSQL para ref ${property_ref}:`, dbErr.message);
    // Fail-open: job permanece null, mas success permanece true para a V1 continuar operando
  }

  return {
    success: true,
    job,
    imovel,
    scripts
  };
}

module.exports = {
  initializeVideoJob,
  fetchImovelData,
  generateCompleteScripts,
  MARCEL_LOOKS,
  MARCEL_BODY_LOOK
};