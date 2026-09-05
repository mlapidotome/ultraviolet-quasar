# Arquitetura e Plano de Implementação — Fase 3C
## Editing Styles & Overlays Dinâmicos (Video Engine V2 — Bali Imóveis)

**Status:** Planejamento Arquitetural (PLAN ONLY — Aguardando Revisão Externa)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 3B Final Hardening):** `a215799dea6740ef4ff2e59ae55837ef47c7f6ba`  
**Escopo:** Especificação técnica rigorosa e definitiva da evolução do Video Composer MVP para suporte a **Editing Styles Versionáveis**, **Overlay Engine Declarativo**, **Tipografia Segura**, **Safe Areas 9:16**, **Motion Leve** e **Captions Sincronizadas**, mantendo isolamento aditivo via Shadow Mode e retrocompatibilidade estrita.

---

## 1. Visão Geral e Princípio Arquitetural

A Fase 3B estabeleceu o **Video Composer determinístico MVP**, capaz de transformar clipes de entrada e diretrizes de corte sequencial em um MP4 padronizado (H.264/AAC 1080x1920@30fps).

A **Fase 3C** avança da concatenação simples para a **Edição Declarativa Enriquecida**:

$$\text{Creative Blueprint 1.1} + \text{Editing Style Preset} + \text{Overlay Directives} \xrightarrow[\text{Asset Resolver}]{\text{Video Composer 3C}} \text{Vídeo Editado Final (MP4)}$$

### Princípio da Separação Estrita de Responsabilidades
O Video Composer **NÃO toma decisões criativas, não gera copy, não escolhe layouts aleatórios e não interpreta estética**:
$$\text{AI / Copy Engine / Creative Rules} \xrightarrow{\text{decide O QUE e COMO editar}} \text{Creative Blueprint 1.1} \xrightarrow{\text{executa deterministicamente}} \text{Composer 3C + FFmpeg}$$

- O **Blueprint** expressa a intenção de edição em JSON puramente declarativo.
- O **Editing Style Service** fornece presets visuais canônicos versionados.
- O **Overlay Service** compila as diretrizes declarativas em uma árvore de filtros (`filter_complex`) do FFmpeg à prova de injeção.
- O **Asset Resolver** valida ownership, existência física e hashes de qualquer artefato adicional.
- O **Composer Engine** renderiza, inspeciona via QC e promove o artefato de forma atômica e imutável.

---

## 2. Modelo de Editing Styles

### 2.1 Decisão Arquitetural: Onde residem os Editing Styles?
**Decisão:** **JSON/JS Versionado no Código (`video_engine/styles/index.js`)**.

**Justificativa Técnica:**
1. **Determinismo e Imutabilidade:** Um estilo de edição não é apenas um registro de banco; ele define regras de composição, espaçamentos, curvas de animação, cores e referências a fontes. Ao versioná-lo em código Git (`style_id: "performance_reels_v1"`, `version: 1`), garantimos que a mesma versão de estilo produza exatamente os mesmos pixels em qualquer ambiente (dev, staging, VPS).
2. **Sem Necessidade de Migration:** Evita DDL/migrações desnecessárias no PostgreSQL nesta fase.
3. **Identidade na `render_key`:** A alteração de qualquer parâmetro visual em um estilo exige o incremento da sua versão (`version: 2`), invalidando deterministicamente o cache de renderização anterior.

### 2.2 Presets MVP da Fase 3C

Criaremos 3 estilos canônicos no MVP:

```javascript
// video_engine/styles/presets.js
module.exports = {
  'performance_reels_v1': {
    id: 'performance_reels_v1',
    version: 1,
    name: 'Performance Reels / TikTok',
    description: 'Foco em retenção: headlines em caixa alta, badge de preço com punch zoom e ritmo agressivo',
    typography: {
      headline_font: 'inter_extrabold',
      body_font: 'inter_semibold',
      accent_font: 'inter_black'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#FFD700',       // Dourado Bali
      background_box: '#000000CC', // Preto 80% opacidade
      price_badge_bg: '#00C853',   // Verde conversão
      price_badge_text: '#FFFFFF'
    },
    motion: {
      headline_animation: 'fade_scale_pop',
      price_animation: 'punch_zoom',
      transition_speed_ms: 200
    },
    safe_area: {
      top_offset_px: 240,
      bottom_offset_px: 360,
      margin_horizontal_px: 60
    }
  },

  'clean_modern_v1': {
    id: 'clean_modern_v1',
    version: 1,
    name: 'Clean Modern Minimalist',
    description: 'Estética contemporânea: lower thirds refinados, tipografia elegante e transições suaves',
    typography: {
      headline_font: 'montserrat_bold',
      body_font: 'montserrat_medium',
      accent_font: 'montserrat_bold'
    },
    colors: {
      primary: '#FFFFFF',
      accent: '#00E5FF',
      background_box: '#1A1A1AE6',
      price_badge_bg: '#1A1A1AE6',
      price_badge_text: '#00E5FF'
    },
    motion: {
      headline_animation: 'fade_in_slide',
      price_animation: 'smooth_fade',
      transition_speed_ms: 300
    },
    safe_area: {
      top_offset_px: 220,
      bottom_offset_px: 340,
      margin_horizontal_px: 70
    }
  },

  'minimal_luxury_v1': {
    id: 'minimal_luxury_v1',
    version: 1,
    name: 'Minimal Luxury / Alto Padrão',
    description: 'Edição sóbria para imóveis premium: sem animações bruscas, tipografia limpa e espaçamentos nobres',
    typography: {
      headline_font: 'dejavu_bold',
      body_font: 'dejavu_medium',
      accent_font: 'dejavu_bold'
    },
    colors: {
      primary: '#F5F5F7',
      accent: '#D4AF37',       // Ouro clássico
      background_box: '#111111B3',
      price_badge_bg: '#D4AF37',
      price_badge_text: '#111111'
    },
    motion: {
      headline_animation: 'pure_fade',
      price_animation: 'pure_fade',
      transition_speed_ms: 400
    },
    safe_area: {
      top_offset_px: 260,
      bottom_offset_px: 380,
      margin_horizontal_px: 80
    }
  }
};
```

---

## 3. Overlay Engine (`video_engine/overlay_service.js`)

### 3.1 Responsabilidades do Módulo
1. **Validação Estrutural:** Recebe array de `overlays` e garante tipos, coordenadas, bounds de timing e limites de tamanho.
2. **Compilação de Filtros:** Mapeia cada overlay declarativo para instruções atômicas de FFmpeg (`drawtext`, `drawbox`, `scale`, `crop`, `overlay`).
3. **Higienização e Escaping Anti-Injeção:** Neutraliza qualquer caractere malicioso ou de controle do FFmpeg.
4. **Resolução de Posições Declarativas em Coordenadas Absolutas:** Converte `top_safe`, `center`, `lower_third`, `bottom_safe` em expressões $x, y$ matemáticas determinísticas em relação a 1080x1920.

### 3.2 Tipos de Overlays Suportados no MVP 3C

| Tipo de Overlay | Descrição | Parâmetros Declarativos | Efeito Visual |
|---|---|---|---|
| `headline` | Título de impacto no gancho | `text`, `start_ms`, `end_ms`, `position`, `box` | Texto destacado com caixa de leitura semi-transparente |
| `price_badge` | Destaque monetário do imóvel | `text` (ex: "R$ 680 MIL"), `start_ms`, `end_ms`, `position`, `punch_zoom: true` | Caixa destacada com cores de alta conversão |
| `location_tag` | Bairro / Cidade do imóvel | `text`, `start_ms`, `end_ms`, `position` | Lower-third compacto indicando localização |
| `cta_banner` | Chamada final de ação | `text` (ex: "Saiba Mais"), `start_ms`, `end_ms`, `position` | Banner de rodapé nos segundos finais |
| `caption_segment` | Trecho de legenda falada | `text`, `start_ms`, `end_ms`, `highlight_words` | Legenda central/inferior sincronizada com áudio |

---

## 4. Tipografia, Font Presets & Proteção contra Filter Injection

### 4.1 O Perigo de Injeção em Filtros FFmpeg
No FFmpeg `drawtext`, caracteres como `:`, `'`, `\`, `%`, `[`, `]` possuem significado de sintaxe interna e podem quebrar a execução ou injetar opções arbitrárias de filtro.

### 4.2 Sanitização Rigorosa do Texto
Todo texto recebido no Blueprint passa por um higienizador determinístico:

```javascript
/**
 * Sanitiza texto para uso seguro no drawtext do FFmpeg
 * 1. Escapa barras invertidas: \ -> \\
 * 2. Escapa dois-pontos: : -> \:
 * 3. Escapa aspas simples: ' -> \'
 * 4. Escapa porcentagem: % -> \%
 * 5. Remove quebras de linha cruas (\r, \n) substituindo por espaço ou quebra controlada
 */
function sanitizeDrawtextString(rawText) {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ')
    .trim();
}
```

### 4.3 Whitelist de Fontes no Servidor
O Blueprint **NUNCA fornece caminhos de arquivos de fontes**. Ele informa apenas um identificador lógico (`font_preset: "inter_bold"`).
O `overlay_service` mapeia esse identificador para arquivos de fontes canônicos já disponíveis ou instalados no servidor:

```javascript
const FONT_REGISTRY = {
  'dejavu_bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'dejavu_medium': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'liberation_bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  'liberation_medium': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
};

function resolveFontPath(fontKey) {
  const fontPath = FONT_REGISTRY[fontKey] || FONT_REGISTRY['dejavu_bold'];
  if (!fs.existsSync(fontPath)) {
    throw new Error(`[COMPOSER FONT ERROR] Arquivo de fonte não encontrado no sistema: ${fontPath}`);
  }
  return fontPath;
}
```

---

## 5. Safe Area e Posicionamento em 9:16 (Instagram Reels / TikTok)

Para evitar que textos sejam ocultados pela interface do aplicativo (nome do perfil, legenda nativa, botões de like/share, barra de status), definimos coordenadas canônicas padronizadas baseadas na resolução $1080 \times 1920$:

```
0px ────────────────────────────────────────────────────────
    ▲ [Área de Risco: Top Bar / Header do App]
220px ── TOP_SAFE (y = 220) ────────────────────────────────
    │
    │   ÁREA SEGURA PRINCIPAL (Conteúdo Visual e Hooks)
    │
960px ── CENTER (y = 960) ──────────────────────────────────
    │
    │   ÁREA INFERIOR DE LEITURA (Preço e Benefícios)
    │
1380px ── LOWER_THIRD (y = 1380) ───────────────────────────
    │
1560px ── BOTTOM_SAFE (y = 1560) ───────────────────────────
    ▼ [Área de Risco: Legenda Nativa, Áudio, Botões Laterais]
1920px ─────────────────────────────────────────────────────
```

### Resolução Matemática de Posições:
- `top_safe`: $x = (w - \text{text\_w})/2$, $y = 240$
- `center`: $x = (w - \text{text\_w})/2$, $y = (h - \text{text\_h})/2$
- `lower_third`: $x = (w - \text{text\_w})/2$, $y = 1380$
- `bottom_safe`: $x = (w - \text{text\_w})/2$, $y = 1560$

---

## 6. Motion Leve e Efeitos Determinísticos em FFmpeg Puro

A Fase 3C utiliza recursos nativos do FFmpeg sem dependência de engines externas (After Effects, Remotion, Canvas):

### 6.1 Punch Zoom (Destaque em Ganchos e Preço)
Aplica um corte e escala suave temporária:
$$\text{scale}=1.12 \times \text{iw}:1.12 \times \text{ih}, \quad \text{crop}=1080:1920:(1.12 \times \text{iw}-1080)/2:(1.12 \times \text{ih}-1920)/2$$
Ativado dinamicamente via timeline do filtro entre $t_{\text{start}}$ e $t_{\text{end}}$.

### 6.2 Fade In / Fade Out em Overlays
Implementado no `drawtext` e `drawbox` através do parâmetro `alpha`:
$$\text{alpha} = \text{if}(\text{lt}(t, t_0 + \delta), (t - t_0)/\delta, \text{if}(\text{gt}(t, t_1 - \delta), (t_1 - t)/\delta, 1))$$
onde $\delta = 0.25\text{ s}$ (250 ms de fade suave).

### 6.3 Box com Background Semi-Transparente
Usa `box=1:boxcolor=black@0.75:boxborderw=24` diretamente no `drawtext`, garantindo legibilidade perfeita independente da claridade do vídeo de fundo.

---

## 7. Estratégia de Captions (Legendas)

### Decisão para o MVP 3C: Opção A (Captions Segmentadas no Blueprint)
O Creative Blueprint 1.1 recebe as legendas já transcritas e sincronizadas em blocos temporais milimétricos:

```json
"captions": [
  { "start_ms": 0, "end_ms": 1100, "text": "Este é o melhor apartamento" },
  { "start_ms": 1150, "end_ms": 2300, "text": "frente ao mar em Balneário Piçarras" },
  { "start_ms": 2350, "end_ms": 3800, "text": "com 3 suítes e acabamento impecável." }
]
```

**Vantagens:**
- Desacoplamento total: O Composer não precisa rodar modelos pesados de Speech-to-Text (Whisper) durante a renderização.
- Determinismo: A renderização de legendas é $100\%$ determinística e entra no cálculo da `render_key`.
- Edição prévia: O AI Engine pode pontuar e formatar o texto antes de enviar para renderização.

---

## 8. Escopo de B-Roll e Picture-in-Picture (PIP)

### 8.1 B-Roll
- **Fase 3C.1 (MVP Inicial):** Foco estrito em Overlays de Texto, Badges de Preço, Localização, CTA, Captions e Motion Leve.
- **Fase 3C.2 (Extensão Aditiva):** Suporte a `asset_type: 'broll_clip'` como segmento de timeline alternativa ou overlay de cobertura com timing explícito fornecido pelo Blueprint. Qualquer asset de B-roll exige validação prévia pelo **Asset Resolver** (status `ready`, integridade de hash físico e ownership do Job).

### 8.2 Picture-in-Picture (PIP)
- **Fase 3C.2 (Extensão Aditiva):** Overlay de avatar secundário sobre vídeo de fundo imobiliário full-screen:
  - Input 0: Vídeo B-roll full-screen (1080x1920)
  - Input 1: Avatar falante (redimensionado via `scale=360:640`)
  - Posicionamento em `overlay=x=60:y=1200:enable='between(t, 0, 10)'`.

---

## 9. Creative Blueprint 1.1 (Contrato Estendido)

O contrato do Blueprint evolui para `schema_version: "1.1"` preservando retrocompatibilidade total com `1.0`:

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
      "type": "headline",
      "text": "3 SUÍTES FRENTE MAR",
      "start_ms": 200,
      "end_ms": 2800,
      "position": "top_safe",
      "preset": "bold_box"
    },
    {
      "id": "ov_price",
      "type": "price_badge",
      "text": "R$ 1.250.000",
      "start_ms": 3200,
      "end_ms": 5500,
      "position": "lower_third",
      "preset": "punch_accent"
    },
    {
      "id": "ov_cta",
      "type": "cta_banner",
      "text": "AGENDE SUA VISITA EXCLUSIVA",
      "start_ms": 6000,
      "end_ms": 7800,
      "position": "bottom_safe",
      "preset": "solid_bar"
    }
  ],
  "captions": [
    { "start_ms": 0, "end_ms": 2900, "text": "Descubra o melhor 3 suítes frente mar de Piçarras." },
    { "start_ms": 3000, "end_ms": 7800, "text": "Planta exclusiva, varanda gourmet e lazer completo." }
  ],
  "composition_directives": {
    "audio_mix": "normalize",
    "motion_level": "medium"
  }
}
```

### Retrocompatibilidade Canônica com 1.0
Se `blueprint.schema_version === '1.0'` ou se `editing_style` e `overlays` forem omitidos:
- O Composer interpreta como blueprint sequencial puro (comportamento da Fase 3B).
- `overlays` é tratado como `[]`.
- `captions` é tratado como `[]`.
- O render ocorre sem overlays adicionais com custo computacional mínimo.

---

## 10. Identidade de Renderização Canônica (`render_key` 3C)

Qualquer alteração em estilos, textos, posições ou timings altera obrigatoriamente a `render_key`:

```javascript
const renderSpec = {
  schema_version: '1.1',
  composer_contract_version: 'composer_v2',
  creative_id: String(blueprint.creative_id),
  blueprint_version: Number(blueprint.blueprint_version || 1),
  format: {
    aspect_ratio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30
  },
  editing_style: {
    style_id: blueprint.editing_style?.style_id || 'none',
    version: Number(blueprint.editing_style?.version || 0)
  },
  timeline: canonicalTimeline, // Array ordenado com asset_id e trims
  overlays: canonicalOverlays, // Array ordenado por start_ms, end_ms, type, text normalizado
  captions: canonicalCaptions, // Array ordenado por start_ms
  composition_directives: canonicalDirectives,
  input_assets: canonicalInputAssets // Array com asset_id e file_hash físico dos bytes de entrada
};

const render_key = crypto.createHash('sha256')
  .update(canonicalStringify(renderSpec), 'utf8')
  .digest('hex');
```

---

## 11. Segurança, Limites Rígidos e Resiliência (DDoS & Memory Guards)

Para proteger o VPS de 1 Core / 2 GB RAM contra exaustão de CPU e memória:

| Parâmetro de Segurança | Limite Rígido (Fail-Fast) | Justificativa |
|---|---|---|
| Quantidade Máxima de Overlays | **Máximo 20** por criativo | Previne graphs FFmpeg gigantescos |
| Tamanho Máximo de Texto por Overlay | **Máximo 250 caracteres** | Evita estouro de buffer e quebra de layout |
| Quantidade Máxima de Segmentos de Caption | **Máximo 60** por vídeo | Cobre vídeos de até 120s com sobra |
| Duração Máxima do Vídeo | **Máximo 120.000 ms (2 minutos)** | Protege tempo de renderização e CPU |
| Timeout de Execução do FFmpeg | **180 segundos (3 minutos)** | Folga segura para encoding com filtros |
| Whitelist de Caracteres em `creative_id` | `/^[a-zA-Z0-9_-]{1,64}$/` | Previne path traversal |
| Validação de Coordenadas e Bounds | $0 \le \text{start\_ms} < \text{end\_ms} \le \text{duração\_total}$ | Rejeita overlays fora da timeline do vídeo |

---

## 12. Modo Shadow Aditivo (Isolamento Absoluto)

A Fase 3C é implementada em **Shadow Mode Aditivo**:
- Artefatos gerados: `outputs/jobs/<jobId>/shadow_3c_<creative_id>_<render_key_curta>.mp4`.
- Registro no catálogo: `asset_type = 'shadow_creative_3c'`.
- Endpoints do Painel:
  - `POST /api/v2/panel/video-jobs/:id/compose-shadow-3c/:index`
  - `GET /api/v2/panel/video-jobs/:id/shadow-3c-video/:index`
  - `GET /api/v2/panel/video-jobs/:id/compare-shadow-3c/:index`
- **Zero Impacto:** As colunas oficiais da Fase 2C (`pilot_video_url`, `video2_url`, `video3_url`, `video_jobs.status`) permanecem **100% intocadas**.

---

## 13. Respostas Objetivas às 20 Decisões Obrigatórias

1. **Qual será o schema/version do Blueprint para 3C?**  
   `schema_version: "1.1"` (com retrocompatibilidade total para `1.0`).

2. **Como representar `editing_style`?**  
   Objeto explícito com identificador e versão: `editing_style: { style_id: "performance_reels_v1", version: 1 }`.

3. **Onde ficam os style presets?**  
   No módulo de código versionado Git (`video_engine/styles/presets.js`). Sem necessidade de migrations no banco.

4. **Como overlays são representados?**  
   Array declarativo `overlays: [{ id, type, text, start_ms, end_ms, position, preset }]` com validação de bounds.

5. **Como evitar filter injection?**  
   Higienização estrita de caracteres (`\`, `:`, `'`, `%`, `[`, `]`, `\n`) em `sanitizeDrawtextString()`, parâmetros declarativos restritos e nunca aceitando fragmentos crus de filtergraph do cliente.

6. **Como captions são representadas?**  
   Segmentos pré-sincronizados no Blueprint em `captions: [{ start_ms, end_ms, text }]` (Opção A).

7. **B-roll entra já no MVP ou fica para 3C.2?**  
   Fica estruturado formalmente no contrato e implementação principal para a subfase **3C.2**, mantendo o MVP 3C.1 focado em overlays tipográficos e motion leve.

8. **PIP entra já no MVP ou fica para 3C.2?**  
   Fica formalizado para a subfase **3C.2**, evitando dispersão do escopo no MVP 3C.1.

9. **Quais motion effects entram no MVP?**  
   `punch_zoom` determinístico em início de corte/preço e `fade_in`/`fade_out` em overlays.

10. **Quais tipos de overlays entram no MVP?**  
    `headline`, `price_badge`, `location_tag`, `cta_banner` e `caption_segment`.

11. **Quais limites de quantidade/tamanho serão impostos?**  
    Máx 20 overlays, máx 250 chars por string, máx 60 captions, máx 120s de duração.

12. **Como style/overlays alteram `render_key`?**  
    Todos os elementos do style e overlays entram na serialização canônica recursiva antes da geração do hash SHA-256.

13. **Como compatibilidade com Blueprint antigo é preservada?**  
    Blueprints com `schema_version: "1.0"` ou sem overlays são interpretados como timeline sequencial limpa (estilo `clean_raw` sem drawtext), executando exatamente como na Fase 3B.

14. **Como Shadow 3C é diferenciado de Shadow 3B?**  
    Identificado por `asset_type = 'shadow_creative_3c'`, prefixo de arquivo `shadow_3c_` e contrato `composer_v2`.

15. **Quais módulos novos serão necessários?**  
    - `video_engine/styles/presets.js` (Catálogo de Estilos de Edição)  
    - `video_engine/overlay_service.js` (Compilador de Filtros e Sanitizador de Overlays)

16. **Será necessária migration?**  
    **Não.** A coluna `creative_blueprints JSONB` e a tabela `video_assets` já comportam os novos payloads e asset types sem alterações de DDL.

17. **Como serão tratados fonts/presets?**  
    Mapeamento lógico em `FONT_REGISTRY` apontando para fontes canônicas existentes no SO (`/usr/share/fonts/truetype/dejavu/...`), com verificação fail-fast de existência física.

18. **Qual timeout esperado para Composer 3C?**  
    Aumentado de 120s para **180 segundos (3 minutos)** para suportar filtergraphs com múltiplos nós de drawtext e scaling.

19. **Qual será a estratégia de QC?**  
    Inspeção pós-render via `ffprobe` validando codecs H.264/AAC, resolução 1080x1920, framerate 30 fps, sincronismo áudio/vídeo e tolerância de duração ($\pm 250\text{ ms}$).

20. **Quais critérios precisam passar para liberar implementação?**  
    Aprovação externa do plano, zero alterações de código no momento, criação da suíte de 45 testes automatizados cobrindo todos os cenários de injeção, styles, overlays, limites e não-regressão da Fase 2C e WhatsApp V1.

---

## 14. Suíte de Testes Planejada para a Fase 3C (45 Cenários)

1. Blueprint 1.0 legado renderiza normalmente sem overlays.
2. Blueprint 1.1 sem overlays renderiza de forma idêntica ao 1.0.
3. Editing style `performance_reels_v1` aplica fontes e cores corretas.
4. Editing style `clean_modern_v1` aplica tipografia e lower thirds.
5. Editing style `minimal_luxury_v1` aplica estilo sóbrio.
6. Editing style inexistente é rejeitado com erro descritivo fail-fast.
7. Alteração no `style_id` altera a `render_key`.
8. Alteração na `version` do style altera a `render_key`.
9. Overlay `headline` renderiza texto na área `top_safe`.
10. Overlay `price_badge` renderiza preço com caixa de destaque.
11. Overlay `location_tag` renderiza bairro/cidade.
12. Overlay `cta_banner` renderiza chamada de ação nos segundos finais.
13. Captions sincronizadas renderizam nos intervalos temporais especificados.
14. Overlay com caracteres acentuados PT-BR (ç, ã, é, ó, ú) renderiza sem quebra.
15. Tentativa de filter injection com `:` e `\` é neutralizada pelo sanitizador.
16. Tentativa de injection com aspas simples `'` não quebra o comando FFmpeg.
17. Overlay fora dos limites de tempo ($t_{\text{start}} \ge \text{duração}$) é rejeitado.
18. Overlay com $t_{\text{start}} \ge t_{\text{end}}$ é rejeitado.
19. Overlay com texto vazio ou nulo é rejeitado.
20. Excesso de overlays (> 20) é rejeitado com erro de limite.
21. Texto excedendo limite (> 250 chars) é rejeitado com erro de limite.
22. Posição declarativa desconhecida é rejeitada.
23. Punch zoom é aplicado nos limites de timing corretos.
24. Fade in/out de overlay opera suavemente sem corte abrupto de opacidade.
25. Safe area superior (240px) e inferior (360px) respeitadas nos cálculos.
26. Alteração em qualquer texto de overlay altera a `render_key`.
27. Alteração no timing de um overlay altera a `render_key`.
28. Mesma receita com mesmos overlays gera retorno idempotente imediato.
29. Concorrência no Composer 3C respeita o claim atômico PostgreSQL.
30. Cleanup autônomo de `.tmp` em caso de falha no render 3C.
31. Vídeo de saída possui resolução estritamente 1080x1920.
32. Vídeo de saída possui framerate canônico 30 fps.
33. Vídeo de saída possui stream de áudio AAC e vídeo H.264.
34. Sincronismo entre áudio e vídeo mantido dentro da tolerância ($\le 200\text{ ms}$).
35. Recuperação controlada de READY corrompido em artefatos 3C.
36. Path traversal em `creative_id` bloqueado.
37. Fonte de preset inexistente gera erro claro fail-fast.
38. Modo Shadow 3C gera arquivo `shadow_3c_` sem mutar campos da 2C.
39. Endpoint `/compose-shadow-3c/:index` responde com HTTP 200 e specs completas.
40. Endpoint `/shadow-3c-video/:index` realiza streaming autenticado do MP4 3C.
41. Endpoint `/compare-shadow-3c/:index` compara legado vs 3C.
42. Job showcase da Fase 2C permanece 100% íntegro servindo os 3 vídeos (HTTP 200).
43. WhatsApp V1 permanece 100% íntegro e operacional.
44. Bloqueio estático 403 em `/outputs/jobs/` permanece ativo.
45. PM2 `bali-gestor` e PostgreSQL 16 saudáveis após execução contínua.

---

## 15. Roadmap Conceitual Pós-Fase 3C

```
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3C: Editing Styles & Overlays Dinâmicos (MVP)               │
│ - Presets de edição versionáveis, Overlay Engine, Captions, QC  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3D: Reference Library & Video DNA                           │
│ - Extração de arquétipos de anúncios vencedores (padrões visuais)│
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3E: Creative Combinatorics & Batch Variations               │
│ - Matriz N ganchos x M corpos x K estilos = Coleções em escala   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ FASE 3F: Creative IDs & Meta Ads Performance Feedback Loop       │
│ - Rastreamento de criativos no Meta Ads e aprendizado contínuo   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 16. Conclusão da Etapa PLAN ONLY

O plano acima detalha a arquitetura exata, contratos declarativos, mitigação de segurança e isolamento de execução da Fase 3C.

**Nenhuma linha de código de produção, migration ou deploy foi executada nesta etapa.**  
Aguardando revisão e aprovação externa para liberação de implementação.
