# Changelog: Fase 3C.1 — Editing Styles & Overlays Dinâmicos (MVP)

**Data:** 05/09/2026  
**Status:** Implementada e Homologada Localmente (50/50 Testes Aprovados) — Aguardando Revisão Externa  
**Repositório:** `mlapidotome/facade-checker`  
**Branch:** `main`  
**Commit Base 3B:** `a215799dea6740ef4ff2e59ae55837ef47c7f6ba`  
**Commit do Plano Aprovado:** `7635bde6d9e519724c30f8078d8299153762bb8`

---

## 1. Resumo Executivo

A **Fase 3C.1** implementou o motor declarativo de estilos de edição tipográficos e overlays visuais determinísticos para o Video Engine V2 (Bali Imóveis), evoluindo o Composer da Fase 3B para suportar **Creative Blueprint Schema 1.1** com total isolamento e retrocompatibilidade estrita com Blueprint 1.0 e com o pipeline oficial da Fase 2C.

---

## 2. Componentes Entregues

### 2.1 Módulo de Editing Styles Versionáveis (`video_engine/styles/presets.js`)
- **FONT_REGISTRY Imutável:** Registro estrito de fontes físicas no Linux (`/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`, `DejaVuSans.ttf`, `LiberationSans-Bold.ttf`, `LiberationSans-Regular.ttf`) com validação no boot (`validateFontRegistry()`).
- **Catálogo Canônico de Presets:**
  - `performance_reels_v1`: Otimizado para engajamento em Reels/TikTok (headlines em caixa alta, badges com punch zoom, fundos com opacidade equilibrada).
  - `clean_modern_v1`: Estética minimalista e elegante (tipografia sóbria, lower thirds refinados, cores ciano/dourado sutis).
- **Style Hash Intrínseco:** Resolução estrita do preset via `resolveEditingStyle(styleObj)` com cálculo determinístico de `style_hash = SHA-256(canonicalizeDeep(resolvedStyle))`. Qualquer alteração em fonte, tamanho, cor, padding, bounding box ou animação gera um novo hash e invalida a render_key.
- **Fail-Fast Rigoroso:** Rejeição explícita para qualquer `style_id` ou `version` desconhecido (sem fallback silencioso).

### 2.2 Overlay Engine (`video_engine/overlay_service.js`)
- **Tipos de Overlays Suportados:** `headline`, `price_badge`, `location_tag`, `cta_banner` e `captions`.
- **Defesa em Profundidade contra Filter Injection (11 caracteres sanitizados):** Sanitização estrita em `sanitizeDrawtextString()` para `:`, `\`, `'`, `%`, `[`, `]`, `,`, `;`, `=`, `\n`, `\r`.
- **Safe Rectangles & Layout Clamping:**
  - Definição geométrica em pixels para 4 safe areas (`top_safe`, `center`, `lower_third`, `bottom_safe`).
  - Text wrapping automático por palavra respeitando `max_chars_per_line` e `max_lines`.
  - Fail-fast com `[LAYOUT OVERFLOW ERROR]` caso o bounding box calculado exceda a safe area física.
- **Animações Determinísticas:**
  - Suporte a modulação de transparência gradual (`fade in` / `fade out`) via expressões FFmpeg puras.
  - Suporte a `punch zoom` no badge de preço (escala 1.15x nos primeiros 150ms) determinístico.
- **Compilação de Filtergraph FFmpeg:** Encadeamento de nós `drawtext` e `drawbox` ordenados estritamente por `layer_order` ascendente.

### 2.3 Video Composer Engine V2 (`video_engine/composer_service.js`)
- **Dual Pipeline de Contrato:**
  - `schema_version: "1.0"`: Utiliza `composer_contract_version: "composer_v1"` (caminho 3B estrito sem overlays).
  - `schema_version: "1.1"`: Utiliza `composer_contract_version: "composer_v2"` (inclui `style_hash`, `overlays` e `captions` na `render_key`).
- **Render Key Determinística:**
  - Inclui `schema_version`, `creative_id`, `blueprint_version`, `format`, `timeline` (com trims físicos), `style_hash`, `overlays`, `captions`, `asset_ids`, `file_hashes` e `composer_contract_version`.
- **Claim Atômico Persistente no PostgreSQL:** Bloqueio atômico de concorrência com lease de 5 minutos, recuperação de claims stale e de assets `READY` corrompidos.
- **Atomicidade e Imutabilidade Física:** Renderização em `.tmp.<uuid>.mp4`, validação com `ffprobe` e promoção atômica via `fs.renameSync` para o destino final imutável.

### 2.4 Endpoints de API e Painel Operacional (`video_engine/api_v2.js` & `video-painel.html`)
- `GET /api/v2/panel/editing-styles`: Retorna o catálogo canônico de estilos disponíveis e suas configurações.
- `POST /api/v2/panel/video-jobs/:id/compose-shadow-3c/:index`: Renderiza criativo 3C com Editing Style e overlays dinâmicos em modo Shadow.
- `GET /api/v2/panel/video-jobs/:id/shadow-3c-video/:index`: Streaming autenticado seguro com Content-Range para o MP4 renderizado na Fase 3C.
- `GET /api/v2/panel/video-jobs/:id/compare-shadow-3c/:index`: Metadados comparativos lado a lado entre o vídeo oficial da Fase 2C e o criativo 3C.
- **Card Shadow 3C no Painel:** Interface para seleção de estilo, acionamento do Composer 3C, visualização comparativa e player de preview integrado.

---

## 3. Homologação Automatizada (50 Cenários)

Executados na suíte `tests/video_engine/phase3c_composer_tests.js` no ambiente de produção:
1. `[PASS]` Boot validation: todas as fontes de todos os styles existem fisicamente no servidor.
2. `[PASS]` Blueprint 1.0 legado renderiza no caminho 3B nativo.
3. `[PASS]` Blueprint 1.1 sem overlays renderiza com contrato 1.1.
4. `[PASS]` Style `performance_reels_v1` resolve com `style_hash` correto.
5. `[PASS]` Style `clean_modern_v1` resolve com `style_hash` único.
6. `[PASS]` Style com `style_id` inexistente rejeitado com erro fail-fast.
7. `[PASS]` Style com `version` inexistente rejeitado com erro fail-fast.
8. `[PASS]` Mutação interna em parâmetro do style altera `style_hash`.
9. `[PASS]` Alteração de `style_id` altera a `render_key`.
10. `[PASS]` Overlay `headline` renderizado na safe area superior.
11. `[PASS]` Overlay `price_badge` renderizado na safe area inferior.
12. `[PASS]` Overlay `location_tag` renderizado.
13. `[PASS]` Overlay `cta_banner` renderizado.
14. `[PASS]` Overlay com `caption_segment` dentro de overlays rejeitado.
15. `[PASS]` Captions sincronizadas validadas na timeline correta.
16. `[PASS]` Rejeição de overlays com IDs duplicados.
17. `[PASS]` Rejeição de overlays com `layer_order` duplicado.
18. `[PASS]` Ordem de renderização respeita `layer_order` ascendente.
19. `[PASS]` Rejeição de preset de overlay desconhecido.
20. `[PASS]` Rejeição de overlay fora da duração total do vídeo.
21. `[PASS]` Rejeição de overlay com `start_ms >= end_ms`.
22. `[PASS]` Rejeição de overlay com texto vazio ou nulo.
23. `[PASS]` Rejeição de Blueprint com mais de 20 overlays.
24. `[PASS]` Rejeição de overlay com texto acima de 250 caracteres.
25. `[PASS]` Rejeição de overlay que excede a safe area física calculada.
26. `[PASS]` Sanitização de string hostil com `:` e `\` tratada puramente como texto.
27. `[PASS]` Sanitização de string hostil com `'` e `%`.
28. `[PASS]` Sanitização de string hostil com `[` e `]`.
29. `[PASS]` Sanitização de string hostil com `,`, `;` e `=`.
30. `[PASS]` Caracteres acentuados PT-BR renderizados perfeitamente no MP4.
31. `[PASS]` Prova física de frame: overlay ausente antes de `start_ms` (PNG frame 0.05s).
32. `[PASS]` Prova física de frame: overlay presente e visível entre `start_ms` e `end_ms` (PNG frame 1.5s).
33. `[PASS]` Prova física de frame: overlay ausente após `end_ms` (PNG frame 7.95s).
34. `[PASS]` Prova física de fade in: modulação gradual de alpha comprovada em frames.
35. `[PASS]` Prova física de punch zoom: escala destacada no badge de preço comprovada em frame.
36. `[PASS]` Alteração em qualquer texto de overlay altera a `render_key`.
37. `[PASS]` Alteração no timing de overlay altera a `render_key`.
38. `[PASS]` Idempotência: mesma receita gera retorno imediato (33ms).
39. `[PASS]` Concorrência: claim atômico PostgreSQL bloqueia renderizações simultâneas.
40. `[PASS]` Cleanup 100% autônomo de `.tmp` após falha de QC.
41. `[PASS]` Saída física possui estritamente H.264 1080x1920@30fps.
42. `[PASS]` Saída física possui áudio AAC stereo 44100Hz.
43. `[PASS]` Sincronismo entre áudio e vídeo mantido.
44. `[PASS]` Recuperação controlada de READY corrompido com re-claim e renderização íntegra.
45. `[PASS]` Modo Shadow 3C gera arquivo `shadow_3c_` sem mutar campos oficiais da Fase 2C.
46. `[PASS]` Endpoint `/compose-shadow-3c/:index` responde HTTP 200 com specs completas.
47. `[PASS]` Endpoint `/shadow-3c-video/:index` realiza streaming autenticado do MP4 3C.
48. `[PASS]` Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200).
49. `[PASS]` WhatsApp V1 (`video_anuncios_engine.js`) permanece 100% íntegro e operacional.
50. `[PASS]` Bloqueio estático 403 em `/outputs/jobs/` e saúde de PM2/PostgreSQL mantidos.

---

## 4. Invariantes de Segurança e Preservação

- **Nenhum arquivo ou rota de produção foi impactado:** O job showcase `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` (Fase 2C) e o bot de WhatsApp V1 continuam plenamente operacionais.
- **Zero migrações no banco de dados:** A coluna `video_assets.asset_type` já suportava `shadow_creative_3c`.
- **Total Isolamento do Shadow Mode:** Vídeos da Fase 3C utilizam prefixo `shadow_3c_` e tipo `shadow_creative_3c`, sem alterar colunas `pilot_video_url`, `video2_url` ou `video3_url` da tabela `video_jobs`.
