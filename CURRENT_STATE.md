# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual Concluída:** Fase 3A — Asset Model & Creative Blueprint Foundation  
**Próxima Fase:** Fase 3B — Video Composer MVP (Timeline Engine orientada a Blueprint)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 65502)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui capacidade completa de **criação de Jobs, geração de Vídeo Piloto, produção da Coleção Criativa de 3 vídeos (Ganchos 1, 2 e 3 + Corpo)** e agora uma **fundação robusta de Catálogo de Assets (`video_assets`) e Creative Blueprints declarativos (`creative_blueprints`)**:

```
[Canal WhatsApp (V1)]      [API Externa HTTP (V2)]        [Painel Web Visual (V2)]
video_anuncios_engine.js   POST /api/v2/video-jobs        GET /video-painel
                           (Bearer Auth)                  POST /api/v2/panel/video-jobs
         │                         │                      POST /api/v2/panel/video-jobs/:id/generate-pilot
         │                         │                      POST /api/v2/panel/video-jobs/:id/approve-pilot
         │                         │                      POST /api/v2/panel/video-jobs/:id/reject-pilot
         │                         │                      GET /api/v2/panel/video-jobs/:id/video/:index
         │                         │                      GET /api/v2/panel/video-jobs/:id/blueprints
         │                         │                      GET /api/v2/panel/video-jobs/:id/assets
         │                         │                      (HTTP Basic Auth server-side)
         │                         │                                  │
         └─────────────────────────┼──────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/job_service  │ ── CRM Imóveis, Copy & Blueprints Iniciais
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/pilot_service│ ── HeyGen, FFmpeg, Smart Retry/Resume
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/asset_service│ ── Catálogo, Hashes, Blueprints & Resolver
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     PostgreSQL (video_jobs + video_assets)
```

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Busca dados no CRM, calcula simulação financeira, gera scripts de copy (3 ganchos + corpo) e inicializa os 3 Creative Blueprints declarativos na coluna `creative_blueprints JSONB`.

* **Catálogo de Assets & Blueprints (`video_engine/asset_service.js`):**  
  - **Separação de Hashes:** `generation_key` determinística (SHA-256 da receita canônica normalizada: texto, look, voz, provedor, formato) vs `file_hash` físico (SHA-256 dos bytes do arquivo no disco).
  - **Lifecycle de Storage:** `pending`, `processing`, `remote_ready`, `ready`, `failed`, `archived`, com `storage_path` nullable enquanto não materializado.
  - **Imutabilidade Estrita:** Assets `ready` não são sobrescritos; tentativa de substituição com bytes divergentes é bloqueada.
  - **Asset Resolver:** Validação em runtime de existência física, tamanho > 0, contenção canônica anti-symlink (`realpathSync`) e verificação anti-tampering.
  - **Creative Blueprints Declarativos:** Contrato JSON imutável e versionado (`crv_<job_id>_v<variante>_b1`) contendo `recipe_snapshot`, `resolved_assets`, `composition_directives`, `timeline` e `output_target` (sem duplicação desnecessária de paths e codecs).
  - **Fail-Open:** Instrumentação aditiva e não-bloqueante; falhas na catalogação não interrompem o pipeline 2C.
  - **Zero Reuso Cross-Job Automático:** Cada Job mantém e consome exclusivamente seus próprios arquivos físicos locais.

* **Orquestrador de Piloto e Coleção Criativa (`video_engine/pilot_service.js`):**  
  Gerencia o ciclo de vida completo por `job_id`:
  - Lock atômico SQL na aprovação;
  - Submissão de clips na HeyGen e catalogação aditiva em `video_assets`;
  - Reaproveitamento estrito do `body.mp4` do Job com validação física anti-symlink (`realpathSync`) e integridade via `ffprobe`;
  - Smart Retry granular e Smart Resume no boot;
  - Concatenação assíncrona FFmpeg e registro de artefatos finais em `video_assets` e `creative_blueprints`.

* **Painel Web Visual (`video-painel.html` + `video_engine/api_v2.js`):**  
  Interface responsiva com Dark Mode, busca de imóveis, criação de Jobs, disparo de piloto, aprovação/reprovação, streaming autenticado dos 3 vídeos e novos endpoints de inspeção `/blueprints` e `/assets`.

* **Isolamento de Segurança:**  
  Protegido com HTTP Basic Auth server-side no painel, Bearer Token na API externa, bloqueio estático de `/outputs/jobs` (`HTTP 403 Forbidden`) e proteção rigorosa anti-path-traversal e anti-symlink.

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Permanece 100% íntegro e operacional (`CLONE`, `OK`, áudios 1-4, `activeVideoSessions`).

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video_engine/asset_service.js`:  
  Módulo de catálogo de assets, cálculo de `generation_key`, `file_hash`, resolução física, imutabilidade e construção de Creative Blueprints.

* `/var/www/bali-gestor/migrations/004_create_video_assets_and_blueprints.sql`:  
  Criação da tabela `video_assets`, adição da coluna `creative_blueprints JSONB` em `video_jobs` e índices B-Tree e GIN.

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio de imóveis, roteiros e geração fail-open de blueprints iniciais.

* `/var/www/bali-gestor/video_engine/pilot_service.js`:  
  Orquestrador de piloto e coleção criativa com instrumentação aditiva de assets em `video_assets`.

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Endpoints da V2 incluindo novos endpoints `/blueprints` e `/assets`.

* `/var/www/bali-gestor/video-painel.html`:  
  Interface Web responsiva para gestão completa de vídeos da V2.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp e motor de renderização legado V1.

---

## 3. Histórico de Homologações

* **Fase 1A a 2C:**  
  Fundação PostgreSQL, Shadow Jobs, Job Core, Job API, Painel Web V2, Geração de Piloto (2B) e Aprovação/Restantes 2 e 3 (2C).  
  Commit Final Fase 2C: `6837749827104faf6ae198da0b77d055e0ec6e5f`

* **Fase 3A (Asset Model & Creative Blueprint Foundation — Pós-Review Homologada):**  
  UUIDs de Homologação Fase 3A: `0be71ed8-0725-45ea-9640-c1ddcae46190`, `661d9a9e-84ef-4d52-a7a2-803342d2d9d8`, `83b8f446-9914-4da7-b676-53a616c5fd50`, `2c8f338e-19bb-41df-ae7a-c2a965f566be`, `f67631c3-3d15-4977-9c9f-a386c026fd97`, `6e567d94-43ec-45ed-b96d-f0e5b71c170d`, `de123c25-7525-4715-a67e-d6bee95e1384`.  
  Validação de 26 cenários automatizados no VPS:
  - **FIX 1:** Canonicalização recursiva determinística de `generation_key` (ordem arbitrária de chaves em todos os níveis, arrays preservados, sensibilidade estrita a width, height, fps, generation_params e propriedades aninhadas);
  - **FIX 2:** Imutabilidade estrita de assets `ready` em `createAsset()` (bloqueio de rebaixamento para processing/pending, rejeição com `IMMUTABILITY ERROR` em caso de generation_key divergente, idempotência limpa e preservação de storage_path/file_hash);
  - **FIX 3:** Asset Resolver com validação de ownership físico do Job (`outputs/jobs/<job_id>/`), rejeitando arquivos pertencentes a outro Job, symlinks para outro Job e symlinks externos;
  - Asset pendente criado com `storage_path = NULL` e `provider_ref`;
  - Transição para READY com cálculo exato de `file_hash` SHA-256;
  - Idempotência ao revalidar asset idêntico;
  - Persistência e estrutura dos 3 Creative Blueprints em `creative_blueprints JSONB`;
  - Tolerância e retrocompatibilidade com Jobs legados (`creative_blueprints = []`);
  - Preservação do Job showcase da Fase 2C (`bbddf3ba-...`) com streaming 200 para os 3 vídeos;
  - Isolamento estrito cross-job (zero deduplicação automática entre jobs);
  - Catalogação completa dos 7 assets do pipeline (3 ganchos, corpo e 3 vídeos finais);
  - Endpoints HTTP `/blueprints` e `/assets` respondendo 200;
  - Não-regressão do WhatsApp V1 (`CLONE`, `OK`, `activeVideoSessions`).