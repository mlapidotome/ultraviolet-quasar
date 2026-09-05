# Arquitetura e Plano de Implementação — Fase 3C (Revisão Final)
## Editing Styles & Overlays Dinâmicos (Video Engine V2 — Bali Imóveis)

**Status:** Planejamento Arquitetural Revisado (PLAN ONLY — Aguardando Revisão Externa)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 3B Final Hardening):** `a215799dea6740ef4ff2e59ae55837ef47c7f6ba`  
**Escopo:** Especificação técnica rigorosa, determinística e definitiva da evolução do Video Composer MVP para suporte a **Editing Styles Versionáveis com Hash Físico de Configuração**, **Overlay Engine com Ordem Explícita de Camadas e Safe Rectangles**, **Tipografia Canônica Sem Fallback Silencioso**, **Defesa em Profundidade contra Injeção**, **Captions com Fonte Única de Verdade**, **Validação Física de Frames por Testes Visuais** e **Preservação Byte-Safe do Caminho 1.0**.

---

## 1. Visão Geral e Princípio Arquitetural

A Fase 3B estabeleceu o **Video Composer determinístico MVP**, responsável por montar clipes sequenciais com trims bilaterais e re-encode padronizado (H.264/AAC 1080x1920@30fps).

A **Fase 3C** avança para a **Edição Declarativa Enriquecida**:

$$\text{Creative Blueprint 1.1} + \text{Resolved Editing Style} + \text{Overlay Directives} \xrightarrow[\text{Asset Resolver}]{\text{Video Composer 3C}} \text{Vídeo Editado Final (MP4)}$$

### Princípio da Separação Estrita de Responsabilidades
O Video Composer **NÃO toma decisões criativas, não gera copy, não escolhe layouts aleatórios e não interpreta estética**:
$$\text{AI / Copy Engine / Creative Rules} \xrightarrow{\text{decide O QUE e COMO editar}} \text{Creative Blueprint 1.1} \xrightarrow{\text{executa deterministicamente}} \text{Composer 3C + FFmpeg}$$

- O **Blueprint** expressa a intenção de edição em JSON puramente declarativo.
- O **Editing Style Service** fornece presets visuais canônicos versionados com hash intrínseco.
- O **Overlay Service** compila as diretrizes declarativas em uma árvore de filtros (`filter_complex`) do FFmpeg à prova de injeção.
- O **Asset Resolver** valida ownership, existência física e hashes de qualquer artefato de entrada.
- O **Composer Engine** renderiza, inspeciona via QC e promove o artefato de forma atômica e imutável.

---

## 2. Modelo de Editing Styles & Style Identity Determinística

### 2.1 Decisão Arquitetural: Onde residem os Editing Styles?
**Decisão:** **JSON/JS Versionado no Código (`video_engine/styles/presets.js`)**.

**Justificativa Técnica:**
1. **Determinismo e Imutabilidade:** Um estilo de edição define regras de composição, espaçamentos, animações, cores e fontes. Ao versioná-lo em código Git (`style_id: "performance_reels_v1"`, `version: 1`), garantimos que a mesma versão de estilo produza exatamente os mesmos pixels em qualquer ambiente.
2. **Sem Necessidade de Migration:** Evita DDL/migrações desnecessárias no PostgreSQL nesta fase.

### 2.2 Identidade do Style: `style_hash` Intrínseco
A `render_key` **NÃO pode depender unicamente de `style_id` e `version` manual**. Se um desenvolvedor alterar um parâmetro de cor, margem ou animação dentro do preset mantendo `version: 1`, a receita física muda.

**Regra Invariante:**
$$\text{resolved\_style} = \text{resolveEditingStyle}(\text{style\_id}, \text{version})$$
$$\text{style\_hash} = \text{SHA256}(\text{canonicalStringify}(\text{resolved\_style}))$$

A `render_key` incorpora obrigatoriamente:
```javascript
editing_style: {
  style_id: resolvedStyle.id,
  version: resolvedStyle.version,
  style_hash: resolvedStyle.style_hash // SHA-256 de todas as propriedades físicas do preset!
}
```
**Invariante:** Qualquer alteração no conteúdo do preset altera o `style_hash` e, consequentemente, a `render_key`, mesmo que a versão não seja incrementada.

### 2.3 Resolução Estrita de Style (`resolveEditingStyle`)
A função `resolveEditingStyle(style_id, version)` implementa validação fail-fast rigorosa:
1. `style_id` deve constar na whitelist de estilos oficiais.
2. `version` deve ser exatamente compatível com a versão cadastrada. **Proibido assumir "latest" ou fazer fallback silencioso.**
3. Validação prévia de todas as fontes utilizadas pelo estilo contra o `FONT_REGISTRY`.
4. Retorno de objeto canônico congelado (`Object.freeze`) com `style_hash` embutido.
5. Para Blueprint 1.0: nenhum estilo é resolvido (caminho puro da Fase 3B).

### 2.4 Presets Canônicos MVP 3C.1 (Com Fontes Reais do Registry)

Todas as fontes referenciadas existem obrigatoriamente no `FONT_REGISTRY` do servidor:

```javascript
// video_engine/styles/presets.js
const presets = {
  'performance_reels_v1': {
    id: 'performance_reels_v1',
    version: 1,
    name: 'Performance Reels / TikTok',
    description: 'Foco em retenção: headlines em caixa alta, badge de preço com punch zoom e ritmo agressivo',
    typography: {
      headline_font_id: 'dejavu_bold',
      body_font_id: 'dejavu_medium',
      accent_font_id: 'dejavu_bold'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#FFD700',          // Dourado Bali
      box_bg: '#000000CC',        // Preto 80% opacidade
      price_badge_bg: '#00C853',  // Verde conversão
      price_badge_text: '#FFFFFF'
    },
    motion: {
      badge_punch_scale: 1.15,
      fade_duration_ms: 200
    },
    safe_rectangles: {
      top_safe: { x_min: 60, x_max: 1020, y_min: 220, y_max: 500 },
      center: { x_min: 60, x_max: 1020, y_min: 760, y_max: 1160 },
      lower_third: { x_min: 60, x_max: 1020, y_min: 1280, y_max: 1540 },
      bottom_safe: { x_min: 60, x_max: 1020, y_min: 1540, y_max: 1720 }
    },
    overlay_presets: {
      'bold_headline': {
        font_id: 'dejavu_bold',
        font_size: 56,
        max_lines: 2,
        max_chars: 60,
        box_padding: 24,
        box_color: '#000000CC',
        text_color: '#FFFFFF'
      },
      'price_punch': {
        font_id: 'dejavu_bold',
        font_size: 64,
        max_lines: 1,
        max_chars: 25,
        box_padding: 28,
        box_color: '#00C853',
        text_color: '#FFFFFF',
        punch_zoom: true
      },
      'location_badge': {
        font_id: 'dejavu_medium',
        font_size: 40,
        max_lines: 1,
        max_chars: 40,
        box_padding: 16,
        box_color: '#000000B3',
        text_color: '#FFD700'
      },
      'cta_bar': {
        font_id: 'dejavu_bold',
        font_size: 48,
        max_lines: 2,
        max_chars: 50,
        box_padding: 20,
        box_color: '#000000E6',
        text_color: '#FFFFFF'
      }
    }
  },

  'clean_modern_v1': {
    id: 'clean_modern_v1',
    version: 1,
    name: 'Clean Modern Minimalist',
    description: 'Estética contemporânea: lower thirds refinados, tipografia elegante e transições suaves',
    typography: {
      headline_font_id: 'liberation_bold',
      body_font_id: 'liberation_medium',
      accent_font_id: 'liberation_bold'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#00E5FF',
      box_bg: '#1A1A1AE6',
      price_badge_bg: '#1A1A1AE6',
      price_badge_text: '#00E5FF'
    },
    motion: {
      badge_punch_scale: 1.08,
      fade_duration_ms: 300
    },
    safe_rectangles: {
      top_safe: { x_min: 70, x_max: 1010, y_min: 220, y_max: 480 },
      center: { x_min: 70, x_max: 1010, y_min: 780, y_max: 1140 },
      lower_third: { x_min: 70, x_max: 1010, y_min: 1300, y_max: 1540 },
      bottom_safe: { x_min: 70, x_max: 1010, y_min: 1540, y_max: 1700 }
    },
    overlay_presets: {
      'bold_headline': {
        font_id: 'liberation_bold',
        font_size: 52,
        max_lines: 2,
        max_chars: 60,
        box_padding: 20,
        box_color: '#1A1A1AE6',
        text_color: '#FFFFFF'
      },
      'price_punch': {
        font_id: 'liberation_bold',
        font_size: 58,
        max_lines: 1,
        max_chars: 25,
        box_padding: 24,
        box_color: '#1A1A1AE6',
        text_color: '#00E5FF',
        punch_zoom: false
      },
      'location_badge': {
        font_id: 'liberation_medium',
        font_size: 38,
        max_lines: 1,
        max_chars: 40,
        box_padding: 16,
        box_color: '#1A1A1AB3',
        text_color: '#FFFFFF'
      },
      'cta_bar': {
        font_id: 'liberation_bold',
        font_size: 44,
        max_lines: 2,
        max_chars: 50,
        box_padding: 20,
        box_color: '#1A1A1AF2',
        text_color: '#00E5FF'
      }
    }
  }
};
```

---

## 3. Tipografia Canônica e Font Registry

### 3.1 Whitelist Oficial de Fontes
O Blueprint e os Styles **NUNCA fornecem caminhos de arquivos do filesystem**. Eles referenciam unicamente um `font_id` cadastrado no `FONT_REGISTRY`:

```javascript
const FONT_REGISTRY = {
  'dejavu_bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'dejavu_medium': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'liberation_bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  'liberation_medium': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
};
```

### 3.2 Validação de Boot e Startup Test
No carregamento do módulo e na inicialização dos testes:
- Todas as fontes referenciadas em todos os styles são validadas contra o `FONT_REGISTRY`.
- Cada arquivo físico é verificado via `fs.existsSync()`.
- **Se qualquer fonte falhar, o serviço recusa a inicialização (Fail-Fast).** Proibido qualquer fallback silencioso.

---

## 4. Defesa em Profundidade contra Filter Injection

Para impedir injeção arbitrária de comandos ou filtros no FFmpeg, adotamos **11 barreiras em profundidade**:

1. **Execução sem Shell:** Invocação exclusiva via `child_process.execFile('ffmpeg', args)`.
2. **Nenhuma Opção Arbitrária:** O Blueprint não aceita opções de filtro ou flags do FFmpeg.
3. **Whitelist de Overlay Types:** Apenas `headline`, `price_badge`, `location_tag`, `cta_banner`.
4. **Whitelist de Positions:** Apenas `top_safe`, `center`, `lower_third`, `bottom_safe`.
5. **Whitelist de Presets:** Apenas presets cadastrados no style ativo.
6. **Whitelist de Font IDs:** Apenas chaves cadastradas no `FONT_REGISTRY`.
7. **Limites Rígidos de Comprimento:** Máximo de 250 caracteres por overlay (e limites menores por preset, ex: 60 chars em headlines).
8. **Sanitização Determinística de Texto:**
   ```javascript
   function sanitizeDrawtextString(rawText) {
     if (typeof rawText !== 'string') return '';
     return rawText
       .replace(/\\/g, '\\\\')
       .replace(/:/g, '\\:')
       .replace(/'/g, "\\'")
       .replace(/%/g, '\\%')
       .replace(/\[/g, '\\[')
       .replace(/\]/g, '\\]')
       .replace(/,/g, '\\,')
       .replace(/;/g, '\\;')
       .replace(/=/g, '\\=')
       .replace(/[\r\n]+/g, ' ')
       .trim();
   }
   ```
9. **Filtergraph Construído 100% pelo Código:** Parâmetros $x, y, w, h, t$ são interpolados exclusivamente a partir de números validados.
10. **Nenhum Filepath do Cliente:** Todos os paths de mídia passam pelo **Asset Resolver**; caminhos de fontes vêm exclusivamente do `FONT_REGISTRY`.
11. **Nenhum Fragmento de Expressão do Cliente:** Expressões matemáticas de timeline (`enable='between(t,...)'`) são geradas programaticamente a partir de milissegundos inteiros.

---

## 5. Overlay Engine: Ordem Canônica, Camadas e Safe Rectangles

### 5.1 Ordem de Composição e Identidade dos Overlays
Para evitar que a canonicalização altere a ordem visual ou crie ambiguidades de sobreposição:
1. Cada overlay no Blueprint deve possuir um `id` único (ex: `"ov_01"`) e um `layer_order` numérico inteiro (ex: `10, 20, 30`).
2. **Rejeição Fail-Fast:** IDs duplicados ou `layer_order` duplicados dentro do mesmo Blueprint são estritamente rejeitados na validação pré-FFmpeg.
3. **Ordem de Renderização:** O Overlay Engine ordena os overlays estritamente por `layer_order` ascendente, aplicando os nós de `drawtext`/`drawbox` sequencialmente no filtergraph.
4. **Identidade na `render_key`:** A lista de overlays é serializada ordenada por `layer_order`, refletindo fielmente a pilha visual renderizada.

### 5.2 Safe Rectangles e Dimensões do Elemento
Safe area não é apenas uma coordenada $y$. É um **retângulo delimitador permitido**:
$$\text{safe\_rect} = \{ x_{\min}, x_{\max}, y_{\min}, y_{\max} \}$$

**Validação de Bounding Box:**
1. O texto é sanitizado e quebrado em linhas conforme `max_lines` e `max_chars` do preset.
2. A largura estimada $W_{\text{box}}$ e altura $H_{\text{box}}$ são calculadas:
   $$W_{\text{box}} = \text{largura\_texto} + 2 \times \text{box\_padding}$$
   $$H_{\text{box}} = (\text{linhas} \times \text{font\_size} \times 1.25) + 2 \times \text{box\_padding}$$
3. A caixa deve caber integralmente dentro do retângulo seguro da posição solicitada:
   $$W_{\text{box}} \le (x_{\max} - x_{\min}) \quad \text{e} \quad H_{\text{box}} \le (y_{\max} - y_{\min})$$
4. **Se exceder o retângulo permitido:** Fail-Fast com erro claro de layout, impedindo renderização com corte de texto na tela.

---

## 6. Captions: Fonte Única de Verdade no Contrato

Para eliminar ambiguidade arquitetural:
- **`captions` possui representação única no Creative Blueprint 1.1:**
  ```json
  "captions": [
    { "start_ms": 0, "end_ms": 1100, "text": "Apartamento 3 suítes frente mar" },
    { "start_ms": 1150, "end_ms": 2400, "text": "com varanda gourmet e vista panorâmica." }
  ]
  ```
- **Remoção de Duplicidade:** O tipo `caption_segment` é expressamente proibido dentro do array `overlays`.
- **Compilação Interna:** O Overlay Service compila o array `captions` em nós `drawtext` dedicados posicionados na área `lower_third`/`bottom_safe`, com limite de até 2 linhas por segmento e tamanho de fonte derivado do style (`body_font_id`).

---

## 7. Motion Leve com Semântica Exata

No MVP 3C.1, o escopo de movimento é estrito e não-ambíguo:

1. **Fade In / Fade Out em Overlays:**
   - Aplicado via modulação de transparência (`alpha`) no `drawtext`:
     $$\text{alpha}(t) = \text{if}\left(\text{lt}(t, t_0 + \delta), \frac{t - t_0}{\delta}, \text{if}\left(\text{gt}(t, t_1 - \delta), \frac{t_1 - t}{\delta}, 1\right)\right)$$
   - $\delta = \text{fade\_duration\_ms} / 1000$ (definido no style).

2. **Punch Zoom em Price Badges:**
   - **Semântica Estrita:** No MVP 3C.1, o `punch_zoom` aplica-se **exclusivamente ao badge de preço/overlay** (efeito de impacto "pop" no surgimento do valor), multiplicando o tamanho da fonte e box nos primeiros 150ms do badge.
   - **Vídeo Base:** O zoom/crop animado do vídeo base é deliberadamente postergado para a Fase 3C.2 para evitar complexidade excessiva no filtergraph de concatenação.

---

## 8. Contrato Limpo: Remoção de Placeholders

Diretivas conceituais sem implementação física imediata (como `audio_mix: "normalize"` ou `motion_level: "medium"`) **não são aceitas no contrato da 3C.1**.
Qualquer campo aceito pelo Blueprint 1.1 deve ter transformação física determinística comprovada por teste.

---

## 9. Creative Blueprint 1.1 (Especificação Oficial)

```json
{
  "schema_version": "1.1",
  "creative_id": "crv_bbddf3ba_var1",
  "blueprint_version": 1,
  "format": {
    "aspect_ratio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "editing_style": {
    "style_id": "performance_reels_v1",
    "version": 1
  },
  "timeline": [
    {
      "segment_index": 1,
      "role": "hook",
      "asset_id": "ast_hk_bbddf3ba_01",
      "layer": 0,
      "source_in_ms": 0,
      "source_out_ms": 3000
    },
    {
      "segment_index": 2,
      "role": "body",
      "asset_id": "ast_bd_bbddf3ba_01",
      "layer": 0,
      "source_in_ms": 0,
      "source_out_ms": 5000
    }
  ],
  "overlays": [
    {
      "id": "ov_headline",
      "layer_order": 10,
      "type": "headline",
      "text": "3 SUÍTES FRENTE MAR",
      "start_ms": 200,
      "end_ms": 2800,
      "position": "top_safe",
      "preset": "bold_headline"
    },
    {
      "id": "ov_price",
      "layer_order": 20,
      "type": "price_badge",
      "text": "R$ 1.250.000",
      "start_ms": 3200,
      "end_ms": 5500,
      "position": "lower_third",
      "preset": "price_punch"
    },
    {
      "id": "ov_cta",
      "layer_order": 30,
      "type": "cta_banner",
      "text": "AGENDE SUA VISITA EXCLUSIVA",
      "start_ms": 6000,
      "end_ms": 7800,
      "position": "bottom_safe",
      "preset": "cta_bar"
    }
  ],
  "captions": [
    { "start_ms": 0, "end_ms": 2900, "text": "Descubra o melhor 3 suítes frente mar de Piçarras." },
    { "start_ms": 3000, "end_ms": 7800, "text": "Planta exclusiva, varanda gourmet e lazer completo." }
  ]
}
```

---

## 10. Identidade de Renderização Canônica (`render_key` 3C)

A `render_key` de um Blueprint 1.1 é o hash SHA-256 da serialização canônica recursiva contendo:
- `schema_version`: `'1.1'`
- `composer_contract_version`: `'composer_v2'`
- `creative_id` e `blueprint_version`
- `format`: `{ aspect_ratio, width, height, fps }`
- `editing_style`: `{ style_id, version, style_hash }`
- `timeline`: array ordenado por `segment_index` com `asset_id`, `file_hash` de entrada e trims
- `overlays`: array ordenado por `layer_order` com `id`, `type`, texto sanitizado, `start_ms`, `end_ms`, `position`, `preset` e parâmetros resolvidos do preset
- `captions`: array ordenado por `start_ms` com `text` sanitizado e bounds de tempo
- `input_assets`: array com `asset_id` e `file_hash` dos bytes de entrada.

---

## 11. Retrocompatibilidade Byte-Safe com Blueprint 1.0

Se o Blueprint recebido declarar `schema_version: "1.0"`:
- O Composer **ignora o Overlay Engine e a resolução de styles**.
- Executa estritamente o pipeline de re-encode canônico sequencial da Fase 3B (`composer_v1`).
- A `render_key` gerada segue a fórmula original da 3B sem poluição de campos vazios (`overlays: []`).
- **Garantia:** O mesmo Blueprint 1.0 produz exatamente o mesmo hash e os mesmos bytes antes e depois da Fase 3C.

---

## 12. Validação Visual Física nos Testes Automatizados

A suíte de testes da 3C **NÃO depende unicamente do `ffprobe`**. Implementamos um helper de extração de frames via FFmpeg:

```javascript
function extractFramePng(videoPath, timestampSec, outputPngPath) {
  execSync(`ffmpeg -y -ss ${timestampSec} -i ${videoPath} -vframes 1 ${outputPngPath}`, { stdio: 'ignore' });
  return fs.readFileSync(outputPngPath);
}
```

### Provas Físicas Exigidas nos Testes:
1. **Presença/Ausência de Overlay:**
   - Extrai frame em $t_0 - 0.2\text{s}$ (antes do overlay) $\rightarrow$ região sem overlay.
   - Extrai frame em $(t_0 + t_1)/2$ (durante o overlay) $\rightarrow$ detecta alteração física de pixels na região da safe area.
   - Extrai frame em $t_1 + 0.2\text{s}$ (após o overlay) $\rightarrow$ pixels retornam ao estado original sem overlay.
2. **Fade In / Out:**
   - Comprova 3 estados físicos: antes ($alpha = 0$), transição ($0 < alpha < 1$) e pleno ($alpha = 1$).
3. **Safe Area:**
   - Comprova que os pixels alterados pelo overlay estão estritamente contidos dentro do retângulo delimitador da safe area correspondente.

---

## 13. Respostas Objetivas às Decisões Obrigatórias

1. **Qual será o schema/version do Blueprint para 3C?**  
   `schema_version: "1.1"` (com desvio de execução para pipeline 1.0 preservado).

2. **Como representar `editing_style`?**  
   Objeto explícito `{ style_id: "performance_reels_v1", version: 1 }`.

3. **Onde ficam os style presets?**  
   No módulo versionado em código Git (`video_engine/styles/presets.js`).

4. **Como overlays são representados?**  
   Array com `id`, `layer_order` explícito, `type`, `text`, `start_ms`, `end_ms`, `position` e `preset`.

5. **Como evitar filter injection?**  
   Defesa em 11 camadas: sanitização de caracteres (`\`, `:`, `'`, `%`, `[`, `]`, `,`, `;`, `=`), `execFile`, whitelists estritas de tipos, presets, posições e fonts, e limites de tamanho.

6. **Como captions são representadas?**  
   Fonte única no array `captions: [{ start_ms, end_ms, text }]` no nível do Blueprint. Tipo `caption_segment` proibido em `overlays`.

7. **B-roll entra já no MVP ou fica para 3C.2?**  
   Estruturado e reservado para a subfase **3C.2**.

8. **PIP entra já no MVP ou fica para 3C.2?**  
   Estruturado e reservado para a subfase **3C.2**.

9. **Quais motion effects entram no MVP?**  
   `fade_in`/`fade_out` em overlays e `punch_zoom` no badge de preço.

10. **Quais tipos de overlays entram no MVP?**  
    `headline`, `price_badge`, `location_tag` e `cta_banner`.

11. **Quais limites de quantidade/tamanho serão impostos?**  
    Máximo 20 overlays, máximo 250 caracteres por overlay, máximo 60 captions, máximo 120s de vídeo.

12. **Como style/overlays alteram `render_key`?**  
    O `style_hash` intrínseco e os overlays ordenados por `layer_order` participam da serialização canônica SHA-256.

13. **Como compatibilidade com Blueprint antigo é preservada?**  
    Blueprints 1.0 executam no caminho nativo da 3B sem style resolution nem Overlay Service.

14. **Como Shadow 3C é diferenciado de Shadow 3B?**  
    Prefixo de arquivo `shadow_3c_`, `asset_type = 'shadow_creative_3c'` e contrato `composer_v2`.

15. **Quais módulos novos serão necessários?**  
    `video_engine/styles/presets.js` e `video_engine/overlay_service.js`.

16. **Será necessária migration?**  
    **Não.** O schema atual já suporta JSONB flexível e `video_assets` aceita novos `asset_type`. A verificação do schema será validada no início da implementação.

17. **Como serão tratados fonts/presets?**  
    Mapeamento fixo em `FONT_REGISTRY` com verificação fail-fast de arquivos físicos no boot.

18. **Qual timeout esperado para Composer 3C?**  
    180 segundos (3 minutos).

19. **Qual será a estratégia de QC?**  
    `ffprobe` estrito (codecs, FPS, dimensões, duração) + testes de extração física de frames PNG.

20. **Quais critérios precisam passar para liberar implementação?**  
    Aprovação do plano revisado, zero alterações de código no momento, criação da suíte de 50 testes automatizados com validação física de frames e não-regressão da Fase 2C e WhatsApp V1.

---

## 14. Suíte de Testes Planejada para a Fase 3C (50 Cenários Automatizados)

1. Validação de boot: todas as fontes de todos os styles existem fisicamente no servidor.
2. Blueprint 1.0 legado renderiza no caminho 3B com mesma `render_key`.
3. Blueprint 1.1 sem overlays renderiza com contrato 1.1.
4. Style `performance_reels_v1` resolve com `style_hash` correto.
5. Style `clean_modern_v1` resolve com `style_hash` correto.
6. Style com `style_id` inexistente rejeitado com erro fail-fast.
7. Style com `version` inexistente rejeitado com erro fail-fast.
8. Mutação interna em parâmetro do style altera `style_hash` e `render_key`.
9. Alteração de `style_id` altera `render_key`.
10. Overlay `headline` renderizado na safe area superior.
11. Overlay `price_badge` renderizado na safe area inferior.
12. Overlay `location_tag` renderizado no lower third.
13. Overlay `cta_banner` renderizado na safe area inferior.
14. Overlay com `caption_segment` dentro de `overlays` rejeitado (exige uso de `captions`).
15. Captions sincronizadas renderizadas na timeline correta.
16. Rejeição de overlays com IDs duplicados no mesmo Blueprint.
17. Rejeição de overlays com `layer_order` duplicado no mesmo Blueprint.
18. Ordem de renderização respeita estritamente o `layer_order`.
19. Rejeição de preset de overlay desconhecido.
20. Rejeição de overlay fora da duração total do vídeo.
21. Rejeição de overlay com $t_{\text{start}} \ge t_{\text{end}}$.
22. Rejeição de overlay com texto vazio ou nulo.
23. Rejeição de Blueprint com mais de 20 overlays (limite excedido).
24. Rejeição de overlay com texto acima de 250 caracteres.
25. Rejeição de overlay que excede a safe area física calculada.
26. Sanitização de string hostil contendo `:` e `\` tratada puramente como texto.
27. Sanitização de string hostil contendo `'` e `%` tratada puramente como texto.
28. Sanitização de string hostil contendo `[` e `]` tratada puramente como texto.
29. Sanitização de string hostil contendo `,`, `;` e `=` tratada puramente como texto.
30. Caracteres acentuados PT-BR (ç, ã, é, ó, ú, Á, É) renderizados perfeitamente.
31. Prova física de frame: overlay ausente antes de $t_{\text{start}}$.
32. Prova física de frame: overlay presente e visível entre $t_{\text{start}}$ e $t_{\text{end}}$.
33. Prova física de frame: overlay ausente após $t_{\text{end}}$.
34. Prova física de fade in: transição gradual de opacidade comprovada em frames.
35. Prova física de punch zoom: escala destacada no badge de preço comprovada em frame.
36. Alteração em qualquer texto de overlay altera a `render_key`.
37. Alteração no timing de overlay altera a `render_key`.
38. Mesma receita com mesmos overlays gera retorno idempotente imediato (< 50ms).
39. Claim atômico PostgreSQL bloqueia renderizações simultâneas do mesmo criativo 3C.
40. Cleanup 100% autônomo de `.tmp` em caso de falha de renderização ou QC.
41. Saída física possui estritamente H.264 (yuv420p, 1080x1920@30fps).
42. Saída física possui áudio AAC stereo 44100Hz.
43. Sincronismo entre áudio e vídeo mantido dentro da tolerância ($\le 200\text{ ms}$).
44. Recuperação controlada de READY corrompido para criativos 3C.
45. Modo Shadow 3C gera arquivo `shadow_3c_` sem mutar campos da 2C.
46. Endpoint `/compose-shadow-3c/:index` responde HTTP 200 com specs.
47. Endpoint `/shadow-3c-video/:index` realiza streaming autenticado do MP4 3C.
48. Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200).
49. WhatsApp V1 permanece 100% íntegro e operacional.
50. Bloqueio estático 403 em `/outputs/jobs/` e saúde do PM2/PostgreSQL mantidos.

---

## 15. Conclusão da Revisão PLAN ONLY

O plano revisado elimina todas as ambiguidades, formaliza o cálculo intrínseco de `style_hash`, garante unicidade no contrato de captions, introduz testes visuais de extração de frames e assegura retrocompatibilidade estrita.

**Nenhuma linha de código de produção, migration ou deploy foi executada nesta etapa.**  
Aguardando aprovação externa para início da implementação.
