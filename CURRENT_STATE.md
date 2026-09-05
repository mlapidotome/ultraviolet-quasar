# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 04/09/2026  
**Fase Atual Concluída:** Fase 1D — Job API Mínima HTTP  
**Próxima Fase:** A definir (ex: Fase 2A - Painel Web de Disparo / Visualização)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 59114)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine agora possui **dois adaptadores de entrada** conectados ao mesmo **Job Core**:

```
[Canal WhatsApp (V1)]                    [Canal HTTP / Web (V2)]
video_anuncios_engine.js                 POST /api/v2/video-jobs
         │                                       │
         └───────────────────┬───────────────────┘
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

* **Adaptador HTTP V2 (`video_engine/api_v2.js`):**  
  Roteador Express protegido por Bearer Token (`Authorization: Bearer <VIDEO_ENGINE_API_KEY>`). Aceita requisições JSON `{ "property_ref": "1639" }`, fixa internamente `broker_id = 'marcel'` e `source = 'web'`, e mapeia as respostas em códigos HTTP padronizados (201, 400, 401, 404 e 503 para persistência indisponível).

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Continua gerenciando a interação em tempo real via chat (`#REF`), memória de sessão (`activeVideoSessions`), comandos `CLONE`, áudios 1-4, HeyGen, FFmpeg e Cloudflare R2 de forma 100% inalterada.

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Adaptador HTTP para criação de jobs via REST API, autenticação Bearer e validação de schema.

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio e orquestrador de inicialização de jobs.

* `/var/www/bali-gestor/video_engine/db.js`:  
  Módulo de persistência PostgreSQL via `pg.Pool`.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp e motor de renderização.

* `/var/www/bali-gestor/gestor_server.js`:  
  Servidor Express principal montando `/api/v2`.

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
  Validação de criação via `POST /api/v2/video-jobs`, autenticação estrita por Bearer Token, rejeição de imóvel inexistente (404), rejeição de parâmetro inválido (400), rejeição não autorizada (401), mapeamento fail-open para HTTP 503 com dados preservados e WhatsApp V1 100% operacional.
