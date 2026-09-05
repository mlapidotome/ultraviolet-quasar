# ARQUITETURA TÉCNICA: CREATIVE DIRECTOR & SEMANTIC EDITING ENGINE (HARDENED)
## Bali Imóveis — Video Engine V2 (Fase 4)

**Status:** PLANEJAMENTO / HARDENING FINAL (REVISÃO EXTERNA APROVADA)  
**Data:** Setembro de 2026  
**Versão:** 1.1.0-hardened  

---

## 1. RESUMO EXECUTIVO & PRINCÍPIOS FUNDAMENTAIS

O **Video Engine V2** possui suas camadas inferiores congeladas e homologadas:
- **Infraestrutura de Ingestão de Vídeos Reais do CRM** (Commit `9ca0f8aa330729343fc4a77c86c7862cfa3e6cf5`): isolamento de publicação por `claim_token`, streaming de SHA-256, inspeção via `ffprobe` e `getPropertyMediaPool` imutável.
- **Composer Engine V3** ([`composer_service.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/composer_service.js)): executor estritamente determinístico que compila Blueprints 1.0, 1.1 e 1.2 com PIP lip-sync, B-roll multicamada, tipografia física (`FONT_REGISTRY`) e render_key pura.

### O Problema Central
O Composer V3 executa o que recebe no Blueprint com precisão de frame, mas **não possui inteligência editorial ou semântica**.
A inteligência deve residir **exclusivamente na camada superior (Creative Director)**, emitindo um documento declarativo e auditável (**Creative Blueprint 1.2**) para o Composer.

### O Princípio Arquitetural Inviolável
```text
+-------------------------------------------------------------------------------+
|                             CREATIVE DIRECTOR                                 |
|      (Inteligência Editorial, Semântica de Mídia e Alinhamento de Áudio)      |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                             CREATIVE BLUEPRINT                                |
|        (Contrato Declarativo, Imutável e 100% Reprodutível - JSON Schema)     |
+---------------------------------------+---------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                            COMPOSER DETERMINÍSTICO                            |
|             (Executor Puro FFmpeg: Zero IA / Zero Incerteza no Render)        |
+-------------------------------------------------------------------------------+
```

---

## 2. DIAGNÓSTICO DO CÓDIGO ATUAL (AUDITORIA DOS 15 PONTOS)

| # | Pergunta da Auditoria | Diagnóstico com Evidência no Código Real |
|---|---|---|
| **1** | *Onde hoje os Creative Blueprints são construídos?* | No arquivo [`video_engine/asset_service.js:378-470`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/asset_service.js#L378-L470), na função `buildCreativeBlueprints(job, resolvedAssetMap)`. Também em endpoints shadow e testes em [`video_engine/api_v2.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/api_v2.js#L580-L625) e [`tests/video_engine/phase3c2_composer_tests.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/tests/video_engine/phase3c2_composer_tests.js). |
| **2** | *Quais decisões hoje são hardcoded/determinísticas?* | **Roteiros ([`job_service.js:100-191`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/job_service.js#L100-L191)):** Fórmulas de financiamento estáticas, 3 ganchos com interpolação de strings, 1 texto fixo de corpo e looks fixos (`MARCEL_LOOKS`).<br>**Blueprints ([`asset_service.js:378-470`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/asset_service.js#L378-L470)):** Schema `1.0`, divisão fixa em 2 blocos (Gancho 0–9.5s e Corpo 9.5–38.2s), ambos apontando para vídeos inteiros do apresentador HeyGen, sem b-roll.<br>**Testes/Showcase:** Trims de vídeo e posições PIP inseridos manualmente via offsets fixos em milissegundos. |
| **3** | *Onde são escolhidos: asset_id, visual_timeline, source_in/out, fullscreen, PIP, overlays, captions, CTA, editing_style?* | Não há gerador dinâmico. Em `buildCreativeBlueprints`, apenas `hook_asset_id` e `body_asset_id` são populados. No Blueprint 1.2, esses arrays são declarados manualmente nos scripts de teste/API shadow. |
| **4** | *O Composer v3 aceita livremente essas decisões via Blueprint ou ainda existem decisões criativas escondidas dentro dele?* | O Composer v3 ([`composer_service.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/composer_service.js)) é **100% determinístico**. Ele valida bounding boxes, safe rectangles, colisões espaço-temporais e sincronismo de lip-sync, compilando o filtergraph FFmpeg exato. Todas as decisões vêm do Blueprint. |
| **5** | *Quais dados do imóvel estão disponíveis para uma futura inteligência?* | Retornados por `fetchImovelData`: `referencia`, `titulo`, `descricao`, `preco_venda`, `preco_locacao`, `preco_condominio`, `area_construida`, `dormitorios`, `suites`, `banheiros`, `vagas`, `cidade`, `bairro`, `tipo`, `caracteristicas` (tags de lazer/infraestrutura), `link_video`, e lista de `fotos`. |
| **6** | *Quais mídias estão disponíveis via Property Media Pool?* | `propertyMediaService.getPropertyMediaPool(ref)` retorna:<br>1. `photos`: Array de `{ asset_id, asset_type: 'image', role: 'property_photo', url, index }`.<br>2. `videos`: Array de vídeos validados com status `READY` em `video_assets`: `{ asset_id, asset_type: 'property_video', role: 'property_footage', storage_path, duration_ms, specs, file_hash, remote_url }`. |
| **7** | *As fotos possuem alguma metadata/categoria do CRM?* | As fotos possuem o campo `categoria` na API do ImobTotal, mas a auditoria empírica comprovou que **todas as fotos retornam com categorias genéricas** (`'Unidade'` ou `'Empreendimento'`). Não há categorização de cômodos no CRM. |
| **8** | *O property video possui hoje apenas specs/duração ou alguma análise de conteúdo?* | Possui **estritamente specs físicas e técnicas** (`width`, `height`, `fps`, `duration_sec`, `duration_ms`, `codec_video`, `codec_audio`, `audio_channels`, `format_name`, `file_size_bytes`, `file_hash`). **Zero análise de conteúdo semântico**. |
| **9** | *Existe hoje qualquer camada de scene detection, semantic labeling, VLM/CV ou transcript-to-visual alignment?* | **Não existe nenhuma**. O sistema não executa detecção de corte de cena, rotulagem visual por IA multimodal, extração de embeddings ou alinhamento temporal de fala por transcrição. |
| **10** | *O que já existe de estrutura para editing_style/presets?* | O arquivo [`video_engine/styles/presets.js`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/styles/presets.js) possui uma estrutura completa contendo: presets `performance_reels_v1` e `clean_modern_v1`, tipografia física validada no boot (`FONT_REGISTRY`), paletas de cores, geometrias seguras (`safe_rectangles`), presets de PIP, presets de overlay, curvas de animação (`motion_presets`) e `style_hash` determinístico via SHA-256. |
| **11** | *Onde estão hoje os roteiros Hook/Body?* | Gerados em [`job_service.js:generateCompleteScripts(imovel)`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/job_service.js#L100-L191) e persistidos na coluna `scripts_snapshot` da tabela `video_jobs`. |
| **12** | *Como Script → Blueprint acontece atualmente?* | Em [`asset_service.js:buildCreativeBlueprints`](file:///c:/Users/Marcel/.gemini/antigravity/playground/ultraviolet-quasar/video_engine/asset_service.js#L378-L470), o script do gancho e do corpo são apenas mapeados em dois blocos contínuos de apresentador HeyGen (sem cortes de b-roll). |
| **13** | *O sistema sabe o timestamp aproximado de cada frase/fala?* | **Não**. O roteiro é enviado como um único bloco de texto para o avatar da HeyGen, gerando um MP4 contínuo. O sistema só conhece a duração total do arquivo final via ffprobe. |
| **14** | *O sistema possui captions segmentadas com timestamps utilizáveis para direção visual?* | O Composer V3 possui suporte pleno para renderizar legendas quando fornecidas via array `captions: [{ start_ms, end_ms, text }]`, mas **não há nenhum serviço que extraia esses timestamps automaticamente do áudio gerado**. |
| **15** | *Quais são os blockers reais para um Director decidir: “nesta frase mostre cozinha de 10.2s a 12.5s”?* | **Blocker A (Audio Timing):** Falta de timestamps por palavra/frase do áudio do apresentador.<br>**Blocker B (Video Continuous Tour Segmentation):** Falta de segmentação temporal semântica para tours contínuos sem cortes físicos.<br>**Blocker C (Visual Semantic Catalog):** Falta de classificação semântica com taxonomia padronizada e métricas de qualidade para fotos e vídeos.<br>**Blocker D (Director Reasoning & Provenance):** Falta do motor editorial que faça o matching auditável entre os beats da fala e os assets do acervo. |

---

## 3. ENTENDIMENTO DE VÍDEO: CONTINUOUS TOUR SEMANTIC SEGMENTATION

### 3.1. O Problema: Cut Detection ≠ Semantic Segmentation
Vídeos de imóveis no CRM são frequentemente gravados como **tours contínuos em plano-sequência** (ex: o corretor caminha da sala para o corredor, entra na cozinha e sai na varanda).
- **Detecção de Cortes Física (Shot/Cut Detection)** via FFmpeg `select='gt(scene,0.35)'` detecta apenas cortes bruscos de edição. Em um tour contínuo, consideraria o vídeo inteiro como um único take de 60 segundos.
- **Segmentação Temporal Semântica (Semantic Temporal Segmentation)** precisa detectar a transição de ambiente/conteúdo mesmo sem corte físico.

### 3.2. Arquitetura Híbrida Recomendada (Sampling + Semantic Change Detection)

```text
[Property Video (ex: 60s)] 
         |
         v
1. Technical Probe (Duração, FPS, Codecs via ffprobe)
         |
         v
2. Shot Boundary Detection (Opcional - detecta cortes físicos óbvios via FFmpeg)
         |
         v
3. Temporal Sampling Uniforme (ex: 1 frame a cada 1.0s ou 1.5s)
         |
         v
4. Frame Semantics & Visual Embeddings (VLM Provider / Embedding Model)
   - room_type (enum formal)
   - features (tags)
   - quality breakdown
         |
         v
5. Semantic Change Detection & Temporal Clustering
   - Agrupa frames contíguos com mesmo room_type dominante
   - Suaviza ruídos transitórios (ex: 1 frame de transição no batente da porta)
   - Descarta/funde micro-segmentos (< 1200ms) para evitar cortes flicker
         |
         v
6. Representative Keyframe Selection
   - Seleciona o frame com maior technical_quality_score dentro do segmento
         |
         v
7. Media Semantic Catalog (Persistido imutavelmente com Analysis Fingerprint)
```

### 3.3. Taxonomia Oficial e Separação entre `room_type` e `features`

O sistema **NÃO** deve impor cenas pré-determinadas para o imóvel (ex: não assumir que a REF 1628 tem varanda ou piscina a priori). Ele deve descobrir os ambientes reais.

#### Enum Oficial de `room_type`:
- `living_room` (Sala de Estar / TV)
- `dining_room` (Sala de Jantar)
- `kitchen` (Cozinha / Copa)
- `balcony` (Varanda / Sacada)
- `bedroom` (Quarto padrão)
- `suite` (Suíte / Quarto com Banheiro)
- `bathroom` (Banheiro / Lavabo)
- `facade` (Fachada do Prédio / Casa)
- `hallway` (Corredor / Circulação / Hall)
- `laundry` (Área de Serviço / Lavanderia)
- `garage` (Garagem / Vaga)
- `leisure` (Área de Lazer / Piscina / Academia / Salão de Festas)
- `city_view` (Vista Panorâmica da Cidade / Montanha)
- `exterior` (Jardim / Quintal / Área Externa)
- `other` (Outro ambiente identificado)
- `unknown` (Ambiente não identificável com confiança)

#### `features` (Array de Atributos Específicos):
Independentes do `room_type`:
`['city_view', 'gourmet', 'glass_enclosure', 'planned_cabinets', 'porcelain_tile', 'high_ceiling', 'pool', 'barbecue_grill', 'air_conditioning', 'open_concept', 'natural_lighting']`.

---

## 4. PERSISTÊNCIA, CACHE FÍSICO E ANALYSIS FINGERPRINT

### 4.1. Cache Baseado em Conteúdo Físico Real (`physical_file_hash`)
- **Fotos:** URLs do CRM não são identidades confiáveis (podem mudar ou expirar). As fotos do CRM devem ser baixadas e materializadas de forma segura, calculando o `physical_file_hash` (SHA-256 dos bytes).
- **Vídeos:** O `PropertyMediaService` já calcula e valida o `file_hash` (SHA-256) do arquivo canônico local.

### 4.2. Analysis Fingerprint: Cache com Invalidação Versionada
O arquivo físico pode permanecer o mesmo, mas a inteligência de análise evolui (novo modelo VLM, novo prompt, correção de bugs, nova taxonomia).
Para evitar re-análises desnecessárias sem travar evoluções do modelo, define-se a **Analysis Key Determinística**:

$$\text{analysis\_key} = \text{SHA256}(\text{physical\_file\_hash} + \text{analyzer\_type} + \text{analyzer\_version} + \text{model\_id} + \text{prompt\_version} + \text{schema\_version})$$

- **Mesmo arquivo + Mesma versão de análise** $\rightarrow$ `CACHE HIT` (Zero custo, retorno imediato).
- **Mesmo arquivo + Nova versão de analisador** $\rightarrow$ `NOVA ANÁLISE` (Registrada sem sobrescrever o histórico de análises anteriores).

---

## 5. SCRIPT & TIMING: FORCED ALIGNMENT DE ALTA PRECISÃO

### 5.1. Open Transcription vs Forced Alignment
Como o texto do roteiro já é previamente conhecido e foi exatamente o texto enviado ao motor de voz da HeyGen, o problema **não é transcrição aberta**, mas sim **Forced Alignment** (alinhar o texto conhecido à onda de áudio gerada).

```text
[Texto Conhecido do Roteiro] + [Áudio Limpo do Apresentador]
                      |
                      v
          [Forced Alignment Engine]
          (Whisper com word_timestamps / CTC-Segmentation / Whisper.cpp)
                      |
                      v
             [Word-Level Timestamps]
  { word: "varanda", start_ms: 3200, end_ms: 3800, confidence: 0.98 }
                      |
                      v
             [Semantic Script Beats]
```

### 5.2. Estrutura do Semantic Beat
O roteiro decupado gera uma sequência temporal de intenções:
```json
{
  "beat_id": "beat_02",
  "start_ms": 2800,
  "end_ms": 5600,
  "duration_ms": 2800,
  "text": "Conta com uma varanda gourmet com vista livre definitiva",
  "intent": "showcase_highlight",
  "entities": {
    "target_room": "balcony",
    "required_features": ["city_view", "gourmet"],
    "price_mentioned": null,
    "location_mentioned": null
  },
  "visual_requirements": {
    "preferred_media_type": "video",
    "allow_pip": true,
    "suggested_overlay": null
  }
}
```

---

## 6. QUALITY, RELEVANCE E SELEÇÃO AUDITÁVEL (PROVENANCE)

### 6.1. Decomposição do Score Visual (Sem Caixa Preta)
O score visual não é uma nota subjetiva única. Ele é composto matematicamente por:

$$\text{final\_match\_score} = (\text{semantic\_relevance} \times 0.50) + (\text{technical\_quality} \times 0.30) + (\text{aesthetic\_score} \times 0.20)$$

Onde:
1. **`technical_quality_score` (0.0 a 1.0):** Nitidez (sharpness), exposição/iluminação, ausência de motion blur excessivo, estabilidade de câmera, ausência de obstruções.
2. **`aesthetic_score` (0.0 a 1.0):** Composição, amplitude angular, enquadramento espacial.
3. **`semantic_relevance_score` (0.0 a 1.0):** Grau de correspondência entre o que o locutor fala no beat e o que está visível no frame/cena (`room_type` match = 1.0; `features` match = +0.2 por feature coincidente).
4. **`confidence` (0.0 a 1.0):** Nível de certeza do modelo classificador.

> **Regra de Decisão:** A **relevância semântica** tem peso preponderante sobre a estética. Uma foto tecnicamente perfeita da garagem não deve ser escolhida para uma fala sobre a varanda gourmet.

### 6.2. Provenance & Auditabilidade das Decisões
Toda decisão tomada pelo Creative Director deve ser explicável e gravada:
```json
{
  "beat_id": "beat_02",
  "selected_media": {
    "asset_id": "ast_pvid_1628_01",
    "segment_id": "seg_03_balcony",
    "source_in_ms": 14200,
    "source_out_ms": 17000,
    "room_type": "balcony",
    "matched_features": ["city_view", "glass_enclosure"]
  },
  "metrics": {
    "semantic_relevance": 0.96,
    "technical_quality": 0.88,
    "aesthetic_score": 0.90,
    "final_match_score": 0.924,
    "confidence": 0.95
  },
  "decision_reason": "Matched high-confidence property video balcony footage with city_view matching beat speech.",
  "fallback_used": false,
  "presenter_mode": "pip_bottom_right",
  "director_version": "1.0.0"
}
```

---

## 7. VERSIONAMENTO ESTATAL DO CREATIVE DIRECTOR

Para garantir reprodutibilidade completa de qualquer criativo renderizado no passado, o Creative Direction Plan armazena as versões de todos os componentes da cadeia:
- `media_analyzer_version` (ex: `vlm_scene_1.0.0`)
- `script_alignment_version` (ex: `whisper_forced_1.0.0`)
- `beat_parser_version` (ex: `beat_parser_1.0.0`)
- `director_version` (ex: `director_engine_1.0.0`)
- `style_id` e `style_version` (ex: `performance_reels_v1:1`)
- `blueprint_schema_version` (ex: `1.2`)

---

## 8. MODELO DE DADOS CONCEITUAL UNIFICADO (ESPECIFICAÇÃO SEM MIGRATIONS)

Estrutura desenhada para integração limpa com a tabela canônica `video_assets`:

```sql
-- 1. Análises Semânticas Gerais de Mídia (Fotos e Vídeos) com Analysis Fingerprint
CREATE TABLE IF NOT EXISTS media_semantic_analyses (
  id VARCHAR(64) PRIMARY KEY,                   -- msa_<analysis_key_prefix>
  asset_id VARCHAR(64) NOT NULL REFERENCES video_assets(id),
  property_ref VARCHAR(32) NOT NULL,
  physical_file_hash VARCHAR(64) NOT NULL,
  analysis_key VARCHAR(64) NOT NULL UNIQUE,      -- SHA-256 do fingerprint completo
  media_type VARCHAR(16) NOT NULL,              -- 'video' ou 'image'
  analyzer_type VARCHAR(32) NOT NULL,           -- 'vlm_multimodal', 'scene_embedding'
  analyzer_version VARCHAR(32) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  prompt_version VARCHAR(32) NOT NULL,
  schema_version VARCHAR(16) NOT NULL,
  summary_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Segmentos Temporais Semânticos (Específico para Vídeos do Imóvel)
CREATE TABLE IF NOT EXISTS media_temporal_segments (
  id VARCHAR(64) PRIMARY KEY,                   -- mts_<analysis_id>_<idx>
  analysis_id VARCHAR(64) NOT NULL REFERENCES media_semantic_analyses(id) ON DELETE CASCADE,
  asset_id VARCHAR(64) NOT NULL REFERENCES video_assets(id),
  segment_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  room_type VARCHAR(64) NOT NULL,               -- Enum padronizado
  features JSONB DEFAULT '[]'::jsonb,
  technical_quality_score NUMERIC(3,2) NOT NULL,
  aesthetic_score NUMERIC(3,2) NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  keyframe_storage_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temporal_segments_room ON media_temporal_segments(room_type);
CREATE INDEX IF NOT EXISTS idx_temporal_segments_asset ON media_temporal_segments(asset_id);

-- 3. Planos de Direção Criativa Gravados com Provenance
CREATE TABLE IF NOT EXISTS creative_direction_plans (
  id VARCHAR(64) PRIMARY KEY,                   -- cdp_<job_id>_<creative_id>
  job_id UUID NOT NULL REFERENCES video_jobs(id),
  creative_id VARCHAR(64) NOT NULL,
  style_id VARCHAR(64) NOT NULL,
  style_version INTEGER NOT NULL,
  director_version VARCHAR(32) NOT NULL,
  analysis_fingerprints JSONB NOT NULL,         -- Map de assets utilizados e seus fingerprints
  script_beats JSONB NOT NULL,                  -- Beats com timestamps reais
  decisions_provenance JSONB NOT NULL,          -- Array de justificativas de matching por beat
  generated_blueprint JSONB NOT NULL,           -- Blueprint 1.2 declarativo final
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 9. CONTRATOS ABSTRATOS DE PROVIDERS DE IA (ZERO VENDOR LOCK-IN)

A arquitetura define interfaces abstratas, permitindo alternar provedores (OpenAI, Anthropic, Google Gemini, Ollama Local) via configuração de ambiente:

```typescript
// Interface Abstrata para Visão Computacional / VLM
interface MediaUnderstandingProvider {
  analyzeImage(params: { imageBuffer: Buffer, schema: object }): Promise<ImageSemanticsResult>;
  analyzeVideoKeyframes(params: { keyframes: Buffer[], timestampsMs: number[] }): Promise<VideoKeyframeSemanticsResult[]>;
}

// Interface Abstrata para Alinhamento de Áudio
interface ScriptAlignmentProvider {
  alignScriptWithAudio(params: { audioBuffer: Buffer, scriptText: string }): Promise<WordAlignmentResult>;
}
```

---

## 10. REVISÃO DO PLANO DE IMPLEMENTAÇÃO E SUBFASES DA FASE 4A

Para manter o escopo pequeno, seguro e verificável, a Fase 4A é dividida em 3 subfases:

```mermaid
graph LR
    subphase1[4A.1: Media Understanding Proof] --> subphase2[4A.2: Script Timing Proof]
    subphase2 --> subphase3[4A.3: Semantic Matching Showcase]
```

### Subfase 4A.1 — Media Understanding Proof
- Implementar extração de keyframes por amostragem temporal + detecção de cortes do vídeo da REF 1628.
- Chamar provider abstrato de VLM para classificar as cenas reais e as fotos reais.
- Persistir no modelo conceitual com `analysis_key` determinística.
- **Critério de Saída 4A.1:** JSON com os segmentos temporais descobertos da REF 1628 com `room_type`, `features` e `quality_score` sem intervenção manual.

### Subfase 4A.2 — Script Timing Proof
- Alimentar o áudio do apresentador HeyGen da REF 1628 no módulo de Forced Alignment.
- Produzir a lista de palavras com `start_ms`, `end_ms` e decupagem nos 4 `semantic_beats`.
- **Critério de Saída 4A.2:** Beats com timestamps reais da fala provados matematicamente contra a duração total do áudio.

### Subfase 4A.3 — Semantic Matching Showcase & A/B Comparison
- Executar o algoritmo de matching semântico casando os beats da 4A.2 com os segmentos de mídia da 4A.1.
- Gerar o payload do `Creative Blueprint 1.2`.
- Renderizar via `Composer V3` existente (sem alterar uma linha do Composer).
- Executar teste de comparação A/B (Baseline 1.0 vs Directed 1.2).

---

## 11. CRITÉRIOS OBJETIVOS DE SUCESSO DO MVP

### A. Sucesso Técnico
1. **Validade Matemática:** Todos os timestamps de B-roll e PIP coincidem com precisão de frame com a duração real do áudio (`trimDurationMs === segDurationMs`).
2. **Idempotência Total:** Segunda execução do pipeline para o mesmo imóvel com a mesma versão de analisador gera **zero chamadas de API externa**, servindo 100% do cache local.
3. **Isolamento do Composer:** Composer V3 executa o Blueprint gerado sem qualquer modificação no código de renderização.

### B. Sucesso Semântico
1. **Taxa de Pareamento Semântico ($\ge 80\%$):** Em pelo menos 80% dos beats onde um ambiente específico é mencionado, o visual exibido corresponde diretamente àquele ambiente na inspeção humana.
2. **Tratamento de Indisponibilidade:** Se o imóvel não possuir vídeo/foto de determinado ambiente citado, o sistema faz fallback gracioso para apresentador fullscreen ou foto geral com badge sem quebrar a timeline.

### C. Sucesso Visual (Comparação A/B Cega)
- O vídeo gerado (Variante B) demonstra conexão evidente entre a narrativa falada e a prova visual exibida na tela, superando visivelmente a montagem sequencial estática do baseline atual (Variante A).

---

## 12. STATUS DO DOCUMENTO

- [x] Hardening de segmentação temporal para continuous tours adicionado.
- [x] Remoção de cenas pré-determinadas; introdução de descoberta dinâmica e taxonomia completa.
- [x] Substituição de URL hash por `physical_file_hash` + `analysis_key` com fingerprinting de versão.
- [x] Forced alignment priorizado sobre transcrição aberta.
- [x] Decomposição do quality score em métricas técnicas, estéticas e relevância semântica.
- [x] Provenance e versionamento completo de decisões editoriais adicionados.
- [x] Contratos abstratos de providers para zero vendor lock-in.
- [x] Subdivisão da Fase 4A em etapas incrementais e seguras.
- [x] Zero alterações em código de produção, zero migrations e zero dependências instaladas.

**STATUS:** `CREATIVE DIRECTOR / SEMANTIC EDITING — PLANO HARDENED PRONTO PARA AUTORIZAÇÃO DE MVP.`
