# DIAGNÓSTICO E PLANO DE ARQUITETURA HARDENED — MULTIMODAL SEMANTIC MATCHING (FASE 4C)

**Status:** REVISÃO ADVERSARIAL FINAL & HARDENING TÉCNICO CONCLUÍDO (DOCS-ONLY)  
**Último SHA Homologado:** `e3000b6de009d9a93f025a01b5c4b61199db7082`  
**Data da Revisão:** 06/09/2026  
**Autores:** Video Engine Team & Adversarial Review Hardening  

---

## 1. Auditoria e Diagnóstico do Estado Real do Repositório

### 1.1 Contratos Reais das Fases Anteriores
A auditoria direta sobre o código-fonte confirmou a estabilidade e os contratos exatos das fases homologadas:

1. **Script Timing (4A.2):**
   - Retorna `scriptTimingResult` com `alignment_key`, `beat_analysis_key` e array `beats`.
   - Cada beat possui: `{ beat_index, start_ms, end_ms, duration_ms, text }`.
2. **Media Understanding de Vídeo (4A.1):**
   - Retorna `mediaUnderstandingResult` com `analysis_key`, `physical_file_hash` e array `segments`.
   - Cada segmento possui: `{ segment_index, start_ms, end_ms, room_type, features, technical_quality_score, aesthetic_score, confidence }`.
3. **Photo Ingestion & Materialization (4B.1):**
   - Persiste `property_photo` no banco `video_assets` com `id` (`ast_pimg_<ref>_<hash32>`), `storage_path` canônico global no blob store (`outputs/media_blobs/photos/<hash>.<ext>`), `file_hash` SHA-256 streaming e status `ready`.
   - `getPropertyMediaPool(propertyRef)` expõe fotos e vídeos fisicamente validados.
4. **Photo Media Understanding (4B.2):**
   - Analisa blobs físicos via VLM e armazena `GlobalPhotoAnalysis` no cache global content-addressed (`outputs/media_analysis/photos/<photo_analysis_key>/analysis.json`).
   - `CrmCategoryReconciler.projectSemanticView` projeta `PropertyPhotoSemanticView` com:
     `{ asset_id, property_ref, physical_file_hash, storage_path, specs, semantic: { primary_room_type, secondary_room_types, features, confidence }, quality: { technical_quality, aesthetic_score, editorial_utility }, intra_room_rank }`.
5. **Creative Blueprint 1.2 & Composer V3 (3C.2):**
   - Composer V3 suporta nativamente `asset_type: 'video'` (exige `source_in_ms` e `source_out_ms` com duração 1:1 rigorosa) e `asset_type: 'image'` (exige `source_in_ms: null`, `source_out_ms: null`, aplicando efeito Ken Burns automático de pan/zoom).
   - Suporta trilha de PIP do apresentador (`pip.windows`) sincronizada com o áudio da narração.

### 1.2 O Gap a ser Resolvido na Fase 4C
O Creative Director 4A.3 operava como *Video-Only*, consumindo apenas o catálogo de segmentos de vídeo. A Fase 4C unifica o catálogo de mídia do imóvel em um **Property Semantic Media Pool**, permitindo ao diretor editorial escolher imparcialmente entre trechos de vídeo e fotografias profissionais para cada beat de roteiro.

---

## 2. Modelo de Candidato Unificado (`UnifiedMediaCandidate`)

Para eliminar qualquer assimetria estrutural ou perda de informação entre vídeo e foto, todos os recursos visuais disponíveis são mapeados para a interface canônica:

```typescript
interface UnifiedMediaCandidate {
  // Identificação e Proveniência Estrita
  candidate_id: string;                    // "seg_02_kitchen" | "img_04_balcony"
  media_kind: "video_segment" | "photo";   // Modalidade física
  asset_id: string;                        // ID do asset no banco (ast_pvid_... | ast_pimg_...)
  property_ref: string;                    // REF do imóvel (ex: "1628") - Hard Invariant de Ownership
  physical_file_hash: string;              // SHA-256 dos bytes reais no disco (64 hex chars)
  storage_path: string;                    // Caminho absoluto local no blob store
  
  // Metadados Específicos por Modalidade
  segment_index: number | null;            // 0..N para vídeo; null para foto
  
  // Informações Semânticas Padronizadas (Taxonomia Canônica Compartilhada)
  semantic: {
    primary_room_type: string;             // 1 dos 16 ALLOWED_ROOM_TYPES
    secondary_room_types: string[];        // Ambientes secundários visíveis (alfabeticamente ordenados)
    features: string[];                    // Subconjunto dos 16 ALLOWED_FEATURES (alfabeticamente ordenados)
    confidence: number;                    // [0.00 .. 1.00]
  };
  
  // Pontuações Intrínsecas Decompostas e Normalizadas
  quality: {
    technical_quality_score: number;       // [0.00 .. 1.00] Nitidez, iluminação, compressão
    aesthetic_score: number;               // [0.00 .. 1.00] Harmonia visual, composição
    editorial_utility_score: number;       // [0.00 .. 1.00] Utilidade imobiliária para corte
    normalized_intrinsic_score: number;    // [0.00 .. 1.00] Média ponderada intrínseca comparável
  };
  
  // Disponibilidade Temporal e Regras de Exibição
  temporal: {
    is_static: boolean;                    // true para foto, false para vídeo
    available_start_ms: number;            // Consumed start para vídeo; 0 para foto
    available_end_ms: number;              // Segment end_ms para vídeo; Infinity para foto
    available_duration_ms: number;         // Duração física disponível restante
    min_visual_duration_ms: number;        // 1500ms
    max_visual_duration_ms: number;        // 6000ms para foto; segment duration para vídeo
  };
}
```

---

## 3. Algoritmo Multimodal de Ranking e Scoring Semântico (Sem Viés)

### 3.1 Princípio Fundamental: SEMÂNTICA > QUALIDADE
Uma mídia belíssima do ambiente errado **NUNCA** pode vencer uma mídia adequada do ambiente correto. Se o beat solicitou um cômodo específico e o candidato não pertence a esse cômodo (nem como ambiente primário, nem secundário, nem compatível), sua relevância é **0.00**, inviabilizando sua seleção.

### 3.2 Fórmula Canônica de Pontuação Multimodal

Para cada candidato $c \in \text{UnifiedCandidates}$ e beat $b$:

$$\text{FinalScore}(c, b) = \Big( w_{\text{rel}} \cdot \text{SemanticRelevance}(c, b) \Big) + \Big( w_{\text{tech}} \cdot \text{IntrinsicQuality}(c) \Big) + \Big( w_{\text{aes}} \cdot \text{AestheticStrength}(c) \Big) - \text{TotalPenalties}(c, b) + \text{Bonuses}(c, b)$$

Pesos Canônicos Padrão:
- $w_{\text{rel}} = 0.50$ (Relevância Semântica — Autoridade Primária)
- $w_{\text{tech}} = 0.30$ (Qualidade Técnica Normalizada)
- $w_{\text{aes}} = 0.20$ (Estética / Força de Enquadramento)

---

### 3.3 Regras Formais de Cálculo da Relevância Semântica ($\text{SemanticRelevance}$)

Dada a intenção do beat: $\text{reqRooms} = b.\text{requested\_room\_types}$, $\text{reqFeatures} = b.\text{requested\_features}$:

```
CASO 1: Beat Especifica Cômodo (reqRooms.length > 0)
├── Candidate primary_room_type ∈ reqRooms ──────────────► BaseScore = 0.80 (Match Exato Primário)
├── Candidate secondary_room_types ∩ reqRooms ≠ ∅ ───────► BaseScore = 0.65 (Match Secundário)
├── Candidate primary_room_type é compatível (par) ──────► BaseScore = 0.50 (Match Contíguo/Compatível)
└── Nenhuma correspondência de cômodo ──────────────────► SemanticRelevance = 0.00 (DESCARTE ESTRITO)

CASO 2: Beat Feature-Only (reqRooms.length === 0 E reqFeatures.length > 0)
├── Candidate possui pelo menos 1 feature solicitada ───► BaseScore = 0.70
└── Candidate possui ZERO features solicitadas ──────────► SemanticRelevance = 0.00 (DESCARTE ESTRITO)

CASO 3: Beat Abstrato / Conceitual (reqRooms.length === 0 E reqFeatures.length === 0)
└── Fala genérica sem menção a cômodo ou feature ───────► BaseScore = 0.30
```

#### Bônus de Features Concorrentes ($\text{FeatureBonus}$)
Para candidatos não descartados ($\text{BaseScore} > 0$):
$$\text{matchingCount} = |c.\text{features} \cap \text{reqFeatures}|$$
- No Caso 1 (com cômodo): $\text{FeatureBonus} = \min(0.20, \text{matchingCount} \cdot 0.10)$
- No Caso 2 (feature-only): $\text{FeatureBonus} = \min(0.20, (\text{matchingCount} - 1) \cdot 0.10)$
- No Caso 3 (abstrato): $\text{FeatureBonus} = 0.00$

$$\text{SemanticRelevance} = \min(1.00, \text{round}((\text{BaseScore} + \text{FeatureBonus}) \cdot 100) / 100)$$

---

### 3.4 Comparabilidade de Qualidade Intrínseca e Força Estética

Para evitar viés estrutural entre modalidades:

1. **Qualidade Intrínseca ($\text{IntrinsicQuality}$):**
   - **Vídeo:** $0.50 \cdot \text{technical\_quality\_score} + 0.50 \cdot \text{aesthetic\_score}$
   - **Foto:** $0.35 \cdot \text{technical\_quality} + 0.35 \cdot \text{aesthetic\_score} + 0.30 \cdot \text{editorial\_utility}$
2. **Força Estética / Enquadramento ($\text{AestheticStrength}$):**
   - **Vídeo:** $\text{aesthetic\_score}$
   - **Foto:** $0.60 \cdot \text{editorial\_utility} + 0.40 \cdot \text{aesthetic\_score}$

---

### 3.5 Penalidades e Bônus Editoriais

1. **Penalidade de Repetição Imediata ($\text{RepetitionPenalty} = 0.25$):**
   - Aplicada se a mesma foto física (`physical_file_hash`) ou segmento de vídeo (`segment_index`) foi usado no beat anterior sem extensão contínua declarada.
2. **Penalidade de Reutilização Recente ($\text{RecencyPenalty} = 0.10$):**
   - Aplicada se a mesma foto foi utilizada há menos de 3 beats atrás.
3. **Penalidade Anti-Ping-Pong ($\text{PingPongPenalty} = 0.15$):**
   - Aplicada a candidatos que alternariam a modalidade (`media_kind`) quando já ocorreram 2 ou mais trocas consecutivas em beats com duração menor que $2.500\text{ms}$ sem alteração de `room_type`.
4. **Bônus de Sequência Fotográfica Complementar ($\text{ComplementaryBonus} = +0.05$):**
   - Concedido a uma foto do mesmo cômodo que o beat anterior, mas com `physical_file_hash` diferente (ângulo complementar), enriquecendo a exploração visual.

---

### 3.6 Cadeia Completa e Estrita de Desempate (7-Level Tie-Breaker)

Se dois candidatos obtiverem pontuações finais equivalentes ($|\Delta \text{FinalScore}| \le 0.001$):
1. **Viabilidade Plena (`is_feasible` DESC):** Candidato que cobre a duração total precede candidato parcial.
2. **Relevância Semântica DESC (`semantic_relevance`):** Maior aderência semântica vence.
3. **Utilidade Editorial / Força Estética DESC (`editorial_utility` / `aesthetic_score`):** Melhor enquadramento vence.
4. **Qualidade Técnica DESC (`technical_quality`):** Maior nitidez/resolução vence.
5. **Confiança Semântica DESC (`confidence`):** Maior certeza do classificador vence.
6. **Preferência de Modalidade Contextual:**
   - Se o beat possui features de detalhe (`planned_cabinets`, `modern_fixtures`, `porcelain_tile`): `photo` vence `video_segment`.
   - Se o beat descreve amplitude/circulação (`spacious`, `open_concept`): `video_segment` vence `photo`.
7. **Critério Lexicográfico Imutável ASC (`asset_id` + `candidate_id`):** Desempate determinístico absoluto.

---

## 4. Motor de Continuidade Editorial e Regras Cinematográficas (Pacing Engine)

### 4.1 Limites Temporais de Exibição
- **Foto:** Duração Mínima = $1.500\text{ms}$ | Duração Máxima = $6.000\text{ms}$ (Ideal: $2.500\text{ms}$ a $4.500\text{ms}$).
- **Vídeo:** Duração Mínima = $1.500\text{ms}$ | Duração Máxima = limitada pelo footage físico restante do segmento.

### 4.2 Decomposição de Beats Longos ($> 5.000\text{ms}$)
Quando a duração de um beat $b$ excede $5.000\text{ms}$:
1. **Estratégia 1 (Vídeo Contínuo):** Se houver um segmento de vídeo do cômodo com footage disponível $\ge b.\text{duration\_ms}$, utiliza take único de vídeo.
2. **Estratégia 2 (Sequência de 2 Fotos Complementares):** Se houver $\ge 2$ fotos do cômodo, divide o beat em 2 takes ($50\% / 50\%$), alocando Foto A (ângulo geral) e Foto B (ângulo detalhe).
3. **Estratégia 3 (Multimodal Misto - Foto + Vídeo):** Combina 1 take de foto ($3.000\text{ms}$) e 1 take de vídeo (restante) do mesmo cômodo.
4. **Estratégia 4 (Foto Única Estendida):** Se existir estritamente 1 única foto do cômodo e nenhum vídeo, permite exibição com Ken Burns estendido até $7.000\text{ms}$ com rationale explícito `extended_single_photo_ken_burns`.

### 4.3 Hierarquia Canônica de Fallback Auditável
Toda decisão visual registra formalmente o uso e tipo de fallback:
```
NÍVEL 1: MATCH SEMÂNTICO (Relevância >= 0.40)
├── fallback_used: false, fallback_type: null
│
└── (Se nenhum candidato viável com relevância >= 0.40)
    │
    ▼
NÍVEL 2: ASSET GENÉRICO DE ALTA QUALIDADE ESTÉTICA DO IMÓVEL (generic_property_media)
├── fallback_used: true, fallback_type: 'generic_property_media'
├── Seleciona a foto ou vídeo com maior pontuação geral: (aesthetic * 0.60 + tech * 0.40)
└── Duração: min(beat.duration_ms, 4000ms) com Ken Burns se for foto
    │
    ▼ (Se imóvel não possuir fotos nem vídeo válidos)
NÍVEL 3: APRESENTADOR EM TELA CHEIA (presenter_fullscreen)
├── fallback_used: true, fallback_type: 'presenter_fullscreen'
└── selected_asset_id: null, apresentador mantido em tela cheia com lip-sync
```

---

## 5. Isolamento Estrito de Propriedade (Cross-Property Safety)

> [!CAUTION]
> **INVARIANTE DE ISOLAMENTO DE PROPRIEDADE:**
> O Creative Director operando no imóvel `propertyRef` **NUNCA** pode selecionar ou emitir um `asset_id` que não pertença a esse mesmo `propertyRef`, mesmo que múltiplos imóveis compartilhem o mesmo blob físico canônico (`physical_file_hash`).

1. O `CreativeDirectorService` consome exclusivamente o catálogo retornado por `getPropertyMediaPool(propertyRef)`.
2. Todo `UnifiedMediaCandidate` possui `property_ref` validado.
3. A compilação para Blueprint 1.2 repassa exclusivamente os `asset_id` de propriedade (`ast_pimg_<propertyRef>_...` e `ast_pvid_<propertyRef>_...`), assegurando que a validação de ownership do Composer V3 passe sem exceções.

---

## 6. Determinismo e Identidades Canônicas

### 6.1 Identidade Canônica do Media Pool (`property_semantic_media_pool_key`)

$$\text{property\_semantic\_media\_pool\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{ \text{video\_assets}, \text{photo\_assets} \}\big)\Big)$$

Onde:
- `video_assets`: array ordenado por `asset_id` ASC contendo:
  `{ asset_id, physical_file_hash, analysis_key, segments: [{ segment_index, start_ms, end_ms, room_type, features: sortedFeatures, scores }] }`
- `photo_assets`: array ordenado por `asset_id` ASC contendo:
  `{ asset_id, physical_file_hash, photo_analysis_key, primary_room_type, secondary_room_types: sortedRooms, features: sortedFeatures, scores }`

### 6.2 Identidade Canônica do Creative Direction Plan (`creative_direction_key`)

$$\text{creative\_direction\_key} = \text{SHA-256}\Big(\text{canonicalJSON}\big(\{$$
$$\text{script\_timing\_key}, \text{beat\_analysis\_key}, \text{property\_semantic\_media\_pool\_key},$$
$$\text{intent\_extractor\_version}: \text{"1.0.0"}, \text{media\_ranker\_version}: \text{"1.1.0"},$$
$$\text{continuity\_engine\_version}: \text{"1.1.0"}, \text{fallback\_policy\_version}: \text{"1.1.0"},$$
$$\text{director\_version}: \text{"1.1.0"}, \text{scoring\_weights}, \text{semantic\_thresholds},$$
$$\text{min\_visual\_duration\_ms}, \text{max\_photo\_visual\_duration\_ms}, \text{schema\_version}: \text{"1.1.0"}$$
$$\}\big)\Big)$$

---

## 7. Compilação para Creative Blueprint 1.2 & Composer V3

O compilador `compileToBlueprint12` mapeia as decisões do plano editorial diretamente para os tracks do Blueprint 1.2:

```
VisualDecision (Foto)  ──► visual_timeline: { asset_id, asset_type: 'image', start_ms, end_ms, fit: 'cover' }
                           pip.windows: { start_ms, end_ms, position: 'bottom_right' } (Avatar PIP com lip-sync)

VisualDecision (Vídeo) ──► visual_timeline: { asset_id, asset_type: 'video', start_ms, end_ms, source_in_ms, source_out_ms, fit: 'cover' }
                           pip.windows: { start_ms, end_ms, position: 'bottom_right' } (Avatar PIP com lip-sync)

VisualDecision (FP)    ──► visual_timeline: { asset_id: presenterAssetId, asset_type: 'video', start_ms, end_ms, source_in_ms, source_out_ms }
                           (Sem janela PIP separada; apresentador ocupa tela cheia)
```

---

## 8. Matriz Completa de Testes da Fase 4C (40 Cenários Formais)

A suíte formal de testes da Fase 4C cobrirá integralmente todos os cenários identificados na auditoria adversarial:

| ID | Categoria | Descrição do Cenário de Teste |
| :--- | :--- | :--- |
| **Cenário A** | Unificação de Candidatos | Projeção determinística de vídeos e fotos em `UnifiedMediaCandidate` com campos normalizados. |
| **Cenário B** | Determinismo da Pool Key | Mesmos assets com ordens de entrada aleatórias produzem o mesmo `property_semantic_media_pool_key`. |
| **Cenário C** | Invalidação da Pool Key | Alteração de hash, metadata ou semântica de 1 foto altera o `property_semantic_media_pool_key`. |
| **Cenário D** | Match Semântico de Foto | Beat de cozinha seleciona foto da cozinha com relevância $\ge 0.80$. |
| **Cenário E** | Match Semântico de Vídeo | Beat de sala seleciona segmento de vídeo da sala com relevância $\ge 0.80$. |
| **Cenário F** | Competição: Foto Vence | Vídeo instável/escuro (tech 0.40) vs foto profissional (tech 0.95, util 0.95); Foto vence. |
| **Cenário G** | Competição: Vídeo Vence | Foto com baixa utilidade (util 0.30) vs vídeo fluido (tech 0.85, aest 0.85); Vídeo vence. |
| **Cenário H** | Bônus de Features Concorrentes | Foto com `barbecue_grill` pontua $+0.10$ acima de foto da varanda sem a feature. |
| **Cenário I** | Descarte Estrito de Cômodo | Beat de "banheiro" descarta mídias de "garagem" com relevância $0.00$. |
| **Cenário J** | Ambientes Secundários | Foto de sala com varanda em `secondary_room_types` pontua $0.65$ para pedido de varanda. |
| **Cenário K** | Ambientes Compatíveis | Foto de sala de jantar pontua $0.50$ para pedido de sala de estar (par compatível). |
| **Cenário L** | Feature-Only Beat (Com Match) | Beat "com armários planejados" dá $0.70$ para fotos com `planned_cabinets`. |
| **Cenário M** | Feature-Only Beat (Sem Match) | Beat "com armários planejados" descarta mídias sem a feature com relevância $0.00$. |
| **Cenário N** | Beat Abstrato / Conceitual | Beat "perfeito para receber amigos" atribui base $0.30$ e desempata por qualidade estética. |
| **Cenário O** | Limite Mínimo de Foto | Nenhuma foto é agendada com duração $< 1.500\text{ms}$. |
| **Cenário P** | Limite Máximo de Foto | Beat longo ($8.000\text{ms}$) gera sequência de 2 fotos complementares ($\le 6.000\text{ms}$ cada). |
| **Cenário Q** | Take Extension de Vídeo | Dois beats contíguos de sala estendem o mesmo segmento de vídeo sem corte. |
| **Cenário R** | Não-Extensão de Foto | Dois beats contíguos de quarto com fotos alternam para um segundo ângulo fotográfico. |
| **Cenário S** | Penalidade de Repetição Imediata | Reutilização da mesma foto no beat seguinte sofre penalidade de $-0.25$. |
| **Cenário T** | Penalidade de Recorrência Recente | Foto reutilizada há menos de 3 beats sofre penalidade de $-0.10$. |
| **Cenário U** | Sequência Fotográfica Complementar | Foto A $\to$ Foto B do mesmo cômodo com ângulos distintos recebe bônus de $+0.05$. |
| **Cenário V** | Política Anti-Ping-Pong | Penaliza alternância rápida Foto/Vídeo/Foto em beats curtos do mesmo cômodo. |
| **Cenário W** | Fallback Genérico para Foto | Beat sem match seleciona a foto com maior estética geral (`generic_property_media`). |
| **Cenário X** | Fallback Genérico para Vídeo | Imóvel sem fotos seleciona segmento de vídeo de alta estética como fallback genérico. |
| **Cenário Y** | Fallback Presenter Fullscreen | Imóvel sem fotos e sem vídeo aciona fallback limpo para `presenter_fullscreen`. |
| **Cenário Z** | Isolamento Cross-Property | Foto com mesmo blob físico em REF 1628 e REF 1601 é emitida estritamente com `ast_pimg_1628_...`. |
| **Cenário AA** | Desempate Determinístico Total | 2 fotos com mesmos scores resolvem empate pelo 7-level tie-breaker sem ambiguidade. |
| **Cenário AB** | Validação de Schema: Foto | Decisão de foto com `source_in_ms: null` é validada com sucesso. |
| **Cenário AC** | Rejeição de Schema: Foto com Trim | Decisão de foto com `source_in_ms` preenchido é rejeitada com `SCHEMA_ERROR`. |
| **Cenário AD** | Validação de Schema: Vídeo | Decisão de vídeo com duração de timeline divergente do trim é rejeitada com `SCHEMA_ERROR`. |
| **Cenário AE** | Compilação Blueprint: Foto | `compileToBlueprint12` gera `asset_type: 'image'` e sem `source_in/out` para fotos. |
| **Cenário AF** | Compilação Blueprint: Vídeo | `compileToBlueprint12` gera `asset_type: 'video'` e trim 1:1 para vídeos. |
| **Cenário AG** | Compilação Blueprint: PIP | Todas as cenas com B-roll contêm janela PIP correspondente. |
| **Cenário AH** | Validação Contrato Composer V3 | Blueprint 1.2 multimodal passa na validação `validateBlueprintContract` sem erros. |
| **Cenário AI** | Imutabilidade e Cache Hit do Plano | Execução repetida com os mesmos inputs carrega o plano do cache sem recalcular. |
| **Cenário AJ** | Invalidação por Pesos | Mudança em `scoring_weights` gera nova `creative_direction_key`. |
| **Cenário AK** | Invalidação por Thresholds | Mudança em `min_semantic_relevance` gera nova `creative_direction_key`. |
| **Cenário AL** | Integridade do Cache Canônico | Cache de direção criativa com hash divergente dispara erro e não corrompe o arquivo. |
| **Cenário AM** | Rastreamento de Footing de Vídeo | Múltiplos beats consumindo trechos do mesmo vídeo não ultrapassam `segment.end_ms`. |
| **Cenário AN** | Showcase REF 1628 Multimodal | Execução completa com vídeo 4A.1 + 11 fotos 4B.2 demonstrando ganho editorial e semântico. |

---

## 9. Plano Experimental do Showcase REF 1628

- **Baseline A (4A.3 Video-Only):** Roteiro canônico de 5 beats executado apenas com os 8 segmentos de vídeo do imóvel 1628.
- **Candidate B (4C Multimodal):** Mesmo roteiro, mesmo áudio e mesmo apresentador executado com o catálogo multimodal (Vídeo + 11 Fotos analisadas na 4B.2).
- **Métricas Objetivas de Comparação:**
  1. *Acurácia Semântica:* $\ge 90\%$ de aderência textual-visual por beat.
  2. *Alinhamento de Features:* Identificação de detalhes específicos (ex: sacada, armários) cobertos por fotos de alta resolução.
  3. *Diversidade e Ritmo:* Presença equilibrada de movimento (vídeo) e nitidez estática (fotos com Ken Burns).
  4. *Taxa de Fallback:* Redução ou eliminação de fallbacks desnecessários.
  5. *Validação Física:* Blueprint 1.2 validado com $100\%$ de conformidade pelo Composer V3.

---

## 10. Resumo dos Achados Adversariais e Resoluções

| Classificação | Item Auditado | Risco Identificado | Resolução Arquitetural Implementada no Plano |
| :--- | :--- | :--- | :--- |
| **BLOCKER** | Feature-Only Matching | Beat sem cômodo atribuía baseScore 0.60 para mídias sem a feature. | Definido `BaseScore = 0.00` para candidatos com 0 matching features em beats feature-only. |
| **BLOCKER** | Cross-Property Isolation | Risco de vazamento de `asset_id` de outra REF compartilhando blob global. | Hard invariant de ownership: candidatos projetados estritamente via `getPropertyMediaPool(propertyRef)`. |
| **BLOCKER** | Photo Duration Bounds | Beats longos poderiam estagnar em foto única estática $> 6\text{s}$. | Decomposição formal em 2 fotos complementares ou foto + vídeo para beats $> 5\text{s}$. |
| **HIGH** | Anti-Ping-Pong vs Sequência | Regra simplista poderia penalizar troca benéfica de fotos do mesmo cômodo. | Penalidade restrita a trocas rápidas de modalidade; bônus de $+0.05$ para fotos complementares do mesmo cômodo. |
| **HIGH** | Tie-Breaking Determinístico | Empate de scores poderia gerar oscilação entre execuções assíncronas. | 7-level tie-breaker estrito culminando em desempate lexicográfico por `asset_id` + `candidate_id`. |
| **HIGH** | Pool Key Canonical Sorting | Arrays não ordenados poderiam gerar pool keys divergentes no cache. | Ordenação estrita por `asset_id` ASC e ordenação alfabética de tags e cômodos secundários. |
| **MEDIUM** | Secondary Rooms Scoring | Ambiguidade de pontuação entre cômodo secundário e cômodo compatível. | Definida hierarquia estrita: Match Primário ($0.80$) > Match Secundário ($0.65$) > Par Compatível ($0.50$). |

---

**FIM DO PLANO HARDENED — FASE 4C.**
