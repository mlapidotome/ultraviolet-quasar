# Proposta Arquitetural & Plano de Implementação — Fase 2A: Painel Web Mínimo de Criação e Visualização de Job

**Projeto:** Video Engine V2 — Bali Imóveis  
**Fase:** 2A (Primeira Interface Visual Independente de WhatsApp)  
**Status do Documento:** AGUARDANDO REVISÃO E APROVAÇÃO  
**Objetivo Estratégico:** Prover uma interface visual leve, moderna e responsiva (`video-painel.html`), permitindo que Marcel digite o código de um imóvel, crie o Job e visualize instantaneamente os dados do imóvel, simulação financeira e os 3 ganchos + corpo, **sem utilizar o WhatsApp e sem expor a chave de API secreta no navegador**.

---

## 1. Diagnóstico da Arquitetura do Frontend Existente

Uma inspeção detalhada no servidor `/var/www/bali-gestor/` revelou:

1. **Padrão dos Cockpits Atuais (`/gestor`, `/leads`, `/imoveis`, `/compradores`):**
   - São páginas HTML5 autocontidas com CSS moderno (Dark Mode com paleta `#0B0F19`, `#111827`, `#3B82F6`, tipografia *Plus Jakarta Sans*).
   - Utilizam JavaScript Vanilla puro com `fetch()` assíncrono para endpoints locais.
   - Servidas diretamente pelo Express através de `res.sendFile(path.join(__dirname, 'nome-da-pagina.html'))`.
   - **Zero frameworks pesados (React, Vue, Angular)**: Não exigem etapa de build (`npm build` ou `webpack`), tornando os arquivos leves, estáveis e de manutenção trivial.

2. **Exposição de Rede & Nginx:**
   - O servidor escuta na porta 3005 e Nginx atua como proxy reverso em `http://127.0.0.1:3005`.
   - Como qualquer usuário com acesso ao navegador pode inspecionar o código-fonte (F12 / DevTools), **qualquer chave gravada em HTML, JS ou storage é pública**.

---

## 2. Ponto Crítico de Segurança: Como Manter a API Key Fora do Navegador

Para cumprir com rigor a diretriz de segurança de **NUNCA expor `VIDEO_ENGINE_API_KEY` ao navegador** (nem em HTML, JS, `localStorage`, `sessionStorage` ou endpoint auxiliar), adotaremos o padrão **BFF (Backend-For-Frontend)** integrado ao Express:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NAVEGADOR DO USUÁRIO                             │
│                                                                             │
│  Marcel acessa: GET /video-painel                                           │
│  Digita "#1639" e clica em "Buscar / Criar Job"                             │
│  Dispara: fetch('/api/v2/panel/video-jobs', { body: { property_ref } })     │
│  ⚠️ ZERO HEADERS DE AUTORIZAÇÃO / ZERO API KEYS NO BROWSER                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP POST (Same-Origin)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BACKEND (video_engine/api_v2.js)                        │
│                                                                             │
│  Endpoint BFF: POST /api/v2/panel/video-jobs                                │
│  1. Valida Same-Origin (Origin / Referer local)                             │
│  2. Injeta internamente no servidor:                                        │
│     broker_id = 'marcel'                                                    │
│     source = 'web_panel'                                                    │
│  3. Invoca diretamente o Job Core: initializeVideoJob(...)                  │
│  4. Retorna o resultado padronizado (201 / 400 / 404 / 503 / 500)           │
│  🔒 Chave secreta permanece 100% no servidor (.env)                         │
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

### Por que esta solução é a mais segura e elegante?
1. **API Key 100% Oculta:** O browser faz requisição para uma rota interna do mesmo domínio (`/api/v2/panel/video-jobs`). A autenticação com o Job Core é realizada server-side.
2. **Rota Externa `POST /api/v2/video-jobs` Continua Protegida:** A rota homologada na Fase 1D continua exigindo estritamente `Authorization: Bearer <KEY>` para integrações externas e scripts.
3. **Sem Complexidade Prematura:** Não necessita de login/senhas/cookies criptografados nesta fase, mas impede vazamento de secrets.

---

## 3. Wireframe Textual da Interface (`video-painel.html`)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🏢 BALI IMÓVEIS  |  🎬 Video Engine V2 — Criação & Visualização de Job      │
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
│  [⚠️ Mensagem de Alerta / Erro quando aplicável (400, 404, 503, 500)]       │
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
- **Servidor:** Retorna `video-painel.html`.

### 2. Endpoint BFF: `POST /api/v2/panel/video-jobs`
- **Origem:** Browser (Same-Origin).
- **Headers:** `Content-Type: application/json` (sem headers de autorização).
- **Body:**
  ```json
  {
    "property_ref": "1639"
  }
  ```

#### Mapeamento de Respostas para a Interface:
* **HTTP 201 Created (Sucesso):**  
  Painel exibe card verde de sucesso, preenche os dados do imóvel, tabela financeira, os 3 ganchos, corpo e o UUID do Job com status `SCRIPT_READY`.
* **HTTP 404 Not Found (Imóvel Não Encontrado):**  
  Painel exibe alerta vermelho: *"Imóvel não encontrado no CRM para a referência informada."*
* **HTTP 400 Bad Request (Parâmetro Inválido):**  
  Painel exibe alerta âmbar: *"Por favor, informe uma referência de imóvel válida."*
* **HTTP 503 Service Unavailable (Modo Degradado / Banco Offline):**  
  Painel exibe badge amarelo de alerta: *"Roteiros gerados com sucesso, mas persistência em banco temporariamente indisponível."* Exibe os roteiros e imóvel, com `Job ID: [Não persistido]`.
* **HTTP 500 Internal Error:**  
  Painel exibe alerta: *"Erro interno ao processar solicitação. Tente novamente em instantes."*

#### Prevenção de Ações Concorrentes (Client-Side):
- Enquanto a requisição estiver ativa:
  - O botão "Buscar e Criar" fica desabilitado (`disabled`);
  - O texto do botão muda para *"⏳ Processando no CRM..."*;
  - Um indicador de carregamento (spinner) é exibido;
  - O campo de input é bloqueado temporariamente para evitar cliques duplos.

---

## 5. Arquivos a Criar e Modificar

1. **`video-painel.html` [NOVO]:**
   - Página HTML5 responsiva, autocontida com CSS Dark Mode padronizado (Plus Jakarta Sans).
   - JavaScript puro manipulando DOM e fazendo `fetch('/api/v2/panel/video-jobs')`.
   - Zero dependências de build ou bibliotecas externas.

2. **`video_engine/api_v2.js` [MODIFICAR]:**
   - Adicionar o endpoint BFF:
     ```javascript
     router.post('/panel/video-jobs', async (req, res) => { ... });
     ```
   - Invoca `jobService.initializeVideoJob({ property_ref, broker_id: 'marcel', source: 'web_panel', metadata })`.

3. **`gestor_server.js` [MODIFICAR]:**
   - Adicionar a rota para servir a página:
     ```javascript
     app.get('/video-painel', (req, res) => {
       res.sendFile(path.join(__dirname, 'video-painel.html'));
     });
     ```

---

## 6. O Que Permanece Rigorosamente Intocado

* ❌ Sem geração/renderização de vídeo pelo painel (HeyGen/FFmpeg não são chamados pelo painel nesta fase).
* ❌ Sem biblioteca/histórico de vídeos ou dashboard analítico.
* ❌ Sem alteração no fluxo WhatsApp V1 (`activeVideoSessions`, áudios 1-4, `CLONE`, `OK`).
* ❌ Sem alteração no contrato homologado da API externa `POST /api/v2/video-jobs`.
* ❌ Toda a inteligência reside no `job_service.js`; zero duplicação de regras no frontend.

---

## 7. Plano de Testes e Homologação da Fase 2A

A homologação cobrirá os seguintes cenários:

1. **Disponibilidade da Página:**
   - Acesso via browser/curl a `http://localhost:3005/video-painel`.
   - Validar retorno HTTP 200 e entrega do HTML.
2. **Criação Nominal pelo Painel (`#1639`):**
   - Disparo de `POST /api/v2/panel/video-jobs` com `{ "property_ref": "1639" }`.
   - Validar retorno HTTP 201 com dados, roteiros e `job_id`.
3. **Persistência no PostgreSQL:**
   - Conferir registro no banco com `source = 'web_panel'`, `broker_id = 'marcel'` e snapshots JSONB.
4. **Prevenção de Clique Duplo:**
   - Validar que o botão fica desabilitado e com estado de loading durante a requisição.
5. **Imóvel Inexistente (`#99999999`):**
   - Validar retorno HTTP 404 e renderização do alerta de erro na interface.
6. **Campo Vazio:**
   - Validar rejeição HTTP 400 antes ou durante envio.
7. **Modo Degradado / PostgreSQL Offline (HTTP 503):**
   - Parar temporariamente o PostgreSQL cluster (`systemctl stop postgresql@16-main`).
   - Disparar requisição pelo painel com `#1639`.
   - Validar retorno HTTP 503 e exibição amigável dos roteiros com aviso de persistência pendente.
   - Restaurar PostgreSQL para `active`.
8. **Auditoria de Segurança:**
   - Inspecionar `video-painel.html` e comprovar ausência absoluta de tokens, chaves ou referências a `VIDEO_ENGINE_API_KEY`.
9. **Não-Regressão de WhatsApp e API Externa:**
   - Validar que o WhatsApp V1 e `POST /api/v2/video-jobs` (Bearer) continuam funcionando 100%.
10. **Saúde de Produção:**
    - PM2 online e PostgreSQL active.

---

## 8. Limites Explícitos da Fase 2A

* O painel NÃO renderiza vídeos nesta fase (somente cria o Job e visualiza roteiros e dados).
* O painel NÃO possui autenticação de usuários (opera como cockpit interno na VPS).
* Toda mutação de estado de vídeo fica reservada para as fases posteriores.
