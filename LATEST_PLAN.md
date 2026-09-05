# Proposta Arquitetural & Plano de Implementação — Fase 2A (Revisado)
## Painel Web Mínimo de Criação e Visualização de Job

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2A (Primeira Interface Visual Independente de WhatsApp)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Prover uma interface visual leve, moderna e responsiva (`video-painel.html`), permitindo que Marcel digite o código de um imóvel, crie o Job e visualize instantaneamente os dados do imóvel, simulação financeira e os 3 ganchos + corpo, **sem utilizar o WhatsApp, sem expor a chave de API externa e com barreira server-side de autenticação HTTP Basic Auth**.

---

## 1. Diagnóstico da Arquitetura do Frontend Existente

Uma inspeção no servidor `/var/www/bali-gestor/` e na infraestrutura Nginx revelou:

1. **Padrão dos Cockpits Atuais (`/gestor`, `/leads`, `/imoveis`):**
   - São páginas HTML5 autocontidas com CSS moderno (Dark Mode com paleta `#0B0F19`, `#111827`, `#3B82F6`, tipografia *Plus Jakarta Sans*).
   - Utilizam JavaScript Vanilla puro com `fetch()` assíncrono para endpoints locais.
   - Servidas diretamente pelo Express através de `res.sendFile(path.join(__dirname, 'nome-da-pagina.html'))`.
   - **Zero frameworks pesados (React, Vue, Angular)**: Não exigem etapa de build (`npm build` ou `webpack`), tornando os arquivos leves, estáveis e de manutenção trivial.

2. **Exposição de Rede & Nginx:**
   - Nginx atua como proxy reverso padrão escutando na porta 80 e encaminhando tudo para `http://127.0.0.1:3005`.
   - Atualmente não há `.htpasswd` global configurado no Nginx.
   - Como qualquer usuário que acesse o domínio público da VPS poderia visualizar páginas desprotegidas, **é indispensável uma barreira de autenticação server-side** para o novo painel e seu endpoint BFF.

---

## 2. Arquitetura de Segurança: HTTP Basic Auth Server-Side + BFF Isolado

Para atender com precisão aos requisitos de segurança:
1. **`Origin` e `Referer` NÃO são tratados como autenticação principal**, atuando apenas como camada secundária de defesa em profundidade (CSRF defense-in-depth).
2. **Barreira Server-Side de Autenticação Primária: HTTP Basic Auth nativo:**
   - Protege tanto a rota da interface (`GET /video-painel`) quanto o endpoint BFF (`POST /api/v2/panel/video-jobs`).
   - Credenciais configuradas exclusivamente no `.env` do servidor: `PANEL_USER` e `PANEL_PASSWORD`.
   - Quando o usuário acessa `/video-painel` sem credenciais, o servidor responde `HTTP 401 Unauthorized` com cabeçalho `WWW-Authenticate: Basic realm="Video Engine V2 Painel"`.
   - O navegador exibe nativamente a caixa de diálogo do sistema operacional solicitando Usuário e Senha.
   - Após validação, o próprio navegador gerencia o envio transparente do header `Authorization: Basic ...` nas requisições subsequentes (inclusive nas chamadas `fetch('/api/v2/panel/video-jobs')`).
3. **Credenciais e Secrets 100% Fora do Browser:**
   - **ZERO credenciais no HTML.**
   - **ZERO credenciais no JavaScript.**
   - **ZERO credenciais em `localStorage` ou `sessionStorage`.**
   - A chave mestra `VIDEO_ENGINE_API_KEY` permanece **100% no servidor** e nunca transita no navegador.
4. **Isolamento de Contratos:**
   - A rota externa `POST /api/v2/video-jobs` (homologada na Fase 1D) permanece totalmente independente, protegida exclusivamente por `Authorization: Bearer <VIDEO_ENGINE_API_KEY>`.
   - O endpoint BFF `POST /api/v2/panel/video-jobs` atende o painel sob proteção do HTTP Basic Auth, injetando no backend `broker_id = 'marcel'` e `source = 'web_panel'`.
   - Sem necessidade de criar banco de usuários ou sistema complexo de sessões nesta fase.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NAVEGADOR DO USUÁRIO                             │
│                                                                             │
│  1. Marcel acessa: GET /video-painel                                        │
│     → Servidor responde 401 (WWW-Authenticate: Basic realm="...")           │
│     → Navegador exibe popup nativo de Usuário e Senha                       │
│     → Marcel digita credenciais                                             │
│     → Servidor valida e entrega video-painel.html                           │
│                                                                             │
│  2. Marcel digita "#1639" e clica em "Buscar / Criar Job"                   │
│     → fetch('/api/v2/panel/video-jobs', { body: { property_ref: "1639" } }) │
│     → Navegador anexa automaticamente Authorization: Basic <credentials>    │
│     ⚠️ ZERO TOKENS OU API KEYS NO JS/HTML/STORAGE                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP POST (Basic Auth + JSON)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BACKEND (video_engine/api_v2.js)                        │
│                                                                             │
│  Middleware de Proteção: basicAuthMiddleware                                │
│  1. Valida Authorization: Basic contra PANEL_USER e PANEL_PASSWORD (.env)   │
│  2. Se inválido/ausente: 401 Unauthorized                                   │
│  3. Se válido:                                                              │
│     Injeta internamente no servidor:                                        │
│       broker_id = 'marcel'                                                  │
│       source = 'web_panel'                                                  │
│     Invoca diretamente o Job Core: initializeVideoJob(...)                  │
│  4. Retorna resposta JSON padronizada (201 / 400 / 404 / 503 / 500)         │
│  🔒 Chave VIDEO_ENGINE_API_KEY permanece 100% restrita ao servidor          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    video_engine/job_service.js (Job Core)                   │
│                                                                             │
│  • fetchImovelData(ref)                                                     │
│  • generateCompleteScripts(imovel)                                          │
│  • createVideoJob({ property_ref, broker_id: "marcel", source: "web_panel"}) │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Wireframe Textual da Interface (`video-painel.html`)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🏢 BALI IMÓVEIS  |  🎬 Video Engine V2 — Painel Web de Jobs                  │
│ [Status: 🟢 Core Ativo]                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔍 Iniciar Novo Job de Vídeo                                               │
│  Digite a referência do imóvel para consultar no CRM e gerar os roteiros.   │
│                                                                             │
│  ┌───────────────────────────────────────────────┐  ┌─────────────────────┐ │
│  │ Código ou Ref do Imóvel (ex: 1639)            │  │ 🚀 Buscar e Criar   │ │
│  └───────────────────────────────────────────────┘  └─────────────────────┘ │
│                                                                             │
│  [⏳ Carregando dados do CRM e gerando roteiros inteligentes...]            │
│  [⚠️ Alertas de erro renderizados dinamicamente (400, 404, 503, 500)]       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📋 DETALHES DO JOB GERADO                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 🏷️ Job ID: 20e570ee-dadc-438a-9d7f-491807ffa1cb  [📋 Copiar UUID]       │ │
│  │ 🟢 Status: SCRIPT_READY  |  🌐 Origem: web_panel  |  👤 Corretor: marcel│ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  🏠 RESUMO DO IMÓVEL (CRM)                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Apartamento com 2 quartos à venda, 75 m² - Centro - Taubaté/SP         │ │
│  │ Ref: #1639  |  Local: Centro  |  Área: 75 m²  |  Quartos: 2            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  💰 SIMULAÇÃO FINANCEIRA                                                    │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐ │
│  │ Valor Venda  │ Entrada Est. │ Financiamento│ Parcela Est. │ Renda Mín. │ │
│  │ R$ 395.000   │ R$ 79.000    │ R$ 316.000   │ R$ 2.844/mês │ R$ 9.385   │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴────────────┘ │
│                                                                             │
│  🎙️ ROTEIROS DE ANÚNCIO (3 GANCHOS + CORPO)                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 💡 GANCHO 1 — Choque / Entrada (Look: Terno Executivo 👔)              │ │
│  │ "395 mil num imóvel completo no Diana com entrada de apenas 79 mil?..."│ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ 🔥 GANCHO 2 — Aluguel vs Parcela (Look: Podcaster no Microfone 🎙️)     │ │
│  │ "Parcela de 2.844 reais num imóvel de 2 quartos todinho seu?..."       │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ 🌿 GANCHO 3 — Renda Familiar / Oportunidade (Look: Casual 🌿)          │ │
│  │ "Com uma renda familiar a partir de 9.385 reais e 79 mil de entrada..."│ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ 📖 DESENVOLVIMENTO DO IMÓVEL & BAIRRO (Corpo com CTA)                  │ │
│  │ "Estamos falando de uma oportunidade com 75 metros quadrados..."       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Contratos entre Browser e Backend

### 1. Rota de Interface: `GET /video-painel`
- **Proteção:** Requer HTTP Basic Auth (`PANEL_USER` / `PANEL_PASSWORD`).
- **Sem Autenticação:** Retorna `HTTP 401 Unauthorized` com `WWW-Authenticate: Basic realm="Video Engine V2 Painel"`.
- **Autenticado:** Retorna o conteúdo de `video-painel.html`.

### 2. Endpoint BFF: `POST /api/v2/panel/video-jobs`
- **Proteção:** Requer HTTP Basic Auth (`PANEL_USER` / `PANEL_PASSWORD`).
- **Headers:** `Content-Type: application/json`.
- **Body:**
  ```json
  {
    "property_ref": "1639"
  }
  ```

#### Mapeamento de Respostas na Interface:
* **HTTP 201 Created (Sucesso Total):**  
  Card verde de sucesso; preenche resumo do imóvel, simulação financeira, 3 ganchos, corpo e exibe o UUID do Job com status `SCRIPT_READY`.
* **HTTP 401 Unauthorized (Não Autenticado / Credenciais Inválidas):**  
  Navegador reapresenta solicitação de credenciais ou exibe *"Acesso não autorizado ao painel."*
* **HTTP 404 Not Found (Imóvel Não Encontrado):**  
  Card de alerta vermelho: *"Imóvel não encontrado no CRM para a referência informada."*
* **HTTP 400 Bad Request (Parâmetro Inválido):**  
  Card de alerta âmbar: *"Por favor, informe uma referência de imóvel válida."*
* **HTTP 503 Service Unavailable (Modo Degradado / PostgreSQL Offline):**  
  Badge amarelo de alerta: **"Roteiros gerados com sucesso, mas persistência em banco indisponível no momento."**  
  *(Ajuste de linguagem: NÃO utilizar "persistência pendente", pois não existe fila nem retry automático nesta fase).* Exibe os roteiros e dados normalmente, com campo de Job ID indicando *"Persistência indisponível"*.
* **HTTP 500 Internal Error (Falha Inesperada):**  
  Card de erro: *"Erro interno ao processar solicitação. Tente novamente em instantes."*

#### Prevenção de Ações Concorrentes (Client-Side):
- Enquanto uma requisição estiver em processamento:
  - O botão "Buscar e Criar" fica `disabled`;
  - O texto do botão altera para *"⏳ Processando no CRM..."*;
  - Um spinner de carregamento é ativado;
  - O campo de input é bloqueado temporariamente para evitar duplo clique ou chamadas paralelas acidentais.

---

## 5. Arquivos a Criar e Modificar

1. **`video_engine/panel_auth.js` [NOVO]:**
   - Middleware leve de autenticação HTTP Basic Auth:
     ```javascript
     function panelAuthMiddleware(req, res, next) {
       const authHeader = req.headers['authorization'] || '';
       if (!authHeader.startsWith('Basic ')) {
         res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
         return res.status(401).json({ error: 'UNAUTHORIZED_PANEL_ACCESS' });
       }
       const [user, pass] = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8').split(':');
       const expectedUser = process.env.PANEL_USER || 'admin';
       const expectedPass = process.env.PANEL_PASSWORD;
       if (!expectedPass || user !== expectedUser || pass !== expectedPass) {
         res.setHeader('WWW-Authenticate', 'Basic realm="Video Engine V2 Painel"');
         return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
       }
       next();
     }
     ```

2. **`video-painel.html` [NOVO]:**
   - Página HTML5 autocontida com CSS Dark Mode padronizado (Plus Jakarta Sans).
   - JavaScript puro manipulando DOM e disparando `fetch('/api/v2/panel/video-jobs')`.
   - **Zero chaves ou senhas no código-fonte.**

3. **`video_engine/api_v2.js` [MODIFICAR]:**
   - Adicionar o endpoint BFF protegido pelo middleware:
     ```javascript
     router.post('/panel/video-jobs', panelAuthMiddleware, async (req, res) => {
       // extrai property_ref
       // chama jobService.initializeVideoJob({ property_ref, broker_id: 'marcel', source: 'web_panel' })
       // mapeia 201, 400, 404, 503, 500
     });
     ```

4. **`gestor_server.js` [MODIFICAR]:**
   - Proteger e servir a página:
     ```javascript
     app.get('/video-painel', panelAuthMiddleware, (req, res) => {
       res.sendFile(path.join(__dirname, 'video-painel.html'));
     });
     ```

5. **`.env` [CONFIGURAR NA VPS]:**
   - Adicionar variáveis:
     `PANEL_USER=admin`  
     `PANEL_PASSWORD=<senha_forte_gerada_no_env>`  
   - *(Valores mantidos exclusivamente no `.env`, nunca versionados no Git).*

---

## 6. O Que Permanece Rigorosamente Intocado

* ❌ **Sem geração/renderização de vídeo pelo painel**: HeyGen, FFmpeg e R2 não são chamados pelo painel nesta fase.
* ❌ **Sem biblioteca/histórico de vídeos**: Apenas o Job recém-criado é exibido.
* ❌ **Fluxo WhatsApp V1 100% Intacto**: Sessões ativas (`activeVideoSessions`), áudios 1 a 4, `CLONE` e `OK` permanecem inalterados.
* ❌ **API Externa da Fase 1D Intacta**: `POST /api/v2/video-jobs` continua protegida estritamente por `Authorization: Bearer <VIDEO_ENGINE_API_KEY>`.
* ❌ **Regras de Negócio no Core**: O frontend apenas renderiza o retorno de `job_service.js`; nenhuma lógica de domínio é duplicada.

---

## 7. Plano de Testes e Homologação da Fase 2A

A homologação da Fase 2A executará a seguinte bateria estrita de testes:

1. **Acesso ao Painel sem Autenticação (Negativa):**
   - Requisição `GET /video-painel` sem cabeçalhos de autenticação.
   - Deve retornar `HTTP 401 Unauthorized` com `WWW-Authenticate: Basic realm="Video Engine V2 Painel"`.
2. **Chamada Direta ao Endpoint BFF sem Autenticação (Negativa):**
   - Requisição `POST /api/v2/panel/video-jobs` com `{ "property_ref": "1639" }` sem autenticação.
   - Deve retornar `HTTP 401 Unauthorized`.
3. **Acesso Autenticado ao Painel (Positiva):**
   - Requisição `GET /video-painel` com credenciais válidas (`PANEL_USER` / `PANEL_PASSWORD`).
   - Deve retornar `HTTP 200 OK` e entregar o HTML da interface.
4. **Auditoria de Código Entregue ao Navegador (Segurança):**
   - Inspecionar o HTML e scripts entregues ao navegador.
   - Comprovar ausência absoluta de `PANEL_PASSWORD`, `VIDEO_ENGINE_API_KEY`, tokens ou secrets.
5. **Criação Nominal de Job pelo Painel (`#1639`):**
   - Submissão autenticada de `POST /api/v2/panel/video-jobs` com `{ "property_ref": "1639" }`.
   - Deve retornar `HTTP 201 Created` contendo dados do imóvel, simulação financeira, 3 ganchos, corpo e `job.id`.
6. **Conferência no PostgreSQL:**
   - Consultar tabela `video_jobs` para comprovar persistência com `source = 'web_panel'`, `broker_id = 'marcel'` e snapshots JSONB íntegros.
7. **Prevenção de Duplo Clique e Concorrência:**
   - Validar bloqueio do botão (`disabled`) e estado de loading durante processamento.
8. **Imóvel Inexistente (`#99999999`):**
   - Submeter referência inexistente.
   - Deve retornar `HTTP 404 Not Found` e renderizar alerta de imóvel não encontrado.
9. **Referência Inválida ou Vazia:**
   - Submeter payload vazio.
   - Deve retornar `HTTP 400 Bad Request`.
10. **Modo Degradado / PostgreSQL Offline (HTTP 503):**
    - Parar temporariamente o PostgreSQL (`systemctl stop postgresql@16-main`).
    - Disparar requisição pelo painel com `#1639`.
    - Deve retornar `HTTP 503 Service Unavailable` com corpo contendo imóvel e roteiros gerados, e `job: null`.
    - Painel deve exibir os roteiros com o alerta exato: *"Roteiros gerados com sucesso, mas persistência em banco indisponível no momento."*
    - Restaurar PostgreSQL para `active`.
11. **Não-Regressão de WhatsApp e API Externa:**
    - Validar que o fluxo WhatsApp V1 e o endpoint `POST /api/v2/video-jobs` (Bearer) continuam operando normalmente.
12. **Saúde de Produção:**
    - PM2 `bali-gestor` online e PostgreSQL active.

---

## 8. Limites Explícitos da Fase 2A

* O painel NÃO renderiza vídeos nesta fase (apenas cria o Job e visualiza dados e roteiros).
* Sem gestão multiusuário ou controle de permissões por perfil.
* Toda mutação de estado de vídeo fica reservada para as fases subsequentes.
