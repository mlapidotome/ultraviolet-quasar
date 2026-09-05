# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual Concluída:** Fase 3B — Video Composer MVP (Timeline Engine orientada a Blueprint — Pós-Review Homologada)  
**Próxima Fase:** Fase 3C — Editing Styles & Overlays Dinâmicos (B-roll, Overlays, Motion)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online (pid 81857)  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui capacidade completa de **criação de Jobs, geração de Vídeo Piloto, produção da Coleção Criativa de 3 vídeos (Ganchos 1, 2 e 3 + Corpo)**, fundação de **Catálogo de Assets (`video_assets`) e Creative Blueprints declarativos (`creative_blueprints`)**, e o primeiro **Video Composer determinístico orientado por Blueprint (`video_engine/composer_service.js`)**:

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
         │                         │                      POST /api/v2/panel/video-jobs/:id/compose-shadow/:index
         │                         │                      GET /api/v2/panel/video-jobs/:id/compare-shadow/:index
         │                         │                      GET /api/v2/panel/video-jobs/:id/shadow-video/:index
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
                     │ video_engine/pilot_service│ ── HeyGen, Concat Legado, Smart Retry/Resume
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │ video_engine/asset_service│ ── Catálogo, Hashes, Blueprints & Resolver
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌────────────────────────────┐
                     │video_engine/composer_service ── Composer MVP: render_key, Claim SQL,
                     └─────────────┬──────────────┘    Trims Reais, Re-encode Canônico, Shadow
                                   │
                                   ▼
                     PostgreSQL (video_jobs + video_assets)
```

* **Video Composer MVP (`video_engine/composer_service.js`):**
  - **Identidade Semântica Canônica:** `render_key` determinística (SHA-256 de todas as especificações e `file_hash` físico de cada clipe de entrada).
  - **Claim Atômico SQL:** Bloqueio persistente no PostgreSQL com lease e recuperação automática de `stale processing` (> 5 minutos).
  - **Asset Resolver & Pre-FFmpeg Validation:** Validação de contrato (schema_version 1.0, 1080x1920@30fps, 9:16, layer 0, trims válidos) e ownership físico estrito (`outputs/jobs/<jobId>/`).
  - **Trims Físicos Reais:** Aplicação determinística de filtros `trim` + `setpts` e `atrim` + `asetpts` para vídeo e áudio nos pontos especificados em `source_in_ms` e `source_out_ms`.
  - **Unidade Oficial de Duração:** Inteiro em milissegundos (`duration_ms`), descartando placeholders conceituais legados.
  - **Pipeline Canônico de Re-encode:** Concatenação única padronizada FFmpeg via `filter_complex` codificada em H.264 (yuv420p, 1080x1920@30fps) e áudio AAC (192k stereo, 44100Hz) com `-movflags +faststart`.
  - **Escrita Atômica, QC Estrito & Imutabilidade:** Render em arquivo temporário `.tmp.<uuid>.mp4`, inspeção `ffprobe` (validação real de codecs H.264/AAC, dimensões 1080x1920 e medição de FPS físico real a partir de `avg_frame_rate`/`r_frame_rate`), política conservadora de remoção de órfãos antes da promoção e promoção atômica via `renameSync`.
  - **Modo Shadow:** Produz artefatos paralelos (`shadow_crv_<id>_<render_key>.mp4`) com `asset_type = 'shadow_creative'` sem alterar campos oficiais da Fase 2C (`pilot_video_url`, `video2_url`, `video3_url`, `video_jobs.status`).
  - **Comparador Semântico:** `compareLegacyVsComposer()` demonstra equivalência formal ($\Delta \le 250\text{ ms}$, dimensões e streams idênticos).

* **Núcleo de Domínio (`video_engine/job_service.js`):**  
  Busca dados no CRM, calcula simulação financeira, gera scripts de copy (3 ganchos + corpo) e inicializa os 3 Creative Blueprints declarativos na coluna `creative_blueprints JSONB`.

* **Catálogo de Assets & Blueprints (`video_engine/asset_service.js`):**  
  - **Separação de Hashes:** `generation_key` determinística vs `file_hash` físico.
  - **Lifecycle de Storage:** `pending`, `processing`, `remote_ready`, `ready`, `failed`, `archived`.
  - **Imutabilidade Estrita:** Bloqueio de substituição de assets `ready` com bytes divergentes.
  - **Asset Resolver:** Validação em runtime de existência física, contenção canônica anti-symlink e integridade anti-tampering.

* **Orquestrador de Piloto e Coleção Criativa (`video_engine/pilot_service.js`):**  
  Mantido 100% operacional no pipeline oficial da Fase 2C com Smart Retry, reaproveitamento de `body.mp4` e entrega dos 3 vídeos oficiais.

* **Painel Web Visual (`video-painel.html` + `video_engine/api_v2.js`):**  
  Interface responsiva com Dark Mode, busca de imóveis, criação de Jobs, disparo de piloto, aprovação/reprovação, streaming autenticado dos 3 vídeos oficiais e novos endpoints do Shadow Composer (`/compose-shadow/:index`, `/compare-shadow/:index`, `/shadow-video/:index`).

* **Isolamento de Segurança:**  
  Protegido com HTTP Basic Auth server-side no painel, Bearer Token na API externa, bloqueio estático de `/outputs/jobs` (`HTTP 403 Forbidden`) e proteção rigorosa anti-path-traversal e anti-symlink.

* **Adaptador WhatsApp V1 (`video_anuncios_engine.js`):**  
  Permanece 100% íntegro e operacional (`CLONE`, `OK`, áudios 1-4, `activeVideoSessions`).

---

## 2. Componentes e Estrutura de Arquivos

* `/var/www/bali-gestor/video_engine/composer_service.js`:  
  Motor do Video Composer MVP (contrato, render_key, claim atômico, trims reais, re-encode FFmpeg, QC estrito e modo shadow).

* `/var/www/bali-gestor/video_engine/api_v2.js`:  
  Endpoints da V2 incluindo rotas de shadow compose, comparação semântica e streaming de shadow videos.

* `/var/www/bali-gestor/video_engine/asset_service.js`:  
  Módulo de catálogo de assets, cálculo de `generation_key`, `file_hash`, resolução física, imutabilidade e construção de Creative Blueprints.

* `/var/www/bali-gestor/migrations/004_create_video_assets_and_blueprints.sql`:  
  Criação da tabela `video_assets`, adição da coluna `creative_blueprints JSONB` em `video_jobs` e índices B-Tree e GIN.

* `/var/www/bali-gestor/video_engine/job_service.js`:  
  Núcleo de domínio de imóveis, roteiros e geração fail-open de blueprints iniciais.

* `/var/www/bali-gestor/video_engine/pilot_service.js`:  
  Orquestrador oficial de piloto e coleção criativa da Fase 2C.

* `/var/www/bali-gestor/video-painel.html`:  
  Interface Web responsiva para gestão completa de vídeos da V2.

* `/var/www/bali-gestor/video_anuncios_engine.js`:  
  Adaptador do WhatsApp e motor de renderização legado V1.

---

## 3. Histórico de Homologações

* **Fase 1A a 2C:**  
  Fundação PostgreSQL, Shadow Jobs, Job Core, Job API, Painel Web V2, Geração de Piloto (2B) e Aprovação/Restantes 2 e 3 (2C).  
  Commit Final Fase 2C: `6837749827104faf6ae198da0b77d055e0ec6e5f`

* **Fase 3A (Asset Model & Creative Blueprint Foundation):**  
  Tabela `video_assets`, coluna `creative_blueprints`, separação `generation_key` e `file_hash`, imutabilidade de assets ready, ownership físico de jobs e 26 testes homologados.  
  Commit Final Fase 3A: `8e2bf0306f557c595e8070628ee3e646a599d759`

* **Fase 3B (Video Composer MVP — Pós-Review Homologada):**  
  Validação completa de **35 cenários automatizados no VPS (35/35 PASS)**:
  1. Blueprint válido Hook+Body renderiza com sucesso;
  2. Ordem sequencial dos clipes respeitada;
  3. Asset inexistente rejeitado antes de invocar FFmpeg;
  4. Asset não-ready rejeitado antes do FFmpeg;
  5. Asset de outro Job rejeitado por violação de ownership físico;
  6. Symlink externo rejeitado;
  7. `file_hash` divergente (adulteração de bytes) rejeitado;
  8. Blueprint vazio ou corrompido rejeitado;
  9. `schema_version` não suportada rejeitada;
  10. Camada não suportada (`layer > 0`) rejeitada no MVP;
  11. Parâmetros de trim inválidos (`source_in >= source_out`) rejeitados;
  12. Arquivo de saída contém stream de vídeo ativo;
  13. Arquivo de saída contém stream de áudio ativo;
  14. Duração de saída dentro da tolerância configurável de $\pm 250\text{ ms}$;
  15. Resolução de saída estritamente 1080x1920;
  16. Taxa de quadros de saída 30 fps e formato H.264 canônico;
  17. Pipeline de re-encode padronizado único gera output íntegro;
  18. Unidade de duração oficial (`duration_ms`) aplicada sem truncamento;
  19. Placeholders antigos de metadata ignorados (fala completa preservada);
  20. **Cleanup automático de `.tmp` em falha sem intervenção manual do teste;**
  21. Arquivo final existente não corrompido em caso de erro no retry;
  22. Mesma `render_key` gera retorno idempotente imediato sem invocar FFmpeg;
  23. Mudança no `file_hash` de um asset de entrada altera a `render_key`;
  24. Mudança no Blueprint (trims, ordem, formato) altera a `render_key`;
  25. Asset READY nunca é sobrescrito fisicamente;
  26. Claim atômico SQL impede duas renderizações simultâneas do mesmo criativo;
  27. Recuperação automática de stale processing após lease de 5 minutos;
  28. Shadow Composer gera arquivo paralelo sem tocar nos campos oficiais da 2C;
  29. Comparação semântica entre Shadow Composer e concat legado demonstra equivalência;
  30. Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200);
  31. WhatsApp V1 e bloqueio estático 403 em `/outputs/jobs/` permanecem intocados;
  32. **PM2 `bali-gestor` (processo verificado online via `pm2 jlist`) e PostgreSQL 16 saudáveis;**
  33. **Trims reais aplicados fisicamente no FFmpeg (clipe de 5s com trim 1s→3s gerou exatamente 2000ms);**
  34. **Proteção contra arquivo órfão prévio em `finalPath` (removido com segurança antes da promoção);**
  35. **QC estrito de Codecs físicos (H.264 / AAC) e FPS físico derivado de streams reais.**
