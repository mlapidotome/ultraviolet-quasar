require('dotenv').config();
// Blindagem contra bloqueio de arquivos temporários do Chromium no Windows (EBUSY)
process.on('uncaughtException', (err) => {
  if (err.message && (err.message.includes('EBUSY') || err.message.includes('locked'))) {
    console.warn('⚠️ [SISTEMA] Arquivo temporário bloqueado pelo Chromium (ignorado com segurança):', err.message);
    return;
  }
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && (reason.message.includes('EBUSY') || reason.message.includes('locked'))) {
    console.warn('⚠️ [SISTEMA] Arquivo temporário bloqueado pelo Chromium (ignorado com segurança):', reason.message);
    return;
  }
  console.error('❌ Unhandled Rejection:', reason);
});

const fs = require('fs');
const imobTotalApiClient = require('./imobtotal_api_client');
const compradoresEngine = require('./compradores_engine');
const imoveisSyncManager = require('./imoveis_sync_manager');
const imoveisMatchmaker = require('./imoveis_matchmaker');
const imoveisCopyGenerator = require('./imoveis_copy_generator');
const imoveisSyncDaily = require('./imoveis_sync_daily');
﻿/**
 * 🚀 GESTOR SERVER - Servidor Independente da Camada de Gestão & Estoque
 * Bali Imóveis | Porta 3005 (Totalmente isolado da porta 3000)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const gestorEngine = require('./gestor_engine');
const gestorBriefing = require('./gestor_briefing');
const gestorChat = require('./gestor_chat');
const imoveisEngine = require('./imoveis_engine');
const imoveisUploadService = require('./imoveis_upload_service');
const multer = require('multer');
const uploadPlanilha = multer({ dest: path.join(__dirname, 'temp_uploads') });
const imoveisRoboDisparo = require('./imoveis_robo_disparo');
const ofertasReativacaoEngine = require('./ofertas_reativacao_engine');

const app = express();
const PORT = process.env.GESTOR_PORT || 3005;

app.use(cors());
app.use(express.json());
// Proteger rotas e arquivos sensíveis antes do static geral
const { panelAuthMiddleware } = require('./video_engine/panel_auth');
app.use(['/video_engine', '/.env'], (req, res) => res.status(403).send('Forbidden'));
app.get(['/video-painel', '/video-painel.html'], panelAuthMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'video-painel.html'));
});

app.use(express.static(path.join(__dirname)));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/cards_gerados', express.static(path.join(__dirname, 'cards_gerados')));
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
// Rotas da Video Engine V2 (Independente de WhatsApp)
app.use('/api/v2', require('./video_engine/api_v2'));

// Rota rápida para escanear o QR Code do Robô de Vídeos
app.get('/conectar-whatsapp', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'conectar-whatsapp.html'));
});


/* ==========================================================
 * 1. ROTAS DO COCKPIT DO GESTOR
 * ========================================================== */

app.get('/api/gestor/dashboard', (req, res) => {
  try {
    const data = gestorEngine.getExecutiveDashboardData();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/gestor/briefing/morning', (req, res) => {
  try {
    const briefing = gestorBriefing.generateMorningBriefing();
    res.json({ success: true, briefing });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/gestor/briefing/evening', (req, res) => {
  try {
    const briefing = gestorBriefing.generateEveningBriefing();
    res.json({ success: true, briefing });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/gestor/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, error: 'Pergunta obrigatória.' });
    }
    const result = await gestorChat.ask(question);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ==========================================================
 * 2. ROTAS DO MONITOR DE ESTOQUE & ATUALIZAÇÃO DE IMÓVEIS
 * ========================================================== */

// Listar imóveis com filtros
app.get('/api/imoveis', (req, res) => {
  try {
    const { status, tipo, busca, idade } = req.query;
    const imoveis = imoveisEngine.getImoveis({ status, tipo, busca, idade });
    res.json({ success: true, imoveis });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Estatísticas de progresso

// Rota de Sincronização Matinal da Carteira (Recalcula Aging + Mescla CRM)

// Rota de Sincronização e Mesclagem com Alterações dos Corretores no CRM
// Rota de Sincronização em Tempo Real via API Oficial do ImobTotal
app.post('/api/imoveis/sincronizar-crm', async (req, res) => {
  try {
    console.log('🔄 Disparando sincronização direta com a API Oficial do ImobTotal...');
    const result = await imobTotalApiClient.syncAllImoveisFromApi();
    res.json(result);
  } catch (e) {
    console.error('Erro na sincronização oficial:', e.message);
    const fallbackResult = imoveisSyncManager.sincronizarRapido();
    res.json(fallbackResult);
  }
});

app.post('/api/imoveis/sync-daily', (req, res) => {
  try {
    const result = imoveisSyncDaily.syncDailyAging();
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Auto-Scheduler Matinal (Dispara todo dia às 07:00)
setInterval(() => {
  const agora = new Date();
  // Se for 07:00 da manhã (entre 07:00 e 07:05)
  if (agora.getHours() === 7 && agora.getMinutes() < 5) {
    console.log('⏰ Executando sincronização matinal automática das 07:00...');
    imoveisSyncDaily.syncDailyAging();
  }
}, 5 * 60 * 1000); // Checa a cada 5 min


// Rota para mover imóvel no Kanban (Drag & Drop)
app.post('/api/imoveis/mover-kanban', (req, res) => {
  try {
    const { codigo, novoStatus } = req.body;
    if (!codigo || !novoStatus) return res.status(400).json({ success: false, error: 'Código e novo status obrigatórios.' });

    const statusMap = {
      'enviada': 'disparado_aguardando',
      'semresposta': 'disparado_aguardando',
      'vendido': 'ja_vendido',
      'aumentou': 'aumentou_preco',
      'manteve': 'manteve_preco',
      'baixou': 'baixou_preco'
    };

    const statusDb = statusMap[novoStatus] || novoStatus;
    const result = imoveisEngine.updateImovel(codigo, {
      status_atualizacao: statusDb,
      data_edicao: new Date().toISOString()
    });

    res.json({ success: true, imovel: result, novoStatus: statusDb });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/imoveis/stats', (req, res) => {
  try {
    const stats = imoveisEngine.getStats();
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Oportunidades (Baixa de Preço)

// Relatório Consolidado para o grupo vendido/suspenso com filtro por data e separação por dias
const relatorioHandler = (req, res) => {
  try {
    const list = imoveisEngine.loadAll();
    const periodo = req.query.periodo || 'hoje'; // 'hoje', 'ontem', 'separado_dias', 'todos'
    
    const hoje = new Date();
    const hojeStr = hoje.toLocaleDateString('pt-BR');
    
    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const ontemStr = ontem.toLocaleDateString('pt-BR');

    // Função para extrair a data de edição formatada
    function getDataFormatada(im) {
      const rawDate = im.data_atualizacao || im.data_ultimo_disparo || im.data_edicao || '';
      if (rawDate) {
        try {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('pt-BR');
          }
        } catch(e) {}
      }
      return '25/08/2026';
    }

    function isRetorno(im) {
      const s = im.status_atualizacao || '';
      return s.includes('vendido') || s.includes('suspenso') || s.includes('baixou') || s.includes('subiu') || s.includes('aumentou') || s.includes('manteve') || (im.resposta_historico && !s.includes('aguardando') && s !== 'pendente');
    }

    // Filtrar todos que tiveram retorno
    const todosRetornos = list.filter(isRetorno);

    // Gerador de bloco de texto simplificado e direto para o grupo do CRM
    function gerarBlocoTexto(imoveis, tituloData = '') {
      const vendidos = imoveis.filter(im => (im.status_atualizacao || '').includes('vendido'));
      const desistiu = imoveis.filter(im => (im.status_atualizacao || '').includes('suspenso'));
      const baixou = imoveis.filter(im => (im.status_atualizacao || '').includes('baixou'));
      const subiu = imoveis.filter(im => (im.status_atualizacao || '').includes('subiu') || (im.status_atualizacao || '').includes('aumentou'));
      const manteve = imoveis.filter(im => (im.status_atualizacao || '').includes('manteve') || (im.status_atualizacao || '').includes('outros') || (im.status_atualizacao || '').includes('disponivel'));

      let txt = '';
      if (tituloData) {
        txt += `${tituloData}\n----------------------------------------\n`;
      }

      if (vendidos.length > 0) {
        txt += `🚫 *VENDIDO [${vendidos.length}]:*\n`;
        vendidos.forEach(im => {
          txt += `• *Ref: ${im.codigo}* — ${im.tipo} (${im.bairro || 'Taubaté'})\n`;
        });
        txt += '\n';
      }

      if (desistiu.length > 0) {
        txt += `⏸️ *DESISTIU DE VENDER / SUSPENSO [${desistiu.length}]:*\n`;
        desistiu.forEach(im => {
          txt += `• *Ref: ${im.codigo}* — ${im.tipo} (${im.bairro || 'Taubaté'})\n`;
        });
        txt += '\n';
      }

      if (baixou.length > 0) {
        txt += `🔥 *DISPONÍVEL (BAIXOU PREÇO) [${baixou.length}]:*\n`;
        baixou.forEach(im => {
          const valAntigo = Number(im.valor_anunciado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const valNovo = Number(im.valor_atualizado || im.valor_anunciado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          txt += `• *Ref: ${im.codigo}* — ${im.tipo} (${im.bairro || 'Taubaté'}) | De ${valAntigo} ➡️ Por *${valNovo}*\n`;
        });
        txt += '\n';
      }

      if (subiu.length > 0) {
        txt += `📈 *DISPONÍVEL (AUMENTOU PREÇO) [${subiu.length}]:*\n`;
        subiu.forEach(im => {
          const valAntigo = Number(im.valor_anunciado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const valNovo = Number(im.valor_atualizado || im.valor_anunciado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          txt += `• *Ref: ${im.codigo}* — ${im.tipo} (${im.bairro || 'Taubaté'}) | De ${valAntigo} ➡️ Por *${valNovo}*\n`;
        });
        txt += '\n';
      }

      if (manteve.length > 0) {
        txt += `✅ *DISPONÍVEL (MANTEVE PREÇO) [${manteve.length}]:*\n`;
        manteve.forEach(im => {
          const val = Number(im.valor_atualizado || im.valor_anunciado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          txt += `• *Ref: ${im.codigo}* — ${im.tipo} (${im.bairro || 'Taubaté'}) | ${val}\n`;
        });
        txt += '\n';
      }

      return txt;
    }

    let textoRelatorio = '';

    if (periodo === 'hoje') {
      const imoveisHoje = todosRetornos.filter(im => getDataFormatada(im) === hojeStr);
      textoRelatorio = `📢 *RELATÓRIO DE ATUALIZAÇÃO DE CARTEIRA (CRM)*\n` +
        `📅 *Data:* ${hojeStr} (Retornos de Hoje)\n\n` +
        gerarBlocoTexto(imoveisHoje) +
        `📊 *Total de retornos hoje:* ${imoveisHoje.length}`;
    } else if (periodo === 'ontem') {
      const imoveisOntem = todosRetornos.filter(im => getDataFormatada(im) === ontemStr);
      textoRelatorio = `📢 *RELATÓRIO DE ATUALIZAÇÃO DE CARTEIRA (CRM)*\n` +
        `📅 *Data:* ${ontemStr} (Retornos de Ontem)\n\n` +
        gerarBlocoTexto(imoveisOntem) +
        `📊 *Total de retornos de ontem:* ${imoveisOntem.length}`;
    } else {
      // Consolidado por dias
      const gruposPorData = {};
      todosRetornos.forEach(im => {
        const dt = getDataFormatada(im);
        if (!gruposPorData[dt]) gruposPorData[dt] = [];
        gruposPorData[dt].push(im);
      });

      textoRelatorio = `📢 *RELATÓRIO CONSOLIDADO COMPLETO (CRM)*\n\n`;
      
      const datasOrdenadas = Object.keys(gruposPorData).sort((a,b) => {
        const [d1,m1,y1] = a.split('/');
        const [d2,m2,y2] = b.split('/');
        return new Date(`${y2}-${m2}-${d2}`) - new Date(`${y1}-${m1}-${d1}`);
      });

      datasOrdenadas.forEach(dt => {
        const rotulo = dt === hojeStr ? `📅 *RETORNOS DE HOJE (${dt}) [${gruposPorData[dt].length} imóveis]*` : (dt === ontemStr ? `📅 *RETORNOS DE ONTEM (${dt}) [${gruposPorData[dt].length} imóveis]*` : `📅 *RETORNOS DO DIA ${dt} [${gruposPorData[dt].length} imóveis]*`);
        textoRelatorio += gerarBlocoTexto(gruposPorData[dt], rotulo) + '\n';
      });

      textoRelatorio += `\n📊 *Total geral acumulado:* ${todosRetornos.length} imóveis atualizados`;
    }

    res.json({
      success: true,
      periodo,
      textoRelatorio,
      totalRespostas: todosRetornos.length
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

app.get('/api/imoveis/relatorio-consolidado', relatorioHandler);
app.get('/api/imoveis/relatorio-atualizacao', relatorioHandler);


// Rota para listar Oportunidades do Dia

// Rota de Cruzamento de Oportunidades com Leads da Imobiliária (Matchmaking)
app.get('/api/imoveis/:codigo/matches', (req, res) => {
  try {
    const { codigo } = req.params;
    const all = imoveisEngine.loadAll();
    const imovel = all.find(x => x.codigo.toLowerCase() === (codigo || '').toLowerCase());
    if (!imovel) return res.status(404).json({ success: false, error: 'Imóvel não encontrado.' });

    const matches = imoveisMatchmaker.findMatchesForImovel(imovel);
    res.json({ success: true, imovel, matches });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/imoveis/oportunidades-dia', (req, res) => {
  try {
    const list = imoveisEngine.getOportunidadesDoDia();
    res.json({ success: true, oportunidades: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Rota para favoritar/desfavoritar como Oportunidade do Dia
app.post('/api/imoveis/toggle-oportunidade', (req, res) => {
  try {
    const { codigo, motivo } = req.body;
    if (!codigo) return res.status(400).json({ success: false, error: 'Código obrigatório.' });
    const result = imoveisEngine.toggleOportunidade(codigo, motivo);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Rota para gerar Copys de Oferta via IA
app.post('/api/imoveis/gerar-copys', async (req, res) => {
  try {
    const { codigo } = req.body;
    const all = imoveisEngine.loadAll();
    const imovel = all.find(x => x.codigo.toLowerCase() === (codigo || '').toLowerCase());
    if (!imovel) return res.status(404).json({ success: false, error: 'Imóvel não encontrado.' });

    const result = await imoveisCopyGenerator.gerarCopysOferta(imovel);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/imoveis/oportunidades', (req, res) => {
  try {
    const oportunidades = imoveisEngine.getOportunidades();
    res.json({ success: true, oportunidades });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Rota oficial para o Gerador de Cards Bali Ofertas (bali-ofertas.html)
app.get('/api/imovel/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const all = imoveisEngine.loadAll();
    const cleanCode = (codigo || '').toLowerCase().trim();
    let imovel = all.find(x => x.codigo.toLowerCase() === cleanCode || (x.codigo.replace(/\D/g, '') === cleanCode && cleanCode.length > 0));
    
    // Buscar dados detalhados ao vivo da API do ImobTotal
    let imovelApi = null;
    try {
      imovelApi = await imobTotalApiClient.getImovelByRef(codigo);
    } catch(e) {}

    if (!imovel && !imovelApi) {
      return res.status(404).json({ error: `Imóvel com referência "${codigo}" não encontrado.` });
    }

    if (!imovel) {
      imovel = {
        codigo: codigo,
        tipo: imovelApi.tipo || 'Imóvel',
        bairro: imovelApi.bairro || 'Taubaté',
        cidade: imovelApi.cidade || 'Taubaté',
        valor_anunciado: imovelApi.preco_venda || 0
      };
    }

    const fullTitulo = imovelApi?.titulo || imovel.titulo || '';
    const fullDesc = imovelApi?.descricao || imovel.descricao || '';

    const valNum = Number(imovelApi?.preco_venda || imovel.valor_anunciado) || 0;
    const valAtualNum = Number(imovel.valor_atualizado || valNum) || 0;
    const valOld = imovel.valor_atualizado && imovel.valor_atualizado < valNum 
      ? valNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '';
    const valNew = valAtualNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let rawImg = imovel.foto_capa || (imovel.fotos && imovel.fotos[0]) || '';
    if (imovelApi && imovelApi.fotos && imovelApi.fotos.length > 0) {
      rawImg = imovelApi.fotos[0].url || imovelApi.fotos[0].url_menor || rawImg;
    }
    const proxyImg = rawImg ? `/api/proxy-image?url=${encodeURIComponent(rawImg)}` : '';

    // Destaque inteligente e fidedigno ao imóvel
    let destaqueReal = 'Excelente Localização';
    const descText = (fullDesc + ' ' + fullTitulo).toLowerCase();
    if (descText.includes('piscina') || descText.includes('lazer completo') || descText.includes('academia') || descText.includes('clube')) {
      destaqueReal = 'Lazer Completo';
    } else if (descText.includes('porteira fechada')) {
      destaqueReal = 'Porteira Fechada';
    } else if (descText.includes('portaria') || descText.includes('segurança 24h') || descText.includes('condomínio fechado')) {
      destaqueReal = 'Condomínio Fechado';
    } else if (descText.includes('aceita financiamento') || descText.includes('minha casa minha vida') || descText.includes('mcmv') || descText.includes('fgts')) {
      destaqueReal = 'Aceita Financiamento';
    } else if (descText.includes('próximo') || descText.includes('upa') || descText.includes('escola') || descText.includes('mercado')) {
      destaqueReal = 'Próximo a Comércios & Escolas';
    } else if (imovel.bairro) {
      destaqueReal = `Ótima Região no ${imovel.bairro}`;
    }

    // Suítes ou Banheiros reais
    const numSuites = imovelApi?.suites || imovel.suites;
    const numBanh = imovelApi?.banheiros || imovel.banheiros;
    let suitesBanheiro = '1 Banheiro';
    if (numSuites && Number(numSuites) > 0) {
      suitesBanheiro = `${numSuites} Suíte${Number(numSuites) > 1 ? 's' : ''}`;
    } else if (numBanh && Number(numBanh) > 0) {
      suitesBanheiro = `${numBanh} Banheiro${Number(numBanh) > 1 ? 's' : ''}`;
    }

    // Área real (extraída de campos ou do texto)
    let areaReal = imovelApi?.area_construida || imovelApi?.area_total || imovel.area || imovel.area_construida || imovel.area_util;
    if (!areaReal && (fullTitulo || fullDesc)) {
      const matchArea = (fullTitulo + ' ' + fullDesc).match(/(\d+)\s*m²/i);
      if (matchArea) areaReal = matchArea[1];
    }
    if (!areaReal) areaReal = '50';

    const numQuartos = imovelApi?.dormitorios || imovel.quartos || imovel.dormitorios || 2;
    const numVagas = imovelApi?.vagas || imovel.vagas || 1;

    res.json({
      code: imovel.codigo || codigo,
      title: fullTitulo || `${imovel.tipo} no ${imovel.bairro}`,
      address: `${imovel.bairro || ''} - ${imovel.cidade || 'Taubaté, SP'}`,
      priceOld: valOld,
      priceNew: valNew,
      condition: 'Excelente oportunidade • Aceita financiamento',
      bed: `${numQuartos} Dormitórios`,
      suite: suitesBanheiro,
      area: `${areaReal} m²`,
      garage: `${numVagas} Vaga`,
      leisure: destaqueReal,
      bg: '#1E2A38',
      gold: '#D0AA6B',
      imageUrl: proxyImg
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Proxy de imagens para contornar CORS e alimentar o Canvas perfeitamente
app.get('/api/proxy-image', async (req, res) => {
  const axios = require('axios');
  let imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('URL não fornecida.');

  let tryUrls = [imageUrl];
  if (imageUrl.includes('fotos.sobressai.com.br/fotos/')) {
    tryUrls.unshift(imageUrl.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://fotos2.fra1.cdn.digitaloceanspaces.com/Fotos/'));
    tryUrls.push(imageUrl.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://fotos2.fra1.digitaloceanspaces.com/Fotos/'));
    tryUrls.push(imageUrl.replace(/https?:\/\/fotos\.sobressai\.com\.br\/fotos\//i, 'https://sobressai.sfo3.digitaloceanspaces.com/fotos/'));
  }
  if (imageUrl.match(/\/\d+\.(?:jpg|jpeg|png)$/i)) {
    tryUrls.push(imageUrl.replace(/\.(?:jpg|jpeg|png)$/i, '_g.jpg'));
    tryUrls.push(imageUrl.replace(/\.(?:jpg|jpeg|png)$/i, '_p.jpg'));
  }

  for (const u of tryUrls) {
    try {
      const response = await axios.get(u, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://app.imobtotal.com.br/'
        }
      });
      res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(response.data));
    } catch(e) {}
  }

  res.status(404).send('Imagem não encontrada.');
});

app.get('/ofertas', (req, res) => {
  res.sendFile(path.join(__dirname, 'bali-ofertas.html'));
});

app.get('/bali-ofertas.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'bali-ofertas.html'));
});

// Gerar lote de disparos
app.get('/api/imoveis/lote', (req, res) => {
  try {
    const tamanho = parseInt(req.query.tamanho) || 10;
    const tipo = req.query.tipo || 'todos';
    const lote = imoveisRoboDisparo.prepararLote(tamanho, tipo);
    res.json({ success: true, lote });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Marcar como disparado

// Disparo 100% automático de lote via WhatsApp oficial
app.post('/api/imoveis/lote/disparar-automatico', async (req, res) => {
  try {
    const tamanho = parseInt(req.query.tamanho) || 10;
    const tipo = req.query.tipo || 'apartamento';
    const result = await imoveisRoboDisparo.dispararLoteAutomatico(tamanho, tipo);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/imoveis/:codigo/disparo', (req, res) => {
  try {
    const { codigo } = req.params;
    const result = imoveisRoboDisparo.marcarComoDisparado(codigo);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Processar resposta do proprietário via IA
app.post('/api/imoveis/:codigo/resposta', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { respostaTexto } = req.body;
    if (!respostaTexto) {
      return res.status(400).json({ success: false, error: 'Texto da resposta obrigatório.' });
    }
    const result = await imoveisRoboDisparo.processarRespostaProprietario(codigo, respostaTexto);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ==========================================================
 * 3. ROTAS DAS PÁGINAS HTML
 * ========================================================== */

app.get('/gestor', (req, res) => {
  res.sendFile(path.join(__dirname, 'gestor-cockpit.html'));
});


// Rota da Página do Perfilador de Compradores
app.get('/compradores', (req, res) => {
  res.sendFile(path.join(__dirname, 'compradores-monitor.html'));
});

// API de Compradores
app.get('/api/compradores', (req, res) => {
  try {
    const list = compradoresEngine.getCompradores(req.query);
    res.json({ success: true, total: list.length, compradores: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/compradores/stats', (req, res) => {
  try {
    const stats = compradoresEngine.getStats();
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/compradores/:id', (req, res) => {
  try {
    const comprador = compradoresEngine.getCompradorById(req.params.id);
    if (!comprador) return res.status(404).json({ success: false, error: 'Comprador não encontrado.' });
    res.json({ success: true, comprador });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// Rota para importar planilha de leads do CRM
app.post('/api/compradores/importar-planilha', (req, res) => {
  try {
    const { leads } = req.body || {};
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ success: false, error: 'Lista de leads inválida.' });
    }
    const currentDb = compradoresEngine.loadAll();
    const map = new Map();
    currentDb.forEach(c => map.set(c.id, c));

    leads.forEach(l => {
      if (l.id && map.has(l.id)) {
        map.set(l.id, { ...map.get(l.id), ...l });
      } else {
        const newId = `COMP_${String(map.size + 1).padStart(4, '0')}`;
        map.set(newId, { ...l, id: newId });
      }
    });

    const finalList = Array.from(map.values());
    compradoresEngine.saveAll(finalList);
    res.json({ success: true, total: finalList.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/compradores', (req, res) => {
  try {
    const result = compradoresEngine.salvarOuAtualizarComprador(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/compradores/:id/matches', (req, res) => {
  try {
    const result = compradoresEngine.getMatchesParaComprador(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const leadsSlaManager = require('./leads_sla_manager');

/* ==========================================================
 * 5. ROTAS DO GESTOR DE LEADS & SLA (PIPELINE MAP)
 * ========================================================== */

app.get('/api/leads/resumo', (req, res) => {
  try {
    const resumo = leadsSlaManager.getResumo();
    res.json(resumo);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/leads/mensagens', (req, res) => {
  try {
    const msgs = leadsSlaManager.gerarMensagensCorretores();
    res.json(msgs);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/leads/processar-arquivo', (req, res) => {
  try {
    let { filePath } = req.body || {};
    
    if (!filePath) {
      const candidates = [
        'C:\\Users\\Marcel\\OneDrive\\Desktop\\LEADS_EXATOS_149_MAP_CRM.xlsx',
        'C:\\Users\\Marcel\\OneDrive\\Desktop\\leads map.xlsx',
        'C:\\Users\\Marcel\\Desktop\\LEADS_EXATOS_149_MAP_CRM.xlsx',
        'C:\\Users\\Marcel\\Desktop\\leads map.xlsx'
      ];

      const dFolder = 'C:\\Users\\Marcel\\Downloads';
      if (fs.existsSync(dFolder)) {
        const dFiles = fs.readdirSync(dFolder)
          .filter(f => (f.toLowerCase().includes('lead') || f.toLowerCase().includes('atendimento')) && (f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv')))
          .map(f => {
            const p = path.join(dFolder, f);
            return { p, mtime: fs.statSync(p).mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);
        
        if (dFiles.length > 0) candidates.unshift(dFiles[0].p);
      }

      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          filePath = cand;
          break;
        }
      }
    }

    if (!filePath) {
      return res.status(404).json({ success: false, error: 'Nenhum arquivo de leads encontrado para processar.' });
    }

    const resumo = leadsSlaManager.processarArquivoExcel(filePath);
    res.json({ success: true, arquivoProcessado: filePath, resumo });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Disparar cobranças automáticas para todos os corretores via WhatsApp oficial
app.post('/api/leads/disparar-todos-corretores', async (req, res) => {
  try {
    const msgs = leadsSlaManager.gerarMensagensCorretores();
    const paraDisparar = msgs.filter(m => m.telefone && !m.telefone.includes('0000') && m.telefone.length >= 10);

    if (paraDisparar.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum corretor com telefone cadastrado e leads atrasados no momento.' });
    }

    const payload = {
      lote: paraDisparar.map(m => ({
        nome: m.corretor,
        tel: m.telefone,
        mensagem: m.mensagemTexto,
        codigo: `SLA_${m.corretor.replace(/\s+/g, '_')}`
      }))
    };

    // Chamar WhatsApp Listener na porta 5000
    const http = require('http');
    const postData = JSON.stringify(payload);

    const zapReq = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/send-batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, zapRes => {
      let data = '';
      zapRes.on('data', chunk => data += chunk);
      zapRes.on('end', () => {
        try {
          const resp = JSON.parse(data);
          res.json({ success: true, totalCorretores: paraDisparar.length, corretores: paraDisparar.map(c => c.corretor), zapResponse: resp });
        } catch(e) {
          res.json({ success: true, totalCorretores: paraDisparar.length, corretores: paraDisparar.map(c => c.corretor), raw: data });
        }
      });
    });

    zapReq.on('error', err => {
      res.status(503).json({ success: false, error: `WhatsApp Listener não está online ou não respondeu: ${err.message}` });
    });

    zapReq.write(postData);
    zapReq.end();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Listar pacotes mastigados de reativação (com card gerado e copy)
app.get('/api/leads/pacotes-reativacao', async (req, res) => {
  try {
    const limite = Number(req.query.limite) || 30;
    const pacotes = await ofertasReativacaoEngine.gerarPacotesReativacao(limite);
    res.json({ success: true, total: pacotes.length, pacotes });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Disparar ofertas mastigadas para os corretores via WhatsApp oficial (com card em imagem anexada)
app.post('/api/leads/disparar-ofertas-mastigadas', async (req, res) => {
  try {
    const limite = Number(req.body.limite) || 15;
    const pacotes = await ofertasReativacaoEngine.gerarPacotesReativacao(limite);
    const corretoresTelefones = leadsSlaManager.getResumo().porCorretor;
    const telMap = {};
    corretoresTelefones.forEach(c => {
      if (c.telefone && !c.telefone.includes('0000')) {
        telMap[c.corretor.toLowerCase().trim()] = c.telefone;
      }
    });

    const loteParaEnvio = [];
    pacotes.forEach(p => {
      const cNome = (p.corretor || '').toLowerCase().trim();
      const corretorTel = telMap[cNome];
      if (corretorTel) {
        loteParaEnvio.push({
          nome: p.corretor,
          tel: corretorTel,
          mensagem: p.msgParaCorretor,
          mediaPath: p.cardPngPath,
          codigo: `REATIVACAO_${p.imovelRef}_${p.primeiroNome}`
        });
      }
    });

    if (loteParaEnvio.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum corretor com telefone cadastrado para os leads elegíveis.' });
    }

    const http = require('http');
    const postData = JSON.stringify({ lote: loteParaEnvio });

    const zapReq = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/send-batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, zapRes => {
      let data = '';
      zapRes.on('data', chunk => data += chunk);
      zapRes.on('end', () => {
        try {
          const resp = JSON.parse(data);
          res.json({ success: true, totalOfertas: loteParaEnvio.length, zapResponse: resp });
        } catch(e) {
          res.json({ success: true, totalOfertas: loteParaEnvio.length, raw: data });
        }
      });
    });

    zapReq.on('error', err => {
      res.status(503).json({ success: false, error: `WhatsApp Listener não respondeu: ${err.message}` });
    });

    zapReq.write(postData);
    zapReq.end();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/leads/exportar-excel', (req, res) => {
  try {
    const outPath = path.join(__dirname, 'SLA_Leads_Cobranca.xlsx');
    leadsSlaManager.exportarExcelSla(outPath);
    res.download(outPath, 'SLA_Leads_Cobranca_Bali_Imoveis.xlsx');
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/leads', (req, res) => {
  res.sendFile(path.join(__dirname, 'leads-monitor.html'));
});

app.get('/conectar-corretores', (req, res) => {
  res.sendFile(path.join(__dirname, 'conectar-corretores.html'));
});

app.get('/renato', (req, res) => {
  res.sendFile(path.join(__dirname, 'conectar-renato.html'));
});

app.get('/laysa', (req, res) => {
  res.sendFile(path.join(__dirname, 'conectar-laysa.html'));
});

app.get('/marcel', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'conectar-marcel.html'));
});

app.get('/ana', (req, res) => {
  res.sendFile(path.join(__dirname, 'conectar-ana.html'));
});

app.get('/reativacao', (req, res) => {
  res.sendFile(path.join(__dirname, 'painel-reativacao.html'));
});

app.get('/curadoria', (req, res) => {
  res.sendFile(path.join(__dirname, 'curadoria-ofertas.html'));
});

const curadoriaFile = path.join(__dirname, 'data', 'curadoria_gestor.json');
let curadoriaGestor = {
  mantiqueira: '1544',
  sao_jose: '1605',
  sobrados: '1355',
  alto_padrao: '1373'
};
try {
  if (fs.existsSync(curadoriaFile)) {
    curadoriaGestor = JSON.parse(fs.readFileSync(curadoriaFile, 'utf8'));
  }
} catch(e) {}

app.post('/api/curadoria/salvar', (req, res) => {
  curadoriaGestor = { ...curadoriaGestor, ...req.body, salvo_em: new Date().toISOString() };
  try {
    fs.writeFileSync(curadoriaFile, JSON.stringify(curadoriaGestor, null, 2), 'utf8');
  } catch(e) {}
  console.log('🎯 [CURADORIA] Escolhas do Gestor Marcel salvas no disco:', curadoriaGestor);
  res.json({ success: true, message: 'Palpites salvos com sucesso! As ofertas foram travadas no disparo.', curadoria: curadoriaGestor });
});

app.get('/upload-imoveis', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload-imoveis.html'));
});

app.post('/api/imoveis/upload', uploadPlanilha.single('planilha'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
    }
    const resultado = imoveisUploadService.processarPlanilha(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/imoveis', (req, res) => {
  res.sendFile(path.join(__dirname, 'imoveis-monitor.html'));
});

app.get('/', (req, res) => {
  res.redirect('/leads');
});

/* ==========================================================
 * 8. ROTAS MULTI-WHATSAPP (DISPARO DIRETO DOS CORRETORES)
 * ========================================================== */
const multiCorretorZap = require('./multi_corretor_whatsapp_service');
const cardGeneratorService = require('./card_generator_service');
const campanhasReativacaoManager = require('./campanhas_reativacao_manager');

// 🔄 AUTO-RECONEXÃO SEQUENCIAL DE SESSÕES SALVAS AO INICIAR
setTimeout(async () => {
  const brokersWithSession = ['marcel_teste'].filter(brokerId => {
    const sessionDir = path.join(__dirname, '.wwebjs_auth', `session-broker_${brokerId}`);
    return fs.existsSync(sessionDir);
  });

  for (const brokerId of brokersWithSession) {
    try {
      console.log(`🔄 [AUTO-BOOT] Reconectando sessão salva de ${multiCorretorZap.CORRETORES_CONFIG[brokerId].nome}...`);
      await multiCorretorZap.connectBroker(brokerId);
      // Intervalo de 15s para o Chromium inicializar sem travar o processador
      await new Promise(r => setTimeout(r, 15000));
    } catch(err) {
      console.warn(`[AUTO-BOOT] Erro ao reconectar ${brokerId}:`, err.message);
    }
  }
}, 3000);

app.get('/api/reativacao/metricas', (req, res) => {
  try {
    const metricas = campanhasReativacaoManager.getMetricasGerais();
    const conexoes = multiCorretorZap.listAllBrokers();
    res.json({ success: true, metricas, conexoes });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/reativacao/historico', (req, res) => {
  try {
    const disparos = campanhasReativacaoManager.loadDisparos();
    res.json({ success: true, disparos });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/corretores/conexoes', (req, res) => {
  try {
    const corretores = multiCorretorZap.listAllBrokers();
    res.json({ success: true, corretores });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/corretor/:id/connect', async (req, res) => {
  try {
    const result = await multiCorretorZap.connectBroker(req.params.id);
    res.json({ success: true, ...result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/corretor/:id/pairing-code', async (req, res) => {
  try {
    const { telefone } = req.body || {};
    const result = await multiCorretorZap.requestBrokerPairingCode(req.params.id, telefone);
    res.json({ success: true, ...result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get('/api/marcel/debug-chats', async (req, res) => {
  try {
    const zap = require('./multi_corretor_whatsapp_service');
    const session = zap.getSession('marcel_teste');
    if (!session || !session.client) return res.json({ error: 'No client or session' });
    const client = session.client;
    const info = client.info ? { wid: client.info.wid, pushname: client.info.pushname } : null;
    const chats = await client.getChats();
    const list = chats.slice(0, 20).map(c => ({
      name: c.name,
      id: c.id ? c.id._serialized : null,
      isGroup: c.isGroup,
      isReadOnly: c.isReadOnly
    }));
    res.json({ success: true, info, totalChats: chats.length, chats: list });
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.post('/api/marcel/send-pilot-now', async (req, res) => {
  try {
    const zap = require('./multi_corretor_whatsapp_service');
    const { MessageMedia } = require('whatsapp-web.js');
    const fs = require('fs');
    const videoEngine = require('./video_anuncios_engine');
    const session = zap.getSession('marcel_teste');
    if (!session || !session.client) return res.status(400).json({ error: 'No client or session for marcel_teste' });
    const client = session.client;
    let target = '213649004212310@lid';
    if (client.info && client.info.wid && client.info.wid._serialized) {
      target = client.info.wid._serialized;
    }
    const videoPath = '/var/www/bali-gestor/outputs/Anuncio_Completo_1_Imovel_1639.mp4';
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file does not exist: ' + videoPath });
    }
    const media = MessageMedia.fromFilePath(videoPath);
    const caption = '🎬 *VÍDEO 1 (PILOTO) PRONTO!*\n\n' +
      '• *Imóvel:* #1639\n' +
      '• *Gancho 1:* Look Terno Executivo (Retenção)\n' +
      '• *Desenvolvimento:* Imóvel com foto de fundo + Avatar em círculo\n' +
      '• *Montagem:* FFmpeg 100% perfeita!\n\n' +
      '👉 Se você curtiu o resultado, responda *OK* ou *GERAR RESTANTE* para eu renderizar os outros 2 vídeos (Ganchos 2 e 3)!';
    console.log('[SERVER] Enviando vídeo piloto para', target);
    await client.sendMessage(target, media, { caption });
    try {
      const imovel = await videoEngine.fetchImovelData('1639');
      videoEngine.activeVideoSessions['marcel'] = {
        imovelRef: '1639',
        imovelData: imovel,
        scripts: videoEngine.generateCompleteScripts(imovel),
        bodyPath: '/var/www/bali-gestor/outputs/body_1639_1788561013679.mp4',
        waitingApproval: true
      };
    } catch(e2) {
      console.error('[SERVER] Erro ao registrar session:', e2.message);
    }
    res.json({ success: true, target, videoPath });
  } catch(e) {
    console.error('[SERVER] Erro ao enviar piloto:', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.post('/api/marcel/send-self', async (req, res) => {
  try {
    const zap = require('./multi_corretor_whatsapp_service');
    const session = zap.getSession('marcel_teste');
    if (!session || !session.client) return res.json({ error: 'No client or session' });
    const client = session.client;
    const text = req.body && req.body.text ? req.body.text : '🤖 Teste no self-chat!';
    
    // Identificar o chat do Marcel consigo mesmo
    let target = '5511941610601@c.us';
    if (client.info && client.info.wid && client.info.wid._serialized) {
      target = client.info.wid._serialized;
    }
    
    const sent = await client.sendMessage(target, text);
    res.json({ success: true, target, sentId: sent ? (sent.id ? sent.id._serialized : 'sent') : null });
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.get('/api/corretor/:id/status', (req, res) => {
  try {
    const status = multiCorretorZap.getBrokerStatus(req.params.id);
    res.json({ success: true, ...status });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/corretor/:id/screenshot', async (req, res) => {
  try {
    const buffer = await multiCorretorZap.takeBrokerScreenshot(req.params.id, req.query.q);
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch(e) {
    res.status(500).send('Erro ao capturar tela: ' + e.message);
  }
});

app.get('/api/corretor/:id/varrer-respostas', async (req, res) => {
  try {
    const checagens = await multiCorretorZap.checkBrokerRecentChats(req.params.id);
    res.json({ success: true, total: checagens.length, checagens });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/corretor/:id/inspecionar-respostas', async (req, res) => {
  try {
    const inspecoes = await multiCorretorZap.inspectLeadsResponses(req.params.id);
    res.json({ success: true, total: inspecoes.length, inspecoes });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/corretor/:id/disconnect', async (req, res) => {
  try {
    const result = await multiCorretorZap.disconnectBroker(req.params.id);
    res.json(result);
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/corretor/:id/disparar-reativacao', async (req, res) => {
  try {
    const brokerId = req.params.id;
    const cfg = multiCorretorZap.CORRETORES_CONFIG[brokerId];
    if (!cfg) return res.status(400).json({ success: false, error: 'Corretor não encontrado' });

    const status = multiCorretorZap.getBrokerStatus(brokerId);
    if (status.status !== 'ready') {
      return res.status(400).json({ success: false, error: `WhatsApp de ${cfg.nome} não está conectado!` });
    }

    const todosImoveis = imoveisEngine.loadAll();
    const leadsSlaManager = require('./leads_sla_manager');
    const resumo = leadsSlaManager.getResumo();
    const allLeads = resumo.leads || [];

    const limiteBatch = Number(req.body && req.body.limite) || 10;
    const loteEnvio = [];

    // Busca leads frios com match perfeito até completar a cota exata (ex: 10)
    for (let i = 0; i < allLeads.length; i++) {
      if (loteEnvio.length >= limiteBatch) break;
      const lead = allLeads[i];
      const cNome = (lead.corretor || '').toLowerCase();
      const dias = Number(lead.dias_parado) || 0;

      if (dias < 20 || !lead.imovel || lead.imovel === 'Geral') continue;
      if (campanhasReativacaoManager.isEmQuarentena(lead.telefone)) continue;

      if (brokerId !== 'marcel_teste') {
        const partes = cfg.nome.toLowerCase().split(' ');
        if (!partes.some(p => p.length > 2 && cNome.includes(p))) continue;
      }

      let match = ofertasReativacaoEngine.encontrarMatchTaubateEstrito(lead.imovel, todosImoveis);
      if (!match) continue;

      let orig = match.orig;
      let oferta = match.oferta;

      // Respeitar as escolhas da Curadoria do Gestor Marcel
      const bOrig = (orig.bairro || '').toLowerCase();
      const tOrig = (orig.tipo || '').toLowerCase();
      if (bOrig.includes('mantiqueira') && curadoriaGestor.mantiqueira) {
        const cur = todosImoveis.find(x => x.codigo === curadoriaGestor.mantiqueira);
        if (cur) oferta = cur;
      } else if ((bOrig.includes('são josé') || bOrig.includes('guril') || bOrig.includes('independ')) && curadoriaGestor.sao_jose) {
        const cur = todosImoveis.find(x => x.codigo === curadoriaGestor.sao_jose);
        if (cur) oferta = cur;
      } else if ((tOrig.includes('sobrado') || tOrig.includes('casa')) && curadoriaGestor.sobrados) {
        const cur = todosImoveis.find(x => x.codigo === curadoriaGestor.sobrados);
        if (cur) oferta = cur;
      }

      if (brokerId === 'jessica_bueno') {
        const trivellato = todosImoveis.find(x => x.codigo === '1605');
        if (trivellato) oferta = trivellato;
      }

      let primeiroNome = (lead.cliente || '').replace(/[^a-zA-ZÀ-ÿ\s]/g, '').trim().split(' ')[0];
      const saudacao = (primeiroNome && primeiroNome.length >= 2) ? `Oi, ${primeiroNome}! Tudo bem?` : `Oi! Tudo bem?`;
      const pNovo = Number(oferta.valor_atualizado || oferta.valor_anunciado) || 0;
      const precoFmt = pNovo > 0 ? pNovo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Preço de Oportunidade';
      const bairroCurto = oferta.bairro || 'Taubaté';

      const copyEngajadora = 
`${saudacao} Sumiu! rs 👋

Lembrei de você hoje na hora: apareceu uma oportunidade excelente no ${bairroCurto}, com valor bem abaixo do mercado (${precoFmt}).

Dá uma olhada na foto que te mandei acima! O que achou? 🔑`;

      let cardPath = null;
      try {
        cardPath = await cardGeneratorService.gerarCardPng(oferta.codigo, false);
      } catch(e) {}

      // Se for piloto do Marcel, envia para o número do Marcel para teste; senão, telefone real do lead
      const telDestino = brokerId === 'marcel_teste' ? cfg.telDefault : lead.telefone;

      loteEnvio.push({
        nome: `${lead.cliente} (${primeiroNome})`,
        tel: telDestino,
        mensagem: copyEngajadora,
        mediaPath: cardPath,
        codigo: oferta.codigo,
        imovel_original: orig.codigo,
        valor_ofertado: pNovo
      });
    }

    if (loteEnvio.length === 0) {
      return res.status(400).json({ success: false, error: 'Não foi possível gerar ofertas no mesmo bairro para os leads deste corretor.' });
    }

    // Disparar em segundo plano
    multiCorretorZap.sendBatchFromBroker(brokerId, loteEnvio).catch(err => {
      console.error(`Erro no disparo de ${cfg.nome}:`, err.message);
    });

    res.json({
      success: true,
      message: `Disparo de ${loteEnvio.length} ofertas iniciado diretamente do WhatsApp de ${cfg.nome}!`,
      totalLeads: loteEnvio.length
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('==================================================');
    console.log(`🏢 BALI IMÓVEIS - SERVIDOR DE GESTÃO & LEADS ATIVO!`);
    console.log(`🎯 Gestor de Leads & SLA: http://localhost:${PORT}/leads`);
    console.log(`🏠 Monitor de Imóveis:   http://localhost:${PORT}/imoveis`);
    console.log(`👥 Compradores:          http://localhost:${PORT}/compradores`);
    console.log(`🌐 Cockpit do Gestor:    http://localhost:${PORT}/gestor`);
    console.log(`🔒 Módulo 100% isolado na porta ${PORT}`);
    console.log('==================================================');
  });
}

module.exports = app;


// ============================================================
// 📁 AUTO-WATCHER: VIGILÂNCIA AUTOMÁTICA DA PASTA DOWNLOADS
// ============================================================
const pastasVigiadas = [
  'C:\\Users\\Marcel\\Downloads',
  path.join(__dirname, 'relatorios_crm')
];
let isImporting = false;
let ultimoArquivoProcessado = '';

function verificarNovosDownloads() {
  if (isImporting) return;
  try {
    let todosArquivos = [];

    for (const pasta of pastasVigiadas) {
      if (!fs.existsSync(pasta)) continue;
      const files = fs.readdirSync(pasta).filter(f => 
        (f.endsWith('.xls') || f.endsWith('.xlsx') || f.endsWith('.csv')) &&
        (f.toLowerCase().includes('atendimento') || f.toLowerCase().includes('lead') || f.toLowerCase().includes('crm') || pasta.includes('Gestão de leads'))
      );
      files.forEach(f => {
        const full = path.join(pasta, f);
        try {
          todosArquivos.push({ file: f, path: full, mtime: fs.statSync(full).mtimeMs, pasta });
        } catch(e) {}
      });
    }

    // Ordenar pelo mais recente
    todosArquivos.sort((a, b) => b.mtime - a.mtime);

    if (todosArquivos.length > 0) {
      const latest = todosArquivos[0];
      // Se é um arquivo novo ou modificado recentemente (últimos 3 minutos)
      if (latest.file !== ultimoArquivoProcessado && (Date.now() - latest.mtime < 180000)) {
        ultimoArquivoProcessado = latest.file;
        isImporting = true;
        console.log(`📁 [AUTO-WATCHER] Novo arquivo de CRM detectado em ${latest.pasta}: ${latest.file}! Processando...`);
        try {
          leadsSlaManager.processarArquivoExcel(latest.path);
          console.log(`✅ [AUTO-WATCHER] Relatório ${latest.file} importado e base de leads atualizada com sucesso!`);
        } catch (err) {
          console.error(`❌ [AUTO-WATCHER] Erro ao processar planilha:`, err.message);
        } finally {
          isImporting = false;
        }
      }
    }
  } catch (e) {}
}

setInterval(verificarNovosDownloads, 10000);

// ============================================================
// ⏰ AGENDADOR AUTOMÁTICO DE DISPAROS (08:00 & 17:00)
// ============================================================
let ultimoTurnoDisparado = ''; // '2026-09-03_08' | '2026-09-03_17'

async function verificarAgendamentoDisparos() {
  const agora = new Date();
  const hojeStr = agora.toISOString().slice(0, 10);
  const hora = agora.getHours();
  const min = agora.getMinutes();

  let turno = null;
  if (hora === 8 && min >= 0 && min <= 5) turno = '08';
  if (hora === 17 && min >= 0 && min <= 5) turno = '17';

  if (!turno) return;

  const chaveTurno = `${hojeStr}_${turno}`;
  if (ultimoTurnoDisparado === chaveTurno) return;

  console.log(`⏰ [AGENDADOR] Horário de disparo atingido: ${turno}h00! Verificando corretores online...`);
  ultimoTurnoDisparado = chaveTurno;

  const corretores = multiCorretorZap.listAllBrokers();
  const onlineBrokers = corretores.filter(c => c.status === 'ready');

  if (onlineBrokers.length === 0) {
    console.log(`⏰ [AGENDADOR] Nenhum corretor conectado às ${turno}h. Disparo automático suspenso.`);
    return;
  }

  for (const b of onlineBrokers) {
    console.log(`🚀 [AGENDADOR] Executando cota de 10 leads das ${turno}h para ${b.nome}...`);
    try {
      const http = require('http');
      const req = http.request({
        hostname: 'localhost',
        port: PORT,
        path: `/api/corretor/${b.id}/disparar-reativacao`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      req.write(JSON.stringify({ limite: 10 }));
      req.end();
    } catch(err) {
      console.error(`❌ [AGENDADOR] Erro no disparo de ${b.nome}:`, err.message);
    }
  }
}

setInterval(verificarAgendamentoDisparos, 30000);