# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual Concluída:** Fase 2C — Aprovação do Piloto e Geração dos Vídeos Restantes (Ganchos 2 e 3)  
**Próxima Fase:** A definir (ex: Fase 3A - Métricas, Histórico de Coleções ou Configurações Avançadas)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 63376)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui capacidade completa de **criação de Jobs, geração de Vídeo Piloto e produção da Coleção Criativa de 3 vídeos (Ganchos 1, 2 e 3 + Corpo)** desatrelada do WhatsApp:

```
[Canal WhatsApp (V1)]      [API Externa HTTP (V2)]        [Painel Web Visual (V2)]
video_anuncios_engine.js   POST /api/v2/video-jobs        GET /video-painel
                           (Bearer Auth)                  POST /api/v2/panel/video-jobs
         │                         │                      POST /api/v2/panel/video-jobs/:id/generate-pilot
         │                         │                      POST /api/v2/panel/video-jobs/:id/approve-pilot
         │                         │                      POST /api/v2/panel/video-jobs/:id/reject-pilot
         │                         │                      GET /api/v2/panel/video-jobs/:id/video/:index
         │                         │                      (HTTP Basic Auth server-side)
         │                         │                                  │
         └─────────────────────────┼──────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/job_service  │ ── CRM Imóveis & Copy
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/pilot_service│ ── HeyGen, FFmpeg, Smart Retry/Resume
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                         PostgreSQL (video_jobs)
```

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Busca dados no CRM, calcula simulação financeira e gera scripts de copy (3 ganchos + corpo).

* **Orquestrador de Piloto e Coleção Criativa (`video_engine/pilot_service.js`):**  
  Gerencia o ciclo de vida completo do Job por `job_id`:
  - Lock atômico SQL na aprovação;
  - Submissão de clips na HeyGen (Ganchos 1, 2 e 3 e Corpo com background);
  - **Reaproveitamento estrito do `body.mp4`** gerado na Fase 2B com validação física anti-symlink (`realpathSync`) e integridade de streams de áudio/vídeo e duração via `ffprobe`;
  - **Smart Retry granular:** nunca refaz assets já existentes e validados; trata estados terminais de erro na HeyGen permitindo nova submissão exclusiva do componente com falha;
  - Concatenação assíncrona FFmpeg dos Vídeos 2 e 3 (`hook_2 + body`, `hook_3 + body`);
  - **Smart Resume no boot:** retoma Jobs pendentes (`PILOT_*` e `REMAINDER_*`) sem retrabalho.

* **Painel Web Visual (`video-painel.html` + `video_engine/panel_auth.js`):**  
  Interface com Dark Mode, busca de imóveis, criação de Jobs, botão "Gerar Vídeo Piloto", botões de "Aprovar Piloto" e "Reprovar Piloto", polling automático read-only e grade responsiva com 3 players de vídeo individuais e botões de download direto.

* **Isolamento de Segurança:**  
  Protegido com HTTP Basic Auth server-side no painel, Bearer Token na API externa, bloqueio estático de `/outputs/jobs` (`HTTP 403 Forbidden`) e proteção rigorosa anti-path-traversal e anti-symlink.

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Permanece 100% íntegro e operacional (`CLONE`, `OK`, áudios 1-4, `activeVideoSessions`).

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video-painel.html`:  
  Interface Web responsiva para busca de imóvel, criação de Job, disparo de piloto, aprovação/reprovação e visualização da coleção criativa completa (3 vídeos).

* `/var/www/bali-gestor/video_engine/pilot_service.js`:  
  Módulo orquestrador de piloto e coleção criativa, validação anti-symlink e ffprobe, concorrência atômica, Smart Retry, chamadas à HeyGen, download, FFmpeg assíncrono e Smart Resume.

* `/var/www/bali-gestor/video_engine/panel_auth.js`:  
  Middleware de autenticação HTTP Basic Auth com parser seguro para senhas com `:` e verificação estrita de variáveis.

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Adaptador HTTP montando endpoints do painel (`/generate-pilot`, `/approve-pilot`, `/reject-pilot`, `/video/:index`) e da API externa.

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio de imóveis e geração de roteiros.

* `/var/www/bali-gestor/video_engine/db.js`:  
  Módulo de persistência PostgreSQL via `pg.Pool`.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp e motor de renderização legado.

* `/var/www/bali-gestor/gestor_server.js`:  
  Servidor Express principal montando `/api/v2`, inicializando Smart Resume no boot e bloqueando acesso estático a `/outputs/jobs`.

* `/var/www/bali-gestor/migrations/001_create_video_jobs.sql`:  
  Tabela estrutural `video_jobs`.

* `/var/www/bali-gestor/migrations/002_add_pilot_fields_to_video_jobs.sql`:  
  Colunas `pilot_video_url` e `error_message`.

* `/var/www/bali-gestor/migrations/003_add_creative_set_fields.sql`:  
  Colunas `video2_url`, `video3_url` e índice `idx_video_jobs_creative_status`.

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

* **Fase 2B (Geração de Piloto pelo Painel Web V2):**  
  UUID de Homologação Piloto Nominal: `2a293dbb-4753-4327-9a3c-6c3958fb9167`  
  UUID de Homologação Concorrência Atômica: `7c1ff0fe-68c5-4a67-a505-0ebc909c0e2a`

* **Fase 2C (Aprovação do Piloto e Coleção Criativa de 3 Vídeos):**  
  UUID de Homologação Coleção Criativa Pronta: `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b`  
  UUID de Homologação Concorrência Atômica na Aprovação: `f945bb38-d178-4855-ae5c-f09402a4b2cf`  
  Validação completa de 25 cenários: aprovação nominal (202), reprovação atômica (`PILOT_REJECTED`), lock atômico SQL na aprovação (202 vs 409), reuso estrito do body, rejeição de body com 0 bytes, rejeição de path traversal, bloqueio de symlink externo via `realpathSync`, validação de streams de áudio e vídeo via `ffprobe`, smart retry granular (preserva Hook 2, Hook 3 e vídeos já prontos), recuperação de IDs terminais com falha, montagem assíncrona FFmpeg, streaming autenticado dos 3 vídeos (`/video/1`, `/video/2`, `/video/3`), bloqueio estático 403 em `/outputs/jobs/` e não-regressão total.