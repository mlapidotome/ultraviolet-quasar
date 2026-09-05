# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual Concluída:** Fase 2B — Geração de Piloto pelo Painel Web V2 (Vinculada ao Job)  
**Próxima Fase:** A definir (ex: Fase 2C - Aprovação do Piloto e Renderização dos Ganchos Restantes 2 e 3)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 61975)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui agora capacidade de **criação de Jobs e produção visual de Vídeos Piloto** totalmente desatrelada do WhatsApp:

```
[Canal WhatsApp (V1)]      [API Externa HTTP (V2)]        [Painel Web Visual (V2)]
video_anuncios_engine.js   POST /api/v2/video-jobs        GET /video-painel
                           (Bearer Auth)                  POST /api/v2/panel/video-jobs
         │                         │                      POST /api/v2/panel/video-jobs/:id/generate-pilot
         │                         │                      GET /api/v2/panel/video-jobs/:id/pilot
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
                     │ video_engine/pilot_service│ ── HeyGen, FFmpeg, Smart Resume
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                         PostgreSQL (video_jobs)
```

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Busca dados no CRM, calcula simulação financeira e gera scripts de copy (3 ganchos + corpo).

* **Orquestrador de Piloto (`video_engine/pilot_service.js`):**  
  Gerencia o ciclo de vida do vídeo piloto por `job_id`: lock atômico SQL, submissão de clips na HeyGen (voz clonada Marcel, avatar em círculo e foto do imóvel no corpo), persistência imediata de `heygen_video_id`, download para `outputs/jobs/<job_id>/`, concatenação FFmpeg, validação de integridade e rotina de Smart Resume no boot.

* **Painel Web Visual (`video-painel.html` + `video_engine/panel_auth.js`):**  
  Interface com Dark Mode, busca de imóveis, criação de Jobs, botão "Gerar Vídeo Piloto", polling de status read-only a cada 5s e player HTML5 com streaming autenticado do vídeo final.

* **Isolamento de Segurança:**  
  Protegido com HTTP Basic Auth server-side no painel, Bearer Token na API externa, bloqueio estático de `/outputs/jobs` (403) e proteção anti-path-traversal.

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Permanece 100% íntegro, gerenciando o fluxo legado via chat (`#REF`, `CLONE`, áudios 1-4).

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video-painel.html`:  
  Interface Web responsiva para busca de imóvel, criação de Job, disparo de piloto e visualização com player de vídeo.

* `/var/www/bali-gestor/video_engine/pilot_service.js`:  
  Módulo orquestrador do piloto, concorrência atômica, chamadas à HeyGen, download, FFmpeg e Smart Resume.

* `/var/www/bali-gestor/video_engine/panel_auth.js`:  
  Middleware de autenticação HTTP Basic Auth com parser seguro para senhas com `:` e verificação estrita de variáveis.

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Adaptador HTTP montando endpoints do painel e da API externa.

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
  Validação de lock atômico SQL (202 vs 409), Smart Resume parcial e completo no boot, bloqueio estático de `/outputs/jobs` (403), streaming autenticado de vídeo (`:id/pilot`), resiliência com gravação de `PILOT_FAILED`, e não-regressão total de WhatsApp V1 e API externa.