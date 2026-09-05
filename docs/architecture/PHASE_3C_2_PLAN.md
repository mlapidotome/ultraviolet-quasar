# Arquitetura e Plano de Implementação — Fase 3C.2 (Hardening Pós-Revisão Externa)
## B-Roll Dinâmico + Picture-in-Picture (PIP) no Video Composer Engine
### Video Engine V2 — Bali Imóveis

**Status:** Planejamento Arquitetural Hardened (PLAN ONLY — Aguardando Aprovação para Implementação)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 3C.1):** `f7934118fcee38072af598de83704b57273d6ccf`  
**Showcase Visual Homologado:** Job `c3c10000-0000-4000-8000-000000001639` (Ref CRM: `1639`)  
**Escopo:** Especificação técnica rigorosa, determinística e exaustiva da evolução do Video Composer para suporte a **B-Roll Multicamada de Imóveis (Fotos & Clipes de Vídeo)**, **Ken Burns Controlado com Determinismo Temporal**, **Picture-in-Picture (PIP) com Sincronização Estrita de Lip-Sync**, **Apresentador Fullscreen como Cidadão de Primeira Classe na Timeline**, **Transições Determinísticas (Cut & Crossfade)**, **Evolução para Creative Blueprint 1.2 (`composer_v3`)**, **Preservação Byte-Safe dos Caminhos 1.0 e 1.1** e **Garantia de Não-Regeneração de Avatar/Voz ("Never Redo What Was Produced Correctly")**.

---

## 1. Contexto, Diagnóstico & Princípios Arquiteturais

### 1.1 Diagnóstico do Baseline Atual (Fase 3C.1)
Na Fase 3C.1, o Composer atingiu a capacidade de renderizar com precisão matemática:
- **Editing Styles versionáveis** com `style_hash` intrínseco;
- **Overlays dinâmicos em Safe Areas** (Headlines, Badges com Punch Zoom, Location Tags, CTA Banners);
- **Legendas sincronizadas** com fontes TrueType oficiais.

**O Gargalo Visual Identificado pelo Marcel:**
O vídeo resultante ainda repousa sobre **uma única imagem estática do imóvel de fundo durante todo o desenvolvimento (30+ segundos)**, transmitindo uma sensação de vídeo estático com apresentador falando.

### 1.2 Objetivo da Fase 3C.2
Capacitar o Composer a construir uma **narrativa visual rica e dinâmica**, orquestrando múltiplos assets do imóvel ao longo do tempo:
- **Apresentador Fullscreen** na introdução/gancho (0.0s – 2.0s) como elemento nativo da timeline visual;
- **Cortes dinâmicos de B-roll** (Sala $\rightarrow$ Cozinha $\rightarrow$ Varanda Gourmet $\rightarrow$ Suíte Master);
- **Ken Burns suave e temporalmente determinístico** para fotos de alta resolução;
- **Apresentador em Picture-in-Picture (PIP)** em momentos-chave sobre as imagens do imóvel com sincronização temporal e lip-sync preservado;
- **Clipes de vídeo reais** do imóvel (filmagem vertical, tour ou drone) intercalados com a fala.

### 1.3 Separação Rígida de Responsabilidades

$$\begin{array}{ccc}
\boxed{\text{\bf Creative Intelligence (Fase Futura)}} & \xrightarrow{\text{decide O QUE e QUANDO exibir}} & \boxed{\text{\bf Creative Blueprint 1.2}} \\
\text{\small Análise semântica da copy, seleção de fotos,} & & \text{\small Contrato JSON puramente declarativo} \\
\text{\small marcação de momentos de PIP e B-roll} & & \text{\small com timelines, geometrias e trims} \\
& & \downarrow \\
& & \boxed{\text{\bf Video Composer 3C.2 (Esta Fase)}} \\
& & \text{\small Executor determinístico FFmpeg,} \\
& & \text{\small sem heurísticas, puro e auditável}
\end{array}$$

- **O Composer NÃO toma decisões criativas:** Ele NÃO escolhe fotos, não adivinha ambientes, não move janelas de PIP por conta própria e não altera tempos de transição.
- **O Composer valida e executa:** Se o Blueprint contém colisões espaço-temporais ou geometrias inválidas, o Composer rejeita fail-fast no validador. Se o Blueprint é válido, o Composer renderiza com 100% de determinismo.

---

## 2. Invariantes Arquiteturais Preservadas

1. **Retrocompatibilidade Estrita:**
   - Blueprints com `schema_version: "1.0"` continuam executando via caminho **`composer_v1`** (Fase 3B).
   - Blueprints com `schema_version: "1.1"` continuam executando via caminho **`composer_v2`** (Fase 3C.1).
   - Blueprints com `schema_version: "1.2"` executarão via novo caminho **`composer_v3`** (Fase 3C.2).
2. **Never Redo What Was Produced Correctly:**
   - Alterações em fotos, B-rolls, timings de corte ou posicionamento de PIP **NUNCA** disparam novas requisições à HeyGen ou nova síntese de áudio.
   - Os assets de avatar/áudio existentes no catálogo (`video_assets`) são reutilizados como inputs puros do Composer.
3. **Render Identity Determinística (`render_key`):**
   - Hashing canônico SHA-256 de todas as entradas que afetam pixels e áudio (Blueprint 1.2, `style_hash`, trims, geometrias de PIP, motions e `file_hash` de cada imagem e clipe físico).
4. **Claim Atômico Persistente no PostgreSQL:**
   - Nenhum processo FFmpeg é iniciado sem claim adquirido (`claimRenderLock`) com lease e stale recovery.
5. **Asset Identity Estrita & Verificação Física de Bytes:**
   - Proibido qualquer directory scanning ou fallback heurístico no filesystem.
   - No momento do render, o Composer resolve o asset via `asset_service`, valida ownership do Job, confirma existência em disco e valida o `file_hash` SHA-256 físico antes de disparar o FFmpeg.
6. **Contrato de Saída Imutável & QC Físico:**
   - Saída atômica via `.tmp.<uuid>.mp4` e promoção por rename atômico após validação rigorosa por `ffprobe` (1080x1920@30fps, H.264/AAC, duração com tolerância máxima de 250ms).

---

## 3. Especificação do Contrato: Creative Blueprint 1.2

### 3.1 JSON Schema Formal do Creative Blueprint 1.2

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CreativeBlueprint_v1_2",
  "type": "object",
  "required": [
    "schema_version",
    "creative_id",
    "blueprint_version",
    "format",
    "editing_style",
    "audio_track",
    "visual_timeline"
  ],
  "properties": {
    "schema_version": { "type": "string", "enum": ["1.2"] },
    "creative_id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,64}$" },
    "blueprint_version": { "type": "integer", "minimum": 1 },
    "format": {
      "type": "object",
      "required": ["aspect_ratio", "width", "height", "fps"],
      "properties": {
        "aspect_ratio": { "type": "string", "enum": ["9:16"] },
        "width": { "type": "integer", "enum": [1080] },
        "height": { "type": "integer", "enum": [1920] },
        "fps": { "type": "integer", "enum": [30] }
      }
    },
    "editing_style": {
      "type": "object",
      "required": ["style_id", "version"],
      "properties": {
        "style_id": { "type": "string" },
        "version": { "type": "integer", "minimum": 1 }
      }
    },
    "audio_track": {
      "type": "object",
      "required": ["primary_asset_id"],
      "properties": {
        "primary_asset_id": { "type": "string" },
        "source_in_ms": { "type": ["integer", "null"], "minimum": 0 },
        "source_out_ms": { "type": ["integer", "null"], "minimum": 0 },
        "broll_audio_policy": { 
          "type": "string", 
          "enum": ["mute_all_broll"],
          "default": "mute_all_broll" 
        }
      }
    },
    "visual_timeline": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["asset_id", "asset_type", "start_ms", "end_ms"],
        "properties": {
          "id": { "type": "string" },
          "asset_id": { "type": "string" },
          "asset_type": { "type": "string", "enum": ["image", "video"] },
          "role": { "type": "string" },
          "start_ms": { "type": "integer", "minimum": 0 },
          "end_ms": { "type": "integer", "minimum": 1 },
          "source_in_ms": { "type": ["integer", "null"], "minimum": 0 },
          "source_out_ms": { "type": ["integer", "null"], "minimum": 0 },
          "fit": { "type": "string", "enum": ["cover", "contain"], "default": "cover" },
          "motion": {
            "type": "object",
            "properties": {
              "type": { 
                "type": "string", 
                "enum": ["static", "ken_burns_zoom_in", "ken_burns_zoom_out", "pan_left", "pan_right"] 
              },
              "start_scale": { "type": "number", "minimum": 1.0, "maximum": 1.30, "default": 1.00 },
              "target_scale": { "type": "number", "minimum": 1.0, "maximum": 1.30, "default": 1.10 }
            }
          },
          "transition_in": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["cut", "crossfade"] },
              "duration_ms": { "type": "integer", "minimum": 100, "maximum": 600, "default": 250 }
            }
          }
        }
      }
    },
    "pip": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "asset_id": { "type": "string" },
        "windows": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["start_ms", "end_ms", "position", "shape"],
            "properties": {
              "start_ms": { "type": "integer", "minimum": 0 },
              "end_ms": { "type": "integer", "minimum": 1 },
              "source_in_ms": { "type": ["integer", "null"], "minimum": 0 },
              "source_out_ms": { "type": ["integer", "null"], "minimum": 0 },
              "position": {
                "type": "string",
                "enum": ["bottom_right", "bottom_left", "center_right", "custom"]
              },
              "geometry": {
                "type": "object",
                "properties": {
                  "width": { "type": "integer", "minimum": 120, "maximum": 1080 },
                  "height": { "type": "integer", "minimum": 120, "maximum": 1920 },
                  "x": { "type": "integer", "minimum": 0, "maximum": 1080 },
                  "y": { "type": "integer", "minimum": 0, "maximum": 1920 }
                }
              },
              "shape": { 
                "type": "string", 
                "enum": ["rounded_rect", "circle", "rectangle"],
                "default": "rounded_rect"
              },
              "border": {
                "type": "object",
                "properties": {
                  "width": { "type": "integer", "minimum": 0, "maximum": 16, "default": 4 },
                  "color": { "type": "string", "default": "#FFFFFF" },
                  "radius": { "type": "integer", "minimum": 0, "maximum": 180, "default": 24 }
                }
              },
              "transition_in": {
                "type": "object",
                "properties": {
                  "type": { "type": "string", "enum": ["cut", "fade"] },
                  "duration_ms": { "type": "integer", "minimum": 50, "maximum": 500, "default": 200 }
                }
              },
              "transition_out": {
                "type": "object",
                "properties": {
                  "type": { "type": "string", "enum": ["cut", "fade"] },
                  "duration_ms": { "type": "integer", "minimum": 50, "maximum": 500, "default": 200 }
                }
              }
            }
          }
        }
      }
    },
    "overlays": { "type": "array" },
    "captions": { "type": "array" }
  }
}
```

---

## 4. Regras Formais de Validação Fail-Fast

### 4.1 Audio Master & Política Estrita de B-Roll (Decisão 1)
- **Áudio Master:** O áudio é exclusivamente proveniente do `primary_asset_id` (vídeo/áudio do apresentador gerado pela HeyGen).
- **B-Roll Muted:** A opção `duck_broll_background` foi **completamente removida do contrato**. O valor é estritamente `broll_audio_policy: "mute_all_broll"`. Qualquer trilha de áudio embutida em clipes de vídeo de B-roll é descartada via mapeamento FFmpeg (`-map [outa]` derivado exclusivamente do master audio).

### 4.2 Proporcionalidade Estrita 1:1 de Trim (Sem Speed-up/Slow-mo) (Decisão 2)
Para clipes de vídeo na `visual_timeline` ou janelas de `pip`:
$$\text{source\_out\_ms} - \text{source\_in\_ms} \equiv \text{end\_ms} - \text{start\_ms}$$
- **Proibição Estrita:** A Fase 3C.2 **NÃO suporta** speed ramp, slow motion, fast motion ou time stretching. 1 segundo de arquivo físico de vídeo corresponde a exatamente 1 segundo de timeline.
- Se a diferença de trims divergir da duração na timeline, o validador lança erro imediato: `[COMPOSER VALIDATION ERROR] Divergência de duração: source trim (Xms) deve ser exatamente igual à duração do segmento na timeline (Yms). Alteração de playback rate não é suportada na Fase 3C.2.`

### 4.3 Imagens vs Trims (Decisão 8)
- Para assets com `asset_type: "image"`:
  - `source_in_ms` e `source_out_ms` **DEVEM ser nulos ou omitidos**.
  - A presença de valores inteiros de trim para imagem dispara erro de validação: `[COMPOSER VALIDATION ERROR] Segmento de imagem não aceita source_in_ms/source_out_ms`.
  - A duração visual da imagem decorre exclusivamente de $\text{end\_ms} - \text{start\_ms}$.
- Para assets com `asset_type: "video"`:
  - Trims são bilaterais obrigatórios quando fornecidos ($0 \le \text{source\_in\_ms} < \text{source\_out\_ms} \le \text{duration\_fisica}$).

### 4.4 Semântica Estrita de Sobreposição na Timeline (Decisão 6)
- **Primeiro Segmento:** O primeiro clipe da timeline inicia estritamente em $\text{start\_ms} = 0$, e seu `transition_in` deve ser `none` ou `cut` (sem crossfade vindo do vazio).
- **Transição CUT:** Segmentos adjacentes $i$ e $i+1$ devem satisfazer $\text{start\_ms}_{i+1} = \text{end\_ms}_i$.
- **Transição CROSSFADE:** O segmento $i+1$ tem $\text{start\_ms}_{i+1} = \text{end\_ms}_i - \text{duration\_ms}$. A sobreposição é autorizada **estritamente e unicamente** pelo valor de `duration_ms` da transição.
- **Proibições:**
  - **Gaps:** Proibido qualquer gap temporal ($\text{start\_ms}_{i+1} > \text{end\_ms}_i$).
  - **Overlaps Arbitrários:** Proibida sobreposição que não corresponda exatamente ao `duration_ms` de um crossfade declarado.
  - **Cobertura Total:** A timeline visual somada deve cobrir 100% da duração do áudio master (tolerância $\le 250\text{ms}$).

---

## 5. Validação Espaço-Temporal de Safe Areas & PIP (Sem Hardcoded Y)

### 5.1 Princípio da Não-Suposição Estática (Decisão 3)
A validação de colisão do PIP **NÃO utiliza constantes mágicas de $y$ (como $y \in [1100, 1400]$)**. A validação é dinâmica e orientada a caixas delimitadoras (bounding boxes) resolvidas:

$$\text{Box}(A) = [x_{\min}, x_{\max}, y_{\min}, y_{\max}]$$
$$\text{Interval}(A) = [t_{\text{start}}, t_{\text{end}}]$$

### 5.2 Algoritmo de Colisão Espaço-Temporal
Dois elementos gráficos $A$ e $B$ colidem se, e somente se, houver **interseção espacial E interseção temporal simultâneas**:

$$\text{Interseção Temporal: } \max(t_{\text{start}}^A, t_{\text{start}}^B) < \min(t_{\text{end}}^A, t_{\text{end}}^B)$$
$$\text{Interseção Espacial X: } \max(x_{\min}^A, x_{\min}^B) < \min(x_{\max}^A, x_{\max}^B)$$
$$\text{Interseção Espacial Y: } \max(y_{\min}^A, y_{\min}^B) < \min(y_{\max}^A, y_{\max}^B)$$

$$\text{COLISÃO} \iff \text{Interseção Temporal} \land \text{Interseção Espacial X} \land \text{Interseção Espacial Y}$$

**Cenários Exemplares:**
1. **PIP em `bottom_right` ($t \in [5s, 10s]$) vs CTA em `bottom_safe` ($t \in [30s, 38s]$):**
   - Interseção espacial: $\text{SIM}$.
   - Interseção temporal: $\text{NÃO}$ ($\max(5, 30) = 30 \not< \min(10, 38) = 10$).
   - **Resultado:** **VÁLIDO (PASS)** — Elementos coexistem na mesma região em momentos distintos.
2. **PIP em `bottom_right` ($t \in [28s, 34s]$) vs CTA em `bottom_safe` ($t \in [30s, 38s]$):**
   - Interseção espacial: $\text{SIM}$.
   - Interseção temporal: $\text{SIM}$ ($[30s, 34s]$).
   - **Resultado:** **ERRO DE VALIDAÇÃO (FAIL-FAST)** — O Composer rejeita o Blueprint antes do FFmpeg.

### 5.3 Resolução Determinística de Presets de PIP (Decisão 4)
O Blueprint Validator resolve presets para coordenadas canônicas com base no `resolved_style`:
- `bottom_right`: $x = 680, y = 1140, w = 340, h = 510$
- `bottom_left`: $x = 60, y = 1140, w = 340, h = 510$
- `center_right`: $x = 680, y = 700, w = 340, h = 510$
- `custom`: Exige obrigatoriamente $x, y, w, h$ explícitos.
- **Validações Físicas:** $x \ge 0$, $y \ge 0$, $w > 0$, $h > 0$, $x + w \le 1080$, $y + h \le 1920$.

---

## 6. Apresentador Fullscreen & Sincronização de Lip-Sync no PIP

### 6.1 Apresentador Fullscreen como Cidadão Nativo da Timeline (Decisão 5)
O apresentador/avatar **NÃO é tratado como exceção procedural** no código do Composer:
- O mesmo asset ID do apresentador (`ast_avatar_...`) pode ser referenciado diretamente na `visual_timeline` como um segmento de vídeo fullscreen (ex: de 0.0s a 2.0s com `role: "presenter_fullscreen"`).
- O Asset Model do catálogo (`video_assets` + `asset_service`) já suporta isso nativamente sem nenhuma alteração estrutural.

### 6.2 Sincronização Temporal Estrita de Lip-Sync no PIP (Decisão 10)
Quando o apresentador aparece em janela de PIP sobre um B-roll no intervalo da timeline $[t_{\text{start}}, t_{\text{end}}]$, o trecho de vídeo do apresentador exibido dentro da janela deve corresponder **exatamente ao mesmo momento de fala do áudio master**:

$$\text{source\_in\_ms} = t_{\text{start}} + \text{master\_audio\_offset\_ms}$$
$$\text{source\_out\_ms} = t_{\text{end}} + \text{master\_audio\_offset\_ms}$$

- **Proibição de Reset:** É expressamente proibido reiniciar o vídeo do apresentador em $t=0$ no início da janela de PIP.
- O Composer compila o trim do stream de PIP sincronizado frame a frame com o áudio master, garantindo **perfeito lip-sync visual**.

---

## 7. Ken Burns Temporalmente Determinístico (Decisão 9)

Em vez de incrementar o zoom por frame com constantes fixas arbitrárias, o Ken Burns deriva da duração exata do clipe:

$$N = \text{round}(\text{duration\_sec} \times 30\text{fps})$$
$$z(f) = z_{\text{start}} + (z_{\text{target}} - z_{\text{start}}) \times \frac{f}{N} \quad (f \in [0, N])$$

**Expressão FFmpeg Canônica:**
```text
zoompan=z='1.0+(0.10*on/d)':d=150:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30
```
- Onde $d = \text{round}(\text{duration\_sec} \times 30)$.
- **Garantia:** Um clipe de 2s ($d=60$) e um clipe de 5s ($d=150$) atingem deterministicamente a escala exata de $1.10\times$ no seu último frame.

---

## 8. Z-Order / Pilha Canônica de Camadas

$$\begin{array}{cll}
\text{\bf Layer} & \text{\bf Camada Visual} & \text{\bf Descrição Técnica} \\
\hline
\text{\bf L0} & \text{Background B-Roll Timeline} & \text{Fotos Ken Burns + Clipes de vídeo + Transições (1080x1920)} \\
\text{\bf L1} & \text{Presenter PIP} & \text{Avatar em janela mascarada (círculo/retângulo) nos intervalos ativos} \\
\text{\bf L2} & \text{Editing Style Graphic Overlays} & \text{Headline Superior, Badge de Preço (Punch Zoom), Location Tag} \\
\text{\bf L3} & \text{Dynamic Captions} & \text{Legendas sincronizadas sem colisão com PIP} \\
\text{\bf L4} & \text{Conversion CTA Banner} & \text{Banner de fechamento na safe area inferior}
\end{array}$$

---

## 9. Render Identity Canônica (`render_key` — `composer_v3`) (Decisão 7 & 11)

A `render_key` do Blueprint 1.2 incorpora:
1. `schema_version: "1.2"` e `composer_contract_version: "composer_v3"`;
2. `creative_id` e `blueprint_version`;
3. `format` canônico ($1080 \times 1920 @ 30\text{fps}$);
4. `editing_style` com `style_hash` físico do preset;
5. `audio_track` canônico (`primary_asset_id`, trims, `broll_audio_policy: "mute_all_broll"`);
6. `visual_timeline` canônica (ordenada por `start_ms`, com trims, `fit`, `motion` calibrado e `transition_in` com `duration_ms`);
7. `pip` canônico (com janelas resolvidas, geometrias $x, y, w, h$, shapes, bordas e trims de lip-sync);
8. `overlays` e `captions` canônicos sanitizados;
9. `input_assets`: Lista ordenada de **todos os assets físicos participantes** (áudio master, apresentador e todas as fotos/vídeos de B-roll), contendo `asset_id` e o `file_hash` SHA-256 verificado fisicamente no momento do render.

$$\text{render\_key} = \text{SHA256}(\text{canonicalStringify}(\text{renderSpec12}))$$

---

## 10. Matriz de Homologação e Testes Físicos (Fase 3C.2) (Decisão 12)

A suíte `tests/video_engine/phase3c2_composer_tests.js` executará os 13 testes mandatórios:

| Teste | Descrição do Cenário | Resultado Esperado |
| :--- | :--- | :--- |
| **A** | **Fullscreen $\to$ B-Roll $\to$ PIP:** Timeline combinando apresentador fullscreen, fotos e PIP | **PASS** (Vídeo renderizado com as 3 etapas visíveis) |
| **B** | **PIP Lip-Sync Sync:** Verificação temporal de que o trecho do apresentador em PIP corresponde ao áudio master | **PASS** (Frames de áudio e vídeo do PIP temporalmente congruentes) |
| **C** | **PIP & CTA mesma geometria, tempos diferentes:** PIP $t \in [5s, 10s]$ e CTA $t \in [30s, 35s]$ em $y=1200$ | **PASS** (Validador aprova por não haver interseção temporal) |
| **D** | **PIP & CTA mesma geometria, tempos simultâneos:** PIP $t \in [28s, 33s]$ e CTA $t \in [30s, 35s]$ em $y=1200$ | **FAIL** (Validador rejeita por colisão espaço-temporal) |
| **E** | **Primeiro segmento com crossfade:** $t=0$ com `transition_in: crossfade` | **FAIL** (Validador rejeita crossfade vindo do vazio) |
| **F** | **Gap na Timeline:** $t_1 = [0, 2000\text{ms}]$ e $t_2 = [2033\text{ms}, 4000\text{ms}]$ (gap de 1 frame) | **FAIL** (Validador rejeita descontinuidade) |
| **G** | **Overlap arbitrário:** $t_1 = [0, 3000\text{ms}]$ e $t_2 = [2500\text{ms}, 5000\text{ms}]$ com `transition_in: cut` | **FAIL** (Validador rejeita sobreposição sem crossfade) |
| **H** | **Imagem com Source Trim:** Asset de imagem fornecendo `source_in_ms: 100` | **FAIL** (Validador rejeita trim em imagem estática) |
| **I** | **Vídeo B-Roll com Trim Comprovado:** Clipe de 10s com trim de $[2s, 5s]$ | **PASS** (Duração e conteúdo conferem exatamente com o trecho cortado) |
| **J** | **Sensibilidade de Render Key (Transição):** Mesma receita alterando `duration_ms` de 250ms para 300ms | **PASS** (Gera `render_key` distinta comprovada) |
| **K** | **Sensibilidade de Render Key (File Hash):** Alteração de 1 byte na foto do imóvel | **PASS** (Gera `render_key` distinta ou rejeita por divergência de hash) |
| **L** | **Zero Regressão Blueprint 1.0 (3B):** Execução de blueprint 1.0 produzindo pipeline 3B idêntico | **PASS** (Compatibilidade byte-safe comprovada) |
| **M** | **Zero Regressão Blueprint 1.1 (3C.1):** Execução de blueprint 1.1 produzindo pipeline 3C.1 idêntico | **PASS** (Compatibilidade byte-safe comprovada) |

---

## 11. Critério de Homologação Visual Obrigatório: Showcase 3C.2 (Decisão 13)

A Fase 3C.2 **NÃO será considerada concluída apenas pela aprovação da suíte automatizada**.

### Requisito Obrigatório de Fechamento:
1. Geração de um **Showcase Oficial da Fase 3C.2** com imóvel real do CRM (Ref: `1639`);
2. O vídeo deve conter obrigatoriamente:
   - Apresentador Fullscreen no Gancho ($0.0s – 2.0s$);
   - B-Roll 1 (Fachada com Ken Burns Zoom-in);
   - B-Roll 2 (Sala com Pan suave);
   - B-Roll 3 (Cozinha/Varanda com corte seco);
   - Apresentador em PIP (Círculo ou Retângulo arredondado com Lip-Sync) sobre a Suíte Master;
   - B-Roll 4 com Overlays da Fase 3C.1 (Headline, Preço com Punch Zoom, Tag de Localização e CTA Final);
3. O vídeo deve ser disponibilizado no painel web sob a identificação clara **"🎬 Showcase Homologação Fase 3C.2 (B-Roll + PIP)"**;
4. **Homologação humana obrigatória pelo Marcel** antes do merge e encerramento da fase.

---

## 12. Escopo Estritamente Controlado (Decisão 14)

Os seguintes itens continuam **explicitamente fora de escopo** da Fase 3C.2:
- Inteligência semântica LLM para escolha autônoma de fotos;
- Download/scraping automático de mídias externas;
- Integração com Meta Ads API;
- Editor visual drag-and-drop no frontend;
- Speed ramp, slow motion ou playback rate variável;
- Mixagem avançada de áudio ou ducking dinâmico;
- Dezenas de transições complexas (foco estrito em `cut` e `crossfade`).

---

**FIM DO DOCUMENTO DE PLANEJAMENTO DA FASE 3C.2 (HARDENED)**  
*Pronto para revisão externa final e emissão de autorização de implementação.*
