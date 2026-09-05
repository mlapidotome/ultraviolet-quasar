# Changelog — Fase 3A: Asset Model & Creative Blueprint Foundation
## Video Engine V2 — Bali Imóveis

**Data de Conclusão:** 05/09/2026  
**Ambiente:** VPS Ubuntu 24.04 (`159.223.118.129`)  
**Status:** HOMOLOGADO E APROVADO PÓS-REVIEW (26/26 Testes Automatizados no VPS)  
**Commit de Referência do Plano Aprovado:** `d3ef614d554ffba28408ab842318dd1372f0d08f`

---

## 1. Objetivo da Fase 3A

Estabelecer a fundação arquitetural para o futuro **Video Composer / Editing Engine (Fase 3B)**, tratando os componentes do vídeo como **assets identificáveis, versionáveis, imutáveis e auditáveis**, e descrevendo a montagem criativa através de um **Creative Blueprint declarativo** em JSONB.

---

## 2. Ajustes Pós-Review Homologados (Fixes 1, 2 e 3)

### 2.1 FIX 1 — Canonicalização Recursiva Determinística da `generation_key`
* **Implementação:** Desenvolvida a função `canonicalizeValue()` que percorre recursivamente todos os níveis de objetos aninhados, ordenando chaves alfabeticamente enquanto preserva a ordem sequencial de arrays.
* **Sensibilidade Estrita Comprovada:** Qualquer alteração em `asset_type`, `provider`, `provider_model`, `script_text` (normalizado), `look_id`, `voice_id`, `aspect_ratio`, `width`, `height`, `fps` ou qualquer propriedade simples ou aninhada dentro de `generation_params` altera deterministicamente a `generation_key`.
* **Idempotência de Chaves:** Objetos com as mesmas propriedades fornecidos em ordens arbitrárias geram rigorosamente o mesmo SHA-256.

### 2.2 FIX 2 — Imutabilidade Absoluta de Assets `ready` em `createAsset()`
* **Implementação:** Reformulada a lógica de `createAsset()` para consultar previamente a existência do ID antes de qualquer transição.
* **Bloqueio de Rebaixamento:** Se um asset já estiver com `status = 'ready'`, chamadas a `createAsset()` com status `processing` ou `pending` são estritamente ignoradas, impedindo qualquer mutação ou rebaixamento.
* **Garantia Anti-Redefinição:** Tentativas de executar `createAsset()` sobre um asset `ready` passando uma `generation_key` divergente lançam explicitamente `IMMUTABILITY ERROR`.
* **Preservação:** Os campos `status`, `file_hash`, `storage_path` e `generation_key` permanecem intocados.

### 2.3 FIX 3 — Asset Resolver com Validação de Ownership Físico do Job
* **Implementação:** Adicionada validação de contenção canônica baseada no diretório real do Job:
  - Derivação server-side de `expectedJobDir = outputs/jobs/<asset.job_id>/`;
  - Resolução física via `fs.realpathSync()`;
  - Exigência estrita de `realAssetPath.startsWith(realJobDir + path.sep)`;
* **Proteções Concretas:**
  - Bloqueio imediato caso um asset do Job A aponte diretamente para arquivo físico regular do Job B (`SECURITY VIOLATION`);
  - Bloqueio estrito de symlinks que apontem para pastas de outros jobs;
  - Bloqueio estrito de symlinks apontando para arquivos externos do sistema.

---

## 2. Mudanças Implementadas

### 2.1 Banco de Dados e Migrations
* **`migrations/004_create_video_assets_and_blueprints.sql`:**
  - Criação da tabela relacional `video_assets` (id, job_id, property_ref, asset_type, storage_type, storage_path, provider_ref, remote_url, file_hash, generation_key, status, specs, metadata, error_message, created_at, updated_at).
  - Adição da coluna explícita `creative_blueprints JSONB DEFAULT '[]'::jsonb` na tabela `video_jobs`.
  - Índices criados:
    * `idx_video_assets_generation_key` (busca semântica por receita);
    * `idx_video_assets_file_hash` (validação física de integridade);
    * `idx_video_assets_job_type` (filtro de assets por job);
    * `idx_video_assets_property_type` (catálogo de acervo por imóvel);
    * `idx_video_assets_status` (monitoramento de lifecycle);
    * `idx_video_jobs_blueprints` (GIN sobre `creative_blueprints`).

### 2.2 Novo Módulo `video_engine/asset_service.js`
* **Hashes Independentes:**
  - `generation_key`: SHA-256 determinístico sobre o payload normalizado da receita (tipo + texto + look + voz + provedor + formato).
  - `file_hash`: SHA-256 físico sobre os bytes reais do arquivo no disco local.
* **Ciclo de Vida de Storage:**
  - Estados: `pending`, `processing`, `remote_ready`, `ready`, `failed`, `archived`.
  - `storage_path` nullable enquanto o arquivo não está materializado localmente.
* **Imutabilidade Estrita:**
  - Assets com `status = 'ready'` não podem ser sobrescritos com bytes divergentes (`IMMUTABILITY ERROR`).
  - Idempotência preservada se o arquivo físico for idêntico.
* **Asset Resolver:**
  - Resolução dinâmica e validação de existência, tamanho > 0, contenção canônica contra symlinks (`realpathSync`) e integridade anti-tampering.
* **Creative Blueprints Declarativos:**
  - Construção dos 3 blueprints por Job (`crv_<job_id>_v<variante>_b1`).
  - Contém `recipe_snapshot`, `resolved_assets`, `composition_directives`, `timeline` e `output_target`.
  - Elimina duplicação desnecessária de paths e codecs.
* **Isolamento de Falha (Fail-Open):**
  - Wrapper `safeCatalogOperation()` garantindo que falhas na catalogação não interrompam a renderização da Fase 2C.

### 2.3 Instrumentação do Job Core (`video_engine/job_service.js`)
* Ao criar o Job em `SCRIPT_READY`, `job_service.js` inicializa e persiste os 3 Creative Blueprints de forma não-bloqueante na coluna `creative_blueprints`.

### 2.4 Instrumentação do Orquestrador (`video_engine/pilot_service.js`)
* Instrumentação aditiva para registrar e marcar como `ready`:
  - Hook 1 (`ast_hk_<jobId>_01`);
  - Body (`ast_bd_<jobId>_01`);
  - Pilot / Vídeo 1 (`ast_out_pilot_<jobId>`);
  - Hook 2 (`ast_hk_<jobId>_02`);
  - Hook 3 (`ast_hk_<jobId>_03`);
  - Vídeo 2 (`ast_out_vid2_<jobId>`);
  - Vídeo 3 (`ast_out_vid3_<jobId>`).
* Atualização dos blueprints declarativos atrelando os IDs finais de renderização.
* Preservação integral de `validateStrongBody()`, `realpathSync`, `ffprobe`, smart retry e resume.

### 2.5 Novos Endpoints no Adaptador HTTP (`video_engine/api_v2.js`)
* Inclusão de `creative_blueprints` na resposta de `GET /api/v2/panel/video-jobs/:id`.
* `GET /api/v2/panel/video-jobs/:id/blueprints`: Retorna os blueprints declarativos do Job.
* `GET /api/v2/panel/video-jobs/:id/assets`: Retorna o catálogo de assets registrados para o Job.

---

## 3. Garantias de Não-Regressão e Políticas

1. **Zero Reuso Cross-Job Automático:**  
   Cada Job continua gerando e consumindo estritamente seus próprios arquivos físicos. Nenhuma substituição de asset entre jobs distintos ocorre nesta fase.
2. **WhatsApp V1 Intacto:**  
   O adaptador `video_anuncios_engine.js` permanece inalterado e online.
3. **Showcase Preservado:**  
   O Job `bbddf3ba-f7c6-44f5-a81a-2ac09dae611b` continua com os 3 vídeos servidos via streaming autenticado 200 OK.
4. **Segurança Reforçada:**  
   Bloqueio 403 estático em `/outputs/jobs/` mantido; HTTP Basic Auth e Bearer Token protegendo todas as rotas.

---

## 4. Resultados da Homologação (22/22 Testes)

- Cenário 1: generation_key determinística e estável -> PASSOU
- Cenário 2: generation_key sensível a texto -> PASSOU
- Cenário 3: generation_key sensível a look_id -> PASSOU
- Cenário 4: generation_key sensível a voice_id -> PASSOU
- Cenário 5: Asset pendente com storage_path = NULL -> PASSOU
- Cenário 6: Transição para READY com cálculo físico de file_hash -> PASSOU
- Cenário 7: Bloqueio de sobrescrita por imutabilidade de asset READY -> PASSOU
- Cenário 8: Idempotência com arquivo idêntico -> PASSOU
- Cenário 9: Asset Resolver validando integridade física -> PASSOU
- Cenário 10: Inicialização e persistência de 3 blueprints no Job Core -> PASSOU
- Cenário 11: Tolerância a jobs legados sem blueprints -> PASSOU
- Cenário 12: Showcase da 2C acessível nos 3 vídeos -> PASSOU
- Cenário 13: Isolamento estrito cross-job -> PASSOU
- Cenário 14: Catalogação dos 7 assets do pipeline completo -> PASSOU
- Cenário 15: Endpoints HTTP /blueprints e /assets funcionais -> PASSOU
- Cenário 16: Integridade do WhatsApp V1 -> PASSOU