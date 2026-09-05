# Arquitetura e Plano de Implementação Revisado — Fase 3A
## Asset Model & Creative Blueprint Foundation (Video Engine V2)

**Status:** Planejamento Arquitetural Revisado (PLAN ONLY)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 2C):** `6837749827104faf6ae198da0b77d055e0ec6e5f`  
**Escopo:** Definição formal, rigorosa e aditiva do Asset Model e Creative Blueprint, sem implementação de código, migrations ou deploy nesta etapa.

---

## 1. Visão Geral e Princípios Fundamentais

A Fase 3A estabelece a fundação arquitetural para transformar a Video Engine de um gerador procedural de arquivos MP4 em uma plataforma componível de ativos digitais.

A revisão arquitetural aprovou formalmente os pilares da Fase 3A:
- Abordagem Híbrida Pragmática (Tabela relacional `video_assets` + coluna `creative_blueprints JSONB`);
- Distinção estrita entre conceito lógico e artefato físico;
- Resolução dinâmica via Asset Resolver;
- Preservação de 100% da homologação das Fases 2A, 2B e 2C.

Este plano consolidado incorpora os 10 refinamentos técnicos mandatórios exigidos na revisão externa.

---

## 2. Decisões Arquiteturais e Refinamentos Técnicos

### 2.1 Separação entre Hash Físico (`file_hash`) e Identidade Semântica (`generation_key`)

O modelo anterior utilizava um `content_hash` ambíguo. A arquitetura agora separa formalmente esses dois conceitos em duas colunas independentes:

1. **`file_hash` (Integridade Física dos Bytes):**
   - **O que é:** Hash SHA-256 calculado diretamente sobre os bytes do arquivo materializado no disco local.
   - **Propósito:** Validação de integridade física, detecção de corrupção de mídia, garantia contra adulteração externa e verificação anti-tampering.
   - **Disponibilidade:** Preenchido obrigatoriamente quando o asset atinge o status `ready` (materializado e validado no filesystem). É `NULL` enquanto o asset estiver pendente ou existindo apenas no provedor remoto.

2. **`generation_key` (Identidade Semântica / Receita de Geração):**
   - **O que é:** Hash determinístico (SHA-256 em base16) calculado sobre o JSON canônico normalizado contendo todos os parâmetros que determinam o resultado visual/sonoro daquele asset.
   - **Propósito:** Deduplicação semântica, descoberta de assets candidatos para reuso futuro e idempotência lógica.
   - **Componentes da Receita (Payload Canônico Normalizado):**
     ```json
     {
       "asset_type": "body_clip",
       "provider": "heygen",
       "provider_model": "avatar_v2",
       "script_text_normalized": "estamos falando de uma oportunidade com 65 metros quadrados...",
       "avatar_look_id": "a2cfb3ad10054e6f87c5ce6ca8ab483b",
       "voice_id": "dccd1a85e6b1450facf9ec953b648df2",
       "output_format": { "aspect_ratio": "9:16", "width": 1080, "height": 1920, "fps": 30 },
       "generation_params": { "background": "blur_studio", "speed": 1.0 }
     }
     ```
   - **Invariante:** `file_hash` NUNCA é usado como chave semântica. Dois assets gerados em execuções diferentes da HeyGen podem gerar hashes de bytes ligeiramente distintos (devido a encoders/timestamps internos da HeyGen), mas compartilham rigorosamente a mesma `generation_key`.

---

### 2.2 Política de Não-Ativação de Reuso Cross-Job Automático na 3A

A Fase 3A introduz o conceito de `generation_key` para **capacidade de descoberta**, mas **NÃO ativa a substituição automática de assets entre Jobs diferentes**.

- **Regra de Isolamento na 3A:**
  - Cada Job continua gerando e utilizando estritamente seus próprios assets em `outputs/jobs/<job_id>/`.
  - O `body.mp4` reutilizado na Fase 2C para os Vídeos 2 e 3 continua sendo estritamente o Body canônico físico daquele respectivo `job_id`, conforme validado por `validateStrongBody()`.
  - Nenhuma chamada à HeyGen será economizada silenciosamente por substituição de assets de outros jobs nesta fase.
- **Justificativa:** A ativação de reuso cross-job exige regras de governança adicionais (ex: expiração de mídia, isolamento por corretor/cliente, políticas de purge e permissões), que serão objeto de uma fase posterior dedicada.

---

### 2.3 Lifecycle de Storage e Tratamento de Estados sem Arquivo Físico

No modelo anterior, `storage_path TEXT NOT NULL` forçava caminhos artificiais para assets ainda não baixados. O ciclo de vida foi corrigido:

```
[Definição Lógica / Intenção] 
         │  status = 'pending', storage_path = NULL, provider_ref = NULL
         ▼
[Submissão ao Provedor (ex: HeyGen / CRM)]
         │  status = 'processing', storage_path = NULL, provider_ref = 'heygen_vid_xyz'
         ▼
[Conclusão no Provedor Remoto]
         │  status = 'remote_ready', storage_path = NULL, remote_url = 'https://...'
         ▼
[Download + Inspecção Local ffprobe + Hash]
         │  status = 'ready', storage_path = '/var/www/.../body.mp4', file_hash = 'sha256...'
         ▼
[Erro em Qualquer Etapa]
            status = 'failed', error_message = '...', storage_path = NULL
```

- **Regras do Schema para Storage:**
  - `storage_path` é **`NULLABLE`**. Só é preenchido quando o arquivo está materializado e verificado no filesystem local.
  - `provider_ref` armazena o ID do recurso no provedor externo (ex: `video_id` na HeyGen, `media_id` no CRM).
  - `remote_url` armazena a URL temporária ou permanente de origem.
  - Um asset só atinge `status = 'ready'` após download completo, validação física, cálculo de `file_hash` e inspecção de streams via `ffprobe`.

---

### 2.4 Hierarquia e Fontes de Verdade (Authority Matrix)

Para impedir divergências e garantir que o pipeline legado nunca seja interrompido por falhas na camada de catalogação, definimos formalmente a autoridade de cada camada:

| Camada / Armazenamento | Papel / Autoridade | Comportamento em caso de divergência |
| :--- | :--- | :--- |
| **`scripts_snapshot`** | **Fonte de verdade textual original do Job.** Snapshot imutável gerado na criação do Job contendo os textos dos 3 ganchos, corpo e dados do imóvel. | Prevalece sobre qualquer texto contido em metadata para regeneração de roteiro. |
| **`video_jobs.status`** | **Fonte de verdade do ciclo de vida operacional.** Governa as transições atômicas de estado do Job. | O status do Job dita se o painel exibe botões de Aprovação, Download ou Erro. |
| **`metadata.pilot/remainder`** | **Compatibilidade operacional legada (Fases 2B/2C).** Mantido rigorosamente para permitir rollback e suportar o polling e Smart Retry/Resume existentes. | Mantido em paridade durante a Fase 3A. |
| **`video_assets`** | **Catálogo autoritativo dos assets de mídia.** Fonte canônica de especificações técnicas, hashes, proveniência e integridade física de cada arquivo. | Usado pelo Asset Resolver para localizar artefatos físicos. |
| **`creative_blueprints`** | **Fonte de verdade da composição do criativo.** Receita declarativa, imutável e versionada descrevendo como os assets se combinam em criativos finais. | Descreve a montagem; resolvido pelo Asset Resolver no momento da renderização. |
| **Filesystem local** | **Repositório físico de bytes.** Nunca é fonte de identidade lógica por si só. | Arquivos órfãos ou desconhecidos no disco são ignorados sem registro em `video_assets`. |

#### Isolamento de Falhas (Fail-Open / Non-Blocking na 3A)
Durante a Fase 3A, a catalogação de assets em `video_assets` e a geração do Blueprint ocorrem de forma **aditiva e não-bloqueante**. Se ocorrer qualquer falha secundária no registro de um asset no catálogo durante uma execução nominal da Fase 2C, o pipeline registrará o erro em log estruturado, mas **não interromperá o fluxo do Job**, garantindo que a entrega dos vídeos da Fase 2C continue com 100% de disponibilidade.

---

### 2.5 Armazenamento Definitivo do Blueprint: Coluna Dedicada `creative_blueprints JSONB`

Optamos definitivamente pela adição da coluna explícita:
```sql
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS creative_blueprints JSONB DEFAULT '[]'::jsonb;
```

**Justificativa Técnica da Decisão:**
1. **Separação de Preocupações (Separation of Concerns):** A coluna `metadata` é um scratchpad operacional de execuções, contendo contadores de retry, timestamps de transição e dados do cliente HTTP. O Blueprint é o contrato estrutural do produto final (os 3 criativos). Misturá-los geraria poluição e dificultaria queries.
2. **Visibilidade e Indexação GIN:** Como coluna explícita de primeira classe, `creative_blueprints` pode receber índices GIN direcionados (ex: buscar todos os jobs que utilizam um determinado `creative_id` ou `asset_id`).
3. **Imutabilidade e Auditoria:** Permite atualizar o estado operacional em `metadata` sem reescrever ou parsear os blueprints de composição.

---

### 2.6 Especificação do Blueprint: Snapshot Imutável vs. Resolução de Referência

O Blueprint foi refinado para eliminar duplicações ambíguas. Ele diferencia claramente o que é **referência dinâmica**, o que é **snapshot deliberado** e o que é **exclusivo da composição**:

```json
{
  "schema_version": "1.0",
  "creative_id": "crv_bbddf3ba_v1",
  "job_id": "bbddf3ba-f7c6-44f5-a81a-2ac09dae611b",
  "blueprint_version": 1,
  "variant_index": 1,
  "name": "Criativo 1 — Choque / Entrada",
  "format": {
    "aspect_ratio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "recipe_snapshot": {
    "hook_text": "300 mil reais num imóvel completo...",
    "hook_look_id": "a2cfb3ad10054e6f87c5ce6ca8ab483b",
    "body_text": "Estamos falando de uma oportunidade...",
    "body_look_id": "a2cfb3ad10054e6f87c5ce6ca8ab483b",
    "voice_id": "dccd1a85e6b1450facf9ec953b648df2"
  },
  "resolved_assets": {
    "hook_asset_id": "ast_hk_bbddf3ba_01",
    "body_asset_id": "ast_bd_bbddf3ba_01"
  },
  "composition_directives": {
    "editing_style_id": "direct_cut_v1",
    "transitions": [
      { "from_segment": "hook", "to_segment": "body", "type": "cut" }
    ],
    "audio_mix": {
      "speech_gain_db": 0.0,
      "bg_music_gain_db": -22.0,
      "ducking_enabled": true
    }
  },
  "timeline": [
    {
      "segment_index": 1,
      "role": "hook",
      "asset_id": "ast_hk_bbddf3ba_01",
      "layer": 0,
      "timeline_start_ms": 0,
      "timeline_end_ms": 9450
    },
    {
      "segment_index": 2,
      "role": "body",
      "asset_id": "ast_bd_bbddf3ba_01",
      "layer": 0,
      "timeline_start_ms": 9450,
      "timeline_end_ms": 38200
    }
  ],
  "output_target": {
    "asset_id": "ast_out_pilot_bbddf3ba",
    "expected_filename": "pilot.mp4"
  }
}
```

- **Regra de Desduplicação:** O Blueprint **NÃO** duplica `storage_path`, `file_size`, `codecs`, `fps` reais ou `status` de renderização. Essas propriedades pertencem única e exclusivamente à tabela `video_assets` e são resolvidas em runtime pelo Asset Resolver.
- **O que é o `recipe_snapshot`:** Um registro estático dos parâmetros com que aquele Blueprint foi montado, garantindo auditabilidade histórica mesmo se o CRM ou os prompts originais mudarem no futuro.

---

### 2.7 Invariantes de Imutabilidade e Versionamento

1. **Imutabilidade de Assets `ready`:**
   - Uma linha em `video_assets` com `status = 'ready'` é estritamente **imutável**.
   - Se um arquivo precisar ser re-renderizado com correções de texto ou bitrate diferente, um **novo asset** é criado com novo ID (`ast_...`) e nova `generation_key`.
   - O registro anterior pode ser marcado como `archived`, mas nunca sobrescrito fisicamente.
2. **Imutabilidade de Blueprints:**
   - Um Blueprint associado a um Job finalizado é imutável.
   - Qualquer ajuste de composição (ex: mudança no estilo de corte, inclusão de nova trilha) resulta em uma nova versão (`blueprint_version = 2`) ou em um novo `creative_id`.
3. **Independência de Nomes Físicos:**
   - IDs lógicos (`asset_id`, `creative_id`) são baseados em hashes e identificadores opacos (URNs), nunca em strings de caminhos de arquivos ou pastas temporárias.

---

### 2.8 Política Rigorosa de Integridade Física de Mídia

Corrigimos a premissa de que a inspecção via `ffprobe` é executada uma única vez e para sempre confiada:

- **Cache de Especificações:** O campo `specs` JSONB em `video_assets` armazena o resultado da inspecção técnica inicial (`duration`, `width`, `height`, codecs).
- **Validação no Momento do Reuso / Montagem:** Antes de qualquer asset ser utilizado em uma composição ou servido por streaming:
  1. O Asset Resolver valida a existência física do arquivo (`fs.existsSync`);
  2. Valida contenção canônica contra symlinks externos (`fs.realpathSync`);
  3. Valida tamanho do arquivo (`fs.statSync().size > 0`);
  4. Se o arquivo sofrer qualquer suspeita de corrupção ou alteração na data de modificação (`mtime`), o `file_hash` é recalculado e comparado com a base.
  5. Se houver divergência, o asset é marcado como `failed` e rejeitado imediatamente.

---

### 2.9 Estrutura e Estabilidade do `Creative ID`

O `Creative ID` é estruturado para garantir rastreabilidade analítica de longo prazo:

$$\text{Creative ID} = \texttt{crv\_} + \langle \text{job\_id\_prefix} \rangle + \texttt{\_v} + \langle \text{variant\_index} \rangle + \texttt{\_b} + \langle \text{blueprint\_version} \rangle$$
*Exemplo:* `crv_bbddf3ba_v1_b1` (Criativo do Job `bbddf3ba`, Gancho 1, Versão de Blueprint 1).

Se no futuro o criativo for renderizado em múltiplos formatos (ex: 9:16 e 1:1), o artefato físico gerado apontará para um `rendered_asset_id` específico em `video_assets`, mantendo o `creative_id` como o identificador conceitual unificado.

---

## 3. Especificação do Schema DDL

```sql
-- migrations/004_create_video_assets_and_blueprints.sql
-- Fase 3A: Asset Model e Creative Blueprint Foundation

-- 1. Tabela do Catálogo de Assets
CREATE TABLE IF NOT EXISTS video_assets (
    id VARCHAR(64) PRIMARY KEY, -- ex: ast_hk_e3b0c442, ast_bd_8b2cf780
    job_id UUID REFERENCES video_jobs(id) ON DELETE SET NULL,
    property_ref VARCHAR(32),
    asset_type VARCHAR(32) NOT NULL, -- 'hook_clip', 'body_clip', 'property_photo', 'property_video', 'rendered_creative', etc.
    storage_type VARCHAR(32) NOT NULL DEFAULT 'local_file', -- 'local_file', 'external_cdn', 'provider_ref'
    storage_path TEXT, -- NULL até que o arquivo seja baixado e validado localmente
    provider_ref VARCHAR(128), -- ID no provedor externo (ex: HeyGen video_id)
    remote_url TEXT, -- URL temporária ou externa de download
    file_hash VARCHAR(64), -- SHA-256 dos bytes reais no disco (preenchido quando ready)
    generation_key VARCHAR(64) NOT NULL, -- SHA-256 da receita determinística normalizada
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'remote_ready', 'ready', 'failed', 'archived'
    specs JSONB NOT NULL DEFAULT '{}'::jsonb, -- { duration, width, height, fps, codec, audio_channels, file_size }
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- Parâmetros de geração, logs e diagnósticos
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Coluna Explícita de Blueprints Criativos em video_jobs
ALTER TABLE video_jobs 
    ADD COLUMN IF NOT EXISTS creative_blueprints JSONB DEFAULT '[]'::jsonb;

-- 3. Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_video_assets_generation_key ON video_assets (generation_key);
CREATE INDEX IF NOT EXISTS idx_video_assets_file_hash ON video_assets (file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_assets_job_type ON video_assets (job_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_video_assets_property_type ON video_assets (property_ref, asset_type);
CREATE INDEX IF NOT EXISTS idx_video_assets_status ON video_assets (status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_blueprints ON video_jobs USING GIN (creative_blueprints);
```

---

## 4. Escopo Restrito da Implementação da Fase 3A

A implementação futura da Fase 3A será **estritamente aditiva** e focada na infraestrutura de dados:

### O que a Fase 3A FARÁ:
1. Executar a migration `004_create_video_assets_and_blueprints.sql`;
2. Criar o módulo `video_engine/asset_service.js` contendo:
   - Funções para cálculo de `generation_key` normalizada;
   - Funções para registro e transição de estado de assets (`createAsset`, `markAssetReady`, `markAssetFailed`);
   - Resolução de integridade física (`resolveAndValidateAsset`);
3. Instrumentar `job_service.js` para popular `creative_blueprints` ao criar o Job em `SCRIPT_READY`;
4. Instrumentar `pilot_service.js` para catalogar silenciosamente em `video_assets` os clips baixados da HeyGen (`hook_1`, `body`, `hook_2`, `hook_3`) e os vídeos finais gerados;
5. Validar a integridade retroativa através de script de teste sem interferir nos jobs em execução.

### O que a Fase 3A NÃO FARÁ:
- NÃO substituirá a concatenação FFmpeg atual pelo Video Composer;
- NÃO alterará o resultado visual ou a duração dos vídeos produzidos;
- NÃO ativará deduplicação automática cross-job;
- NÃO alterará as máquinas de estado ou endpoints da Fase 2A, 2B ou 2C;
- NÃO alterará o WhatsApp V1;
- NÃO implementará animações complexas, biblioteca de referências ou integração com Meta Ads.

---

## 5. Plano de Homologação Automatizada (Suíte de Verificação)

Para aprovação da implementação futura da Fase 3A, será exigida a aprovação de pelo menos 13 testes automatizados específicos:

1. **Não-regressão da Fase 2C:** O pipeline da Fase 2C gera os 3 vídeos nominais mantendo status `CREATIVE_SET_READY`.
2. **Registro de Assets:** Hooks 1, 2 e 3, Body e Vídeos Finais são catalogados em `video_assets`.
3. **Integridade de `file_hash`:** O `file_hash` gravado no banco corresponde com precisão ao SHA-256 lido fisicamente do arquivo no disco.
4. **Estabilidade de `generation_key`:** Duas chamadas com os mesmos parâmetros de receita produzem rigorosamente a mesma `generation_key`.
5. **Sensibilidade de `generation_key`:** Alteração de texto, look ou voz altera imediatamente a `generation_key`.
6. **Asset Pendente sem Path:** Um asset no estado `pending` é criado com sucesso com `storage_path = NULL`.
7. **Imutabilidade de Asset READY:** Tentativa de sobrescrita direta de um asset com status `ready` é rejeitada.
8. **Validade de Referências do Blueprint:** O Blueprint gerado referencia exclusivamente `asset_ids` válidos existentes no banco.
9. **Determinismo e Reprodutibilidade do Blueprint:** O Blueprint versionado pode ser lido e reproduzido identicamente.
10. **Tolerância a Jobs Legados:** Jobs criados antes da Fase 3A (com `creative_blueprints = []`) continuam sendo consultados e servidos normalmente sem erros.
11. **Acessibilidade do Showcase:** O Job showcase da Fase 2C (`bbddf3ba-...`) permanece 100% funcional no painel e na API de streaming.
12. **Garantia de Isolamento Cross-Job:** Provar que a criação de um novo Job com roteiro idêntico não substitui os assets físicos por outro job na Fase 3A.
13. **Isolamento do WhatsApp V1:** Nenhuma alteração afeta as rotas e funções do WhatsApp V1.

---

## 6. Roadmap Pós-Fase 3A

```
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3A (Fundação): Asset Model + Creative Blueprint                   │
│ - Tabela video_assets, coluna creative_blueprints, geração de chaves   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3B: Video Composer MVP (Timeline Engine)                          │
│ - Renderizador determinístico FFmpeg orientado a Blueprint             │
│ - Substituição do concat procedural por montagem orientada a timeline  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3C: Editing Styles & Overlays Dinâmicos                           │
│ - B-roll com fotos do imóvel sincronizadas sobre o áudio do body       │
│ - Legendas automáticas com destaque de palavras e ducking de trilha    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3D: Reutilização Cross-Job e Catálogo de Acervo                   │
│ - Ativação controlada de reuso de assets por generation_key            │
│ - Deduplicação real de custos da HeyGen entre corretores e campanhas   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3E: Creative Variations & Multi-Armed Combinatorics               │
│ - Geração combinatória de N variantes com custo de renderização mínimo │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3F: Creative IDs & Meta Ads Feedback Loop                         │
│ - Correlação de Creative IDs com métricas reais de anúncios e CPA      │
└────────────────────────────────────────────────────────────────────────┘
```

---

> [!IMPORTANT]
> **Status da Entrega:** Este plano consolida todas as exigências da revisão externa. O código de produção, o banco de dados e o VPS permanecem 100% inalterados.
