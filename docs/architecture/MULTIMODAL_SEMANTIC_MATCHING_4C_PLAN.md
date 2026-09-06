# DIAGNÓSTICO E PLANO DE ARQUITETURA — MULTIMODAL SEMANTIC MATCHING (FASE 4C)

**Status:** PLANEJAMENTO E HARDENING TÉCNICO (DOCS-ONLY)  
**Fases Anteriores Homologadas:**
- **4A.1:** Media Understanding / Property Video (`5c6b48a...`) ✅
- **4A.2:** Script Timing / Forced Alignment (`56ba595...`) ✅
- **4A.3:** Semantic Matching / Creative Director Video-Only (`9319baa...`) ✅
- **4B.1:** Photo Ingestion & Materialization Proof (`b23bfed...`) ✅
- **4B.2:** Photo Media Understanding Proof (`e3000b6de009d9a93f025a01b5c4b61199db7082`) ✅  
**Data:** 06/09/2026  
**Autores:** Video Engine Team & External Review Hardening  

---

## 1. Auditoria e Diagnóstico do Estado Atual

### 1.1 Conquistas Homologadas das Fases Anteriores
A infraestrutura do Video Engine V2 atingiu maturidade física e semântica completa em ambas as modalidades de mídia imobiliária:

1. **Vídeo de Imóvel (4A.1 & 4A.3):**
   - Ingestão, inspeção física por ffprobe e streaming SHA-256.
   - Decomposição temporal de tour contínuo em segmentos homogêneos (`start_ms`, `end_ms`).
   - Classificação semântica em 16 ambientes (`ALLOWED_ROOM_TYPES`) e 16 características (`ALLOWED_FEATURES`).
   - Scoring intrínseco (`technical_quality_score`, `aesthetic_score`, `confidence`).
   - Creative Director 4A.3 capaz de alinhar beats de roteiro com trechos de vídeo (Video-Only).

2. **Fotos de Imóvel (4B.1 & 4B.2):**
   - Download seguro, validação física, decodificação completa e armazenamento content-addressed no blob store global.
   - Identidade property-scoped (`ast_pimg_<hex32>`) separada da identidade física do blob (`physical_file_hash`).
   - Análise semântica por VLM com taxonomia idêntica (16 ambientes, 16 features).
   - Decomposição profunda de qualidade em 3 pilares independentes: `technical_quality`, `aesthetic_score` e `editorial_utility`.
   - Reconciliação semântica com categorias do CRM e ranking intra-ambiente comprovado (Showcase REF 1628 com 100% de acurácia semântica e 0 alucinações).

### 1.2 O Gap Atual: Creative Director Mono-Modal (Video-Only)
Embora as fotos estejam materializadas e semanticamente indexadas no catálogo do imóvel, o Creative Director 4A.3 atual opera exclusivamente sobre o array `segments` de um único vídeo de propriedade:

```
[ESTADO ATUAL 4A.3]:
Script Beats ──► Intent Extractor ──► Media Ranker (Video Segments Only) ──► Continuity Engine ──► Video Blueprint 1.2
                                            ▲
                                            │ [FOTOS 4B.2 INACESSÍVEIS AO DIRETOR]
```

### 1.3 Limitações do Modelo Video-Only Atual
1. **Ausência de Evidência Visual Específica:** Quando o vídeo do imóvel passa rapidamente por um ambiente (ex: 1,2s de uma cozinha de passagem) ou não enquadra uma característica mencionada pelo apresentador (ex: "armários planejados de alta marcenaria"), o sistema é forçado a usar um take curto de vídeo ou cair em fallback, ignorando que o CRM possui fotografias profissionais estáticas de altíssima resolução daquele exato detalhe.
2. **Qualidade Visual Heterogênea:** Vídeos de corretores ou tours amadores frequentemente apresentam tremores, compressão agressiva ou iluminação desfavorável em certos cômodos, enquanto o ensaio fotográfico profissional do imóvel possui enquadramento e iluminação perfeitos.
3. **Falta de Abstração Multimodal Unificada:** O `MediaRanker` e o `EditorialContinuityEngine` tratam candidatos apenas como `property_video_segment` com intervalos fixos de corte (`source_in_ms`, `source_out_ms`), não compreendendo a natureza atemporal e infinitamente flexível de uma fotografia estática (animada via Ken Burns).

---

## 2. Visão Geral e Arquitetura da Fase 4C — Multimodal Semantic Matching

A Fase 4C introduz o **Creative Director Multimodal**, capacitando o motor editorial a avaliar simultaneamente todos os segmentos de vídeo e fotografias disponíveis para cada beat do roteiro, selecionando de forma determinística e imparcial a melhor evidência visual para o público.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                PROPERTY SEMANTIC MEDIA POOL (4C)                                 │
│                                                                                                  │
│  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────────────┐  │
│  │ PROPERTY VIDEO SEGMENTS (4A.1)               │  │ PROPERTY PHOTOS (4B.2)                   │  │
│  │ - asset_id: ast_pvid_...                     │  │ - asset_id: ast_pimg_...                 │  │
│  │ - temporal: [start_ms, end_ms]               │  │ - atemporal: [0..infinito]                │  │
│  │ - semantic: { room_type, features, conf }    │  │ - semantic: { room_type, features, conf }│  │
│  │ - quality: { tech_score, aesthetic_score }   │  │ - quality: { tech, aesthetic, editorial } │  │
│  └──────────────────────┬───────────────────────┘  └─────────────────────┬────────────────────┘  │
└─────────────────────────┼────────────────────────────────────────────────┼───────────────────────┘
                          │                                                │
                          ▼                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. UNIFIED CANDIDATE POOL GENERATION                                                             │
│ Projeção determinística de todos os recursos de mídia como UnifiedMediaCandidate                │
└─────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. MULTIMODAL MEDIA RANKER                                                                       │
│ Avaliação por Beat de Roteiro:                                                                   │
│ - Semantic Relevance (50%): Match exato/compatível de room_type + Bônus de features             │
│ - Intrinsic Quality (30%): Qualidade técnica + Estética normalizada + Utilidade editorial       │
│ - Aesthetic & Framing Strength (20%): Força composicional do enquadramento                       │
│ - Penalidades: Repetição recente (-0.25)                                                         │
│                                                                                                  │
│ Invariante: SEM viés cego (vídeo nem sempre ganha; foto com alta estética nem sempre ganha)      │
└─────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. MULTIMODAL EDITORIAL CONTINUITY ENGINE                                                        │
│ Regras Cinematográficas & Pacing:                                                                │
│ - Duração de Foto: min 1.500ms / max 6.000ms (ideal 3.500ms - 4.000ms)                          │
│ - Duração de Vídeo: min 1.500ms / limitado pelo footage real disponível                          │
│ - Take Extension contínuo para vídeo no mesmo ambiente                                           │
│ - Divisão rítmica de beats longos (> 5.000ms) em múltiplos takes compatíveis                     │
│ - Política Anti-Flicker / Anti-Ping-Pong (evitar alternância rápida vídeo/foto/vídeo sem razão)  │
│ - Fallback Hierarchy Auditável: Match Semântico -> High-Utility General Photo/Video -> Avatar FP │
└─────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. CREATIVE DIRECTION PLAN (Schema 1.1) & BLUEPRINT 1.2 COMPILER                                 │
│ - Geração do plano auditável com creative_direction_key unificada                                │
│ - Compilação para Blueprint 1.2:                                                                 │
│   • Video Segment: asset_type = 'video', source_in_ms, source_out_ms, fit = 'cover'              │
│   • Photo: asset_type = 'image', source_in_ms = null, source_out_ms = null (Ken Burns nativo)    │
│   • Presenter PIP: janela sobreposta com lip-sync sincronizado                                   │
└─────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 5. COMPOSER SERVICE V3 (Execução Física FFmpeg)                                                  │
│ Renderização determinística em 1080x1920@30fps H.264 + AAC                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Modelo de Candidato Unificado (`UnifiedMediaCandidate`)

Para garantir que o `MediaRanker` compare vídeos e fotos em pé de igualdade sem assumir estruturas incompatíveis, definimos a interface canônica de um candidato visual:

### 3.1 Interface do Candidato Unificado
```typescript
interface UnifiedMediaCandidate {
  // Identificação e Proveniência
  candidate_id: string;                    // "seg_02_kitchen" ou "img_04_balcony"
  media_kind: "video_segment" | "photo";   // Modalidade física
  asset_id: string;                        // ID do asset no banco (ast_pvid_... ou ast_pimg_...)
  physical_file_hash: string;              // SHA-256 dos bytes reais no disco
  
  // Metadados Específicos por Modalidade
  segment_index?: number;                  // Índice temporal se for vídeo (0..N)
  storage_path: string;                    // Caminho absoluto local no blob store
  
  // Informações Semânticas Padronizadas (Compartilhadas 4A.1 / 4B.2)
  semantic: {
    primary_room_type: string;             // Um dos 16 ALLOWED_ROOM_TYPES
    secondary_room_types: string[];        // Ambientes secundários visíveis
    features: string[];                    // Subconjunto dos 16 ALLOWED_FEATURES
    confidence: number;                    // [0.00 .. 1.00]
  };
  
  // Pontuações Intrínsecas Decompostas e Normalizadas
  quality: {
    technical_quality_score: number;       // [0.00 .. 1.00] Nitidez, iluminação, compressão
    aesthetic_score: number;               // [0.00 .. 1.00] Harmonia visual, composição
    editorial_utility_score: number;       // [0.00 .. 1.00] Utilidade imobiliária para corte
    normalized_intrinsic_score: number;    // [0.00 .. 1.00] Média ponderada intrínseca
  };
  
  // Disponibilidade Temporal
  temporal: {
    is_static: boolean;                    // true para fotos, false para vídeo
    available_start_ms: number;            // Consumed start para vídeo; 0 para foto
    available_end_ms: number;              // Segment end_ms para vídeo; Infinity para foto
    available_duration_ms: number;         // Duração física disponível restante
    min_recommended_duration_ms: number;   // 1500ms
    max_recommended_duration_ms: number;   // 6000ms para foto; segment duration para vídeo
  };
}
```

### 3.2 Catálogo Semântico Unificado do Imóvel (`UnifiedPropertyMediaCatalog`)
O catálogo reúne a análise do vídeo (se existir) e todas as fotos homologadas:

```javascript
const unifiedCatalog = {
  property_ref: "1628",
  property_semantic_media_pool_key: "3a8f1b...",
  video_assets: [
    {
      asset_id: "ast_pvid_1628_video",
      physical_file_hash: "fa92c...",
      analysis_key: "mu_vid_1628_...",
      segments: [ ... ] // Segmentos 4A.1
    }
  ],
  photo_assets: [
    {
      asset_id: "ast_pimg_1628_01",
      physical_file_hash: "c2e17...",
      photo_analysis_key: "pa_photo_c2e17...",
      semantic_view: { ... } // Semantic view 4B.2
    }
  ]
};
```

---

## 4. Algoritmo Multimodal de Scoring e Seleção Imparcial

### 4.1 Princípio de Imparcialidade Multimodal (Zero Bias)
O sistema deve escolher a mídia que entrega a **melhor experiência semântica e visual ao usuário**, sem favorecer cegamente nem o vídeo ("porque tem movimento") nem a foto ("porque a resolução da câmera estática é maior"):

1. **Forças Naturais do Vídeo:**
   - Movimento contínuo, sensação de profundidade espacial, dinâmica de caminhada pelo imóvel.
   - Ideal para beats de transição, descrições gerais de living, sacada integrada e circulação.
2. **Forças Naturais da Fotografia:**
   - Enquadramento limpo e estático, foco cirúrgico em acabamentos, iluminação estável, nitidez cristalina em detalhes específicos (ex: churrasqueira, armários, bancada de mármore).
   - Ideal para beats com foco em detalhes arquitetônicos e features de alta qualidade.

### 4.2 Equação Canônica de Matching Multimodal

Para cada candidato $c \in \text{UnifiedCandidates}$ e beat $b$:

$$\text{FinalScore}(c, b) = \Big( w_{\text{rel}} \cdot \text{SemanticRelevance}(c, b) \Big) + \Big( w_{\text{tech}} \cdot \text{IntrinsicQuality}(c) \Big) + \Big( w_{\text{aes}} \cdot \text{AestheticStrength}(c) \Big) - \text{RepetitionPenalty}(c)$$

Onde os pesos canônicos padronizados são:
- $w_{\text{rel}} = 0.50$ (Relevância Semântica — Autoridade Primária)
- $w_{\text{tech}} = 0.30$ (Qualidade Técnica Normalizada)
- $w_{\text{aes}} = 0.20$ (Estética / Força de Enquadramento)

#### A. Cálculo da Relevância Semântica ($\text{SemanticRelevance}$)
A relevância semântica segue as mesmas regras rigorosas da 4A.3, estendidas para suportar `secondary_room_types`:

1. **Cômodo Incompatível:** Se o beat solicitou explicitamente um ou mais `requested_room_types` e o candidato não possui match exato nem compatível (em `primary_room_type` ou `secondary_room_types`), a relevância é **0.00** (descarte imediato).
2. **Match Exato Primário:** Se `candidate.primary_room_type` $\in \text{requested\_rooms} \implies \text{BaseScore} = 0.80$.
3. **Match em Ambientes Compatíveis / Secundários:**
   - Se `candidate.primary_room_type` é contíguo/compatível $\implies \text{BaseScore} = 0.50$.
   - Se um dos `secondary_room_types` dá match exato $\implies \text{BaseScore} = 0.65$.
4. **Bônus de Características ($\text{Features}$):**
   - Para cada feature solicitada presente no candidato: $+0.10$ por feature (teto máximo de $+0.20$).
5. **Beat Abstrato / Conceitual:** Se o beat não solicita cômodo nem feature: $\text{BaseScore} = 0.30$.

$$\text{SemanticRelevance} = \min(1.00, \text{round}(\text{BaseScore} + \text{FeatureBonus}, 2))$$

#### B. Normalização da Qualidade Intrínseca ($\text{IntrinsicQuality}$)
Para garantir comparabilidade justa entre modalidades:

- **Para Vídeo:**
  $$\text{IntrinsicQuality}_{\text{video}} = 0.50 \cdot \text{technical\_quality\_score} + 0.50 \cdot \text{aesthetic\_score}$$
- **Para Foto:**
  $$\text{IntrinsicQuality}_{\text{photo}} = 0.35 \cdot \text{technical\_quality} + 0.35 \cdot \text{aesthetic\_score} + 0.30 \cdot \text{editorial\_utility}$$

#### C. Força Estética / Enquadramento ($\text{AestheticStrength}$)
- **Para Vídeo:**
  $$\text{AestheticStrength}_{\text{video}} = \text{aesthetic\_score}$$
- **Para Foto:**
  $$\text{AestheticStrength}_{\text{photo}} = 0.60 \cdot \text{editorial\_utility} + 0.40 \cdot \text{aesthetic\_score}$$

#### D. Penalidade de Repetição ($\text{RepetitionPenalty}$)
- Se a mesma foto física (`physical_file_hash`) ou o mesmo segmento de vídeo (`segment_index`) foi utilizado no beat imediatamente anterior sem intenção de extensão contínua:
  $$\text{RepetitionPenalty} = 0.25$$

### 4.3 Critérios de Desempate Estrito (Deterministic Tie-Breaking)
Em caso de scores muito próximos ($|\Delta| \le 0.001$):
1. **Viabilidade Temporal:** Candidato com viabilidade plena precede candidato com necessidade de truncamento.
2. **Relevância Semântica DESC:** Candidato com maior `semantic_relevance`.
3. **Confiança Semântica DESC:** Candidato com maior `confidence`.
4. **Qualidade Editorial DESC:** Candidato com maior `editorial_utility_score` ou `aesthetic_score`.
5. **Critério Lexicográfico ASC:** `asset_id` e `candidate_id` ordenados deterministicamente por string.

---

## 5. Motor de Continuidade Editorial e Regras Cinematográficas (Pacing Engine)

### 5.1 Regras Temporais de Exibição de Fotografias
Fotografias estáticas geram uma excelente experiência visual quando animadas sutilmente pelo efeito Ken Burns do Composer V3. No entanto, sua duração em tela deve respeitar a fisiologia da atenção humana:

- **Duração Mínima de Foto (`min_photo_visual_duration_ms`):** **1.500ms** (evita flashes e sensação de erro de corte).
- **Duração Máxima Recomendada de Foto (`max_photo_visual_duration_ms`):** **6.000ms** (evita monotonia visual em fotos paradas).
- **Faixa Ideal de Retenção de Foto:** **2.500ms a 4.500ms**.

### 5.2 Regras de Continuidade e Decomposição de Beats Longos

```
CASO 1: Beat Curto / Médio (1.500ms a 5.000ms)
┌───────────────────────────────────────────────────────────┐
│ Beat #1 (3.200ms - "A cozinha possui bancada em granito") │
└─────────────────────────────┬─────────────────────────────┘
                              ▼
┌───────────────────────────────────────────────────────────┐
│ Decisão Única: Foto #4 da Cozinha (Ken Burns 3.200ms)     │
└───────────────────────────────────────────────────────────┘

CASO 2: Beat Longo (> 5.000ms, ex: 8.000ms sobre a Suíte Master)
┌───────────────────────────────────────────────────────────┐
│ Beat #3 (8.000ms - "A suíte master ampla com closet...")  │
└─────────────────────────────┬─────────────────────────────┘
                              ▼
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│ Take 1 (4.000ms):            │    │ Take 2 (4.000ms):            │
│ Foto da Suíte (Vista Cama)   │───►│ Foto do Closet ou Vídeo      │
└──────────────────────────────┘    └──────────────────────────────┘
```

1. **Take Extension para Vídeo:** Se o beat anterior utilizou um segmento de vídeo contínuo e o beat atual solicita o mesmo ambiente, o motor estende o mesmo corte de vídeo sem gerar corte abrupto (se houver footage restante disponível).
2. **Não-Extensão de Foto em Beats Distintos:** Diferente do vídeo, uma fotografia **não é estendida estaticamente** através de múltiplos beats que mudam de foco textual. Se o próximo beat continua no mesmo cômodo, o motor prioriza selecionar um **segundo ângulo ou foto diferente** do mesmo ambiente para enriquecer o dinamismo.
3. **Política Anti-Ping-Pong:** O motor penaliza transições ultra-rápidas alternadas entre modalidades (ex: Foto 1,5s $\to$ Vídeo 1,5s $\to$ Foto 1,5s $\to$ Vídeo 1,5s), a menos que haja forte disparidade semântica que justifique o corte.

### 5.3 Hierarquia Canônica de Fallback Auditável

Quando não há correspondência semântica suficiente ($\text{semantic\_relevance} < 0.40$) ou footage/foto disponível:

```
[NÍVEL 1: MATCH SEMÂNTICO FORTE]
Relevância >= 0.40 (Vídeo ou Foto do Cômodo)
               │
               ▼ (Se não houver candidatos viáveis)
[NÍVEL 2: ASSET GENÉRICO DE ALTA QUALIDADE ESTÉTICA DO IMÓVEL]
Melhor Foto ou Vídeo Geral do Imóvel (Fachada, Sala de Estar, Varanda com Alta Estética)
`fallback_used: true, fallback_type: 'generic_property_media'`
               │
               ▼ (Se não houver mídia física utilizável)
[NÍVEL 3: APRESENTADOR EM TELA CHEIA (FULLSCREEN)]
Avatar em tela cheia com lip-sync ativo
`fallback_used: true, fallback_type: 'presenter_fullscreen'`
```

Cada decisão do plano registra expressamente:
- `fallback_used: boolean`
- `fallback_type: string | null` (`'generic_property_media'`, `'presenter_fullscreen'`, etc.)
- `selection_reason: string` com rationale legível para auditoria.

---

## 6. Fingerprint e Identidade Canônica do Creative Direction Plan

Para garantir que o plano seja **100% determinístico e imutável**, o `creative_direction_key` incorpora a identidade de todo o pool de mídia semântica consumido:

### 6.1 Identidade Canônica do Media Pool (`property_semantic_media_pool_key`)

$$\text{property\_semantic\_media\_pool\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{ \text{video\_assets}, \text{photo\_assets} \}\big)\Big)$$

Onde:
- `video_assets`: array ordenado por `asset_id` com `{ asset_id, physical_file_hash, analysis_key, segments_count }`.
- `photo_assets`: array ordenado por `asset_id` com `{ asset_id, physical_file_hash, photo_analysis_key, primary_room_type }`.

### 6.2 Identidade Canônica do Plano Editorial (`creative_direction_key`)

$$\text{creative\_direction\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{$$
$$\text{script\_timing\_key}, \text{beat\_analysis\_key}, \text{property\_semantic\_media\_pool\_key},$$
$$\text{intent\_extractor\_version}, \text{media\_ranker\_version}, \text{continuity\_engine\_version},$$
$$\text{fallback\_policy\_version}, \text{director\_version}, \text{scoring\_weights},$$
$$\text{semantic\_thresholds}, \text{min\_visual\_duration\_ms}, \text{schema\_version}: \"1.1.0\"$$
$$\}\big)\Big)$$

---

## 7. Schema de Direção Criativa e Compilação em Blueprint 1.2

### 7.1 Schema da Decisão Visual (`visual_decisions`)
A decisão visual suporta nativamente ambas as modalidades:

```javascript
// Exemplo 1: Decisão baseada em Foto de Imóvel
{
  timeline_start_ms: 0,
  timeline_end_ms: 3500,
  timeline_duration_ms: 3500,
  media_kind: "property_photo",
  selected_asset_id: "ast_pimg_1628_04_balcony",
  physical_file_hash: "fa819...",
  selected_segment_index: null,
  source_in_ms: null,
  source_out_ms: null,
  source_duration_ms: null,
  confidence: 0.95,
  fallback_used: false,
  fallback_type: null,
  selection_reason: "Vencedor por maior score semântico (balcony, score: 0.920, editorial_utility: 0.95)"
}

// Exemplo 2: Decisão baseada em Segmento de Vídeo
{
  timeline_start_ms: 3500,
  timeline_end_ms: 7000,
  timeline_duration_ms: 3500,
  media_kind: "property_video_segment",
  selected_asset_id: "ast_pvid_1628_video",
  physical_file_hash: "2b9a1...",
  selected_segment_index: 2,
  source_in_ms: 4800,
  source_out_ms: 8300,
  source_duration_ms: 3500,
  confidence: 0.90,
  fallback_used: false,
  fallback_type: null,
  selection_reason: "Vencedor por maior score semântico (living_room, score: 0.880)"
}
```

### 7.2 Compilação Determinística para Blueprint 1.2

O compilador `compileToBlueprint12` traduz o plano editorial diretamente no contrato que o Composer V3 executa sem ambiguidade:

1. **Para Fotos (`media_kind === 'property_photo'`):**
   - `asset_id`: ID do asset da foto (`ast_pimg_...`).
   - `asset_type`: `'image'` (ativa animação Ken Burns automática no Composer V3).
   - `start_ms`, `end_ms`: intervalo da timeline.
   - `source_in_ms`, `source_out_ms`: omitidos / `null` (conforme exigido pelo schema do Composer para imagens).
   - `fit`: `'cover'`, `transition_in`: `{ type: 'cut' }`.
2. **Para Vídeos (`media_kind === 'property_video_segment'`):**
   - `asset_id`: ID do asset de vídeo (`ast_pvid_...`).
   - `asset_type`: `'video'`.
   - `start_ms`, `end_ms`: intervalo da timeline.
   - `source_in_ms`, `source_out_ms`: intervalo de corte 1:1 rigoroso.
   - `fit`: `'cover'`, `transition_in`: `{ type: 'cut' }`.
3. **Para Janelas PIP (Picture-in-Picture):**
   - Janela do apresentador posicionada no canto (`bottom_right`) sincronizada com o lip-sync de áudio em todos os trechos de B-roll.

---

## 8. Matriz de Testes Automatizados da Fase 4C

Para assegurar estabilidade absoluta e ausência de regressões, a Fase 4C implementará uma suíte de testes com **35 cenários formais**:

| ID | Categoria | Descrição do Cenário de Teste |
| :--- | :--- | :--- |
| **Cenário A** | Unificação de Candidatos | Valida que `buildUnifiedMediaCandidates` projeta vídeos e fotos com campos homogêneos sem perdas. |
| **Cenário B** | Cálculo de Pool Key | Valida determinismo estrito de `property_semantic_media_pool_key` (mesmo input = mesmo hash). |
| **Cenário C** | Invalidação de Pool Key | Valida que a alteração de 1 foto ou 1 segmento altera o `property_semantic_media_pool_key`. |
| **Cenário D** | Match Semântico de Foto | Beat pede "cozinha" e foto da cozinha é classificada com relevância $\ge 0.80$. |
| **Cenário E** | Match Semântico de Vídeo | Beat pede "sala de estar" e segmento da sala é classificado com relevância $\ge 0.80$. |
| **Cenário F** | Competição Multimodal (Foto Vence) | Vídeo da cozinha é instável/escuro (tech 0.40) e foto da cozinha é profissional (tech 0.95, util 0.95); Foto vence. |
| **Cenário G** | Competição Multimodal (Vídeo Vence) | Foto do quarto é de baixa utilidade (util 0.30) e vídeo do quarto é estável (tech 0.85, aest 0.85); Vídeo vence. |
| **Cenário H** | Bônus de Features | Beat pede "varanda com churrasqueira"; foto com `barbecue_grill` pontua $+0.10$ acima da foto sem feature. |
| **Cenário I** | Descarte de Cômodo Incompatível | Beat pede "banheiro"; fotos e vídeos de "garagem" recebem relevância $0.00$ e são descartados. |
| **Cenário J** | Ambientes Secundários | Foto com `primary_room_type: living_room` e `secondary_room_types: ['balcony']` é aceita para pedido de varanda. |
| **Cenário K** | Limite Mínimo de Duração de Foto | Nenhuma foto é agendada com duração inferior a 1.500ms. |
| **Cenário L** | Limite Máximo de Duração de Foto | Foto única não ultrapassa 6.000ms; beats longos geram sequência de 2 takes. |
| **Cenário M** | Take Extension de Vídeo | Dois beats contíguos de sala usam o mesmo segmento de vídeo de forma contínua sem corte artificial. |
| **Cenário N** | Não-Extensão Estática de Foto | Dois beats contíguos de quarto com fotos alternam para um segundo ângulo fotográfico. |
| **Cenário O** | Penalidade de Repetição | Foto usada no Beat 1 recebe penalidade de $-0.25$ no Beat 2 se tentar ser reutilizada sem justificativa. |
| **Cenário P** | Anti-Ping-Pong | Sequência com opções de scores equivalentes mantém modalidade homogênea para evitar flicker. |
| **Cenário Q** | Fallback Geral de Mídia | Beat sem match semântico seleciona a mídia do imóvel com maior estética geral (`generic_property_media`). |
| **Cenário R** | Fallback Presenter Fullscreen | Imóvel sem fotos e sem vídeo aciona fallback limpo para `presenter_fullscreen`. |
| **Cenário S** | Validação de Schema de Decisão | `validateVisualDecision` aceita fotos (`source_in_ms: null`) e rejeita fotos com trims temporais. |
| **Cenário T** | Validação de Schema de Vídeo | `validateVisualDecision` rejeita segmentos de vídeo com divergência entre timeline e source duration. |
| **Cenário U** | Compilação Blueprint 1.2 Multimodal | `compileToBlueprint12` gera `asset_type: 'image'` para fotos e `'video'` para vídeos. |
| **Cenário V** | Validação Blueprint pelo Composer V3 | `validateBlueprintContract` do Composer V3 valida o Blueprint multimodal sem erros. |
| **Cenário W** | Lip-Sync PIP em Mídia Multimodal | Todas as cenas com B-roll (foto ou vídeo) contêm a janela PIP correspondente no Blueprint. |
| **Cenário X** | Determinismo End-to-End | Duas execuções com os mesmos inputs geram planos com chaves e decisões bit-a-bit idênticas. |
| **Cenário Y** | Reconciliação com CRM | Foto com categoria CRM `cozinha` reforça confidence sem sobrepor taxonomia VLM. |
| **Cenário Z** | Showcase REF 1628 Multimodal | Execução completa com vídeo 4A.1 + 11 fotos 4B.2 gerando plano editorial superior ao 4A.3. |

---

## 9. Plano de Validação Empírica — Showcase REF 1628

A homologação da Fase 4C será realizada através de um teste comparativo rigoroso e auditável no imóvel canônico **REF 1628**:

### 9.1 Configuração do Teste
- **Imóvel:** REF 1628 (Apartamento Bali Imóveis).
- **Roteiro & Áudio:** Roteiro padrão de 5 beats gerado na Fase 4A.2 com timing forçado (`script_timing_key` fixo).
- **Entradas Visuais:**
  - 1 Vídeo de Propriedade (4A.1) com 8 segmentos analisados.
  - 11 Fotografias de Propriedade (4B.1 & 4B.2) analisadas com 100% de acurácia semântica.

### 9.2 Comparativo A/B
- **Versão A (Baseline 4A.3):** Creative Director Video-Only.
- **Versão B (Fase 4C Multimodal):** Creative Director Multimodal (Vídeo + 11 Fotos).

### 9.3 Métricas de Sucesso Auditáveis
1. **Precisão de Cômodo por Beat:** $\ge 90%$ de correspondência entre o que o apresentador fala e a mídia selecionada.
2. **Alinhamento de Features:** Uso de fotografias de alta resolução nos momentos em que o roteiro destaca detalhes específicos (ex: churrasqueira, armários, sacada).
3. **Dinamismo e Ritmo:** Transições suaves, sem fotos estáticas excessivamente longas ($> 6\text{s}$) e sem cortes curtos ($< 1,5\text{s}$).
4. **Validação Física do Composer V3:** Blueprint 1.2 compilado e validado pelo validador oficial do Composer V3 com zero colisões e zero erros de schema.
5. **Determinismo:** $100%$ de cache hit e identidade na segunda execução com a mesma chave.

---

## 10. Invariantes de Integridade e Limites de Escopo

1. **Zero Migrations:** Nenhuma alteração no esquema do banco de dados PostgreSQL. `video_assets` já suporta `property_video` e `property_photo`.
2. **Zero Regressões em 4A e 4B:** As fases 4A.1, 4A.2, 4A.3, 4B.1 e 4B.2 permanecem $100%$ compatíveis e suas suítes de testes devem passar integralmente (183+ testes).
3. **Isolamento de Produção:** Nenhuma chamada externa desnecessária; cache canônico respeitado integralmente.
4. **Composer V3 Intacto:** O Composer V3 já suporta Blueprint 1.2 com `asset_type: 'image'` e `'video'`. Nenhuma alteração no core do renderizador é necessária.
5. **Auditoria Total:** Toda decisão de seleção registra a rationale completa (`evaluated_candidates`, `selection_reason`, `fallback_used`).

---

**Fim do Plano de Arquitetura — Fase 4C.**
