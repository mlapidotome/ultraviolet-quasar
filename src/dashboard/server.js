require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const { aggregateMetrics } = require('./aggregator');
const ImobTotalSyncPrototype = require('../sync/imobtotal_sync_prototype');
const { analyzePortfolioBatch } = require('./analysis_engine');
const db = require('./db');

// InicializaÃ§Ã£o segura do banco SQLite e migraÃ§Ã£o idempotente
(async () => {
  await db.initUsers();
  // await db.migrateJsonData();
})();

const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'bali_test_33a.json');
const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'cache_historicos.json');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Segredo da sessÃ£o carregado exclusivamente do ambiente
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

let isSyncing = false;
let isAnalyzing = false;

// SessÃµes de staging para atualizaÃ§Ã£o controlada por usuÃ¡rio (Fase 3.5P / Fase 1 Prod)
const stagingSessions = new Map();

// Helper de verificaÃ§Ã£o de integridade dos arquivos protegidos
const PROTECTED_FILES = [
  path.join(__dirname, '..', '..', 'data', 'cache_historicos.json'),
  path.join(__dirname, '..', '..', 'data', 'telefones_cache.json'),
  path.join(__dirname, '..', '..', 'data', 'bali.sqlite')
];

function getProtectedFilesChecksums() {
  const checksums = {};
  for (const f of PROTECTED_FILES) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f);
      checksums[path.basename(f)] = crypto.createHash('sha256').update(content).digest('hex');
    } else {
      checksums[path.basename(f)] = null;
    }
  }
  return checksums;
}

function verifyChecksumsMatch(before, after) {
  for (const key of Object.keys(before)) {
    // bali.sqlite pode ter alteraÃ§Ãµes normais em modo WAL, mas verificamos existÃªncia
    if (key !== 'bali.sqlite' && before[key] !== after[key]) {
      return { match: false, changedFile: key };
    }
  }
  return { match: true };
}

function getFileChecksum(filePath) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  return null;
}

// Controle de concorrÃªncia de consultas individuais de histÃ³rico
const pendingRequests = new Map();

// Helpers para o Cache de HistÃ³ricos
async function readCache() {
  return await db.getKv('cache_historicos') || {};
}
async function writeCache(data) {
  await db.setKv('cache_historicos', data);
}

// Rate Limiter em memÃ³ria para proteÃ§Ã£o contra abuso / brute-force
const rateLimitMap = new Map();
function checkRateLimit(ip, maxPerMinute = 60) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + 60000 };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + 60000;
  } else {
    record.count++;
  }
  rateLimitMap.set(ip, record);
  return record.count <= maxPerMinute;
}

// Helpers de SessÃ£o e Cookies HTTP
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
      }
    });
  }
  return list;
}

async function getAuthUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.session_token;
  if (!token) return null;
  return await db.getSession(token);
}

const requestHandler = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const clientIp = req.socket.remoteAddress || 'unknown';

  // 1. CabeÃ§alhos BÃ¡sicos de SeguranÃ§a (OWASP)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  const isHttps = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // 2. PolÃ­tica CORS Restritiva (apenas mesma origem)
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
    } catch {}
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 3. Rate Limit Geral por IP
  if (!checkRateLimit(clientIp, 180)) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: "Muitas requisiÃ§Ãµes. Aguarde um minuto." }));
  }

  // --- ROTAS PÃšBLICAS DE AUTENTICAÃ‡ÃƒO ---

  // Tela de Login
  if (parsedUrl.pathname === '/login') {
    const user = await getAuthUser(req);
    if (user) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }
    fs.readFile(path.join(__dirname, 'login.html'), (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end("Erro ao carregar login.html");
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
    return;
  }

  // API de Login
  if (req.method === 'POST' && parsedUrl.pathname === '/api/login') {
    if (!checkRateLimit(clientIp, 15)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: "Muitas tentativas de login. Aguarde um minuto." }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { username, password } = payload;

        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "Informe usuÃ¡rio e senha." }));
        }

        const authenticated = await await db.authenticateUser(username.trim().toLowerCase(), password);
        if (!authenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "UsuÃ¡rio ou senha incorretos." }));
        }

        const session = await await db.createSession(authenticated.id, authenticated.username, authenticated.role, 12);
        const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${isHttps ? '; Secure' : ''}`;

        res.writeHead(200, { 
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `session_token=${session.sessionId}; ${cookieFlags}`
        });
        res.end(JSON.stringify({
          success: true,
          user: {
            username: authenticated.username,
            role: authenticated.role,
            nome: authenticated.nome
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: "Erro interno no processamento do login." }));
      }
    });
    return;
  }

  // API de Logout
  if ((req.method === 'POST' || req.method === 'GET') && (parsedUrl.pathname === '/api/logout' || parsedUrl.pathname === '/logout')) {
    const cookies = parseCookies(req);
    if (cookies.session_token) {
      await await db.deleteSession(cookies.session_token);
    }
    const cookieFlags = `Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isHttps ? '; Secure' : ''}`;

    if (parsedUrl.pathname === '/logout') {
      res.writeHead(302, { 
        'Location': '/login',
        'Set-Cookie': `session_token=; ${cookieFlags}`
      });
      return res.end();
    }
    res.writeHead(200, { 
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `session_token=; ${cookieFlags}`
    });
    return res.end(JSON.stringify({ success: true }));
  }

  // API Me (Verifica sessÃ£o ativa)
  if (req.method === 'GET' && parsedUrl.pathname === '/api/me') {
    const user = await getAuthUser(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ authenticated: false }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      authenticated: true,
      user: {
        username: user.username,
        role: user.role
      }
    }));
  }

  // Arquivos estÃ¡ticos pÃºblicos auxiliares
  if (parsedUrl.pathname === '/xlsx.full.min.js') {
    fs.readFile(path.join(__dirname, 'xlsx.full.min.js'), (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(content);
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  // --- FILTRO GERAL DE AUTENTICAÃ‡ÃƒO OBRIGATÃ“RIA PARA ROTAS PROTEGIDAS ---
  const currentUser = await getAuthUser(req);
  if (!currentUser) {
    if (parsedUrl.pathname === '/' || !parsedUrl.pathname.startsWith('/api/')) {
      res.writeHead(302, { 'Location': '/login' });
      return res.end();
    }
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: "NÃ£o autenticado. FaÃ§a login para acessar os dados." }));
  }

  // --- CONTROLE DE ACESSO POR PERFIL (ADMIN vs GERENTE) ---
  const isAdmin = currentUser.role === 'admin';

  // --- ROTA DE CONSULTA INDIVIDUAL CONTROLADA DE HISTÃ“RICO ---
  if (req.method === 'POST' && parsedUrl.pathname === '/api/real-history-single') {
    if (isSyncing) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: "Servidor ocupado com sincronizaÃ§Ã£o em lote. Tente novamente em instantes." }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const leadId = parseInt(payload.leadId, 10);
        const forceUpdate = payload.forceUpdate === true;
        
        const dbData = (await db.getKv('bali_test_33a') || {});
        const leadExists = Object.values(dbData.snapshots_leads || {}).some(l => l.id === leadId);
        if (!leadExists) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: "Lead nÃ£o encontrado na base ativa do dashboard." }));
        }

        const cache = await readCache();
        const cachedEntry = cache[leadId];

        if (cachedEntry && !forceUpdate) {
          const cacheTime = new Date(cachedEntry.consultado_em).getTime();
          const age = Date.now() - cacheTime;
          if (age < SEVEN_DAYS_MS) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, atividades: cachedEntry.atividades, consultado_em: cachedEntry.consultado_em, isSimulated: false, fromCache: true }));
          } else {
            delete cache[leadId];
            await await writeCache(cache);
            res.writeHead(410, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: "HistÃ³rico nÃ£o disponÃ­vel â€” consultar novamente (Cache expirado de 7 dias)." }));
          }
        }

        if (pendingRequests.has(leadId)) {
          try {
            const atividadesShared = await pendingRequests.get(leadId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, atividades: atividadesShared, consultado_em: cache[leadId].consultado_em, isSimulated: false, fromCache: false, shared: true }));
          } catch (sharedErr) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: sharedErr.message }));
          }
        }

        if (!process.env.IMOBTOTAL_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "ConfiguraÃ§Ã£o ausente: IMOBTOTAL_API_KEY nÃ£o configurada no ambiente." }));
        }

        const fetchPromise = (async () => {
          const imobRes = await fetch(`https://app.imobtotal.com.br/api/v1/leads/${leadId}`, {
            method: 'GET',
            headers: { 
              'Authorization': `Bearer ${process.env.IMOBTOTAL_API_KEY}`, 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          
          if (!imobRes.ok) {
             const errorBody = await imobRes.text().catch(() => '');
             throw new Error(`Erro ImobTotal: Status ${imobRes.status}. Detalhes: ${errorBody.slice(0, 100)}`);
          }
          
          const imobData = await imobRes.json();
          const atividadesLidas = imobData.atividades || imobData.historico || imobData.interacoes || [];

          let comentarios = atividadesLidas.filter(a => {
            const t = (a.tipo || a.tipo_atividade || '').toLowerCase();
            return t.includes('comentario') || t.includes('nota') || t.includes('anotacao') || t.includes('observacao');
          });
          
          if (comentarios.length === 0) comentarios = atividadesLidas.filter(a => a.descricao || a.texto);

          if (comentarios.length === 0 && atividadesLidas.length > 0) {
            return atividadesLidas.map(a => ({
              id: Math.random(),
              tipo: 'Desconhecido',
              descricao: `[DiagnÃ³stico TÃ©cnico: Campos da atividade recebida = ${Object.keys(a).join(', ')}]`,
              data_criacao: new Date().toISOString(),
              usuario_nome: 'DiagnÃ³stico de Sistema'
            }));
          }

          return comentarios.map(a => ({
            id: a.id || Math.random(),
            tipo: a.tipo || a.tipo_atividade || 'Atividade',
            descricao: a.descricao || a.texto || a.observacao || 'Sem texto',
            data_criacao: a.data_criacao || a.data_cadastro || a.created_at || a.data,
            usuario_nome: a.usuario_nome || a.corretor_nome || a.autor || 'Sistema'
          }));
        })();

        pendingRequests.set(leadId, fetchPromise);

        try {
          const atividades = await fetchPromise;
          const updatedCache = await readCache();
          const now = new Date().toISOString();
          updatedCache[leadId] = { consultado_em: now, atividades: atividades, origin: 'real' };
          await await writeCache(updatedCache);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, atividades: atividades, consultado_em: now, isSimulated: false }));
        } catch (apiErr) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Falha de conexÃ£o com ImobTotal: ${apiErr.message}` }));
        } finally {
          pendingRequests.delete(leadId);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- ROTA DE TOGGLE DA PAUTA (MIGRADAS PARA SQLITE WAL COM AUDITORIA) ---
  if (req.method === 'POST' && parsedUrl.pathname === '/api/pauta/toggle') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
         try {
             const payload = JSON.parse(body || '{}');
             const { leadId, funilId, checked } = payload;
             if (!leadId || !funilId) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: "Faltam parÃ¢metros." }));
             }

             const result = await await db.togglePauta(leadId, funilId, checked, currentUser.username);
             res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
             res.end(JSON.stringify(result));
         } catch(err) {
             res.writeHead(500, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: err.message }));
         }
      });
      return;
  }

  // --- ROTA DE TOGGLE EM MASSA DA PAUTA (SQLITE WAL COM TRANSAÃ‡ÃƒO) ---
  if (req.method === 'POST' && parsedUrl.pathname === '/api/pauta/toggle-bulk') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
         try {
             const payload = JSON.parse(body || '{}');
             const { items, checked } = payload;
             if (!items || !Array.isArray(items)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: "Faltam parÃ¢metros." }));
             }

             const result = await await db.toggleBulkPauta(items, checked, currentUser.username);
             res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
             res.end(JSON.stringify(result));
         } catch(err) {
             res.writeHead(500, { 'Content-Type': 'application/json' });
             res.end(JSON.stringify({ error: err.message }));
         }
      });
      return;
  }

  // --- ROTA DE ACOMPANHAMENTO DE REUNIÃ•ES (SQLITE WAL COM HISTÃ“RICO E AUDITORIA) ---
  if (req.method === 'POST' && parsedUrl.pathname === '/api/acompanhamentos') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { leadId, funilId } = payload;
        
        if (!leadId || !funilId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: "Faltam parÃ¢metros de identificaÃ§Ã£o (leadId, funilId)." }));
        }

        const dbData = (await db.getKv('bali_test_33a') || {});
        const lead = Object.values(dbData.snapshots_leads || {}).find(l => l.id === parseInt(leadId, 10));
        
        if (!lead || !lead.funis || !lead.funis[funilId]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: "Card nÃ£o encontrado no snapshot local." }));
        }

        const saved = await await db.saveAcompanhamento(leadId, funilId, payload, currentUser.username);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, saved, na_pauta: saved.na_pauta, status_pauta: saved.status_pauta, alterado_por: currentUser.username }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- ROTAS DE RESUMOS DE REUNIÃ•ES 1:1 (SQLITE WAL) ---
  if (req.method === 'GET' && parsedUrl.pathname === '/api/reunioes/gerar-resumo') {
      const corretor = parsedUrl.query.corretor;
      const dataReuniao = parsedUrl.query.data;
      if (!corretor || !dataReuniao) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: "Faltam parÃ¢metros (corretor, data)." }));
      }

      try {
          const dbData = (await db.getKv('bali_test_33a') || {});
          const reunioes = await await db.getAcompanhamentosMap();

          const TELEFONES_PATH = path.join(__dirname, '..', '..', 'data', 'telefones_cache.json');
          let telefonesCache = {};
          if (fs.existsSync(TELEFONES_PATH)) {
              try { telefonesCache = (await db.getKv('telefones_cache') || {}); } catch(e){}
          }

          function formatarTelefone(tel) {
              if (!tel) return 'Telefone nÃ£o cadastrado';
              const str = String(tel).trim();
              if (!str) return 'Telefone nÃ£o cadastrado';
              if (str.includes('(') && str.includes(')')) return str;
              const digits = str.replace(/\D/g, '');
              if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
              if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
              if (digits.length === 13 && digits.startsWith('55')) return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
              if (digits.length > 0) return str;
              return 'Telefone nÃ£o cadastrado';
          }

          const leadsRaw = Object.values(dbData.snapshots_leads || {});
          const cardsMap = {};
          leadsRaw.forEach(l => {
              const rawTel = telefonesCache[String(l.id)] || telefonesCache[l.id] || l.telefone_1 || l.telefone;
              const telFmt = formatarTelefone(rawTel);

              Object.keys(l.funis || {}).forEach(fId => {
                  const p = l.funis[fId];
                  cardsMap[`${l.id}_${fId}`] = {
                      lead_id: l.id,
                      lead_nome: l.nome || `Lead #${l.id}`,
                      telefone: telFmt,
                      funil_id: parseInt(fId, 10),
                      funil_nome: p.funil_nome || `Funil ${fId}`,
                      corretor_nome: p.corretor_nome || 'SEM CORRETOR'
                  };
              });
          });

          const cardsFiltrados = [];
          Object.keys(reunioes).forEach(key => {
              const info = cardsMap[key];
              if (!info || info.corretor_nome !== corretor) return;

              const entry = reunioes[key];
              let registroMaisRecente = null;

              if (entry.atual && (entry.atual.data_reuniao === dataReuniao || (entry.atual.salvo_em && entry.atual.salvo_em.startsWith(dataReuniao)))) {
                  registroMaisRecente = entry.atual;
              } else if (Array.isArray(entry.historico)) {
                  for (let i = entry.historico.length - 1; i >= 0; i--) {
                      if (entry.historico[i].data_reuniao === dataReuniao || (entry.historico[i].salvo_em && entry.historico[i].salvo_em.startsWith(dataReuniao))) {
                          registroMaisRecente = entry.historico[i];
                          break;
                      }
                  }
              }

              if (registroMaisRecente) {
                  const hasAcao = registroMaisRecente.proxima_acao && registroMaisRecente.proxima_acao.trim() !== '' && registroMaisRecente.proxima_acao !== 'NÃ£o informado';
                  const isNaPauta = entry.na_pauta === 1 || entry.na_pauta === true;
                  if (!hasAcao && !isNaPauta) return;

                  let prazoFmt = 'NÃ£o informado';
                  if (registroMaisRecente.previsao) {
                      const parts = registroMaisRecente.previsao.split('-');
                      if (parts.length === 3) prazoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
                      else prazoFmt = registroMaisRecente.previsao;
                  }

                  cardsFiltrados.push({
                      lead_id: info.lead_id,
                      funil_id: info.funil_id,
                      lead_nome: info.lead_nome,
                      funil_nome: info.funil_nome,
                      telefone: info.telefone,
                      proxima_acao: registroMaisRecente.proxima_acao || 'NÃ£o informado',
                      prazo: prazoFmt,
                      situacao: registroMaisRecente.situacao || 'NÃ£o informado',
                      resumo: registroMaisRecente.resumo || ''
                  });
              }
          });

          cardsFiltrados.sort((a, b) => (a.lead_nome || '').localeCompare(b.lead_nome || ''));

          let dataFmt = dataReuniao;
          const dParts = dataReuniao.split('-');
          if (dParts.length === 3) dataFmt = `${dParts[2]}/${dParts[1]}/${dParts[0]}`;

          let texto = '';
          if (cardsFiltrados.length === 0) {
              texto = `Nenhum acompanhamento registrado para este corretor nesta data.`;
          } else {
              const header = `ðŸ“‹ *Alinhamento Semanal â€” Bali ImÃ³veis*\nðŸ‘¤ *Corretor:* ${corretor}\nðŸ“… *Data da ReuniÃ£o:* ${dataFmt}\n--------------------------------------------------`;
              const itens = cardsFiltrados.map(c => `Nome: ${c.lead_nome}\nTelefone: ${c.telefone}\nCÃ³digo CRM: ${c.lead_id}\nPrÃ³xima aÃ§Ã£o: ${c.proxima_acao}\nPrazo: ${c.prazo}`).join('\n\n');
              const footer = `--------------------------------------------------\nðŸ“Œ *Total de clientes alinhados:* ${cardsFiltrados.length}`;
              texto = `${header}\n\n${itens}\n\n${footer}`;
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
              success: true,
              corretor,
              data_reuniao: dataReuniao,
              data_formatada: dataFmt,
              total_cards: cardsFiltrados.length,
              cards: cardsFiltrados,
              texto
          }));
      } catch(err) {
          console.error(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
      }
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/reunioes/resumos') {
     const corretor = parsedUrl.query.corretor;
     const data = parsedUrl.query.data;
     const resumos = await await db.getResumosMap(corretor, data);
     res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
     return res.end(JSON.stringify(resumos));
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/reunioes/resumos') {
     let body = '';
     req.on('data', chunk => { body += chunk.toString(); });
     req.on('end', async () => {
        try {
           const payload = JSON.parse(body || '{}');
           const { corretor, data_reuniao, texto_resumo, overwrite } = payload;
           if (!corretor || !data_reuniao) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: "Faltam parÃ¢metros (corretor, data_reuniao)." }));
           }

           const result = await await db.saveResumo(corretor, data_reuniao, texto_resumo, overwrite, currentUser.username);
           if (result.exists) {
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify(result));
           }

           res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
           return res.end(JSON.stringify(result));
        } catch(err) {
           res.writeHead(500, { 'Content-Type': 'application/json' });
           return res.end(JSON.stringify({ error: err.message }));
        }
     });
     return;
  }

  // --- ROTAS DE ATUALIZAÃ‡ÃƒO CONTROLADA DO CRM (EXCLUSIVAS DO ADMIN) ---
  if (parsedUrl.pathname === '/api/sync/preview' || parsedUrl.pathname === '/api/sync/apply') {
    if (!isAdmin) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: "Acesso negado. A sincronizaÃ§Ã£o com o CRM Ã© restrita ao perfil de Administrador." }));
    }
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/sync/preview') {
    if (isSyncing) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: "Servidor ocupado. Outra consulta jÃ¡ estÃ¡ em andamento. Aguarde." }));
    }

    if (!process.env.IMOBTOTAL_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: "ConfiguraÃ§Ã£o ausente: IMOBTOTAL_API_KEY nÃ£o configurada no ambiente." }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      isSyncing = true;
      try {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch(e) {}
        const isSimulated = payload.isSimulated !== false;

        const syncOptions = {
          dbFilePath: DATA_PATH,
          janelaDias: 60,
          dryRun: true,
          isSimulated: isSimulated,
          apiKey: process.env.IMOBTOTAL_API_KEY,
          monitoredFunis: [ 
            { id: 3500, nome: 'LanÃ§amentos' }, 
            { id: 5308, nome: 'MCMV' },
            { id: 5297, nome: 'MAP' },
            { id: 3515, nome: 'Terceiros' }
          ]
        };

        const syncEngine = new ImobTotalSyncPrototype(syncOptions);
        const syncResult = await syncEngine.runSyncCycle();

        const baseDbData = await db.getKv('bali_test_33a');
        const baseDbChecksum = crypto.createHash('sha256').update(JSON.stringify(baseDbData || {})).digest('hex');
        const sessionId = 'staging_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        
        // Isolamento de sessÃ£o por usuÃ¡rio: apenas o ADMIN que gerou pode aplicar!
        stagingSessions.set(sessionId, {
          id: sessionId,
          createdByUserId: currentUser.user_id,
          createdByUsername: currentUser.username,
          createdAt: Date.now(),
          complete: true,
          baseDbChecksum,
          diffReport: syncResult.diffReport,
          stats: syncResult.stats,
          stagedData: syncResult.stagedData,
          isSimulated
        });

        // Limpeza de sessÃµes antigas (> 15 min)
        const now = Date.now();
        for (const [sId, sess] of stagingSessions.entries()) {
          if (now - sess.createdAt > 15 * 60 * 1000) stagingSessions.delete(sId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          sessionId,
          diffReport: syncResult.diffReport,
          stats: syncResult.stats,
          isSimulated,
          complete: true
        }));
      } catch (err) {
        console.error("Sync Preview Error:", err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, complete: false, error: "Falha na consulta prÃ©via: " + err.message }));
      } finally {
        isSyncing = false;
      }
    });
    return;
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/sync/apply') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch(e) {}
        const { sessionId } = payload;

        if (!sessionId || !stagingSessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "Esta prÃ©via expirou. FaÃ§a uma nova consulta antes de atualizar o painel." }));
        }

        const session = stagingSessions.get(sessionId);

        // Bloqueio de isolamento: usuÃ¡rio sÃ³ pode aplicar a sessÃ£o que ele mesmo gerou
        if (session.createdByUserId !== currentUser.user_id) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "Acesso negado: esta prÃ©via pertence a outro usuÃ¡rio." }));
        }

        // Bloqueio 1: ExpiraÃ§Ã£o por TTL (15 minutos)
        const now = Date.now();
        if (now - session.createdAt > 15 * 60 * 1000) {
          stagingSessions.delete(sessionId);
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "Esta prÃ©via expirou. FaÃ§a uma nova consulta antes de atualizar o painel." }));
        }

        // Bloqueio 2: Consulta incompleta
        if (!session.complete || !session.stagedData) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "A consulta anterior foi incompleta. A aplicaÃ§Ã£o permanece bloqueada." }));
        }

        // Bloqueio 3: O snapshot mudou desde o inÃ­cio da prÃ©via
        const currentDbData = await db.getKv('bali_test_33a');
        const currentDbChecksum = crypto.createHash('sha256').update(JSON.stringify(currentDbData || {})).digest('hex');
        if (session.baseDbChecksum && currentDbChecksum !== session.baseDbChecksum) {
          res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: "O snapshot da carteira foi modificado apÃ³s o inÃ­cio da consulta prÃ©via. AplicaÃ§Ã£o bloqueada." }));
        }

        const beforeChecksums = getProtectedFilesChecksums();

        // Backup com Timestamp
        const nowIso = new Date();
        const yyyy = nowIso.getFullYear();
        const mm = String(nowIso.getMonth() + 1).padStart(2, '0');
        const dd = String(nowIso.getDate()).padStart(2, '0');
        const hh = String(nowIso.getHours()).padStart(2, '0');
        const min = String(nowIso.getMinutes()).padStart(2, '0');
        const ss = String(nowIso.getSeconds()).padStart(2, '0');
        const tsStr = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;

        const backupPrefix = session.isSimulated ? 'bali_test_33a_backup_SIMULADO_' : 'bali_test_33a_backup_';
        const os = require('os');
        const backupPath = path.join(os.tmpdir(), `${backupPrefix}${tsStr}.json`);

        const currentData = await db.getKv('bali_test_33a');
        if (currentData) {
          fs.writeFileSync(backupPath, JSON.stringify(currentData, null, 2));
        }

        if (session.isSimulated) {
          const simStagingPath = path.join(__dirname, '..', '..', 'data', 'bali_test_33a_staging_applied.json');
          await db.setKv('bali_test_33a_staging_applied', session.stagedData);
        } else {
          session.stagedData.ultima_atualizacao = new Date().toISOString();
          await db.setKv('bali_test_33a', session.stagedData);
        }

        const afterChecksums = getProtectedFilesChecksums();
        const integrityCheck = verifyChecksumsMatch(beforeChecksums, afterChecksums);

        if (!integrityCheck.match) {
          console.error(`ðŸš¨ [Integrity Alert] O arquivo protegido ${integrityCheck.changedFile} foi modificado indevidamente!`);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ 
            error: `ViolaÃ§Ã£o de integridade detectada: ${integrityCheck.changedFile} foi alterado.`,
            integrityFailed: true 
          }));
        }

        stagingSessions.delete(sessionId);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          message: session.isSimulated 
            ? "AtualizaÃ§Ã£o simulada aplicada com sucesso em ambiente de teste."
            : "AtualizaÃ§Ã£o definitiva aplicada com sucesso no snapshot da carteira.",
          backupFile: path.basename(backupPath),
          isSimulated: session.isSimulated,
          integrityVerified: true,
          diffReport: session.diffReport,
          baseAtualizadaEm: new Date().toISOString()
        }));
      } catch (err) {
        console.error("Sync Apply Error:", err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: "Falha na aplicaÃ§Ã£o definitiva: " + err.message }));
      }
    });
    return;
  }

  // Bloqueio de rota direta antiga
  if (req.method === 'POST' && parsedUrl.pathname === '/api/sync') {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ 
      error: "Acesso bloqueado: utilize o fluxo controlado /api/sync/preview e /api/sync/apply." 
    }));
  }

  // Telefones
  if (req.method === 'GET' && parsedUrl.pathname === '/api/phones') {
      const TELEFONES_PATH = path.join(__dirname, '..', '..', 'data', 'telefones_cache.json');
      let telefones = {};
      if (fs.existsSync(TELEFONES_PATH)) {
          try { telefones = (await db.getKv('telefones_cache') || {}); } catch(e){}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(telefones));
  }

  // SincronizaÃ§Ã£o de telefones (Exclusiva do Admin)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/phones/sync-page') {
      if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: "Acesso restrito ao perfil de Administrador." }));
      }

      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
          try {
              const { funil_id, pagina } = JSON.parse(body || '{}');
              const ImobTotalApiClient = require('../../imobtotal_api_client');
              const client = new ImobTotalApiClient();
              
              const apiRes = await client.getLeads({ funil_id, pagina, por_pagina: 100 });
              const leadsRetornados = apiRes.leads || [];
              
              const dbData = (await db.getKv('bali_test_33a') || {});
              const validLeadIds = new Set(Object.values(dbData.snapshots_leads || {}).map(l => l.id));
              
              const TELEFONES_PATH = path.join(__dirname, '..', '..', 'data', 'telefones_cache.json');
              let telefones = {};
              if (fs.existsSync(TELEFONES_PATH)) {
                  try { telefones = (await db.getKv('telefones_cache') || {}); } catch(e){}
              }
              
              let salvos_nesta_pagina = 0;
              leadsRetornados.forEach(l => {
                  if (validLeadIds.has(l.id) && l.telefone_1) {
                      if (!telefones[l.id]) salvos_nesta_pagina++;
                      telefones[l.id] = l.telefone_1;
                  }
              });
              
              await db.setKv('telefones_cache', telefones);
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ 
                  success: true, 
                  total_paginas: apiRes.total_paginas,
                  salvos_nesta_pagina
              }));
          } catch (err) {
              console.error(err);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: err.message }));
          }
      });
      return;
  }

  // MÃ©tricas do Dashboard (AcessÃ­vel a Admin e Gerente)
  if (parsedUrl.pathname === '/api/metrics') {
    try {
      const filtros = {
        inicio: parsedUrl.query.inicio || null,
        fim: parsedUrl.query.fim || null,
        funil: parsedUrl.query.funil || null,
        etapa: parsedUrl.query.etapa || null,
        corretor: parsedUrl.query.corretor || null,
        faixa_atendimento: parsedUrl.query.faixa_atendimento || null
      };
      
      const dbData = await db.getKv('bali_test_33a') || {};
      const result = aggregateMetrics(dbData, filtros);
      result.acompanhamentos = await db.getAcompanhamentosMap();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Dashboard HTML Principal (Apenas usuÃ¡rios autenticados)
  if (parsedUrl.pathname === '/') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end(`Erro ao carregar index.html`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
};
module.exports = requestHandler;
if (!process.env.VERCEL) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => { console.log('Running '+PORT); });
}