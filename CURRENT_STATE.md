# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 04/09/2026  
**Fase Atual Concluída:** Fase 1C — Job Core Independente de Interface  
**Próxima Fase:** A definir (ex: Fase 1D ou Fase 2A - HTTP API / Painel Web)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 58364)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine agora possui um **Job Core desacoplado e independente de interface**:

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Responsável exclusivo por:
  - Buscar dados do imóvel (`fetchImovelData`) com fallback local;
  - Calcular simulações e gerar roteiros (`generateCompleteScripts`);
  - Persistir novos jobs no PostgreSQL (`createVideoJob`) com garantia Fail-Open.
  - O núcleo não conhece canais (WhatsApp, Web, CLI), não formata mensagens de chat e não manipula sessões em memória.

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Ao receber `#REF`:
  - Dispara notificação de consulta ao usuário;
  - Invoca `jobService.initializeVideoJob()`;
  - Se sucesso, popula `activeVideoSessions[sessionKey]` vinculando `videoJobId`;
  - Formata o template textual com emojis e envia no WhatsApp;
  - Continua gerenciando as etapas subsequentes da V1 (áudios 1-4, `CLONE`, HeyGen, FFmpeg, R2) de forma 100% intocada.
  - Re-exporta `fetchImovelData` e `generateCompleteScripts` garantindo compatibilidade reversa para `gestor_server.js`.

---

## 2. Componentes e Estrutura do Sistema

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio e orquestrador de inicialização de jobs. Zero dependência de `video_anuncios_engine.js`.

* `/var/www/bali-gestor/video_engine/db.js`:  
  Módulo de persistência PostgreSQL via `pg.Pool`. Validação estrita de `property_ref` e `broker_id`.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp, gerenciador de `activeVideoSessions`, motor de renderização HeyGen, FFmpeg e Cloudflare R2.

* `/var/www/bali-gestor/migrations/001_create_video_jobs.sql`:  
  Tabela estrutural `video_jobs` com UUIDs v4 e tipos JSONB.

---

## 3. Histórico de Homologações

* **Fase 1A (Fundação PostgreSQL & video_jobs):**  
  UUID de Teste: `ea084896-a1b1-4d6f-8391-557a1e2fdb81`  
  PostgreSQL 16 configurado, migration aplicada, persistência CRUD isolada.

* **Fase 1B (Shadow Jobs no Fluxo Real):**  
  UUID de Homologação Real: `a1aca1e3-c5d3-494c-89a2-2b49afd0a082`  
  Validação de inserção paralela via WhatsApp e teste de degradação graciosa.

* **Fase 1C (Job Core Independente de Interface):**  
  UUID de Teste Unitário Isolado: `bdfeca21-b453-4d54-a943-09356f873d05`  
  UUID de Homologação Integrada Real: `8b2cf780-f764-424e-ab34-626d4c85e5ec`  
  Desacoplamento do domínio em `job_service.js`, eliminação de dependências circulares, garantia de exatamente 1 Job por requisição, fail-open validado e compatibilidade preservada com `gestor_server.js`.
