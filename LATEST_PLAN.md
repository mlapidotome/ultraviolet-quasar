# Arquitetura e Plano de Implementação — Fase 3A
## Asset Model & Creative Blueprint Foundation (Video Engine V2)

**Status:** Proposta de Planejamento Arquitetural (PLAN ONLY)  
**Data:** 05/09/2026  
**Repositório:** `mlapidotome/facade-checker` (`main`)  
**Commit Base Homologado (Fase 2C):** `6837749827104faf6ae198da0b77d055e0ec6e5f`  
**Escopo:** Definição da fundação de dados e abstração para Assets e Blueprints Criativos, sem implementação de código produtivo nesta etapa.

---

## 1. Diagnóstico da Arquitetura Atual (Fases 2A, 2B e 2C)

Nas Fases 2A, 2B e 2C, o ciclo de vida do Job evoluiu para uma máquina de estados robusta e resiliente:
`SCRIPT_READY` → `PILOT_SUBMITTED` → `PILOT_RENDERING` → `PILOT_READY` → `REMAINDER_SUBMITTED` → `REMAINDER_RENDERING` → `CREATIVE_SET_READY`.

No entanto, a representação interna dos componentes do vídeo ainda reflete o modelo inicial de geração monolítica:

1. **Acoplamento Físico e Topológico ao Job:**
   - Os arquivos de mídia são gerados e salvos diretamente em `/var/www/bali-gestor/outputs/jobs/<job_id>/` com nomes fixos (`hook_1.mp4`, `hook_2.mp4`, `hook_3.mp4`, `body.mp4`, `pilot.mp4`, `video_2.mp4`, `video_3.mp4`).
   - Não existe registro independente que permita dizer: *"O imóvel ref 1639 possui um clip de corpo renderizado com o Avatar Look X que pode ser reaproveitado em outro Job ou por outro corretor"*.

2. **Conflito entre Conceito Lógico e Arquivo Físico:**
   - Em `scripts_snapshot`, um "Gancho" é uma string de copy associada a um ID de avatar da HeyGen.
   - Em `metadata.pilot.hook1`, esse mesmo gancho é representado por um `heygen_video_id`, uma URL temporária da CDN da HeyGen e um caminho local `local_path`.
   - Se o arquivo físico for corrompido ou precisar ser reprocessado com outro bitrate, o conceito do roteiro se confunde com o artefato de mídia gerado.

3. **Mídias do Imóvel Transientes:**
   - As fotos e vídeos do imóvel vêm em `property_snapshot.fotos` como URLs de CDN do CRM (ImobTotal).
   - Não há validação de resolução, proporção (1080x1920 para 9:16), integridade ou armazenamento local desses assets.

4. **Composição Hardcoded no Código:**
   - A montagem dos vídeos 1, 2 e 3 está programada proceduralmente no `pilot_service.js` via chamadas imperativas ao FFmpeg (`concatWithFfmpeg(hook, body, output)`).
   - Não existe um "contrato declarativo" (Blueprint) que descreva como o vídeo é estruturado. Sem isso, a introdução futura de B-roll, trilha sonora, legendas dinâmicas, enquadramentos e novos formatos exigiria modificar o núcleo do `pilot_service.js` para cada nova regra de edição.

---

## 2. Conceitos Centrais da Fase 3A

Para transformar a Video Engine em uma plataforma escalável de geração de criativos sem comprometer as fases anteriores, estabelecemos 8 pilares:

### 2.1 Representação Explícita de Assets
Um **Asset** deixa de ser apenas uma propriedade aninhada em um JSON de Job ou um arquivo solto no disco. Ele passa a ser uma entidade catalogada com:
- Tipo explícito (`hook_clip`, `body_clip`, `property_photo`, `property_video`, `avatar_look`, `audio_voice`, `cta_clip`, `bg_music`);
- Especificações técnicas inspecionadas (`width`, `height`, `duration`, `fps`, `codec`, `audio_channels`, `file_size`);
- Hash criptográfico/lógico de integridade (`content_hash`);
- Ciclo de vida próprio (`pending`, `ready`, `failed`).

### 2.2 Distinção entre Conceito Lógico e Arquivo Físico
- **Asset Lógico (Definição):** A intenção criativa (ex: Roteiro do Gancho 1 + Look Executivo + Voz Marcel).
- **Asset Físico (Artefato):** O arquivo de vídeo MP4 baixado, inspecionado via `ffprobe` e armazenado no disco local ou S3/storage.
- Um asset lógico pode dar origem a múltiplos artefatos físicos (ex: resolução 1080x1920 para Stories/Reels e 1080x1080 para Feed) sem perder sua identidade semântica.

### 2.3 Identidade Estável (Asset URNs / IDs)
Para garantir referenciamento inequívoco, todo asset recebe um identificador determinístico e estável:
- Padrão: `ast_<tipo>_<hash_curto_ou_uuid>` (ex: `ast_hk_e3b0c442`, `ast_bd_8b2cf780`, `ast_img_1639_01`).
- Permite que qualquer componente do sistema cite o asset sem depender do caminho absoluto do filesystem.

### 2.4 Proveniência, Versionamento, Status e Vínculo com o Job
Todo asset registra:
- `origin_job_id`: Qual Job produziu originalmente este asset (se gerado por pipeline);
- `property_ref`: Referência do imóvel (permitindo busca de acervo por imóvel);
- `version`: Versão do artefato (permite atualizar um asset sem deletar o histórico);
- `status`: `pending`, `ready`, `failed`, `archived`;
- `metadata`: Provedor de origem (ex: `heygen_video_id`, `crm_media_url`, `elevenlabs_id`).

### 2.5 Reutilização Segura de Assets (Idempotência e Deduplicação)
- Se um Job B solicitar a geração de um corpo de vídeo idêntico (mesmo texto, mesmo avatar, mesma voz) para o mesmo imóvel que já foi gerado com sucesso no Job A, o sistema localiza o asset existente via `content_hash`, valida sua integridade física (`validateStrongBody`) e o referencia diretamente, com **custo zero de HeyGen** e **tempo zero de renderização**.

### 2.6 O Conceito de `Creative ID`
Um **Creative ID** (`crv_<job_id>_<variante>`) identifica um criativo final único e testável:
- Cada Job produz 3 criativos distintos:
  - Criativo 1: Gancho 1 + Corpo + Look 1
  - Criativo 2: Gancho 2 + Corpo + Look 2
  - Criativo 3: Gancho 3 + Corpo + Look 3
- No futuro, o `Creative ID` será a chave de correlação com o Meta Ads (Facebook Ads API) para identificar qual criativo gerou menor CPL (Custo por Lead) e maior taxa de retenção.

### 2.7 O `Creative Blueprint` Declarativo
O Blueprint é uma receita JSON declarativa que descreve a composição completa do vídeo antes de sua montagem física. O Blueprint não executa FFmpeg; ele declara:
- Qual o formato e dimensões;
- Quais assets compõem a receita (IDs dos ganchos, corpos, imagens, áudios);
- As diretrizes de edição (estilo de transição, legendas, volume relativo da fala e música);
- A linha do tempo conceitual (timeline de segmentos).

### 2.8 Determinismo para o Futuro Video Composer
Com o Blueprint, o futuro Video Composer (Fase 3B) opera como uma função pura:
$$\text{Video Composer}(\text{Creative Blueprint}, \text{Asset Resolver}) \longrightarrow \text{Final Rendered MP4}$$
Isso elimina qualquer lógica arbitrária de montagem espalhada pelo código.

---

## 3. Decisão Arquitetural de Armazenamento

Avaliamos profundamente as três alternativas técnicas para suportar a Fase 3A:

| Critério | Opção A: Pure JSONB em `video_jobs` | Opção B: Hiper-Normalização Relacional (5+ Tabelas) | Opção C (Recomendada): Abordagem Híbrida Pragmática |
| :--- | :--- | :--- | :--- |
| **Consistência** | Fraca (assets duplicados entre jobs sem integridade referencial) | Máxima (constraints FK rígidas) | Forte (tabela de assets com hash único + blueprints declarativos) |
| **Versionamento** | Difícil (histórico aninhado cresce desordenadamente no JSON) | Alto custo (múltiplas linhas de junção em cascata) | Excelente (assets imutáveis com versão + blueprint imutável versionado) |
| **Retries / Resume** | Já funciona, mas baseado em caminhos físicos soltos | Alto risco de locks e complexidade transacional | Perfeito (Smart Retry consulta status e integridade do asset) |
| **Reutilização Cross-Job** | Muito difícil (exige varredura sequencial em JSONB) | Suportada | Imediata (`SELECT FROM video_assets WHERE content_hash = ...`) |
| **Consultas Futuras** | Lentas e complexas para catálogos e BI | Otimizadas para SQL analítico | Otimizadas (assets indexados em B-Tree; blueprint flexível) |
| **Migração de Jobs Legados** | Zero impacto imediato, mas dívida técnica acumulada | Complexa e arriscada para jobs em produção | Segura e retrocompatível (backfill transparente) |
| **Custo de Implementação** | Baixo | Excessivamente Alto (Overengineering) | Enxuto, modular e progressivo |

### Decisão Arquitetural Justificada:
Adotamos a **Opção C: Abordagem Híbrida Pragmática**.
1. **Criamos uma tabela dedicada `video_assets`:**  
   Garante que todo arquivo físico ou recurso externo (clip da HeyGen, foto do CRM, áudio, etc.) possua identidade primária, status, caminho físico canônico, especificações inspecionadas e fingerprint (`content_hash`).
2. **Mantemos o `Creative Blueprint` declarativo em JSONB:**  
   Armazenado em uma nova coluna `creative_blueprints JSONB` (ou em `metadata.blueprints`) na tabela `video_jobs`.
   - *Por que não normalizar a timeline e as camadas em tabelas relacionais?* Porque a estrutura de uma timeline de edição de vídeo (keyframes, efeitos, camadas de b-roll, legendas, cortes) varia rapidamente conforme o Video Composer evolui. Normalizar isso em dezenas de tabelas relacionais geraria migrações contínuas de schema. O JSONB é o padrão da indústria para representação de grafos de composição de mídia (ex: schemas Remotion, OpenTimelineIO, After Effects).

---

## 4. Especificação Técnica do Modelo Proposto

### 4.1 DDL da Tabela `video_assets`

```sql
-- migrations/004_create_video_assets.sql
-- Fase 3A: Fundação do Catálogo e Modelo de Assets

CREATE TABLE IF NOT EXISTS video_assets (
    id VARCHAR(64) PRIMARY KEY, -- ex: ast_hk_e3b0c442, ast_bd_8b2cf780, ast_img_1639_01
    job_id UUID REFERENCES video_jobs(id) ON DELETE SET NULL, -- Job de origem (se houver)
    property_ref VARCHAR(32), -- Permite catálogo e reuso por imóvel
    asset_type VARCHAR(32) NOT NULL, -- 'hook_clip', 'body_clip', 'property_photo', 'property_video', 'audio_speech', 'bg_music', 'cta_clip'
    storage_type VARCHAR(32) NOT NULL DEFAULT 'local_file', -- 'local_file', 'external_cdn', 'provider_ref'
    storage_path TEXT NOT NULL, -- Caminho canônico absoluto no VPS ou URL remota
    content_hash VARCHAR(64), -- SHA-256 do arquivo ou hash semântico do roteiro+look (deduplicação)
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- 'pending', 'ready', 'failed', 'archived'
    specs JSONB NOT NULL DEFAULT '{}'::jsonb, -- { duration, width, height, fps, codec, audio_channels, file_size }
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb, -- { provider: 'heygen', heygen_video_id, text, look_id, voice_id, etc. }
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Índices para busca rápida, integridade e deduplicação
CREATE INDEX IF NOT EXISTS idx_video_assets_type_status ON video_assets (asset_type, status);
CREATE INDEX IF NOT EXISTS idx_video_assets_property ON video_assets (property_ref);
CREATE INDEX IF NOT EXISTS idx_video_assets_job_id ON video_assets (job_id);
CREATE INDEX IF NOT EXISTS idx_video_assets_hash ON video_assets (content_hash) WHERE content_hash IS NOT NULL;
```

### 4.2 Especificação do Schema: `Creative Blueprint`

Cada Job conterá em seu blueprint a especificação dos 3 criativos. Abaixo a estrutura formal de um Criativo:

```json
{
  "schema_version": "1.0",
  "creative_id": "crv_bbddf3ba_v1",
  "job_id": "bbddf3ba-f7c6-44f5-a81a-2ac09dae611b",
  "property_ref": "1639",
  "name": "Criativo 1 — Choque / Entrada",
  "format": {
    "aspect_ratio": "9:16",
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "components": {
    "hook": {
      "asset_id": "ast_hk_1_bbddf3ba",
      "index": 1,
      "type": "talking_head",
      "look": {
        "id": "a2cfb3ad10054e6f87c5ce6ca8ab483b",
        "name": "Terno Executivo Escuro"
      },
      "script_text": "300 mil reais num imóvel completo no Centro com entrada de apenas 60 mil reais?..."
    },
    "body": {
      "asset_id": "ast_bd_bbddf3ba",
      "type": "talking_head",
      "reused_from_asset_id": null,
      "look": {
        "id": "a2cfb3ad10054e6f87c5ce6ca8ab483b",
        "name": "Terno Executivo"
      },
      "script_text": "Estamos falando de uma oportunidade com 65 metros quadrados..."
    },
    "property_assets": [
      {
        "asset_id": "ast_img_1639_01",
        "role": "facade",
        "display_mode": "pan_zoom"
      }
    ],
    "cta": {
      "asset_id": "ast_cta_default",
      "type": "button_overlay",
      "label": "Saiba Mais",
      "action_url": "https://wa.me/554899999999"
    },
    "editing_style": {
      "style_id": "style_direct_cut_v1",
      "caption_preset": "bold_yellow_highlight",
      "transitions": {
        "hook_to_body": "cut"
      },
      "audio_mix": {
        "speech_gain_db": 0,
        "bg_music_gain_db": -22,
        "ducking": true
      }
    }
  },
  "timeline": [
    {
      "segment_index": 1,
      "role": "hook",
      "asset_id": "ast_hk_1_bbddf3ba",
      "source_in_ms": 0,
      "source_out_ms": 9450,
      "timeline_start_ms": 0,
      "timeline_end_ms": 9450,
      "layer": 0
    },
    {
      "segment_index": 2,
      "role": "body",
      "asset_id": "ast_bd_bbddf3ba",
      "source_in_ms": 0,
      "source_out_ms": 28750,
      "timeline_start_ms": 9450,
      "timeline_end_ms": 38200,
      "layer": 0
    }
  ],
  "output": {
    "rendered_asset_id": "ast_fin_pilot_bbddf3ba",
    "filename": "pilot.mp4",
    "status": "ready"
  }
}
```

---

## 5. Garantia de Retrocompatibilidade Total

A introdução do Asset Model e Creative Blueprint é concebida para ser **100% aditiva e não-bloqueante**:

1. **Camada de Adaptação (Asset Adapter / Resolver):**
   - Os módulos `pilot_service.js`, `api_v2.js` e `video-painel.html` continuam consumindo suas rotas e payloads habituais.
   - O `pilot_service.js` ganha um adaptador silencioso: ao gerar `hook_1.mp4`, `body.mp4`, etc., além de gravar em `metadata.pilot` e `metadata.remainder`, ele também registra o asset correspondente em `video_assets`.
   - O `job_service.js`, ao criar o Job em `SCRIPT_READY`, gera os Blueprints iniciais em `video_jobs.metadata.blueprints` ou na coluna `creative_blueprints`.

2. **Preservação de Jobs Legados e Showcase:**
   - O Job de homologação atual (`bbddf3ba-...`) e todos os jobs anteriores continuam válidos e acessíveis através de `pilot_video_url`, `video2_url`, `video3_url`.
   - Um script de backfill sob demanda poderá analisar a pasta física `outputs/jobs/<job_id>/` de jobs passados e popular `video_assets` retroativamente sem alterar o `status` ou re-renderizar nada.

3. **Inviolabilidade dos Pilares de Segurança e WhatsApp:**
   - As validações estritas anti-symlink (`fs.realpathSync()`), anti-path-traversal e integridade de streams via `ffprobe` permanecem ativas na camada de ingestão de assets.
   - O adaptador legado do WhatsApp (`video_anuncios_engine.js`) permanece intocado e operando em paralelo.
   - O bloqueio HTTP 403 estático em `/outputs/jobs` continua rigorosamente preservado.

---

## 6. Roadmap Estratégico Pós-Fase 3A

Com a fundação de Assets e Blueprints estabelecida na 3A, a evolução da Video Engine seguirá a seguinte trajetória modular:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3A (Fundação): Asset Model + Creative Blueprint                   │
│ - Tabela video_assets, catálogo de mídia, fingerprints e contratos JSON│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3B: Video Composer MVP (Timeline Engine)                          │
│ - Renderizador determinístico FFmpeg orientado a Blueprint             │
│ - Substituição do concat hardcoded por montagem orientada a timeline   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3C: Editing Styles & Dynamic Overlays                             │
│ - B-roll inteligente (fotos do imóvel inseridas sobre o áudio do body) │
│ - Legendas dinâmicas com highlight de palavras e trilha com ducking    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3D: Reference Library & Video DNA                                 │
│ - Decomposição de anúncios imobiliários campeões em blueprints modelos │
│ - Aplicação de fórmulas comprovadas de retenção nos roteiros do Marcel │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3E: Creative Variations & Multi-Armed Combinatorics               │
│ - Geração de N variações de criativos combinando Assets existentes     │
│ - Zero custo de HeyGen ao recombinar Hooks e Corpos já sintetizados    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Fase 3F: Creative IDs & Meta Ads Learning Loop                         │
│ - Integração com Meta Marketing API vinculando Creative ID ao adset    │
│ - Retroalimentação: scripts futuros priorizam ganchos com menor CPA    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Principais Riscos Identificados e Mitigações

1. **Risco de Dessincronização entre `metadata` Legado e a Tabela `video_assets`:**
   - *Mitigação:* Implementar um padrão **Single Point of Registration** na camada de serviço (`asset_service.js`). Nenhuma função salva arquivo no disco sem registrar no catálogo de assets na mesma transação lógica.
2. **Risco de Degradação de Performance por Inspecionar Mídias (`ffprobe` overhead):**
   - *Mitigação:* `ffprobe` é executado estritamente **uma única vez** no momento da conclusão do download do clip. O resultado é cacheado no campo `specs` da tabela `video_assets`, tornando leituras subsequentes instantâneas (apenas consulta SQL).
3. **Risco de Invalidação de Cache ou Alteração de Arquivo no Disco:**
   - *Mitigação:* O `content_hash` (SHA-256) e o tamanho do arquivo garantem que se um arquivo físico for modificado externamente, a camada de validação detecta a divergência e impede seu reuso silencioso.
4. **Risco de Aumento de Complexidade no Painel Web:**
   - *Mitigação:* Na Fase 3A, a interface do usuário (`video-painel.html`) permanece idêntica visualmente, com os mesmos 3 players de vídeo. A complexidade do Blueprint opera exclusivamente no backend.

---

## 8. Conclusão e Próximos Passos

A Fase 3A estabelece a separação clara entre **o que deve ser produzido** (Blueprint) e **os recursos necessários** (Assets), transformando a Video Engine V2 de um gerador sequencial de vídeos em um ecossistema componível de ativos digitais.

> [!IMPORTANT]
> **Status da Entrega:** Este documento representa exclusivamente o planejamento arquitetural da Fase 3A. Nenhuma alteração de código produtivo, migration ou reinicialização de processos foi executada no VPS.
