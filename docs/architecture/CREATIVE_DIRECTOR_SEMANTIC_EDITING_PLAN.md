# ARQUITETURA TÉCNICA: CREATIVE DIRECTOR & SEMANTIC EDITING ENGINE
## Bali Imóveis — Video Engine V2 (Fase 4)

**Status:** PLANEJAMENTO / DIAGNÓSTICO  
**Data:** Setembro de 2026  
**Versão:** 1.0.0-draft  

---

## 1. RESUMO EXECUTIVO & PRINCÍPIOS FUNDAMENTAIS

O **Video Engine V2** alcançou solidez e homologação formal nas suas camadas de infraestrutura:
- **Infraestrutura de Ingestão de Vídeos Reais do CRM** (Fase homologada no commit `9ca0f8aa330729343fc4a77c86c7862cfa3e6cf5`), garantindo isolamento de candidatos por `claim_token`, streaming de SHA-256, inspeção rigorosa via `ffprobe` e `getPropertyMediaPool` imutável e seguro contra concorrência.
- **Composer Engine V3** (Suporte a Blueprint 1.2, execução determinística de timeline multicamada, B-roll de fotos/vídeos com trims lógicos `source_in_ms`/`source_out_ms`, PIP com lip-sync, Ken Burns, safe rectangles com tipografia física real e render_key pura).

### O Problema Central
Hoje o **Composer V3** é um executor puramente determinístico de altíssima precisão. No entanto, ele **não possui inteligência editorial ou semântica**. Ele não sabe:
1. Qual ambiente mostrar quando o apresentador fala uma frase específica (ex: mostrar a varanda gourmet quando o áudio diz *"uma varanda com vista aberta"*).
2. Quais trechos do vídeo do imóvel (40s–80s) correspondem a quais cômodos e com qual qualidade estética.
3. Quando manter o apresentador em tela cheia, quando colocá-lo em PIP e quando escondê-lo para valorizar o imóvel.
4. Quando pontuar elementos de conversão (badge de preço com punch zoom, metragem, localização, CTA).

### O Princípio Arquitetural
**Não queremos templates rígidos, efeitos cosméticos aleatórios ou transições cegas.** O salto de qualidade deve ser **semântico, narrativo e direcional**.

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

## 2. DIAGNÓSTICO COMPLETO DO CÓDIGO ATUAL (AUDITORIA PONTO A PONTO)

Abaixo estão as respostas precisas e auditadas diretamente no código-fonte atual do repositório:

| # | Pergunta da Auditoria | Diagnóstico com Evidência no Código Real |
|---|---|---|
| **1** | *Onde exatamente hoje os Creative Blueprints são construídos?* | No arquivo `video_engine/asset_service.js` (linhas 378–470), dentro da função `buildCreativeBlueprints(job, resolvedAssetMap)`. Também existem construções manuais/mock para testes e shadow renders em `video_engine/api_v2.js` (linhas 580–625) e `tests/video_engine/phase3c2_composer_tests.js`. |
| **2** | *Quais decisões hoje são hardcoded/determinísticas?* | **Roteiros (`job_service.js:100-191`):** Fórmulas de financiamento estáticas, 3 templates de ganchos com interpolação de strings, 1 texto fixo de corpo e looks fixos (`MARCEL_LOOKS`).<br>**Blueprints (`asset_service.js:378-470`):** Schema `1.0`, divisão fixa em 2 blocos (Gancho 0–9.5s e Corpo 9.5–38.2s), ambos apontando para vídeos inteiros do apresentador HeyGen, sem b-roll.<br>**Testes/Showcase:** Trims de vídeo e posições PIP inseridos manualmente via offsets fixos em milissegundos. |
| **3** | *Onde são escolhidos: asset_id, visual_timeline, source_in/out, fullscreen, PIP, overlays, captions, CTA, editing_style?* | Hoje eles **não são gerados dinamicamente por inteligência**. Em `buildCreativeBlueprints`, apenas `hook_asset_id` e `body_asset_id` são atribuídos. No Blueprint 1.2 (suportado pelo Composer), esses arrays (`visual_timeline`, `pip`, `overlays`, `captions`, `editing_style`) são declarados manualmente nos scripts de teste/API shadow. |
| **4** | *O Composer v3 aceita livremente essas decisões via Blueprint ou ainda existem decisões criativas escondidas dentro dele?* | O Composer v3 (`video_engine/composer_service.js`) é **100% livre de criatividade oculta**. Ele é um executor estritamente matemático: valida bounding boxes, safe rectangles, colisões espaço-temporais e sincronismo de lip-sync, compilando o filtergraph FFmpeg exato. Todas as decisões vêm do Blueprint. |
| **5** | *Quais dados do imóvel estão disponíveis para uma futura inteligência?* | Retornados por `fetchImovelData`: `referencia`, `titulo`, `descricao`, `preco_venda`, `preco_locacao`, `preco_condominio`, `area_construida`, `dormitorios`, `suites`, `banheiros`, `vagas`, `cidade`, `bairro`, `tipo`, `caracteristicas` (tags de lazer/infraestrutura), `link_video`, e lista de `fotos`. |
| **6** | *Quais mídias estão disponíveis via Property Media Pool?* | `propertyMediaService.getPropertyMediaPool(ref)` retorna:<br>1. `photos`: Array de `{ asset_id, asset_type: 'image', role: 'property_photo', url, index }`.<br>2. `videos`: Array de vídeos validados com status `READY` em `video_assets`: `{ asset_id, asset_type: 'property_video', role: 'property_footage', storage_path, duration_ms, specs, file_hash, remote_url }`. |
| **7** | *As fotos possuem alguma metadata/categoria do CRM?* | As fotos possuem o campo `categoria` na API do ImobTotal, mas a auditoria empírica comprovou que **todas as fotos retornam com categorias genéricas** (`'Unidade'` ou `'Empreendimento'`). Não há categorização por cômodo (ex: sala, cozinha, fachada). |
| **8** | *O property video possui hoje apenas specs/duração ou alguma análise de conteúdo?* | Possui **estritamente specs físicas e técnicas** (`width`, `height`, `fps`, `duration_sec`, `duration_ms`, `codec_video`, `codec_audio`, `audio_channels`, `format_name`, `file_size_bytes`, `file_hash`). **Zero análise de conteúdo semântico**. |
| **9** | *Existe hoje qualquer camada de scene detection, semantic labeling, VLM/CV ou transcript-to-visual alignment?* | **Não existe nenhuma**. O sistema não executa detecção de corte de cena, rotulagem visual por IA multimodal, extração de embeddings ou alinhamento temporal de fala por transcrição. |
| **10** | *O que já existe de estrutura para editing_style/presets?* | O arquivo `video_engine/styles/presets.js` possui uma estrutura completa e robusta contendo: presets `performance_reels_v1` e `clean_modern_v1`, tipografia física validada no boot (`FONT_REGISTRY`), paletas de cores, geometrias seguras (`safe_rectangles`), presets de PIP, presets de overlay, curvas de animação (`motion_presets`) e `style_hash` determinístico via SHA-256. |
| **11** | *Onde estão hoje os roteiros Hook/Body?* | Gerados em `job_service.js:generateCompleteScripts(imovel)` e persistidos na coluna `scripts_snapshot` da tabela `video_jobs`. |
| **12** | *Como Script → Blueprint acontece atualmente?* | Em `asset_service.js:buildCreativeBlueprints`, o script do gancho e do corpo são apenas mapeados em dois blocos contínuos de apresentador HeyGen (sem cortes de b-roll). |
| **13** | *O sistema sabe o timestamp aproximado de cada frase/fala?* | **Não**. O roteiro é enviado como um único bloco de texto para o avatar da HeyGen, gerando um MP4 contínuo. O sistema só conhece a duração total do arquivo final via ffprobe. |
| **14** | *O sistema possui captions segmentadas com timestamps utilizáveis para direção visual?* | O Composer V3 possui suporte pleno para renderizar legendas quando fornecidas via array `captions: [{ start_ms, end_ms, text }]`, mas **não há nenhum serviço que extraia esses timestamps automaticamente do áudio gerado**. |
| **15** | *Quais são os blockers reais para um Director decidir: “nesta frase mostre cozinha de 10.2s a 12.5s”?* | **Blocker A (Audio Timing):** Falta de timestamps por palavra/frase do áudio do apresentador.<br>**Blocker B (Video Scene Segmentation):** Falta de detecção de cortes de cena do vídeo do CRM.<br>**Blocker C (Visual Semantic Catalog):** Falta de rótulos semânticos (ex: `kitchen`, `living_room`, `balcony_view`, `quality_score`) nas fotos e nos cortes do vídeo.<br>**Blocker D (Director Reasoning):** Falta do módulo orquestrador que combine o roteiro decupado com o catálogo semântico de mídia e o estilo de edição para emitir o Blueprint 1.2. |

---

## 3. ARQUITETURA PROPOSTA: OS 5 PILARES DO SISTEMA

Para resolver definitivamente o problema sem criar dependências circulares ou sobrecarregar o Composer, a arquitetura deve ser dividida em 5 camadas independentes e assíncronas:

```text
+----------------------------------------------------------------------------------------------------+
|                                    1. MEDIA UNDERSTANDING LAYER                                    |
|                      (Executa UMA VEZ por Asset Físico - Cacheado Imutavelmente)                  |
|                                                                                                    |
|  [Property Video (40-80s)] ---> [Scene Detector] ---> [Keyframe Extractor] ---> [VLM Analyzer]    |
|                                                                                        |           |
|  [CRM Photos] -------------------------------------------------------------------> [VLM Analyzer] |
|                                                                                        |           |
|                                                    v                                   v           |
|                                   [video_asset_semantics Catalog]                                  |
+----------------------------------------------------------------------------------------------------+
                                                     |
+----------------------------------------------------+-----------------------------------------------+
|                                    2. SCRIPT & TIMING LAYER                                        |
|                          (Executa UMA VEZ por Narração Gerada / Áudio)                            |
|                                                                                                    |
|  [Roteiro + Áudio HeyGen] ---> [Speech-to-Text Forced Alignment / Whisper]                        |
|                                                 |                                                  |
|                                                 v                                                  |
|                              [Semantic Script Beats & Timestamps]                                  |
|        (ex: Beat 1: Hook Preço [0-2.8s], Beat 2: Varanda [2.8-5.4s], Beat 3: Cozinha [5.4-8.1s])   |
+----------------------------------------------------------------------------------------------------+
                                                     |
+----------------------------------------------------+-----------------------------------------------+
|                                   3. CREATIVE DIRECTOR ENGINE                                      |
|                                  (Executa UMA VEZ por Criativo)                                    |
|                                                                                                    |
|    Entradas:                                                                                       |
|    - Semantic Script Beats com Timestamps Reais                                                    |
|    - Asset Semantics Catalog (Cenas de Vídeo e Fotos Classificadas com Quality Scores)             |
|    - Editing Style Preset ('performance_reels_v1', 'premium_v1')                                   |
|    - Property Snapshot (Preço, Bairro, Metragem)                                                   |
|                                                                                                    |
|    Processamento:                                                                                  |
|    1. Seleção e Casamento Semântico (Semantic Matcher Beat <-> Media)                              |
|    2. Decisão de Estado do Apresentador (Fullscreen vs B-Roll com PIP vs B-Roll Puro)              |
|    3. Marcação de Overlays Estratégicos (Preço com Punch, Badge Metragem, CTA)                     |
|    4. Validação Espaço-Temporal de Safe Areas                                                      |
+----------------------------------------------------------------------------------------------------+
                                                     |
                                                     v
+----------------------------------------------------------------------------------------------------+
|                                  4. CREATIVE BLUEPRINT 1.2                                         |
|                      (Documento JSON Declarativo, Imutável e Auditável)                            |
|                                                                                                    |
|  - audio_track: { primary_asset_id: "ast_heygen_audio", broll_audio_policy: "mute_all_broll" }     |
|  - visual_timeline: [                                                                              |
|      { asset_id: "ast_pvid_...", start_ms: 0, end_ms: 2800, source_in_ms: 10200, source_out_ms: ...|
|      { asset_id: "ast_pvid_...", start_ms: 2800, end_ms: 5400, ... }                              |
|    ]                                                                                               |
|  - pip: { enabled: true, asset_id: "ast_heygen_...", windows: [{ start_ms: 2800, end_ms: 5400 }] } |
|  - overlays: [ { type: "price_badge", start_ms: 0, end_ms: 2500, text: "R$ 480 MIL" } ]           |
|  - captions: [ { start_ms: 0, end_ms: 1400, text: "Olha essa oportunidade" } ]                     |
+----------------------------------------------------------------------------------------------------+
                                                     |
                                                     v
+----------------------------------------------------------------------------------------------------+
|                                  5. COMPOSER ENGINE DETERMINÍSTICO                                 |
|                                 (Execução FFmpeg Pura e Determinística)                            |
+----------------------------------------------------------------------------------------------------+
```

---

## 4. ANÁLISE TÉCNICA: ONDE USAR IA VS DETERMINÍSTICO

Para evitar custos desnecessários, latência inaceitável e não-determinismo em tempo de render, a divisão de responsabilidades deve ser rigorosa:

| Etapa | Abordagem Recomendada | Justificativa Técnica | Frequência de Execução |
|---|---|---|---|
| **Detecção de Cortes no Vídeo** | **Determinístico Local** (FFmpeg `select='gt(scene,0.35)'` ou PySceneDetect) | Custo zero, ultra-rápido (processamento em ~1-2 segundos para 60s de vídeo), determinístico e sem dependência de API externa. | 1x por vídeo do CRM (reutilizado infinitamente). |
| **Extração de Keyframes** | **Determinístico Local** (FFmpeg extrai 1-2 frames por cena detectada) | Gera miniaturas leves (JPEG 720p) nos pontos centrais de cada cena detectada. | 1x por vídeo do CRM. |
| **Classificação Semântica de Cenas e Fotos** | **VLM Multimodal** (Gemini 2.5 Flash / Claude Haiku / GPT-4o-mini) | Identifica o ambiente (`living_room`, `kitchen`, `balcony_view`, `facade`, `bathroom`, `pool`), atributos (`bright`, `renovated`, `spacious`), qualidade estética (0.0 a 1.0) e ausência de defeitos. | **1x por imagem/keyframe**. O resultado é gravado em banco e cacheado pelo `file_hash`. |
| **Alinhamento de Fala e Timestamps** | **Whisper / Forced Alignment** (Local Whisper.cpp / OpenAI Whisper com `word_timestamps=True`) | Produz os timestamps exatos em milissegundos de cada palavra e frase do áudio gerado pelo apresentador. | 1x por áudio de apresentador gerado. |
| **Raciocínio Editorial (Creative Director)** | **LLM Estruturado + Heurística Determinística de Segurança** | O LLM faz o matching criativo entre o beat da fala e os melhores takes do acervo. Um validador determinístico em TypeScript/Node.js garante que não há gaps, colisões de safe area ou overlaps inválidos antes de gerar o Blueprint. | 1x por variante de anúncio. |
| **Montagem do Vídeo Final** | **100% Determinístico FFmpeg** (Composer V3) | Zero IA no momento da renderização. Executa estritamente o Blueprint aprovado. | 1x por renderização física. |

---

## 5. DETALHAMENTO DOS SUBSISTEMAS

### 5.1. Subsistema de Entendimento de Vídeo (Property Video Ingestion Semântica)
O vídeo do imóvel (40s–80s) baixado e validado pelo `PropertyMediaService` passa pelo seguinte fluxo:

1. **Scene Boundary Detection:**
   - O arquivo local canônico `${assetId}.${claimToken}.mp4` é lido pelo FFmpeg.
   - O comando de scene detection identifica as transições de corte:
     ```bash
     ffmpeg -i input.mp4 -filter_complex "select='gt(scene,0.3)',metadata=print:file=scenes.txt" -f null -
     ```
   - Gera uma lista de intervalos de cena: `[ { scene_index: 1, start_ms: 0, end_ms: 4200 }, { scene_index: 2, start_ms: 4200, end_ms: 8100 }, ... ]`.
2. **Keyframe Extraction:**
   - Para cada cena, extrai o frame em `t_mid = (start_ms + end_ms) / 2`.
3. **VLM Semantic Tagging:**
   - Envia os keyframes em lote para o VLM com um schema JSON estrito:
     ```json
     {
       "room_type": "balcony",
       "features": ["city_view", "open_air", "glass_railing"],
       "visual_quality_score": 0.94,
       "lighting": "bright_daylight",
       "camera_motion": "slow_pan_right",
       "has_people": false,
       "has_text_overlay": false
     }
     ```
4. **Persistência Imutável:**
   - Gravado em `video_asset_scenes` vinculado ao `file_hash` e `asset_id`. Nunca é reprocessado se o hash não mudar.

### 5.2. Subsistema de Entendimento de Fotos
As fotos do CRM do imóvel são analisadas uma única vez:
- VLM processa as URLs das fotos gerando tags semânticas (`room_type`, `wide_angle`, `aesthetic_score`).
- Se o imóvel possuir 15 fotos, o sistema seleciona as top fotos por ambiente, eliminando fotos de baixa qualidade ou repetidas (ex: 3 ângulos quase idênticos do mesmo vaso sanitário).

### 5.3. Subsistema de Roteiro e Alinhamento Temporal (Script & Timing Engine)
Hoje os roteiros gerados em `job_service.js` já possuem estrutura textual dividida em Ganchos e Corpo.
O avanço consiste em:
1. **Geração do Áudio/Vídeo do Apresentador na HeyGen.**
2. **Extração de Word Timestamps:**
   - A resposta de áudio é transcrita com timestamps de alta precisão via Whisper (`word_timestamps: true`).
3. **Decupagem em Semantic Beats:**
   - O texto falado é mapeado em segmentos de intenção:
     - **Beat 1 (Hook / Preço):** `0.0s – 2.6s` -> *"Esse apartamento completo por apenas 480 mil?"* -> Intenção: `hook_financial_shock`.
     - **Beat 2 (Ambiente Principal / Varanda):** `2.6s – 6.1s` -> *"Conta com uma varanda gourmet com vista livre definitiva..."* -> Intenção: `feature_balcony`.
     - **Beat 3 (Espaço Interno / Metragem):** `6.1s – 9.8s` -> *"são 85 metros quadrados muito bem distribuídos..."* -> Intenção: `feature_living_and_area`.
     - **Beat 4 (Call to Action):** `9.8s – 12.5s` -> *"Clique em Saiba Mais e agende sua visita hoje mesmo!"* -> Intenção: `cta_conversion`.

### 5.4. Creative Director Engine (O Cérebro Editorial)
O Creative Director atua como o editor profissional sênior:
1. **Regra de Correspondência Semântica:**
   - Quando o áudio menciona `varanda`, o Director busca no catálogo de mídias o asset/cena com maior score para `balcony`. Se houver vídeo com `balcony` e `quality >= 0.85`, prioriza o vídeo; caso contrário, seleciona a melhor foto com Ken Burns.
2. **Regra de Atenção e Ritmo (Pacing):**
   - **Hook (primeiros 3s):** Apresentador em tela cheia nos primeiros 1.0s para conexão humana, ou corte rápido de fachada/varanda com badge de preço impactante (`punch_zoom`).
   - **Body (Desenvolvimento):** O apresentador vai para PIP (`bottom_right`) com áudio e lip-sync preservados, enquanto o B-roll de alta qualidade do imóvel ocupa o fundo em tela cheia.
   - **Duração de cada take:** Entre 1.8s e 3.2s por take de B-roll (evita vídeos estáticos e monótonos).
3. **Regra de Hierarquia de Informação:**
   - Ao citar valor financeiro -> renderiza `price_badge` no topo ou centro.
   - Ao citar bairro/condomínio -> renderiza `location_tag`.
   - Ao citar metragem -> renderiza badge descritivo.
   - No final -> renderiza `cta_banner` de alta conversão.
4. **Respeito ao Editing Style Preset:**
   - `performance_reels_v1`: Cortes rápidos (~2.0s), overlays contrastantes, punch zoom.
   - `clean_modern_v1`: Takes mais contemplativos (~3.5s), tipografia minimalista, transições suaves.

---

## 6. MODELO DE DADOS CONCEITUAL (PROPOSTA SEM MIGRATIONS AGORA)

Para persistir essa inteligência sem quebrar nada do schema atual, as seguintes entidades conceituais são desenhadas:

### Tabela 1: `video_asset_scenes` (Cenas de Vídeos Reais)
```sql
CREATE TABLE IF NOT EXISTS video_asset_scenes (
  id VARCHAR(64) PRIMARY KEY,                   -- scn_pvid_<hash>_<index>
  asset_id VARCHAR(64) NOT NULL REFERENCES video_assets(id),
  property_ref VARCHAR(32) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,              -- Hash do vídeo original para validação
  scene_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  keyframe_path TEXT NOT NULL,
  room_type VARCHAR(64) NOT NULL,               -- 'living_room', 'kitchen', 'balcony', 'facade', etc.
  features JSONB DEFAULT '[]'::jsonb,           -- ['view_city', 'planned_cabinets']
  visual_quality_score NUMERIC(3,2) NOT NULL,   -- 0.00 a 1.00
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_scenes_ref_room ON video_asset_scenes(property_ref, room_type);
CREATE INDEX IF NOT EXISTS idx_asset_scenes_hash ON video_asset_scenes(file_hash);
```

### Tabela 2: `photo_asset_semantics` (Semântica das Fotos do CRM)
```sql
CREATE TABLE IF NOT EXISTS photo_asset_semantics (
  id VARCHAR(64) PRIMARY KEY,                   -- sem_pho_<ref>_<idx>
  property_ref VARCHAR(32) NOT NULL,
  photo_url TEXT NOT NULL,
  url_hash VARCHAR(64) NOT NULL,
  room_type VARCHAR(64) NOT NULL,
  features JSONB DEFAULT '[]'::jsonb,
  visual_quality_score NUMERIC(3,2) NOT NULL,
  is_wide_angle BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_semantics_ref ON photo_asset_semantics(property_ref);
```

### Tabela 3: `creative_direction_plans` (Decisão Editorial Gravada)
```sql
CREATE TABLE IF NOT EXISTS creative_direction_plans (
  id VARCHAR(64) PRIMARY KEY,                   -- cdp_<job_id>_<creative_id>
  job_id UUID NOT NULL REFERENCES video_jobs(id),
  creative_id VARCHAR(64) NOT NULL,
  style_id VARCHAR(64) NOT NULL,
  script_beats JSONB NOT NULL,
  visual_decisions JSONB NOT NULL,
  generated_blueprint JSONB NOT NULL,           -- Snapshot do Blueprint 1.2 gerado
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

> [!NOTE]
> Estas tabelas **NÃO** devem ser criadas agora. Elas representam a especificação formal de schema para a fase de implementação.

---

## 7. FASES INCREMENTAIS DE IMPLEMENTAÇÃO

### Detalhamento das Fases:
- **Fase 4A — Media & Script Understanding (Infraestrutura de Dados Semânticos):**
  - Implementar o extrator de cenas local via FFmpeg.
  - Implementar o conector VLM para classificar keyframes e fotos, salvando em cache no PostgreSQL.
  - Implementar a extração de timestamps palavra por palavra do áudio do apresentador.
- **Fase 4B — Creative Director Engine (O Motor Editorial):**
  - Construir o serviço de regras e matching (`creative_director_service.js`).
  - Casar beats de áudio com as melhores cenas e fotos.
  - Gerar e validar o payload de `Blueprint 1.2` pronto para o Composer.
- **Fase 4C — Integração com Pipeline de Produção & Showcase:**
  - Plugar no `job_service.js` para que `initializeVideoJob` gere automaticamente Blueprints 1.2 inteligentes.
  - Renderizar o showcase com a REF 1628 comparando o vídeo antigo (1/10) com o novo vídeo dirigido (10/10).

---

## 8. MENOR MVP RECOMENDADO (PROVA DE VALOR DE ALTO IMPACTO)

Para validar a hipótese imediatamente sem construir um monolito complexo de uma só vez:

### A Hipótese do MVP
> *"Se o sistema segmentar o áudio do apresentador em 3-4 frases chave e exibir exatamente a cena de vídeo correspondente àquele cômodo/tema com timing exato, a percepção de qualidade do anúncio salta de 1/10 para 9/10 instantaneamente."*

### Escopo do MVP (Fase 4A MVP):
1. **Imóvel de Teste Canônico:** REF `1628` (onde já possuímos o vídeo de 47s homologado e o apresentador HeyGen renderizado).
2. **Entendimento de Mídia:**
   - Segmentar o vídeo da REF 1628 em 6 cenas (Fachada, Sala de Estar, Cozinha, Varanda, Suíte, Banheiro) com seus respectivos timestamps `source_in_ms` / `source_out_ms`.
   - Rotular com tags semânticas básicas (`room_type`, `quality_score`).
3. **Alinhamento de Roteiro:**
   - Segmentar o roteiro da REF 1628 em 4 beats com início e fim em milissegundos.
4. **Geração do Blueprint 1.2 Inteligente:**
   - Montar o Blueprint com:
     - 0s a 2.5s: Gancho com apresentador fullscreen + Preço badge com punch zoom.
     - 2.5s a 5.5s: B-roll do vídeo do imóvel (Varanda) + Apresentador em PIP no canto inferior direito.
     - 5.5s a 8.5s: B-roll do vídeo do imóvel (Sala / Cozinha) + Apresentador em PIP.
     - 8.5s a 11.5s: B-roll da Suíte / Fachada + Overlay de CTA *"Saiba Mais"*.
5. **Execução:** Renderizar via Composer V3 existente e comparar lado a lado com o vídeo anterior.

---

## 9. RISCOS TÉCNICOS & MITIGAÇÕES

| Risco Técnico | Severidade | Mitigação Arquitetural |
|---|---|---|
| **Custo/Latência de Chamadas VLM** | Média | **Cache Imutável por `file_hash`:** Cada foto ou cena é analisada exatamente uma vez. Ao gerar 10 variantes de anúncios para o mesmo imóvel, o custo de VLM é ZERO. |
| **Alucinação do VLM (ex: classificar banheiro como cozinha)** | Média | Prompt engineering com JSON schema estrito, lista fechada de enums de cômodos (`room_type`) e fallback para o título/descrição do CRM. |
| **Áudio com Ruído ou Falha no Whisper** | Baixa | O áudio da HeyGen é gerado por TTS digital puro (Marcel Clone), com sinal 100% limpo e clareza perfeita, gerando precisão de transcrição próxima de 100%. |
| **Colisão de Safe Areas (PIP cobrindo Legenda)** | Alta | O Composer V3 já possui o validador `validateSpatiotemporalCollisions` que detecta e rejeita colisões antes do FFmpeg rodar. |
| **Falta de Cena Específica no Vídeo do Imóvel** | Baixa | **Fallback Cascata:** Se o áudio falar de *"piscina"* e o vídeo do CRM não tiver piscina, o Director busca nas fotos; se não houver foto, utiliza o apresentador em tela cheia com badge descritivo. |

---

## 10. CRITÉRIOS OBJETIVOS DE SUCESSO

1. **Sincronismo Semântico Perfeito:** 100% dos trechos em que um ambiente específico é citado coincidem temporalmente com a exibição visual daquele ambiente.
2. **Lip-Sync Intacto no PIP:** Durante a exibição dos B-rolls com apresentador em PIP, a sincronia labial e o áudio da narração permanecem perfeitamente alinhados (`source_in_ms = start_ms`).
3. **Zero Regressão no Composer:** 100% de compatibilidade com os contratos de Blueprint 1.0, 1.1 e 1.2.
4. **Idempotência e Performance:** Segunda geração de anúncio para o mesmo imóvel executa sem nenhuma chamada de IA de visão (reaproveitamento total de cache).
5. **Aprovação Visual:** O vídeo gerado deixa de parecer um "slideshow genérico" e passa a ter a dinâmica de um anúncio de alta conversão do Instagram/TikTok Reels.

---

## 11. STATUS DO ENTREGÁVEL

- [x] Diagnóstico detalhado do código atual respondido item por item com evidências reais.
- [x] Gaps e bloqueadores técnicos identificados.
- [x] Arquitetura em 5 camadas definida e desacoplada.
- [x] Separação estrita entre IA de Entendimento, Regras Editoriais e Composer Determinístico.
- [x] Estratégia de cache e persistência imutável desenhada.
- [x] Definição de fases e especificação do MVP de alto impacto.
- [x] Documento commitado exclusivamente em `docs/` sem alterações em código de produção ou migrations.

**STATUS:** `CREATIVE DIRECTOR / SEMANTIC EDITING — PLANO DE ARQUITETURA PRONTO PARA REVISÃO EXTERNA.`
