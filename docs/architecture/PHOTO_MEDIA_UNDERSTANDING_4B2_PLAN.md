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

## 2. Arquitetura da Fase 4B.2 — Photo Media Understanding

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CRM Photo Ingested (4B.1)                                                   │
│ outputs/media_blobs/photos/<physical_file_hash>.<ext>                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. PHOTO ANALYSIS FINGERPRINT                                               │
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
                         │                 │ 3. STRICT SCHEMA VALIDATION      │
                         │                 │ Fail-Fast em room_type & feature │
                         │                 │ Normalização & Clamping [0, 1]   │
                         │                 │ Decomposição de Qualidade        │
                         │                 └─────────────────┬────────────────┘
                         │                                   │
                         │                                   ▼
                         │                 ┌──────────────────────────────────┐
                         │                 │ 4. ATOMIC NO-CLOBBER CACHE WRITE │
                         │                 │ outputs/media_analysis/photos/   │
                         │                 │ <photo_analysis_key>/            │
                         │                 │ analysis.json                    │
                         │                 └─────────────────┬────────────────┘
                         │                                   │
                         └─────────────────┬─────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. PHOTO UNDERSTANDING CATALOG RESULT                                       │
│ {                                                                           │
│   photo_analysis_key, physical_file_hash,                                   │
│   semantic: { primary_room_type, secondary_room_types, features, conf },    │
│   quality: { technical_quality, aesthetic_score, editorial_utility },       │
│   provenance: { crm_category_hint, divergence_detected, ... }               │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Schemas Canônicos e Validação Estrita

### 3.1 Schema de Saída: `PhotoAnalysisResult`
A saída de análise semântica de uma foto segue a seguinte estrutura canônica validada:

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
  "provenance": {
    "crm_category_hint": "Unidade",
    "divergence_detected": false,
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

## 4. Decomposição de Qualidade e Editorial Utility

Para eliminar notas opacas e garantir auditabilidade completa, o Photo Media Understanding avalia 3 pilares independentes:

### 4.1 Technical Quality (Peso: 30%)
Mede a integridade óptica e digital da captura:
1. **`sharpness` [0.0–1.0]:** Nitidez dos contornos, ausência de borrão de movimento ou foco incorreto.
2. **`exposure` [0.0–1.0]:** Equilíbrio de exposição, sem estouro de brancos nas janelas ou sombras empastadas.
3. **`noise_compression` [0.0–1.0]:** Ausência de ruído digital ISO alto e artefatos de compressão JPEG.
4. **`resolution_adequacy` [0.0–1.0]:** Suficiência da resolução física para exibição vertical em 1080x1920 ($1.0$ para $\ge 900\text{px}$ de short edge).
5. **`perspective_alignment` [0.0–1.0]:** Nivelamento vertical de paredes e ausência de distorção de lente olho-de-peixe extrema.
$$\text{technical\_quality.score} = 0.30 \cdot \text{sharpness} + 0.25 \cdot \text{exposure} + 0.20 \cdot \text{noise} + 0.15 \cdot \text{resolution} + 0.10 \cdot \text{perspective}$$

### 4.2 Aesthetic & Composition Quality (Peso: 30%)
Mede a harmonia visual e o apelo imobiliário:
1. **`composition` [0.0–1.0]:** Enquadramento da cena, regra dos terços e linhas-guia.
2. **`framing` [0.0–1.0]:** Corte visual dos elementos estruturais (não cortar móveis ao meio de forma deselegante).
3. **`visual_balance` [0.0–1.0]:** Distribuição harmônica de pesos visuais na foto.
4. **`lighting_atmosphere` [0.0–1.0]:** Sensação de ambiente agradável, acolhedor e bem iluminado.
5. **`cleanliness_staging` [0.0–1.0]:** Organização do ambiente, ausência de bagunça, roupas espalhadas ou itens pessoais invasivos.
$$\text{aesthetic\_score.score} = 0.25 \cdot \text{composition} + 0.20 \cdot \text{framing} + 0.20 \cdot \text{balance} + 0.20 \cdot \text{lighting} + 0.15 \cdot \text{cleanliness}$$

### 4.3 Editorial Utility (Peso: 40%)
Mede a utilidade específica da imagem para montagem de um vídeo de anúncio imobiliário:
1. **`room_coverage` [0.0–1.0]:** Capacidade da foto de mostrar a totalidade do cômodo (uma foto angular ampla vale mais que uma foto fechada num canto).
2. **`feature_clarity` [0.0–1.0]:** Quão nítidas e destacadas são as características de valor do imóvel (ex: armários planejados bem visíveis, bancada de granito clara).
3. **`spaciousness_perception` [0.0–1.0]:** Capacidade da fotografia de transmitir a sensação real de espaço e amplitude.
4. **`obstruction_level` [0.0–1.0]:** Grau de desobstrução visual ($1.0$ = visão desimpedida; $0.2$ = coluna ou porta bloqueando a visão principal).
$$\text{editorial\_utility.score} = 0.35 \cdot \text{room\_coverage} + 0.30 \cdot \text{feature\_clarity} + 0.20 \cdot \text{spaciousness} + 0.15 \cdot \text{obstruction\_level}$$

### 4.4 Utility Labels Qualitativos
- `high_value_anchor` ($\text{editorial\_utility.score} \ge 0.80$): Foto âncora excelente para abrir ou sustentar um beat principal do ambiente.
- `supporting_detail` ($0.60 \le \text{editorial\_utility.score} < 0.80$): Foto boa de detalhe ou ângulo complementar.
- `marginal_usable` ($0.40 \le \text{editorial\_utility.score} < 0.60$): Utilizável apenas em fallback se não houver outra opção do cômodo.
- `editorial_reject` ($\text{editorial\_utility.score} < 0.40$): Inadequada para o vídeo (muito escura, detalhe irrelevante, banheiro com tampa aberta, etc.).

---

## 5. Separação Arquitetural: Qualidade Absoluta (4B.2) vs Relevância Semântica (4C)

Uma regra de ouro da arquitetura:
- **A Fase 4B.2 calcula estritamente as propriedades intrínsecas da fotografia:**
  “O que tem na foto?”, “Quais features existem?”, “Quão nítida ela é?”, “Qual o nível de cobertura do ambiente?”.
- **A Fase 4C (Creative Director Multimodal) calculará o matching contextual com o roteiro:**
  “O locutor disse 'veja os armários planejados da cozinha', qual foto tem o maior match?”.
- **Invariante:** Em nenhuma hipótese a nota estética ou técnica da 4B.2 substitui a relevância semântica calculada no Creative Director.

---

## 6. Política para Casos Visuais Ambíguos e Divergências CRM

### 6.1 Tratamento de Ambientes Híbridos / Contíguos
Muitos imóveis modernos possuem plantas integradas. A política de classificação semântica estabelece:
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

### 6.2 Proveniência e Divergência CRM
O CRM ImobTotal categoriza fotos através de strings livres cadastradas por corretores (ex: `"Unidade"`, `"Sala"`, `"Área Comum"`).
- O valor original do CRM é preservado em `provenance.crm_category_hint`.
- A autoridade semântica oficial é **100% dos pixels reais analisados pelo VLM**.
- Se `crm_category_hint` indicar `"Quarto"` mas os pixels revelarem uma cozinha, o sistema registra `primary_room_type = 'kitchen'` e `divergence_detected = true`.

---

## 7. Fingerprint e Cache Global Imutável

### 7.1 Cálculo do `photo_analysis_key`
O fingerprint semântico é **estritamente global e agnóstico de propriedade** (content-addressed):

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

## 10. Matriz de Testes Formais (Fase 4B.2)

A suíte de testes cobrirá os seguintes cenários formais:
- **Cenário A:** Análise de foto real gera schema completo e válido.
- **Cenário B:** Determinismo estrito de `photo_analysis_key`.
- **Cenário C:** Mudança de `physical_file_hash` gera nova key.
- **Cenário D:** Mudança de `model_id` gera nova key.
- **Cenário E:** Mudança de `prompt_version` gera nova key.
- **Cenário F:** Mudança de `schema_version` ou `taxonomy_version` gera nova key.
- **Cenário G:** Cache Hit global reutiliza análise sem chamada ao provider.
- **Cenário H:** `room_type` fora da taxonomia oficial é rejeitado com fail-fast.
- **Cenário I:** `feature` fora da taxonomia oficial é rejeitada com fail-fast.
- **Cenário J:** Scores fora do intervalo $[0.0, 1.0]$ são rejeitados com fail-fast.
- **Cenário K:** Decomposição de qualidade contém todos os 10 subcomponentes auditáveis.
- **Cenário L:** Detecção explícita de divergência entre `crm_category` e `primary_room_type`.
- **Cenário M:** Foto ambígua (sala + jantar) popula `secondary_room_types` corretamente.
- **Cenário N:** Foto com baixa cobertura/utilidade recebe label `supporting_detail` ou `marginal_usable`.
- **Cenário O:** Ranking intra-ambiente ordena fotos do mesmo cômodo coerentemente.
- **Cenário P:** Múltiplas propriedades compartilhando o mesmo blob utilizam o mesmo cache semântico global.
- **Cenário Q:** Concorrência física de 2 workers analisando a mesma foto $\rightarrow$ 1 único cache persistido e zero corrupção.
- **Cenário R:** Provider timeout e erro de rede não corrompem cache global.
- **Cenário S:** Falha de decode ou imagem vazia impede chamada ao VLM.
- **Cenário T:** Composer V3, Property Video Ingestion e Creative Director permanecem 100% intocados.

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

## 12. Arquivos a Criar e Modificar na Futura Implementação

### Novos Arquivos a Criar:
- `video_engine/property_media/photo_understanding/photo_analysis_schema.js` (Schema, taxonomia e `computePhotoAnalysisKey`)
- `video_engine/property_media/photo_understanding/quality_evaluator.js` (Fórmulas e decomposição de qualidade)
- `video_engine/property_media/photo_understanding/providers/base_photo_understanding_provider.js` (Interface abstrata)
- `video_engine/property_media/photo_understanding/providers/mock_photo_understanding_provider.js` (Mock determinístico para testes)
- `video_engine/property_media/photo_understanding/providers/openai_photo_understanding_provider.js` (Integração VLM estruturada)
- `video_engine/property_media/photo_understanding/photo_media_understanding_service.js` (Serviço orquestrador com cache No-Clobber)
- `video_engine/property_media/photo_understanding/index.js` (Exportações do módulo)
- `tests/video_engine/photo_media_understanding_tests.js` (Suíte formal de testes A–T)
- `run_showcase_photo_media_understanding.js` (Showcase real da REF 1628)

### Arquivos Existentes:
- **ZERO modificações** em `composer_service.js`, `creative_director/`, `property_media/property_media_service.js` ou migrations.

---

**STATUS:** PLANO DE ARQUITETURA DA FASE 4B.2 FINALIZADO E PRONTO PARA REVISÃO EXTERNA. STOP.
