# Estado Atual da Video Engine — Bali Imóveis (V2)

**Última Atualização:** 05/09/2026  
**Fase Atual:** Fase 3C.1 — Final Hardening implementado e homologado localmente — aguardando revisão externa.  
**Próxima Fase:** Fase 3C.2 — B-roll & Picture-in-Picture (PIP)  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status do PM2:** `bali-gestor` online  
**Status do Banco:** PostgreSQL 16 `active` (DB: `bali_gestor`)  

---

## 1. Arquitetura Atual Homologada

A Video Engine possui capacidade completa de **criação de Jobs, geração de Vídeo Piloto, produção da Coleção Criativa de 3 vídeos (Ganchos 1, 2 e 3 + Corpo)**, fundação de **Catálogo de Assets (`video_assets`) e Creative Blueprints declarativos (`creative_blueprints`)**, o **Video Composer determinístico (`video_engine/composer_service.js`)**, e a camada declarativa de **Editing Styles Versionáveis (`video_engine/styles/presets.js`)** e **Overlay Engine (`video_engine/overlay_service.js`)**:

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
         │                         │                      POST /api/v2/panel/video-jobs/:id/compose-shadow-3c/:index
         │                         │                      GET /api/v2/panel/video-jobs/:id/shadow-3c-video/:index
         │                         │                      GET /api/v2/panel/video-jobs/:id/compare-shadow-3c/:index
         │                         │                      GET /api/v2/panel/editing-styles
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
                     ┌───────────────────────────┐
                     │ video_engine/styles/      │ ── Presets Versionados (performance_reels_v1,
                     │ presets.js                │    clean_modern_v1), FONT_REGISTRY & style_hash
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │video_engine/overlay_service── Sanitização (11 chars), Safe Rectangles,
                     └─────────────┬─────────────┘   Text Wrapping, Fade & Punch Zoom Filtergraph
                                   │
                                   ▼
                     ┌────────────────────────────┐
                     │video_engine/composer_service ── Composer V2: Blueprint 1.0/1.1, render_key,
                     └─────────────┬──────────────┘    Claim SQL, Trims Bilaterais, Overlays, Captions,
                                   │                   Atomic Promotion, Idempotência & Shadow 3C
                                   ▼
                     PostgreSQL (video_jobs + video_assets)
```

* **Módulo de Editing Styles Versionáveis (`video_engine/styles/presets.js`):**
  - Catálogo canônico de presets declarativos versionados em código (`performance_reels_v1`, `clean_modern_v1`).
  - Whitelist estrita de compatibilidade entre tipos de overlay e presets (`supported_types`).
  - `FONT_REGISTRY` imutável apontando para fontes físicas no servidor (`DejaVuSans-Bold.ttf`, `LiberationSans-Bold.ttf`, etc.) com validação no boot.
  - Resolução estrita com fail-fast e cálculo de `style_hash = SHA-256(canonicalizeDeep(resolvedStyle))`.

* **Overlay Engine (`video_engine/overlay_service.js`):**
  - Tipos suportados: `headline`, `price_badge`, `location_tag`, `cta_banner`, `captions`.
  - Defesa em profundidade contra filter injection sanitizando 11 caracteres (`:`, `\`, `'`, `%`, `[`, `]`, `,`, `;`, `=`, `\n`, `\r`).
  - Métricas de fontes proporcionais reais para cálculo exato de largura em pixels.
  - Safe Rectangles com text wrapping automático e fail-fast por layout overflow.
  - Animações determinísticas de fade in/out e punch zoom.

* **Video Composer Engine (`video_engine/composer_service.js`):**
  - Suporte completo a Blueprint `1.0` (`composer_v1`) com regressão congelada da Fase 3B e Blueprint `1.1` (`composer_v2`).
  - Identidade de renderização determinística via `render_key` profunda.
  - Concorrência protegida por claim atômico PostgreSQL com lease e recuperação de estado stale/corrompido.
  - Pipeline canônico de re-encode FFmpeg H.264/AAC com atomicidade de saída.
  - Modo Shadow 3C (`asset_type: 'shadow_creative_3c'`, prefixo `shadow_3c_`) 100% isolado da Fase 2C.

---

## 2. Invariantes do Sistema

1. **Isolamento Total da Fase 2C:**
   - As colunas `pilot_video_url`, `video2_url`, `video3_url` e `status` da tabela `video_jobs` não são alteradas pelo modo Shadow 3C.
   - O job showcase `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` permanece 100% íntegro servindo os 3 vídeos oficiais com HTTP 200.
2. **Segurança de Execução FFmpeg:**
   - FFmpeg NUNCA executa sem `claim.acquired === true`.
   - Nomes de arquivos e parâmetros são estritamente sanitizados contra command/filter injection e path traversal.
3. **Imutabilidade e Idempotência:**
   - Assets `READY` existentes com hash válido retornam imediatamente (< 50ms) sem re-renderização.
   - Qualquer mutação em clipes, trims, estilo, tipografia, cores ou overlays altera a `render_key` determinística.
4. **WhatsApp V1 Intacto:**
   - `video_anuncios_engine.js` permanece inalterado e operacional no servidor.
5. **Zero Downtime & Zero Migrations:**
   - Nenhuma alteração estrutural no banco de dados.

---

## 3. Histórico de Homologação

| Fase | Commit Base | Status | Suíte de Testes |
|---|---|---|---|
| **Fase 2C** | `bbddf3ba...` | Homologada | 100% Pass |
| **Fase 3A** | `8e2bf030...` | Homologada | 100% Pass |
| **Fase 3B** | `a215799d...` | Homologada | 100% Pass (40/40) |
| **Fase 3C.1** | `7635bde6...` | Final Hardening implementado e homologado localmente — aguardando revisão externa | 100% Pass (61/61) |
