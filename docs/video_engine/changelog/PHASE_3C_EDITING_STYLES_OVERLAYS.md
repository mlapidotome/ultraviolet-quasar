# Changelog: Fase 3C.1 — Editing Styles & Overlays Dinâmicos (MVP) — Final Hardening

**Data:** 05/09/2026  
**Status:** Fase 3C.1 — Final Hardening implementado e homologado localmente — aguardando revisão externa.  
**Repositório:** `mlapidotome/facade-checker`  
**Branch:** `main`  
**Commit Base 3B:** `a215799dea6740ef4ff2e59ae55837ef47c7f6ba`  
**Commit do Plano Aprovado:** `7635bde6d9e519724c30f8078d8299153762bb8`

---

## 1. Resumo Executivo das Correções de Final Hardening

Após revisão externa do código real da Fase 3C.1, foram aplicadas correções estritas e aprofundadas:

1. **Testes Visuais Físicos com Comparação Contra Controle (Cenários 34 a 40):**
   - Eliminação de qualquer falso positivo baseado em simples diferença entre frames (`PNG A != PNG B`).
   - Implementação de analisador determinístico de pixels RGB24 comparando o frame do render 3C com o frame controle do mesmo vídeo base no mesmo timestamp exato.
   - Prova física matemática de ausência de overlay antes de `start_ms` (< 5 px de diferença).
   - Prova física de presença de overlay durante `[start_ms, end_ms]` (> 5000 px alterados).
   - Prova física de retorno à ausência de overlay após `end_ms` (< 5 px de diferença).
   - Prova física de contenção estrita do bounding box de pixels alterados dentro da `top_safe` area.
   - Prova física de `fade in` medindo o aumento gradual e coerente de opacidade entre início e fim da transição (> 1.5x).
   - Prova física de `punch zoom` comprovando bounding box e largura maiores nos primeiros 150ms do `price_badge` e retorno ao tamanho nominal sem zoom no vídeo base.
   - Prova negativa de `punch zoom` comprovando que `headline` nunca sofre alteração de escala.

2. **Safe Area com Métricas Proporcionais Reais (Cenários 25 e 26):**
   - Substituição de estimativas lineares fixas por tabela de pesos proporcionais reais (`getCharacterWidthFactor`) calibrada para as fontes sans-serif do servidor (`DejaVuSans`, `LiberationSans`).
   - Teste determinístico provando que caracteres muito largos (`"WWWWWWWWWWWWWWWWWWWW"`) excedem a safe area física e geram fail-fast (`[LAYOUT OVERFLOW ERROR]`), enquanto caracteres estreitos (`"iiiiiiiiiiiiiiiiiiii"`) cabem e são aceitos.

3. **Whitelist Estrita de Compatibilidade Tipo-Preset (Cenários 11 a 14):**
   - Cada preset declara explicitamente `supported_types` (`bold_headline` -> `headline`, `price_punch` -> `price_badge`, `location_badge` -> `location_tag`, `cta_bar` -> `cta_banner`).
   - Validação com fail-fast rejeitando combinações semânticas inválidas como `headline + price_punch` ou `price_badge + cta_bar`.

4. **Regressão Congelada Blueprint 1.0 (Cenário 2):**
   - Fixture de regressão comparando a `render_key` de receitas 1.0 byte-a-byte contra o hash congelado da implementação homologada da Fase 3B (`a215799dea6740ef4ff2e59ae55837ef47c7f6ba`).
   - Verificação estrita de ausência de `editing_style`, `style_hash`, `overlays`, `captions` ou campos `composer_v2`.

5. **Hardening de Segurança nas Rotas Shadow 3C (Cenários 54 a 56):**
   - Validação de formato UUID (`UUID_REGEX`) em todas as rotas `/compose-shadow-3c/:index`, `/shadow-3c-video/:index` e `/compare-shadow-3c/:index`.
   - Contenção física estrita de diretório usando `path.resolve`, `path.relative` e `fs.realpathSync` contra symlink escapes e path traversal.
   - Omissão de `storage_path` físico na resposta da rota `GET /compare-shadow-3c/:index`.

6. **Layout Físico de Captions (Cenários 41 a 43):**
   - Safe area dedicada para legendas (`safe_rectangles.captions`).
   - Validação determinística de wrapping e bounding box com fail-fast para textos excessivos.
   - Prova física contra controle demonstrando aparição das legendas na região inferior permitida.

7. **Teste Físico FFmpeg com String Hostil Completa (Cenário 32):**
   - Renderização física com string contendo `:`, `\`, `'`, `%`, `[`, `]`, `,`, `;`, `=`, quebras de linha e acentos PT-BR, confirmando imunidade absoluta a filter injection sem quebrar o FFmpeg.

---

## 2. Resultados da Suíte Completa de Homologação (61/61 PASS)

```text
================================================================
 HOMOLOGAÇÃO AUTOMATIZADA COMPLETA — FASE 3C.1 (FINAL HARDENING)
================================================================

✅ [PASSOU] [Cenário 1] Validação de boot: todas as fontes de todos os styles existem fisicamente no servidor
✅ [PASSOU] [Cenário 2] Regressão Blueprint 1.0: render_key é 100% idêntica byte-a-byte à fórmula congelada da 3B
✅ [PASSOU] [Cenário 3] Blueprint 1.0 renderiza nativamente no caminho 3B sem poluição 1.1
✅ [PASSOU] [Cenário 4] Blueprint 1.1 sem overlays renderiza no caminho 3C.1 com composer_v2
✅ [PASSOU] [Cenário 5] Style performance_reels_v1 resolve com style_hash SHA-256
✅ [PASSOU] [Cenário 6] Style clean_modern_v1 possui style_hash distinto
✅ [PASSOU] [Cenário 7] Style inexistente é rejeitado com erro fail-fast
✅ [PASSOU] [Cenário 8] Versão inexistente de style é rejeitada com fail-fast
✅ [PASSOU] [Cenário 9] Mutação interna em parâmetro do style altera o style_hash determinístico
✅ [PASSOU] [Cenário 10] Alteração de style_id altera a render_key
✅ [PASSOU] [Cenário 11] Combinação válida (headline + bold_headline) aceita pela whitelist
✅ [PASSOU] [Cenário 12] Combinação headline + price_punch rejeitada com erro fail-fast
✅ [PASSOU] [Cenário 13] Combinação price_badge + cta_bar rejeitada com erro fail-fast
✅ [PASSOU] [Cenário 14] Combinação cta_banner + location_badge rejeitada com erro fail-fast
✅ [PASSOU] [Cenário 15] Uso de caption_segment dentro de overlays rejeitado
✅ [PASSOU] [Cenário 16] IDs duplicados de overlays rejeitados
✅ [PASSOU] [Cenário 17] layer_order duplicado rejeitado
✅ [PASSOU] [Cenário 18] Ordem de nós do filtergraph respeita estritamente layer_order ASC
✅ [PASSOU] [Cenário 19] Preset de overlay inexistente rejeitado
✅ [PASSOU] [Cenário 20] Overlay com end_ms excedendo a duração do vídeo rejeitado
✅ [PASSOU] [Cenário 21] Overlay com start_ms >= end_ms rejeitado
✅ [PASSOU] [Cenário 22] Overlay com texto vazio rejeitado
✅ [PASSOU] [Cenário 23] Blueprint com mais de 20 overlays rejeitado
✅ [PASSOU] [Cenário 24] Overlay com texto acima de 250 caracteres rejeitado
✅ [PASSOU] [Cenário 25] Métricas proporcionais: texto de 20 "W"s excede a safe area física e gera fail-fast
✅ [PASSOU] [Cenário 26] Métricas proporcionais: texto de 20 "i"s cabe perfeitamente na safe area (sem falso overflow)
✅ [PASSOU] [Cenário 27] Overlay com quantidade excessiva de linhas rejeitado no layout
✅ [PASSOU] [Cenário 28] Sanitização de : e \
✅ [PASSOU] [Cenário 29] Sanitização de ' e %
✅ [PASSOU] [Cenário 30] Sanitização de [ e ]
✅ [PASSOU] [Cenário 31] Sanitização de , ; e =
✅ [PASSOU] [Cenário 32] Teste FÍSICO FFmpeg com string hostil combinada (: \ ' % [ ] , ; = newline) renderiza perfeitamente
✅ [PASSOU] [Cenário 33] Caracteres acentuados PT-BR renderizados perfeitamente no MP4
✅ [PASSOU] [Cenário 34] Prova física contra controle: overlay ausente antes de start_ms (t=0.05s difere < 5 pixels)
✅ [PASSOU] [Cenário 35] Prova física contra controle: overlay presente e visível (t=1.20s possui pixels alterados)
✅ [PASSOU] [Cenário 36] Prova física contra controle: overlay ausente após end_ms (t=2.75s difere < 5 pixels na safe area superior)
✅ [PASSOU] [Cenário 37] Prova física de Safe Area: bounding box 100% contido em top_safe
✅ [PASSOU] [Cenário 38] Prova física de fade in: aumento medido de pixels/opacidade
✅ [PASSOU] [Cenário 39] Prova física de punch zoom: largura física no punch > nominal
✅ [PASSOU] [Cenário 40] Prova negativa: headline nunca recebe punch zoom (largura invariante após fade)
✅ [PASSOU] [Cenário 41] Captions sincronizadas validadas estruturalmente
✅ [PASSOU] [Cenário 42] Legenda com texto excessivo rejeitada no layout de safe area
✅ [PASSOU] [Cenário 43] Prova física contra controle: captions detectadas fisicamente na região permitida
✅ [PASSOU] [Cenário 44] Alteração em texto de overlay altera a render_key
✅ [PASSOU] [Cenário 45] Alteração no timing de overlay altera a render_key
✅ [PASSOU] [Cenário 46] Retorno idempotente imediato (< 50ms)
✅ [PASSOU] [Cenário 47] Claim atômico PostgreSQL bloqueia renderização simultânea com HTTP 409
✅ [PASSOU] [Cenário 48] Cleanup 100% autônomo de .tmp após falha de QC
✅ [PASSOU] [Cenário 49] Recuperação controlada de READY corrompido com re-claim e renderização íntegra
✅ [PASSOU] [Cenário 50] Saída física possui estritamente H.264 1080x1920@30fps
✅ [PASSOU] [Cenário 51] Saída física possui áudio AAC stereo 44100Hz
✅ [PASSOU] [Cenário 52] Sincronismo entre áudio e vídeo mantido
✅ [PASSOU] [Cenário 53] Modo Shadow 3C não altera colunas oficiais da Fase 2C
✅ [PASSOU] [Cenário 54] Rota compose-shadow-3c/:index rejeita UUID inválido com HTTP 400
✅ [PASSOU] [Cenário 55] Rota shadow-3c-video/:index rejeita UUID inválido com HTTP 400
✅ [PASSOU] [Cenário 56] Rota compare-shadow-3c/:index omite storage_path interno na resposta JSON
✅ [PASSOU] [Cenário 57] Endpoint /compose-shadow-3c/:index responde HTTP 200 com specs completas
✅ [PASSOU] [Cenário 58] Endpoint /shadow-3c-video/:index realiza streaming autenticado do MP4 3C
✅ [PASSOU] [Cenário 59] Job showcase da Fase 2C permanece 100% íntegro servindo vídeos 1, 2 e 3 (HTTP 200)
✅ [PASSOU] [Cenário 60] WhatsApp V1 (video_anuncios_engine.js): integridade física do módulo e sintaxe válida verificadas
✅ [PASSOU] [Cenário 61] Bloqueio estático 403 em /outputs/jobs/ e saúde de PM2/PostgreSQL mantidos

================================================================
 RESULTADO FINAL FASE 3C.1 (FINAL HARDENING): 61/61 CENÁRIOS HOMOLOGADOS COM SUCESSO!
================================================================
```
