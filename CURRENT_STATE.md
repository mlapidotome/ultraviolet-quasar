# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual Concluída:** Fase 2A — Painel Web Mínimo de Criação e Visualização de Job  
**Próxima Fase:** A definir (ex: Fase 2B - Seleção de Look / Disparo de Renderização pelo Painel)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 60633)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui agora **três adaptadores de entrada** conectados ao mesmo **Job Core**:

```
[Canal WhatsApp (V1)]      [API Externa HTTP (V2)]        [Painel Web Visual (V2)]
video_anuncios_engine.js   POST /api/v2/video-jobs        GET /video-painel
                           (Bearer Auth)                  POST /api/v2/panel/video-jobs
         │                         │                      (HTTP Basic Auth server-side)
         │                         │                                  │
         └─────────────────────────┼──────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/job_service  │
                     │                           │
                     │ • fetchImovelData         │
                     │ • generateCompleteScripts │
                     │ • createVideoJob (DB)     │
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                         PostgreSQL (video_jobs)
```

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Responsável exclusivo por buscar dados de imóveis, calcular métricas financeiras, gerar os ganchos de retenção e persistir jobs no PostgreSQL de forma resiliente. Zero dependência de interfaces ou protocolos.

* **Painel Web Visual (`video-painel.html` + `video_engine/panel_auth.js`):**  
  Interface leve e responsiva com Dark Mode padronizado, consumindo o endpoint BFF `POST /api/v2/panel/video-jobs`. Protegida por HTTP Basic Auth com parser seguro para senhas com `:` e variáveis estritamente obrigatórias no `.env` (`PANEL_USER` e `PANEL_PASSWORD`). Zero credenciais no cliente.

* **Adaptador HTTP V2 Externo (`video_engine/api_v2.js`):**  
  Roteador Express protegido por Bearer Token (`Authorization: Bearer <VIDEO_ENGINE_API_KEY>`). Aceita requisições JSON `{ "property_ref": "1639" }`, fixa internamente `broker_id = 'marcel'` e `source = 'web'`, e mapeia respostas HTTP (201, 400, 401, 404, 503).

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Continua gerenciando a interação em tempo real via chat (`#REF`), memória de sessão (`activeVideoSessions`), comandos `CLONE`, áudios 1-4, HeyGen, FFmpeg e Cloudflare R2 de forma 100% inalterada.

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video-painel.html`:  
  Interface Web responsiva para busca de imóvel, criação de Job e exibição dos 3 ganchos + corpo e simulação financeira.

* `/var/www/bali-gestor/video_engine/panel_auth.js`:  
  Middleware de autenticação HTTP Basic Auth server-side com suporte a caracteres especiais/colons e exigência de variáveis.

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Adaptador HTTP montando a rota externa `POST /api/v2/video-jobs` (Bearer) e o BFF `POST /api/v2/panel/video-jobs` (Basic Auth).

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio e orquestrador de inicialização de jobs.

* `/var/www/bali-gestor/video_engine/db.js`:  
  Módulo de persistência PostgreSQL via `pg.Pool`.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp e motor de renderização.

* `/var/www/bali-gestor/gestor_server.js`:  
  Servidor Express principal montando `/api/v2`, servindo `/video-painel` sob autenticação e bloqueando acesso estático a arquivos internos.

* `/var/www/bali-gestor/migrations/001_create_video_jobs.sql`:  
  Tabela estrutural `video_jobs`.

---

## 3. Histórico de Homologações

* **Fase 1A (Fundação PostgreSQL & video_jobs):**  
  UUID de Teste: `ea084896-a1b1-4d6f-8391-557a1e2fdb81`

* **Fase 1B (Shadow Jobs no Fluxo Real):**  
  UUID de Homologação Real: `a1aca1e3-c5d3-494c-89a2-2b49afd0a082`

* **Fase 1C (Job Core Independente de Interface):**  
  UUID de Homologação Integrada: `8b2cf780-f764-424e-ab34-626d4c85e5ec`

* **Fase 1D (Job API Mínima HTTP):**  
  UUID de Homologação HTTP: `20e570ee-dadc-438a-9d7f-491807ffa1cb`

* **Fase 2A (Painel Web Mínimo de Criação e Visualização de Job):**  
  UUID de Homologação Painel: `f8099b3d-d331-45ad-9983-145352d05604`  
  Interface `video-painel.html` autenticada via HTTP Basic Auth nativo server-side, com suporte a senhas com `:`, credenciais 100% fora do navegador, endpoint BFF `POST /api/v2/panel/video-jobs`, proteção estática contra vazamento de código, tratamento 201/400/401/404/503 (linguagem "persistência indisponível"), prevenção de duplo clique e não-regressão total de WhatsApp V1 e API externa.