# DIAGNÓSTICO E PLANO DE ARQUITETURA — PHOTO MEDIA UNDERSTANDING (FASE 4B.2)

**Status:** PLANEJAMENTO E HARDENING TÉCNICO (DOCS-ONLY)  
**Fase Anterior Homologada:** FASE 4B.1 — PHOTO INGESTION & MATERIALIZATION PROOF (`b23bfed95222ef8cd66e16f5de2ba06823b72ae7`)  
**Data:** 06/09/2026  
**Autores:** Video Engine Team & External Review Hardening  

---

## 1. Auditoria Detalhada do Estado Atual (Pós-Fase 4B.1)

### 1.1 Representação Física e Catálogo de Fotos (`property_photo`)
Na Fase 4B.1 homologada, o módulo [`video_engine/property_media/photo_ingestion/`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/property_media/photo_ingestion/) estabeleceu a fundação física das fotografias do CRM ImobTotal. Cada foto aceita é persistida no banco `video_assets` com:
- **`id` (`asset_id`):** Property-scoped: `ast_pimg_<32-chars-hex>`, calculado via:
  $$\text{asset\_id} = \text{"ast\_pimg\_"} + \text{SHA-256}(\text{property\_ref} + \text{":"} + \text{physical\_file\_hash})[0..32]$$
- **`property_ref`:** Código textual do imóvel (ex: `'1628'`).
- **`asset_type`:** `'property_photo'`.
- **`storage_type`:** `'local_file'`.
- **`storage_path`:** Caminho canônico global no content-addressed blob store: `outputs/media_blobs/photos/<physical_file_hash>.<normalized_ext>`.
- **`file_hash`:** `physical_file_hash` (SHA-256 streaming dos bytes reais no disco).
- **`status`:** `'ready'`.
- **`specs`:** `{ width, height, format, codec, aspect_ratio, short_edge, file_size_bytes, normalized_ext }`.
- **`metadata`:** `{ property_ref, crm_photo_id, categoria, posicao, destaque, crm_sources: [...], ingestion_token, thresholds_used }`.

### 1.2 Exposição no Property Media Pool
A função `getPropertyMediaPool(propertyRef)` em [`video_engine/property_media/property_media_service.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/property_media/property_media_service.js) já expõe nativamente os `property_photo` com status `'ready'`, validando rigorosamente a existência física, contenção de path e correspondência de `file_hash` ($O(N)$ streaming SHA-256). **Nenhum campo semântico fake (como room_type ou features forjadas)** é retornado na Fase 4B.1.

### 1.3 Comparativo: Media Understanding de Vídeo (4A.1) vs Foto (4B.2)

| Componente / Aspecto | Media Understanding 4A.1 (Vídeo) | Photo Media Understanding 4B.2 (Fotos) | Decisão de Reuso na 4B.2 |
| :--- | :--- | :--- | :--- |
| **Natureza do Input** | Stream contínuo / arquivo MP4 temporal. | Arquivo de imagem estática único (`.jpg`, `.png`, `.webp`). | **Específico:** Foto não possui dimensão temporal. |
| **Amostragem Temporal** | `extractFramesUniformly` (1 frame a cada 1.200ms). | **Nenhum:** A foto inteira é o frame de análise. | **Descartar:** Sem sampling temporal para fotos. |
| **Suavização Anti-Flicker** | `smoothTemporalTransitions` (janela móvel). | **Nenhum:** Não há transições entre frames contíguos. | **Descartar:** Anti-flicker é irrelevante para fotos isoladas. |
| **Segmentação Temporal** | `segmentContinuousTour` (`start_ms`, `end_ms`). | **Nenhum:** Foto é pontual (atemporal). | **Descartar:** Fotos não possuem `start_ms`/`end_ms`. |
| **Taxonomia de Ambientes** | 16 `ALLOWED_ROOM_TYPES` canônicos. | 16 `ALLOWED_ROOM_TYPES` canônicos. | **Reutilizar 100%:** Mesma taxonomia de room_types. |
| **Taxonomia de Features** | 16 `ALLOWED_FEATURES` canônicas. | 16 `ALLOWED_FEATURES` canônicas. | **Reutilizar 100%:** Mesma taxonomia de features. |
| **Provedor VLM / Interface** | `BaseMediaUnderstandingProvider` (`analyzeFrame`). | `BasePhotoUnderstandingProvider` (`analyzePhoto`). | **Reutilizar Conceito:** Contrato abstrato agnóstico. |
| **Fingerprint de Cache** | `analysis_key` baseado em hash do vídeo + sample_interval. | `photo_analysis_key` baseado em `physical_file_hash` + prompt + schema. | **Adaptar:** Fingerprint global content-addressed. |
| **Avaliação de Qualidade** | `technical_quality_score` e `aesthetic_score` simples. | **Decomposição Completa:** Technical, Aesthetic e Editorial Utility. | **Evoluir:** Decomposição profunda auditável. |

### 1.4 Taxonomia Canônica Compartilhada (Homologada desde a 4A.1)
O arquivo [`video_engine/media_understanding/analysis_schema.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/media_understanding/analysis_schema.js) já homologou as seguintes constantes imutáveis:

#### Ambientes Permitidos (`ALLOWED_ROOM_TYPES` — 16 categorias):
1. `living_room` (Sala de estar / TV)
2. `dining_room` (Sala de jantar)
3. `kitchen` (Cozinha)
4. `balcony` (Varanda / Sacada / Terraço)
5. `bedroom` (Dormitório / Quarto)
6. `suite` (Suíte principal ou secundária)
7. `bathroom` (Banheiro social ou lavabo)
8. `facade` (Fachada do edifício ou casa)
9. `hallway` (Corredor / Hall de entrada)
10. `laundry` (Área de serviço / Lavanderia)
11. `garage` (Garagem / Vaga)
12. `leisure` (Área de lazer / Playground / Salão de festas)
13. `city_view` (Vista da cidade / Vista panorâmica externa)
14. `exterior` (Área externa / Quintal / Jardim)
15. `other` (Outro ambiente identificado não listado)
16. `unknown` (Ambiente não identificável com certeza)

#### Características Permitidas (`ALLOWED_FEATURES` — 16 tags):
1. `city_view` (Vista panorâmica / livre da cidade)
2. `gourmet` (Espaço ou varanda gourmet)
3. `glass_enclosure` (Envidraçamento / Cortina de vidro)
4. `planned_cabinets` (Armários planejados / Embutidos)
5. `porcelain_tile` (Piso em porcelanato)
6. `high_ceiling` (Pé direito duplo ou elevado)
7. `pool` (Piscina privativa ou do condomínio)
8. `barbecue_grill` (Churrasqueira)
9. `air_conditioning` (Ar condicionado instalado)
10. `open_concept` (Conceito aberto / Cozinha integrada)
11. `natural_lighting` (Iluminação natural abundante)
12. `modern_fixtures` (Metais / Iluminação / Acabamentos modernos)
13. `wooden_floor` (Piso de madeira / Laminado / Vinílico)
14. `spacious` (Sensação perceptível de amplitude)
15. `bright` (Ambiente claro / Iluminado)
16. `furnished` (Mobiliado / Decorado)

---

## 2. Arquitetura da Fase 4B.2 — Separação Estrita entre Cache Global e Projeção de Propriedade

Para garantir pureza arquitetural, isolamento de cache e auditabilidade completa, o sistema desacopla rigidamente a **análise semântica pura do conteúdo físico** (global, imutável, agnóstica de propriedade) da **projeção contextual de propriedade** (reconciliação de CRM e metadados de catálogo).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CRM Photo Ingested (4B.1)                                                   │
│ outputs/media_blobs/photos/<physical_file_hash>.<ext>                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. CANONICAL PHOTO ANALYSIS FINGERPRINT (Global, Content-Addressed)         │
│ photo_analysis_key = SHA-256(canonicalJSON({                                │
│   physical_file_hash, analyzer_type, analyzer_version,                      │
│   model_id, prompt_version, schema_version, quality_rules_version,           │
│   taxonomy_version                                                          │
│ }))                                                                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         ▼                           ▼
                  [Cache Hit?]                 [Cache Miss]
                         │                           │
              (Leitura Atômica de                    │
               outputs/media_analysis/               ▼
               photos/<key>/analysis.json) ┌──────────────────────────────────┐
                         │                 │ 2. VLM UNDERSTANDING PROVIDER    │
                         │                 │ (OpenAI / Mock Provider)         │
                         │                 │ Recebe bytes reais da imagem     │
                         │                 │ Executa prompt estruturado       │
                         │                 └─────────────────┬────────────────┘
                         │                                   │
                         │                                   ▼
                         │                 ┌──────────────────────────────────┐
                         │                 │ 3. STRICT SCHEMA & SCORE CHECK   │
                         │                 │ Fail-Fast em bounds [0.0, 1.0]   │
                         │                 │ ZERO Clamping silencioso         │
                         │                 │ Validação de Taxonomia [16+16]   │
                         │                 └─────────────────┬────────────────┘
                         │                                   │
                         │                                   ▼
                         │                 ┌──────────────────────────────────┐
                         │                 │ 4. ATOMIC NO-CLOBBER CACHE WRITE │
                         │                 │ outputs/media_analysis/photos/   │
                         │                 │ <photo_analysis_key>/            │
                         │                 │ analysis.json                    │
                         │                 │ (ESTRITAMENTE GlobalPhotoAnalysis│
                         │                 │  ZERO property_ref / asset_id /  │
                         │                 │  crm_category no cache global)   │
                         │                 └─────────────────┬────────────────┘
                         │                                   │
                         └─────────────────┬─────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. PROPERTY RUNTIME PROJECTION LAYER (PropertyPhotoSemanticView)            │
│ Combina GlobalPhotoAnalysis com o contexto específico da propriedade:       │
│ - asset_id, property_ref, physical_file_hash                                │
│ - crm_context: { crm_photo_id, raw_crm_category, normalized_crm_room_hint } │
│ - semantic_reconciliation: { comparable, divergence_detected, reason }      │
│ - Global Analysis (semantic, quality, analyzer_provenance)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Schemas Canônicos e Contratos de Dados

### 3.1 Schema Global Imutável: `GlobalPhotoAnalysis` (Gravado no Cache Global)
O arquivo de cache global `outputs/media_analysis/photos/<photo_analysis_key>/analysis.json` contém **exclusivamente** informações intrínsecas dos pixels e metadados do analisador. **É terminantemente proibido gravar `property_ref`, `asset_id`, `crm_category` ou `divergence_detected` neste arquivo.**

```json
{
  "photo_analysis_key": "64_chars_hex_sha256",
  "physical_file_hash": "64_chars_hex_sha256",
  "semantic": {
    "primary_room_type": "living_room",
    "secondary_room_types": ["dining_room"],
    "features": ["open_concept", "porcelain_tile", "natural_lighting"],
    "description": "Sala de estar ampla integrada com a sala de jantar, piso em porcelanato claro e boa iluminação natural.",
    "confidence": 0.95
  },
  "quality": {
    "technical_quality": {
      "sharpness": 0.90,
      "exposure": 0.85,
      "noise_compression": 0.95,
      "resolution_adequacy": 1.00,
      "perspective_alignment": 0.80,
      "score": 0.89
    },
    "aesthetic_score": {
      "composition": 0.85,
      "framing": 0.80,
      "visual_balance": 0.85,
      "lighting_atmosphere": 0.90,
      "cleanliness_staging": 0.95,
      "score": 0.87
    },
    "editorial_utility": {
      "room_coverage": 0.90,
      "feature_clarity": 0.85,
      "spaciousness_perception": 0.90,
      "obstruction_level": 1.00,
      "score": 0.91,
      "utility_label": "high_value_anchor"
    },
    "composite_quality_score": 0.89
  },
  "analyzer_provenance": {
    "analyzer_type": "photo_vlm_understanding",
    "analyzer_version": "1.0.0",
    "model_id": "gpt-4o-mini",
    "prompt_version": "photo_vlm_v1",
    "schema_version": "1.0.0",
    "quality_rules_version": "1.0.0",
    "taxonomy_version": "1.0.0",
    "analyzed_at": "2026-09-06T10:00:00.000Z"
  }
}
```

### 3.2 Schema de Projeção Contextual: `PropertyPhotoSemanticView` (Runtime / Catálogo)
Quando o sistema consulta as fotos de um imóvel (`REF 1628`), a camada de serviço combina o `GlobalPhotoAnalysis` com o registro `property_photo` do banco `video_assets`:

```json
{
  "asset_id": "ast_pimg_8f2a1b...",
  "property_ref": "1628",
  "physical_file_hash": "64_chars_hex_sha256",
  "photo_analysis_key": "64_chars_hex_sha256",
  "crm_context": {
    "crm_photo_id": "1446700",
    "raw_crm_category": "Unidade",
    "normalized_crm_room_hint": null,
    "comparable": false
  },
  "semantic_reconciliation": {
    "divergence_detected": false,
    "divergence_reason": "crm_category_not_comparable",
    "crm_category_mapper_version": "1.0.0"
  },
  "semantic": {
    "primary_room_type": "living_room",
    "secondary_room_types": ["dining_room"],
    "features": ["open_concept", "porcelain_tile", "natural_lighting"],
    "description": "Sala de estar ampla integrada...",
    "confidence": 0.95
  },
  "quality": {
    "technical_quality": { "score": 0.89, "sharpness": 0.90, "exposure": 0.85, "noise_compression": 0.95, "resolution_adequacy": 1.00, "perspective_alignment": 0.80 },
    "aesthetic_score": { "score": 0.87, "composition": 0.85, "framing": 0.80, "visual_balance": 0.85, "lighting_atmosphere": 0.90, "cleanliness_staging": 0.95 },
    "editorial_utility": { "score": 0.91, "room_coverage": 0.90, "feature_clarity": 0.85, "spaciousness_perception": 0.90, "obstruction_level": 1.00, "utility_label": "high_value_anchor" },
    "composite_quality_score": 0.89
  },
  "analyzer_provenance": {
    "analyzer_type": "photo_vlm_understanding",
    "analyzer_version": "1.0.0",
    "model_id": "gpt-4o-mini",
    "prompt_version": "photo_vlm_v1",
    "schema_version": "1.0.0",
    "quality_rules_version": "1.0.0",
    "taxonomy_version": "1.0.0",
    "analyzed_at": "2026-09-06T10:00:00.000Z"
  }
}
```

---

## 4. Matriz de Autoridade, Origem e Validação Estrita dos Quality Scores

### 4.1 Matriz de Origem e Autoridade
Para garantir transparência e eliminar ambiguidades na proveniência das métricas:

| Campo / Métrica | Origem / Autoridade (`source`) | Método de Cálculo / Obtenção | Regra de Validação Estrita |
| :--- | :--- | :--- | :--- |
| `specs.width`, `height`, `aspect_ratio` | `deterministic_specs` | FFprobe / Full Decode físico (4B.1). | Inteiros positivos $>0$. |
| `resolution_adequacy` | `deterministic_specs` | Determinado via $\min(1.0, \text{short\_edge} / 900.0)$. | Float estrito em $[0.0, 1.0]$. |
| `sharpness` | `vlm` | Inferência VLM sobre nitidez óptica dos contornos. | Float estrito em $[0.0, 1.0]$. |
| `exposure` | `vlm` | Inferência VLM sobre equilíbrio tonal e alcance dinâmico. | Float estrito em $[0.0, 1.0]$. |
| `noise_compression` | `vlm` | Inferência VLM sobre ausência de ruído ISO e artefatos. | Float estrito em $[0.0, 1.0]$. |
| `perspective_alignment` | `vlm` | Inferência VLM sobre verticalidade e distorção de lente. | Float estrito em $[0.0, 1.0]$. |
| `composition` | `vlm` | Inferência VLM sobre regra dos terços e linhas-guia. | Float estrito em $[0.0, 1.0]$. |
| `framing` | `vlm` | Inferência VLM sobre cortes estruturais harmoniosos. | Float estrito em $[0.0, 1.0]$. |
| `visual_balance` | `vlm` | Inferência VLM sobre distribuição de massas visuais. | Float estrito em $[0.0, 1.0]$. |
| `lighting_atmosphere` | `vlm` | Inferência VLM sobre clima de iluminação e acolhimento. | Float estrito em $[0.0, 1.0]$. |
| `cleanliness_staging` | `vlm` | Inferência VLM sobre arrumação e ausência de desordem. | Float estrito em $[0.0, 1.0]$. |
| `room_coverage` | `vlm` | Inferência VLM sobre amplitude e cobertura do cômodo. | Float estrito em $[0.0, 1.0]$. |
| `feature_clarity` | `vlm` | Inferência VLM sobre nitidez e destaque dos diferenciais. | Float estrito em $[0.0, 1.0]$. |
| `spaciousness_perception` | `vlm` | Inferência VLM sobre sensação espacial transmitida. | Float estrito em $[0.0, 1.0]$. |
| `obstruction_level` | `vlm` | Inferência VLM ($1.0$ = desobstruído; $0.0$ = bloqueado). | Float estrito em $[0.0, 1.0]$. |
| `technical_quality.score` | `deterministic_formula` | Média ponderada dos subcomponentes técnicos. | Float estrito em $[0.0, 1.0]$, precisão 2 decimais. |
| `aesthetic_score.score` | `deterministic_formula` | Média ponderada dos subcomponentes estéticos. | Float estrito em $[0.0, 1.0]$, precisão 2 decimais. |
| `editorial_utility.score` | `deterministic_formula` | Média ponderada dos subcomponentes de utilidade. | Float estrito em $[0.0, 1.0]$, precisão 2 decimais. |
| `composite_quality_score` | `deterministic_formula` | $0.45 \cdot \text{utility} + 0.30 \cdot \text{aesthetic} + 0.25 \cdot \text{technical}$. | Float estrito em $[0.0, 1.0]$, precisão 2 decimais. |
| `utility_label` | `deterministic_formula` | Mapeamento por faixas de corte fixas. | Enum: `high_value_anchor`, `supporting_detail`, etc. |

### 4.2 Política de Validação Fail-Fast (ZERO Clamping Silencioso)
É **expressamente proibido** realizar clamping defensivo silencioso de valores inválidos (ex: transformar `1.4 -> 1.0`, `-0.2 -> 0.0` ou ignorar `NaN`). Qualquer valor fora dos limites estritos $[0.0, 1.0]$, `NaN`, `Infinity` ou tipo não numérico dispara imediatamente o erro:

$$\text{SCORE\_OUT\_OF\_BOUNDS\_ERROR: Score '\{field\}' with value '\{value\}' is outside strict bounds [0.0, 1.0]}$$

A integridade semântica depende da resposta correta do modelo e do validador. Se o modelo falhar, o job falha com log auditável em vez de mascarar dados corrompidos.

### 4.3 Fórmulas de Ponderação Determinística
1. **Technical Quality:**
   $$\text{technical\_quality.score} = 0.30 \cdot \text{sharpness} + 0.25 \cdot \text{exposure} + 0.20 \cdot \text{noise\_compression} + 0.15 \cdot \text{resolution\_adequacy} + 0.10 \cdot \text{perspective\_alignment}$$
2. **Aesthetic Quality:**
   $$\text{aesthetic\_score.score} = 0.25 \cdot \text{composition} + 0.20 \cdot \text{framing} + 0.20 \cdot \text{visual\_balance} + 0.20 \cdot \text{lighting\_atmosphere} + 0.15 \cdot \text{cleanliness\_staging}$$
3. **Editorial Utility:**
   $$\text{editorial\_utility.score} = 0.35 \cdot \text{room\_coverage} + 0.30 \cdot \text{feature\_clarity} + 0.20 \cdot \text{spaciousness\_perception} + 0.15 \cdot \text{obstruction\_level}$$
4. **Utility Labels:**
   - `high_value_anchor`: $\text{editorial\_utility.score} \ge 0.80$
   - `supporting_detail`: $0.60 \le \text{editorial\_utility.score} < 0.80$
   - `marginal_usable`: $0.40 \le \text{editorial\_utility.score} < 0.60$
   - `editorial_reject`: $\text{editorial\_utility.score} < 0.40$

---

## 5. Separação Arquitetural: Qualidade Absoluta (4B.2) vs Relevância Semântica (4C)

Uma regra de ouro da arquitetura:
- **A Fase 4B.2 calcula estritamente as propriedades intrínsecas da fotografia:**
  “O que tem na foto?”, “Quais features existem?”, “Quão nítida ela é?”, “Qual o nível de cobertura do ambiente?”.
- **A Fase 4C (Creative Director Multimodal) calculará o matching contextual com o roteiro:**
  “O locutor disse 'veja os armários planejados da cozinha', qual foto tem o maior match?”.
- **Invariante:** Em nenhuma hipótese a nota estética ou técnica da 4B.2 substitui a relevância semântica calculada no Creative Director.

---

## 6. Normalização de Categorias CRM e Reconciliação Semântica

### 6.1 Mapeamento e Classificação de Categorias do CRM (`crm_category_mapper_version = "1.0.0"`)
O CRM ImobTotal envia categorias textuais livres. O normalizador classifica as categorias em dois grupos:

1. **Categorias Vagas / Genéricas (Não comparáveis):**
   - Exemplos: `"Unidade"`, `"Geral"`, `"Outros"`, `"Fotos"`, `"Diversas"`, `""`, `null`.
   - Normalização: `normalized_crm_room_hint = null`.
   - Comparabilidade: `comparable = false`.
   - Divergência: `divergence_detected = false`, `divergence_reason = "crm_category_not_comparable"`.
   - *Resultado:* **Zero falso positivo de divergência** quando o corretor usou `"Unidade"` para todas as fotos.

2. **Categorias Específicas de Ambiente (Comparáveis):**
   - Exemplos e mapeamentos canônicos:
     - `"Quarto"`, `"Dormitório"`, `"Dormitorio"` $\rightarrow$ `"bedroom"`
     - `"Suíte"`, `"Suite"` $\rightarrow$ `"suite"`
     - `"Sala"`, `"Living"` $\rightarrow$ `"living_room"`
     - `"Cozinha"` $\rightarrow$ `"kitchen"`
     - `"Banheiro"`, `"Lavabo"` $\rightarrow$ `"bathroom"`
     - `"Sacada"`, `"Varanda"` $\rightarrow$ `"balcony"`
     - `"Fachada"` $\rightarrow$ `"facade"`
     - `"Garagem"`, `"Vaga"` $\rightarrow$ `"garage"`
     - `"Lazer"`, `"Piscina"`, `"Churrasqueira"` $\rightarrow$ `"leisure"`
     - `"Área de Serviço"`, `"Lavanderia"` $\rightarrow$ `"laundry"`
   - Normalização: `normalized_crm_room_hint = "<canonical_room_type>"`.
   - Comparabilidade: `comparable = true`.
   - Avaliação de Divergência:
     - Se `normalized_crm_room_hint === primary_room_type` $\rightarrow$ `divergence_detected = false`, `divergence_reason = null`.
     - Se `normalized_crm_room_hint !== primary_room_type` e `!secondary_room_types.includes(normalized_crm_room_hint)`:
       $\rightarrow$ `divergence_detected = true`, `divergence_reason = "crm_hint_mismatch"`.

### 6.2 Tratamento de Ambientes Híbridos / Contíguos
1. **Sala Integrada (Estar + Jantar):**
   - `primary_room_type = 'living_room'` (ou `'dining_room'` se a mesa ocupar $>60\%$ do enquadramento).
   - `secondary_room_types = ['dining_room']`.
   - `features = ['open_concept', ...]`
2. **Cozinha Americana Integrada à Sala:**
   - Se o foco principal for a bancada/eletros: `primary_room_type = 'kitchen'`, `secondary_room_types = ['living_room']`, `features = ['open_concept', 'planned_cabinets']`.
   - Se o foco for a sala com a cozinha ao fundo: `primary_room_type = 'living_room'`, `secondary_room_types = ['kitchen']`.
3. **Varanda / Sacada com Vista:**
   - `primary_room_type = 'balcony'`, `secondary_room_types = ['city_view']`, `features = ['city_view', 'glass_enclosure']`.
4. **Suíte (Dormitório + Banheiro visível):**
   - `primary_room_type = 'suite'`, `secondary_room_types = ['bathroom']`.
5. **Foto de Detalhe (ex: puxador de armário ou cuba):**
   - `primary_room_type = '<cômodo_onde_está>'` (ex: `'kitchen'`), `features = ['planned_cabinets']`, com `editorial_utility.room_coverage` baixo ($<0.40$).
6. **Fachada + Área Externa:**
   - `primary_room_type = 'facade'`, `secondary_room_types = ['exterior', 'garage']`.
7. **Planta Baixa ou Banner Publicitário:**
   - `primary_room_type = 'other'`, `editorial_utility.utility_label = 'editorial_reject'`.
8. **Ambiente Não Identificável com Confiança:**
   - `primary_room_type = 'unknown'`, `confidence < 0.50`.

---

## 7. Fingerprint e Cache Global Imutável

### 7.1 Cálculo do `photo_analysis_key`
O fingerprint semântico é **estritamente global, content-addressed e determinístico**:

$$\text{photo\_analysis\_key} = \text{SHA-256}\left(\text{canonicalJSON}\left(\begin{array}{l}
\text{physical\_file\_hash}, \\
\text{analyzer\_type}, \\
\text{analyzer\_version}, \\
\text{model\_id}, \\
\text{prompt\_version}, \\
\text{schema\_version}, \\
\text{quality\_rules\_version}, \\
\text{taxonomy\_version}
\end{array}\right)\right)$$

> [!NOTE]
> Metadados operacionais voláteis (como `analyzed_at` ou timestamp de execução) são gravados no JSON para fins de auditoria, mas **NÃO participam** da tupla de entrada do `photo_analysis_key`. O hash é puramente derivado de invariantes estáticos e dos bytes da imagem.

### 7.2 Isolamento de Propriedade
Se o imóvel `REF 1628` e o imóvel `REF 1601` compartilharem a mesma foto física ($\text{physical\_file\_hash} = H$):
- Ambos produzem **exatamente a mesma** `photo_analysis_key`.
- O arquivo de cache global é gravado uma única vez em:
  `outputs/media_analysis/photos/<photo_analysis_key>/analysis.json`
- Nenhuma chamada duplicada de VLM é executada.

### 7.3 Concorrência e No-Clobber Cache Publication
Para garantir tolerância a falhas e concorrência segura entre workers:
1. O worker executa a inferência e grava o resultado JSON em staging privado:
   `outputs/media_analysis/photos/.tmp/analysis_<token>_<uuid>.tmp`
2. Valida a sintaxe JSON e integridade do schema antes da publicação.
3. Publica atomicamente via `fs.copyFileSync(stagingPath, canonicalPath, fs.constants.COPYFILE_EXCL)`.
4. Em caso de `EEXIST` (outro worker publicou simultaneamente o mesmo fingerprint):
   - O worker loser valida o JSON existente em `canonicalPath`.
   - Se íntegro: reutiliza o resultado e remove **apenas** seu arquivo temporário no `.tmp`.
   - Se inválido/corrompido: lança `CANONICAL_ANALYSIS_INTEGRITY_ERROR` e **NUNCA** executa `unlink` ou reparo destrutivo sobre o arquivo canônico compartilhado.

---

## 8. Ranking Intra-Ambiente (Comparativo entre Fotos do Mesmo Cômodo)

Para habilitar a seleção visual superior na Fase 4C, a Fase 4B.2 fornece a capacidade de ordenar fotos pertencentes ao mesmo ambiente.

### Algoritmo de Ranking Intra-Ambiente
Dadas $N$ fotografias classificadas com o mesmo `primary_room_type` (ex: 3 fotos da cozinha):
$$\text{intra\_rank\_score} = 0.45 \cdot \text{editorial\_utility.score} + 0.30 \cdot \text{aesthetic\_score.score} + 0.25 \cdot \text{technical\_quality.score}$$

Critério de desempate determinístico:
1. Maior `intra_rank_score`.
2. Maior `confidence`.
3. Menor `physical_file_hash` (ordem lexicográfica).

---

## 9. Estimativa de Custo e Eficiência Operacional

### REF 1628 (Showcase Canônico):
- **Quantidade de Fotos Físicas:** 11 fotos reais.
- **Modelo VLM Recomendado:** `gpt-4o-mini` com Structured Outputs.
- **Consumo por Foto:**
  - Imagem (900x1600 em low/high detail): ~1.000 tokens de entrada.
  - System Prompt + Schema: ~800 tokens de entrada.
  - Resposta JSON estruturada: ~400 tokens de saída.
- **Custo Unitário Estimado:** ~$0.003 USD por foto.
- **Custo Total do Showcase REF 1628 (11 fotos):** **~$0.033 USD (aproximadamente R$ 0,18)**.
- **Execução Subsequente (Cache Hit):** **$0.00 USD (0 tokens consumidos)**.

---

## 10. Matriz de Testes Formais Expandida (Fase 4B.2)

A suíte de testes cobrirá os seguintes cenários formais rigorosos:

| Cenário | Descrição do Teste | Critério de Aceitação / Asserção |
| :--- | :--- | :--- |
| **Cenário A** | Análise de foto real gera schema completo e válido. | Objeto segue rigorosamente a estrutura de `GlobalPhotoAnalysis`. |
| **Cenário B** | Determinismo estrito de `photo_analysis_key`. | Mesmos inputs geram rigorosamente o mesmo hash de 64 caracteres. |
| **Cenário C** | Mudança de `physical_file_hash` gera nova key. | Hashes físicos distintos produzem chaves de análise distintas. |
| **Cenário D** | Mudança de `model_id` gera nova key. | `gpt-4o` vs `gpt-4o-mini` geram chaves distintas. |
| **Cenário E** | Mudança de `prompt_version` gera nova key. | Alteração no prompt invalida cache deterministicamente. |
| **Cenário F** | Mudança de `schema_version` ou `taxonomy_version`. | Alteração de versão de contrato gera nova chave. |
| **Cenário G** | Cache Hit global reutiliza análise sem chamada ao provider. | Leitura do disco com 0 invocações de provider VLM. |
| **Cenário H** | `room_type` fora da taxonomia oficial é rejeitado com fail-fast. | Lança `INVALID_ROOM_TYPE_ERROR`. |
| **Cenário I** | `feature` fora da taxonomia oficial é rejeitada com fail-fast. | Lança `INVALID_FEATURE_ERROR`. |
| **Cenário J** | Decomposição de qualidade contém todos os 14 subcomponentes. | Todos os subscores técnicos, estéticos e utilitários presentes. |
| **Cenário K** | Cálculo determinístico de fórmulas de qualidade e pesos. | Subscores ponderados batem com precisão aritmética exata. |
| **Cenário L** | Foto ambígua (sala + jantar) popula `secondary_room_types`. | `secondary_room_types` contém ambientes secundários válidos. |
| **Cenário M** | Foto com baixa cobertura/utilidade recebe label de utility correto. | Mapeamento estrito de `utility_label` conforme pontuação. |
| **Cenário N** | Ranking intra-ambiente ordena fotos do mesmo cômodo coerentemente. | Ordenação determinística com critério de desempate por hash. |
| **Cenário O** | Múltiplas propriedades compartilhando blob usam mesmo cache. | `REF 1628` e `REF 1601` acessam o mesmo arquivo físico de cache. |
| **Cenário P** | Concorrência física de 2 workers (No-Clobber atomic write). | 1 único cache persistido e zero corrupção (`EEXIST` tratado). |
| **Cenário Q** | Provider timeout e erro de rede não corrompem cache global. | Falha limpa sem criação de arquivos parciais no cache. |
| **Cenário R** | Falha de decode ou imagem vazia impede chamada ao VLM. | Validação física preliminar rejeita imagem antes da API. |
| **Cenário S** | Composer V3 e Creative Director 4A.3 permanecem 100% intocados. | Zero modificação em pipelines de vídeo anteriores. |
| **Cenário T** | Ingestão de fotos 4B.1 permanece 100% intocada. | Módulos `photo_ingestion/` inalterados. |
| **Cenário U** | `GlobalPhotoAnalysis` no cache NÃO contém campos property-specific. | `property_ref`, `asset_id`, `crm_category`, `divergence_detected` ausentes do JSON global. |
| **Cenário V** | `PropertyPhotoSemanticView` projeta corretamente contexto da propriedade. | Objeto de catálogo combina análise global com contexto de CRM. |
| **Cenário W** | Fail-fast estrito para score $> 1.0$ (proibido clamping para 1.0). | Lança `SCORE_OUT_OF_BOUNDS_ERROR` imediato. |
| **Cenário X** | Fail-fast estrito para score $< 0.0$ (proibido clamping para 0.0). | Lança `SCORE_OUT_OF_BOUNDS_ERROR` imediato. |
| **Cenário Y** | Fail-fast estrito para score `NaN`, `Infinity` ou não-numérico. | Lança `SCORE_OUT_OF_BOUNDS_ERROR` imediato. |
| **Cenário Z** | Autoridade determinística de `resolution_adequacy` via specs físicas. | Calculado a partir de `specs.short_edge` ($\ge 900\text{px} \rightarrow 1.0$). |
| **Cenário AA** | CRM vago (`"Unidade"`) gera `comparable: false` e sem falso positivo. | `normalized_crm_room_hint = null`, `divergence_detected = false`. |
| **Cenário AB** | CRM específico (`"Quarto"`) divergente do VLM (`"kitchen"`) gera divergência. | `comparable: true`, `divergence_detected = true`, `reason = "crm_hint_mismatch"`. |
| **Cenário AC** | CRM específico (`"Sala"`) coincidente com VLM (`"living_room"`) sem divergência. | `comparable: true`, `divergence_detected = false`, `reason = null`. |
| **Cenário AD** | Timestamp `analyzed_at` diferente NÃO altera `photo_analysis_key`. | Fingerprint é estritamente invariante a timestamps de execução. |
| **Cenário AE** | Contact Sheet HTML exibe metadados separados (global vs CRM). | Visualização HTML separa dados intrínsecos de reconciliação de CRM. |

---

## 11. Protocolo de Showcase Canônico da REF 1628

Quando autorizado, o showcase executará:
1. Carregamento das 11 fotos reais já materializadas da REF 1628 no blob store.
2. Execução da análise semântica via VLM Provider.
3. Exibição da tabela completa com `primary_room_type`, `secondary_room_types`, `features`, `technical_quality`, `aesthetic_score`, `editorial_utility`, `confidence`, `divergence_detected` e `photo_analysis_key`.
4. Ranking comparativo entre fotos do mesmo cômodo (ex: Fotos de Sala, Fotos de Cozinha, Fotos de Sacada).
5. Segunda execução completa demonstrando **100% de cache hit ($0$ chamadas de API)**.
6. Geração de Contact Sheet HTML interativo com cards visuais contendo todos os metadados semânticos para inspeção humana cega.

---

## 12. Arquivos a Criar na Futura Implementação (Zero Modificação em Código Existente)

### Novos Arquivos a Criar:
- `video_engine/property_media/photo_understanding/photo_analysis_schema.js` (Schema, taxonomia e `computePhotoAnalysisKey`)
- `video_engine/property_media/photo_understanding/quality_evaluator.js` (Fórmulas, autoridade de scores e validação fail-fast)
- `video_engine/property_media/photo_understanding/crm_category_reconciler.js` (Normalização e detecção de divergência CRM)
- `video_engine/property_media/photo_understanding/providers/base_photo_understanding_provider.js` (Interface abstrata)
- `video_engine/property_media/photo_understanding/providers/mock_photo_understanding_provider.js` (Mock determinístico para testes)
- `video_engine/property_media/photo_understanding/providers/openai_photo_understanding_provider.js` (Integração VLM estruturada)
- `video_engine/property_media/photo_understanding/photo_media_understanding_service.js` (Serviço orquestrador com cache No-Clobber e projeção)
- `video_engine/property_media/photo_understanding/index.js` (Exportações do módulo)
- `tests/video_engine/photo_media_understanding_tests.js` (Suíte formal de testes A–AE)
- `run_showcase_photo_media_understanding.js` (Showcase real da REF 1628)

### Arquivos Existentes:
- **ZERO modificações** em `composer_service.js`, `creative_director/`, `property_media/photo_ingestion/`, `property_media/property_media_service.js` ou migrations.

---

**STATUS:** PLANO DE ARQUITETURA DA FASE 4B.2 FINALIZADO E PRONTO PARA REVISÃO EXTERNA. STOP.

