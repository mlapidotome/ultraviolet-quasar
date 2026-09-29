/**
 * Sincronizador de Leads do ImobTotal — Versão 3.3A (N:N Multi-Funil)
 * 
 * Adaptações:
 * 1. Para bypassar a limitação da API v1 (que sempre retorna o funil/etapa primário),
 *    nós descobrimos as etapas do funil dinamicamente e fazemos paginação por etapa.
 * 2. O Sincronizador alimenta o LocalStore V2 no formato N:N (Participações).
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const ImobTotalRateLimiter = require('./rate_limiter');
const SyncLocalStore = require('./local_store');

class ImobTotalSyncPrototype {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.IMOBTOTAL_API_KEY;
    if (!this.apiKey) {
      throw new Error("Configuração ausente: IMOBTOTAL_API_KEY não foi informada nas opções nem no ambiente.");
    }
    this.baseUrl = options.baseUrl || process.env.IMOBTOTAL_BASE_URL || 'https://app.imobtotal.com.br/api/v1';

    this.monitoredFunis = options.monitoredFunis || [
      { id: 3500, nome: 'Lançamentos' },
      { id: 5308, nome: 'MCMV' },
      { id: 5297, nome: 'MAP' },
      { id: 3515, nome: 'Terceiros' }
    ];

    this.janelaDias = options.janelaDias || 60;
    this.maxMonitorDays = options.maxMonitorDays || 60;
    this.dryRun = options.dryRun || false;
    this.isSimulated = options.isSimulated || false;
    this.mapaEtapasPath = options.mapaEtapasPath || path.join(__dirname, '..', '..', 'data', 'mapa_etapas_crm.json');

    // 30 Etapas Comerciais Ativas aprovadas para os 4 funis
    this.etapasAtivasPorFunil = options.etapasAtivasPorFunil || {
      3515: [15982, 7923, 5760, 14588, 10029, 9106],
      5297: [15426, 15204, 15205, 15207, 15208, 15209, 15210],
      5308: [15981, 15257, 15258, 15261, 15262, 15263, 15264],
      3500: [5668, 15007, 9391, 9398, 9399, 10932, 5669, 5670, 5671, 5672]
    };

    this.rateLimiter = new ImobTotalRateLimiter({ minDelayMs: options.minDelayMs || 600 });

    const dbPath = options.dbFilePath || path.join(__dirname, '..', '..', 'data', 'bali_test_33a.json');
    this.localStore = new SyncLocalStore({ dbFilePath: dbPath });

    this.cycleEvents = [];
  }

  loadMapaEtapas() {
    if (fs.existsSync(this.mapaEtapasPath)) {
      try { return JSON.parse(fs.readFileSync(this.mapaEtapasPath, 'utf8')); } catch(e) { return {}; }
    }
    return {};
  }

  getHeaders() {
    return {
      'x-api-key': this.apiKey,
      'User-Agent': 'BaliImoveisSync/2.0 (N:N)',
      'Accept': 'application/json'
    };
  }

  getDataInicioIsoDate() {
    const d = new Date();
    d.setDate(d.getDate() - this.janelaDias);
    return d.toISOString().split('T')[0];
  }

  async executeGet(endpoint, params = {}, retries = 3) {
    let attempt = 0;
    while (attempt <= retries) {
      attempt++;
      await this.rateLimiter.throttle();
      try {
        const response = await axios.get(`${this.baseUrl}${endpoint}`, {
          headers: this.getHeaders(),
          params,
          timeout: 35000
        });
        this.rateLimiter.updateFromHeaders(response.headers);
        return response.data;
      } catch (error) {
        if (error.response) {
          this.rateLimiter.updateFromHeaders(error.response.headers);
          if (error.response.status === 429) {
            const waitMs = this.rateLimiter.handle429(error.response.headers);
            console.warn(`⚠️ [RateLimit 429] Aguardando ${waitMs}ms antes de retentar tentativa ${attempt}/${retries}...`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
        }
        if (attempt <= retries) {
          console.warn(`⚠️ [Retry ${attempt}/${retries}] Erro em ${endpoint} (${error.message}). Pausando 3s antes de retentar...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Provedor de dados simulados para testes controlados sem tocar na API real
   */
  getSimulatedLeadsForEtapa(funilId, etapaId, etapaNome) {
    const dataInicioIso = this.getDataInicioIsoDate();
    const leadsColetados = [];
    let paginas = 1;

    // Caso 1: Paginação com etapa com mais de 250 leads (LEADFY no funil 3500)
    if (funilId === 3500 && etapaId === 15007) {
      paginas = 3; // Simula 3 páginas: 100 + 100 + 60 = 260 leads
      for (let i = 1; i <= 260; i++) {
        leadsColetados.push({
          id: 7000000 + i,
          nome: `Lead Leadfy Paginação #${i}`,
          data_cadastro: new Date().toISOString(),
          corretor_delegado: { id: 101, nome: "Matheus Loschi" }
        });
      }
      return { leads: leadsColetados, paginas: 3 };
    }

    // Caso 2: Novo lead global recente (< 60 dias) em Terceiros (3515) -> CAIXA DE ENTRADA (15982)
    if (funilId === 3515 && etapaId === 15982) {
      leadsColetados.push({
        id: 9990001,
        nome: "Juliana Mendes (Novo Lead Recente)",
        data_cadastro: new Date().toISOString(),
        corretor_delegado: { id: 101, nome: "Matheus Loschi" }
      });

      // Lead legado antigo (> 200 dias) que NÃO deve ser importado
      leadsColetados.push({
        id: 8880001,
        nome: "Lead Legado Esquecido (Ano 2024)",
        data_cadastro: "2024-02-10T10:00:00.000Z",
        corretor_delegado: { id: 999, nome: "Sem Corretor" }
      });
    }

    // Caso 3: Itera sobre os leads da carteira existente
    const snapshots = this.localStore.getAllSnapshots();
    for (const l of snapshots) {
      const p = l.funis ? l.funis[funilId] : null;

      // Inclusão de segundo funil para lead existente (Fabrícia Silva 3101119 no MAP 5297)
      if (!p) {
        if (l.id === 3101119 && funilId === 5297 && etapaId === 15204) {
          leadsColetados.push({
            id: l.id,
            nome: l.nome,
            data_cadastro: l.data_cadastro_crm,
            data_ultimo_atendimento: l.data_ultimo_atendimento,
            dias_sem_atendimento: l.dias_sem_atendimento,
            corretor_delegado: { id: 101, nome: "Matheus Loschi" }
          });
        }
        continue;
      }

      // Atualização de cliente antigo (>60 dias na carteira): Lead 1112223 (cadastrado em maio) avança para VISITA (10029)
      if (l.id === 1112223 && funilId === 3515) {
        if (etapaId === 10029) {
          leadsColetados.push({
            id: l.id,
            nome: l.nome,
            data_cadastro: l.data_cadastro_crm,
            data_ultimo_atendimento: new Date().toISOString(),
            dias_sem_atendimento: 0,
            corretor_delegado: { id: 101, nome: "Matheus Loschi" }
          });
        }
        continue;
      }

      // Mudança de Etapa para Fabrícia Silva (3101119 em 3515) para VISITA (10029)
      if (l.id === 3101119 && funilId === 3515) {
        if (etapaId === 10029) {
          leadsColetados.push({
            id: l.id,
            nome: l.nome,
            data_cadastro: l.data_cadastro_crm,
            data_ultimo_atendimento: new Date().toISOString(),
            dias_sem_atendimento: 0,
            corretor_delegado: { id: p.corretor_id || 101, nome: p.corretor_nome || "Matheus Loschi" }
          });
        }
        continue;
      }

      // Mudança de Corretor para William Thomas (4528190 em 5297)
      if (l.id === 4528190 && funilId === 5297 && p.etapa_id === etapaId) {
        leadsColetados.push({
          id: l.id,
          nome: l.nome,
          data_cadastro: l.data_cadastro_crm,
          data_ultimo_atendimento: l.data_ultimo_atendimento,
          dias_sem_atendimento: l.dias_sem_atendimento,
          corretor_delegado: { id: 888, nome: "Ana Paula Corretora (Reatribuído)" }
        });
        continue;
      }

      // Demais leads presentes nesta etapa ativa
      if (p.etapa_id === etapaId) {
        leadsColetados.push({
          id: l.id,
          nome: l.nome,
          data_cadastro: l.data_cadastro_crm,
          data_ultimo_atendimento: l.data_ultimo_atendimento,
          dias_sem_atendimento: l.dias_sem_atendimento,
          corretor_delegado: p.corretor_id ? { id: p.corretor_id, nome: p.corretor_nome } : null
        });
      }
    }

    return { leads: leadsColetados, paginas: 1 };
  }

  /**
   * Busca as etapas ativas de um funil específico
   */
  async fetchEtapasDoFunil(funilId) {
    const etapasAtivasIds = new Set(this.etapasAtivasPorFunil[funilId] || []);
    if (this.isSimulated) {
      const mapa = this.loadMapaEtapas();
      const etapas = [];
      Object.keys(mapa).forEach(k => {
        const parts = k.split('_');
        if (parts.length === 2 && parseInt(parts[0], 10) === funilId) {
          const eId = parseInt(parts[1], 10);
          if (etapasAtivasIds.has(eId)) {
            etapas.push({ id: eId, nome: mapa[k].nome });
          }
        }
      });
      return etapas;
    }

    if (!this.cachedPipelineEtapas) {
      const data = await this.executeGet('/pipeline/etapas');
      this.cachedPipelineEtapas = Array.isArray(data) ? data : (data.etapas || []);
    }

    const etapas = this.cachedPipelineEtapas
      .filter(e => e.id_pipe === funilId && etapasAtivasIds.has(e.id))
      .map(e => ({
        id: e.id,
        nome: e.nome_etapa
      }));

    // Validação estrita da Diretriz 1:
    // "Se alguma etapa não existir mais ou apresentar divergência, interrompa a consulta e apresente o problema. Não substitua etapas automaticamente."
    const encontradas = new Set(etapas.map(e => e.id));
    for (const eId of etapasAtivasIds) {
      if (!encontradas.has(eId)) {
        throw new Error(`Divergência técnica: A etapa ativa ID ${eId} não foi encontrada no funil ${funilId} no CRM. Operação interrompida por segurança.`);
      }
    }

    return etapas;
  }

  /**
   * Realiza consulta paginada completa para uma etapa ativa (sem restrição de data)
   */
  async fetchPaginatedEtapa(funilId, funilNome, etapaId, etapaNome, maxPages = 50) {
    if (this.isSimulated) {
      await new Promise(r => setTimeout(r, 10));
      if (this.mockDataProvider) {
        return this.mockDataProvider(funilId, funilNome, etapaId, etapaNome);
      }
      return this.getSimulatedLeadsForEtapa(funilId, etapaId, etapaNome);
    }

    let pagina = 1;
    let temProxima = true;
    const leadsColetados = [];
    let paginasParaEstaEtapa = 0;

    while (temProxima && pagina <= maxPages) {
      paginasParaEstaEtapa++;
      const queryParams = {
        etapa_id: etapaId,
        ordenar: 'CADASTRO_DESC',
        por_pagina: 100,
        pagina
      };

      const data = await this.executeGet('/leads', queryParams);
      const lista = data.leads || [];
      leadsColetados.push(...lista);

      temProxima = data.tem_proxima === true && lista.length === 100;
      pagina++;
    }

    return { leads: leadsColetados, paginas: paginasParaEstaEtapa };
  }

  /**
   * Camada Gerencial de Entradas (Fase 3.5Q / Duas Camadas):
   * Consulta global complementar ordenada por cadastro decrescente.
   * Captura todos os leads recentes cadastrados no CRM (inclusive inativos, outros pipelines e sem pipeline).
   */
  async fetchGlobalRecentLeads(dataInicio, maxPages = 10) {
    if (this.isSimulated) {
      await new Promise(r => setTimeout(r, 10));
      if (this.mockGlobalProvider) {
        return this.mockGlobalProvider(dataInicio);
      }
      return { leads: [], paginas: 1 };
    }

    let pagina = 1;
    let continuar = true;
    const leadsColetados = [];
    let paginasConsultadas = 0;

    while (continuar && pagina <= maxPages) {
      paginasConsultadas++;
      const queryParams = {
        ordenar: 'CADASTRO_DESC',
        por_pagina: 100,
        pagina
      };

      const data = await this.executeGet('/leads', queryParams);
      const lista = data.leads || (Array.isArray(data) ? data : []);
      if (lista.length === 0) break;

      for (const lead of lista) {
        const dCad = lead.data_cadastro ? lead.data_cadastro.split('T')[0] : '1970-01-01';
        if (dCad < dataInicio) {
          continuar = false;
          break;
        }
        leadsColetados.push(lead);
      }

      if (!continuar || data.tem_proxima !== true || lista.length < 100) {
        break;
      }
      pagina++;
    }

    return { leads: leadsColetados, paginas: paginasConsultadas };
  }

  async runSyncCycle() {
    await this.localStore.load();
    const cycleStartTime = new Date();
    const cycleStartIso = cycleStartTime.toISOString();
    this.localStore.setMonitoredFunis(this.monitoredFunis);
    this.cycleEvents = [];

    const stats = {
      inicio: new Date().toISOString(),
      fim: null,
      totalLeadsAvaliados: 0,
      novosLeadsRegistrados: 0,
      novasParticipacoesFunil: 0,
      mudancasEtapa: 0,
      mudancasResponsavel: 0,
      conflitosEtapa: 0,
      etapasConsultadas: 0,
      paginasConsultadas: 0,
      consultasGlobais: 0,
      novosLeadsGerenciais: 0
    };

    const diffReport = {
      novosLeads: [],
      novasParticipacoes: [],
      mudancasEtapa: [],
      mudancasResponsavel: [],
      etapasNaoConfirmadas: [],
      cardsPreservadosNaoReconfirmados: 0,
      cardsReconfirmados: 0,
      leadsIgnoradosLegados: 0,
      novosLeadsGerenciais: 0,
      totalCardsAntes: 0,
      totalCardsDepois: 0,
      leadsUnicosAntes: 0,
      leadsUnicosDepois: 0
    };

    const initialSnapshots = this.localStore.getAllSnapshots();
    diffReport.leadsUnicosAntes = initialSnapshots.length;
    initialSnapshots.forEach(l => {
      diffReport.totalCardsAntes += Object.keys(l.funis || {}).length;
    });

    const mapaEtapas = this.loadMapaEtapas();
    const dataInicio = this.getDataInicioIsoDate();
    const observacoesCiclo = {};

    for (const funil of this.monitoredFunis) {
      const etapas = await this.fetchEtapasDoFunil(funil.id);
      
      for (const etapa of etapas) {
        stats.etapasConsultadas++;
        const paginatedResult = await this.fetchPaginatedEtapa(funil.id, funil.nome, etapa.id, etapa.nome);
        stats.paginasConsultadas += paginatedResult.paginas;
        const leadsNaEtapa = paginatedResult.leads;
        
        for (const leadApi of leadsNaEtapa) {
          stats.totalLeadsAvaliados++;
          if (!observacoesCiclo[leadApi.id]) {
            observacoesCiclo[leadApi.id] = {
              leadBase: leadApi,
              participacoes: {},
              conflitos: []
            };
          }
          
          if (observacoesCiclo[leadApi.id].participacoes[funil.id]) {
            const etapaAnterior = observacoesCiclo[leadApi.id].participacoes[funil.id].etapa_nome;
            observacoesCiclo[leadApi.id].conflitos.push({
              funil_id: funil.id,
              etapa_conflitante: etapa.nome,
              etapa_mantida: etapaAnterior
            });
            continue;
          }

          observacoesCiclo[leadApi.id].participacoes[funil.id] = {
            funil_id: funil.id,
            funil_nome: funil.nome,
            etapa_id: etapa.id,
            etapa_nome: etapa.nome,
            corretor_id: leadApi.corretor_delegado ? (leadApi.corretor_delegado.id || leadApi.corretor_delegado.id_parceiro || null) : null,
            corretor_nome: leadApi.corretor_delegado ? leadApi.corretor_delegado.nome : null
          };
        }
      }
    }

    const cycleEndIso = new Date().toISOString();
    const observedCards = new Set();

    // 2. Conciliar observações com o banco local
    for (const [leadId, observacao] of Object.entries(observacoesCiclo)) {
      const { leadBase, participacoes } = observacao;
      let snapshot = this.localStore.getLead(leadId);
      const isNewGlobalLead = !snapshot;

      if (isNewGlobalLead) {
        // Regra 3: Novos leads SÓ são incluídos se cadastrados nos últimos 60 dias!
        const dCad = leadBase.data_cadastro ? leadBase.data_cadastro.split('T')[0] : '1970-01-01';
        if (dCad < dataInicio) {
          // Descarte de lead legado antigo que não pertencia à carteira local
          diffReport.leadsIgnoradosLegados++;
          continue;
        }

        stats.novosLeadsRegistrados++;
        const primeiraPartic = Object.values(participacoes)[0] || {};
        snapshot = {
          id: parseInt(leadId, 10),
          nome: leadBase.nome,
          data_cadastro_crm: leadBase.data_cadastro,
          pipeline_origem_crm: leadBase.funil ? leadBase.funil.nome : (primeiraPartic.funil_nome || null),
          etapa_origem_crm: leadBase.etapa ? leadBase.etapa.nome : (primeiraPartic.etapa_nome || null),
          funil_origem_crm_id: leadBase.funil ? leadBase.funil.id : (primeiraPartic.funil_id || null),
          etapa_origem_crm_id: leadBase.etapa ? leadBase.etapa.id : (primeiraPartic.etapa_id || null),
          corretor_crm: leadBase.corretor_delegado ? leadBase.corretor_delegado.nome : (primeiraPartic.corretor_nome || null),
          corretor_crm_id: leadBase.corretor_delegado ? (leadBase.corretor_delegado.id || leadBase.corretor_delegado.id_parceiro || null) : (primeiraPartic.corretor_id || null),
          origem: leadBase.origem || null,
          funis: {}
        };
      } else {
        if (leadBase.origem && !snapshot.origem) {
          snapshot.origem = leadBase.origem;
        }
        if (leadBase.funil && !snapshot.pipeline_origem_crm) {
          snapshot.pipeline_origem_crm = leadBase.funil.nome;
          snapshot.funil_origem_crm_id = leadBase.funil.id;
        }
        if (leadBase.etapa && !snapshot.etapa_origem_crm) {
          snapshot.etapa_origem_crm = leadBase.etapa.nome;
          snapshot.etapa_origem_crm_id = leadBase.etapa.id;
        }
        if (leadBase.corretor_delegado && !snapshot.corretor_crm) {
          snapshot.corretor_crm = leadBase.corretor_delegado.nome;
          snapshot.corretor_crm_id = leadBase.corretor_delegado.id || leadBase.corretor_delegado.id_parceiro || null;
        }
      }

      snapshot.data_ultimo_atendimento = leadBase.data_ultimo_atendimento || null;
      snapshot.dias_sem_atendimento = leadBase.dias_sem_atendimento !== undefined ? leadBase.dias_sem_atendimento : null;

      for (const [funilIdStr, particAtual] of Object.entries(participacoes)) {
        const funilId = parseInt(funilIdStr, 10);
        observedCards.add(`${leadId}_${funilId}`);
        let particAnterior = snapshot.funis[funilId];

        const stageKey = `${funilId}_${particAtual.etapa_id}`;
        const stageValid = mapaEtapas[stageKey];
        const etapaNaoConfirmada = !stageValid;

        if (etapaNaoConfirmada) {
          diffReport.etapasNaoConfirmadas.push({
            lead_id: parseInt(leadId, 10),
            nome: leadBase.nome || snapshot.nome,
            funil_id: funilId,
            funil_nome: particAtual.funil_nome,
            etapa_id_desconhecido: particAtual.etapa_id,
            etapa_mantida: particAnterior ? particAnterior.etapa_nome : 'Etapa atual não confirmada'
          });
        }

        if (!particAnterior) {
          const novaPartic = {
            ...particAtual,
            etapa_nome: etapaNaoConfirmada ? (particAtual.etapa_nome || 'Etapa atual não confirmada') : (stageValid.nome || particAtual.etapa_nome),
            condicao_etapa: etapaNaoConfirmada ? 'nao_confirmada' : 'confirmada',
            reconfirmado_ciclo: true,
            ultima_confirmacao_etapa: cycleEndIso,
            primeira_observacao_em: cycleEndIso,
            ultima_observacao_em: cycleEndIso,
            total_mudancas_observadas: 0
          };
          if (etapaNaoConfirmada) {
            novaPartic.etapa_sugerida_crm_id = particAtual.etapa_id;
          }
          snapshot.funis[funilId] = novaPartic;

          if (isNewGlobalLead) {
            diffReport.novosLeads.push({
              lead_id: parseInt(leadId, 10),
              nome: leadBase.nome,
              funil_id: funilId,
              funil_nome: particAtual.funil_nome,
              etapa_id: particAtual.etapa_id,
              etapa_nome: novaPartic.etapa_nome,
              corretor_nome: particAtual.corretor_nome || 'Sem Corretor'
            });
          } else {
            stats.novasParticipacoesFunil++;
            diffReport.novasParticipacoes.push({
              lead_id: parseInt(leadId, 10),
              nome: snapshot.nome || leadBase.nome,
              funil_id: funilId,
              funil_nome: particAtual.funil_nome,
              etapa_id: particAtual.etapa_id,
              etapa_nome: novaPartic.etapa_nome,
              corretor_nome: particAtual.corretor_nome || 'Sem Corretor'
            });
          }

          this.cycleEvents.push(this.localStore.recordChange({
            lead_id: leadId,
            funil_id: funilId,
            tipo: 'ENTRADA_FUNIL',
            etapa_nome: novaPartic.etapa_nome
          }));
        } else {
          particAnterior.reconfirmado_ciclo = true;
          particAnterior.ultima_observacao_em = cycleEndIso;

          if (!etapaNaoConfirmada) {
            if (particAnterior.etapa_id !== particAtual.etapa_id) {
              stats.mudancasEtapa++;
              diffReport.mudancasEtapa.push({
                lead_id: parseInt(leadId, 10),
                nome: snapshot.nome || leadBase.nome,
                funil_id: funilId,
                funil_nome: particAtual.funil_nome,
                de_etapa: particAnterior.etapa_nome,
                para_etapa: stageValid.nome || particAtual.etapa_nome,
                de_etapa_id: particAnterior.etapa_id,
                para_etapa_id: particAtual.etapa_id
              });
              this.cycleEvents.push(this.localStore.recordChange({
                lead_id: leadId,
                funil_id: funilId,
                tipo: 'MUDANCA_ETAPA',
                de_etapa_nome: particAnterior.etapa_nome,
                para_etapa_nome: stageValid.nome || particAtual.etapa_nome
              }));
              particAnterior.etapa_id = particAtual.etapa_id;
              particAnterior.etapa_nome = stageValid.nome || particAtual.etapa_nome;
              particAnterior.condicao_etapa = 'confirmada';
              particAnterior.ultima_confirmacao_etapa = cycleEndIso;
              particAnterior.total_mudancas_observadas++;
            } else {
              particAnterior.condicao_etapa = 'confirmada';
              particAnterior.ultima_confirmacao_etapa = cycleEndIso;
            }
          } else {
            particAnterior.condicao_etapa = 'nao_confirmada';
            particAnterior.etapa_sugerida_crm_id = particAtual.etapa_id;
          }

          if (particAnterior.corretor_id !== particAtual.corretor_id) {
            stats.mudancasResponsavel++;
            diffReport.mudancasResponsavel.push({
              lead_id: parseInt(leadId, 10),
              nome: snapshot.nome || leadBase.nome,
              funil_id: funilId,
              funil_nome: particAtual.funil_nome,
              de_corretor: particAnterior.corretor_nome || 'Sem Corretor',
              para_corretor: particAtual.corretor_nome || 'Sem Corretor'
            });
            this.cycleEvents.push(this.localStore.recordChange({
              lead_id: leadId,
              funil_id: funilId,
              tipo: 'MUDANCA_RESPONSAVEL',
              de_corretor_nome: particAnterior.corretor_nome,
              para_corretor_nome: particAtual.corretor_nome
            }));
            particAnterior.corretor_id = particAtual.corretor_id;
            particAnterior.corretor_nome = particAtual.corretor_nome;
            particAnterior.total_mudancas_observadas++;
          }
        }
      }

      if (observacao.conflitos && observacao.conflitos.length > 0) {
        snapshot.conflitos_auditoria = observacao.conflitos;
        stats.conflitosEtapa = (stats.conflitosEtapa || 0) + observacao.conflitos.length;
      } else {
        snapshot.conflitos_auditoria = [];
      }

      this.localStore.upsertLead(snapshot);
    }

    // 3. Atualizar marcadores de cards não reconfirmados (preservação estrita)
    for (const lead of Object.values(this.localStore.data.snapshots_leads)) {
      for (const [funilIdStr, partic] of Object.entries(lead.funis || {})) {
        const key = `${lead.id}_${funilIdStr}`;
        if (observedCards.has(key)) {
          diffReport.cardsReconfirmados++;
        } else {
          partic.reconfirmado_ciclo = false;
          diffReport.cardsPreservadosNaoReconfirmados++;
        }
      }
    }

    // Conciliação explícita entre cards preexistentes e novos
    diffReport.cardsPreexistentesReconfirmados = Math.max(0, diffReport.cardsReconfirmados - diffReport.novosLeads.length - diffReport.novasParticipacoes.length);
    diffReport.cardsPreexistentesPreservados = diffReport.cardsPreservadosNaoReconfirmados;

    // 4. Camada Gerencial de Entradas (Fase 3.5Q / Duas Camadas):
    // Consulta global complementar para capturar todos os leads recentes cadastrados no CRM
    // (inclusive inativos de funis monitorados, outros pipelines e sem pipeline).
    const globalResult = await this.fetchGlobalRecentLeads(dataInicio);
    stats.consultasGlobais = globalResult.paginas;
    stats.paginasConsultadas += globalResult.paginas;

    for (const leadApi of globalResult.leads) {
      const leadIdStr = String(leadApi.id);
      let snapshot = this.localStore.getLead(leadIdStr);

      const funilNome = leadApi.funil ? leadApi.funil.nome : 'Sem Pipeline';
      const funilId = leadApi.funil ? leadApi.funil.id : null;
      const etapaNome = leadApi.etapa ? leadApi.etapa.nome : null;
      const etapaId = leadApi.etapa ? leadApi.etapa.id : null;
      const corretorNome = leadApi.corretor_delegado ? leadApi.corretor_delegado.nome : null;
      const corretorId = leadApi.corretor_delegado ? (leadApi.corretor_delegado.id || leadApi.corretor_delegado.id_parceiro || null) : null;

      if (snapshot) {
        // Lead já existente (da carteira comercial ou histórico prévio)
        // Atualiza/enriquece metadados do CRM SEM alterar as participações em funis comerciais!
        if (leadApi.funil) {
          snapshot.pipeline_origem_crm = funilNome;
          snapshot.funil_origem_crm_id = funilId;
        } else if (!snapshot.pipeline_origem_crm) {
          snapshot.pipeline_origem_crm = 'Sem Pipeline';
        }
        if (leadApi.etapa) {
          snapshot.etapa_origem_crm = etapaNome;
          snapshot.etapa_origem_crm_id = etapaId;
        }
        if (corretorNome) {
          snapshot.corretor_crm = corretorNome;
          snapshot.corretor_crm_id = corretorId;
        }
        if (leadApi.origem) {
          snapshot.origem = leadApi.origem;
        }
        if (leadApi.data_ultimo_atendimento) {
          snapshot.data_ultimo_atendimento = leadApi.data_ultimo_atendimento;
        }
        if (leadApi.dias_sem_atendimento !== undefined) {
          snapshot.dias_sem_atendimento = leadApi.dias_sem_atendimento;
        }
        this.localStore.upsertLead(snapshot);
      } else {
        // Novo lead não presente em nenhuma etapa comercial ativa (ex: etapa inativa, outro pipeline ou sem pipeline)
        const novoLeadGerencial = {
          id: parseInt(leadApi.id, 10),
          nome: leadApi.nome,
          origem: leadApi.origem || null,
          data_cadastro_crm: leadApi.data_cadastro,
          data_ultimo_atendimento: leadApi.data_ultimo_atendimento || null,
          dias_sem_atendimento: leadApi.dias_sem_atendimento !== undefined ? leadApi.dias_sem_atendimento : null,
          conflitos_auditoria: [],
          funis: {}, // REGRA DE OURO: funis vazio! NÃO entra na Gestão da Carteira!
          origem_gerencial: true,
          pipeline_origem_crm: funilNome,
          etapa_origem_crm: etapaNome,
          funil_origem_crm_id: funilId,
          etapa_origem_crm_id: etapaId,
          corretor_crm: corretorNome,
          corretor_crm_id: corretorId
        };
        this.localStore.upsertLead(novoLeadGerencial);
        diffReport.novosLeadsGerenciais = (diffReport.novosLeadsGerenciais || 0) + 1;
        stats.novosLeadsGerenciais = (stats.novosLeadsGerenciais || 0) + 1;
      }
    }

    const finalSnapshots = this.localStore.getAllSnapshots();
    diffReport.leadsUnicosDepois = finalSnapshots.length;
    finalSnapshots.forEach(l => {
      diffReport.totalCardsDepois += Object.keys(l.funis || {}).length;
    });

    if (!this.dryRun) {
      await this.localStore.persistAtomic();
    }

    stats.fim = new Date().toISOString();
    stats.consumoRateLimit = this.rateLimiter.getSnapshot();

    return {
      stats,
      diffReport,
      events: this.cycleEvents,
      resumoDashboard: this.localStore.getStats(),
      stagedData: JSON.parse(JSON.stringify(this.localStore.data))
    };
  }
}

module.exports = ImobTotalSyncPrototype;
